// Disposable real-service inbox QA. Synthetic SDK/device storage, real Chromium pointer,
// touch and keyboard input. Not native-host, physical-phone or screen-reader speech proof.
// Usage: needs-you-inbox-qa.ts --source --real-service --chromium <binary> --artifacts <dir>
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { createGuestAssets } from './source-guests.ts';
import { launchChromium } from './phone-cdp.ts';
import { inboxIntegration } from '../fixtures/inbox-integration.ts';
import { needsYouMembershipIntegration } from '../fixtures/needs-you-membership.ts';
import { S, SRC } from './fixtures.ts';

const arg = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const artifacts = arg('--artifacts'), chromium = arg('--chromium');
if (!artifacts || !chromium) throw Error('Pass --chromium and --artifacts');
mkdirSync(artifacts, { recursive: true });
const plans = [
  { id: 'plan-alpha', title: 'Export pipeline', session: S.M, items: [
    { id: 'task-a', title: 'Choose CSV or JSON', kind: 'task' as const, status: 'blocked' as const, blocker: { category: 'decision' as const, reason: 'Two formats meet the brief.', nextAction: 'Pick CSV or JSON' } },
    { id: 'task-b', title: 'Review the notes', kind: 'task' as const, status: 'blocked' as const, blocker: { category: 'review' as const, reason: 'Check the literal <notes>.', nextAction: 'Approve or request changes' } },
  ] },
  { id: 'plan-beta', title: 'Rollout checklist', session: S.U, items: [
    { id: 'task-d', title: 'Approve the window', kind: 'task' as const, status: 'blocked' as const, blocker: { category: 'review' as const, reason: 'The window overlaps a freeze.' } },
    { id: 'task-e', title: 'Wait for another team', kind: 'task' as const, status: 'blocked' as const, blocker: { category: 'dependency' as const, reason: 'Other work first.' } },
  ] },
  { id: 'plan-gamma', title: 'Other blocked work', session: S.U, items: [
    { id: 'task-h', title: 'Future category', kind: 'task' as const, status: 'blocked' as const, blocker: { category: 'other' as const } },
  ] },
];
const real = await inboxIntegration(SRC, plans);
const membership = await needsYouMembershipIntegration(SRC, S.M, S.C1, true);
const assets = createGuestAssets({ source: process.argv.includes('--source') });
let fail = false, unsupported = false, rulePhase = false;
const failFirstContinuation = new Set<string>();
const project = { id: 'example', name: 'Example', directory: '/fixture/Alpha' };
const sessions = [S.M, S.U].map(id => ({ id, title: 'Example session', parentId: null, projectId: project.id, directory: project.directory, createdAt: 1, updatedAt: 2, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [] }));
const light = { background: '#fafafa', elevated: '#fff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#fff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' };
const dark = { ...light, background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', border: '#414650', hover: '#343944', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', primary: '#83aff7', warningText: '#e8c372', focus: '#90b8ff' };
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px system-ui}iframe{display:block;width:100%;height:844px;border:0}section{width:600px;display:none}</style><script>
const frames=['panel','page','status'],frame=f=>document.querySelector('iframe[data-frame="'+f+'"]'),send=(f,m)=>frame(f).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
window.frame=frame;window.qa={session:${js(S.M)},locale:'en',dark:false,phone:false,storage:new Map(),requests:[],messages:[],storageSupported:true,holdStorage:false,pendingStorage:[]};
const project=${js(project)},sessions=${js(sessions)},light=${js(light)},dark=${js(dark)};
const ready=f=>send(f,{type:'ready',payload:{theme:{mode:qa.dark?'dark':'light',tokens:qa.dark?dark:light},locale:qa.locale,directory:project.directory,session:{id:qa.session},surface:f,connection:{connected:true,account:'example-account'},settings:{},features:{deviceStorage:qa.storageSupported},item:null,...(qa.phone?{device:{formFactor:'phone',pointer:'coarse',insets:{top:0,right:0,bottom:0,left:0},keyboard:0}}:{})}});
qa.ready=()=>frames.forEach(ready);qa.show=(f,width)=>{for(const n of document.querySelectorAll('section')){n.style.display=n.dataset.frame===f?'block':'none';n.style.width=width+'px'}};
qa.reload=f=>{const token=Date.now();frame(f).src='/ui/'+f+'/index.html?reload='+token;return token};
const snapshot=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[project]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions};
addEventListener('message',async e=>{const node=[...document.querySelectorAll('iframe')].find(n=>n.contentWindow===e.source),m=e.data;if(!node||m.channel!=='openchamber.sdk')return;const f=node.dataset.frame,result=payload=>send(f,{type:'result',id:m.id,ok:true,payload});qa.messages.push({type:m.type,payload:m.type==='open-session'?m.payload:undefined});
if(m.type==='hello')ready(f);
else if(m.type==='workspace-subscribe'){result();send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:snapshot(m.payload.query)}})}
else if(m.type==='storage'){const q=m.payload,k=(q.scope==='device'?'device':f)+':'+q.key;if(q.op==='set')qa.storage.set(k,q.value);if(q.op==='delete')qa.storage.delete(k);const reply=()=>result({storage:true,op:q.op,found:qa.storage.has(k),value:qa.storage.get(k),...(q.op==='keys'?{keys:[]}:{})});if(f==='panel'&&q.op==='get'&&q.key==='progress-view.v1'&&qa.holdStorage)qa.pendingStorage.push(reply);else reply()}
else if(m.type==='service-request'){qa.requests.push({frame:f,method:m.payload.method,path:m.payload.path,cursor:!!m.payload.query?.cursor,cursorToken:m.payload.query?.cursor});const r=await fetch('/service?frame='+f,{method:'POST',body:JSON.stringify(m.payload)});result(await r.json())}else if(m.id)result()});
</script>${['panel','page','status'].map(f => `<section data-frame="${f}"><iframe data-frame="${f}" src="/ui/${f}/index.html"></iframe></section>`).join('')}</html>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, 'http://fixture.invalid');
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
    const asset = assets.read(url.pathname);
    if (asset) { res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(asset); return; }
    if (url.pathname === '/service') {
      let text = ''; for await (const part of req) text += part;
      const q = JSON.parse(text);
      if (unsupported) { delete q.query?.needsYou; delete q.query?.needsYouTiming; }
      const failWindow = q.path === '/v1/needs-you' && failFirstContinuation.delete(url.searchParams.get('frame') ?? '');
      const r = (fail && q.path === '/v1/plans') || failWindow ? { status: 503, body: { error: 'busy' } } : await (rulePhase ? membership : real).request(q);
      if (unsupported && q.path === '/health') delete r.body.needsYouInbox;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: r.status, body: JSON.stringify(r.body) })); return;
    }
    res.statusCode = 204; res.end();
  } catch { res.statusCode = 500; res.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await launchChromium(chromium), c = browser.page;
const results: { id: string; pass: boolean; facts?: unknown }[] = [];
const check = (id: string, pass: boolean, facts?: unknown) => { results.push({ id, pass, facts }); if (!pass) throw Error(id); };
const evaluate = async <T = any>(expression: string): Promise<T> => { const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const guest = <T = any>(f: string, code: string) => evaluate<T>(`(()=>{const w=frame(${js(f)}).contentWindow,d=w.document;${code}})()`);
const wait = async (f: string, condition: string, ms = 20000) => {
  const ok = await evaluate<boolean>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{const w=frame(${js(f)}).contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`);
  if (!ok) throw Error(`Timeout ${f}: ${condition}`);
};
const key = async (k: string, shift = false) => { for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: k, code: k, modifiers: shift ? 8 : 0, windowsVirtualKeyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : k === 'Home' ? 36 : k === 'ArrowDown' ? 40 : 13, ...(k === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) }); };
const click = async (f: string, selector: string, touch = false, duringPress?: () => Promise<void>) => {
   const p = await evaluate<number[]>(`(async()=>{const fr=frame(${js(f)}),selector=${js(selector)};fr.contentDocument.querySelector(selector)?.scrollIntoView({block:'center'});fr.scrollIntoView();await new Promise(r=>requestAnimationFrame(r));const n=fr.contentDocument.querySelector(selector);if(!n)throw Error('Missing '+selector);const a=n.getBoundingClientRect(),b=fr.getBoundingClientRect();if(!a.width||!a.height)throw Error('Hidden '+selector);const x=a.x+b.x+Math.min(12,a.width/2),y=a.y+b.y+Math.min(12,a.height/2);if(!n.contains(fr.contentDocument.elementFromPoint(x-b.x,y-b.y)))throw Error('Obscured '+selector);return [x,y]})()`);
  if (touch) { await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p[0], y: p[1] }] }); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 });
    if (type === 'mousePressed') await duringPress?.();
  }
};
const tabTo = async (f: string, selector: string, backwards = false) => { await guest(f, 'w.focus();return true'); for (let i = 0; i < 100; i++) { if (await guest<boolean>(f, `return !!d.activeElement?.matches(${js(selector)})`)) return; await key('Tab', backwards); } throw Error(`Tab never reached ${selector}`); };
const shot = async (name: string) => { const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(artifacts, `${name}.png`), Buffer.from(r.data, 'base64')); };
const count = (n: number) => `d.querySelector('[data-testid="needs-you-count"]')?.dataset.count==='${n}'`;
const row = (id: string) => `[data-testid="needs-you-row"][data-task="${id}"]`;
const open = (id: string) => `${row(id)} .ap-inbox-open`;
let failure: string | null = null;
try {
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${(server.address() as any).port}` });
  await evaluate(`new Promise(r=>{const end=()=>window.qa?r():requestAnimationFrame(end);end()})`);
  await evaluate(`qa.show('panel',600);true`);
  await wait('panel', count(2));
  check('rail-default-session-collapsed', await guest('panel', `return d.querySelector('[data-testid="needs-you-toggle"]').getAttribute('aria-expanded')==='false' && !d.querySelector(${js(row('task-d'))})`));
  await tabTo('panel', '[data-testid="needs-you-toggle"]'); await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="needs-you-toggle"]').getAttribute('aria-expanded')==='true'`);
  // Another frame's saved preference arrives on the existing device refresh while
  // this opener is pressed. Hold the real SDK response to exercise that boundary.
  await evaluate(`const saved=structuredClone(qa.storage.get('device:progress-view.v1'));saved.dismissed.page='another-frame';qa.storage.set('device:progress-view.v1',saved);qa.holdStorage=true;true`);
  await wait('panel', 'qa.pendingStorage.length>0');
  await guest('panel', `d.addEventListener('pointerdown',e=>{w.pressNode=e.target.closest('.ap-inbox-open')},{capture:true,once:true});return true`);
  await click('panel', open('task-a'), false, async () => {
    await evaluate('qa.holdStorage=false;qa.pendingStorage.splice(0).forEach(reply=>reply());true');
    await guest('panel', 'return new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))');
    const press = await guest('panel', `return { captured:!!w.pressNode, connected:w.pressNode?.isConnected, same:w.pressNode===d.querySelector(${js(open('task-a'))}) }`);
    check('pointer-opener-survives-device-refresh', press.captured && press.connected && press.same, press);
  });
  await wait('panel', `${'!!'}d.querySelector(${js(row('task-a'))})?.querySelector('.ap-inbox-facts:not([hidden])')`);
  check('literal-in-place-no-pinned-reading', await guest('panel', `return d.querySelector('${row('task-a')} [data-testid="needs-you-reason"]').textContent==='Two formats meet the brief.' && !d.querySelector('[data-testid="needs-you-reading"]')`));
  await c.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await click('panel', `${row('task-a')} [data-testid="needs-you-copy-reply"] button`);
  await wait('panel', `d.querySelector('${row('task-a')} [data-testid="needs-you-copy-status"]').textContent.includes('copied')`);
  check('clipboard-literal-titles', await guest('panel', `return w.navigator.clipboard.readText().then(text=>text.includes('Choose CSV or JSON')&&text.includes('Export pipeline')&&text.endsWith('\\n\\n'))`));
  const before = await evaluate<number>('qa.messages.length');
  await click('panel', `${row('task-a')} [data-testid="needs-you-open-session"] button`);
  await wait('panel', `qa.messages.slice(${before}).some(m=>m.type==='open-session')`);
  check('open-session-only-no-mutation', await evaluate<boolean>(`qa.messages.slice(${before}).some(m=>m.type==='open-session'&&m.payload.sessionId===${js(S.M)}) && qa.requests.every(q=>q.method==='GET')`));
  check('actions-do-not-resolve', await guest('panel', `return ${count(2)}`));
  await guest('panel', `Object.defineProperty(w.navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(Error('fixture clipboard refusal'))});return true`);
  await click('panel', `${row('task-a')} [data-testid="needs-you-copy-reply"] button`);
  await wait('panel', `!d.querySelector('${row('task-a')} [data-testid="needs-you-copy-fallback"]').hidden`);
  check('clipboard-refusal-selectable-fallback', await guest('panel', `const n=d.querySelector('${row('task-a')} [data-testid="needs-you-copy-fallback"]');return n.value.includes('Choose CSV or JSON') && n.selectionEnd===n.value.length && ${count(2)}`));
  const fallbackSelector = `${row('task-a')} [data-testid="needs-you-copy-fallback"]`;
  const replyText = await guest<string>('panel', `return d.querySelector(${js(fallbackSelector)}).value`);
  const repaintCopy = async (tag: string) => {
    await guest('panel', `w.beforeCopyPaint=d.querySelector(${js(fallbackSelector)});return true`);
    await evaluate(`(()=>{const saved=structuredClone(qa.storage.get('device:progress-view.v1'));saved.dismissed.page=${js(tag)};qa.storage.set('device:progress-view.v1',saved);return true})()`);
    await wait('panel', '!w.beforeCopyPaint.isConnected');
  };
  // Diagnose both refusal orderings in one run, then fail the group if either regresses.
  const copyChecks: boolean[] = [];
  const copyCheck = (id: string, pass: boolean) => { results.push({ id, pass }); copyChecks.push(pass); };
  await guest('panel', `const n=d.querySelector(${js(fallbackSelector)});n.focus();n.setSelectionRange(3,17,'backward');return true`);
  await repaintCopy('copy-fallback-visible');
  copyCheck('clipboard-fallback-survives-background-paint', await guest('panel', `const n=d.querySelector(${js(fallbackSelector)});return !n.hidden && n.value===${js(replyText)} && n.selectionStart===3 && n.selectionEnd===17 && n.selectionDirection==='backward' && d.activeElement===n`));
  await click('panel', open('task-a'));
  await wait('panel', `d.querySelector(${js(open('task-a'))}).getAttribute('aria-expanded')==='false'`);
  await click('panel', open('task-a'));
  await guest('panel', `w.copySettled=false;Object.defineProperty(w.navigator.clipboard,'writeText',{configurable:true,value:()=>{const promise=new Promise((_resolve,reject)=>{w.refuseCopy=()=>reject(Error('held clipboard refusal'))});promise.catch(()=>{w.copySettled=true});return promise}});return true`);
  await click('panel', `${row('task-a')} [data-testid="needs-you-copy-reply"] button`);
  await wait('panel', "typeof w.refuseCopy==='function'");
  await repaintCopy('copy-fallback-pending');
  await guest('panel', 'w.refuseCopy();return true');
  await wait('panel', 'w.copySettled');
  await guest('panel', 'return new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))');
  copyCheck('clipboard-pending-refusal-survives-background-paint', await guest('panel', `const n=d.querySelector(${js(fallbackSelector)});return !n.hidden && n.value===${js(replyText)} && n.selectionStart===0 && n.selectionEnd===n.value.length`));
  if (copyChecks.some(pass => !pass)) throw Error('clipboard fallback repaint regressions');
  await evaluate(`qa.locale='ru';qa.ready();true`);
  await wait('panel', `d.querySelector(${js(fallbackSelector)}).value!==${js(replyText)}`);
  check('clipboard-fallback-cleared-on-reply-change', await guest('panel', `return d.querySelector(${js(fallbackSelector)}).hidden && !d.querySelector('${row('task-a')} [data-testid="needs-you-copy-status"]').textContent`));
  await evaluate(`qa.locale='en';qa.ready();true`);
  await wait('panel', `d.querySelector(${js(fallbackSelector)}).value===${js(replyText)}`);
  for (const invalidation of ['close', 'reply-change']) {
    await guest('panel', 'w.copySettled=false;w.refuseCopy=null;return true');
    await click('panel', `${row('task-a')} [data-testid="needs-you-copy-reply"] button`);
    await wait('panel', "typeof w.refuseCopy==='function'");
    if (invalidation === 'close') {
      await click('panel', open('task-a'));
      await wait('panel', `d.querySelector(${js(open('task-a'))}).getAttribute('aria-expanded')==='false'`);
      await click('panel', open('task-a'));
    } else {
      await evaluate(`qa.locale='ru';qa.ready();true`);
      await wait('panel', `d.querySelector(${js(fallbackSelector)}).value!==${js(replyText)}`);
    }
    await guest('panel', 'w.refuseCopy();return true');
    await wait('panel', 'w.copySettled');
    await guest('panel', 'return new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))');
    check(`clipboard-pending-refusal-retired-on-${invalidation}`, await guest('panel', `return d.querySelector(${js(fallbackSelector)}).hidden && !d.querySelector('${row('task-a')} [data-testid="needs-you-copy-status"]').textContent`));
  }
  await evaluate(`qa.locale='en';qa.ready();true`);
  await wait('panel', `d.querySelector(${js(fallbackSelector)}).value===${js(replyText)}`);
  await tabTo('panel', `${row('task-a')} [data-testid="needs-you-copy-reply"] button`); await key('Escape');
  await wait('panel', `d.activeElement?.matches(${js(open('task-a'))}) && d.activeElement.getAttribute('aria-expanded')==='false'`);
  check('escape-closes-and-restores-focus', true);
  await click('panel', open('task-a'));
  await click('panel', `${row('task-a')} [data-testid="needs-you-hide"] button`);
  await wait('panel', count(1));
  await wait('panel', `d.activeElement?.dataset.testid==='needs-you-toggle'`);
  await wait('status', count(1));
  check('other-frame-excludes-hidden-on-existing-refresh', true);
  await wait('panel', `!!d.querySelector('[data-testid="needs-you-undo-hide"] button')`);
  await click('panel', '[data-testid="needs-you-undo-hide"] button'); await wait('panel', count(2));
  check('hide-and-undo', true);
  await click('panel', open('task-a')); await click('panel', `${row('task-a')} [data-testid="needs-you-hide"] button`); await wait('panel', count(1));
  const reload = await evaluate<number>(`qa.reload('panel')`);
  await wait('panel', `w.location.search==='?reload=${reload}' && ${count(1)}`);
  check('reload-remembers-hidden-and-expanded-not-open-item', await guest('panel', `return d.querySelector('[data-testid="needs-you-toggle"]').getAttribute('aria-expanded')==='true' && !d.querySelector('.ap-inbox-facts:not([hidden])')`));
  await click('panel', '[data-testid="more-trigger"]');
  await wait('panel', `!!d.querySelector('[data-testid="more-needs-you-hidden"]')`);
  await click('panel', '[data-testid="more-needs-you-hidden"]');
  await wait('panel', `!!d.querySelector('[data-testid="needs-you-hidden-row"]')`);
  check('hidden-menu-reaches-unhide', await guest('panel', `return d.querySelector('[data-testid="needs-you-hidden-row"]').textContent.includes('Choose CSV or JSON')`));
  await click('panel', '[data-testid="needs-you-unhide"] button'); await wait('panel', count(2));
  await click('panel', open('task-a')); await click('panel', `${row('task-a')} [data-testid="needs-you-hide"] button`); await wait('panel', count(1));
  const revision = await guest<number>('panel', `return Number(d.querySelector(${js(row('task-b'))}).dataset.revision)`);
  real.conflict(); await wait('panel', `Number(d.querySelector(${js(row('task-b'))})?.dataset.revision)>${revision}`);
  check('unrelated-report-keeps-hidden', await guest('panel', `return ${count(1)}`));
  real.resolvePlan('plan-alpha', false); await wait('panel', count(2));
  check('new-details-return-hidden-item', true);
  await click('panel', '[data-testid="needs-you-scope-all"] button'); await wait('panel', count(3)); check('explicit-all-plans', true);
  await click('panel', '[data-testid="needs-you-scope-current"] button'); await wait('panel', count(2));
  // Emulated phone, real touch, both themes and all changed language catalogs.
  for (const locale of ['en', 'ru', 'zh-CN']) for (const darkMode of [false, true]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await evaluate(`qa.locale=${js(locale)};qa.dark=${darkMode};qa.phone=true;qa.ready();qa.show('panel',390);true`);
    await wait('panel', `d.documentElement.lang===${js(locale)}`);
    await click('panel', open('task-a'), true);
    const overflow = await guest('panel', `return {sw:d.documentElement.scrollWidth,cw:d.documentElement.clientWidth,small:[...d.querySelectorAll('.ap-inbox-compact button')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&r.height<43.5}).length}`);
    check(`phone-${locale}-${darkMode}-reflow-targets`, overflow.sw <= overflow.cw && overflow.small === 0, overflow);
    const tree = await c.send('Page.getFrameTree');
    const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.includes('/ui/panel/')).frame.id;
    const ax = await c.send('Accessibility.getFullAXTree', { frameId });
    const names = ({ en: ['Open session', 'Copy reply', 'Hide'], ru: ['Открыть сессию', 'Скопировать ответ', 'Скрыть'], 'zh-CN': ['打开会话', '复制回复', '隐藏'] } as Record<string, string[]>)[locale];
    check(`phone-${locale}-${darkMode}-accessible-actions`, names.every(name => ax.nodes.some((n: any) => n.role?.value === 'button' && n.name?.value === name)));
    await shot(`phone-${locale}-${darkMode ? 'dark' : 'light'}`);
    await key('Escape');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await evaluate(`qa.phone=false;qa.ready();qa.show('panel',600);true`);
    await click('panel', open('task-a'));
    check(`desktop-${locale}-${darkMode}-actions-and-reflow`, await guest('panel', `return d.documentElement.scrollWidth<=d.documentElement.clientWidth && !!d.querySelector('${row('task-a')} .ap-inbox-facts:not([hidden]) [data-testid="needs-you-copy-reply"] button')`));
    await shot(`desktop-${locale}-${darkMode ? 'dark' : 'light'}`);
    await key('Escape');
  }
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`qa.locale='en';qa.dark=false;qa.phone=false;qa.ready();qa.show('page',1200);true`);
  await wait('page', count(2));
  check('board-default-selected-plan-expanded', await guest('page', `return d.querySelector('[data-testid="needs-you-toggle"]').getAttribute('aria-expanded')==='true' && !!d.querySelector('[data-testid="plan-needs-you-count"]')`));
  await shot('desktop-board');
  await evaluate(`qa.show('panel',600);qa.session='session-with-no-plans';qa.ready();true`);
  await wait('panel', `!!d.querySelector('[data-testid="needs-you-other-plans"] button') && ${count(0)}`);
  check('empty-session-never-auto-widens', await guest('panel', `return !d.querySelector('.ap-inbox-open')`));
  await shot('empty-current-scope');
  await click('panel', '[data-testid="needs-you-other-plans"] button'); await wait('panel', count(3));
  check('quiet-link-explicitly-widens', true);
  await evaluate(`qa.session=${js(S.M)};qa.ready();true`); await wait('panel', count(2));
  fail = true; await wait('panel', `!!d.querySelector('[data-testid="needs-you-stale"]')`);
  check('failed-read-not-empty', await guest('panel', `return !!d.querySelector('[data-testid="needs-you-retry"]')`)); await shot('failed-read'); fail = false;
  await wait('panel', `!d.querySelector('[data-testid="needs-you-stale"]')`);
  failFirstContinuation.add('panel'); failFirstContinuation.add('page');
  real.partial(); await wait('panel', `d.querySelector('[data-testid="needs-you-count"]')?.dataset.exact==='false'`);
  for (const surface of ['panel', 'page']) {
    await evaluate(`qa.show(${js(surface)},${surface === 'panel' ? 600 : 1200});true`);
    await wait(surface, `!!d.querySelector('[data-testid="incomplete-counts-retry"]')`);
    const retryAt = await evaluate<number>('qa.requests.length');
    await click(surface, '[data-testid="incomplete-counts-retry"]');
    await wait(surface, `!d.querySelector('[data-testid="incomplete-counts-load-error"]') && d.querySelector('[data-testid="needs-you-count"]')?.dataset.exact==='true'`);
    check(`${surface}-retry-recovers-first-continuation`, await evaluate<boolean>(`qa.requests.slice(${retryAt}).some(q=>q.frame===${js(surface)}&&q.path==='/v1/needs-you')`));
  }
  await evaluate(`qa.show('panel',600);true`);
  check('automatic-continuation-on-refresh', await evaluate<boolean>(`qa.requests.some(q=>q.frame==='panel'&&q.path==='/v1/needs-you')`));
  // The ninth window must remain keyboard-reachable after a remembered dismissal.
  const traversalAt = await evaluate<number>('qa.requests.length');
  const eightWindows = (start: number) => `new Set(qa.requests.slice(${start}).filter(q=>q.frame==='panel'&&q.path==='/v1/needs-you'&&q.cursor).map(q=>q.cursorToken)).size>=7`;
  real.partial(8);
  await wait('panel', `${eightWindows(traversalAt)} && !!d.querySelector('[data-testid="incomplete-counts-more"]') && !d.querySelector(${js(row('continuation-target'))})`, 40000);
  await tabTo('panel', '[data-testid="incomplete-counts-toggle"]', true);
  if (await guest('panel', `return d.activeElement.getAttribute('aria-expanded')==='false'`)) await key('Enter');
  await tabTo('panel', '[data-testid="incomplete-counts-dismiss"]'); await key('Enter');
  await wait('panel', `!d.querySelector('[data-testid="incomplete-counts"]')`);
  const reloadAt = await evaluate<number>('qa.requests.length');
  const continuationReload = await evaluate<number>(`qa.reload('panel')`);
  await wait('panel', `w.location.search==='?reload=${continuationReload}' && ${eightWindows(reloadAt)}`, 40000);
  await wait('panel', `!!d.querySelector('[data-testid="incomplete-counts-reopen"]')`);
  check('dismissed-note-reload-keeps-plus-and-quiet-continuation', await guest('panel', `return !d.querySelector('[data-testid="incomplete-counts"]') && d.querySelector('[data-testid="needs-you-count"]')?.textContent.includes('+')`));
  await tabTo('panel', '[data-testid="incomplete-counts-reopen"]', true); await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="incomplete-counts-toggle"]')?.getAttribute('aria-expanded')==='true'`);
  await tabTo('panel', '[data-testid="incomplete-counts-more"]'); await key('Enter');
  await wait('panel', `!!d.querySelector(${js(row('continuation-target'))})`);
  check('dismiss-reload-keyboard-reaches-remaining-inbox-item', true);
  real.empty();
  await wait('panel', `d.querySelector('[data-testid="needs-you-inbox"]')?.hidden && d.querySelector('[data-testid="needs-you-inbox"]').getBoundingClientRect().height===0`);
  check('complete-empty-rail-has-no-visible-line', true);
  unsupported = true; await wait('panel', `!!d.querySelector('[data-testid="needs-you-unavailable"]')`);
  check('unsupported-not-empty', await guest('panel', `return !d.querySelector('[data-testid="needs-you-empty"]')`));
  // Keep the membership fixture's old stored reports: the presentation changes no service data.
  unsupported = false; rulePhase = true;
  const ruleReload = await evaluate<number>(`qa.session=${js(S.M)};qa.show('panel',600);qa.ready();qa.reload('panel')`);
  await wait('panel', `w.location.search==='?reload=${ruleReload}' && ${count(2)} && !!d.querySelector('[data-testid="map-card-direct"]')`);
  await click('panel', '[data-testid="needs-you-scope-all"] button');
  check('main-session-rule-excludes-direct-and-owned', await guest('panel', `return ${count(2)} && !d.querySelector(${js(row('direct'))}) && !d.querySelector(${js(row('owned'))})`));
  for (const surface of ['panel', 'page']) {
    await evaluate(`qa.show(${js(surface)},${surface === 'panel' ? 600 : 1200});true`);
    if (surface === 'page') {
      await wait(surface, `d.querySelector('[data-testid="plan-row-plan-alpha"]')?.textContent.includes('Main session plan')`);
      await click(surface, '[data-testid="plan-row-plan-alpha"]');
      await wait(surface, `d.querySelector('[data-testid="plan-row-plan-alpha"]')?.getAttribute('aria-selected')==='true'`);
    }
    await wait(surface, `!!d.querySelector('[data-testid="map-card-direct"]') && !!d.querySelector(${js(open('main'))})`);
    await click(surface, '[data-testid="map-card-direct"]');
    await tabTo(surface, '[data-testid="map-help-trigger"]');
    await key('Enter');
    await wait(surface, `d.querySelector('[data-testid="map-help"]')?.open`);
    await tabTo(surface, '[data-testid="map-group"]');
    await key('Home'); await key('ArrowDown');
    await wait(surface, `d.querySelector('[data-testid="map-group"]')?.value==='' && !d.querySelector('[data-testid="map-card-main"]')`);
    check(`${surface}-map-filter-hides-inbox-target`, await guest(surface, `return d.querySelector('[data-testid="map-card-direct"]')?.getAttribute('aria-current')==='true'`));
    await key('Escape');
    await wait(surface, `!d.querySelector('[data-testid="map-help"]')?.open && d.activeElement?.dataset.testid==='map-help-trigger'`);
    await click(surface, open('main'));
    await wait(surface, `d.querySelector('[data-testid="map-card-main"]')?.getAttribute('aria-current')==='true' && d.querySelector('[data-testid="map-group"]')?.value==='*'`);
    check(`${surface}-inbox-reveals-filtered-map-target`, await guest(surface, `return d.activeElement?.matches(${js(open('main'))}) && !!d.querySelector('${row('main')} .ap-inbox-facts:not([hidden])')`));
    await shot(`${surface}-inbox-map-reveal`);
  }
  await evaluate(`qa.show('panel',600);true`);
  await shot('rule-rail');
  await click('panel', '[data-testid="map-card-direct"]');
  await wait('panel', `d.querySelector('[data-testid="map-inspector"]')?.textContent.includes('Parent must supply the sample')`);
  check('excluded-map-retains-blocker', await guest('panel', `return d.querySelector('[data-testid="map-card-direct"]').dataset.status==='blocked'`));
  await shot('rule-map');
  await click('panel', '[data-testid="plan-view-list"] button');
  await wait('panel', `!!d.querySelector('[data-testid="item-direct"]')`);
  await click('panel', '[data-testid="item-toggle-direct"] > summary');
  await wait('panel', `d.querySelector('[data-testid="item-direct"]').textContent.includes('Parent must supply the sample')`);
  check('excluded-list-retains-blocker', await guest('panel', `return d.querySelector('[data-testid="item-direct"]').dataset.status==='blocked'`));
  await shot('rule-list');
  for (const surface of ['panel', 'page']) {
    await evaluate(`qa.show(${js(surface)},${surface === 'panel' ? 600 : 1200});true`);
    if (surface === 'page') await click(surface, '[data-testid="plan-view-list"] button');
    await wait(surface, `!!d.querySelector('[data-testid="item-main"]')`);
    await click(surface, open('main'));
    await wait(surface, `d.querySelector(${js(open('main'))})?.getAttribute('aria-expanded')==='false'`);
    await click(surface, open('main'));
    await wait(surface, `d.activeElement?.matches(${js(open('main'))}) && !!d.querySelector('${row('main')} .ap-inbox-facts:not([hidden])')`);
    check(`${surface}-list-reveal-keeps-inbox-focus`, true);
    await tabTo(surface, `${row('main')} [data-testid="needs-you-copy-reply"] button`);
    check(`${surface}-list-reveal-actions-reachable`, await guest(surface, `return !!d.activeElement?.closest(${js(row('main'))})`));
    await key('Escape');
    await wait(surface, `d.activeElement?.matches(${js(open('main'))}) && d.activeElement.getAttribute('aria-expanded')==='false'`);
    check(`${surface}-list-reveal-escape-restores-focus`, true);
    await shot(`${surface}-inbox-list-reveal`);
  }
  check('membership-read-does-not-rewrite-store', membership.unchanged());
  check('no-browser-errors', c.errors.length === 0, c.errors);
} catch (error) { failure = String(error); await shot('failure'); }
finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ failure, results, browser: browser.version, service: 'actual HTTP and disposable SQLite', limits: 'synthetic host/device, emulated phone, AX names not speech' }, null, 2));
  try { writeFileSync(join(artifacts, 'requests.json'), JSON.stringify(await evaluate('qa.requests'), null, 2)); } catch {}
  await browser.stop(); await real.close(); await membership.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); assets.dispose();
}
console.log(JSON.stringify({ pass: !failure, checks: results.length, failure }));
if (failure) process.exitCode = 1;
