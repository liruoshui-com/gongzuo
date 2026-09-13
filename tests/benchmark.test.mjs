import test from 'node:test';
import assert from 'node:assert/strict';
import {SpendGuard,aggregate,fullContext,prepareHistory,comparePairs,runBenchmark} from '../benchmarks/run.mjs';
import {buildTaskContext} from '../lib/context-health.mjs';
import {fixtures,makeTask} from '../benchmarks/fixtures.mjs';

test('费用预留在发送前停止，未知用量后不允许下一次付费调用',()=>{
  const body={max_tokens:4096,messages:[{role:'user',content:'fixture'}]};
  const tiny=new SpendGuard(.001,40);assert.throws(()=>tiny.reserve(body),/上限/);assert.equal(tiny.requests,0);
  const cap=new SpendGuard(4.95,1),reserve=cap.reserve(body);cap.settle(reserve,{input:100,output:20});assert.equal(cap.requests,1);assert.ok(Math.abs(cap.reservedCny-(100*2+20*8)/1e6)<1e-12);assert.throws(()=>cap.reserve(body),/上限/);
  const unknown=new SpendGuard(4.95,40),pending=unknown.reserve(body);unknown.settle(pending,null);assert.equal(unknown.unknown,true);assert.throws(()=>unknown.reserve(body),/未知/);assert.equal(unknown.requests,1);
});
test('所有真实尝试都计入总量，未知不补零，缓存和推理不重复相加',()=>{
  const rows=[{at:'2026-09-13T08:00:00Z',usage:{input:100,output:20,cached:40,reasoning:8}},{at:'2026-09-13T08:01:00Z',usage:{input:200,output:30,cached:0}}];
  assert.equal(aggregate(rows).totalTokens,350);assert.equal(aggregate(rows).cachedTokens,40);
  assert.ok(Math.abs(aggregate(rows).estimatedCny-((260+40*.02+50*4)/1e6))<1e-10);
  const incomplete=aggregate([...rows,{usage:null}]);assert.equal(incomplete.totalTokens,null);assert.equal(incomplete.knownInputTokens,300);assert.equal(incomplete.unknownUsageRequests,1);assert.equal(incomplete.estimatedCny,null);
  const partial=aggregate([{usage:{input:120,output:null}}]);assert.equal(partial.inputTokens,120);assert.equal(partial.outputTokens,null);assert.equal(partial.knownInputTokens,120);assert.equal(partial.totalTokens,null);
});
test('两组仅改变材料与已有成果正文，目标、固定要求、历史和工具能力一致',()=>{
  assert.equal(fixtures.length,3);
  for(const f of fixtures){const t=makeTask(f,f.id),thin=buildTaskContext(t),full=fullContext(t);assert.ok(full.materials.every(m=>typeof m.untrustedContent==='string'));
    full.materials=full.materials.map(({untrustedContent,...m})=>m);full.artifacts=full.artifacts.map(({untrustedContent,...a})=>a);assert.deepEqual(full,thin);}
});

test('补跑累计旧请求且不重复计费，未知用量在索取密钥和发送前拒绝',async()=>{
  const a={id:1,at:'2026-09-13T08:00:00Z',usage:{input:100,output:20,cached:40}};
  const b={id:2,at:'2026-09-13T08:01:00Z',usage:{input:200,output:30,cached:0}};
  const prior={priorRequests:[a],setupRequests:[a],requests:[b],total:{requests:2,unknownUsageRequests:0},runs:[]};
  const history=prepareHistory(prior);assert.equal(history.priorRequests.length,2);assert.equal(history.unknown,false);
  assert.ok(Math.abs(history.conservativePriorCny-.001)<1e-12);assert.equal(history.previousExperiments.length,1);
  const bad={requests:[{...a,usage:{input:100,output:null}}]};
  await assert.rejects(runBenchmark({live:true,priorReport:bad,maxCny:4}),/unknown/);
  await assert.rejects(runBenchmark({live:true,priorReport:prior,maxCny:5}),/exceeds/);
  assert.throws(()=>prepareHistory({priorRequests:[a],requests:[{...a,usage:{input:101,output:20}}]}),/Conflicting/);
});

test('成果自动通过但运行达到轮次限制，不记为合格流程节省',()=>{
  const phases=['initial','revision'].map(phase=>({phase,status:'review',quality:{automatedPassed:true}}));
  const full={fixtureId:'x',condition:'full-context',phases,usage:{totalTokens:1000},executionSeconds:20};
  const demand={fixtureId:'x',condition:'on-demand',phases:[phases[0],{...phases[1],status:'blocked'}],usage:{totalTokens:900},executionSeconds:19};
  const pair=comparePairs([full,demand])[0];assert.equal(pair.phasesMatched,true);assert.equal(pair.automatedQualityMatched,true);assert.equal(pair.workflowCompleted,false);assert.equal(pair.comparisonScope,'budget-limited-resource-difference');assert.equal(pair.qualityConfirmed,false);
});
