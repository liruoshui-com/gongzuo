// Browser acceptance checks. Requires Playwright + an installed Chromium browser.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const http=require('node:http');const fs=require('node:fs/promises');const path=require('node:path');const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
(async()=>{
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});const dir=await fs.mkdtemp(path.join(root,'test-results','browser-'));
  let count=0;
  const provider=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);count++;
    const content='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:16px system-ui;padding:28px;background:#f6f8ff}button{padding:12px;background:#3653dd;color:white;border:0;border-radius:8px}h1{font-size:24px}</style><h1>我的学习记录 · 协议测试产物</h1><button id="add">添加一条记录</button><p>已保存 <output id="count"></output> 条</p><script>let n=Number(localStorage.getItem("records")||0);count.textContent=n;add.onclick=()=>{count.textContent=++n;localStorage.setItem("records",n)};</script></html>';
    const message=count%2===1?{role:'assistant',content:null,tool_calls:[{id:'test-tool-'+count,type:'function',function:{name:'deliver_artifact',arguments:JSON.stringify({name:'学习记录.html',kind:'html',content})}}]}:{role:'assistant',content:'这是模拟接口测试生成的成果，未调用真实 AI。'};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message,finish_reason:count%2===1?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10}}));
  });await listen(provider);const providerPort=provider.address().port;
  const reserve=http.createServer();await listen(reserve);const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),WORKBENCH_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let browser;
  try{
    const base=`http://127.0.0.1:${port}`;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/tasks')).ok)break;}catch{}await wait(70);}
    browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.getByRole('heading',{name:'今天，你想把哪件事做好？'}).waitFor();
    await page.screenshot({path:path.join(dir,'home-desktop.png'),fullPage:true});
    await page.locator('#settings').click();
    for(const service of ['deepseek','openai','glm','claude']){
      await page.locator(`[data-service="${service}"]`).click();await page.locator('[name="apiKey"]').fill('fake-browser-'+service);await page.locator('#settings-form button[type="submit"]').click();await page.locator('#settings').click();
      await page.locator(`[data-service="${service}"]`).click();assert.match(await page.locator('[name="apiKey"]').getAttribute('placeholder'),/已保存/);assert.equal(await page.locator('[name="apiKey"]').inputValue(),'');
    }
    const publicConfig=await page.evaluate(()=>fetch('/api/config').then(r=>r.json()));assert.ok(!JSON.stringify(publicConfig).includes('fake-browser-'));assert.equal(Object.keys(publicConfig.profiles).length,4);
    await page.locator('#close-dialog').click();
    await page.locator('[data-starter="office"]').click();await page.locator('#new-files').setInputFiles({name:'团队工时.csv',mimeType:'text/csv',buffer:Buffer.from('部门,工时,备注\n产品,2,需求\n研发,3,实现\n研发,3,实现\n,,\n')});
    await page.locator('#create-form button[type="submit"]').click();await page.locator('#deliveries').waitFor();
    await page.locator('[data-tab="materials"]').click();await page.locator('[data-csv]').click();await page.locator('[name="deduplicate"]').check();await page.locator('[name="groupBy"]').fill('部门');await page.locator('[name="valueColumn"]').fill('工时');await page.locator('#csv-form .button.primary').click();await page.locator('#artifact-select').waitFor();
    assert.equal(await page.locator('#artifact-select option').count(),4);await page.locator('[data-tab="usage"]').click();assert.match(await page.locator('#tab-surface').innerText(),/0/);
    const downloadPromise=page.waitForEvent('download');await page.locator('.artifact-toolbar a').click();const download=await downloadPromise;await download.saveAs(path.join(dir,download.suggestedFilename()));
    await page.screenshot({path:path.join(dir,'csv-desktop.png'),fullPage:true});
    await page.reload();await page.locator('#artifact-select').waitFor();assert.equal(await page.locator('#artifact-select option').count(),4);
    // Change only the custom provider; named providers keep their saved keys.
    await page.locator('#settings').click();await page.locator('[data-service="custom"]').click();await page.locator('[name="model"]').fill('mock-ui');await page.locator('[name="baseUrl"]').fill(`http://127.0.0.1:${providerPort}`);await page.locator('[name="provider"]').selectOption('chat');await page.locator('#settings-form button[type="submit"]').click();
    await page.locator('#new-task').click();await page.locator('[data-starter="product"]').click();await page.locator('#create-form button[type="submit"]').click();await page.locator('#run-task').click();await page.waitForFunction(()=>document.querySelector('#task-status')?.textContent==='待验收');
    const frame=page.frameLocator('#artifact-content iframe');await frame.locator('#add').click();await frame.locator('#add').click();await page.waitForFunction(()=>document.querySelector('#preview-status')?.textContent.includes('操作数据已保存'));
    assert.equal(await frame.locator('#count').innerText(),'2');await page.reload();await page.frameLocator('#artifact-content iframe').locator('#count').waitFor();assert.equal(await page.frameLocator('#artifact-content iframe').locator('#count').innerText(),'2');
    // Preview scripts cannot access task API, parent DOM or arbitrary host storage.
    const isolated=page.frames().find(f=>f.url().includes('/preview?'));
    assert.equal(await isolated.evaluate(()=>{try{return parent.document.title;}catch{return 'blocked';}}),'blocked');
    assert.equal(await isolated.evaluate(async()=>{try{await fetch('/api/config');return 'unexpected';}catch{return 'blocked';}}),'blocked');
    await page.locator('#accept-artifact').check();await page.waitForFunction(()=>document.querySelector('#task-status')?.textContent==='已验收');
    await page.locator('#feedback-form [name="message"]').fill('保留原来的记录风格，做第二个版本');await page.locator('#feedback-form button').click();await page.locator('#run-task').click();await page.waitForFunction(()=>document.querySelector('#task-status')?.textContent==='待验收');assert.equal(await page.locator('#artifact-select option').count(),2);assert.equal(await page.frameLocator('#artifact-content iframe').locator('#count').innerText(),'0');
    const options=await page.locator('#artifact-select option').evaluateAll(xs=>xs.map(x=>({value:x.value,label:x.textContent})));await page.locator('#artifact-select').selectOption(options.find(x=>x.label.includes('v1')).value);assert.equal(await page.frameLocator('#artifact-content iframe').locator('#count').innerText(),'2');
        const htmlDownloadPromise=page.waitForEvent('download');await page.locator('.artifact-toolbar a').click();const htmlDownload=await htmlDownloadPromise;const exported=path.join(dir,'exported-tool.html');await htmlDownload.saveAs(exported);const standalone=await context.newPage();await standalone.goto(require('node:url').pathToFileURL(exported).href);assert.equal(await standalone.locator('#count').innerText(),'2');await standalone.locator('#add').click();await standalone.reload();assert.equal(await standalone.locator('#count').innerText(),'3');await standalone.close();await page.bringToFront();
    await page.locator('#toast').evaluate(e=>e.hidden=true);await page.screenshot({path:path.join(dir,'product-desktop.png'),fullPage:true});
    for(const width of [390,320]){await page.setViewportSize({width,height:900});await page.frameLocator('#artifact-content iframe').locator('#count').waitFor();await page.locator('#artifact-content').evaluate(e=>e.scrollIntoView({block:'center'}));await page.waitForTimeout(180);await page.screenshot({path:path.join(dir,`product-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page overflows');}
    await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'large font page overflows');
    await page.evaluate(()=>document.documentElement.style.fontSize='');await page.locator('#new-task').click();await page.locator('[name="goal"]').fill('<img src=x onerror="window.pwned=1"> 我的真实任务');await page.locator('#create-form button[type="submit"]').click();await page.locator('#deliveries').waitFor();assert.equal(await page.evaluate(()=>window.pwned),undefined);assert.match(await page.locator('h1').innerText(),/<img/);
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['four-provider-key-only-setup','key-masking','csv-real-processing','download','task-refresh','model-tool-loop-mock','html-isolated-preview','preview-persistence','version-isolation','manual-acceptance','mobile-320-390','font-200-percent','literal-user-html'],liveProviderCalls:0,screenshots:dir},null,2));
    console.log('Browser acceptance passed. '+dir);
  }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));provider.closeAllConnections();await new Promise(r=>provider.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
