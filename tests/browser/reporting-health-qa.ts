// Current-bundle browser QA over real disposable stores. Synthetic SDK seams are explicit;
// this does not certify a native host, screen reader, live profile or installed companion.
// node --experimental-strip-types tests/browser/reporting-health-qa.ts <artifact-directory> [--built-service]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startSearchShell } from './plan-task-search-shell.ts';

const output=process.argv[2];if(!output)throw Error('Pass an artifact directory.');mkdirSync(output,{recursive:true});
const cache=join(homedir(),'.cache/ms-playwright');
const candidates=[...(existsSync(cache)?readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse().map(n=>join(cache,n,'chrome-linux64/chrome')):[]),'/usr/bin/chromium','/usr/bin/google-chrome'];
const executable=candidates.find(existsSync);if(!executable)throw Error('No installed Chromium; this test never downloads a browser.');
const profile=mkdtempSync('/tmp/opencode/reporting-health-qa-');
const fx=await startSearchShell(true, true);
const chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-sync','--window-size=1280,1100','about:blank'],{stdio:'ignore'});
const results:{id:string;pass:boolean;facts?:unknown}[]=[];let ws:WebSocket|undefined;let failure:string|null=null;let diagnose:(()=>Promise<unknown>)|undefined;
try{
  for(let n=0;!existsSync(join(profile,'DevToolsActivePort'))&&n<200;n++)await new Promise(r=>setTimeout(r,50));
  const port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find((t:any)=>t.type==='page').webSocketDebuggerUrl);
  await new Promise<void>((resolve,reject)=>{ws!.onopen=()=>resolve();ws!.onerror=()=>reject(Error('Browser connection failed.'));});
  let next=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();const remote:string[]=[];let runtimeErrors=0;
  ws.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else{if(m.method==='Runtime.exceptionThrown')runtimeErrors++;if(m.method==='Network.requestWillBeSent'&&!m.params.request.url.startsWith('http://127.0.0.1:')&&!m.params.request.url.startsWith('data:'))remote.push(m.params.request.url);}};
  const send=(method:string,params:object={})=>new Promise<any>((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws!.send(JSON.stringify({id,method,params}));});
  const evaluate=async<T=any>(expression:string):Promise<T>=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??'Browser expression failed');return r.result.value;};
  const guest=<T=any>(code:string)=>evaluate<T>(`(()=>{const w=frame('page').contentWindow,d=w.document;${code}})()`);
  diagnose=()=>guest(`return {health:d.querySelector('[data-testid="reporting-health"]')?.textContent,active:d.activeElement?.outerHTML,query:d.getElementById('ap-search-q')?.value,search:d.querySelector('[data-testid="search-results"]')?.textContent?.slice(0,2500),buttons:[...d.querySelectorAll('button')].map(n=>n.textContent).slice(-30),requests:qa.requests.slice(-8).map(q=>({path:q.path,frame:q.frame}))}`);
  const wait=async(condition:string,label:string)=>{const ok=await evaluate(`(async()=>{const end=performance.now()+20000;while(performance.now()<end){try{const w=frame('page').contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>setTimeout(r,25))}return false})()`);if(!ok)throw Error('Timed out: '+label);};
  const check=(id:string,pass:boolean,facts?:unknown)=>{results.push({id,pass,...(facts===undefined?{}:{facts})});if(!pass)throw Error('Failed: '+id);};
  const key=async(k:string)=>{const code:Record<string,number>={Enter:13,Tab:9,ArrowDown:40,ArrowUp:38,Escape:27,Home:36};await send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:code[k]??0,...(k==='Enter'?{text:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:code[k]??0});};
  const click=async(selector:string)=>{const xy=await evaluate(`(()=>{const f=frame('page'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)throw Error(${JSON.stringify('Missing control: '+selector)});n.scrollIntoView({block:'center'});const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return [a.x+b.x+Math.min(16,a.width/2),a.y+b.y+Math.min(10,a.height/2)]})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:xy[0],y:xy[1],button:'left',clickCount:1});};
  const focus=async(selector:string)=>guest(`d.querySelector(${JSON.stringify(selector)}).focus();return true`);
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.navigate',{url:`http://127.0.0.1:${fx.port}/`});await wait(`!!d.querySelector('[data-testid="reporting-health-toggle"] button')`,'health control');await evaluate(`qa.show(['page'],1100);true`);
  await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`!!d.querySelector('[data-testid="reporting-support-preview"]')`,'observations');
  check('keyboard-open',await guest(`return d.querySelector('[data-testid="reporting-health"]').textContent.includes('Reporting health')`));
  check('privacy-preview',await guest(`return !/fixture|source-|account-|private|\\//.test(d.querySelector('[data-testid="reporting-support-preview"]').value)`));
  await guest(`Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('fixture rejection'))}});return true`);
  await click('[data-testid="reporting-support-copy"] button');await wait(`d.querySelector('[data-testid="reporting-health"]').textContent.includes('manually')`,'copy fallback');check('copy-fallback',true);
  await guest(`const n=d.querySelector('[data-testid="reporting-support-preview"]');n.focus();n.setSelectionRange(3,24);return true`);
  await guest(`d.querySelector('[data-testid="reporting-support-preview"]').dataset.qaOld='true';d.querySelector('[data-testid="reporting-support-copy"] button').click();return true`);await wait(`d.querySelector('[data-testid="reporting-support-preview"]')?.dataset.qaOld===undefined&&d.querySelector('[data-testid="reporting-support-preview"]')?.selectionStart===3`,'selection retained after actual replacement');check('selection-preserved-on-repaint',await guest(`return d.querySelector('[data-testid="reporting-support-preview"]').selectionEnd===24`));
  await evaluate(`qa.show(['page'],360);true`);await wait('w.innerWidth===360','narrow');check('narrow-preview',await guest(`const n=d.querySelector('[data-testid="reporting-support-preview"]');return n.getBoundingClientRect().width<=360`));
  await evaluate('new Promise(r=>setTimeout(r,250))');
  if(await guest(`return !d.querySelector('[data-testid="reporting-support-preview"]')`)){await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`!!d.querySelector('[data-testid="reporting-support-preview"]')`,'reopen after host context update');}
  await guest(`d.querySelector('[data-testid="reporting-health"]').scrollIntoView({block:'start'});return true`);const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'reporting-health-narrow.png'),Buffer.from(shot.data,'base64'));
  await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`!d.querySelector('[data-testid="reporting-support-preview"]')`,'preview closed');check('close-clears-preview',await guest(`return !d.querySelector('[data-testid="reporting-support-preview"]')`));
  await wait(`d.querySelector('[data-testid="reporting-health-toggle"] button')?.textContent==='Reporting health'`,'closed');await evaluate(`qa.holds.push({path:'/v1/setup',tag:'health',frame:'page'});true`);await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`qa.held.some(h=>h.tag==='health')`,'held setup');await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await evaluate(`qa.release('health');true`);await evaluate('new Promise(r=>setTimeout(r,150))');check('closed-reply-discarded',await guest(`return !d.querySelector('[data-testid="reporting-support-preview"]')`));
  check('no-runtime-errors',runtimeErrors===0);
}catch(error){failure=error instanceof Error?error.message:String(error);process.exitCode=1;if(diagnose)writeFileSync(join(output,'failure-state.json'),JSON.stringify(await diagnose().catch(()=>null),null,2));}
finally{writeFileSync(join(output,'results.json'),JSON.stringify({scope:'synthetic SDK shell, current guest bundles and disposable HTTP stores',results,failure},null,2));ws?.close();chrome.kill('SIGTERM');await fx.stop();await new Promise(r=>setTimeout(r,200));rmSync(profile,{recursive:true,force:true});}
console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,failure}));
