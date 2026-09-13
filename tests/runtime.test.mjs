import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCSV,analyzeCSV,csvText} from '../lib/csv.mjs';
import {validateConfig,defaults,publicConfig} from '../lib/provider.mjs';
import {createStore} from '../lib/store.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
let scenario='responses',turn=0,requests=[],heldArrival,heldRelease,heldGate;
const fake=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);requests.push({path:req.url,headers:req.headers,body:b});turn++;
  res.setHeader('Content-Type','application/json');
  if(scenario==='held'){heldArrival();await heldGate;if(!res.destroyed)res.end(JSON.stringify({output:[],usage:{input_tokens:1,output_tokens:1}}));return;}
  if(scenario==='delay'){await sleep(600);if(!res.destroyed)res.end(JSON.stringify({output:[],usage:{input_tokens:1,output_tokens:1}}));return;}
  if(scenario==='fail'){res.writeHead(401);res.end('{"error":"fake-credential-must-not-leak"}');return;}
  if(scenario==='malformed'){res.end(JSON.stringify({usage:{input_tokens:40,output_tokens:10}}));return;}
  const t=turn;
  const call=scenario==='ask'?{name:'ask_user',args:{questions:['这份建议主要给谁使用？']}}:t===1?{name:'set_plan',args:{steps:['阅读任务材料','制作成果并核对']}}:t===2?{name:'deliver_artifact',args:{name:'测试成果.html',kind:'html',content:'<!doctype html><meta charset="utf-8"><button id="add">新增记录</button><output id="count"></output><script>let n=Number(localStorage.getItem("n")||0);count.textContent=n;add.onclick=()=>{count.textContent=++n;localStorage.setItem("n",n)}</script>'}}:null;
  if(scenario==='unknown'||scenario==='truncated'){res.end(JSON.stringify({status:scenario==='truncated'?'incomplete':'completed',output:call?[{type:'function_call',call_id:'c1',name:call.name,arguments:JSON.stringify(call.args)}]:[]}));return;}
  if(b.messages&&req.url.endsWith('/messages')){
    const content=call?[{type:'thinking',thinking:'test',signature:'retain-test-signature'},{type:'tool_use',id:'c'+t,name:call.name,input:call.args}]:[{type:'text',text:'已保存成果，等待你验收。'}];
    res.end(JSON.stringify({content,stop_reason:call?'tool_use':'end_turn',usage:{input_tokens:7,cache_read_input_tokens:2,cache_creation_input_tokens:3,output_tokens:4}}));return;
  }
  if(b.messages){
    const message=call?{role:'assistant',content:null,reasoning_content:'retain-test-reasoning',tool_calls:[{id:'c'+t,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{role:'assistant',content:'已保存成果，等待你验收。'};
    res.end(JSON.stringify({choices:[{message,finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:12,completion_tokens:4,prompt_tokens_details:{cached_tokens:2}}}));return;
  }
  res.end(JSON.stringify({status:'completed',output:call?[{type:'reasoning',id:'r'+t,encrypted_content:'retain-test-encrypted',summary:[]},{type:'function_call',call_id:'c'+t,name:call.name,arguments:JSON.stringify(call.args)}]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'已保存成果，等待你验收。'}]}],usage:{input_tokens:12,output_tokens:4,input_tokens_details:{cached_tokens:2}}}));
});

test('CSV 清洗保持数据边界，可复核变更与汇总',()=>{
  const source='\uFEFF部门,工时,备注\r\n产品,2,"含,逗号"\r\n产品,3,"两行\n文字"\r\n研发,4,  空白  \r\n研发,4,  空白  \r\n,,\r\n';
  const r=analyzeCSV(source,{trim:true,deduplicate:true,groupBy:'部门',valueColumn:'工时'});
  assert.equal(r.facts.inputRows,5);assert.equal(r.facts.outputRows,3);assert.equal(r.facts.emptyRows,1);assert.equal(r.facts.removedDuplicates,1);assert.deepEqual(r.facts.groups,[['产品',5],['研发',4]]);
  assert.equal(parseCSV(r.artifacts[0].content)[1][2],'含,逗号');assert.equal(parseCSV(r.artifacts[0].content)[2][2],'两行\n文字');
  assert.equal(analyzeCSV(source).facts.outputRows,4);
  assert.throws(()=>analyzeCSV('a,b\n1,2,3'),/列/);assert.throws(()=>parseCSV('a\n"未闭合'),/引号/);
  assert.equal(parseCSV(csvText([['x'],['=HYPERLINK("https://evil")']]))[1][0][0],"'");
  assert.equal(analyzeCSV('id\n9007199254740993').facts.columns[0].numeric,false);
  assert.equal(parseCSV(analyzeCSV('id\n001').artifacts[0].content)[1][0],'001');
});
test('多家配置分别保留密钥，查询不暴露密钥，改地址清除旧密钥',()=>{
  let c=validateConfig({...defaults,apiKey:'fake-openai'},defaults);
  c=validateConfig({...defaults,service:'deepseek',provider:'chat',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',apiKey:'fake-deepseek'},c);
  assert.equal(c.profiles.openai.apiKey,'fake-openai');assert.equal(c.apiKey,'fake-deepseek');
  assert.ok(!JSON.stringify(publicConfig(c)).includes('fake-'));
  c=validateConfig({...c,baseUrl:'https://example.com/v1',apiKey:''},c);assert.equal(c.apiKey,'');
  assert.throws(()=>validateConfig({...c,baseUrl:'http://example.com/v1'},c),/HTTPS/);
});
test('磁盘事务串行保存，失败不覆盖状态，重启保留任务',async()=>{
  const dir=await mkdtemp(join(await mkdir(resolve(root,'test-results'),{recursive:true}).then(()=>resolve(root,'test-results')),'store-'));
  const s=await createStore(dir);await Promise.all([s.transact(x=>x.tasks.push({id:'a',status:'ready'})),s.transact(x=>x.tasks.push({id:'b',status:'ready'}))]);
  await assert.rejects(s.transact(x=>{x.tasks=[];throw new Error('reject');}));assert.equal(s.read().tasks.length,2);
  assert.equal((await createStore(dir)).read().tasks.length,2);
  await writeFile(join(dir,'workspace.json'),'bad json');await assert.rejects(createStore(dir),/未覆盖/);assert.equal(await readFile(join(dir,'workspace.json'),'utf8'),'bad json');
});
test('本地 API、四家工具协议、实际用量、取消、版本、隔离预览',{timeout:60000},async()=>{
  await listen(fake);const fakeBase=`http://127.0.0.1:${fake.address().port}`;
  const reservation=http.createServer();await listen(reservation);const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  await mkdir(resolve(root,'test-results'),{recursive:true});const dir=await mkdtemp(join(resolve(root,'test-results'),'runtime-'));
  let child,childDone,startupError;
  const launch=()=>{startupError=null;child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),WORKBENCH_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});child.stdout.resume();child.stderr.resume();childDone=new Promise(r=>{child.once('exit',r);child.once('error',e=>{startupError=e;r();});});};launch();
  async function stop(){if(child.exitCode===null&&child.signalCode===null&&child.pid)child.kill();let timer;try{await Promise.race([childDone,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Child process did not exit')),5000);})]);}finally{clearTimeout(timer);}}
  const base=`http://127.0.0.1:${port}`;
  async function api(path,method='GET',b,extra={}){const r=await fetch(base+'/api/'+path,{method,headers:{...(b===undefined?{}:{'Content-Type':'application/json'}),...extra},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,data:await r.json()};}
  async function ready(){for(let i=0;i<80;i++){if(startupError||child.exitCode!==null||child.signalCode!==null)throw new Error('Server exited before becoming ready');try{const r=await api('tasks');if(r.status===200)return;}catch{}await sleep(60);}throw new Error('Server did not start');}
  async function task(){return(await api('tasks','POST',{goal:'给我做一个记录学习的工具',preferences:'简洁，不设打卡惩罚',criteria:'刷新保留数据',materials:[{name:'记录.csv',content:'部门,工时\n产品,2\n研发,3'}]})).data;}
  async function done(id){for(let i=0;i<160;i++){const r=(await api('tasks/'+id)).data;if(r.status!=='running')return r;await sleep(40);}throw new Error('Run did not finish');}
  async function configure(service,provider){return api('config','PUT',{service,provider,baseUrl:fakeBase,model:'mock-only-'+service,apiKey:'fake-test-key',maxCalls:6,maxOutputTokens:6000,tokenBudget:30000,webSearch:false});}
  try{
    await ready();
    assert.equal((await fetch(base+'/api/tasks',{headers:{Origin:'https://evil.example'}})).status,403);
    const foreignHost=await new Promise((resolve,reject)=>{http.get(base+'/api/config',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});
    assert.equal(foreignHost,403);
    assert.equal((await fetch(base+'/.local-data/config.json')).status,404);
    assert.equal((await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,400);
    let t=await task();assert.ok(t.id);
    assert.match((await api('tasks/'+t.id+'/run','POST',{})).data.error,/配置/);
    let csv=await api('tasks/'+t.id+'/csv','POST',{revision:t.revision,materialId:t.materials[0].id,groupBy:'部门',valueColumn:'工时'});
    assert.equal(csv.data.artifacts.length,4);assert.equal(csv.data.usage.length,0);assert.equal(csv.data.materials[0].content,t.materials[0].content);
    assert.equal((await api('tasks/'+t.id+'/feedback','POST',{revision:t.revision,message:'stale'})).status,400);
    const originalCount=csv.data.artifacts.length;
    for(const [service,protocol]of [['openai','responses'],['deepseek','chat'],['glm','chat'],['claude','anthropic']]){
      scenario=protocol;turn=0;requests=[];assert.equal((await configure(service,protocol)).status,200);t=await task();
      assert.equal((await api('tasks/'+t.id+'/run','POST',{})).status,202);let result=await done(t.id);
      assert.equal(result.status,'review',JSON.stringify(result.events));assert.equal(result.artifacts.length,1);assert.equal(result.usage.length,3);assert.equal(result.usage[0].input,12);assert.equal(result.usage[0].output,4);assert.equal(result.preferences,t.preferences);
      assert.equal(result.artifacts[0].acceptedAt,null);assert.equal(requests[0].body.model,'mock-only-'+service);
      const second=JSON.stringify(requests[1].body);
      assert.ok(second.includes(protocol==='responses'?'retain-test-encrypted':protocol==='anthropic'?'retain-test-signature':'retain-test-reasoning'));
      if(protocol==='anthropic'){assert.ok(second.includes('tool_result'));assert.equal(requests[0].headers['x-api-key'],'fake-test-key');assert.equal(result.usage[0].cacheWrite,3);}
      else if(protocol==='responses')assert.ok(second.includes('function_call_output'));
      else assert.ok(second.includes('tool_call_id'));
      // A revision creates a new artifact version; acceptance is never inherited.
      result=(await api('tasks/'+t.id+'/accept','POST',{revision:result.revision,artifactId:result.artifacts[0].id,accepted:true})).data;
      assert.equal(result.status,'completed');
      result=(await api('tasks/'+t.id+'/feedback','POST',{revision:result.revision,message:'再加一点自己的特色'})).data;
      turn=0;await api('tasks/'+t.id+'/run','POST',{});result=await done(t.id);assert.equal(result.artifacts.length,2);assert.equal(result.artifacts[1].version,2);assert.equal(result.artifacts[1].acceptedAt,null);
      const artifact=result.artifacts[1];
      const pr=await fetch(`${base}/api/tasks/${t.id}/artifacts/${artifact.id}/preview?nonce=0123456789abcdef0123456789abcdef`);
      assert.equal(pr.status,200);assert.match(pr.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(pr.headers.get('content-security-policy'),/connect-src 'none'/);
      assert.ok(!(await pr.text()).includes('fake-test-key'));
      assert.equal((await api('tasks/'+t.id+'/preview-data','PUT',{artifactId:artifact.id,revision:0,data:{n:'2'}})).status,200);
      assert.equal((await api('tasks/'+t.id+'/preview-data','PUT',{artifactId:artifact.id,revision:0,data:{n:'9'}})).status,400);
      assert.equal((await api('tasks/'+t.id)).data.previewData[artifact.id].data.n,'2');
      assert.ok(!JSON.stringify((await api('tasks/'+t.id+'/export')).data).includes('fake-test-key'));
    }
    assert.ok(!JSON.stringify((await api('config')).data).includes('fake-test-key'));
    await configure('openai','responses');scenario='ask';turn=0;t=await task();await api('tasks/'+t.id+'/run','POST',{});t=await done(t.id);assert.equal(t.status,'waiting');assert.equal(t.questions.length,1);
    scenario='fail';turn=0;await api('tasks/'+t.id+'/run','POST',{});t=await done(t.id);assert.equal(t.status,'blocked');assert.equal(t.usage.at(-1).input,null);assert.ok(!JSON.stringify(t).includes('fake-credential-must-not-leak'));
    scenario='truncated';turn=0;await api('tasks/'+t.id+'/run','POST',{});t=await done(t.id);assert.equal(t.status,'blocked');assert.equal(t.plan.length,0);
    scenario='malformed';turn=0;await api('tasks/'+t.id+'/run','POST',{});t=await done(t.id);assert.equal(t.status,'blocked');assert.equal(t.usage.at(-1).input,40);assert.equal(t.usage.at(-1).status,'returned-error');
    await api('config/test','POST',{});const testUsage=(await api('connection-usage')).data;assert.equal(testUsage.at(-1).input,40);assert.equal(testUsage.at(-1).status,'returned-error');
    scenario='delay';turn=0;await api('tasks/'+t.id+'/run','POST',{});assert.equal((await api('tasks/'+t.id+'/run','POST',{})).status,400);await sleep(80);await api('tasks/'+t.id+'/cancel','POST',{});t=await done(t.id);assert.equal(t.status,'paused');assert.equal(t.usage.at(-1).input,null);
    // Force a real write failure after the model request has started.
    scenario='held';const arrived=new Promise(r=>heldArrival=r);heldGate=new Promise(r=>heldRelease=r);
    turn=0;await api('tasks/'+t.id+'/run','POST',{});await arrived;const blockedPath=join(dir,'workspace.json.tmp');await mkdir(blockedPath);heldRelease();t=await done(t.id);assert.equal(t.status,'blocked');assert.equal(t.storageFailure,true);assert.match(t.events.at(-1).text,/本地保存失败/);await rmdir(blockedPath);
    const count=(await api('tasks')).data.length;await stop();launch();await ready();assert.equal((await api('tasks')).data.length,count);assert.equal((await api('tasks/'+t.id)).data.status,'blocked');
    assert.equal(originalCount,4);
  }finally{heldRelease?.();try{await stop();}finally{fake.closeAllConnections();await new Promise(r=>fake.close(r));}}
});
