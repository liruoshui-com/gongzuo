import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_RECORD_LIMIT, buildTaskContext, inspectRequest, readReceipt,
  summarizeReads, appendContextRecord, reportContext
} from '../lib/context-health.mjs';

const PRIVATE = {
  goal:'private-goal-不要在诊断中复制正文',
  preference:'private-preference-保留我的表达方式',
  criteria:'private-criteria-导出后仍能使用',
  memory:'private-memory-不能删除原始记录',
  material:'private-material-content-原始材料正文',
  artifact:'private-artifact-content-成果正文',
  feedback:'private-feedback-content-历史补充正文',
  key:'fake-secret-key-context-health-test',
  thinking:'private-hidden-thinking-sentinel',
  encrypted:'private-encrypted-reasoning-sentinel',
  signature:'private-thinking-signature-sentinel'
};

function taskFixture({feedbackCount=2, artifactCount=2}={}) {
  return {
    id:'task-test', revision:4, goal:PRIVATE.goal, preferences:PRIVATE.preference,
    criteria:PRIVATE.criteria, memory:[{id:'pin-1',text:PRIVATE.memory}],
    feedback:Array.from({length:feedbackCount},(_,i)=>({at:`feedback-time-${i}`,text:`${PRIVATE.feedback}-${i}`})),
    plan:['按需读取材料','制作并验证成果'],
    materials:[{id:'material-1',name:'输入.csv',content:PRIVATE.material}],
    artifacts:Array.from({length:artifactCount},(_,i)=>({id:`artifact-${i}`,name:'成果.html',version:i+1,content:`${PRIVATE.artifact}-${i}`})),
    usage:[]
  };
}

function requestBody(protocol, context, {extra=[]}={}) {
  const user={role:'user',content:JSON.stringify(context)};
  const tool={name:'read_material',description:'Read a bounded material slice',parameters:{type:'object',properties:{id:{type:'string'}}}};
  if(protocol==='responses') return {
    model:'test-responses',instructions:'Local diagnostic fixture only',
    input:[user,...extra],store:false,max_output_tokens:1024,
    tools:[{type:'function',...tool,strict:false}],include:['reasoning.encrypted_content']
  };
  if(protocol==='anthropic') return {
    model:'test-anthropic',system:'Local diagnostic fixture only',messages:[user,...extra],
    max_tokens:1024,tools:[{name:tool.name,description:tool.description,input_schema:tool.parameters}]
  };
  return {
    model:'test-chat',messages:[{role:'system',content:'Local diagnostic fixture only'},user,...extra],
    max_tokens:1024,tools:[{type:'function',function:tool}]
  };
}

const codes=record=>record.findings.map(f=>f.code);
const noPrivateContent=value=>{
  const serialized=JSON.stringify(value);
  for(const secret of Object.values(PRIVATE)) assert.ok(!serialized.includes(secret),`diagnostic leaked fixture: ${secret}`);
};

test('任务上下文始终携带目标、固定要求和验收标准，只裁剪历史补充与成果目录',()=>{
  const task=taskFixture({feedbackCount:13,artifactCount:21});
  const before=structuredClone(task),context=buildTaskContext(task,true);
  assert.equal(context.goal,PRIVATE.goal);
  assert.equal(context.preferences,PRIVATE.preference);
  assert.equal(context.criteria,PRIVATE.criteria);
  assert.deepEqual(context.pinnedRequirements,[{id:'pin-1',text:PRIVATE.memory}]);
  assert.deepEqual(context.feedback,task.feedback.slice(1));
  assert.deepEqual(context.artifacts.map(a=>a.id),task.artifacts.slice(1).map(a=>a.id));
  assert.equal(context.artifacts.length,20);
  assert.deepEqual(context.materials,[{id:'material-1',name:'输入.csv',characters:PRIVATE.material.length}]);
  assert.ok(context.artifacts.every(a=>!Object.hasOwn(a,'content')));
  assert.ok(context.materials.every(m=>!Object.hasOwn(m,'content')));
  assert.equal(context.capabilities.webSearch,true);
  assert.deepEqual(task,before,'building context must not rewrite the task');

  const boundary=taskFixture({feedbackCount:12,artifactCount:20});
  assert.equal(buildTaskContext(boundary).feedback.length,12);
  assert.equal(buildTaskContext(boundary).artifacts.length,20);
  delete boundary.memory;
  assert.deepEqual(buildTaskContext(boundary).pinnedRequirements,[]);
});

for(const protocol of ['responses','chat','anthropic']) {
  test(`${protocol} 请求体体检只保存元数据，字符、字节和 token 不混算`,()=>{
    const task=taskFixture({feedbackCount:13,artifactCount:21});
    task.apiKey=PRIVATE.key;
    const extra=protocol==='responses'
      ? [{type:'reasoning',encrypted_content:PRIVATE.encrypted,summary:[]},{type:'function_call_output',call_id:'call-1',output:PRIVATE.material}]
      : protocol==='anthropic'
        ? [{role:'assistant',content:[{type:'thinking',thinking:PRIVATE.thinking,signature:PRIVATE.signature}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call-1',content:PRIVATE.material}]}]
        : [{role:'assistant',content:null,reasoning_content:PRIVATE.thinking},{role:'tool',tool_call_id:'call-1',content:PRIVATE.material}];
    const body=requestBody(protocol,buildTaskContext(task),{extra});
    const record=inspectRequest(task,body,{runId:'run-1',requestId:'usage-1',callNumber:2});
    const wire=JSON.stringify(body),items=body.input||body.messages;
    assert.equal(record.protocol,protocol);
    assert.equal(record.id,'usage-1');
    assert.equal(record.runId,'run-1');
    assert.equal(record.callNumber,2);
    assert.equal(record.taskRevision,4);
    assert.equal(record.requestCharacters,wire.length);
    assert.equal(record.requestBytes,Buffer.byteLength(wire));
    assert.ok(record.requestBytes>record.requestCharacters,'Chinese text differs in UTF-8 byte length');
    assert.equal(record.inputItems,items.length);
    assert.equal(record.contextCharacters,JSON.stringify(items).length);
    assert.equal(record.toolsCharacters,JSON.stringify(body.tools).length);
    assert.ok(record.requestCharacters>record.contextCharacters,'wire also contains provider instructions and tools');
    assert.match(record.requestFingerprint,/^[a-f0-9]{64}$/);
    assert.ok(record.requirements.every(r=>r.status==='included'));
    assert.deepEqual(record.feedbackOmitted,[0]);
    assert.equal(record.feedbackIncluded.length,12);
    assert.deepEqual(record.artifactsOmitted,['artifact-0']);
    assert.deepEqual(record.materials,[{id:'material-1',characters:PRIVATE.material.length,indexed:true}]);
    assert.deepEqual(record.readStats,{readCharacters:0,uniqueCharacters:0,repeatedCharacters:0,localAnalyses:0});
    assert.ok(codes(record).includes('feedback-omitted'));
    assert.ok(codes(record).includes('artifact-index-omitted'));
    for(const forbidden of ['body','headers','input','messages','apiKey','reasoning','inputTokens','contextTokens']) assert.equal(Object.hasOwn(record,forbidden),false);
    noPrivateContent(record);
  });
}

test('要求从真实请求中消失才报告跨请求遗漏，要求自身变化不误报旧要求消失',()=>{
  const task=taskFixture(),context=buildTaskContext(task);
  const previous=inspectRequest(task,requestBody('responses',context),{runId:'run-1',requestId:'request-1'});
  const changed=structuredClone(context);
  delete changed.preferences;
  changed.pinnedRequirements=[];
  const record=inspectRequest(task,requestBody('responses',changed),{runId:'run-2',requestId:'request-2',previous});
  assert.deepEqual(record.requirements.filter(r=>r.status==='missing').map(r=>r.id),['preferences','memory:pin-1']);
  assert.deepEqual(record.findings.find(f=>f.code==='requirement-disappeared').requirementIds,['preferences','memory:pin-1']);
  assert.equal(record.findings.find(f=>f.code==='requirement-disappeared').previousRequestId,'request-1');

  const edited=structuredClone(task);edited.preferences='The user deliberately replaced this requirement';
  const editedRecord=inspectRequest(edited,requestBody('responses',changed),{runId:'run-3',previous});
  assert.ok(!editedRecord.findings.find(f=>f.code==='requirement-disappeared').requirementIds.includes('preferences'));

  const empty=taskFixture();empty.preferences='';empty.criteria='';empty.memory=[];
  const emptyRecord=inspectRequest(empty,requestBody('chat',buildTaskContext(empty)));
  assert.deepEqual(emptyRecord.requirements.filter(r=>r.status==='empty').map(r=>r.id),['preferences','criteria']);
  assert.ok(!codes(emptyRecord).includes('requirement-missing'));
});

test('第 13 条补充使原先带入的第 1 条退出起始上下文，并记录对应请求',()=>{
  const task=taskFixture({feedbackCount:12});
  const previous=inspectRequest(task,requestBody('chat',buildTaskContext(task)),{runId:'before',requestId:'before-request'});
  task.feedback.push({at:'feedback-time-12',text:`${PRIVATE.feedback}-12`});
  const next=inspectRequest(task,requestBody('chat',buildTaskContext(task)),{runId:'after',requestId:'after-request',previous});
  const finding=next.findings.find(f=>f.code==='feedback-disappeared');
  assert.deepEqual(finding.feedbackIndices,[0]);
  assert.equal(finding.previousRequestId,'before-request');
  assert.deepEqual(next.feedbackIncluded,Array.from({length:12},(_,i)=>i+1));
  noPrivateContent(next);
});

test('较早补充经同文固定要求带入后不再报遗漏；取消固定后才报告消失',()=>{
  const task=taskFixture({feedbackCount:13});
  const missing=inspectRequest(task,requestBody('chat',buildTaskContext(task)),{runId:'before',requestId:'before'});
  assert.ok(codes(missing).includes('feedback-omitted'));
  task.memory.push({id:'repair',text:task.feedback[0].text});
  const repaired=inspectRequest(task,requestBody('chat',buildTaskContext(task)),{runId:'fixed',requestId:'fixed',previous:missing});
  assert.deepEqual(repaired.feedbackOmitted,[0]);assert.deepEqual(repaired.feedbackPinned,[0]);
  assert.ok(!codes(repaired).includes('feedback-omitted'));assert.ok(!codes(repaired).includes('feedback-disappeared'));
  assert.ok(codes(repaired).includes('feedback-pinned'));
  task.memory.pop();
  const unpinned=inspectRequest(task,requestBody('chat',buildTaskContext(task)),{runId:'removed',previous:repaired});
  assert.ok(codes(unpinned).includes('feedback-omitted'));assert.ok(codes(unpinned).includes('feedback-disappeared'));
});

test('仅比较同一轮的显著请求增长，不把新轮或小幅变化报为上下文膨胀',()=>{
  const task=taskFixture(),body=requestBody('responses',buildTaskContext(task));
  const previous=inspectRequest(task,body,{runId:'run-1',requestId:'request-1'});
  const large=structuredClone(body);large.input.push({type:'function_call_output',call_id:'growth',output:'x'.repeat(12000)});
  assert.ok(codes(inspectRequest(task,large,{runId:'run-1',previous})).includes('context-growth'));
  assert.ok(!codes(inspectRequest(task,large,{runId:'run-2',previous})).includes('context-growth'));
  const small=structuredClone(body);small.input.push({type:'function_call_output',call_id:'small',output:'x'.repeat(100)});
  assert.ok(!codes(inspectRequest(task,small,{runId:'run-1',previous})).includes('context-growth'));
});

test('读取收据保留版本和内容指纹，重叠区间只在同文件同内容内合并',()=>{
  const material={id:'material-1',content:'a'.repeat(200)};
  const artifactV1={id:'artifact-v1',version:1,content:'b'.repeat(200)};
  const artifactV2={id:'artifact-v2',version:2,content:'b'.repeat(200)};
  const changedMaterial={id:'material-1',content:'c'.repeat(200)};
  const receipt=readReceipt(artifactV2,'artifact',0,100);
  assert.deepEqual(Object.keys(receipt).sort(),['end','fingerprint','id','kind','start','version']);
  assert.equal(receipt.version,2);
  assert.match(receipt.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(readReceipt(material,'material',0,100).version,null);
  assert.notEqual(readReceipt(material,'material').fingerprint,readReceipt(changedMaterial,'material').fingerprint);
  const reads=[
    readReceipt(material,'material',0,100),readReceipt(material,'material',50,150),
    readReceipt(material,'material',100,120),readReceipt(artifactV1,'artifact',0,100),receipt,
    readReceipt(changedMaterial,'material',0,50)
  ];
  assert.deepEqual(summarizeReads(reads),{readCharacters:470,uniqueCharacters:400,repeatedCharacters:70,localAnalyses:0});
  assert.deepEqual(summarizeReads([
    readReceipt(material,'material',-1,10),readReceipt(material,'material',10,1),
    readReceipt(material,'material',0.5,10),readReceipt(material,'unsupported',0,100)
  ]),{readCharacters:0,uniqueCharacters:0,repeatedCharacters:0,localAnalyses:0});
});

test('CSV 全文在本地分析不算模型正文阅读，新轮不会沿用旧轮读取量',()=>{
  const task=taskFixture(),material=task.materials[0];
  const analysis=readReceipt(material,'analysis',0,material.content.length);
  assert.deepEqual(summarizeReads([analysis]),{readCharacters:0,uniqueCharacters:0,repeatedCharacters:0,localAnalyses:1});
  const read=readReceipt(material,'material',0,10);
  const previous=inspectRequest(task,requestBody('chat',buildTaskContext(task)),{runId:'run-1',reads:[analysis,read,read]});
  assert.equal(previous.readStats.repeatedCharacters,10);
  assert.ok(codes(previous).includes('repeated-read'));
  const next=inspectRequest(task,requestBody('chat',buildTaskContext(task)),{runId:'run-2',previous});
  assert.deepEqual(next.readStats,{readCharacters:0,uniqueCharacters:0,repeatedCharacters:0,localAnalyses:0});
  assert.ok(!codes(next).includes('repeated-read'));
  assert.equal(next.materials[0].indexed,true);
});

test('体检对请求和读取收据只读，不让调用方修改已创建的诊断',()=>{
  const task=taskFixture(),body=requestBody('anthropic',buildTaskContext(task));
  const reads=[readReceipt(task.materials[0],'material',0,10)];
  const beforeTask=structuredClone(task),beforeBody=structuredClone(body),beforeReads=structuredClone(reads);
  const record=inspectRequest(task,body,{runId:'run-1',reads});
  assert.deepEqual(task,beforeTask);assert.deepEqual(body,beforeBody);assert.deepEqual(reads,beforeReads);
  reads[0].end=20;
  assert.equal(record.reads[0].end,10);
});

test('体检记录最多保留 120 条，并累计记录确切丢弃数量',()=>{
  assert.equal(CONTEXT_RECORD_LIMIT,120);
  const task=taskFixture();
  for(let i=0;i<125;i++)appendContextRecord(task,{id:`record-${i}`});
  assert.equal(task.contextRecords.length,120);
  assert.equal(task.contextRecords[0].id,'record-5');
  assert.equal(task.contextRecords.at(-1).id,'record-124');
  assert.equal(task.contextRecordsDiscarded,5);
  appendContextRecord(task,{id:'record-125'});
  assert.equal(task.contextRecords[0].id,'record-6');
  assert.equal(task.contextRecordsDiscarded,6);
});

test('报告关联实际请求用量，历史缺失保持未知，不把缓存推理额外加入 token',()=>{
  const task=taskFixture(),body=requestBody('responses',buildTaskContext(task));
  const make=id=>inspectRequest(task,body,{runId:'run-1',requestId:id});
  task.contextRecords=[make('actual'),make('partial'),make('pending'),make('no-usage'),make('zero')];
  task.usage=[
    {id:'actual',status:'returned',input:80,output:20,cached:40,reasoning:8},
    {id:'partial',status:'returned-error',input:10,output:null},
    {id:'pending',status:'pending',input:null,output:null},
    {id:'zero',status:'returned',input:0,output:0},
    {id:'legacy-no-record',status:'returned',input:11,output:3}
  ];
  task.contextRecordsDiscarded=2;
  task.contextReviews=[{id:'review-1',requestId:'actual',requirementId:'memory:pin-1',artifactId:'artifact-1',at:'review-time',text:PRIVATE.feedback}];
  const preflight=make('preview'),config={configured:true,apiKey:PRIVATE.key};
  const report=reportContext(task,preflight,config);
  assert.equal(report.extraModelCalls,0);
  assert.equal(report.providerConfigured,true);
  assert.equal(report.unrecordedRequests,1);
  assert.equal(report.discardedRecords,2);
  assert.equal(report.preflight.mode,'preview');
  assert.match(report.preflight.warning,/尚未发送/);
  assert.deepEqual(report.records.map(r=>[r.id,r.status,r.inputTokens,r.outputTokens]),[
    ['actual','returned',80,20],['partial','returned-error',10,null],
    ['pending','pending',null,null],['no-usage','unknown',null,null],['zero','returned',0,0]
  ]);
  assert.equal(report.limits.modelContextWindowKnown,false);
  assert.match(report.limits.characterUnit,/not tokens/);
  assert.equal(report.reviews[0].verdict,'user-reported-not-followed');
  assert.equal(Object.hasOwn(report.reviews[0],'text'),false);
  assert.equal(Object.hasOwn(preflight,'mode'),false,'report must not mutate the preflight');
  noPrivateContent(report);
});

test('旧任务没有体检记录时仍能导出报告，不根据历史 token 伪造上下文',()=>{
  const task=taskFixture();
  task.usage=[{id:'legacy',status:'returned',input:9000,output:100}];
  const preflight=inspectRequest(task,requestBody('chat',buildTaskContext(task)));
  const report=reportContext(task,preflight,{configured:false});
  assert.deepEqual(report.records,[]);
  assert.equal(report.unrecordedRequests,1);
  assert.equal(report.discardedRecords,0);
  assert.equal(report.providerConfigured,false);
  assert.deepEqual(report.reviews,[]);
  assert.equal(report.extraModelCalls,0);
  noPrivateContent(report);
});
