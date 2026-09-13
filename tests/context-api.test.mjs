import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';

// Run from the project root. Every server uses a fresh data directory; this test
// never reads a developer's .local-data or sends a request to a real provider.
const root=resolve(process.env.WORKBENCH_TEST_ROOT || process.cwd());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const secrets={goal:'GOAL_PRIVATE_研究😀',preferences:'PREFERENCE_PRIVATE_自己的风格',criteria:'CRITERIA_PRIVATE_核对数字',material:'MATERIAL_PRIVATE_甲😀乙丙丁戊己庚辛壬癸',memory:'EARLY_PRIVATE_永远保留这个要求',artifact:'ARTIFACT_PRIVATE_交付正文',key:'FAKE_CONTEXT_API_KEY_DO_NOT_EXPORT',reasoning:'REASONING_PRIVATE_DO_NOT_EXPORT'};

function taskSummary(body){const user=(body.input || body.messages).find(m=>m.role==='user');return JSON.parse(user.content);}
function resultFor(body,calls,index){
  const input=30+index,output=5+index;
  if(body.input)return {status:'completed',output:calls.length?[{type:'reasoning',id:'rs_'+index,encrypted_content:secrets.reasoning,summary:[]},...calls.map((c,i)=>({type:'function_call',call_id:`call_${index}_${i}`,name:c.name,arguments:JSON.stringify(c.args)}))]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'已保存成果。'}]}],usage:{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:2}}};
  if(body.system)return {content:calls.length?[{type:'thinking',thinking:secrets.reasoning,signature:'fixture-signature'},...calls.map((c,i)=>({type:'tool_use',id:`call_${index}_${i}`,name:c.name,input:c.args}))]:[{type:'text',text:'已保存成果。'}],stop_reason:calls.length?'tool_use':'end_turn',usage:{input_tokens:input-5,cache_read_input_tokens:2,cache_creation_input_tokens:3,output_tokens:output}};
  return {choices:[{message:calls.length?{role:'assistant',content:null,reasoning_content:secrets.reasoning,tool_calls:calls.map((c,i)=>({id:`call_${index}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content:'已保存成果。'},finish_reason:calls.length?'tool_calls':'stop'}],usage:{prompt_tokens:input,completion_tokens:output,prompt_tokens_details:{cached_tokens:2}}};
}

test('上下文健康 API：实际请求证据、读取范围、隐私与人工核对',{timeout:60000},async t=>{
  let script=()=>[],received=[],fakeErrors=[];
  const fake=http.createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const wire=Buffer.concat(chunks),body=JSON.parse(wire.toString('utf8')),index=received.length+1;
      received.push({wire,body,path:req.url});
      res.setHeader('Content-Type','application/json');
      const action=script(body,index);
      if(action==='http-error'){res.writeHead(401);res.end(JSON.stringify({error:secrets.key}));return;}
      if(action==='response-error'){res.end(JSON.stringify({error:{message:secrets.reasoning},usage:{input_tokens:77,output_tokens:9},output:[{type:'function_call',call_id:'not-executed',name:'read_material',arguments:JSON.stringify({id:taskSummary(body).materials[0].id,offset:0,length:8})}]}));return;}
      res.end(JSON.stringify(resultFor(body,action,index)));
    }catch(error){fakeErrors.push(error);res.writeHead(500);res.end('{"error":"fixture failed"}');}
  });
  let child,exited,startupError,diagnostic='';
  await listen(fake);
  const reservation=http.createServer();await listen(reservation);const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const base=`http://127.0.0.1:${port}`,fakeBase=`http://127.0.0.1:${fake.address().port}`;
  await mkdir(resolve(root,'test-results'),{recursive:true});
  const dataDir=await mkdtemp(join(resolve(root,'test-results'),'context-api-'));
  async function api(path,method='GET',body){
    const response=await fetch(base+'/api/'+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,headers:response.headers,data:await response.json()};
  }
  async function get(id){const r=await api('tasks/'+id);assert.equal(r.status,200);return r.data;}
  async function health(id){const r=await api(`tasks/${id}/context-health`);assert.equal(r.status,200);return r.data;}
  async function create(overrides={}){const r=await api('tasks','POST',{goal:secrets.goal,preferences:secrets.preferences,criteria:secrets.criteria,materials:[{name:'秘密文件名.txt',content:secrets.material}],...overrides});assert.equal(r.status,201);return r.data;}
  async function edit(task,action,body){const r=await api(`tasks/${task.id}/${action}`,'POST',{revision:task.revision,...body});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  async function rejected(task,action,body){const before=await get(task.id);const r=await api(`tasks/${task.id}/${action}`,'POST',{revision:task.revision,...body});assert.equal(r.status,400,`${action}: ${JSON.stringify(r.data)}`);assert.deepEqual(await get(task.id),before,'rejected edit must not modify persisted task');return r;}
  async function configure(protocol){const r=await api('config','PUT',{service:'custom',provider:protocol,baseUrl:fakeBase,model:'fixture-'+protocol,apiKey:secrets.key,maxCalls:8,maxOutputTokens:6000,tokenBudget:30000,webSearch:false});assert.equal(r.status,200);}
  async function run(task,steps){received=[];script=steps;assert.equal((await api(`tasks/${task.id}/run`,'POST',{})).status,202);for(let i=0;i<300;i++){const state=await get(task.id);if(state.status!=='running'){assert.equal(fakeErrors.length,0,fakeErrors.map(String).join('\n'));return state;}await sleep(20);}throw new Error('fixture run did not finish');}
  async function stop(){if(child?.pid&&child.exitCode===null&&child.signalCode===null)child.kill();if(exited){let timer;try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('isolated server did not exit')),5000);})]);}finally{clearTimeout(timer);}}}
  let seed,completed;
  try{
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),WORKBENCH_DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-6000);});
    exited=new Promise(r=>{child.once('exit',r);child.once('error',error=>{startupError=error;r();});});
    let ready=false;
    for(let i=0;i<100;i++){if(startupError||child.exitCode!==null||child.signalCode!==null)throw new Error(`isolated server failed: ${startupError || diagnostic}`);try{if((await api('tasks')).status===200){ready=true;break;}}catch{}await sleep(40);}
    assert.ok(ready,diagnostic || 'isolated server did not start');

    await t.test('无密钥预检指出第 13 条补充挤出的早期要求，固定不触发模型',async()=>{
      seed=await create();
      for(let i=0;i<13;i++)seed=await edit(seed,'feedback',{message:i===0?secrets.memory:`补充 ${i}：实际要求😀`});
      const before=await get(seed.id),report=await health(seed.id);
      assert.equal(report.providerConfigured,false);assert.equal(report.extraModelCalls,0);assert.equal(report.records.length,0);
      assert.equal(report.preflight.mode,'preview');assert.equal(report.preflight.feedbackTotal,13);
      assert.deepEqual(report.preflight.feedbackOmitted,[0]);assert.deepEqual(report.preflight.feedbackIncluded,Array.from({length:12},(_,i)=>i+1));
      assert.ok(report.preflight.findings.some(f=>f.code==='feedback-omitted'));
      assert.equal(before.usage.length,0);assert.equal(received.length,0);assert.deepEqual(await get(seed.id),before);
      seed=await edit(seed,'memory',{text:secrets.memory});
      const fixed=await health(seed.id);assert.ok(fixed.preflight.requirements.some(r=>r.id==='memory:'+seed.memory[0].id&&r.status==='included'));
      assert.equal(received.length,0);assert.equal(seed.usage.length,0);
    });

    for(const protocol of ['responses','chat','anthropic'])await t.test(`${protocol}：快照等于真正发送内容，成功切片在下一请求计入`,async()=>{
      await configure(protocol);
      let task=protocol==='responses'?seed:await create();
      if(!task.memory.length)task=await edit(task,'memory',{text:secrets.memory});
      task=await run(task,(body,index)=>{
        const id=taskSummary(body).materials[0].id;
        return index===1?[{name:'read_material',args:{id,offset:0,length:8}}]:index===2?[{name:'read_material',args:{id,offset:4,length:8}}]:index===3?[{name:'read_material',args:{id:'nonexistent-material',offset:0,length:8}}]:index===4?[{name:'read_material',args:{id,offset:999999,length:8}}]:index===5?[{name:'deliver_artifact',args:{name:'结果.md',kind:'md',content:secrets.artifact}}]:[];
      });
      assert.equal(task.status,'review');assert.equal(received.length,6);assert.equal(task.artifacts.length,1);
      const report=await health(task.id);assert.equal(report.records.length,received.length);assert.equal(report.unrecordedRequests,0);
      const runIds=new Set();
      report.records.forEach((record,index)=>{
        const {wire,body}=received[index],usage=task.usage.find(u=>u.id===record.id);
        assert.equal(record.requestFingerprint,hash(wire));assert.equal(record.requestCharacters,wire.toString('utf8').length);assert.equal(record.requestBytes,wire.length);
        assert.ok(record.requestBytes>record.requestCharacters,'Unicode must distinguish UTF-8 bytes from UTF-16 length');
        assert.equal(record.protocol,protocol);assert.equal(record.callNumber,index+1);runIds.add(record.runId);
        assert.ok(usage,'request record must link to actual usage entry');assert.equal(record.status,'returned');
        assert.equal(record.inputTokens,31+index);assert.equal(record.outputTokens,6+index);assert.equal(record.inputTokens,usage.input);assert.equal(record.outputTokens,usage.output);
        assert.deepEqual(taskSummary(body).pinnedRequirements,task.memory.map(({id,text})=>({id,text})));
        assert.ok(record.requirements.some(r=>r.kind==='memory'&&r.status==='included'));
      });
      assert.equal(runIds.size,1);assert.equal(report.records[0].reads.length,0);assert.equal(report.records[1].reads.length,1);
      assert.deepEqual(report.records[1].readStats,{readCharacters:8,uniqueCharacters:8,repeatedCharacters:0,localAnalyses:0});
      for(const record of report.records.slice(2)){
        assert.deepEqual(record.reads.map(r=>[r.start,r.end]),[[0,8],[4,12]],'invalid reads must not create successful receipts');
        assert.deepEqual(record.readStats,{readCharacters:16,uniqueCharacters:12,repeatedCharacters:4,localAnalyses:0});
        assert.ok(record.findings.some(f=>f.code==='repeated-read'));
        assert.ok(record.reads.every(r=>r.fingerprint===hash(secrets.material)));
      }
      assert.ok(JSON.stringify(received[1].body).includes(secrets.material.slice(0,8)),'the next actual request must carry the read result');
      assert.equal(report.preflight.reads.length,0,'preflight for a new run must not claim old tool results will be sent');
      const beforeRequests=received.length,exported=await api(`tasks/${task.id}/context-health/export`);
      assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);
      assert.equal(received.length,beforeRequests);assert.equal(exported.data.extraModelCalls,0);
      const metadata=JSON.stringify(exported.data);
      for(const secret of Object.values(secrets))assert.ok(!metadata.includes(secret),'metadata export must exclude private source content');
      for(const leak of ['秘密文件名.txt','fixture-signature','untrustedContent','Authorization','x-api-key','encrypted_content','reasoning_content'])assert.ok(!metadata.includes(leak),`metadata leaked ${leak}`);
      assert.deepEqual(exported.data.records,report.records);
      if(protocol==='responses')completed=task;
    });

    await t.test('新轮次重置读取；HTTP 失败与返回错误不伪造成功读取或有效返回',async()=>{
      await configure('responses');
      const previous=await health(completed.id),count=previous.records.length;
      completed=await run(completed,()=> 'http-error');
      assert.equal(completed.status,'blocked');
      let report=await health(completed.id),record=report.records.at(-1);
      assert.equal(report.records.length,count+1);assert.notEqual(record.runId,previous.records.at(-1).runId);assert.equal(record.callNumber,1);
      assert.equal(record.reads.length,0);assert.equal(record.readStats.readCharacters,0);assert.equal(record.status,'unknown');assert.equal(record.inputTokens,null);assert.equal(record.outputTokens,null);
      await rejected(completed,'context-review',{requestId:record.id,requirementId:'goal'});
      completed=await run(completed,()=> 'response-error');
      report=await health(completed.id);record=report.records.at(-1);
      assert.equal(completed.status,'blocked');assert.equal(record.status,'returned-error');assert.equal(record.inputTokens,77);assert.equal(record.outputTokens,9);assert.equal(record.reads.length,0);
      assert.equal(completed.artifacts.length,1);await rejected(completed,'context-review',{requestId:record.id,requirementId:'goal'});
    });

    await t.test('人工核对只接受已带入且有效返回的要求，支持成果关联与版本冲突检查',async()=>{
      const report=await health(completed.id),record=report.records.find(r=>r.status==='returned'),artifact=completed.artifacts[0];
      completed=await edit(completed,'accept',{artifactId:artifact.id,accepted:true});assert.equal(completed.status,'completed');
      await rejected(completed,'context-review',{requestId:'missing-request',requirementId:'goal'});
      await rejected(completed,'context-review',{requestId:record.id,requirementId:'missing-requirement'});
      await rejected(completed,'context-review',{requestId:record.id,requirementId:'goal',artifactId:'missing-artifact'});
      await rejected(completed,'context-review',{revision:completed.revision-1,requestId:record.id,requirementId:'goal'});
      completed=await edit(completed,'context-review',{requestId:record.id,requirementId:'goal',artifactId:artifact.id});
      assert.equal(completed.status,'review');assert.equal(completed.artifacts[0].acceptedAt,null);
      const reviewed=await health(completed.id);assert.equal(reviewed.reviews.length,1);assert.equal(reviewed.reviews[0].verdict,'user-reported-not-followed');assert.equal(reviewed.reviews[0].artifactId,artifact.id);
      await rejected(completed,'context-review',{requestId:record.id,requirementId:'goal',artifactId:artifact.id});
      completed=await edit(completed,'context-review',{requestId:record.id,requirementId:'preferences'});assert.equal(completed.contextReviews.length,2);
      // An empty requirement is recorded, but must not be reported as included.
      let empty=await create({preferences:'',criteria:''});empty=await run(empty,()=>[]);const emptyRecord=(await health(empty.id)).records[0];
      assert.equal(emptyRecord.requirements.find(r=>r.id==='preferences').status,'empty');await rejected(empty,'context-review',{requestId:emptyRecord.id,requirementId:'preferences'});
    });

    await t.test('固定要求的长度、条数、重复、移除与 revision 校验',async()=>{
      let task=await create(),calls=received.length;
      await rejected(task,'memory',{text:' '});await rejected(task,'memory',{text:'固'.repeat(801)});
      task=await edit(task,'memory',{text:'固'.repeat(800)});assert.equal(task.memory[0].text.length,800);
      await rejected(task,'memory',{text:'固'.repeat(800)});await rejected(task,'memory',{revision:task.revision-1,text:'过期提交'});
      for(let i=1;i<12;i++)task=await edit(task,'memory',{text:`固定 ${i}`});assert.equal(task.memory.length,12);
      await rejected(task,'memory',{text:'第十三项'});await rejected(task,'memory/remove',{memoryId:'does-not-exist'});
      const removedId=task.memory[0].id;await rejected(task,'memory/remove',{revision:task.revision-1,memoryId:removedId});
      task=await edit(task,'memory/remove',{memoryId:removedId});assert.equal(task.memory.length,11);assert.ok(!task.memory.some(m=>m.id===removedId));
      task=await edit(task,'memory',{text:'释放名额后再固定'});assert.equal(task.memory.length,12);
      const report=await health(task.id);assert.ok(!report.preflight.requirements.some(r=>r.id==='memory:'+removedId));
      assert.equal(report.preflight.requirements.filter(r=>r.kind==='memory'&&r.status==='included').length,12);assert.equal(received.length,calls,'memory and reports must never call the model');
    });
  }finally{try{await stop();}finally{fake.closeAllConnections();await new Promise(r=>fake.close(r));}}
});
