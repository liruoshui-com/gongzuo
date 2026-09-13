// Package only the committed source tree. Never archive the working directory.
import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../releases/',import.meta.url),{recursive:true});
const result=spawnSync('git',['archive','--format=zip','--prefix=gongzuo/','--output=releases/gongzuo-v0.2.0.zip','HEAD'],{cwd:root,stdio:'inherit'});
process.exitCode=result.status??1;
