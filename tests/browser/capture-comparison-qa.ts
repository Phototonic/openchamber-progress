// Current-bundle browser QA over real disposable stores. Synthetic SDK seams are explicit;
// this does not certify a native host, screen reader, live profile or installed companion.
// node --experimental-strip-types tests/browser/capture-comparison-qa.ts <artifact-directory> [--built-service]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startSearchShell } from './plan-task-search-shell.ts';

const output=process.argv[2];if(!output)throw Error('Pass an artifact directory.');mkdirSync(output,{recursive:true});
const cache=join(homedir(),'.cache/ms-playwright');
const candidates=[...(existsSync(cache)?readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse().map(n=>join(cache,n,'chrome-linux64/chrome')):[]),'/usr/bin/chromium','/usr/bin/google-chrome'];
const executable=candidates.find(existsSync);if(!executable)throw Error('No installed Chromium; this test never downloads a browser.');
const profile=mkdtempSync('/tmp/opencode/capture-comparison-qa-');
const fx=await startSearchShell(process.argv.includes('--built-service'));
const plan='P-0006',outside='P-1001';
const original='# Example plan\r\nKeep this line\r\nOld action\r\n';
const hostile='# Example plan\nKeep this line\nNew action ✅\n<img src="https://invalid.test/never-load" onerror="window.bad=1">\n<script>window.bad=1</script>\n';
const first=fx.recordDocument(plan,original),second=fx.recordDocument(plan,hostile,'/fixture/revised-plan.md');
const deep=Array.from({length:20000},(_,i)=>`Line ${i+1}\n`).join('');
fx.recordDocument(outside,deep);fx.recordDocument(outside,deep.replace('Line 19998','Edit 19998'));
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
  diagnose=()=>guest(`return {query:d.getElementById('ap-search-q')?.value,search:d.querySelector('[data-testid="search-results"]')?.textContent?.slice(0,2500),buttons:[...d.querySelectorAll('button')].map(n=>n.textContent).slice(-30),requests:qa.requests.slice(-8).map(q=>({path:q.path,frame:q.frame}))}`);
  const wait=async(condition:string,label:string)=>{const ok=await evaluate(`(async()=>{const end=performance.now()+20000;while(performance.now()<end){try{const w=frame('page').contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>setTimeout(r,25))}return false})()`);if(!ok)throw Error('Timed out: '+label);};
  const check=(id:string,pass:boolean,facts?:unknown)=>{results.push({id,pass,...(facts===undefined?{}:{facts})});if(!pass)throw Error('Failed: '+id);};
  const key=async(k:string)=>{const code:Record<string,number>={Enter:13,Tab:9,ArrowDown:40,ArrowUp:38,Escape:27,Home:36};await send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:code[k]??0,...(k==='Enter'?{text:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:code[k]??0});};
  const click=async(selector:string)=>{const xy=await evaluate(`(()=>{const f=frame('page'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)throw Error(${JSON.stringify('Missing control: '+selector)});n.scrollIntoView({block:'center'});const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return [a.x+b.x+Math.min(16,a.width/2),a.y+b.y+Math.min(10,a.height/2)]})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:xy[0],y:xy[1],button:'left',clickCount:1});};
  const focus=async(selector:string)=>guest(`d.querySelector(${JSON.stringify(selector)}).focus();return true`);
  const count=()=>evaluate<number>(`qa.requests.filter(q=>q.path==='/v1/document-captures'||q.path==='/v1/document-comparison').length`);
  const waitDiff=()=>wait(`!!d.querySelector('[data-testid="capture-diff"]')`,'comparison diff');
  const shot=async(name:string)=>{await guest(`d.querySelector('[data-testid="capture-comparison"]').scrollIntoView({block:'start'});return true`);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,name+'.png'),Buffer.from(r.data,'base64'));};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:`http://127.0.0.1:${fx.port}/`});await wait(`!!d.querySelector('[data-testid="plan-row-${plan}"]')`,'board');await evaluate(`qa.show(['page'],1100);true`);
  await click(`[data-testid="plan-row-${plan}"]`);await click('[role="tab"][data-id="document"]');
  await wait(`!!d.querySelector('[data-testid="capture-toggle"]')`,'comparison action');check('no-automatic-comparison',await count()===0);
  await focus('[data-testid="capture-toggle"] button');await key('Enter');await waitDiff();check('keyboard-opens-default-pair',await guest(`return d.querySelector('[data-testid="capture-before"]').textContent.includes('#${first}')&&d.querySelector('[data-testid="capture-after"]').textContent.includes('#${second}')`));
  check('hostile-text-is-literal',await guest(`return d.querySelector('[data-testid="capture-diff"]').textContent.includes('<script>')&&!d.querySelector('[data-testid="capture-diff"] img')&&!d.querySelector('[data-testid="capture-diff"] script')&&!w.bad`));
  check('newline-and-path-metadata',await guest(`return d.querySelector('[data-testid="capture-comparison"]').textContent.includes('CRLF')&&d.querySelector('[data-testid="capture-comparison"]').textContent.includes('/fixture/revised-plan.md')`));
  const n=await count();await evaluate('new Promise(r=>setTimeout(r,3600))');check('ordinary-polling-no-comparison-reads',await count()===n);check('focus-survives-poll',await guest(`return d.activeElement?.closest('[data-testid="capture-toggle"]')!==null`));
  await focus('[data-testid="capture-before"] button');await key('Enter');await key('Home');await key('Enter');await wait(`d.querySelector('[data-testid="capture-compare"] button')?.disabled===false`,'same pair selection');await focus('[data-testid="capture-compare"] button');await key('Enter');await wait(`!!d.querySelector('[data-testid="capture-equal"]')`,'equal selection');check('keyboard-selector-and-equal-state',true);
  // Restore the intended older side through the actual selector keyboard interaction.
  await focus('[data-testid="capture-before"] button');await key('Enter');await key('ArrowDown');await key('Enter');await click('[data-testid="capture-compare"] button');await waitDiff();
  for(const mode of ['light','dark']){
    await evaluate(`qa.theme('${mode}');qa.show(['page'],1100);true`);await waitDiff();
    const contrast=await guest(`const rgba=s=>{const c=d.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=s;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)};const lum=a=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);return [...d.querySelectorAll('.ap-capture-added,.ap-capture-removed')].map(n=>{const s=w.getComputedStyle(n),a=lum(rgba(s.color)),b=lum(rgba(s.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})`);
    check(mode+'-diff-contrast',Math.min(...contrast)>=4.5,{minimum:Math.min(...contrast)});await shot(mode+'-wide');
    await evaluate(`qa.show(['page'],360);true`);await wait('w.innerWidth===360','narrow frame');check(mode+'-narrow-reflow',await guest('return d.documentElement.scrollWidth<=w.innerWidth+1'));await shot(mode+'-narrow');
  }
  await evaluate(`qa.show(['page'],720);true`);await wait('w.innerWidth===720','zoom fixture');
  const normalHeight=await guest<number>(`return d.querySelector('.ap-capture-number').getBoundingClientRect().height`);
  await guest(`d.documentElement.style.zoom='2';return true`);
  const zoom=await guest<{width:number;scroll:number;height:number;zoom:string}>(`return {width:w.innerWidth,scroll:d.documentElement.scrollWidth,height:d.querySelector('.ap-capture-number').getBoundingClientRect().height,zoom:w.getComputedStyle(d.documentElement).zoom}`);
  await shot('zoom-200-percent');check('200-percent-css-zoom-reflow',zoom.scroll<=zoom.width+1&&zoom.zoom==='2'&&zoom.height>=normalHeight*1.9,{...zoom,normalHeight});await guest(`d.documentElement.style.zoom='';return true`);
  await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'},{name:'prefers-reduced-motion',value:'reduce'}]});await shot('forced-colors');check('forced-colors-preserves-prefixes',await guest(`return d.querySelector('[data-testid="capture-diff"]').textContent.includes('+')&&d.querySelector('[data-testid="capture-diff"]').textContent.includes('−')`));await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const third=fx.recordDocument(plan,'Newer report arriving\n');await wait(`!!d.querySelector('[data-testid="capture-newer"]')`,'new report warning');check('new-report-keeps-pair',await guest(`return !d.querySelector('[data-testid="capture-after"]').textContent.includes('#${third}')`));
  await evaluate(`qa.holds.push({path:'/v1/document-comparison',tag:'leave',frame:'page'});true`);await focus('[data-testid="capture-compare"] button');await key('Enter');await wait(`qa.held.some(h=>h.tag==='leave')`,'held comparison');await click('[role="tab"][data-id="progress"]');await evaluate(`qa.release('leave');true`);check('leaving-document-retires-held-bytes',await guest(`return !d.querySelector('[data-testid="capture-diff"]')`));
  // Search explicitly opens a captured plan beyond the board's first 500 rows.
  await evaluate(`qa.show(['page'],1100);true`);await focus('#ap-search-q');await send('Input.insertText',{text:'Needle-at-1001'});await key('Enter');
  for(let i=0;i<8;i++){await wait(`!!d.querySelector('[data-testid="search-results"]')&&!d.querySelector('[data-testid="search-results"] [data-testid="search-loading"]')`,'search window');if(await guest(`return !!d.querySelector('[data-testid="search-plan-source-alpha/${outside}"]')`))break;await click('[data-testid="search-more"] button');}
  await click(`[data-testid="search-plan-source-alpha/${outside}"]`);await wait(`!!d.querySelector('[role="tab"][data-id="document"]')`,'search-selected detail');await click('[role="tab"][data-id="document"]');await wait(`!!d.querySelector('[data-testid="capture-toggle"] button')`,'search-selected Document');await click('[data-testid="capture-toggle"] button');await waitDiff();check('search-result-beyond-loaded-list',true);
  await evaluate(`qa.show(['page'],360);true`);await wait('w.innerWidth===360','deep narrow diff');check('high-line-numbers-fit-narrow-gutter',await guest(`return [...d.querySelectorAll('.ap-capture-number')].some(n=>n.textContent.includes('20000'))&&[...d.querySelectorAll('.ap-capture-number')].every(n=>n.scrollWidth<=n.clientWidth+1)`));await shot('high-line-numbers');
  await evaluate(`qa.holds.push({path:'/v1/document-comparison',tag:'delete',frame:'page'});true`);await click('[data-testid="capture-compare"] button');await wait(`qa.held.some(h=>h.tag==='delete')`,'held deletion reply');await fx.deleteElsewhere(outside);await wait(`!d.querySelector('[data-testid="capture-comparison"]')`,'deletion freshness');await evaluate(`qa.release('delete');true`);await evaluate('new Promise(r=>setTimeout(r,100))');check('delete-does-not-restore-bytes',await guest(`return !d.querySelector('[data-testid="capture-diff"]')`));
  check('rail-status-send-no-comparison-reads',await evaluate(`!qa.requests.some(q=>q.frame!=='page'&&(q.path==='/v1/document-captures'||q.path==='/v1/document-comparison'))`));
  check('no-captured-remote-assets',!remote.some(u=>u.includes('invalid.test')));check('no-runtime-errors',runtimeErrors===0);
  writeFileSync(join(output,'requests.json'),JSON.stringify(await evaluate(`qa.requests.filter(q=>q.path==='/v1/document-captures'||q.path==='/v1/document-comparison').map(q=>({frame:q.frame,path:q.path,method:q.method}))`),null,2));
}catch(error){failure=error instanceof Error?error.message:String(error);process.exitCode=1;if(diagnose)writeFileSync(join(output,'failure-state.json'),JSON.stringify(await diagnose().catch(()=>null),null,2));}
finally{writeFileSync(join(output,'results.json'),JSON.stringify({scope:'synthetic SDK shell, current guest bundles and disposable HTTP stores',results,failure},null,2));ws?.close();chrome.kill('SIGTERM');await fx.stop();await new Promise(r=>setTimeout(r,200));rmSync(profile,{recursive:true,force:true});}
console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,failure}));
