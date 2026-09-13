// An explicit key arrives only through a non-echoing pipe, never argv or config discovery.
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
console.log('KEY_INPUT_READY (input is not echoed)');
const key=await new Promise((resolve,reject)=>{let value='';process.stdin.setEncoding('utf8');const take=chunk=>{value+=chunk;if(value.length>4096){reject(new Error('Key input too long'));return;}if(/[\r\n]/.test(value)){process.stdin.removeListener('data',take);process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);resolve(value.trim());}};process.stdin.on('data',take);process.stdin.once('end',()=>reject(new Error('No explicit key supplied')));});
if(!key||key.length>4096||/[\r\n]/.test(key))throw new Error('Invalid key input');
const started=Date.now();let report;
try{
  const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'Call connection_check exactly once with an empty object.'}],tools:[{type:'function',function:{name:'connection_check',description:'Verify tool protocol only.',parameters:{type:'object',properties:{},additionalProperties:false}}}],tool_choice:{type:'function',function:{name:'connection_check'}},thinking:{type:'disabled'},max_tokens:128,stream:false})});
  if(!r.ok){await r.body?.cancel();report={status:'http-error',httpStatus:r.status,inputTokens:null,outputTokens:null,toolProtocol:false};}
  else{const data=await r.json(),u=data.usage||{};report={status:'returned',httpStatus:r.status,model:data.model,inputTokens:u.prompt_tokens??null,outputTokens:u.completion_tokens??null,cachedTokens:u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens??null,toolProtocol:data.choices?.[0]?.message?.tool_calls?.some(c=>c.function?.name==='connection_check'&&c.function.arguments?.trim()==='{}')===true};}
}catch{report={status:'network-error',httpStatus:null,inputTokens:null,outputTokens:null,toolProtocol:false};}
Object.assign(report,{provider:'DeepSeek official',endpoint:'https://api.deepseek.com/chat/completions',at:new Date().toISOString(),durationMs:Date.now()-started,requests:1,outputLimit:128,thinking:'disabled',containsCredential:false});
const out=resolve(process.argv[2]||'test-results/deepseek-probe.json');await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(!report.toolProtocol)process.exitCode=1;
