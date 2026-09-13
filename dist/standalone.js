'use strict';
(() => {
  const seed=window.TOOL_SEED;
  const key='co-work-exported-tool-'+seed.id;
  let tasks=window.WorkbenchTool.normalizeTasks(seed.tasks);
  const status=document.getElementById('standalone-status');
  try{const saved=localStorage.getItem(key);if(saved){const parsed=JSON.parse(saved);if(!Array.isArray(parsed))throw new Error('invalid');tasks=window.WorkbenchTool.normalizeTasks(parsed);status.textContent='已恢复此浏览器中保存的任务。';}else{status.textContent='已载入导出文件中的任务；操作后会尝试保存到此浏览器。';}}catch{status.textContent='无法读取浏览器存储，已使用导出文件中的任务。请及时导出备份。';}
  window.WorkbenchTool.mount(document.getElementById('standalone-tool'),{title:seed.title,prefs:seed.prefs,tasks,onChange:updated=>{tasks=updated;try{localStorage.setItem(key,JSON.stringify(tasks));status.textContent='已保存到此浏览器。';}catch{status.textContent='浏览器存储不可用，请导出任务备份。';}}});
  document.getElementById('export-tasks').addEventListener('click',()=>{const data=JSON.stringify({title:seed.title,prefs:seed.prefs,tasks,exportedAt:new Date().toISOString()},null,2);const url=URL.createObjectURL(new Blob([data],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='学习任务备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
})();
