import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { backendTestCommands, nativeOnlyTests } from '../../scripts/ci-backend.ts';
import { portableLanes } from '../../scripts/test-plan.ts';
import { outputs } from '../../scripts/build-all.ts';

test('package scripts that consume runtime entries build before invoking their readers',()=>{
  const {scripts}=JSON.parse(readFileSync('package.json','utf8'));
  for(const name of ['test:backend','test:all','test:fast','package','verify:package','prepare:probe','setup','check'])
    assert.equal(scripts[name].split('&&')[0].trim(),'bun run build:all',`${name} must build before its readers`);
});

test('portable CLI names misplaced output paths before notes, eligibility, builds or tests',()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-ci-kind-'));
  const git=(...args:string[])=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  try {
    git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
    writeFileSync(join(root,'package.json'),JSON.stringify({version:'invalid'}));git('add','.');git('commit','-qm','Source fixture');
    const event=join(root,'event.json');
    writeFileSync(event,JSON.stringify({ref:'refs/heads/main',before:'0'.repeat(40)}));
    const run=(withEvent:boolean)=>spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/ci.ts')],{
      cwd:root,encoding:'utf8',timeout:10000,
      env:{...process.env,GITHUB_EVENT_PATH:withEvent?event:'',GITHUB_SHA:git('rev-parse','HEAD'),GITHUB_EVENT_NAME:'push'},
    });
    const missing=run(true);
    assert.equal(missing.status,1);assert.match(missing.stderr,/Distribution revision is missing generated outputs/);
    for(const file of outputs)assert.ok(missing.stderr.includes(file));
    mkdirSync(join(root,'build/service'),{recursive:true});writeFileSync(join(root,outputs[0]),'accidental output');
    git('add','build');git('commit','-qm','Partly tracked fixture');
    const tracked=run(false);
    assert.equal(tracked.status,1);assert.match(tracked.stderr,/Source revision tracks generated outputs: build\/service\/main.js/);
    for(const result of [missing,tracked]){assert.equal(result.stdout,'');assert.doesNotMatch(result.stderr,/Release notes validation failed/);}
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('Windows service tests have an explicit same-job backend build prerequisite',()=>{
  const workflow=readFileSync('.github/workflows/ci.yml','utf8').split('\n  windows-native:\n')[1].split('\n  publish:\n')[0];
  const build=workflow.indexOf('run: bun run build:backend'),tests=workflow.indexOf('- name: Test Windows setup, storage and capture');
  assert.ok(build>0&&build<tests);
});

test('portable backend groups isolate coordination ports without omitting or repeating tests',()=>{
  const files=readdirSync('tests/backend').filter(f=>f.endsWith('.test.ts')).map(f=>`tests/backend/${f}`);
  const [parallel,serial]=backendTestCommands(files);
  assert.deepEqual(parallel.slice(0,2),['--experimental-strip-types','--test']);
  assert.deepEqual(serial.slice(0,3),['--experimental-strip-types','--test','--test-concurrency=1']);
  assert.deepEqual([...parallel.slice(2),...serial.slice(3)].sort(),files.sort());
  assert.deepEqual(serial.slice(3).map(f=>f.split('/').at(-1)).sort(),[
    'corrupt-store-startup.test.ts','managed-binding.test.ts','managed-health.test.ts',
    'managed-migration.test.ts','managed-request-worker.test.ts','managed-step-http.test.ts',
    'production-service.test.ts','service-lifecycle.test.ts','setup-paths.test.ts',
    'setup-suggestions.test.ts','windows-service.test.ts',
  ]);
  const source=readFileSync('scripts/ci.ts','utf8');
  assert.match(source,/await runLanes\(portableLanes\(\{ fenced: true \}\)\)/);
});

test('portable lanes run every portable file once, keep the port-bound group serial and alone, and the fast loop drops only that group',()=>{
  const names=(dir:string)=>readdirSync(dir).filter(f=>f.endsWith('.test.ts')).map(f=>`${dir}/${f}`).sort();
  const native=new Set(nativeOnlyTests);
  const backend=names('tests/backend').filter(f=>!native.has(f.split('/').at(-1)!));
  const every=(lanes:ReturnType<typeof portableLanes>)=>lanes.flatMap(l=>l.steps).filter(s=>s.command==='node');
  const files=(steps:{args:string[]}[])=>steps.flatMap(s=>s.args.filter(a=>a.endsWith('.test.ts'))).sort();
  const full=portableLanes({fenced:true}),fast=portableLanes({fenced:false});
  assert.deepEqual(files(every(full)),[...backend,...names('tests/browser'),...names('tests/automation')].sort());
  assert.equal(new Set(files(every(full))).size,files(every(full)).length,'no file runs twice');
  const serial=every(full).filter(s=>s.args.includes('--test-concurrency=1'));
  assert.equal(serial.length,1);
  assert.deepEqual(files(serial).map(f=>f.split('/').at(-1)),backendTestCommands(backend)[1].slice(3).map(f=>f.split('/').at(-1)).sort());
  const alone=full.filter(l=>l.steps.includes(serial[0]));
  assert.equal(alone.length,1);assert.equal(alone[0].steps.length,1,'the port-bound group shares its lane with nothing that could take a port');
  assert.ok(!serial[0].lowPriority&&full.find(l=>l.steps.includes(serial[0]))!.steps.length===1,'the serial group never yields cores');
  assert.ok(full.flatMap(l=>l.steps).filter(s=>s!==serial[0]).every(s=>s.lowPriority),'the lane beside it yields cores to it');
  // Every step shares one compile cache folder inside the ignored dependency folder, never a tracked path.
  const caches=new Set(full.flatMap(l=>l.steps).map(s=>s.env?.NODE_COMPILE_CACHE));
  assert.equal(caches.size,1);
  assert.ok([...caches][0]?.endsWith(join('node_modules','.cache','agent-progress-compile')),'the cache lives under node_modules/.cache');
  assert.equal(spawnSync('git',['check-ignore','-q',join('node_modules','.cache','agent-progress-compile','x')]).status,0,'git ignores the cache folder');
  // Every other test step is bounded by an explicit worker count rather than the host default.
  for(const step of every(full).filter(s=>s!==serial[0]))assert.ok(step.args.some(a=>/^--test-concurrency=[1-9]\d*$/.test(a)),step.label);
  assert.deepEqual(files(every(fast)),files(every(full)).filter(f=>!files(serial).includes(f)));
  for(const lanes of [full,fast]){
    const labels=lanes.flatMap(l=>l.steps).map(s=>s.label);
    assert.ok(labels.includes('root typecheck')&&labels.includes('UI typecheck'),'both typechecks stay in every run');
  }
});

test('lane runner starts a yielding step at lower priority and an ordinary one at the usual priority',async()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-lanes-priority-'));
  try {
    const script=join(root,'lanes.ts');
    writeFileSync(script,`import {runLanes} from ${JSON.stringify(pathToFileURL(resolve('scripts/test-lanes.ts')).href)};
const show=(label:string,lowPriority?:boolean)=>({label,command:process.execPath,args:['-e',"console.log('PRIORITY '+require('node:os').getPriority())"],lowPriority});
await runLanes([{name:'a',steps:[show('usual')]},{name:'b',steps:[show('yielding',true)]}]);`);
    // Plain headings: the runner writes `::group::` blocks when it sees GitHub Actions.
    const r=spawnSync(process.execPath,['--experimental-strip-types',script],{encoding:'utf8',timeout:20_000,env:{...process.env,GITHUB_ACTIONS:''}});
    assert.equal(r.status,0,r.stderr);
    const seen=(label:string)=>Number(new RegExp(`=== ${label} ===\\nPRIORITY (-?\\d+)`).exec(r.stdout)?.[1]);
    assert.ok(seen('b: yielding')>seen('a: usual'),'the yielding step has the larger niceness');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('lane runner stops every lane at the first failure and reports it without interleaving',async()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-lanes-'));
  try {
    const script=join(root,'lanes.ts');
    writeFileSync(script,`import {runLanes} from ${JSON.stringify(pathToFileURL(resolve('scripts/test-lanes.ts')).href)};
const node=(label:string,code:string)=>({label,command:process.execPath,args:['-e',code]});
try{await runLanes([
  {name:'slow',steps:[node('hangs',"setTimeout(()=>{},60000)"),node('never starts',"console.log('LATE-STEP')")]},
  {name:'fails',steps:[node('breaks',"console.log('FAIL-OUTPUT');process.exit(3)")]},
  {name:'ok',steps:[node('passes',"console.log('PASS-OUTPUT')"),node('skipped after failure',"setTimeout(()=>console.log('LATE-STEP'),5000)")]},
]);}catch(error){console.log('REJECTED '+(error as Error).message);process.exit(1);}`);
    const started=performance.now();
    const r=spawnSync(process.execPath,['--experimental-strip-types',script],{encoding:'utf8',timeout:20_000});
    assert.equal(r.status,1);
    assert.ok(performance.now()-started<15_000,'the hanging lane is stopped, not waited for');
    assert.match(r.stdout,/FAIL-OUTPUT/);assert.match(r.stdout,/Exited with code 3/);assert.match(r.stdout,/REJECTED Portable check failed/);
    assert.doesNotMatch(r.stdout,/LATE-STEP/);
    assert.match(r.stdout,/stopped\s+[\d.]+s\s+slow: hangs/);
    assert.match(r.stdout,/failed\s+[\d.]+s\s+fails: breaks/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('actual portable CLI refuses nonfresh artifacts before entry reads or checks, preserving archives',()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-ci-archives-'));
  try {
    mkdirSync(join(root,'build/artifacts'),{recursive:true});
    const sentinel=Buffer.from('synthetic retained archive\0bytes');
    writeFileSync(join(root,'build/artifacts/retained.zip'),sentinel);
    // No generated entries or dependencies exist: any attempt to read/build them is a failure.
    const result=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/ci.ts')],{
      cwd:root,encoding:'utf8',env:{...process.env,PATH:''},timeout:10_000,
    });
    assert.equal(result.error,undefined);
    assert.equal(result.status,1);
    assert.match(result.stderr,/fresh disposable checkout/);
    assert.match(result.stderr,/build\/artifacts is nonempty/);
    assert.equal(result.stdout,'','No checks or builds should start');
    assert(!result.stderr.includes('ENOENT'),'Must refuse before reading generated entries');
    assert.deepEqual(readFileSync(join(root,'build/artifacts/retained.zip')),sentinel);
    assert.deepEqual(readdirSync(join(root,'build/artifacts')),['retained.zip']);
    assert.deepEqual(readdirSync(root),['build']);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('portable CLI refuses missing bump notes on PR/dev and malformed committed notes before builds',()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-ci-notes-'));
  const git=(...args:string[])=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim();};
  try {
    git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
    writeFileSync(join(root,'package.json'),JSON.stringify({version:'1.0.0'}));git('add','.');git('commit','-qm','Fixture');
    const before=git('rev-parse','HEAD');
    writeFileSync(join(root,'package.json'),JSON.stringify({version:'9.8.7'}));git('add','.');git('commit','-qm','Fixture bump');
    const after=git('rev-parse','HEAD');
    for(const [name,event] of [
      ['pull_request',{pull_request:{base:{sha:before}}}],
      ['push',{before,after,ref:'refs/heads/dev'}],
    ] as const) {
      const path=join(root,'event.json');writeFileSync(path,JSON.stringify(event));
      const r=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/ci.ts')],{
        cwd:root,encoding:'utf8',timeout:10_000,
        env:{...process.env,GITHUB_EVENT_PATH:path,GITHUB_EVENT_NAME:name,GITHUB_SHA:after,GITHUB_REPOSITORY:'example/fixture'},
      });
      assert.equal(r.status,1);assert.match(r.stderr,/Release notes validation failed/);
      assert(!r.stderr.includes('ENOENT'));assert.equal(r.stdout,'');
    }
    mkdirSync(join(root,'release-notes'));writeFileSync(join(root,'release-notes/9.8.7.md'),'private malformed fixture detail');
    git('add','.');git('commit','-qm','Malformed fixture');
    const r=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/ci.ts')],{
      cwd:root,encoding:'utf8',timeout:10_000,
      env:{...process.env,GITHUB_EVENT_PATH:'',GITHUB_SHA:git('rev-parse','HEAD')},
    });
    assert.equal(r.status,1);assert.match(r.stderr,/Release notes validation failed/);
    assert(!r.stderr.includes('private malformed fixture detail'));assert(!r.stderr.includes('ENOENT'));assert.equal(r.stdout,'');
  } finally {rmSync(root,{recursive:true,force:true});}
});
