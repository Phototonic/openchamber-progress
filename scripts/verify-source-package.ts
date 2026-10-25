/** Cheap source-export sanity, not another full test/package suite or a clone gate. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest } from '../shared/store.ts';

const root=fs.mkdtempSync('/tmp/opencode/agent-progress-source-export-');
try{
  const listed=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'});assert.equal(listed.status,0,'read-only source listing');
  const excluded=new Set(['.git','node_modules','build','evidence','.slim','.codegraph','AGENTS.md']);
  const files=[...new Set(listed.stdout.split('\0').filter(Boolean))].filter(file=>file!=='docs/tracking.md'&&!file.split('/').some(part=>excluded.has(part))).sort();
  assert.ok(files.includes('package.json')&&files.includes('plugin/index.ts')&&files.includes('ui/panel/main.js'));
  for(const file of files){assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'));assert.ok(fs.lstatSync(file).isFile(),'source export accepts regular visible files only');const dest=path.join(root,'source',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);}
  const exported=`${root}/source`;fs.symlinkSync(path.resolve('node_modules'),`${exported}/node_modules`,'dir');
  for(const name of ['home','config','data','cache','state','tmp'])fs.mkdirSync(`${root}/${name}`,{mode:0o700});
  const env={PATH:process.env.PATH??'/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_CACHE_HOME:`${root}/cache`,XDG_STATE_HOME:`${root}/state`,TMPDIR:`${root}/tmp`};
  for(const command of ['typecheck','build:backend']){
    const result=spawnSync('bun',['run',command],{cwd:exported,env,encoding:'utf8',timeout:30000,maxBuffer:2_000_000});
    assert.equal(result.status,0,`${command}\n${result.stdout}\n${result.stderr}`);
  }
  for(const name of ['evidence','.slim','AGENTS.md','docs/tracking.md'])assert.equal(fs.existsSync(`${exported}/${name}`),false);
  for(const surface of ['panel','status','page'])assert.equal(digest(fs.readFileSync(`${exported}/ui/${surface}/main.js`)),digest(fs.readFileSync(`ui/${surface}/main.js`)));
  console.log(JSON.stringify({sourceVisibleFiles:files.length,typecheck:true,backendBuild:true,existingDependenciesOnly:true,noEvidenceOrPlanDependency:true,noGuestRebuild:true,fullTestsRepeated:false,cloneOrGitArchiveGate:false}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
