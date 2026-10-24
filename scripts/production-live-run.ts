/** T6 Lane A. One explicit bounded live attempt; synthetic mode never accesses source. */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, lstatSync, existsSync, realpathSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client';
import { Control, PROVIDER, DEFAULT_MODEL, readState, changeState, type Ledger } from '../tests/fixtures/auth-guard.ts';
import { ProgressStatus } from '../plugin/status.ts';
import { destinationClient, runRootWithCopy } from './auth-live.ts';
import { resolveManagedSource, insist, LiveSafetyError } from './auth-source.ts';
import { productionStoreProof } from './production-live-check.ts';
import { Store, digest } from '../shared/store.ts';
import { readBinding } from '../shared/binding.ts';

async function main(live:boolean,attempt:1|2=1) {
  process.umask(0o077);
  const suffix=attempt===2?'2':'';
  const evidence=live?`evidence/backend/t6-live${suffix}.json`:`evidence/backend/t6-synthetic${suffix}.json`;
  const liveRoot=`/tmp/opencode/agent-progress-t6-live${suffix}`;
  // Refuse reruns before discovery/auth/launch. The one live fixture is never reused.
  insist(!live||!existsSync(evidence)&&!existsSync(liveRoot),'ledger');
  insist(realpathSync('/tmp/opencode')==='/tmp/opencode','ledger');
  const root=live?liveRoot:mkdtempSync('/tmp/opencode/agent-progress-probe-auth-t6-');
  if(live)mkdirSync(root,{mode:0o700});
  const identity=lstatSync(root);const nonce=randomUUID();writeFileSync(`${root}/.owner`,nonce,{mode:0o600,flag:'wx'});
  function owned() {const s=lstatSync(root);insist(!s.isSymbolicLink()&&realpathSync(root)===root&&s.ino===identity.ino&&s.dev===identity.dev&&readFileSync(`${root}/.owner`,'utf8')===nonce,'cleanup');}
  const binary='/tmp/opencode/agent-progress-probe-cli/opencode';
  const directory=`${root}/project`;const abort=new AbortController();
  const password=randomBytes(32).toString('base64url');
  const env={PATH:'/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_STATE_HOME:`${root}/state`,XDG_CACHE_HOME:`${root}/cache`,XDG_RUNTIME_DIR:`${root}/runtime`,TMPDIR:`${root}/tmp`,DBUS_SESSION_BUS_ADDRESS:'disabled:',M1_GUARD_ROOT:root,OPENCODE_PASSWORD:password};
  const headers={authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`};
  let child:ReturnType<typeof spawn>|undefined;let spawnFailed=false;let port=0;let timer:ReturnType<typeof setTimeout>|undefined;
  let stage='prepare';let failureCode:string|null=null;let imported=false;let cleanupUncertain=false;let proof:ReturnType<typeof productionStoreProof>|null=null;
  let diagnostics:ReturnType<ReturnType<typeof destinationClient>['diagnostics']>={destinationStage:null,sessionHadErrorPart:null,assistantToolCounts:null,productionToolFacts:null};
  let sourceAccess=false;let credentialsRemoved=false;let authRootsRemoved=false;let processStopped=false;let prepared=false;
  let counters={admissions:0,dispatches:0,toolSnapshots:0};let httpStatuses:{kind:string;status:number}[]=[];let retryDenials=0;
  const cancel=()=>abort.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  function groupAlive() {if(!child?.pid||spawnFailed)return false;try{process.kill(-child.pid,0);return true;}catch(e){insist((e as NodeJS.ErrnoException).code==='ESRCH','cleanup');return false;}}
  async function stop(hard=false) {
    if(!child?.pid||spawnFailed)return;
    const kill=(signal:NodeJS.Signals)=>{if(groupAlive())process.kill(-child!.pid!,signal);};
    const exited=child.exitCode===null&&child.signalCode===null?once(child,'exit'):Promise.resolve();
    const limit=setTimeout(()=>kill('SIGKILL'),3000);
    try{kill(hard?'SIGKILL':'SIGTERM');await exited;}finally{clearTimeout(limit);}
    const end=Date.now()+3000;while(groupAlive()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
    insist(!groupAlive(),'cleanup');
  }
  async function api(route:string,body?:unknown) {
    insist(port>0&&!abort.signal.aborted,'destination');
    try {
      const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...headers,'content-type':'application/json'},redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(5000)]),...(body===undefined?{}:{body:JSON.stringify(body)})});
      insist(response.ok&&!response.redirected,'destination');return await response.json();
    }catch{throw new LiveSafetyError('destination');}
  }
  try {
    for(const dir of ['home','config/opencode','data/opencode','state','cache','runtime','tmp','project','store'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    for(let dir=path.dirname(root);;dir=path.dirname(dir)){for(const name of ['opencode.json','opencode.jsonc','.opencode/opencode.json','.opencode/opencode.jsonc'])insist(!existsSync(path.join(dir,name)),'ledger');if(dir===path.dirname(dir))break;}
    insist(!existsSync('/etc/opencode'),'ledger');
    const artifact=path.resolve('build/artifacts/agent-progress-companion-0.2.0');
    const inventory=readFileSync('build/artifacts/sha256.txt','utf8');
    function verifiedCopy(from:string,to:string) {
      const relative=path.relative(path.resolve('build/artifacts'),from);
      insist(inventory.split('\n').some(line=>line===`${digest(readFileSync(from))}  ${relative}`),'ledger');
      mkdirSync(path.dirname(to),{recursive:true,mode:0o700});cpSync(from,to);
    }
    for(const entry of ['companion/index.js','companion/SKILL.md','companion/package.json','setup/main.js']) {
      const file=`${artifact}/build/${entry}`;const relative=path.relative(path.resolve('build/artifacts'),file);
      insist(inventory.split('\n').includes(`${digest(readFileSync(file))}  ${relative}`),'ledger');
    }
    const installed=spawnSync(process.execPath,[`${artifact}/build/setup/main.js`,'install',`--config-root=${root}/config/opencode`,`--data-root=${root}/data/opencode`,`--store-root=${root}/store`,'--confirm=true'],{encoding:'utf8',env,stdio:['ignore','pipe','ignore'],timeout:10000});
    insist(installed.status===0,'ledger');const installedResult=JSON.parse(installed.stdout);insist(installedResult.version==='0.2.0'&&installedResult.activation==='reload-required','ledger');
    const binding=readBinding(`${root}/config/opencode/plugins/agent-progress/progress-binding.json`);
    // Keep a non-secret, standalone host-service layout for Lane B. No UI copied.
    for(const entry of ['companion/index.js','companion/SKILL.md','companion/package.json','setup/main.js'])verifiedCopy(`${artifact}/build/${entry}`,`${root}/service-package/build/${entry}`);
    verifiedCopy(path.resolve('build/artifacts/agent-progress-extension-0.2.0/build/service/main.js'),`${root}/service-package/build/service/main.js`);
    writeFileSync(`${root}/service-package/package.json`,'{"type":"module","version":"0.2.0"}',{mode:0o600});
    cpSync(`${root}/config/opencode/plugins/agent-progress/progress-binding.json`,`${root}/service-package/build/service/progress-binding.json`);
    const before=new Store(binding.database,{readOnly:true});try{insist(Number(before.db.prepare('SELECT count(*) AS n FROM plans').get()!.n)===0&&Number(before.db.prepare('SELECT count(*) AS n FROM receipts').get()!.n)===0,'ledger');}finally{before.close();}
    const model=`${PROVIDER}/${DEFAULT_MODEL}`;
    const agents=Object.fromEntries(['build','plan','general','explore','compaction','title','summary'].map(id=>[id,{model,steps:5}]));
    writeFileSync(`${root}/config/opencode/opencode.json`,JSON.stringify({$schema:'https://opencode.ai/config.json',update:'disable',snapshots:false,model,agents}),{mode:0o600});
    writeFileSync(`${root}/guard-state.json`,JSON.stringify({pid:0,locations:[directory],armed:false,deadline:Date.now()+120_000,dispatches:0,activations:{},shaped:{},retriesDenied:0,modelID:DEFAULT_MODEL} satisfies Ledger),{mode:0o600});
    const guardDirectory=`${root}/config/opencode/plugins/m1-auth-guard`;mkdirSync(guardDirectory,{mode:0o700});
    const built=spawnSync('bun',['build',fileURLToPath(new URL('../tests/fixtures/auth-guard.ts',import.meta.url)),'--target=node','--format=esm',`--outfile=${guardDirectory}/index.js`],{env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:env.HOME,TMPDIR:env.TMPDIR},stdio:'ignore'});insist(built.status===0,'ledger');
    writeFileSync(`${guardDirectory}/package.json`,'{"name":"m1-auth-guard","version":"0.0.1","type":"module","exports":{".":"./index.js"}}',{mode:0o600});
    const resolved=execFileSync(binary,['debug','paths'],{env,encoding:'utf8',stdio:['ignore','pipe','ignore']});
    const paths=resolved.trim().split('\n').map(line=>line.trim().split(/\s+/).slice(1).join(' '));insist(paths.length>0&&paths.every(p=>p.startsWith(`${root}/`)),'ledger');
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:directory,env,stdio:'ignore',detached:true});child.once('error',()=>{spawnFailed=true;abort.abort();});
    insist(child.pid,'ledger');changeState(root,s=>{s.pid=child!.pid!;});
    stage='startup';let info:any;const end=Date.now()+15000;
    while(Date.now()<end){insist(!spawnFailed&&child.exitCode===null,'ledger');try{info=await api('/api/info');break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
    insist(info?.pid===child.pid&&info.version==='2.1.4'&&realpathSync(`/proc/${child.pid}/exe`)===binary,'ledger');
    const actual=Object.fromEntries(readFileSync(`/proc/${child.pid}/environ`,'utf8').split('\0').filter(p=>p.includes('=')).map(p=>[p.slice(0,p.indexOf('=')),p.slice(p.indexOf('=')+1)]));
    insist(['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','XDG_RUNTIME_DIR','TMPDIR'].every(k=>actual[k]===env[k as keyof typeof env]),'ledger');
    const schema=await api('/openapi.json');insist(schema.paths?.['/api/credential']?.get?.operationId==='credential.list'&&schema.paths?.['/api/credential']?.post?.operationId==='credential.create'&&schema.paths?.['/api/credential/{credentialID}']?.delete?.operationId==='credential.remove','ledger');
    const client=OpenCode.make({baseUrl:`http://127.0.0.1:${port}`,headers});
    insist((await client.credential.list()).length===0,'destination');
    stage='prewarm';const query=`?${new URLSearchParams({'location[directory]':directory})}`;await api(`/api/location${query}`);
    let active=false;const readyBy=Date.now()+15000;
    while(Date.now()<readyBy) {
      const plugins=(await api(`/api/plugin${query}`)).data;
      active=['agent-progress','m1-auth-guard'].every(id=>plugins.some((p:any)=>p.id===id&&p.state.status==='active'));
      if(active||plugins.some((p:any)=>['agent-progress','m1-auth-guard'].includes(p.id)&&p.state.status==='failed'))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    insist(active,'ledger');
    const guard=client.rpc(Control);const snapshot=await guard.inspect({},{location:{directory}}) as any;
    insist(snapshot.progressToolAvailable&&snapshot.narrowedCatalogTools?.length===1&&snapshot.narrowedCatalogTools[0]==='agent_progress_report'&&Object.keys(readState(root).activations).length===1,'ledger');
    const progress=await client.rpc(ProgressStatus).inspect({},{location:{directory}}) as any;
    insist(progress.version==='0.2.0'&&progress.protocolVersion===2&&progress.toolAvailable&&progress.codemodeDisabled&&progress.storeId===binding.storeId&&progress.sourceId===binding.source.id,'ledger');
    const actualAgents=(await api(`/api/agent${query}`)).data;
    insist(actualAgents.length>0&&actualAgents.every((a:any)=>a.model?.providerID===PROVIDER&&a.model?.id===DEFAULT_MODEL),'ledger');
    insist((await client.credential.list()).length===0,'destination');credentialsRemoved=true;prepared=true;
    stage='session';
    const session=(await api('/api/session',{title:'T6 tiny synthetic lifecycle',model:{providerID:PROVIDER,id:DEFAULT_MODEL},agent:'build',location:{directory}})).data;
    insist(typeof session?.id==='string'&&/^ses_[A-Za-z0-9_-]+$/.test(session.id),'destination');
    const bound=(await api(`/api/session/${session.id}`)).data;
    insist(bound.id===session.id&&bound.agent==='build'&&!bound.parentID&&bound.location?.directory===directory,'ledger');
    if(live) {
      const deadline=Date.now()+90_000;
      changeState(root,s=>{s.deadline=deadline;s.armed=true;s.live={sessionID:session.id,admissions:0,toolSnapshots:0,failed:false,bindings:{[session.id]:{agent:'build',directory}}};});
      timer=setTimeout(()=>{abort.abort();if(groupAlive())process.kill(-child!.pid!,'SIGKILL');},90000);
      stage='source';sourceAccess=true;
      const source=await resolveManagedSource(abort.signal);
      insist((await source.models()).some(m=>m.providerID===PROVIDER&&m.id===DEFAULT_MODEL&&m.capabilities.tools),'selection');
      stage='bounded-production';
      const destination=destinationClient(`http://127.0.0.1:${port}`,password,fetch,abort.signal);
      const result=await runRootWithCopy({source,destination,endpoint:`http://127.0.0.1:${port}`,pid:child.pid!,root,sessionID:session.id,modelID:DEFAULT_MODEL,deadline,signal:abort.signal,
        assertReady(){const s=readState(root);insist(!abort.signal.aborted&&Date.now()<deadline&&child?.exitCode===null&&child.signalCode===null&&s.armed&&s.pid===child.pid&&s.locations.length===1&&s.locations[0]===directory&&Object.keys(s.activations).length===1&&s.live&&!s.live.failed&&s.live.sessionID===session.id&&s.live.admissions<=6&&s.dispatches<=12,'ledger');},
        stop,dispose(){/* Keep production store/config; outer finally removes auth roots after stop. */},
        async exercise(client,boundary) {
          boundary();const observed=await client.production(session.id);boundary();
          proof=productionStoreProof(binding.database,binding.source.id,session.id,directory,observed.calls);
          return observed.calls.length;
        },
      });
      imported=result.imported;cleanupUncertain=result.cleanupUncertain;failureCode=result.failure;diagnostics=destination.diagnostics();credentialsRemoved=!result.cleanupUncertain;
      const s=readState(root);
      if(!failureCode)insist(s.live&&!s.live.failed&&s.live.admissions>0&&s.dispatches>0&&s.dispatches<=12&&s.live.admissions<=6&&s.httpStatuses?.length===s.dispatches&&s.httpStatuses.every(r=>r.status===200)&&s.retriesDenied===0&&proof,'ledger');
    }else {
      stage='synthetic';changeState(root,s=>{s.armed=true;});
      const pipeline=await guard.pipeline({kind:'primary'},{location:{directory}}) as any;
      insist(pipeline.allowed&&pipeline.shapedMaxTokens===900&&pipeline.retryDenied&&pipeline.transportCalls===0,'ledger');
      insist((await client.credential.list()).length===0,'destination');
      await stop();
      const synthetic=spawnSync(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./package-guidance.ts',import.meta.url)),directory,'0.2.0'],{env,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:15000});
      insist(synthetic.status===0,'action');const report=JSON.parse(synthetic.stdout);
      insist(report.packagedGuidance&&report.loadedToolHonorsDisableEnable&&report.modelRequests===0,'action');
    }
  }catch(e){failureCode=e instanceof LiveSafetyError?e.code:'ledger';}
  finally {
    if(timer)clearTimeout(timer);
    if(existsSync(`${root}/guard-state.json`)) {
      try{const s=readState(root);if(live){counters={admissions:s.live?.admissions??0,dispatches:s.dispatches,toolSnapshots:s.live?.toolSnapshots??0};httpStatuses=(s.httpStatuses??[]).map(r=>({kind:['primary','compaction','generate','title'].includes(r.kind)?r.kind:'unknown',status:r.status}));retryDenials=s.retriesDenied;}}
      catch{failureCode??='ledger';}
    }
    try{await stop(cleanupUncertain);processStopped=!groupAlive();}catch{failureCode='cleanup';}
    if(processStopped) {
      try {
        owned();
        // OpenCode's auth/session DB and any potential logs/cache/sidefiles are
        // disposable. The separate production store and owned companion stay.
        for(const dir of ['home','data','state','cache','runtime','tmp'])rmSync(`${root}/${dir}`,{recursive:true,force:true});
        mkdirSync(`${root}/data/opencode`,{recursive:true,mode:0o700});
        authRootsRemoved=['home','state','cache','runtime','tmp'].every(dir=>!existsSync(`${root}/${dir}`))&&readdirSync(`${root}/data/opencode`).length===0;
        insist(authRootsRemoved,'cleanup');
        // Guard retirement is AFTER credential removal, process stop and purge.
        rmSync(`${root}/config/opencode/plugins/m1-auth-guard`,{recursive:true,force:true});rmSync(`${root}/guard-state.json`,{force:true});
        if(!live){rmSync(root,{recursive:true});}
      }catch{failureCode='cleanup';}
    }
    process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
    const result={passed:failureCode===null,failureCode,failureStage:failureCode?stage:null,syntheticOnly:!live,sourceAccess,productionCompanion:true,version:'0.2.0',model:{providerID:PROVIDER,id:DEFAULT_MODEL},prepared,imported,counters,httpStatuses,retryDenials,assistantToolCounts:diagnostics.assistantToolCounts,productionToolFacts:diagnostics.productionToolFacts,sessionHadErrorPart:diagnostics.sessionHadErrorPart,destinationStage:diagnostics.destinationStage,validation:proof,cleanup:{credentialRemovedAndEmptyVerified:credentialsRemoved,authRootsRemoved,authRootsRemaining:authRootsRemoved?0:null,ownedProcessesRemaining:processStopped?0:null,processStopped,productionStoreRetained:live&&existsSync(`${root}/store/progress.sqlite`),fixtureRetained:live&&existsSync(root)}};
    writeFileSync(evidence,JSON.stringify(result,null,2)+'\n',{mode:0o600,...(live?{flag:'wx'}:{})});
    console.log(JSON.stringify(result));if(failureCode)process.exitCode=1;
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(!['--synthetic','--live','--synthetic2','--live2'].includes(process.argv[2])){console.log(JSON.stringify({passed:false,failureCode:'ledger',liveEnabled:false}));process.exitCode=2;}
  else try{await main(['--live','--live2'].includes(process.argv[2]),process.argv[2].endsWith('2')?2:1);}catch(e){console.log(JSON.stringify({passed:false,failureCode:e instanceof LiveSafetyError?e.code:'ledger'}));process.exitCode=1;}
}
