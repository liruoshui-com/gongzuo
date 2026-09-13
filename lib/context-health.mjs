import {createHash} from 'node:crypto';

export const CONTEXT_RECORD_LIMIT = 120;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const size = value => JSON.stringify(value ?? null).length;

// The preflight and live execution use this exact same context builder.
export function buildTaskContext(task, webSearch = false) {
  return {
    goal: task.goal,
    preferences: task.preferences,
    criteria: task.criteria,
    pinnedRequirements: (task.memory || []).map(({id, text}) => ({id, text})),
    feedback: task.feedback.slice(-12),
    plan: task.plan,
    materials: task.materials.map(m => ({id:m.id, name:m.name, characters:m.content.length})),
    artifacts: task.artifacts.slice(-20).map(a => ({id:a.id, name:a.name, version:a.version, characters:a.content.length})),
    capabilities: {webSearch, formats:['txt','md','csv','json','html','svg']}
  };
}

function sentContext(body) {
  const first = (body.input || body.messages || []).find(x => x.role === 'user');
  if (typeof first?.content !== 'string') return {};
  try { const parsed=JSON.parse(first.content); return parsed && typeof parsed==='object' && !Array.isArray(parsed)?parsed:{}; } catch { return {}; }
}

// Store IDs, hashes, counts and ranges. Never persist body, headers or reasoning.
export function inspectRequest(task, body, {runId, requestId, callNumber, reads = [], previous} = {}) {
  const sent = sentContext(body), wire = JSON.stringify(body);
  const anchors = ['goal','preferences','criteria'].map(id => ({id, kind:id, text:task[id] || '', sent:sent[id]}));
  for (const m of task.memory || []) anchors.push({id:'memory:'+m.id, kind:'memory', text:m.text, sent:sent.pinnedRequirements?.find(x=>x.id===m.id)?.text});
  const requirements = anchors.map(a => ({id:a.id, kind:a.kind, fingerprint:hash(a.text), characters:a.text.length, status:!a.text?'empty':a.sent===a.text?'included':'missing'}));
  const feedback = task.feedback.map((f,index) => ({index, included:(sent.feedback || []).some(x=>x.at===f.at && x.text===f.text)}));
  const feedbackPinned=feedback.filter(f=>!f.included && (sent.pinnedRequirements || []).some(m=>m.text===task.feedback[f.index].text)).map(f=>f.index);
  const items = body.input || body.messages || [];
  const result = {
    schemaVersion:1, id:requestId || null, runId:runId || null, callNumber:callNumber || 1,
    at:new Date().toISOString(), taskRevision:task.revision, protocol:body.input?'responses':body.system?'anthropic':'chat',
    model:body.model, requestFingerprint:hash(wire), requestCharacters:wire.length,
    requestBytes:Buffer.byteLength(wire), inputItems:items.length,
    toolsCharacters:size(body.tools), contextCharacters:size(items),
    requirements, feedbackTotal:task.feedback.length,
    feedbackIncluded:feedback.filter(f=>f.included).map(f=>f.index),
    feedbackOmitted:feedback.filter(f=>!f.included).map(f=>f.index),
    feedbackPinned,
    artifactsIndexed:(sent.artifacts || []).map(a=>a.id),
    artifactsOmitted:task.artifacts.filter(a=>!(sent.artifacts || []).some(x=>x.id===a.id)).map(a=>a.id),
    materials:task.materials.map(m=>({id:m.id, characters:m.content.length, indexed:(sent.materials || []).some(x=>x.id===m.id)})),
    reads:structuredClone(reads), findings:[]
  };
  for (const r of requirements.filter(r=>r.status==='missing')) result.findings.push({code:'requirement-missing',level:'warning',requirementId:r.id,message:'这项要求没有完整进入本次起始任务信息。'});
  const uncoveredFeedback=result.feedbackOmitted.filter(i=>!feedbackPinned.includes(i));
  if(uncoveredFeedback.length)result.findings.push({code:'feedback-omitted',level:'warning',message:`${uncoveredFeedback.length} 条较早补充未进入本次起始任务信息；补充列表只带最近 12 条。`});
  if(feedbackPinned.length)result.findings.push({code:'feedback-pinned',level:'info',message:`${feedbackPinned.length} 条较早补充已通过同文固定要求带入。`});
  if(result.artifactsOmitted.length)result.findings.push({code:'artifact-index-omitted',level:'info',message:`${result.artifactsOmitted.length} 个较早成果没有进入起始目录；当前只列最近 20 个。`});
  if(previous){
    const lost = requirements.filter(r=>r.status==='missing' && previous.requirements.some(p=>p.id===r.id && p.fingerprint===r.fingerprint && p.status==='included'));
    if(lost.length)result.findings.push({code:'requirement-disappeared',level:'warning',previousRequestId:previous.id,requirementIds:lost.map(r=>r.id),message:'有要求在上次记录中包含，本次未包含。这里只证明输入发生变化。'});
    const feedbackLost = uncoveredFeedback.filter(i=>previous.feedbackIncluded.includes(i) || previous.feedbackPinned?.includes(i));
    if(feedbackLost.length)result.findings.push({code:'feedback-disappeared',level:'warning',previousRequestId:previous.id,feedbackIndices:feedbackLost,message:`第 ${feedbackLost.map(i=>i+1).join('、')} 条补充在上次记录中包含，本次起始信息未包含。`});
    if(previous.runId===runId && wire.length >= previous.requestCharacters*2 && wire.length-previous.requestCharacters>4000)result.findings.push({code:'context-growth',level:'info',message:`请求字符数较上次增加 ${wire.length-previous.requestCharacters}；建议检查新增工具结果和成果内容是否必要。`});
  }
  const readStats = summarizeReads(result.reads);
  if(readStats.repeatedCharacters)result.findings.push({code:'repeated-read',level:'info',message:`本轮成功读取中有 ${readStats.repeatedCharacters} 个重叠字符，可能属于合理复核，不等同于浪费的 token。`});
  result.readStats=readStats;
  return result;
}

export function summarizeReads(reads) {
  const groups=new Map(); let readCharacters=0, uniqueCharacters=0, localAnalyses=0;
  for(const r of reads){
    if(r.kind==='analysis'){localAnalyses++;continue;}
    if(r.kind!=='material' && r.kind!=='artifact')continue;
    const key=`${r.kind}:${r.id}:${r.fingerprint}`;
    if(!groups.has(key))groups.set(key,[]);
    const start=r.start, end=r.end;
    if(!Number.isInteger(start)||!Number.isInteger(end)||end<start||start<0)continue;
    readCharacters+=end-start;groups.get(key).push([start,end]);
  }
  for(const ranges of groups.values()){
    ranges.sort((a,b)=>a[0]-b[0]);let start=0,end=0;
    for(const [a,b] of ranges){if(a>end){uniqueCharacters+=end-start;start=a;end=b;}else end=Math.max(end,b);}
    uniqueCharacters+=end-start;
  }
  return {readCharacters,uniqueCharacters,repeatedCharacters:readCharacters-uniqueCharacters,localAnalyses};
}

export function readReceipt(item, kind, start=0, end=0) {
  return {id:item.id,kind,fingerprint:hash(item.content),start,end,version:item.version || null};
}

export function appendContextRecord(task, record) {
  task.contextRecords ??= [];task.contextRecords.push(record);
  if(task.contextRecords.length>CONTEXT_RECORD_LIMIT){const removed=task.contextRecords.length-CONTEXT_RECORD_LIMIT;task.contextRecords.splice(0,removed);task.contextRecordsDiscarded=(task.contextRecordsDiscarded || 0)+removed;}
}

export function reportContext(task, preflight, config) {
  const records=task.contextRecords || [];
  return {
    schemaVersion:1, generatedAt:new Date().toISOString(), taskId:task.id,
    scope:'Local request metadata only. Inclusion does not prove comprehension or compliance.',
    extraModelCalls:0, providerConfigured:config.configured,
    preflight:{...preflight,mode:'preview',warning:'按当前任务和配置预检下一轮首个请求，尚未发送；执行后可能变化。'},
    records:records.map(r=>{
      const u=task.usage.find(u=>u.id===r.id);
      return {...r,status:u?.status || 'unknown',inputTokens:u?.input ?? null,outputTokens:u?.output ?? null};
    }),
    unrecordedRequests:task.usage.filter(u=>!records.some(r=>r.id===u.id)).length,
    discardedRecords:task.contextRecordsDiscarded || 0,
    reviews:(task.contextReviews || []).map(({id,requestId,requirementId,artifactId,at})=>({id,requestId,requirementId,artifactId,at,verdict:'user-reported-not-followed'})),
    limits:{recordLimit:CONTEXT_RECORD_LIMIT,characterUnit:'JavaScript UTF-16 string length, not tokens',modelContextWindowKnown:false},
    continuity:'每次继续执行都会重建任务信息；前轮模型回复、工具结果和材料片段不会自动续接。目录不等于正文。'
  };
}
