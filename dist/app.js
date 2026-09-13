'use strict';
(() => {
  const { escape: esc, uid, normalizeTasks, mount } = window.WorkbenchTool;
  const KEY='co-work-prototype-v1';
  const steps=['说清目标','保留你的想法','试用成果','检查与交付'];
  const titles=['从你想做的事开始','好的方法，也要适合你','让成果接受真实使用','带着清楚的结果继续'];
  const sources=[
    {id:'S1',title:'试点数据表',body:'20 家客户参加试点，12 家每周至少完成一次核心操作。人工核对 30 次导出，其中 3 次错位。8 家参与付费访谈，5 家愿意讨论采购；尚无付费合同。'},
    {id:'S2',title:'客户访谈摘录',body:'客户甲表示导出的报告需要手工调整。客户丙表示权限设置仍需要支持人员帮助。'},
    {id:'S3',title:'产品例会记录',body:'销售建议扩大至 100 家，尚未批准。有人称活跃客户约 15 家，统计时间与口径待核。工程估计修复导出与权限问题需要 2 人周，尚未确认排期。'},
    {id:'S4',title:'支持团队反馈',body:'目前每周约 12 张工单，当前人力可处理约 20 张。新增客户的需求未知，也没有批准增加支持人手。'}
  ];
  const defaults={
    tool:{title:'下班后的学习角',idea:'我想做一个适合下班后学习的小工具。每天的空闲时间不固定，希望少一点压力，也能看见自己的进步。',audience:'下班后想继续学习的自己',goal:'把学习拆成能完成的小任务，并保留进步记录。'},
    brief:{title:'客户试点扩容简报',idea:'根据客户访谈、试点数据和会议记录，整理一份明天给负责人的简报，帮助决定要不要扩大试点。',audience:'需要决定是否扩大试点的负责人',goal:'帮助决定是否从 20 家扩大到 100 家。'}
  };
  function createProject(kind='tool') { return {id:uid(),kind,...defaults[kind],step:0,prefs:{flexible:true,gentle:true,weekly:true,concise:true,conflicts:true},voice:'',feedback:'',manual:{},tasks:[{id:uid(),text:'读完一节感兴趣的课程',minutes:25,done:false,doneAt:null,sample:true},{id:uid(),text:'用自己的话记下三个要点',minutes:10,done:false,doneAt:null,sample:true},{id:uid(),text:'把一个想法做成小练习',minutes:45,done:false,doneAt:null,sample:true}],activity:{added:0,toggled:0,deleted:0},createdAt:Date.now()}; }
  let projects=[], activeId, restoredIds=new Set(), storageError='', storageOk=false;
  try {
    const raw=localStorage.getItem(KEY);
    if(raw){const saved=JSON.parse(raw);if(!saved||!Array.isArray(saved.projects))throw new Error('invalid');
      projects=saved.projects.filter(p=>p&&typeof p.id==='string'&&['tool','brief'].includes(p.kind)).slice(0,30).map(p=>{
        const base=createProject(p.kind);
        return {...base,...p,title:String(p.title||base.title).slice(0,80),idea:String(p.idea||'').slice(0,3000),audience:String(p.audience||'').slice(0,200),goal:String(p.goal||'').slice(0,1000),voice:String(p.voice||'').slice(0,1000),feedback:String(p.feedback||'').slice(0,1500),step:Math.max(0,Math.min(3,Number(p.step)||0)),prefs:{...base.prefs,...(p.prefs||{})},manual:p.manual&&typeof p.manual==='object'?p.manual:{},tasks:normalizeTasks(p.tasks),activity:{...base.activity,...(p.activity||{})}};
      }); activeId=projects.some(p=>p.id===saved.activeId)?saved.activeId:projects[0]?.id;restoredIds=new Set(projects.map(p=>p.id));storageOk=true;
    }
  } catch {storageError='本地记录无法读取。当前内容仍可导出备份。';}
  if(!projects.length){const p=createProject();projects=[p];activeId=p.id;}
  const current=()=>projects.find(p=>p.id===activeId);
  const $=selector=>document.querySelector(selector);
  let toastTimer;
  function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4200);}
  function status(){const el=$('#save-status');el.textContent=storageError || (storageOk?'已保存到此浏览器':'草稿尚未保存');el.classList.toggle('error',!!storageError);}
  function save(){try{localStorage.setItem(KEY,JSON.stringify({version:1,activeId,projects}));storageOk=true;storageError='';}catch{storageOk=false;storageError='保存失败，请导出备份';}status();}
  function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#info-dialog').showModal();}
  function nav(){const p=current();$('#project-list').innerHTML=projects.map(x=>`<button class="project-link ${x.id===activeId?'active':''}" data-project="${esc(x.id)}" ${x.id===activeId?'aria-current="page"':''}><span class="project-mark" aria-hidden="true">${x.kind==='tool'?'▦':'▤'}</span><span class="project-name">${esc(x.title)}</span></button>`).join('');
    document.querySelectorAll('[data-project]').forEach(b=>b.addEventListener('click',()=>{activeId=b.dataset.project;save();render();}));$('#crumb-title').textContent=p.title;}
  function criteria(p){return p.kind==='tool'?['可以添加、完成和删除学习任务','刷新页面后恢复此浏览器中的记录','完成与撤销不会重复累计统计','实际体验符合我选择的学习习惯']:['关键数字与原始材料相符','建议、事实和待核口径分开表达','重要结论能定位到来源','简报帮助指定读者作出决定'];}
  function context(){const p=current();const chosen=p.kind==='tool'?[p.prefs.flexible?'按可用时间筛选任务':null,p.prefs.gentle?'温和反馈，无逾期惩罚':null,p.prefs.weekly?'显示本周完成进步':null].filter(Boolean):[p.prefs.concise?'优先展示决策要点':'保留更完整的解释','始终保留引用与口径差异'];
    $('#context-panel').innerHTML=`<div class="context-card"><h2>这次，我们要完成</h2><dl><dt>给谁使用</dt><dd>${esc(p.audience||'还没有填写')}</dd><dt>希望得到的结果</dt><dd>${esc(p.goal||'还没有填写')}</dd></dl></div><div class="context-card"><h2>你的选择，会落在成果里</h2><ul class="context-list">${chosen.map(x=>`<li><span class="bullet" aria-hidden="true">—</span><span>${x}</span></li>`).join('')||'<li>可以在第二步选择适合自己的方式。</li>'}</ul>${p.voice?`<p style="margin-top:14px">补充想法：${esc(p.voice)}<br><small>已记录，尚未自动应用</small></p>`:''}</div><div class="context-card tint"><h2>先合格，再做得像你</h2><p>${p.kind==='tool'?'功能可以实际操作。个人选择会改变筛选、反馈和统计方式。自由描述不会自动生成新的功能。':'正文来自内置的虚构案例。切换篇幅会调整呈现；自由材料的 AI 分析尚未接入。'}</p></div>`;
  }
  function actions(previous,next,label){return `<div class="stage-actions">${previous!==null?`<button class="button secondary" data-step="${previous}">上一步</button>`:'<span class="small-copy">不需要先学专业术语</span>'}${next!==null?`<button class="button primary" data-step="${next}">${label||'继续'} <span aria-hidden="true">→</span></button>`:''}</div>`;}
  function stage0(p){return `<div class="panel intro"><div class="section-kicker">01 / 你想完成什么</div><h2>先选一个可以动手的起点</h2><p class="small-copy">目标可以用自己的话说。这里先用两个示例，体验从想法到成果的过程。</p><div class="scenario-list">${[['tool','▦','做一个学习小工具','任务、时间筛选、进步记录'],['brief','▤','整理一份工作简报','决策要点、原文依据、待核事项']].map(([kind,icon,name,sub])=>`<button class="scenario ${p.kind===kind?'selected':''}" data-kind="${kind}" aria-pressed="${p.kind===kind}"><span class="scenario-icon" aria-hidden="true">${icon}</span><strong>${name}</strong><small>${sub}</small>${p.kind===kind?'<span class="selected-mark" aria-hidden="true">✓</span>':''}</button>`).join('')}</div><label class="field"><span class="field-label">用你自己的话，描述这件事</span><textarea data-field="idea" maxlength="3000" placeholder="我想……，现在最困扰我的问题是……">${esc(p.idea)}</textarea><small>自由描述会保存到项目中。当前原型使用示例模板，还未调用 AI 理解这段文字。</small></label><div class="hint"><span class="hint-mark" aria-hidden="true">ⓘ</span><span><strong>当前可实际体验：</strong>${p.kind==='tool'?'添加与完成任务、按时间筛选、本地保存、导出独立工具。':'查看示例简报、定位原文、调整篇幅、导出 Markdown。'}</span></div>${actions(null,1,'明确目标与选择')}</div><div class="panel"><h3>怎么判断做得够不够好？</h3><p class="small-copy" style="margin:0">我们会把“必须做到的事”和“你自己的偏好”分别保留。完成后用具体检查来对照，而不是给一个含糊的分数。</p></div>`;}
  function stage1(p){return `<div class="panel"><div class="section-kicker">02 / 方法与你的选择</div><h2>先让成果有一个清楚的方向</h2><label class="field"><span class="field-label">项目名称</span><input data-field="title" value="${esc(p.title)}" maxlength="80" required></label><label class="field"><span class="field-label">给谁使用或阅读</span><input data-field="audience" value="${esc(p.audience)}" maxlength="200"></label><label class="field"><span class="field-label">希望解决什么问题</span><textarea data-field="goal" maxlength="1000" style="min-height:90px">${esc(p.goal)}</textarea></label><h3 style="margin-top:24px">这些方式，哪些更适合你？</h3>${p.kind==='tool'?[
      ['flexible','我的空闲时间不固定','开启 10 / 25 / 45 分钟筛选，找出现在能做的任务。'],['gentle','我希望少一点催促和压力','使用温和反馈，不显示逾期惩罚。'],['weekly','我想看见自己一周的进步','统计本周完成项数和这些任务的预计时长。']
    ].map(([key,label,desc])=>`<label class="preference"><input type="checkbox" data-pref="${key}" ${p.prefs[key]?'checked':''}><span><strong>${label}</strong><p>${desc}</p></span></label>`).join(''):`<label class="preference"><input type="checkbox" data-pref="concise" ${p.prefs.concise?'checked':''}><span><strong>负责人只有两分钟，先看要点</strong><p>缩短示例正文，保留关键数字、来源和需要决定的事。</p></span></label><div class="hint">数字口径、来源和待确认事项属于基本质量，会始终保留。</div>`}<label class="field"><span class="field-label">还有什么想保留的个人想法？ <span class="muted">（可选）</span></span><textarea data-field="voice" maxlength="1000" style="min-height:84px" placeholder="例如：我更喜欢自己安排，不想被系统打分。">${esc(p.voice)}</textarea><small>会随项目一起导出。自由补充在本原型中尚未自动变成功能。</small></label>${actions(0,2,p.kind==='tool'?'打开可用的小工具':'打开示例简报')}</div><div class="panel"><h3>这次的基本合格条件</h3><ul class="criterion-list">${criteria(p).map((c,i)=>`<li><span class="number">0${i+1}</span><span>${c}</span></li>`).join('')}</ul><p class="sample-note">这是验收要求，尚不代表已经通过检查。</p></div>`;}
  function briefSections(p){return p.prefs.concise?[
    {text:'建议先修复导出与权限配置问题，核实使用口径与支持能力，再决定是否扩大到 100 家。此项是基于材料的建议，尚未获批准。',refs:['S2','S3','S4']},
    {text:'20 家客户中，12 家每周至少完成一次核心操作（60%）。会议提到的“约 15 家活跃”口径待核。30 次导出中 3 次错位（10%），不能解释为 10% 的客户受影响。',refs:['S1','S3']},
    {text:'8 家受访客户中，5 家愿意讨论采购，尚无付费合同。当前每周约 12 张工单，处理能力约 20 张，不能据此确认能支持 100 家。请负责人明确修复优先级、口径核对责任和重新评估时间。',refs:['S1','S3','S4']}
  ]:[
    {text:'建议先修复导出与权限配置问题、核实使用口径并评估支持能力，再决定是否直接从 20 家扩大至 100 家。这是基于现有材料的建议，尚非已批准安排。',refs:['S2','S3','S4']},
    {text:'现有 20 家试点客户中，12 家每周至少完成一次核心操作，按这一口径计算的持续使用比例为 60%。会议提到的“约 15 家活跃”缺少口径和统计时间，暂不替代数据表结论。',refs:['S1','S3']},
    {text:'人工核对的 30 次导出中，3 次出现错位，样本内错位比例为 10%；该比例不能解释为 10% 的客户受影响。客户访谈也提到了导出调整与权限配置问题。',refs:['S1','S2']},
    {text:'参与付费访谈的 8 家客户中，5 家愿意进一步讨论采购。目前没有付费合同，不能据此推算整个客户群的付费率或收入。',refs:['S1']},
    {text:'当前每周约 12 张工单，处理能力约 20 张；新增客户支持需求未知，无法确认现有人力足以支撑 100 家。工程提出的 2 人周是修复估算，仍需确认排期。建议本次明确修复优先级、核对责任和重新评估时间。',refs:['S3','S4']}
  ];}
  function stage2(p){return `<div class="panel"><div class="preview-header"><div><div class="section-kicker">03 / 让它接受真实使用</div><h2 style="margin:0">${p.kind==='tool'?'试着添加一件你今天想做的事':'先读简报，再检查它的依据'}</h2></div><span class="tag ${p.kind==='tool'?'live':''}">${p.kind==='tool'?'可实际操作':'虚构示例'}</span></div>${p.kind==='tool'?'<div id="learning-tool"></div>':`<div class="article-preview"><span class="tag">内置案例 · ${p.prefs.concise?'决策要点':'完整说明'}</span><h2 style="margin-top:14px">${esc(p.title)}</h2>${briefSections(p).map(s=>`<p>${esc(s.text)}${s.refs.map(id=>`<button class="cite" data-source="${id}" aria-label="查看来源 ${id}">${id}</button>`).join('')}</p>`).join('')}</div>`}<p class="sample-note">${p.kind==='tool'?'初始三项是示例任务。操作与所选偏好真实生效；记录只保存在此浏览器。':'案例中的公司、访谈和数字均为虚构。正文由预先编写的模板呈现，未调用 AI。'}</p><div class="result-toolbar"><button class="button secondary small" data-step="1">调整我的选择</button><button class="button secondary small" id="download-result">${p.kind==='tool'?'导出独立小工具':'导出简报 Markdown'}</button></div><details class="explanation"><summary>为什么这样安排？</summary><p class="muted">${p.kind==='tool'?'先把“能添加、完成、保存”作为基础。时间筛选和反馈方式由你决定。工具的统计只反映你标记的完成记录，不会替你判断是否真正学会。':'先呈现需要做的决定，再给事实与限制。会议口径没有核实，就不和数据表混在一起；表达采购意愿也不能写成已经付费。'}</p></details>${actions(1,3,'检查与交付')}</div>${p.kind==='brief'?`<div class="panel"><h3>原始材料 · 自编演示数据</h3><div class="source-list">${sources.map(s=>`<details id="source-${s.id}"><summary>${s.id} · ${s.title}</summary><p>${s.body}</p></details>`).join('')}</div></div>`:''}<div class="panel"><h3>哪里还不符合你的习惯？</h3><label class="field"><textarea data-field="feedback" maxlength="1500" style="min-height:90px" placeholder="例如：我希望先看到今天有时间完成的事情。">${esc(p.feedback)}</textarea><small>反馈会保存，尚未由 AI 自动修改。上方“调整我的选择”可以立即改变已支持的功能。</small></label><button class="button secondary small" id="save-feedback">保存这条反馈</button></div>`;}
  function checks(p){return p.kind==='tool'?[
    {title:'添加任务',passed:p.activity.added>0,text:p.activity.added>0?`本项目实际添加过 ${p.activity.added} 次任务。`:'在第三步添加一项自己的任务后，会记录实际操作。'},
    {title:'完成与撤销',passed:p.activity.toggled>0,text:p.activity.toggled>0?`本项目记录了 ${p.activity.toggled} 次完成状态切换；请自行检查结果是否符合预期。`:'在第三步切换任务状态，查看统计变化。'},
    {title:'浏览器存储写入',passed:storageOk,text:storageOk?'浏览器已接受项目记录写入。清除浏览器数据会删除这些记录。':'尚未成功写入，建议导出备份。'},
    {title:'刷新后的记录恢复',passed:restoredIds.has(p.id),text:restoredIds.has(p.id)?'本次页面加载时，已从浏览器读取这个项目。':'需要实际刷新页面并恢复此项目，才能记录这一项。'}
  ]:[
    {title:'引用编号可以定位',passed:briefSections(p).every(s=>s.refs.every(id=>sources.some(x=>x.id===id))),text:'程序只检查来源编号是否存在；不等同于语义正确或内容真实。'},
    {title:'实际模型调用',passed:false,text:'本原型没有调用模型。AI 分析与内容核验尚未实现。'}
  ];}
  function stage3(p){return `<div class="delivery"><div class="delivery-icon" aria-hidden="true">↗</div><div><h2>${p.kind==='tool'?'这个小工具，可以带走继续用':'示例简报，可以导出继续修改'}</h2><p>先看实际检查记录，再确认成果是否适合你。</p></div></div><div class="panel"><div class="section-kicker">04 / 检查与交付</div><h2>已经发生了什么</h2>${checks(p).map(c=>`<div class="check-row"><div><h3>${c.title}</h3><p>${c.text}</p></div><span class="check-status ${c.passed?'passed':''}">${c.passed?'已记录':'待检查 / 未实现'}</span></div>`).join('')}<details class="explanation"><summary>这些记录能说明什么？</summary><p class="muted">这里只展示本次实际观察到的动作和状态。它们不是完整测试报告，也不会替代你对质量和用途的判断。</p></details></div><div class="panel"><h2>还有两件事，需要你判断</h2>${[['fit','成果符合我这次的目的'],['personal','重要的个人选择确实体现出来了']].map(([key,label])=>`<label class="manual-check"><input type="checkbox" data-manual="${key}" ${p.manual[key]?'checked':''}><span>${label}${p.manual[key]?'<small class="muted"> · 用户自行确认</small>':''}</span></label>`).join('')}<div class="result-toolbar"><button class="button primary" id="download-result">${p.kind==='tool'?'导出独立小工具':'导出简报 Markdown'}</button><button class="button secondary" id="export-record">导出完整项目记录</button></div><p class="sample-note">${p.kind==='tool'?'下载的是可离线打开的 HTML 文件，包含当前任务与选项。不同浏览器的本地文件保存行为可能不同，请保留导出的项目备份。':'下载包括示例正文、原始材料索引和未核实的用户补充。'} 未进行在线发布。</p>${actions(2,null)}</div>`;}
  function bind(){const p=current();document.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>goStep(Number(b.dataset.step))));
    document.querySelectorAll('[data-kind]').forEach(b=>b.addEventListener('click',()=>{if(p.kind===b.dataset.kind)return;const next=createProject(b.dataset.kind);projects.push(next);activeId=next.id;save();render();toast('已新建示例项目，之前的草稿仍保留。');}));
    document.querySelectorAll('[data-field]').forEach(input=>input.addEventListener('input',()=>{p[input.dataset.field]=input.value;save();if(input.dataset.field==='title')nav();context();}));
    document.querySelectorAll('[data-pref]').forEach(input=>input.addEventListener('change',()=>{p.prefs[input.dataset.pref]=input.checked;save();context();}));
    document.querySelectorAll('[data-manual]').forEach(input=>input.addEventListener('change',()=>{p.manual[input.dataset.manual]=input.checked;save();render();}));
    document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{const detail=$('#source-'+button.dataset.source);detail.open=true;detail.scrollIntoView({behavior:'smooth',block:'center'});detail.querySelector('summary').focus();}));
    $('#save-feedback')?.addEventListener('click',()=>{save();toast(storageOk?'反馈已保存到此浏览器，尚未自动修改成果。':'未能保存，请导出项目记录。');});
    $('#download-result')?.addEventListener('click',downloadResult);$('#export-record')?.addEventListener('click',exportProject);
    if($('#learning-tool'))mount($('#learning-tool'),{title:p.title,prefs:p.prefs,tasks:p.tasks,onChange:(tasks,kind)=>{p.tasks=tasks;p.activity[kind]=(p.activity[kind]||0)+1;save();}});
  }
  function render(){const p=current();$('#page-title').textContent=titles[p.step];$('#stepper').innerHTML=steps.map((label,i)=>`<button class="step-button ${p.step===i?'active':''}" data-step="${i}" ${p.step===i?'aria-current="step"':''}><span class="step-number">${i+1}</span><span>${label}</span></button>`).join('');$('#stage-content').innerHTML=[stage0,stage1,stage2,stage3][p.step](p);nav();context();bind();status();}
  function goStep(step){if(!Number.isInteger(step)||step<0||step>3)throw new Error('Invalid step');const p=current();if(!p.title.trim())p.title=defaults[p.kind].title;p.step=step;save();render();$('#page-title').scrollIntoView({block:'start',behavior:'smooth'});}
  function download(filename,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已发起下载，请查看浏览器的下载记录。');}
  const safeFilename = value => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').slice(0,70)||'我的项目';
  function exportProject(){const p=current();download(safeFilename(p.title)+'-项目记录.json',JSON.stringify({format:'co-work-prototype',version:1,exportedAt:new Date().toISOString(),project:p,capabilities:{aiConnected:false,modelCalls:0,usage:null},observations:checks(p).map(({title,passed,text})=>({title,observed:passed,detail:text}))},null,2),'application/json;charset=utf-8');}
  async function downloadResult(){const p=structuredClone(current());if(p.kind==='brief'){const text=`# ${p.title}\n\n> 内置虚构案例；未调用 AI。\n\n${briefSections(p).map(s=>s.text+' '+s.refs.map(id=>'['+id+']').join('')).join('\n\n')}\n\n## 用户补充（未核实，未自动融入正文）\n\n${p.voice||'无'}\n\n## 来源：自编演示材料\n\n${sources.map(s=>`### ${s.id} ${s.title}\n\n${s.body}`).join('\n\n')}\n`;download(safeFilename(p.title)+'.md',text,'text/markdown;charset=utf-8');return;}
    const button=$('#download-result');if(button)button.disabled=true;
    try{const paths=['style.css','tool.js','standalone.js'];const assets=await Promise.all(paths.map(async path=>{const r=await fetch(path);if(!r.ok)throw new Error('asset');return r.text();}));
      const seed=JSON.stringify({id:p.id,title:p.title,prefs:p.prefs,tasks:p.tasks}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
      const script=(assets[1]+'\nwindow.TOOL_SEED='+seed+';\n'+assets[2]).replace(/<\/script/gi,'<\\/script');
      const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><style>${assets[0]}</style></head><body class="standalone-body"><main class="standalone-wrap"><div class="standalone-meta"><span>我的学习工具 · 来自共作原型</span><button class="button secondary small" id="export-tasks">导出任务备份</button></div><div id="standalone-tool"></div><p class="standalone-footer" id="standalone-status"></p><p class="standalone-footer">所有功能在本地运行，未接入 AI。记录保存在此浏览器；清除浏览器数据或更换打开方式可能影响记录。建议定期导出备份。</p></main><script>${script}<\/script></body></html>`;
      download(safeFilename(p.title)+'.html',html,'text/html;charset=utf-8');
    }catch{toast('导出未完成：无法读取工具文件，请保持本地服务运行后重试。');}finally{if(button?.isConnected)button.disabled=false;}
  }
  $('#new-project').addEventListener('click',()=>{if(projects.length>=30){toast('原型最多保留 30 个项目，请先导出备份。');return;}const p=createProject();projects.push(p);activeId=p.id;save();render();});
  $('#export-project').addEventListener('click',exportProject);
  $('#about-button').addEventListener('click',()=>dialog('当前可以体验什么',`<p><strong>这是本地交互原型，还未接入 AI。</strong></p><ul><li>学习工具可真实添加、完成、删除任务，切换时间筛选并保存记录。</li><li>你的选项会改变功能；自由描述与反馈目前只会保存。</li><li>简报使用自编的虚构材料，可以定位来源并导出。</li><li>导出的小工具可以独立打开，不依赖模型或在线服务。</li></ul><p class="muted">尚未支持：根据自由需求生成新产品、自由材料分析、云同步或在线发布。浏览器数据清除后无法自动恢复，请保留导出备份。</p>`));
  $('#usage-button').addEventListener('click',()=>dialog('实际用量',`<p>本原型的模板与本地功能没有调用模型。</p><table class="usage-table"><tr><td>模型调用次数</td><td>0 次</td></tr><tr><td>输入 / 输出 token</td><td>不适用</td></tr><tr><td>模型 API 费用</td><td>未产生</td></tr><tr><td>订阅额度变化</td><td>未读取</td></tr></table><p class="muted">这些数据不代表 AI 执行任务的成本，也不能用于计算节省比例。以后接入模型时，需要记录澄清、检查、重试等全部调用。</p>`));
  $('#close-dialog').addEventListener('click',()=>$('#info-dialog').close());
  window.WorkbenchApp={getSnapshot:()=>({project:structuredClone(current()),capabilities:{aiConnected:false},storageOk}),goStep,configurePreferences:input=>{const allowed=current().kind==='tool'?['flexible','gentle','weekly']:['concise'];if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)||typeof input[k]!=='boolean'))throw new Error('Unsupported preference');Object.assign(current().prefs,input);save();render();return {preferences:structuredClone(current().prefs),storageOk};}};
  render();
})();
