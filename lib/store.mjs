import {mkdir, readFile, writeFile, rename, copyFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function createStore(directory) {
  await mkdir(directory, {recursive:true}); const file = join(directory,'workspace.json');
  let state;
  try { state = JSON.parse(await readFile(file,'utf8')); }
  catch (e) { if(e.code !== 'ENOENT') throw new Error('任务数据无法读取，请从 .local-data/workspace.json.bak 恢复，原文件未覆盖。'); state = {tasks:[], revision:0}; }
  if (!Array.isArray(state.tasks)) throw new Error('任务存储格式无效。');
  let queue = Promise.resolve();
  const transact = fn => {
    const job = queue.then(async () => {
      const next = structuredClone(state), result = fn(next);
      next.revision++; const body = JSON.stringify(next);
      if (Buffer.byteLength(body) > 50_000_000) throw new Error('本地任务数据达到 50 MB 限制，请先导出并归档旧任务。');
      await writeFile(file+'.tmp',body,{mode:0o600});
      try { await copyFile(file,file+'.bak'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      await rename(file+'.tmp',file); state = next; return structuredClone(result);
    });
    queue = job.catch(() => {}); return job;
  };
  if(state.tasks.some(t => t.status === 'running')) await transact(s => { for(const t of s.tasks) if(t.status === 'running') {t.status='blocked';t.events.push({at:new Date().toISOString(),kind:'system',text:'上次运行因服务重启中断，已有成果保留。'});} });
  return {read:() => structuredClone(state), transact};
}
