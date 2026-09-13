import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseCSV} from '../lib/csv.mjs';

const revised=phase=>phase===2 || phase==='2' || phase==='revision' || phase==='revised';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const errorText=error=>String(error?.message || error).slice(0,1200);
const latest=(task,name,kind)=>(task.artifacts || []).filter(a=>a.name===name&&(!kind||a.kind===kind)).sort((a,b)=>(b.version || 1)-(a.version || 1)).at(0);

export async function gradeTask(fixture,task,{phase=1,chromium=null,artifactDir=null,browserExecutable}={}){
  const checks=[],criticalFailures=[];
  let personalRequirementsPassed=0,personalRequirementsTotal=0,qualityUnknown=false;
  const add=(label,passed,detail,{personal=false,critical=true}={})=>{
    checks.push({label,passed,...(detail?{detail}: {})});
    if(personal){personalRequirementsTotal++;if(passed===true)personalRequirementsPassed++;}
    if(passed===false&&critical)criticalFailures.push(label);
    if(passed===null)qualityUnknown=true;
    return passed;
  };
  const check=(label,fn,options)=>{try{return add(label,!!fn(),undefined,options);}catch(error){return add(label,false,errorText(error),options);}};
  const required=(name,kind)=>{const a=latest(task,name,kind);add(`已交付 ${name}`,!!a);if(a&&revised(phase))add(`${name} 有修改版本`,(a.version || 1)>=2);return a;};
  try{
    const expected=fixture.expected;
    if(expected.kind==='research'){
      const artifact=required('decision.json','json'),report=required('建议.md','md');
      let decision;
      if(artifact){try{decision=JSON.parse(artifact.content);add('决策 JSON 可解析',true);}catch(error){add('决策 JSON 可解析',false,errorText(error));}}
      const target=expected[revised(phase)?'revision':'initial'];
      for(const [key,value] of Object.entries(target))check(`决策字段 ${key}`,()=>decision?.[key]===value);
      check('引用编号完整且没有虚构来源',()=>Array.isArray(decision?.sourceIds)&&decision.sourceIds.length===expected.sourceIds.length&&equal([...decision.sourceIds].sort(),[...expected.sourceIds].sort()));
      check('报告包含两方案的明确事实（语义关系待盲评）',()=>!!report&&expected.reportFacts.every(f=>report.content.includes(f)),{critical:false});
      check('报告保留三个来源标记',()=>!!report&&expected.sourceIds.every(id=>report.content.includes(`[${id}]`)));
      check('简洁报告不超过约定字符数',()=>!!report&&[...report.content].length<=expected.reportMaxCharacters,{personal:true});
      check('年化值与月费、预算的硬约束相符',()=>decision?.monthlyCostCny===target.monthlyCostCny&&decision?.annualizedCostCny===target.annualizedCostCny&&decision?.budgetCny===target.budgetCny,{personal:true});
      check('报告提示年化为估算并拒绝年付承诺（关键词检查）',()=>!!report&&/估算/.test(report.content)&&/(不是|并非|不代表|不构成|不作|无需|不需要|不承诺|不进行|非年付).{0,12}(年付|年约|年度承诺)|不.{0,5}年付/.test(report.content),{personal:true,critical:false});
    }else if(expected.kind==='csv'){
      const cleaned=required('清洗结果.csv','csv'),summary=required('分组汇总.csv','csv'),chart=required('分组图表.svg','svg'),report=required('数据检查.md','md');
      let rows,groups;
      if(cleaned){try{rows=parseCSV(cleaned.content);add('清洗 CSV 可解析',true);}catch(error){add('清洗 CSV 可解析',false,errorText(error));}}
      if(summary){try{groups=parseCSV(summary.content);add('分组 CSV 可解析',true);}catch(error){add('分组 CSV 可解析',false,errorText(error));}}
      check('清洗列顺序与全部记录精确符合独立真值',()=>equal(rows,[expected.header,...expected.rows]));
      check('前导零编号保持原样',()=>equal(rows?.slice(1).map(r=>r[0]),expected.rows.map(r=>r[0])),{personal:true});
      check('两条重复记录均保留',()=>rows?.slice(1).filter(r=>r[0]==='002').length===2,{personal:true});
      check('未知工时继续保留空值',()=>rows?.find(r=>r[0]==='005')?.[3]==='',{personal:true});
      const target=expected[revised(phase)?'revision':'initial'];
      check('分组列与数值汇总符合独立真值',()=>{
        if(!groups||!equal(groups[0],target.header)||groups.length!==target.groups.length+1||groups.some(r=>r.length!==2))return false;
        const pairs=groups.slice(1).map(([key,value])=>[key,Number(value)]).sort((a,b)=>a[0].localeCompare(b[0]));
        return groups.slice(1).every(r=>r[1].trim()!=='')&&equal(pairs,[...target.groups].sort((a,b)=>a[0].localeCompare(b[0])));
      });
      check('分组总工时为 17',()=>groups?.slice(1).reduce((sum,r)=>sum+Number(r[1]),0)===expected.totalHours);
      check('图表有 SVG 结构与本阶段分组（视觉待盲评）',()=>!!chart&&/<svg\b/i.test(chart.content)&&target.groups.every(([name])=>chart.content.includes(name)),{critical:false});
      check('检查说明声明空行和重复处理',()=>!!report&&/空行|空记录/.test(report.content)&&/重复/.test(report.content)&&/(删除重复[：:\s]*0|保留.{0,8}重复|不.{0,4}去重)/.test(report.content));
      check('检查说明列出一条空记录和一条重复记录',()=>!!report&&/(删除空行|空行|空记录)[：:\s]*1/.test(report.content)&&/(发现重复|重复记录|重复)[：:\s]*1/.test(report.content),{critical:false});
      check('原始 CSV 材料保持不变',()=>task.materials?.find(m=>m.id==='timesheet')?.content===fixture.materials.find(m=>m.id==='timesheet').content,{personal:true});
    }else if(expected.kind==='html'){
      const artifact=required(expected.fileName,'html');
      if(!artifact){add('产品真实浏览器功能',false,'没有可运行 HTML 成果',{personal:true});}
      else if(!chromium){
        add('产品真实浏览器功能',null,'未提供浏览器；不能把文件存在视为功能通过',{personal:true});
      }else{
        await gradeHTML(fixture,artifact,{phase,chromium,artifactDir,browserExecutable,add});
      }
    }else add('已知评分任务类型',false,'未知 fixture 类型');
  }catch(error){add('评分器完整执行',false,errorText(error));}
  return {
    automatedPassed:checks.some(c=>c.passed===false)?false:qualityUnknown?null:true,
    checks,personalRequirementsPassed,personalRequirementsTotal,manualAccepted:null,
    ...(fixture.expected?.kind==='research'?{semanticAccepted:null}:{}),
    qualityUnknown,criticalFailures,
    manualRubric:fixture.expected?.manualRubric || '',
    scope:'固定合成任务的自动检查；人工质量、未测功能和使用者操作耗时未获验证。'
  };
}

async function gradeHTML(fixture,artifact,{phase,chromium,artifactDir,browserExecutable,add}){
  let browser,context,server,observed=false;
  const network=[],errors=[];
  const action=async(label,fn,options)=>{try{await fn();add(label,true,undefined,options);return true;}catch(error){add(label,false,errorText(error),options);return false;}};
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  try{
    server=http.createServer((req,res)=>{
      if(req.method==='GET'&&req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"});
      res.end(artifact.content);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true,...(browserExecutable?{executablePath:browserExecutable}: {})});
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin&&['/','/favicon.ico'].includes(url.pathname))await route.continue();
      else{network.push(url.origin+url.pathname);await route.abort();}
    });
    const page=await context.newPage();page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(10000);
    page.on('pageerror',error=>errors.push(errorText(error)));
    page.on('dialog',dialog=>{void dialog.accept();});
    // Observe CSP-blocked external dependencies as well as intercepted requests.
    await page.exposeFunction('__benchmarkCspViolation',uri=>{if(uri&&!['inline','eval'].includes(uri))network.push(String(uri).slice(0,300));});
    await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>{void window.__benchmarkCspViolation(event.blockedURI);}));
    const loaded=await action('HTML 在真实本地 origin 加载',async()=>{await page.goto(origin+'/',{waitUntil:'domcontentloaded'});assert((await page.locator('body').innerText()).trim().length>0,'页面没有可见内容');});
    if(!loaded)return;
    observed=true;
    const list=page.getByRole('list',{name:'学习记录',exact:true});
    const samples=fixture.expected.samples;
    const item=sample=>list.getByRole('listitem').filter({hasText:sample.content});
    const addRecord=async sample=>{
      await page.getByLabel('学习内容',{exact:true}).fill(sample.content);
      await page.getByLabel('学习日期',{exact:true}).fill(sample.date);
      await page.getByLabel('标签',{exact:true}).fill(sample.tag);
      await page.getByRole('button',{name:'添加记录',exact:true}).click();
      await item(sample).waitFor({state:'visible'});
    };
    const controls=await action('输入与列表有约定的可访问名称',async()=>{
      for(const name of ['学习内容','学习日期','标签'])assert(await page.getByLabel(name,{exact:true}).count()===1,`缺少唯一控件 ${name}`);
      assert(await page.getByLabel('学习日期',{exact:true}).getAttribute('type')==='date','学习日期不是原生 date 输入');
      assert(await page.getByRole('button',{name:'添加记录',exact:true}).count()===1,'缺少添加按钮');assert(await list.count()===1,'缺少学习记录列表');
    });
    if(!controls)return;
    await action('未把示例内容冒充用户记录',async()=>{for(const sample of samples)assert(await item(sample).count()===0,'页面预置了示例记录');});
    const added=await action('真实新增两条记录并显示历史日期与标签',async()=>{
      for(const sample of samples){await addRecord(sample);const text=await item(sample).innerText();assert(text.includes(sample.date)&&text.includes(sample.tag),'未显示历史日期原值或标签');}
    },{personal:true});
    if(!added)return;
    await action('刷新后两条真实记录仍保留',async()=>{
      await page.reload({waitUntil:'domcontentloaded'});for(const sample of samples){await item(sample).waitFor({state:'visible'});assert((await item(sample).innerText()).includes(sample.date),'刷新后日期丢失');}
    },{personal:true});
    const removed=await action('删除对应记录并在刷新后保持删除',async()=>{
      await page.getByRole('button',{name:'删除记录：'+samples[0].content,exact:true}).click();await item(samples[0]).waitFor({state:'hidden'});
      assert(await item(samples[1]).isVisible(),'删除影响了另一条记录');await page.reload({waitUntil:'domcontentloaded'});
      assert(await item(samples[0]).count()===0,'删除记录刷新后重新出现');assert(await item(samples[1]).isVisible(),'保留记录刷新后丢失');
    },{personal:true});
    if(revised(phase))await action('标签筛选正确切换并能恢复全部记录',async()=>{
      if(removed)await addRecord(samples[0]);
      const filter=page.getByLabel('标签筛选',{exact:true});assert(await filter.evaluate(el=>el.tagName)==='SELECT','标签筛选不是原生 select');
      for(const sample of samples){await filter.selectOption({label:sample.tag});assert(await item(sample).isVisible(),'匹配标签记录没有显示');assert(!(await item(samples.find(other=>other!==sample)).isVisible()),'其他标签记录未被过滤');}
      await filter.selectOption({label:'全部'});for(const sample of samples)assert(await item(sample).isVisible(),'全部选项未恢复记录');
    });
    await action('可见界面没有打卡惩罚或连续天数文案（待盲评）',async()=>{const visible=await page.locator('body').innerText();assert(!/连续\s*\d+\s*天|断签惩罚|打卡排名|连续打卡奖励/.test(visible),'发现禁止的打卡文案');},{personal:true,critical:false});
    if(artifactDir)await action('保存本次产品检查截图',async()=>{const directory=resolve(artifactDir);await mkdir(directory,{recursive:true});const name=String(fixture.id).replace(/[^a-zA-Z0-9_-]/g,'_')+`-${revised(phase)?'revision':'initial'}.png`;await page.screenshot({path:join(directory,name),fullPage:true});},{critical:false});
  }catch(error){add('浏览器评分基础设施',null,errorText(error),{personal:true});}
  finally{
    add('离线运行不依赖外部资源',observed?network.length===0:null,network.length?network.slice(0,5).join('; '):!observed?'页面尚未成功加载，未完成观察':undefined,{personal:true});
    add('产品运行没有未捕获脚本错误',observed?errors.length===0:null,errors.length?errors.slice(0,3).join('; '):!observed?'页面尚未成功加载，未完成观察':undefined);
    try{await context?.close();}catch{}try{await browser?.close();}catch{}
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
}
