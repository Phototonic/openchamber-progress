// Opt-in real Orca speech-text verification. Never connects to the caller's desktop or buses.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { once } from 'node:events';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const artifacts=resolve(arg('--artifacts')??join(dirname(execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8'}).trim()),'evidence/dependency-map/accessibility/orca-automated'));
const privateChild=process.argv.includes('--private-child');
const required=['/usr/bin/orca','/usr/bin/Xvfb','/usr/bin/xdotool','/usr/bin/dbus-run-session','/usr/bin/dbus-daemon','/usr/bin/python3','/usr/bin/speech-dispatcher','/usr/libexec/at-spi-bus-launcher'];
const missing=required.filter(p=>!existsSync(p));
if(missing.length){console.log('SKIP: isolated Orca verification requires '+missing.map(p=>p.split('/').pop()).join(', '));process.exit(0);}
mkdirSync(artifacts,{recursive:true});
if(!privateChild){
  const chromium=arg('--chromium')??process.env.CHROMIUM_PATH??(()=>{const cache=join(homedir(),'.cache/ms-playwright');if(existsSync(cache))for(const name of readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]))){const p=join(cache,name,'chrome-linux64/chrome');if(existsSync(p))return p;}return ['/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);})();
  if(!chromium){console.log('SKIP: no installed Chromium (nothing is downloaded).');process.exit(0);}
  const root=mkdtempSync('/tmp/opencode/dependency-map-orca-');
  for(const p of ['home','config','data','cache','run','tmp'])mkdirSync(join(root,p),{mode:0o700});
  writeFileSync(join(root,'alsa.conf'),'pcm.!default { type null }\npcm.null { type null }\n');
  const number=Array.from({length:100},(_,n)=>n+99).find(n=>!existsSync(`/tmp/.X11-unix/X${n}`)&&!existsSync(`/tmp/.X${n}-lock`));
  if(number===undefined)throw Error('No free private X display');
  // Allowlist, not an inherited desktop environment. In particular no live DISPLAY, Wayland,
  // session/system accessibility address, Pulse/PipeWire socket or user configuration escapes.
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',DISPLAY:`:${number}`,XAUTHORITY:join(root,'xauthority'),HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_RUNTIME_DIR:join(root,'run'),TMPDIR:join(root,'tmp'),ORCA_PRIVATE_ROOT:root,PULSE_SERVER:'unix:'+join(root,'no-pulse'),PIPEWIRE_REMOTE:'no-pipewire',ALSA_CONFIG_PATH:join(root,'alsa.conf'),CANBERRA_DRIVER:'null',SPEECHD_CMD:'/bin/false',ACCESSIBILITY_ENABLED:'1',GTK_A11Y:'atspi',GTK_USE_PORTAL:'0',GIO_USE_VFS:'local',GSETTINGS_BACKEND:'memory',XDG_SESSION_TYPE:'x11'};
  const child=spawn('/usr/bin/dbus-run-session',['--',process.execPath,'--experimental-strip-types',resolve(import.meta.filename),'--private-child','--artifacts',artifacts,'--chromium',chromium,...(process.argv.includes('--probe')?['--probe']:[])],{env,stdio:['ignore','pipe','pipe'],detached:true});
  for(const stream of [child.stdout,child.stderr])stream?.on('data',b=>writeFileSync(join(root,'session.log'),b,{flag:'a'}));
  let terminating=false;const stop=()=>{terminating=true;try{const p=join(root,'worker.pid');if(existsSync(p))process.kill(Number(readFileSync(p,'utf8')),'SIGTERM');else process.kill(-child.pid!,'SIGTERM');}catch{}};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const [code]=await once(child,'exit');process.off('SIGINT',stop);process.off('SIGTERM',stop);
  // dbus-run-session and its private bus exit with the child; remove only this run's files.
  try{process.kill(-child.pid!,'SIGTERM');}catch{}
  rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  console.log('Isolated Orca run finished; exit '+(code??1)+'. No live desktop session used.');
  process.exitCode=terminating?130:(code??1);
}else{
  const root=process.env.ORCA_PRIVATE_ROOT!;
  if(!root?.startsWith('/tmp/opencode/dependency-map-orca-')||!process.env.DBUS_SESSION_BUS_ADDRESS||process.env.HOME!==join(root,'home'))throw Error('Refusing non-private session');
  writeFileSync(join(root,'worker.pid'),String(process.pid));
  const children:ChildProcess[]=[];
  const run=(file:string,args:string[],name:string)=>{const log=join(root,name+'.log');const child=spawn(file,args,{env:process.env,stdio:['ignore','pipe','pipe']});child.stdout?.on('data',b=>{writeFileSync(log,b,{flag:'a'});});child.stderr?.on('data',b=>{writeFileSync(log,b,{flag:'a'});});children.push(child);return child;};
  const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn:()=>boolean,label:string,ms=10000)=>{const end=Date.now()+ms;while(!fn()){if(interrupted)throw Error('Isolated run interrupted');if(Date.now()>end)throw Error('Isolated setup timed out: '+label);await pause(50);}};
  let fixture:ChildProcess|undefined,interrupted=false;
  const stop=()=>{interrupted=true;fixture?.kill('SIGINT');};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try{
    const number=Number(process.env.DISPLAY?.slice(1));
    if(number<99||number>198||existsSync(`/tmp/.X11-unix/X${number}`))throw Error('Refusing non-private or occupied display');
    const xvfb=run('/usr/bin/Xvfb',[`:${number}`,'-screen','0','1600x1200x24','-nolisten','tcp','-ac','-noreset'],'xvfb');
    await until(()=>existsSync(`/tmp/.X11-unix/X${number}`)&&existsSync(`/tmp/.X${number}-lock`)&&Number(readFileSync(`/tmp/.X${number}-lock`,'utf8').trim())===xvfb.pid,'owned private Xvfb socket');
    writeFileSync(join(root,'xvfb.pid'),String(xvfb.pid));
    const speech=join(root,'speech');mkdirSync(speech);mkdirSync(join(root,'speech-log'));
    writeFileSync(join(root,'alsa.conf'),'pcm.!default { type null }\npcm.null { type null }\n');process.env.ALSA_CONFIG_PATH=join(root,'alsa.conf');process.env.SPEECHD_CMD='/bin/false';
    writeFileSync(join(speech,'speechd.conf'),'LogLevel 3\nAddModule "dummy" "sd_dummy" ""\nDefaultModule "dummy"\nDefaultVolume 0\nAudioOutputMethod "alsa"\nAudioALSADevice "null"\n');
    const socket=join(root,'run','speechd.sock');process.env.SPEECHD_ADDRESS='unix_socket:'+socket;
    run('/usr/bin/speech-dispatcher',['-s','-C',speech,'-S',socket,'-L',join(root,'speech-log'),'-P',join(root,'speech.pid'),'-t','0'],'speechd');
    await until(()=>existsSync(socket),'dummy speech-dispatcher socket');
    run('/usr/libexec/at-spi-bus-launcher',['--launch-immediately','--a11y=1','--screen-reader=1'],'atspi');
    // The distro launcher selects dbus-broker, which tries a systemd user manager absent in a
    // private dbus-run-session. Use the installed accessibility policy on a private dbus-daemon.
    const busSocket=join(root,'run','atspi-bus');process.env.AT_SPI_BUS_ADDRESS='unix:path='+busSocket;
    const busConfig=join(root,'accessibility.conf');writeFileSync(busConfig,readFileSync('/usr/share/defaults/at-spi2/accessibility.conf','utf8').replace('unix:dir=/tmp',process.env.AT_SPI_BUS_ADDRESS));
    run('/usr/bin/dbus-daemon',['--config-file='+busConfig,'--nofork','--print-address=1'],'atspi-daemon');
    await until(()=>existsSync(busSocket),'private AT-SPI daemon socket');
    if(process.argv.includes('--probe'))run('/usr/bin/python3',['-c',`import gi;gi.require_version('Gtk','3.0');from gi.repository import Gtk;w=Gtk.Window(title='Synthetic accessibility transport');w.add(Gtk.Button(label='Synthetic native transport button'));w.show_all();Gtk.main()`],'native-probe');
    const prefs=join(root,'config','orca');mkdirSync(prefs,{recursive:true});
    const general={enableSpeech:true,silenceSpeech:false,enableBraille:false,enableSound:false,enableKeyEcho:false,enableMouseReview:false,speechServerFactory:'speechdispatcherfactory',speechServerInfo:['Dummy','dummy'],speechFactoryModules:['speechdispatcherfactory'],startingProfile:['Default','default'],activeProfile:['Default','default']};
    writeFileSync(join(prefs,'user-settings.conf'),JSON.stringify({general,profiles:{default:{profile:['Default','default']}},pronunciations:{},keybindings:{}}));
    const log=join(root,'orca-debug.log');
    const versions=execFileSync('dpkg-query',['-W','-f=${Package} ${Version}\n','orca','at-spi2-core','speech-dispatcher'],{encoding:'utf8'}).trim();
    writeFileSync(join(artifacts,'environment.json'),JSON.stringify({versions:versions.split('\n'),runtime:process.version,display:'private Xvfb display (never live DISPLAY)',session:'dbus-run-session with private AT-SPI bus',home:'disposable HOME/XDG configuration/runtime/data/cache',speech:'private speech-dispatcher; only sd_dummy loaded; invalid private Pulse/PipeWire sockets and ALSA null sink',debugSink:'Line-buffered diagnostic file, unchanged installed Orca entry point via runpy',humanListenerAcceptance:false,ownerDecision:'automated speech-text verification accepted without owner review'},null,2)+'\n');
    const ready=join(root,'fixture-ready'),running=join(root,'orca-running');
    fixture=run(process.execPath,['--experimental-strip-types','tests/browser/plan-task-search-qa.ts','--only','dependency-map-screen-reader','--built-service','--headed','--chromium',arg('--chromium')!,'--orca-automated','--orca-log',log,'--orca-ready',ready,'--orca-running',running,'--artifacts',artifacts,...(process.argv.includes('--probe')?['--orca-probe']:[])],'fixture');
    await until(()=>existsSync(ready),'headed synthetic fixture ready',30000);
    // Orca's --debug-file opens a block-buffered text file. A quiet UI can leave the
    // final dispatch in that buffer indefinitely, falsely attributing speech to the
    // next action that fills it. Configure only the diagnostic sink, line-buffered,
    // then execute the unchanged installed Orca entry point and speech machinery.
    run('/usr/bin/python3',['-c',`import sys,runpy
from orca import debug
debug.debugLevel=debug.LEVEL_ALL
debug.debugFile=open(sys.argv[1], 'w', encoding='utf-8', buffering=1)
sys.argv=['/usr/bin/orca']+sys.argv[2:]
runpy.run_path('/usr/bin/orca',run_name='__main__')`,log,'--user-prefs',prefs,'--disable','braille','--disable','sound'],'orca');
    await until(()=>existsSync(log)&&readFileSync(log,'utf8').includes('SPEECH OUTPUT'),'Orca speech logging',15000);
    writeFileSync(running,'ready');
    const [code]=await once(fixture,'exit');process.exitCode=interrupted?130:(code??1);
  }catch(e){
    const message=(e instanceof Error?e.message:String(e)).replaceAll(root,'[disposable]');
    const diagnostics=Object.fromEntries(['orca','speechd','atspi','xvfb','fixture'].map(name=>{const p=join(root,name+'.log');return[name,existsSync(p)?readFileSync(p,'utf8').split('\n').filter(s=>/error|failed|warning|exception|dummy/i.test(s)).slice(-12).map(s=>s.replaceAll(root,'[disposable]').replace(/\/(?:home|Users)\/[^\s'"<>]+/g,'[private path]')):[]];}));
    writeFileSync(join(artifacts,'setup-failure.json'),JSON.stringify({status:'blocked',message,diagnostics},null,2)+'\n');console.error(message);process.exitCode=1;
  }finally{
    process.off('SIGTERM',stop);process.off('SIGINT',stop);
    if(fixture&&fixture.exitCode===null){fixture.kill('SIGINT');await Promise.race([once(fixture,'exit'),pause(10000)]);}
    // Also reap descendants such as AT-SPI registry, sd_dummy and detached Chromium. These
    // processes carry our allowlisted private HOME, not the owner's desktop environment.
    const own=(pid:number)=>{try{return readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').includes('ORCA_PRIVATE_ROOT='+root);}catch{return false;}};
    const pids=readdirSync('/proc').filter(n=>/^\d+$/.test(n)).map(Number).filter(pid=>pid!==process.pid&&pid!==process.ppid&&own(pid));
    for(const pid of pids)try{process.kill(pid,'SIGTERM');}catch{}
    await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():Promise.race([once(child,'exit'),pause(2000)])));
    for(const pid of pids)if(own(pid))try{process.kill(pid,'SIGKILL');}catch{}
    writeFileSync(join(artifacts,'cleanup.json'),JSON.stringify({privateSessionOnly:true,remainingOwnedProcesses:pids.filter(own).length},null,2)+'\n');
  }
}
