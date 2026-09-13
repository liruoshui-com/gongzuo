import http from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore} from './lib/store.mjs';
import {defaults,validateConfig,publicConfig,requestModel} from './lib/provider.mjs';
import {createEngine,identifier,stamp,log,deliver} from './lib/engine.mjs';
import {analyzeCSV} from './lib/csv.mjs';
import {previewHTML,standaloneHTML} from './lib/preview.mjs';

const root=fileURLToPath(new URL('./dist/',import.meta.url));
let port=Number(process.env.PORT || 4318);
const dataRoot=resolve(process.env.WORKBENCH_DATA_DIR || fileURLToPath(new URL('./.local-data/',import.meta.url)));
await mkdir(dataRoot,{recursive:true});
const configPath=join(dataRoot,'config.json'); let config=structuredClone(defaults);
try {config={...defaults,...JSON.parse(await readFile(configPath,'utf8'))};}catch(e){if(e.code!=='ENOENT') throw new Error('模型配置文件无法读取；未覆盖原配置。');}
const store=await createStore(dataRoot), engine=createEngine(store,()=>config);
let configQueue=Promise.resolve();
let testingConnection=false;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) throw new Error('请求需要 JSON 格式。');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2_000_000) throw new Error('请求超过 2 MB。');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
function text(value,max,label){if(typeof value!=='string'||value.length>max) throw new Error(`${label}格式或长度无效。`);return value;}
function taskIn(s,id){const t=s.tasks.find(t=>t.id===id);if(!t) throw new Error('任务不存在。');return t;}
function editable(t,b){if(engine.isActive(t.id)) throw new Error('任务执行中，请先停止再修改。');if(b.revision!==t.revision) throw new Error('任务已在另一处更新，请刷新后再保存。');t.revision++;}
function addMaterials(t,materials){if(!Array.isArray(materials)||materials.length+t.materials.length>20) throw new Error('每个任务最多 20 份材料。');for(const m of materials){const name=text(m.name,120,'文件名'),content=text(m.content,200000,'材料');if(!/\.(txt|md|csv|json)$/i.test(name)) throw new Error('目前支持 TXT、Markdown、CSV、JSON 文本材料。');t.materials.push({id:identifier(),name,content,createdAt:stamp()});}if(t.materials.reduce((n,m)=>n+m.content.length,0)>600000) throw new Error('每个任务的材料总量最多 600,000 字符。');}
const list=()=>store.read().tasks.map(t=>engine.view(t)).map(t=>({id:t.id,title:t.title,status:t.status,updatedAt:t.updatedAt,artifactCount:t.artifacts.length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));

const server=http.createServer(async(req,res)=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){json(res,403,{error:'Host 不允许。'});return;}
  const origin=req.headers.origin;
  if((origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin)) || req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'仅允许本地工作区访问。'});return;}
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`),path=decodeURIComponent(url.pathname);
    if(path.startsWith('/api/')){
      if(req.method==='GET' && path==='/api/config'){json(res,200,publicConfig(config));return;}
      if(req.method==='GET' && path==='/api/connection-usage'){json(res,200,store.read().connectionTests||[]);return;}
      if(req.method==='PUT' && path==='/api/config'){
        const b=await body(req),job=configQueue.then(async()=>{const next=validateConfig(b,config);await writeFile(configPath+'.tmp',JSON.stringify(next),{mode:0o600});await rename(configPath+'.tmp',configPath);config=next;});configQueue=job.catch(()=>{});await job;json(res,200,publicConfig(config));return;
      }
      if(req.method==='POST' && path==='/api/config/test'){
        await body(req);if(testingConnection)throw new Error('连接测试正在进行。');if(!publicConfig(config).configured)throw new Error('请先保存服务和密钥。');
        testingConnection=true;const c=structuredClone(config),testId=identifier();
        try{
          await store.transact(s=>{s.connectionTests??=[];s.connectionTests.push({id:testId,at:stamp(),service:c.service,model:c.model,input:null,output:null,status:'pending'});s.connectionTests=s.connectionTests.slice(-100);});
          const result=await requestModel({...c,maxOutputTokens:2048,webSearch:false},{input:[{role:'user',content:'Call connection_check with an empty object once. This tests the tool protocol.'}],instructions:'Only call the requested connection_check tool.',tools:[{name:'connection_check',description:'Validate the connection tool protocol.',parameters:{type:'object',properties:{},additionalProperties:false}}]});
          const toolSupported=!result.incomplete&&result.calls.some(x=>x.name==='connection_check'&&x.arguments?.trim()==='{}');
          await store.transact(s=>Object.assign(s.connectionTests.find(t=>t.id===testId),result.usage,{status:'returned',toolSupported}));
          json(res,200,{toolSupported,usage:result.usage});return;
        }catch(e){await store.transact(s=>{const t=s.connectionTests?.find(t=>t.id===testId);if(t)Object.assign(t,e.usage||{},{status:e.usage?'returned-error':'unknown'});});throw e;}finally{testingConnection=false;}
      }
      if(req.method==='GET' && path==='/api/tasks'){json(res,200,list());return;}
      if(req.method==='POST' && path==='/api/tasks'){
        const b=await body(req);
        const t=await store.transact(s=>{
          if(s.tasks.length>=50) throw new Error('本版最多保存 50 个任务。请先导出归档。');
          const goal=text(b.goal,12000,'目标').trim();if(!goal) throw new Error('请写下想完成的事。');
          const t={id:identifier(),revision:1,title:goal.slice(0,44),goal,preferences:text(b.preferences||'',6000,'个人要求'),criteria:text(b.criteria||'',6000,'验收条件'),status:'ready',createdAt:stamp(),updatedAt:stamp(),materials:[],plan:[],questions:[],feedback:[],artifacts:[],events:[],usage:[],sources:[],previewData:{},memory:[],contextRecords:[],contextReviews:[]};
          addMaterials(t,b.materials||[]);log(t,'任务已保存在本机。你可以补材料、运行本地 CSV 工具，或配置 AI 后开始执行。');s.tasks.push(t);return t;
        });json(res,201,t);return;
      }
      const match=path.match(/^\/api\/tasks\/([\w-]+)(?:\/(.*))?$/);
      if(!match){json(res,404,{error:'接口不存在。'});return;}
      const [,id,action='']=match;
      if(req.method==='GET' && ['context-health','context-health/export'].includes(action)){
        const t=taskIn(store.read(),id);
        if(action.endsWith('/export'))res.setHeader('Content-Disposition',`attachment; filename="context-health-${id}.json"`);
        json(res,200,engine.health(t));return;
      }
      if(req.method==='GET' && (!action || action==='export')){
        const t=engine.view(taskIn(store.read(),id));if(action==='export')res.setHeader('Content-Disposition',`attachment; filename="task-${id}.json"`);json(res,200,t);return;
      }
      const fileMatch=action.match(/^artifacts\/([\w-]+)\/download$/);
      if(req.method==='GET' && fileMatch){const t=taskIn(store.read(),id),a=t.artifacts.find(a=>a.id===fileMatch[1]);if(!a) throw new Error('成果不存在。');res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="artifact.${a.kind}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(a.kind==='html'?standaloneHTML(a,t.previewData[a.id]):(a.kind==='csv'?'\uFEFF':'')+a.content);return;}
      const previewMatch=action.match(/^artifacts\/([\w-]+)\/preview$/);
      if(req.method==='GET' && previewMatch){const t=taskIn(store.read(),id),a=t.artifacts.find(a=>a.id===previewMatch[1]);if(!a||a.kind!=='html')throw new Error('HTML 成果不存在。');const nonce=url.searchParams.get('nonce');if(!/^[\w-]{20,80}$/.test(nonce||''))throw new Error('预览标识无效');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"});res.end(previewHTML(a,t.previewData[a.id],nonce));return;}
      const b=await body(req);
      if(req.method==='POST' && action==='run'){json(res,202,await engine.start(id));return;}
      if(req.method==='POST' && action==='cancel'){json(res,200,engine.cancel(id));return;}
      const result=await store.transact(s=>{
        const t=taskIn(s,id);
        if(req.method==='PUT' && action==='preview-data'){
          if(!t.artifacts.some(a=>a.id===b.artifactId&&a.kind==='html'))throw new Error('HTML 成果不存在。');
          if(!b.data||typeof b.data!=='object'||Array.isArray(b.data)||Object.values(b.data).some(v=>typeof v!=='string')||JSON.stringify(b.data).length>100000)throw new Error('预览数据格式或大小无效。');
          const existing=t.previewData[b.artifactId];if((existing?.revision||0)!==b.revision)throw new Error('预览数据在另一处更新，请重新打开预览。');
          t.previewData[b.artifactId]={data:b.data,revision:(existing?.revision||0)+1};return t.previewData[b.artifactId];
        }
        editable(t,b);
        if(req.method==='PATCH' && !action){t.goal=text(b.goal,12000,'目标').trim();if(!t.goal) throw new Error('目标不能为空。');t.title=t.goal.slice(0,44);t.preferences=text(b.preferences||'',6000,'个人要求');t.criteria=text(b.criteria||'',6000,'验收条件');t.status='ready';for(const a of t.artifacts)a.acceptedAt=null;log(t,'目标或个人要求已更新，需要重新检查成果。');}
        else if(req.method==='POST' && action==='materials'){addMaterials(t,b.materials);t.status='ready';log(t,`补充 ${b.materials.length} 份材料。`);}
        else if(req.method==='POST' && action==='feedback'){const message=text(b.message,12000,'补充说明').trim();if(!message)throw new Error('请填写补充说明。');if(t.feedback.length>=100)throw new Error('已达到 100 条补充上限。');t.feedback.push({at:stamp(),text:message,...(t.questions.length?{inReplyTo:t.questions.slice()}:{})});t.questions=[];t.status='ready';log(t,message,'user');}
        else if(req.method==='POST' && action==='memory'){
          const value=text(b.text,800,'固定要求').trim();if(!value)throw new Error('请填写要固定的要求。');
          t.memory??=[];if(t.memory.length>=12)throw new Error('最多固定 12 项要求，请优先保留重要且简短的约束。');
          if(t.memory.some(m=>m.text===value))throw new Error('这项要求已经固定。');
          t.memory.push({id:identifier(),text:value,createdAt:stamp()});t.status='ready';for(const a of t.artifacts)a.acceptedAt=null;
          log(t,'已固定一项要求；下次执行会带入每次模型请求，已有成果需要重新核对。');
        }
        else if(req.method==='POST' && action==='memory/remove'){
          const index=(t.memory||[]).findIndex(m=>m.id===b.memoryId);if(index<0)throw new Error('固定要求不存在。');
          t.memory.splice(index,1);t.status='ready';for(const a of t.artifacts)a.acceptedAt=null;log(t,'已取消固定一项要求；下次执行生效。');
        }
        else if(req.method==='POST' && action==='context-review'){
          const record=(t.contextRecords||[]).find(r=>r.id===b.requestId);
          if(!record?.requirements.some(r=>r.id===b.requirementId&&r.status==='included'))throw new Error('只能标记有记录且已带入的要求。');
          if(!t.usage.some(u=>u.id===record.id&&u.status==='returned'))throw new Error('这次请求尚无有效返回，不能标记结果。');
          if(b.artifactId&&!t.artifacts.some(a=>a.id===b.artifactId))throw new Error('成果不存在。');
          t.contextReviews??=[];if(t.contextReviews.length>=100)throw new Error('已达到 100 条人工核对记录上限。');
          if(t.contextReviews.some(r=>r.requestId===b.requestId&&r.requirementId===b.requirementId&&(r.artifactId||null)===(b.artifactId||null)))throw new Error('这项结果已经标记。');
          t.contextReviews.push({id:identifier(),requestId:b.requestId,requirementId:b.requirementId,artifactId:b.artifactId||null,at:stamp()});
          t.status='review';for(const a of t.artifacts)a.acceptedAt=null;log(t,'用户标记：要求已带入，但结果未遵守。这是人工判断，成果需要重新核对。','review');
        }
        else if(req.method==='POST' && action==='csv'){
          const m=t.materials.find(m=>m.id===b.materialId);if(!m)throw new Error('材料不存在。');
          const result=analyzeCSV(m.content,b);for(const a of result.artifacts)deliver(t,a,'local-tool');t.status='review';log(t,'本地 CSV 处理完成，模型调用 0 次；请核对清洗口径。','tool');
        }
        else if(req.method==='POST' && action==='accept'){
          const a=t.artifacts.find(a=>a.id===b.artifactId);if(!a)throw new Error('成果不存在。');a.acceptedAt=b.accepted===true?stamp():null;
          const latest=t.artifacts.filter(a=>!t.artifacts.some(x=>x.name===a.name&&x.kind===a.kind&&x.version>a.version));t.status=latest.length&&latest.every(a=>a.acceptedAt)?'completed':'review';log(t,`${a.acceptedAt?'用户已验收':'用户撤销验收'}：${a.name} v${a.version}`,'review');
        }
        else throw new Error('不支持的操作。');
        return t;
      });json(res,200,result);return;
    }
    if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'不支持的方法'});return;}
    const file=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!file.startsWith(root.endsWith(sep)?root:root+sep)){json(res,403,{error:'路径不允许'});return;}
    const content=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:content);
  }catch(e){json(res,e.code==='ENOENT'?404:400,{error:e.code?'本地读写失败；已保存的数据保留。':e.message});}
});
const listen=()=>server.listen(port,'127.0.0.1',()=>console.log(`共作 0.3 · http://127.0.0.1:${port}`));
server.on('error',e=>{
  // Windows may reserve the default port. Never override an explicit PORT.
  if(e.code==='EACCES'&&!process.env.PORT&&port===4318){port=14318;console.warn('默认端口不可用，切换到 14318。');listen();return;}
  console.error(e.message);process.exitCode=1;
});
listen();
