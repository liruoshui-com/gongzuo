import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createEngine,instructions,toolDefinitions} from '../lib/engine.mjs';
import {createStore} from '../lib/store.mjs';
import {buildTaskContext} from '../lib/context-health.mjs';
import {defaults,requestModel,buildRequestBody} from '../lib/provider.mjs';
import {fixtures,makeTask} from './fixtures.mjs';
import {gradeTask} from './grade.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const neutralInstructions=instructions.replace('按需读取材料切片，避免无必要地重发全文。已有成果修改前先读取。','所需正文不在当前上下文时再调用读取工具；修改已有成果前核对其旧版内容。');
export function fullContext(task,webSearch=false){
  const value=buildTaskContext(task,webSearch);
  value.materials=value.materials.map(m=>({...m,untrustedContent:task.materials.find(x=>x.id===m.id).content}));
  value.artifacts=value.artifacts.map(a=>({...a,untrustedContent:task.artifacts.find(x=>x.id===a.id).content}));
  return value;
}
const prices={checkedAt:'2026-09-13',currency:'CNY',unit:'per million tokens',source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',peak:{input:2,cached:0.04,output:8},offPeak:{input:1,cached:0.02,output:4}};
function tariff(at){const local=new Date(new Date(at).getTime()+8*3600000),day=local.getUTCDay(),hour=local.getUTCHours();return day>0&&day<6&&((hour>=9&&hour<12)||(hour>=14&&hour<18))?prices.peak:prices.offPeak;}
function cost(usage,at){if(usage?.input==null||usage?.output==null||usage?.cached==null)return null;const p=tariff(at);return ((usage.input-usage.cached)*p.input+usage.cached*p.cached+usage.output*p.output)/1e6;}
const validToken=value=>Number.isInteger(value)&&value>=0;
const knownUsage=usage=>validToken(usage?.input)&&validToken(usage?.output);
const peakCost=entries=>entries.every(e=>knownUsage(e.usage))?entries.reduce((sum,e)=>sum+(e.usage.input*prices.peak.input+e.usage.output*prices.peak.output)/1e6,0):null;

// A request can appear both in an inherited ledger and in setup/current arrays.
// Its original identity survives further continuations; usage is never an ID.
export function deduplicateRequests(entries){
  const result=[],seen=new Map();
  for(const entry of entries){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('Invalid prior request entry');
    const identity=hash({id:entry.id??null,at:entry.at??null,requestFingerprint:entry.requestFingerprint??null,fixtureId:entry.fixtureId??null,condition:entry.condition??null,phase:entry.phase??null});
    if(entry.id==null&&!entry.at&&!entry.requestFingerprint&&!entry.ledgerId)throw new Error('Prior request has no stable identity');
    const aliases=[identity,...(typeof entry.ledgerId==='string'?[entry.ledgerId]:[])];
    const index=aliases.map(alias=>seen.get(alias)).find(value=>value!==undefined);
    const usage=entry.usage?Object.fromEntries(['input','output','cached','cacheWrite','reasoning'].map(name=>[name,validToken(entry.usage[name])?entry.usage[name]:null])):null;
    if(usage&&usage.cached!=null&&usage.input!=null&&usage.cached>usage.input)usage.cached=null;
    const clean={ledgerId:entry.ledgerId||identity};
    for(const name of ['id','at','fixtureId','condition','phase','status','requestFingerprint','requestCharacters','requestBytes','elapsedSeconds','incomplete'])if(entry[name]!==undefined)clean[name]=entry[name];
    if(Array.isArray(entry.toolNames))clean.toolNames=entry.toolNames.filter(name=>typeof name==='string');
    clean.usage=usage;
    if(index===undefined){const next=result.length;result.push(clean);for(const alias of aliases)seen.set(alias,next);}
    else{
      const existing=result[index];
      for(const field of ['input','output'])if(validToken(existing.usage?.[field])&&validToken(usage?.[field])&&existing.usage[field]!==usage[field])throw new Error('Conflicting known usage for the same prior request');
      if(usage){existing.usage??={};for(const [field,value]of Object.entries(usage))if(value!=null)existing.usage[field]=value;}
      if(knownUsage(usage))existing.status=clean.status;
      for(const alias of aliases)seen.set(alias,index);
    }
  }
  return result;
}

export function comparePairs(runs,fixtureIds=[...new Set(runs.map(r=>r.fixtureId))]){
  return fixtureIds.flatMap(fixtureId=>{
    const full=runs.find(r=>r.fixtureId===fixtureId&&r.condition==='full-context'),demand=runs.find(r=>r.fixtureId===fixtureId&&r.condition==='on-demand');
    if(!full||!demand)return [];
    const phasesMatched=[full,demand].every(run=>run.phases?.length===2&&['initial','revision'].every(phase=>run.phases.filter(p=>p.phase===phase).length===1));
    const phases=[...(full.phases||[]),...(demand.phases||[])];
    const workflowCompleted=phasesMatched&&phases.every(p=>['review','completed'].includes(p.status));
    const automatedQualityMatched=phasesMatched&&phases.every(p=>p.quality?.automatedPassed===true);
    return [{fixtureId,phasesMatched,workflowCompleted,automatedQualityMatched,
      comparisonScope:workflowCompleted&&automatedQualityMatched?'completed-workflow-resource-difference':'budget-limited-resource-difference',
      tokenReductionPercent:phasesMatched&&full.usage?.totalTokens>0&&demand.usage?.totalTokens!=null?(1-demand.usage.totalTokens/full.usage.totalTokens)*100:null,
      timeReductionPercent:phasesMatched&&full.executionSeconds>0?(1-demand.executionSeconds/full.executionSeconds)*100:null,qualityConfirmed:false}];
  });
}

export function prepareHistory(priorReport,setupRequests=[]){
  const prior=priorReport||{},inherited=[];
  for(const field of ['priorRequests','previousRequests','setupRequests','requests']){
    if(prior[field]!==undefined&&!Array.isArray(prior[field]))throw new Error('Invalid previous request ledger');
    inherited.push(...(prior[field]||[]));
  }
  if(priorReport&&!Array.isArray(prior.requests))throw new Error('Previous report must contain its current request ledger');
  const priorRequests=deduplicateRequests(inherited),allPrevious=deduplicateRequests([...priorRequests,...setupRequests]);
  const priorIds=new Set(priorRequests.map(e=>e.ledgerId));
  const newSetup=allPrevious.filter(e=>!priorIds.has(e.ledgerId));
  const incompleteLedger=priorReport&&(prior.guard?.unknownUsage===true||prior.total?.unknownUsageRequests>0||Number.isInteger(prior.guard?.requests)&&prior.guard.requests>(prior.requests||[]).length||Number.isInteger(prior.total?.requests)&&prior.total.requests>priorRequests.length);
  const conservativePriorCny=peakCost(allPrevious),unknown=!!incompleteLedger||conservativePriorCny===null;
  const previousExperiments=Array.isArray(prior.previousExperiments)?structuredClone(prior.previousExperiments):[];
  if(priorReport)previousExperiments.push({
    reportFingerprint:hash(prior),createdAt:prior.createdAt??null,finishedAt:prior.finishedAt??null,status:prior.status??'unknown',
    sample:prior.currentSample??prior.sample??null,fixtureHash:prior.fixtureHash??null,
    runs:structuredClone(prior.runs||[]),originalPairs:structuredClone(prior.pairs||[]),pairs:comparePairs(prior.runs||[])
  });
  return {priorRequests:allPrevious.filter(e=>priorIds.has(e.ledgerId)),setupRequests:newSetup,previousExperiments,conservativePriorCny,unknown};
}

export class SpendGuard {
  constructor(maxCny,maxRequests){this.maxCny=maxCny;this.maxRequests=maxRequests;this.requests=0;this.reservedCny=0;this.unknown=false;this.stoppedReason=null;}
  reserve(body){
    if(this.unknown)throw new Error('前次用量未知，停止后续请求。');
    // Text-only UTF-8 bytes plus a large framing margin. This is a planning
    // reserve, not a token measurement or a provider-enforced billing limit.
    const reserve=(Buffer.byteLength(JSON.stringify(body))+16000)*prices.peak.input/1e6+(body.max_tokens||body.max_output_tokens)*prices.peak.output/1e6;
    if(this.requests>=this.maxRequests||this.reservedCny+reserve>this.maxCny){this.stoppedReason='request-or-reserve-limit';throw new Error('达到实验请求或费用预留上限，未发送下一请求。');}
    this.requests++;this.reservedCny+=reserve;return reserve;
  }
  settle(reserve,usage){
    if(usage?.input==null||usage?.output==null){this.unknown=true;this.stoppedReason='unknown-usage';return;}
    const upper=(usage.input*prices.peak.input+usage.output*prices.peak.output)/1e6;
    this.reservedCny+=upper-reserve;
    if(this.reservedCny>=this.maxCny){this.unknown=true;this.stoppedReason='usage-exceeds-reserve';}
  }
}
async function explicitKey(){
  if(process.stdin.isTTY)process.stdin.setRawMode(true);
  console.log('KEY_INPUT_READY (input is not echoed)');
  return new Promise((resolve,reject)=>{let value='';process.stdin.setEncoding('utf8');const take=chunk=>{value+=chunk;if(value.length>4096){reject(new Error('Key input too long'));return;}if(/[\r\n]/.test(value)){process.stdin.removeListener('data',take);process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);const key=value.trim();if(!key||/[\r\n]/.test(key))reject(new Error('Invalid explicit key'));else resolve(key);}};process.stdin.on('data',take);process.stdin.once('end',()=>reject(new Error('No explicit key supplied')));});
}
export function aggregate(entries){
  const known=entries.filter(x=>x.usage?.input!=null&&x.usage?.output!=null);
  const input=entries.reduce((s,x)=>s+(x.usage?.input??0),0),output=entries.reduce((s,x)=>s+(x.usage?.output??0),0);
  const costs=entries.map(x=>cost(x.usage,x.at));
  return {requests:entries.length,inputTokens:entries.every(x=>x.usage?.input!=null)?input:null,outputTokens:entries.every(x=>x.usage?.output!=null)?output:null,knownInputTokens:input,knownOutputTokens:output,totalTokens:known.length===entries.length?input+output:null,unknownUsageRequests:entries.length-known.length,cachedTokens:entries.every(x=>x.usage?.cached!=null)?entries.reduce((s,x)=>s+x.usage.cached,0):null,estimatedCny:costs.every(x=>x!==null)?costs.reduce((s,x)=>s+x,0):null};
}
function markdown(report){
  const fmt=v=>v==null?'未知':typeof v==='number'?v.toLocaleString('zh-CN',{maximumFractionDigits:3}):String(v);
  let out='# 共作：真实 API 小样本对照\n\n'+`状态：${report.status}。服务：DeepSeek 官方；请求模型：${report.config.model}。\n\n`;
  out+='本轮只改变材料和已有成果是否全文带入，两组使用相同工具、中立提示、个人要求和修改反馈。各任务只有一次配对，没有统计显著性；自动检查不代替人工质量盲评，尚不能声称普遍更省或新手工作更快。\n\n';
  out+='| 任务 | 策略 | 实际总 token | 输入 | 输出 | 缓存输入 | 执行秒数 | 自动检查 | 人工验收 | 估算费用（元） |\n|---|---|---:|---:|---:|---:|---:|---|---|---:|\n';
  for(const r of report.runs){const q=r.phases.map(p=>p.quality?.automatedPassed===true?'通过':p.quality?.automatedPassed===false?'未通过':'未检查').join(' / ');out+=`| ${r.fixtureId} | ${r.condition} | ${fmt(r.usage.totalTokens)} | ${fmt(r.usage.inputTokens)} | ${fmt(r.usage.outputTokens)} | ${fmt(r.usage.cachedTokens)} | ${fmt(r.executionSeconds)} | ${q} | 未完成 | ${fmt(r.usage.estimatedCny)} |\n`;}
  out+='\n| 任务 | 按需组总 token 变化 | 按需组执行时间变化 | 解读 |\n|---|---:|---:|---|\n';
  for(const p of report.pairs)out+=`| ${p.fixtureId} | ${p.tokenReductionPercent==null?'不可算':fmt(p.tokenReductionPercent)+'%'} | ${p.timeReductionPercent==null?'不可算':fmt(p.timeReductionPercent)+'%'} | ${p.workflowCompleted&&p.automatedQualityMatched?'流程正常结束且两组自动检查通过；人工验收尚未完成':'预算内资源差异；流程未全部完成或自动检查未全部通过，不能称为合格流程节省'} |\n`;
  out+='\n时间从执行开始到停止，包含网络、工具和落盘，不包含用户思考、操作或人工验收；自动验证时间单列在 JSON。费用按官方当日分时价和返回 token 估算，不是账单核销。用量未知不补零，缓存与推理不重复相加。连接测试单独计入总预算。\n\n';
  out+=`本次题目：${report.currentSample.fixtureIds.join('、')}。当前实验请求 ${report.requests.length} 次，先前请求 ${report.priorRequests.length} 次，本次额外连接测试 ${report.setupRequests.length} 次。累计模型请求 ${report.total.requests} 次；已知输入 ${report.total.knownInputTokens}，已知输出 ${report.total.knownOutputTokens}；估算费用 ${fmt(report.total.estimatedCny)} 元。${report.guard.stoppedReason?'停止原因：'+report.guard.stoppedReason+'。':''}\n\n`;
  if(report.previousExperiments.length){
    out+='## 先前实验记录（保留原始不完整结果）\n\n补跑单独列在上表；没有替换或删除以下先前结果。旧实验中未正常结束的流程，即使已有成果通过自动检查，也只比较预算内资源差异。\n\n| 实验 | 任务 | 策略 | 阶段状态 | 原自动检查 | 原总 token |\n|---|---|---|---|---|---:|\n';
    report.previousExperiments.forEach((previous,index)=>{for(const r of previous.runs||[])out+=`| ${index+1} | ${r.fixtureId} | ${r.condition} | ${(r.phases||[]).map(p=>p.phase+': '+p.status).join(' / ')} | ${(r.phases||[]).map(p=>p.quality?.automatedPassed===true?'通过':p.quality?.automatedPassed===false?'未通过':'未检查').join(' / ')} | ${fmt(r.usage?.totalTokens)} |\n`;});out+='\n';
  }
  out+='上下文结构检测见单独的 context-results.json；该准确率不能解释为 AI 遗忘识别或语义理解准确率。完整 fixture、模型响应中的最终成果、工具证据、顺序、版本哈希与逐请求用量保存在本机实验目录。\n';return out;
}
export async function runBenchmark({live=false,outDir,maxCny=4.95,maxRequests=40,key,chromium,browserExecutable,probeReport,fixtureIds,priorReport}={}){
  if(!Number.isFinite(maxCny)||maxCny<=0||maxCny>5||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>48)throw new Error('Invalid explicit experiment limit');
  const selectedIds=fixtureIds===undefined?fixtures.map(f=>f.id):typeof fixtureIds==='string'?fixtureIds.split(','):fixtureIds;
  if(!Array.isArray(selectedIds)||!selectedIds.length||selectedIds.some(id=>typeof id!=='string'||!fixtures.some(f=>f.id===id))||new Set(selectedIds).size!==selectedIds.length)throw new Error('Select valid, nonduplicate fixture IDs');
  const selectedFixtures=fixtures.filter(f=>selectedIds.includes(f.id));
  if(typeof priorReport==='string'||priorReport instanceof URL)priorReport=JSON.parse(await readFile(priorReport,'utf8'));
  const setupRequests=probeReport?[{id:'connection-check',at:probeReport.at,status:probeReport.status,elapsedSeconds:probeReport.durationMs/1000,usage:{input:probeReport.inputTokens,output:probeReport.outputTokens,cached:probeReport.cachedTokens}}]:[];
  const history=prepareHistory(priorReport,setupRequests);
  if(live&&history.unknown)throw new Error('Previous or setup usage is unknown; live continuation refused');
  if(live&&history.conservativePriorCny+maxCny>5+1e-12)throw new Error('Previous peak-price usage plus this experiment reserve exceeds the authorized 5 CNY budget');
  const out=resolve(outDir||join('test-results','benchmark-'+Date.now()));await mkdir(out,{recursive:true});
  if((await readdir(out)).length)throw new Error('Use a new empty output directory; previous experiment files must remain unchanged');
  const c={...defaults,service:'deepseek',provider:'chat',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'',maxCalls:4,maxOutputTokens:4096,tokenBudget:24000,webSearch:false,profiles:{}};
  const manifest={schemaVersion:2,createdAt:new Date().toISOString(),status:live?'running':'dry-run',config:{provider:c.provider,baseUrl:c.baseUrl,model:c.model,maxCalls:c.maxCalls,maxOutputTokens:c.maxOutputTokens,tokenBudget:c.tokenBudget,thinking:'disabled',temperature:0},prices,instructionsHash:hash(neutralInstructions),toolsHash:hash(toolDefinitions),fixtureHash:hash(selectedFixtures),allFixturesHash:hash(fixtures),contextVariation:'Only inline material/artifact content. Same feedback trimming, pins, tools, instructions, decoding and phase budgets.',sample:`${selectedFixtures.length} tasks × 2 conditions × initial + fixed revision, one repeat`,currentSample:{fixtureIds:selectedFixtures.map(f=>f.id),conditions:['full-context','on-demand'],phases:['initial','revision'],repeats:1},humanTimeMeasured:false,manualQualityAccepted:null,guard:{maxCny,maxRequests,combinedBudgetCny:5,priorAndSetupConservativeCny:history.conservativePriorCny,priorUsageUnknown:history.unknown},priorRequests:history.priorRequests,setupRequests:history.setupRequests,previousExperiments:history.previousExperiments,previousTotal:aggregate(history.priorRequests),runs:[],requests:[],pairs:[]};
  await writeFile(join(out,'fixtures.json'),JSON.stringify(selectedFixtures,null,2));
  if(!live){
    manifest.preflight=selectedFixtures.flatMap(f=>['full-context','on-demand'].map(condition=>{const task=makeTask(f,f.id),summary=condition==='full-context'?fullContext(task):buildTaskContext(task),body=buildRequestBody(c,{input:[{role:'user',content:JSON.stringify(summary)}],tools:toolDefinitions,instructions:neutralInstructions});return {fixtureId:f.id,condition,requestCharacters:JSON.stringify(body).length,requestBytes:Buffer.byteLength(JSON.stringify(body)),materialCharacters:f.materials.reduce((s,m)=>s+m.content.length,0),tokens:null};}));
    manifest.total=aggregate([...manifest.priorRequests,...manifest.setupRequests]);
    await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));return {status:'dry-run',outDir:out,liveRequests:0,preflight:manifest.preflight};
  }
  if(!key)key=await explicitKey();c.apiKey=key;
  const guard=new SpendGuard(maxCny,maxRequests);let active;
  const guardedRequester=async(config,options)=>{
    let reserve,entry;
    try{
      const result=await requestModel(config,{...options,onRequest:async body=>{
        body.thinking={type:'disabled'};body.temperature=0;
        reserve=guard.reserve(body);entry={id:manifest.requests.length+1,fixtureId:active.fixtureId,condition:active.condition,phase:active.phase,at:new Date().toISOString(),status:'prepared',requestFingerprint:hash(body),requestCharacters:JSON.stringify(body).length,requestBytes:Buffer.byteLength(JSON.stringify(body))};
        // Record via the real engine before fetch; metadata only, no body/headers.
        await options.onRequest?.(body);manifest.requests.push(entry);entry.started=performance.now();
      }});
      guard.settle(reserve,result.usage);Object.assign(entry,{usage:result.usage,status:'returned',elapsedSeconds:(performance.now()-entry.started)/1000,incomplete:result.incomplete,toolNames:result.calls.map(c=>c.name)});delete entry.started;return result;
    }catch(error){if(reserve!==undefined){guard.settle(reserve,error.usage);if(entry){Object.assign(entry,{usage:error.usage||null,status:'failed',elapsedSeconds:entry.started==null?null:(performance.now()-entry.started)/1000});delete entry.started;}}throw error;}
  };
  const store=await createStore(join(out,'data'));
  for(const fixture of selectedFixtures){
    const order=fixtures.indexOf(fixture)%2?['on-demand','full-context']:['full-context','on-demand'];
    for(const condition of order){
      if(guard.unknown||guard.stoppedReason)break;
      const task=makeTask(fixture,fixture.id+'-'+condition);await store.transact(s=>s.tasks.push(task));
      const engine=createEngine(store,()=>c,{contextBuilder:condition==='full-context'?fullContext:buildTaskContext,instructionsOverride:neutralInstructions,modelRequester:guardedRequester});
      const run={fixtureId:fixture.id,condition,order:manifest.runs.length+1,phases:[],executionSeconds:0,validationSeconds:0};manifest.runs.push(run);
      for(const phase of ['initial','revision']){
        if(guard.unknown||guard.stoppedReason)break;
        if(phase==='revision')await store.transact(s=>{const t=s.tasks.find(x=>x.id===task.id);t.feedback.push({at:new Date().toISOString(),text:fixture.revisionFeedback});t.revision++;t.status='ready';});
        active={fixtureId:fixture.id,condition,phase};const begin=performance.now();await engine.start(task.id);
        while(engine.isActive(task.id))await sleep(40);
        const seconds=(performance.now()-begin)/1000,finished=store.read().tasks.find(x=>x.id===task.id);
        const validationStart=performance.now(),artifactDir=join(out,task.id,phase);await mkdir(artifactDir,{recursive:true});
        for(const a of finished.artifacts)await writeFile(join(artifactDir,`v${a.version}-${a.name}`),a.content);
        const quality=await gradeTask(fixture,finished,{phase,chromium,browserExecutable,artifactDir});
        const validationSeconds=(performance.now()-validationStart)/1000;
        run.phases.push({phase,status:finished.status,executionSeconds:seconds,validationSeconds,quality,artifactCount:finished.artifacts.length});run.executionSeconds+=seconds;run.validationSeconds+=validationSeconds;
        run.usage=aggregate(manifest.requests.filter(r=>r.fixtureId===fixture.id&&r.condition===condition));
        console.log(JSON.stringify({fixture:fixture.id,condition,phase,status:finished.status,seconds,automatedPassed:quality.automatedPassed,requests:guard.requests}));
        await writeFile(join(out,'results.partial.json'),JSON.stringify({...manifest,guard:{...guard,maxCny,maxRequests,combinedBudgetCny:5,priorAndSetupConservativeCny:history.conservativePriorCny,combinedConservativeUsedCny:history.conservativePriorCny+guard.reservedCny,unknownUsage:guard.unknown},currentTotal:aggregate([...manifest.setupRequests,...manifest.requests]),total:aggregate([...manifest.priorRequests,...manifest.setupRequests,...manifest.requests])},null,2));
      }
      run.usage=aggregate(manifest.requests.filter(r=>r.fixtureId===fixture.id&&r.condition===condition));
    }
  }
  manifest.pairs=comparePairs(manifest.runs,selectedFixtures.map(f=>f.id));
  Object.assign(manifest,{status:guard.stoppedReason?'stopped':'completed',finishedAt:new Date().toISOString(),guard:{maxCny,maxRequests,requests:guard.requests,conservativeUsedCny:guard.reservedCny,unknownUsage:guard.unknown,stoppedReason:guard.stoppedReason,combinedBudgetCny:5,priorAndSetupConservativeCny:history.conservativePriorCny,combinedConservativeUsedCny:history.conservativePriorCny+guard.reservedCny},experimentTotal:aggregate(manifest.requests),currentTotal:aggregate([...manifest.setupRequests,...manifest.requests]),total:aggregate([...manifest.priorRequests,...manifest.setupRequests,...manifest.requests])});
  await writeFile(join(out,'results.json'),JSON.stringify(manifest,null,2));await writeFile(join(out,'report.md'),markdown(manifest));c.apiKey='';
  return {status:manifest.status,outDir:out,total:manifest.total,pairs:manifest.pairs,guard:manifest.guard};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const args=process.argv.slice(2),flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  let chromium;const playwrightPath=flag('--playwright');if(playwrightPath){const require=createRequire(import.meta.url);({chromium}=require(playwrightPath));}
  const probeReport=flag('--probe-report')?JSON.parse(await readFile(flag('--probe-report'),'utf8')):undefined;
  const fixtureIds=args.flatMap((value,index)=>value==='--fixture'?(args[index+1]||'').split(','):[]);
  const result=await runBenchmark({live:args.includes('--live'),outDir:flag('--out'),maxCny:Number(flag('--max-cny')||4.95),maxRequests:Number(flag('--max-requests')||40),chromium,browserExecutable:flag('--browser'),probeReport,fixtureIds:fixtureIds.length?fixtureIds:undefined,priorReport:flag('--prior-report')});console.log(JSON.stringify(result));
}
