/** Read-only source listing -> faithful, ordinary-file candidate projection. Never stages. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const target=path.resolve(process.argv[2]??'');assert.ok(process.argv[2],'new projection directory required');assert.equal(fs.existsSync(target),false,'never overwrite a reviewed projection');
const runtime=new Set(['build/service/main.js','build/companion/index.js','build/companion/package.json','build/companion/SKILL.md','build/setup/main.js']);
const excluded=new Set(['.git','node_modules','evidence','.slim','.codegraph','AGENTS.md']);
const listed=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},encoding:'utf8'});assert.equal(listed.status,0,'read-only Git source listing');
const files=[...new Set(listed.stdout.split('\0').filter(Boolean))].filter(file=>{
  if(file.split('/').some(p=>excluded.has(p)))return false;
  if(file.startsWith('build/'))return runtime.has(file);
  return !/(?:^|\/)(?:progress-binding|auth|credentials)\.json$|\.(?:sqlite3?|db|log)$|-(?:wal|shm|journal)$|(?:^|\/)\.env(?!\.example$)/.test(file);
}).sort();
for(const entry of [...runtime,'package.json','shared/release.ts','ui/panel/main.js','ui/status/main.js','ui/page/main.js'])assert.ok(files.includes(entry),`candidate entry missing: ${entry}`);
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.mkdirSync(target,{recursive:true,mode:0o700});const inventory=[];
for(const file of files){assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'));const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),`ordinary source files only: ${file}`);const before=hash(file),dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);assert.equal(hash(dest),before);inventory.push({path:file,sha256:before});}
for(const entry of inventory)assert.equal(hash(entry.path),entry.sha256,'inputs changed during projection');
console.log(JSON.stringify({target,rootManifestUnmodified:true,staged:false,buildEntries:[...runtime],files:inventory},null,2));
