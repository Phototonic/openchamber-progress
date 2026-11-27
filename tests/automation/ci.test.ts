import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { backendTestCommands, nativeOnlyTests } from '../../scripts/ci-backend.ts';
import { freshCompileCache, portableLanes } from '../../scripts/test-plan.ts';
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
  const [parallel,serial]=backendTestCommands(files,{});
  assert.deepEqual(parallel.slice(0,2),['--experimental-strip-types','--test']);
  assert.deepEqual(serial.slice(0,3),['--experimental-strip-types','--test','--test-concurrency=1']);
  assert.deepEqual([...parallel.slice(2),...serial.slice(3)].sort(),files.sort());
  assert.deepEqual(serial.slice(3).map(f=>f.split('/').at(-1)).sort(),[
    'corrupt-store-startup.test.ts','managed-binding.test.ts','managed-health.test.ts',
    'managed-migration.test.ts','managed-request-worker.test.ts','managed-step-http.test.ts',
    'plan-user-cancel-service.test.ts','production-service.test.ts','service-lifecycle.test.ts','setup-paths.test.ts',
    'setup-suggestions.test.ts','windows-service.test.ts',
  ]);
  const source=readFileSync('scripts/ci.ts','utf8');
  assert.match(source,/await runLanes\(portableLanes\(\{ fenced: true, env: freshCompileCache\(\) \}\)\)/);
});

test('portable lanes run every portable file once, keep the port-bound group serial and alone, and the fast loop drops only that group, on any core count',()=>{
  const names=(dir:string)=>readdirSync(dir).filter(f=>f.endsWith('.test.ts')).map(f=>`${dir}/${f}`).sort();
  const native=new Set(nativeOnlyTests);
  const backend=names('tests/backend').filter(f=>!native.has(f.split('/').at(-1)!));
  const every=(lanes:ReturnType<typeof portableLanes>)=>lanes.flatMap(l=>l.steps).filter(s=>s.command==='node');
  const files=(steps:{args:string[]}[])=>steps.flatMap(s=>s.args.filter(a=>a.endsWith('.test.ts'))).sort();
  // On one to three cores the other lane's worker count is also 1, so the serial group
  // cannot be told apart by its --test-concurrency=1; it is the sole step of its own lane.
  for(const cpus of [1,2,3,4,24]){
    const at=`on ${cpus} cpus`;
    const full=portableLanes({fenced:true,cpus,environment:{}}),fast=portableLanes({fenced:false,cpus,environment:{}});
    assert.deepEqual(files(every(full)),[...backend,...names('tests/browser'),...names('tests/automation')].sort(),at);
    assert.equal(new Set(files(every(full))).size,files(every(full)).length,`no file runs twice ${at}`);
    const serialLanes=full.filter(l=>l.name==='port-bound backend');
    assert.equal(serialLanes.length,1,at);assert.equal(serialLanes[0].steps.length,1,`the port-bound group shares its lane with nothing that could take a port ${at}`);
    const serial=serialLanes[0].steps[0];
    assert.ok(serial.args.includes('--test-concurrency=1'),at);
    assert.deepEqual(serial.args.slice(0,3),backendTestCommands(backend,{})[1].slice(0,3),at);
    assert.deepEqual(files([serial]).map(f=>f.split('/').at(-1)),backendTestCommands(backend,{})[1].slice(3).map(f=>f.split('/').at(-1)).sort(),at);
    assert.ok(!serial.lowPriority,`the serial group never yields cores ${at}`);
    const others=full.filter(l=>l!==serialLanes[0]).flatMap(l=>l.steps);
    assert.ok(others.every(s=>s.lowPriority),`the lane beside it yields cores to it ${at}`);
    // Every other test step is bounded by an explicit worker count: the cores minus two, never below one.
    const workers=Math.max(1,cpus-2);
    for(const step of others.filter(s=>s.command==='node'))assert.ok(step.args.includes(`--test-concurrency=${workers}`),`${step.label} ${at}`);
    assert.deepEqual(files(every(fast)),files(every(full)).filter(f=>!files([serial]).includes(f)),at);
    assert.equal(fast.some(l=>l.steps.some(s=>s.args.includes('--test-concurrency=1')&&files([s]).some(f=>files([serial]).includes(f)))),false,`the fast loop has no serial group ${at}`);
    for(const lanes of [full,fast]){
      const labels=lanes.flatMap(l=>l.steps).map(s=>s.label);
      assert.ok(labels.includes('root typecheck')&&labels.includes('UI typecheck'),`both typechecks stay in every run ${at}`);
    }
  }
  // Without a core count the host's is used.
  assert.deepEqual(portableLanes({fenced:true,environment:{}}),portableLanes({fenced:true,cpus:availableParallelism(),environment:{}}));
});

test('a file that takes Setup ports only when CP_BUILT_SERVICE=1 runs in the serial group in that configuration and only there',()=>{
  const names=readdirSync('tests/backend').filter(f=>f.endsWith('.test.ts')).map(f=>`tests/backend/${f}`);
  const opted='tests/backend/plan-cleanup-service.test.ts';
  const [parallelOff,serialOff]=backendTestCommands(names,{});
  assert.ok(parallelOff.includes(opted)&&!serialOff.includes(opted),'without the opt-in it stays parallel: it takes no port');
  const [parallelOn,serialOn]=backendTestCommands(names,{CP_BUILT_SERVICE:'1'});
  assert.ok(serialOn.includes(opted)&&!parallelOn.includes(opted),'with the opt-in its built service takes writer slots');
  assert.deepEqual([...parallelOn.slice(2),...serialOn.slice(3)].sort(),names.sort(),'still no file omitted or repeated');
  assert.ok(!backendTestCommands(names,{CP_BUILT_SERVICE:'0'})[1].includes(opted),'only 1 opts in');
  const plan=(environment:NodeJS.ProcessEnv)=>portableLanes({fenced:true,cpus:4,environment}).find(l=>l.name==='port-bound backend')!.steps[0].args;
  assert.ok(plan({CP_BUILT_SERVICE:'1'}).includes(opted)&&!plan({}).includes(opted));
  const rest=(environment:NodeJS.ProcessEnv)=>portableLanes({fenced:true,cpus:4,environment}).filter(l=>l.name!=='port-bound backend').flatMap(l=>l.steps).flatMap(s=>s.args);
  assert.ok(!rest({CP_BUILT_SERVICE:'1'}).includes(opted),'the lane beside the serial group never holds it');
});

test('every step shares one compile cache folder that starts each run empty and stays out of tracked paths',()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-cache-'));
  try {
    const stale=join(root,'node_modules','.cache','agent-progress-compile','stale-entry');
    mkdirSync(join(root,'node_modules','.cache','agent-progress-compile'),{recursive:true});writeFileSync(stale,'left by an earlier run');
    const env=freshCompileCache(root);
    assert.equal(env.NODE_COMPILE_CACHE,join(root,'node_modules','.cache','agent-progress-compile'));
    assert.deepEqual(readdirSync(env.NODE_COMPILE_CACHE),[],'an earlier run leaves nothing behind');
    for(const lanes of [portableLanes({fenced:true,env}),portableLanes({fenced:false,env})])
      assert.deepEqual(new Set(lanes.flatMap(l=>l.steps).map(s=>s.env?.NODE_COMPILE_CACHE)),new Set([env.NODE_COMPILE_CACHE]),'every step, typechecks included, gets the folder');
    // Without a cache folder, plans carry none: the plan tests above never touch a live cache.
    assert.ok(portableLanes({fenced:true}).flatMap(l=>l.steps).every(s=>!s.env?.NODE_COMPILE_CACHE));
    assert.equal(spawnSync('git',['check-ignore','-q',join('node_modules','.cache','agent-progress-compile','x')]).status,0,'git ignores the folder');
    // An unusable location turns the cache off instead of failing the run.
    writeFileSync(join(root,'blocked'),'a file where a folder is needed');
    assert.deepEqual(freshCompileCache(join(root,'blocked')),{});
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
