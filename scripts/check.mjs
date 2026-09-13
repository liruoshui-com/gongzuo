import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const roots=['server.mjs','lib','dist','scripts','tests','benchmarks'];
async function walk(path){
  if(/\.(mjs|cjs|js)$/.test(path))return[path];
  const entries=await readdir(path,{withFileTypes:true});
  return (await Promise.all(entries.filter(e=>e.isDirectory()||/\.(mjs|cjs|js)$/.test(e.name)).map(e=>walk(`${path}/${e.name}`)))).flat();
}
const files=(await Promise.all(roots.map(walk))).flat();
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
console.log(`Syntax checks passed: ${files.length} files`);
