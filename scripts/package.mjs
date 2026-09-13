// Package only the committed source tree. Never archive the working directory.
import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const committed=spawnSync('git',['show','HEAD:package.json'],{cwd:root,encoding:'utf8'});
if(committed.status!==0)throw new Error('Cannot read committed package version.');
const {version}=JSON.parse(committed.stdout);
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid release version.');
await mkdir(new URL('../releases/',import.meta.url),{recursive:true});
const result=spawnSync('git',['archive','--format=zip','--prefix=gongzuo/',`--output=releases/gongzuo-v${version}.zip`,'HEAD'],{cwd:root,stdio:'inherit'});
process.exitCode=result.status??1;
