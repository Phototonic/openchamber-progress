// Synthetic-host performance guardrail, not native-host certification.
// Usage: node --experimental-strip-types tests/browser/large-library-qa.ts --source --chromium <binary> --artifacts <directory>
// Search comparison: --search-only [--guest-root <preserved guests>] instead of --source.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startSearchShell } from './plan-task-search-shell.ts';
import { launchChromium } from './phone-cdp.ts';
import { boardInput } from './board-qa.ts';
import { searchStatusText } from '../../ui/shared/search.ts';
import type { ItemInput } from '../../shared/progress.ts';

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes('--chromium') || !args.includes('--artifacts')) throw Error('Usage: --source --chromium <binary> --artifacts <directory>');
const out = path.resolve(option('--artifacts'));
fs.mkdirSync(out, { recursive: true });
let guestRoot: string | undefined = args.includes('--guest-root') ? path.resolve(option('--guest-root')) : undefined;
if (args.includes('--source')) {
  guestRoot = path.join(out, 'guests');
  for (const surface of ['page', 'panel', 'status']) {
    fs.mkdirSync(path.join(guestRoot, 'ui', surface), { recursive: true });
    fs.copyFileSync(`ui/${surface}/index.html`, path.join(guestRoot, 'ui', surface, 'index.html'));
    execFileSync('bun', ['run', 'bundle:guest', `ui/${surface}/main.ts`, path.join(guestRoot, 'ui', surface, 'main.js')], { stdio: 'pipe' });
  }
}
const measure = { surface: 'page', allRoutes: true };
const fx = await startSearchShell(true, false, 'dependency-map-final', false, true, { guestRoot }, measure);
const f = fx.fixture!;
const items = (n: number): ItemInput[] => Array.from({ length: n }, (_, i) => ({
  id: `T${i}`, title: `Synthetic task ${i}: implement and verify dependency branch`, kind: 'task',
  status: i === 0 ? 'blocked' : i % 5 === 0 ? 'done' : i % 7 === 0 ? 'working' : 'pending',
  ...(i ? { dependencies: [`T${i - 1}`] } : { blocker: { category: 'decision', reason: 'Synthetic approval required', nextAction: 'Choose synthetic option' } }),
}));
f.seedPlan('A000-target', 'Synthetic selected plan', items(60));
for (let k = 0; k < 80; k++) f.apply('A000-target', { op: 'change', changes: [{ id: 'T1', status: k % 2 ? 'working' : 'pending' }] });
f.seedPlan('A001-target', 'Synthetic alternate plan', items(60));
for (let p = 0; p < 500; p++) {
  const who = { ...f.actor, sourceId: p % 6 === 5 ? f.beta.id : f.alpha.id, sessionId: `root-${p}`, projectId: `project-${p % 6}`, directory: `/fixture/project-${p % 6}` };
  const id = `B${String(p).padStart(4, '0')}`;
  f.seedPlan(id, `Synthetic plan ${p}`, items(30 + p % 51), who);
  for (let k = 0; k < 12; k++) f.apply(id, { op: 'change', changes: [{ id: 'T1', status: k % 2 ? 'working' : 'pending' }] }, who);
}
const base = Date.now() - 600000;
for (let i = 0; i < 600; i++) {
  const child = { ...f.actor, sessionId: `run-child-${i}`, parentId: 'M', ancestry: ['M'] };
  const key = { source: f.alpha.id, parent: 'M', message: `message-${i}`, call: `call-${i}` };
  f.store.beforeRun(key, f.actor, 'subagent', { agent: 'explorer', description: `Synthetic run ${i}` }, base + i * 100);
  f.store.observeExecution({ source: f.alpha.id, child: child.sessionId, id: `start-${i}`, sequence: 1, at: base + i * 100 + 10, state: 'running', errorType: null, interruptionReason: null });
  if (i % 20) f.store.observeExecution({ source: f.alpha.id, child: child.sessionId, id: `end-${i}`, sequence: 2, at: base + i * 100 + 50, state: 'succeeded', errorType: null, interruptionReason: null });
  f.store.afterRun(key, f.store.runControl().generation, child, 'returned');
}
console.log('Synthetic library seeded');
const browser = await launchChromium(option('--chromium'), true);
const c = browser.page;
const evaluate = async <T = any>(expression: string): Promise<T> => {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const guest = (surface: string, code: string) => evaluate(`(()=>{const w=frame('${surface}').contentWindow,d=w.document;${code}})()`);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const wait = async (s: string, condition: string) => {
  if (!await evaluate(`(async()=>{const end=performance.now()+60000;while(performance.now()<end){try{const w=frame('${s}').contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>setTimeout(r,20))}return false})()`)) throw Error(`Timeout: ${condition}`);
};
const click = async (surface: string, selector: string) => {
  await guest(surface, `d.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'});return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  const point = await guest(surface, `const n=d.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing board control');const a=n.getBoundingClientRect(),b=w.frameElement.getBoundingClientRect();return {x:b.x+a.x+a.width/2,y:b.y+a.y+a.height/2}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
};
const board = boardInput({ guest, wait, click });
const select = async (s: string, title: string, id: string) => {
  if (s === 'page') { await guest(s, `d.querySelector('[data-testid="plan-row-${id}"]').click();return true`); return; }
  for (let i = 0; i < 30; i++) {
    if (await guest(s, `if(d.querySelector('[data-testid="map-title"]')?.textContent===${JSON.stringify(title)})return true;const o=[...d.querySelectorAll('.oc-sdk-option-label')].find(n=>n.textContent===${JSON.stringify(title)});if(o){o.closest('[role="option"]').click();return true}const t=d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();return false`)) return;
    await delay(50);
  }
  throw Error('Fixture option unavailable');
};
const result: any = { shape: { bulkPlans: 500, tasksPerBulk: '30–80', histories: 12, selectedTasks: 60, selectedHistory: 80, runs: 600, projects: 6, sources: 2 }, measurements: [] };
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
async function window(s: string, label: string, run: () => Promise<unknown>) {
  await guest(s, `w.__p={frames:[],long:[],rootReplacements:0,mapReplacements:0,start:performance.now(),last:performance.now()};let root=d.querySelector('[data-testid="progress-root"]'),map=d.querySelector('[data-testid="map-region"]');const po=new w.PerformanceObserver(l=>{for(const e of l.getEntries())w.__p.long.push(e.duration)});po.observe({type:'longtask',buffered:false});const mo=new w.MutationObserver(()=>{const r=d.querySelector('[data-testid="progress-root"]'),m=d.querySelector('[data-testid="map-region"]');if(r!==root){w.__p.rootReplacements++;root=r}if(m!==map){w.__p.mapReplacements++;map=m}});mo.observe(d.body,{childList:true,subtree:true});const tick=t=>{w.__p.frames.push(t-w.__p.last);w.__p.last=t;w.__raf=w.requestAnimationFrame(tick)};w.__raf=w.requestAnimationFrame(tick);w.__stop=()=>{w.cancelAnimationFrame(w.__raf);po.disconnect();mo.disconnect();return {...w.__p,elapsed:performance.now()-w.__p.start,dom:d.querySelectorAll('*').length}};return true`);
  const mark = await evaluate('qa.replies.length');
  await run();
  const p = await guest(s, 'return w.__stop()');
  const frames = p.frames.sort((a: number, b: number) => a - b);
  const traffic: Record<string, { count: number; bytes: number }> = {};
  // Inbox work travels two ways: continuation windows on /v1/needs-you and the first window on /v1/plans?needsYou=1.
  // Every measured frame reports explicit counters, including zero. A refresh starts with a first-page /v1/plans read
  // (no cursor); the rest of that refresh's list reads are continuation pages.
  const inbox: Record<string, { needsYouRoute: number; plansFirstWindow: number }> = { page: { needsYouRoute: 0, plansFirstWindow: 0 }, panel: { needsYouRoute: 0, plansFirstWindow: 0 } };
  const listStarts: Record<string, number> = { page: 0, panel: 0 };
  for (const r of await evaluate(`qa.replies.slice(${mark})`)) {
    const row = traffic[r.frame + ' ' + r.path] ??= { count: 0, bytes: 0 }; row.count++; row.bytes += r.bytes;
    const form = inbox[r.frame] ??= { needsYouRoute: 0, plansFirstWindow: 0 };
    if (r.path === '/v1/plans' && !r.query?.cursor) listStarts[r.frame] = (listStarts[r.frame] ?? 0) + 1;
    if (r.path === '/v1/needs-you') form.needsYouRoute++;
    else if (r.path === '/v1/plans' && String(r.query?.needsYou) === '1') form.plansFirstWindow++;
  }
  const m = { surface: s, label, elapsed: p.elapsed, dom: p.dom, rootReplacements: p.rootReplacements, mapReplacements: p.mapReplacements, longTasks: { count: p.long.length, total: p.long.reduce((a: number, b: number) => a + b, 0), max: Math.max(0, ...p.long) }, frames: { p99: frames[Math.min(frames.length - 1, Math.floor(frames.length * .99))], max: Math.max(...frames) }, traffic, inbox, listStarts };
  result.measurements.push(m); save(); console.log(JSON.stringify(m));
}
async function searchJourney() {
  measure.surface = 'page';
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
  await wait('page', `!!d.querySelector('#ap-search-q')`);
  await evaluate(`qa.show(['page'],1100);for(const f of ['page','panel','status'])qa.visibility(f,f==='page');true`);
  await guest('page', `w.focus();d.querySelector('#ap-search-q').focus();return true`);
  await c.send('Input.insertText', { text: 'Synthetic plan' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' });
  await wait('page', `!!d.querySelector('[data-testid="search-more"] button')&&!d.querySelector('[data-testid="search-results"] [data-testid="search-loading"]')`);
  // More can be ready before the first action's queued live-region write. Observe
  // continuation speech only after that initial outcome has actually arrived.
  const firstCounts = await guest('page', `const n=d.querySelector('[data-testid="search-counts"]');return {matchedPlans:Number(n.dataset.matchedPlans),matchingTasks:Number(n.dataset.matchingTasks),shown:Number(n.dataset.shown)}`);
  const firstAnnouncement = searchStatusText({ kind: 'outcome', ...firstCounts, exhausted: false });
  await wait('page', `d.querySelector('[data-testid="search-announcer"]')?.textContent===${JSON.stringify(firstAnnouncement)}`);
  const before = await guest('page', `const n=d.querySelector('[data-testid="search-more"] button');n.scrollIntoView({block:'center'});n.focus();w.__searchButton=n;w.__searchAnnouncements=[];let last=d.querySelector('[data-testid="search-announcer"]')?.textContent??'';w.__searchObserver=new w.MutationObserver(()=>{const text=d.querySelector('[data-testid="search-announcer"]')?.textContent??'';if(text&&text!==last)w.__searchAnnouncements.push(text);last=text});w.__searchObserver.observe(d.body,{childList:true,subtree:true,characterData:true});return {page:d.querySelector('[data-testid="search-results"]').dataset.page,shown:Number(d.querySelector('[data-testid="search-counts"]').dataset.shown)}`);
  await guest('page', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  const point = await guest('page', `const a=w.__searchButton.getBoundingClientRect(),b=w.frameElement.getBoundingClientRect();return {x:b.x+a.x+a.width/2,y:b.y+a.y+a.height/2}`);
  const refreshes = await evaluate(`qa.replies.filter(r=>r.frame==='page'&&r.path==='/v1/search-state').length`);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
  await wait('page', `qa.replies.filter(r=>r.frame==='page'&&r.path==='/v1/search-state').length>${refreshes}`);
  await guest('page', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  const held = await guest('page', `return {same:d.querySelector('[data-testid="search-more"] button')===w.__searchButton,connected:w.__searchButton.isConnected,focused:d.activeElement===w.__searchButton,searching:!!d.querySelector('[data-testid="search-results"] [data-testid="search-loading"]')}`);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
  const nextPage = await evaluate(`(async()=>{const end=performance.now()+10000;while(performance.now()<end){const d=frame('page').contentDocument,n=d.querySelector('[data-testid="search-results"]');if(n&&n.dataset.page!==${JSON.stringify(before.page)}&&!d.querySelector('[data-testid="search-results"] [data-testid="search-loading"]'))return true;await new Promise(r=>setTimeout(r,20))}return false})()`);
  const completion = await guest('page', `return {page:d.querySelector('[data-testid="search-results"]')?.dataset.page,shown:Number(d.querySelector('[data-testid="search-counts"]')?.dataset.shown??0),headingFocused:d.activeElement===d.querySelector('[data-testid="search-results-heading"]'),announcements:[...w.__searchAnnouncements]}`);
  const afterRefresh = await evaluate(`qa.replies.filter(r=>r.frame==='page'&&r.path==='/v1/search-state').length`);
  await wait('page', `qa.replies.filter(r=>r.frame==='page'&&r.path==='/v1/search-state').length>${afterRefresh}`);
  const announcements = await guest('page', `w.__searchObserver.disconnect();return [...w.__searchAnnouncements]`);
  result.search = { before, held, nextPage, completion, announcements, passed: held.same && held.connected && held.focused && !held.searching && nextPage && completion.headingFocused && announcements.length === 1 };
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'search-continuation.png'), Buffer.from(shot.data, 'base64'));
  save(); console.log(JSON.stringify({ search: result.search }));
}
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 1, mobile: false });
  if (!args.includes('--search-only')) {
  for (const s of ['page', 'panel']) {
    measure.surface = s;
    await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
    await wait(s, `!!d.querySelector('[data-testid="plan-view-map"] button')`);
    await evaluate(`qa.show(['${s}'],${s === 'page' ? 1280 : 600});for(const f of ['page','panel','status']){qa.visibility(f,f==='${s}');frame(f).style.height='1000px'};qa.context('M');qa.setProjects(Array.from({length:6},(_,i)=>({id:'project-'+i,name:'Project '+i,directory:'/fixture/project-'+i})));qa.setSessions('project-0',[{id:'M',title:'Synthetic root',directory:'/fixture/main',parentId:null},...Array.from({length:600},(_,i)=>({id:'run-child-'+i,title:'Synthetic child '+i,directory:'/fixture/main',parentId:'M',busy:i%20===0}))]);true`);
    await select(s, 'Synthetic selected plan', 'A000-target');
    const ready = (title: string) => wait(s, `d.querySelector('[data-testid="map-title"]')?.textContent===${JSON.stringify(title)}&&d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);
    await ready('Synthetic selected plan'); await delay(1500);
    await window(s, 'idle', () => delay(16000));
    await window(s, 'selection', async () => { await select(s, 'Synthetic alternate plan', 'A001-target'); await ready('Synthetic alternate plan'); });
    await select(s, 'Synthetic selected plan', 'A000-target'); await ready('Synthetic selected plan');
    await guest(s, `d.querySelector('[data-testid="map-viewport"]').scrollIntoView({block:'center'});return true`); await delay(300);
    const point = await guest(s, `const a=d.querySelector('[data-testid="map-viewport"]').getBoundingClientRect(),b=w.frameElement.getBoundingClientRect();return {x:b.x+a.x+a.width*.9,y:b.y+a.y+a.height*.85}`);
    await window(s, 'drag', async () => { for (let k = 0; k < 6; k++) {
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 25; i++) { await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - i * 3, y: point.y - i, button: 'left', buttons: 1 }); await delay(16); }
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x - 75, y: point.y - 25, button: 'left', buttons: 0, clickCount: 1 });
    } });
    await window(s, 'wheel-pan', async () => { for (let i = 0; i < 120; i++) { await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: i % 2 ? 40 : -40 }); await delay(16); } await delay(300); });
    await guest(s, `d.querySelector('.ap-map-card').focus();return true`);
    await window(s, 'key-zoom', async () => { for (let i = 0; i < 30; i++) { const key = i % 2 ? '-' : '+'; await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: i % 2 ? 'Minus' : 'Equal', text: key }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: i % 2 ? 'Minus' : 'Equal' }); await delay(32); } });
    if (s === 'page') {
      result.scrollbar = [];
      for (const mode of ['paused', 'inside', 'outside']) {
        if (mode === 'outside') await guest(s, `w.__nativeMoveBefore=w.Element.prototype.moveBefore;w.Element.prototype.moveBefore=undefined;return true`);
        await evaluate(`qa.visibility('page',${mode !== 'paused'});true`);
        await delay(400);
        const start = await guest(s, `w.scrollTo(0,0);const n=d.querySelector('.ap-plan-list');n.scrollTop=0;w.__scrollNode=n;const r=n.getBoundingClientRect(),f=w.frameElement.getBoundingClientRect();return {x:f.x+r.right-3,y:f.y+r.top+20,top:n.scrollTop,gutter:n.offsetWidth-n.clientWidth,hit:d.elementFromPoint(r.right-3,r.top+20)?.className,revision:d.querySelector('[data-testid="plan-row-B0000"]')?.dataset.revision}`);
        if (start.gutter < 5) throw Error('Native scrollbar gutter unavailable');
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
        const steps = [];
        for (let i = 0; i < 70; i++) {
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y + i * 3, button: 'left', buttons: 1 });
          if (i === 35 && mode !== 'paused') f.apply('B0000', { op: 'change', changes: [{ id: 'T1', status: mode === 'inside' ? 'pending' : 'working' }] }, { ...f.actor, sessionId: 'root-0', projectId: 'project-0', directory: '/fixture/project-0' });
          await delay(100);
          steps.push(await guest(s, `return {top:d.querySelector('.ap-plan-list').scrollTop,same:d.querySelector('.ap-plan-list')===w.__scrollNode,connected:w.__scrollNode.isConnected,revision:d.querySelector('[data-testid="plan-row-B0000"]')?.dataset.revision}`));
        }
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mode === 'outside' ? 5 : start.x, y: mode === 'outside' ? 5 : start.y + 207, button: 'left', buttons: 0, clickCount: 1 });
        result.scrollbar.push({ mode, start, distance: steps.at(-1)!.top - start.top, same: steps.every(v => v.same && v.connected), reportArrived: mode === 'paused' || steps.some(v => v.revision && v.revision !== start.revision), steps });
        if (mode === 'outside') await guest(s, `w.Element.prototype.moveBefore=w.__nativeMoveBefore;return true`);
        const shot = await c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(out, `scrollbar-${mode}.png`), Buffer.from(shot.data, 'base64'));
        save();
      }
      await evaluate(`qa.visibility('page',true);true`);
    }
  }
  // Outside the timed windows: responsive board and count/accessibility observations.
  measure.surface = 'page';
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
  await wait('page', `!!d.querySelector('.ap-plan-list [role="listbox"]')`);
  await evaluate(`qa.show(['page'],1100);for(const f of ['page','panel','status'])qa.visibility(f,f==='page');true`);
  await guest('page', `d.querySelector('.ap-plan-list [role="listbox"]').focus();return true`);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown' });
  const mark = await evaluate(`qa.replies.filter(r=>r.frame==='page'&&r.path==='/health').length`);
  await wait('page', `qa.replies.filter(r=>r.frame==='page'&&r.path==='/health').length>=${mark + 2}`);
  result.keyboard = await guest('page', `const n=d.activeElement,id=n?.getAttribute('aria-activedescendant'),active=id?d.getElementById(id):null;return {focusedListbox:n?.getAttribute('role')==='listbox',activeOption:!!active&&!active.closest('[hidden]')}`);
  result.responsive = [];
  for (const [width, locale] of [[1100, 'en'], [360, 'en'], [390, 'en'], [390, 'ru'], [390, 'zh-CN']] as const) {
    await evaluate(`qa.show(['page'],${width});qa.locale=${JSON.stringify(locale)};qa.ready('page');true`);
    await wait('page', `d.documentElement.lang===${JSON.stringify(locale)}`);
    const observed = await guest('page', `return {overflow:d.documentElement.scrollWidth>w.innerWidth+1,zeroBadges:[...d.querySelectorAll('[data-testid="plan-needs-you-count"]')].filter(n=>/^0\\+?$/.test(n.textContent)).length,listVisible:!!d.querySelector('.ap-plan-list')?.getClientRects().length,planPicker:!!d.querySelector('[data-testid="plan-selector"]')?.getClientRects().length}`);
    result.responsive.push({ width, locale, ...observed });
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, `board-${width}-${locale}.png`), Buffer.from(shot.data, 'base64'));
    await board.openFilters();
    const filters = await guest('page', `const n=d.querySelector('[data-testid="board-filters"]');return {open:!!n&&!n.hidden,overflow:d.documentElement.scrollWidth>w.innerWidth+1,choices:d.querySelectorAll('[data-testid="filters"] .oc-sdk-trigger').length}`);
    result.responsive.at(-1).filters = filters;
    const filtersShot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, `board-filters-${width}-${locale}.png`), Buffer.from(filtersShot.data, 'base64'));
    await board.closeFilters();
  }
  }
  await searchJourney();
  result.errors = browser.page.errors; save();
  if (!result.search.passed) process.exitCode = 1;
} finally { await browser.stop(); await fx.stop(); }
