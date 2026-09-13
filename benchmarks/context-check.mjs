import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

// Only synthetic inputs are constructed below. This runner does not load server.mjs,
// engine.mjs, credentials, environment variables, task history, or requestModel.
const operations = new Set([
  'complete','omit-goal','omit-preferences','omit-criteria','omit-pinned',
  'preference-trailing-space','criteria-normalization','feedback-13',
  'feedback-13-exact-pin','feedback-13-near-pin','artifacts-21',
  'overlap-material','adjacent-material','artifact-versions',
  'analysis-summary','material-slice','legacy-unknown'
]);
const fixtureMarker='SYNTHETIC_BODY_ONLY_';
const instructions=fixtureMarker+'INSTRUCTIONS_只执行合成结构测试😀';
const toolDefinitions=[{
  name:'read_material',description:fixtureMarker+'TOOL_DESCRIPTION',
  parameters:{type:'object',properties:{id:{type:'string'},offset:{type:'integer'},length:{type:'integer'}},required:['id','offset','length'],additionalProperties:false}
}];

function makeTask(feedbackCount=2,artifactCount=2) {
  return {
    id:'synthetic-task',revision:1,
    goal:fixtureMarker+'GOAL_完成一个可复核任务😀',
    preferences:fixtureMarker+'PREFERENCES_保留个人选择',
    criteria:fixtureMarker+'CRITERIA_café',
    memory:[{id:'pin-main',text:fixtureMarker+'PIN_保留原始记录'}],
    feedback:Array.from({length:feedbackCount},(_,i)=>({at:`synthetic-time-${i}`,text:fixtureMarker+`FEEDBACK_${i}_人工要求`})),
    plan:[],materials:[{id:'material-1',name:'synthetic-input.txt',content:fixtureMarker+'MATERIAL_abcdefghijklmnopqrstuvwxyz_原始正文'}],
    artifacts:Array.from({length:artifactCount},(_,i)=>({id:`artifact-${i}`,name:'synthetic-output.txt',version:i+1,content:fixtureMarker+'ARTIFACT_same-content-across-versions'})),
    usage:[]
  };
}

function makeToolHistory(protocol,outputs) {
  return outputs.flatMap((output,index)=>{
    const callId=`synthetic-tool-${index}`;
    if(protocol==='responses')return [
      {type:'function_call',call_id:callId,name:'read_material',arguments:'{}'},
      {type:'function_call_output',call_id:callId,output:JSON.stringify(output)}
    ];
    if(protocol==='anthropic')return [
      {role:'assistant',content:[{type:'tool_use',id:callId,name:'read_material',input:{}}]},
      {role:'user',content:[{type:'tool_result',tool_use_id:callId,content:JSON.stringify(output)}]}
    ];
    return [
      {role:'assistant',content:null,tool_calls:[{id:callId,type:'function',function:{name:'read_material',arguments:'{}'}}]},
      {role:'tool',tool_call_id:callId,content:JSON.stringify(output)}
    ];
  });
}

function instantiate(definition,protocol,health,buildRequestBody) {
  const operation=definition.operation;
  const feedbackCount=operation.startsWith('feedback-13')?13:2;
  const task=makeTask(feedbackCount,operation==='artifacts-21'?21:2);
  if(operation==='feedback-13-exact-pin'||operation==='feedback-13-near-pin') {
    task.memory.push({id:'pin-recovery',text:task.feedback[0].text+(operation==='feedback-13-near-pin'?' ':'')});
  }
  const context=health.buildTaskContext(task),reads=[],outputs=[];
  if(operation.startsWith('omit-')) {
    const field=operation.slice(5);
    if(field==='pinned')context.pinnedRequirements=[];
    else delete context[field];
  }
  if(operation==='preference-trailing-space')context.preferences+=' ';
  if(operation==='criteria-normalization')context.criteria=context.criteria.normalize('NFD');
  const read=(item,kind,start,end)=>{
    reads.push(health.readReceipt(item,kind,start,end));
    outputs.push({untrustedContent:item.content.slice(start,end),totalCharacters:item.content.length,nextOffset:end});
  };
  if(operation==='overlap-material'){read(task.materials[0],'material',0,10);read(task.materials[0],'material',5,15);}
  if(operation==='adjacent-material'){read(task.materials[0],'material',0,10);read(task.materials[0],'material',10,20);}
  if(operation==='artifact-versions'){read(task.artifacts[0],'artifact',0,10);read(task.artifacts[1],'artifact',0,10);}
  if(operation==='material-slice')read(task.materials[0],'material',0,8);
  if(operation==='analysis-summary'){
    reads.push(health.readReceipt(task.materials[0],'analysis'));
    outputs.push({facts:{rows:4,groups:2},artifacts:[{id:'derived-summary',version:1}]});
  }
  if(operation==='legacy-unknown')task.usage.push({id:'legacy-request',status:'unknown',input:null,output:null});
  const body=buildRequestBody({
    provider:protocol,model:'synthetic-structure-model',baseUrl:'https://benchmark.invalid/v1',
    maxOutputTokens:1024,webSearch:false
  },{
    input:[{role:'user',content:JSON.stringify(context)},...makeToolHistory(protocol,outputs)],
    tools:toolDefinitions,instructions
  });
  const record=health.inspectRequest(task,body,{
    runId:'synthetic-run',requestId:'synthetic-preflight',callNumber:1,reads
  });
  const report=health.reportContext(task,record,{configured:false});
  return {record,report,wire:JSON.stringify(body)};
}

function detectedLabels(record) {
  const found=new Set();
  for(const finding of record.findings){
    if(finding.code==='requirement-missing')found.add(finding.requirementId.startsWith('memory:')?'missing:pinned':`missing:${finding.requirementId}`);
    else if(finding.code==='feedback-omitted')found.add('feedback-uncovered');
    else if(finding.code==='artifact-index-omitted'||finding.code==='repeated-read')found.add(finding.code);
  }
  return [...found].sort();
}

function measuredCounts(record,report) {
  const last=report.records.at(-1);
  return {
    requirementIncluded:record.requirements.filter(r=>r.status==='included').length,
    requirementMissing:record.requirements.filter(r=>r.status==='missing').length,
    feedbackIncluded:record.feedbackIncluded.length,feedbackOmitted:record.feedbackOmitted.length,
    feedbackPinned:record.feedbackPinned.length,
    feedbackUncovered:record.feedbackOmitted.filter(i=>!record.feedbackPinned.includes(i)).length,
    artifactsIndexed:record.artifactsIndexed.length,artifactsOmitted:record.artifactsOmitted.length,
    materialsIndexed:record.materials.filter(m=>m.indexed).length,
    ...record.readStats,
    materialReceipts:record.reads.filter(r=>r.kind==='material').length,
    artifactReceipts:record.reads.filter(r=>r.kind==='artifact').length,
    artifactVersions:record.reads.filter(r=>r.kind==='artifact').map(r=>r.version).sort((a,b)=>a-b),
    legacyUnrecorded:report.unrecordedRequests,historicalRecords:report.records.length,
    historicalInputTokens:last?.inputTokens??null,historicalOutputTokens:last?.outputTokens??null
  };
}

function validateAnnotations(data) {
  if(data.schemaVersion!==1||!Array.isArray(data.cases)||!data.cases.length)throw new Error('Invalid benchmark annotation file.');
  if(!isDeepStrictEqual(data.protocols,['responses','chat','anthropic']))throw new Error('Benchmark protocols must explicitly cover all three adapters.');
  if(!Array.isArray(data.labelUniverse)||new Set(data.labelUniverse).size!==data.labelUniverse.length)throw new Error('Invalid detection label universe.');
  const ids=new Set();
  for(const row of data.cases){
    if(typeof row.id!=='string'||ids.has(row.id)||!operations.has(row.operation))throw new Error('Invalid or duplicate benchmark case.');
    ids.add(row.id);
    if(!Array.isArray(row.expectedLabels)||row.expectedLabels.some(label=>!data.labelUniverse.includes(label)))throw new Error('Unexpected manually annotated detection label.');
    for(const key of Object.keys(row.expected||{}))if(!Object.hasOwn(data.baselineExpected,key))throw new Error('Unknown annotated count.');
  }
}

const rate=(numerator,denominator)=>denominator===0?null:numerator/denominator;

/** Run synthetic, zero-model structural checks against modules under process.cwd(). */
export async function runContextBenchmark({out}={}) {
  const projectRoot=process.cwd();
  const [health,{buildRequestBody},rawCases]=await Promise.all([
    import(pathToFileURL(resolve(projectRoot,'lib/context-health.mjs')).href),
    import(pathToFileURL(resolve(projectRoot,'lib/provider.mjs')).href),
    readFile(new URL('./context-cases.json',import.meta.url),'utf8')
  ]);
  const annotations=JSON.parse(rawCases);validateAnnotations(annotations);
  const rows=[];
  let truePositive=0,falsePositive=0,falseNegative=0,trueNegative=0;
  for(const definition of annotations.cases)for(const protocol of annotations.protocols){
    const {record,report,wire}=instantiate(definition,protocol,health,buildRequestBody);
    const expectedLabels=[...definition.expectedLabels].sort(),actualLabels=detectedLabels(record);
    const expectedCounts={...annotations.baselineExpected,...definition.expected},actualCounts=measuredCounts(record,report);
    const expectedSet=new Set(expectedLabels),actualSet=new Set(actualLabels);
    const labelUniverse=new Set([...annotations.labelUniverse,...actualLabels]);
    for(const label of labelUniverse){
      if(expectedSet.has(label)&&actualSet.has(label))truePositive++;
      else if(!expectedSet.has(label)&&actualSet.has(label))falsePositive++;
      else if(expectedSet.has(label))falseNegative++;
      else trueNegative++;
    }
    const countMismatches=Object.keys(expectedCounts).filter(key=>!isDeepStrictEqual(expectedCounts[key],actualCounts[key]));
    const expectedSizes={requestCharacters:wire.length,requestBytes:Buffer.byteLength(wire)};
    const actualSizes={requestCharacters:record.requestCharacters,requestBytes:record.requestBytes};
    const noBodyInMetadata=!JSON.stringify({record,report}).includes(fixtureMarker);
    const passed=isDeepStrictEqual(expectedLabels,actualLabels)&&countMismatches.length===0&&isDeepStrictEqual(expectedSizes,actualSizes)&&noBodyInMetadata&&record.protocol===protocol;
    rows.push({
      caseId:definition.id,protocol,passed,
      expected:{labels:expectedLabels,counts:expectedCounts,...expectedSizes},
      actual:{labels:actualLabels,counts:actualCounts,...actualSizes},
      checks:{countMismatches,protocolMatches:record.protocol===protocol,noBodyInMetadata}
    });
  }
  const result={
    schemaVersion:1,benchmark:'context-structure-check',
    methodology:{
      data:`${annotations.cases.length} explicitly labeled synthetic scenarios, expanded into ${annotations.protocols.length} protocol variants each. No user data is read.`,
      annotation:annotations.annotationMethod,
      metric:`Micro precision and recall over ${annotations.labelUniverse.length} structural finding labels. Protocol variants are related samples, not independent tasks.`,
      limitation:'Synthetic structural detection only. These results do not measure model forgetting, comprehension, output quality, task success, or token savings.',
      units:'Request characters use JavaScript UTF-16 length; request bytes use UTF-8. Neither is a token estimate.',
      network:'No requestModel invocation, fetch, external API, credential lookup, or model inference.'
    },
    summary:{
      semanticCases:annotations.cases.length,protocols:annotations.protocols.length,caseVariants:rows.length,
      passed:rows.filter(row=>row.passed).length,failed:rows.filter(row=>!row.passed).length,
      modelCalls:0,apiRequests:0,
      truePositive,falsePositive,falseNegative,trueNegative,
      precision:rate(truePositive,truePositive+falsePositive),recall:rate(truePositive,truePositive+falseNegative)
    },
    cases:rows
  };
  if(JSON.stringify(result).includes(fixtureMarker))throw new Error('Benchmark output must not contain synthetic body content.');
  if(out!==undefined){const target=out instanceof URL?fileURLToPath(out):resolve(String(out));await mkdir(dirname(target),{recursive:true});await writeFile(target,JSON.stringify(result,null,2)+'\n','utf8');}
  return result;
}

async function main() {
  const args=process.argv.slice(2);let out;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--help'){process.stdout.write('Usage: node context-check.mjs [--out results.json]\nRun from the project root. No models or credentials are used.\n');return;}
    if(args[i]!=='--out'||out!==undefined||!args[i+1])throw new Error('Expected an optional --out JSON file path.');
    out=args[++i];
  }
  const result=await runContextBenchmark({out});
  process.stdout.write(JSON.stringify(result.summary,null,2)+'\n');
  if(result.summary.failed)process.exitCode=1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
  process.stderr.write('Context benchmark failed before completion. Check the project root, annotation file and output path.\n');
  process.exitCode=1;
});
