'use strict';
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function normalizeTasks(tasks) {
    if (!Array.isArray(tasks)) return [];
    const seen = new Set();
    return tasks.slice(0, 500).filter(t => t && typeof t.text === 'string' && t.text.trim()).map(t => {
      let id = typeof t.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(t.id) ? t.id : uid();
      if (seen.has(id)) id = uid(); seen.add(id);
      return { id, text: t.text.slice(0, 160), minutes: [10,25,45].includes(t.minutes) ? t.minutes : 25, done: t.done === true, doneAt: Number.isFinite(t.doneAt) ? t.doneAt : null, sample: t.sample === true };
    });
  }
  function stats(tasks, now = new Date()) {
    const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const week = tasks.filter(t => t.done && t.doneAt >= +start && t.doneAt < +end);
    return { completed: tasks.filter(t => t.done).length, remaining: tasks.filter(t => !t.done).length, week: week.length, minutes: week.reduce((sum,t) => sum+t.minutes,0) };
  }
  function mount(container, options) {
    let tasks = normalizeTasks(options.tasks); let filter = 'all'; let error = '';
    const prefs = { flexible: true, gentle: true, weekly: true, ...options.prefs };
    const emit = kind => options.onChange?.(structuredClone(tasks), kind);
    function render() {
      const s = stats(tasks); const shown = tasks.filter(t => filter === 'all' || t.minutes <= Number(filter));
      container.innerHTML = `<div class="tool-surface"><div class="tool-heading"><h2>${escape(options.title || '下班后的学习角')}</h2><p>${prefs.gentle ? '按自己的节奏来，今天完成一点也很好。' : '选好下一项，记录你实际完成的学习。'}</p></div><div class="tool-body">
        <div class="tool-stats"><div class="stat-block"><span>等待你的小任务</span><strong>${s.remaining}<small>项</small></strong></div><div class="stat-block"><span>${prefs.weekly?'本周完成 · 周一开始':'累计完成'}</span><strong>${prefs.weekly?s.week:s.completed}<small>项${prefs.weekly?' / '+s.minutes+' 分钟':''}</small></strong></div></div>
        <form class="tool-form"><input class="tool-input" name="task" aria-label="新的学习任务" placeholder="下一件小事，比如读完一节课程" maxlength="160" required autocomplete="off"><select class="tool-select" name="minutes" aria-label="预计时长"><option value="10">10 分钟</option><option value="25" selected>25 分钟</option><option value="45">45 分钟</option></select><button class="button primary" type="submit">添加任务</button></form>
        ${error?`<div class="input-error" role="alert">${escape(error)}</div>`:''}
        ${prefs.flexible?`<div class="tool-filter"><span>现在有多少时间？</span>${[['all','不限'],['10','10 分钟'],['25','25 分钟'],['45','45 分钟']].map(([v,l])=>`<button class="filter-button ${filter===v?'active':''}" data-filter="${v}" aria-pressed="${filter===v}">${l}</button>`).join('')}</div>`:''}
        <div class="task-list">${shown.map(t=>`<div class="task-item ${t.done?'done':''}"><button class="task-toggle" data-toggle="${escape(t.id)}" aria-label="${t.done?'撤销完成':'完成'}：${escape(t.text)}" aria-pressed="${t.done}">${t.done?'✓':''}</button><div class="task-main"><div class="task-name">${escape(t.text)}</div><div class="task-meta">${t.minutes} 分钟${t.sample?' · 示例任务':''}${t.done?' · 已完成':''}</div></div><button class="task-delete" data-delete="${escape(t.id)}" aria-label="删除：${escape(t.text)}">删除</button></div>`).join('') || `<div class="tool-empty">${tasks.length?'这个时间范围没有任务。可以换一个时长。':'还没有任务，先添加一件小事。'}</div>`}</div>
        <div class="tool-message">${prefs.gentle?'不显示逾期惩罚；完成记录由你自己掌握。':'完成与撤销会即时更新统计。'} 每周分钟数为已完成任务的预计时长之和。</div></div></div>`;
      container.querySelector('form').addEventListener('submit', event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const text = String(data.get('task') || '').trim();
        if (!text) { error='请先写下要做的小事。'; render(); container.querySelector('input').focus(); return; }
        if (tasks.length >= 500) { error='本地原型最多保存 500 条任务，请先导出或整理。'; render(); return; }
        error=''; tasks.push({id:uid(),text:text.slice(0,160),minutes:Number(data.get('minutes')),done:false,doneAt:null,sample:false}); emit('added'); render(); container.querySelector('input').focus();
      });
      container.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {filter=button.dataset.filter;render();container.querySelector(`[data-filter="${filter}"]`)?.focus();}));
      container.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => {
        const id=button.dataset.toggle; const task=tasks.find(t=>t.id===id); task.done=!task.done; task.doneAt=task.done?Date.now():null; emit('toggled'); render(); container.querySelector(`[data-toggle="${id}"]`)?.focus();
      }));
      container.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => {tasks=tasks.filter(t=>t.id!==button.dataset.delete);emit('deleted');render();}));
    }
    render(); return { getTasks:()=>structuredClone(tasks) };
  }
  window.WorkbenchTool = { escape, uid, normalizeTasks, stats, mount };
})();
