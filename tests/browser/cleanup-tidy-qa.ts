// Synthetic SDK host, real disposable cleanup service; no native-host/physical-phone claim.
// Usage: node --experimental-strip-types tests/browser/cleanup-tidy-qa.ts --source --chromium <binary> --artifacts <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';
import { tidyCopy } from '../../ui/shared/cleanup.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw Error('Pass --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });
const checks: string[] = [];
const check = (name: string, pass: boolean) => { if (!pass) throw Error(name); checks.push(name); };
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
let fixture: Awaited<ReturnType<typeof startLanguageFixture>> | undefined;
const service = await launchCleanupService(false, false);
let failure: string | null = null;
let old = false;
let oldHealthReads = 0;
try {
  // A separate finished-only session lets the board's actual filter prove it never widens.
  const actor = { ...service.actor, sessionId: 'F' };
  service.store.apply({ op: 'start', plan: 'P-filtered', rev: 0, oid: 'filter-start', title: 'Filtered finished plan', items: [{ id: 'A', title: 'Done', kind: 'task', status: 'done' }] }, actor);
  service.store.apply({ op: 'finish', plan: 'P-filtered', rev: 1, oid: 'filter-finish', outcome: 'finished' }, actor);
  fixture = await startLanguageFixture({ source: process.argv.includes('--source'), service: async q => {
    if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
    const query = new URLSearchParams(q.query ?? {}).toString();
    const reply = await service.request(q.path + (query ? '?' + query : ''), q.body ? JSON.parse(q.body) : undefined);
    let body = await reply.text();
    if (old && q.path === '/health') { oldHealthReads++; const h = JSON.parse(body); delete h.planCleanup; body = JSON.stringify(h); }
    return { status: reply.status, body };
  } });
  browser = await launchChromium(chromiumPath(arg('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(s: string, code: string) => evaluate<T>(`(()=>{const w=frame(${js(s)}).contentWindow,d=w.document;${code}})()`);
  const wait = async (s: string, condition: string) => {
    const ok = await evaluate(`(async()=>{const end=performance.now()+12000;while(performance.now()<end){try{const w=frame(${js(s)}).contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`);
    if (!ok) throw Error(`Timeout ${s}: ${condition}; ` + await guest(s, 'return d.body.innerText.slice(0,700)'));
  };
  let width = 390;
  const key = async (key: string) => {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, Home: 36, ArrowDown: 40 };
    const data = { key, code: key, windowsVirtualKeyCode: codes[key] ?? 0 };
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', ...data, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
  };
  const click = async (s: string, selector: string) => {
    await guest(s, `d.querySelector(${js(selector)})?.scrollIntoView({block:'center'});return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    const [x, y] = await guest<[number, number]>(s, `const n=d.querySelector(${js(selector)});if(!n)throw Error('Missing control '+${js(selector)});const r=n.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    if (width === 390) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const posts = () => evaluate<number>(`qa.requests.filter(q=>q.method==='POST').length`);
  // The fixture clock owns both polls and SDK RPC deadlines. Tick only after
  // replies have been delivered, never turn an in-flight RPC into a fake timeout.
  const refresh = async (surface?: string) => {
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await wait('page', `qa.requests.length===qa.responses.length`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await evaluate(`qa.tick(${surface ? js(surface) : ''});true`);
    await wait('page', `qa.requests.length===qa.responses.length`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  };
  const state = (id: string) => {
    const p = service.store.get('source-fixture', id)!;
    return { lifecycle: p.lifecycle, revision: p.revision, counts: service.store.detail('source-fixture', id).plan.counts, history: service.store.history('source-fixture', id).data };
  };
  const before = state('P-done'), cancelled = state('P-cancelled');
  const open = async (s: string) => {
    await wait(s, `!!d.querySelector('[data-testid="surface-header"]')`);
    await click(s, '[data-testid="more-trigger"]');
    await wait(s, `!!d.querySelector('[data-testid="more-tidy"]')`);
    await click(s, '[data-testid="more-tidy"]');
    await wait(s, `!!d.querySelector('[data-testid="tidy-confirm"]') && !!d.activeElement?.closest('[data-testid="tidy-cancel"]')`);
  };
  const shot = async (name: string) => {
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 844, scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fixture.port}/` });
  await evaluate(`document.querySelector('#outside').hidden=true;document.querySelectorAll('section').forEach(n=>n.style.margin='0');qa.context('M');true`);
  await wait('panel', `!!d.querySelector('[data-testid="surface-header"]')`);
  for (const size of [390, 1280]) for (const locale of ['en', 'ru', 'zh-CN']) for (const mode of ['light', 'dark']) for (const s of ['panel', 'page']) {
    width = size;
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width === 390 });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390 });
    const id = `${s}-${width}-${locale}-${mode}`, t = tidyCopy(locale);
    await evaluate(`qa.show(${js(s)},${width});qa.seed(undefined);qa.ready(${js(s)},{locale:${js(locale)}});true`);
    const theme = { mode, tokens: mode === 'dark' ? { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', border: '#414650', hover: '#343944', focus: '#90b8ff', primary: '#83aff7', font: 'system-ui, sans-serif' } : { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', border: '#dedfe3', hover: '#f0f1f3', focus: '#376bc4', primary: '#316ac3', font: 'system-ui, sans-serif' } };
    await evaluate(`frame(${js(s)}).contentWindow.postMessage({channel:'openchamber.sdk',v:1,type:'ready',payload:{...qa.ctx,surface:${js(s)},settings:{},item:null,theme:${js(theme)}}},location.origin);true`);
    await wait(s, `d.documentElement.lang===${js(locale)}`);
    const count = await posts();
    await open(s);
    const targetCount = await guest<number>(s, `return d.querySelectorAll('[data-testid="tidy-confirm"] li').length`);
    check(id + '-label', await guest(s, `return d.querySelector('#tidy-heading').textContent===${js(t.heading(targetCount))}&&d.querySelector('[data-testid="tidy-confirm-archive"] button').textContent===${js(t.confirm(targetCount))}`));
    check(id + '-failed-kept', await guest(s, `return d.querySelector('[data-testid="tidy-confirm"]').textContent.includes(${js(t.failed)}) && ![...d.querySelectorAll('[data-testid="tidy-confirm"] li')].some(n=>n.textContent.includes('P-failed'))`));
    check(id + '-reflow', await guest(s, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth'));
    await shot(id + '-confirm');
    await key('Enter');
    await wait(s, `!d.querySelector('[data-testid="tidy-confirm"]') && d.activeElement?.dataset.testid==='more-trigger'`);
    check(id + '-cancel-sends-nothing', await posts() === count);
    await open(s); await key('Escape');
    await wait(s, `!d.querySelector('[data-testid="tidy-confirm"]') && d.activeElement?.dataset.testid==='more-trigger'`);
    await open(s);
    // Cancel → Tab → Archive → Enter: genuine keyboard activation, no default submission.
    await key('Tab'); await key('Enter');
    await wait(s, `!!d.querySelector('[data-testid="tidy-undo"] button') && !d.querySelector('[data-testid="tidy-confirm"]')`);
    const resultText = await guest<string>(s, `return d.querySelector('[data-testid="tidy-result"]').textContent`);
    check(id + '-result', targetCount > 0 && resultText === t.result(targetCount, targetCount, false));
    check(id + '-history', JSON.stringify(state('P-done')) === JSON.stringify(before) && JSON.stringify(state('P-cancelled')) === JSON.stringify(cancelled));
    check(id + '-failed-visible', service.store.detail('source-fixture', 'P-failed').plan.cleanup?.state !== 'archived');
    // AX names/roles are checked against the actual browser tree, not a string-only DOM model.
    const tree = await c.send('Page.getFrameTree');
    const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.includes(`/ui/${s}/`)).frame.id;
    const ax = await c.send('Accessibility.getFullAXTree', { frameId });
    check(id + '-undo-accessible', ax.nodes.some((n: any) => n.role?.value === 'button' && n.name?.value === t.undo));
    check(id + '-result-status', await guest(s, `return d.querySelector('[data-testid="tidy-result"]').getAttribute('role')==='status'`));
    await shot(id + '-result');
    await click(s, '[data-testid="tidy-undo"] button');
    await wait(s, `d.querySelector('[data-testid="tidy-result"]')?.textContent===${js(t.result(targetCount, targetCount, true))}`);
    check(id + '-restored', service.store.detail('source-fixture', 'P-done').plan.cleanup?.state === 'visible' && JSON.stringify(state('P-done')) === JSON.stringify(before));
    await refresh(s);
    await wait(s, `!d.querySelector('[data-testid="tidy-result"]')?.textContent`);
    // Bring the other frame's list up to date before the next run.
    await refresh();
  }
  // The actual board session filter: its Tidy must not include any filtered-out plan.
  await evaluate(`qa.show('page',1280);qa.ready('page',{locale:'en'});true`);
  await refresh('page');
  width = 1280;
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await wait('page', `!!d.querySelector('[data-testid="board-filters-trigger"]')`);
  await click('page', '[data-testid="board-filters-trigger"]');
  await click('page', '[data-testid="filter-session"] button');
  await wait('page', `!!d.querySelector('[role="listbox"]')`);
  const index = await guest<number>('page', `return [...d.querySelectorAll('[role="option"]')].findIndex(n=>n.id.endsWith('-F'))`);
  check('filter-option', index >= 0);
  await key('Home'); for (let n = 0; n < index; n++) await key('ArrowDown'); await key('Enter');
  await wait('page', `!!d.querySelector('[data-testid="plan-row-P-filtered"]') && !d.querySelector('[data-testid="plan-row-P-done"]')`);
  await open('page');
  check('filtered-confirmation', await guest('page', `return d.querySelectorAll('[data-testid="tidy-confirm"] li').length===1 && d.querySelector('[data-testid="tidy-confirm"] li').textContent.includes('Filtered finished plan')`));
  await key('Tab'); await key('Enter');
  await wait('page', `!!d.querySelector('[data-testid="tidy-undo"]')`);
  check('filtered-out-untouched', service.store.detail('source-fixture', 'P-done').plan.cleanup?.state === 'visible');
  await click('page', '[data-testid="tidy-undo"] button');
  await wait('page', `d.querySelector('[data-testid="tidy-result"]')?.textContent.includes('restored')`);
  await open('page');
  const moved = service.store.detail('source-fixture', 'P-filtered').plan;
  const cleanupRev = moved.cleanup?.revision ?? 0;
  for (const [action, delta] of [['archive', 0], ['restore', 1]] as const) {
    const reply = await service.request(`/v1/plan/${action}`, { storeId: service.body().storeId, source: 'source-fixture', plan: moved.id, rev: moved.revision, cleanupRev: cleanupRev + delta, oid: crypto.randomUUID() });
    check('concurrent-' + action, reply.ok);
  }
  const conflictPosts = await posts();
  await key('Tab'); await key('Enter');
  await wait('page', `!!d.querySelector('[data-testid="tidy-retry"] button') && d.querySelector('[data-testid="tidy-result"]').textContent.includes('0 of 1')`);
  check('changed-plan-not-retried', await posts() === conflictPosts + 1);
  check('unconfirmed-archive-no-undo', await guest('page', `return !d.querySelector('[data-testid="tidy-undo"]')`));
  // A held request has already left the guest. Switching session permits that one
  // receipt to complete but must stop every subsequent request in the sequence.
  await evaluate(`qa.show('panel',1280);qa.context('M');true`);
  await refresh('panel');
  await wait('panel', `!!d.querySelector('[data-testid="surface-header"]')`);
  await open('panel');
  const stopPosts = await posts();
  await evaluate(`qa.holds.push({tag:'tidy-context',kind:'service',surface:'panel',path:'/v1/plan/archive'});true`);
  await key('Tab'); await key('Enter');
  await wait('panel', `qa.held.some(h=>h.tag==='tidy-context')`);
  await evaluate(`qa.context('F');qa.release('tidy-context');true`);
  await wait('panel', `!d.querySelector('[data-testid="tidy-confirm"]') && !!d.querySelector('[data-testid="surface-header"]')`);
  check('context-stop', await posts() === stopPosts + 1);
  // The already-dispatched request is reconciled; no Undo can leak to the new scope.
  check('context-undo-retired', await guest('panel', `return !d.querySelector('[data-testid="tidy-undo"]')`));
  // The maximum confirmation still keeps both action buttons within a phone frame.
  for (let n = 0; n < 55; n++) service.seed(`P-cap-${n}`, 'finished');
  width = 390;
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await evaluate(`qa.show('panel',390);qa.context('M');true`);
  await refresh('panel');
  await open('panel');
  check('cap-confirmation', await guest('panel', `return d.querySelectorAll('[data-testid="tidy-confirm"] li').length===50`));
  check('cap-scroll-region', await guest('panel', `const n=d.querySelector('[data-testid="tidy-confirm"] ul');return n.tabIndex===0 && !!n.getAttribute('aria-labelledby') && n.scrollHeight>n.clientHeight`));
  check('cap-actions-visible', await guest('panel', `return ['tidy-cancel','tidy-confirm-archive'].every(id=>{const r=d.querySelector('[data-testid="'+id+'"] button').getBoundingClientRect();return r.top>=0 && r.bottom<=w.innerHeight})`));
  await shot('panel-390-cap-confirm');
  await key('Escape');
  width = 1280;
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await evaluate(`qa.show('page',1280);true`);
  await refresh('page');
  // Capability absence uses an actual health refresh and leaves no bulk entry.
  old = true;
  await refresh('page');
  check('capability-health-read', oldHealthReads > 0);
  await click('page', '[data-testid="more-trigger"]');
  check('capability-absent', await guest('page', `return !d.querySelector('[data-testid="more-tidy"]')`));
  check('no-delete-request', await evaluate(`qa.requests.filter(q=>q.method==='POST').every(q=>['/v1/plan/archive','/v1/plan/restore'].includes(q.path))`));
  check('no-browser-errors', browser.page.errors.length === 0);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ passed: !failure, failure, checks, realService: true, sourceGuests: process.argv.includes('--source'), browserErrors: browser?.page.errors ?? [] }, null, 2) + '\n');
  await browser?.stop(); await fixture?.stop(); await service.stop();
}
if (failure) console.error(failure);
else console.log(JSON.stringify({ passed: true, checks: checks.length }));
