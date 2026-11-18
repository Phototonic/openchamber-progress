// Synthetic SDK host + disposable production cleanup service, not native-host certification.
// Usage: node --experimental-strip-types tests/browser/cleanup-selection-qa.ts --source --chromium <binary> --artifacts <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';
import { selectionCopy, tidyCopy } from '../../ui/shared/cleanup.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw Error('Pass --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });
const checks: string[] = [];
const check = (name: string, pass: boolean) => { if (!pass) throw Error(name); checks.push(name); };
const service = await launchCleanupService(false, false);
let old = false, width = 1280;
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
let fixture: Awaited<ReturnType<typeof startLanguageFixture>> | undefined;
let failure: string | null = null;
try {
  fixture = await startLanguageFixture({ source: process.argv.includes('--source'), service: async q => {
    if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
    const query = new URLSearchParams(q.query ?? {}).toString();
    const reply = await service.request(q.path + (query ? '?' + query : ''), q.body ? JSON.parse(q.body) : undefined);
    let body = await reply.text();
    if (old && q.path === '/health') { const h = JSON.parse(body); delete h.planCleanupActive; body = JSON.stringify(h); }
    return { status: reply.status, body };
  } });
  browser = await launchChromium(chromiumPath(arg('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Accessibility.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(code: string) => evaluate<T>(`(()=>{const w=frame('page').contentWindow,d=w.document;${code}})()`);
  const wait = async (condition: string) => {
    const ok = await evaluate(`(async()=>{const end=performance.now()+15000;while(performance.now()<end){try{const w=frame('page').contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`);
    if (!ok) throw Error(`Timeout: ${condition}; ` + await guest('return d.body.innerText.slice(0,900)'));
  };
  const control = (id: string) => `[data-testid="${id}"] button,button[data-testid="${id}"]`;
  const click = async (id: string) => {
    const selector = control(id);
    await wait(`!!d.querySelector(${js(selector)})`);
    await guest(`d.querySelector(${js(selector)}).scrollIntoView({block:'center'});return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    const [x, y] = await guest<[number, number]>(`const n=d.querySelector(${js(selector)}),r=n.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    if (width === 390) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  };
  const key = async (key: string) => {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, Home: 36, ArrowDown: 40 };
    const data = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: codes[key] ?? 0 };
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', ...data, ...(key === ' ' ? { text: ' ' } : key === 'Enter' ? { text: '\r' } : {}) });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  };
  const count = () => guest<string>(`return d.querySelector('[data-testid="selection-count"]')?.textContent`);
  const selected = () => guest<number>(`return d.querySelectorAll('button[data-testid^="plan-row-"][aria-pressed="true"]').length`);
  const refresh = async () => {
    await wait('qa.requests.length===qa.responses.length');
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await evaluate(`qa.tick('page');true`);
    await wait('qa.requests.length===qa.responses.length');
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  };
  const reload = async (locale = 'en') => {
    await evaluate(`frame('page').contentWindow.__oldSelectionFrame=true;qa.seed(undefined);qa.ready('page',{locale:${js(locale)}});qa.reload('page');true`);
    await wait(`!w.__oldSelectionFrame && !!d.querySelector('[data-testid="selection-mode"] button') && d.documentElement.lang===${js(locale)}`);
  };
  const shot = async (name: string) => {
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 844, scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
  };
  const posts = () => evaluate<any[]>(`qa.requests.filter(q=>q.method==='POST').map(q=>({path:q.path,body:JSON.parse(q.body)}))`);
  const changeView = async (archived: boolean) => {
    await click('board-filters-trigger');
    await wait(`!d.querySelector('[data-testid="board-filters"]').hidden`);
    const id = archived ? 'cleanup-archived' : 'cleanup-visible';
    await click(id);
    await wait(`d.querySelector(${js(control(id))})?.getAttribute('aria-pressed')==='true' && !!d.querySelector('[data-testid="selection-mode"] button')`);
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fixture.port}/` });
  await evaluate(`document.querySelector('#outside').hidden=true;document.querySelectorAll('section').forEach(n=>n.style.margin='0');qa.context('M');qa.show('page',1280);true`);
  for (const size of [1280, 390]) for (const locale of ['en', 'ru', 'zh-CN']) for (const dark of [false, true]) {
    width = size;
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width === 390 });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390 });
    await evaluate(`qa.show('page',${width});true`);
    await reload(locale);
    const theme = dark
      ? { mode: 'dark', tokens: { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', border: '#414650', hover: '#343944', focus: '#90b8ff', primary: '#83aff7', font: 'system-ui, sans-serif' } }
      : { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', border: '#dedfe3', hover: '#f0f1f3', focus: '#376bc4', primary: '#316ac3', font: 'system-ui, sans-serif' } };
    await evaluate(`qa.ready('page',{theme:${js(theme)}});true`);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const name = `${width}-${locale}-${dark ? 'dark' : 'light'}`;
    await click('selection-mode');
    await wait(`!!d.querySelector('button[data-testid="plan-row-P-active"]')`);
    const rowMetrics = await guest(`const n=d.querySelector('button[data-testid="plan-row-P-active"]'),r=n.getBoundingClientRect();return {height:r.height,width:r.width,board:n.closest('.ap-board')?.className,section:w.getComputedStyle(n.closest('.ap-board-project')).display}`);
    check(name + '-rows-visible ' + JSON.stringify(rowMetrics), rowMetrics.height >= 44 && rowMetrics.width > 0);
    await click('plan-row-P-active');
    await wait(`d.querySelector('button[data-testid="plan-row-P-active"]')?.getAttribute('aria-pressed')==='true'`);
    check(name + '-count', await count() === selectionCopy(locale).count(1, false));
    const before = await count();
    await refresh();
    check(name + '-poll-preserves-selection', await count() === before);
    await shot(name);
    check(name + '-no-overflow', await guest('return d.documentElement.scrollWidth<=w.innerWidth+1'));
    check(name + '-no-nested-controls', await guest(`return !d.querySelector('button button,button input,[role="option"] button')`));
    if (!dark && (locale === 'en' || width === 390 && locale === 'ru')) {
      const beforeDelete = (await posts()).filter(q => q.path.endsWith('/delete')).length;
      await click('selection-delete');
      await wait(`!!d.querySelector('[data-testid="tidy-confirm-delete"]')`);
      check(name + '-delete-initial-focus-cancel', await guest(`return !!d.activeElement?.closest('[data-testid="tidy-cancel"]')`));
      await shot(name + '-delete-cancel-focused');
      await key('Enter');
      await wait(`!d.querySelector('[data-testid="tidy-confirm"]')`);
      check(name + '-delete-enter-cancels-without-request',
        (await posts()).filter(q => q.path.endsWith('/delete')).length === beforeDelete);
      await click('selection-delete');
      await wait(`!!d.querySelector('[data-testid="tidy-confirm-delete"]')`);
      check(name + '-delete-reopened-focus-cancel', await guest(`return !!d.activeElement?.closest('[data-testid="tidy-cancel"]')`));
      await key('Escape');
      await wait(`!d.querySelector('[data-testid="tidy-confirm"]')`);
      check(name + '-delete-escape-restores-opener', await guest(`return !!d.activeElement?.closest('[data-testid="selection-delete"]')`));
      check(name + '-delete-escape-sends-nothing',
        (await posts()).filter(q => q.path.endsWith('/delete')).length === beforeDelete);
    }
    await click('selection-clear');
    await wait(`d.querySelectorAll('button[data-testid^="plan-row-"][aria-pressed="true"]').length===0`);
    check(name + '-clear', await selected() === 0);
    await click('selection-mode');
  }
  width = 1280;
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await evaluate(`qa.show('page',1280);true`); await reload();
  await click('more-trigger');
  check('visible-active-no-per-plan-cleanup', await guest(`return !d.querySelector('[role="menuitem"][data-menu-id="cleanup-archive"],[role="menuitem"][data-menu-id="cleanup-delete"]')`));
  await key('Escape');
  await click('selection-mode');
  await guest(`w.focus();d.querySelector('button[data-testid="plan-row-P-active"]').focus();w.__announcements=0;const n=d.querySelector('[data-testid="selection-count"]');new w.MutationObserver(()=>w.__announcements++).observe(n,{childList:true,subtree:true,characterData:true});return true`);
  await key(' ');
  await wait(`d.querySelector('button[data-testid="plan-row-P-active"]')?.getAttribute('aria-pressed')==='true'`);
  check('keyboard-space-count-once', await guest('return w.__announcements===1'));
  const frameTree = await c.send('Page.getFrameTree');
  const pageFrame = frameTree.frameTree.childFrames.find((f: any) => f.frame.url.includes('/ui/page/'))?.frame.id;
  if (!pageFrame) throw Error('Missing page guest frame');
  const ax = await c.send('Accessibility.getFullAXTree', { frameId: pageFrame });
  writeFileSync(join(artifacts, 'selection-accessibility.json'), JSON.stringify(ax.nodes.filter((n: any) => n.role?.value === 'button' && n.name?.value?.includes('P-active')), null, 2));
  check('accessibility-tree-selected-button', ax.nodes.some((n: any) => n.role?.value === 'button' && n.name?.value === 'P-active' && n.properties?.some((p: any) => p.name === 'pressed' && p.value?.value === 'true')));
  await refresh();
  check('poll-keeps-focused-row', await guest(`return d.activeElement?.dataset.testid==='plan-row-P-active'`));
  await click('selection-archive');
  await wait(`!!d.querySelector('[data-testid="tidy-confirm"]')`);
  await guest(`w.__retiredConfirm=d.querySelector('[data-testid="tidy-confirm-archive"] button');return true`);
  await click('plan-row-P-active');
  await wait(`!d.querySelector('[data-testid="tidy-confirm"]')`);
  await guest(`w.__retiredConfirm.click();return true`);
  check('selection-change-retires-confirmation', (await posts()).length === 0);
  await click('plan-row-P-active');
  await click('selection-archive');
  await wait(`!!d.activeElement?.closest('[data-testid="tidy-cancel"]')`);
  check('active-warning', await guest(`return d.querySelector('#tidy-heading').textContent.includes('1 still in progress')`));
  const beforeCancel = (await posts()).length;
  await key('Enter'); // Cancel has focus, so Enter cancels rather than confirming.
  await wait(`!d.querySelector('[data-testid="tidy-confirm"]')`);
  check('enter-cannot-confirm', (await posts()).length === beforeCancel);
  await click('selection-archive'); await wait(`!!d.querySelector('[data-testid="tidy-confirm"]')`);
  await key('Escape');
  await wait(`!!d.activeElement?.closest('[data-testid="selection-archive"]')`);
  // A submitted search changes the reading and selects plan results, not task controls.
  await guest(`d.querySelector('#ap-search-q').focus();return true`);
  await c.send('Input.insertText', { text: 'P-active' }); await key('Enter');
  await wait(`!!d.querySelector('[data-testid="search-results"]')`);
  check('search-clears-selection', await guest(`return !d.querySelector('[data-testid="selection-count"]')`));
  await click('selection-mode');
  await click('search-plan-source-fixture/P-active');
  await wait(`d.querySelector('[data-testid="search-plan-source-fixture/P-active"]')?.getAttribute('aria-pressed')==='true'`);
  check('search-plan-result-toggle', await count() === '1 selected');
  await click('selection-all');
  await click('selection-archive');
  await wait(`!!d.querySelector('[data-testid="tidy-confirm"]')`);
  check('matching-search-scan', await guest(`return d.querySelector('#tidy-heading').textContent.startsWith('1 selected plan;')`));
  await key('Escape'); await reload(); await click('selection-mode');
  await click('plan-row-P-active');
  await click('board-filters-trigger');
  await click('filter-session');
  await wait(`!!d.querySelector('[role="option"][id$="-M"]')`);
  const index = await guest<number>(`return [...d.querySelectorAll('[role="option"]')].findIndex(n=>n.id.endsWith('-M'))`);
  await key('Home'); for (let n = 0; n < index; n++) await key('ArrowDown'); await key('Enter');
  await wait(`!d.querySelector('[data-testid="selection-count"]')`);
  check('filter-clears-selection', true);
  await reload(); await click('selection-mode');
  // Select all includes closed folds and both recorded sources.
  await click('selection-all');
  check('all-includes-closed-folds', await count() === '6 selected');
  await click('selection-archive'); await click('tidy-confirm-archive');
  await wait(`!!d.querySelector('[data-testid="tidy-undo"]')`);
  // Undo restores only receipts: a slow reply must not let the run go on with fewer plans than it believes were archived.
  check('archive-result-reports-all-archived', await guest(`return d.querySelector('[data-testid="tidy-result"]')?.textContent===${js(tidyCopy('en').result(6, 6, 'archive'))}`));
  const archived = await posts();
  check('mixed-archive-ack-only-active', archived.length === 6 && archived.every(q => q.body.plan === 'P-active' ? q.body.active === true : !('active' in q.body)));
  const report = (oid: string) => ({ op: 'change', plan: 'P-active', rev: service.store.get(service.source.id, 'P-active')?.revision ?? 2, oid, changes: [{ id: 'A', status: 'working' }] });
  let archivedReport = '';
  try { service.store.apply(report('report-archived'), service.actor, service.capture()); } catch (e: any) { archivedReport = e.code; }
  check('production-report-archived-closed', archivedReport === 'closed');
  await click('tidy-undo'); await wait(`d.querySelector('[data-testid="tidy-result"]')?.textContent.includes('restored')`);
  const resumed = service.store.apply(report('report-restored'), service.actor, service.capture());
  check('production-report-restored-accepted', resumed.rev === 2);
  check('undo-never-acknowledges', (await posts()).slice(6).every(q => !('active' in q.body)));
  await reload(); await click('selection-mode'); await click('plan-row-P-active'); await click('selection-archive');
  service.store.apply(report('report-before-request'), service.actor, service.capture());
  await click('tidy-confirm-archive');
  await wait(`d.querySelector('[data-testid="tidy-result"]')?.textContent.includes('1 skipped')`);
  check('changed-active-target-skipped', service.store.detail(service.source.id, 'P-active').plan.cleanup?.state === 'visible');
  // Restore a selected archived in-progress plan without using Undo.
  await reload(); await click('selection-mode'); await click('plan-row-P-active'); await click('selection-archive'); await click('tidy-confirm-archive');
  await wait(`!!d.querySelector('[data-testid="tidy-undo"]')`);
  await changeView(true);
  await wait(`!!d.querySelector('[data-testid="selection-mode"] button')`);
  check('view-change-clears-selection', await guest(`return !d.querySelector('[data-testid="selection-count"]')`));
  await click('more-trigger');
  check('archived-active-per-plan-actions', await guest(`return !!d.querySelector('[role="menuitem"][data-menu-id="cleanup-restore"]') && !!d.querySelector('[role="menuitem"][data-menu-id="cleanup-delete"]')`));
  await key('Escape');
  await click('selection-mode'); await click('plan-row-P-active'); await click('selection-restore'); await click('tidy-confirm-archive');
  await wait(`d.querySelector('[data-testid="tidy-result"]')?.textContent.includes('restored')`);
  check('selection-restore-never-acknowledges', (await posts()).filter(q => q.path.endsWith('/restore')).every(q => !('active' in q.body)));
  await changeView(false);
  old = true; await reload();
  await click('selection-mode'); await click('selection-all'); await click('selection-archive');
  await wait(`!!d.querySelector('[data-testid="tidy-confirm"]')`);
  check('capability-absent-wording', await guest(`return d.querySelector('#tidy-heading').textContent.includes('1 in-progress plan left out')`));
  await shot('capability-absent');
  await key('Escape');
  old = false; await reload();
  await click('selection-mode'); await click('plan-row-P-active'); await click('plan-row-P-failed'); await click('selection-delete');
  await wait(`!!d.querySelector('[data-testid="tidy-confirm-delete"]')`);
  check('mixed-delete-initial-focus-cancel', await guest(`return !!d.activeElement?.closest('[data-testid="tidy-cancel"]')`));
  check('delete-warning-and-finality', await guest(`const t=d.querySelector('#tidy-heading').textContent;return t.includes('cannot be undone')&&t.includes('1 still in progress')`));
  await shot('delete-confirm');
  await click('tidy-confirm-delete');
  await wait(`d.querySelector('[data-testid="tidy-result"]')?.textContent.includes('deleted')`);
  let deletedReport = '';
  try { service.store.apply(report('report-deleted'), service.actor, service.capture()); } catch (e: any) { deletedReport = e.code; }
  check('production-report-deleted-not-found', deletedReport === 'not-found');
  check('delete-no-undo', await guest(`return !d.querySelector('[data-testid="tidy-undo"]')`));
  const deletions = (await posts()).filter(q => q.path.endsWith('/delete'));
  check('delete-ack-only-active', deletions.length === 2 && deletions.every(q => q.body.plan === 'P-active' ? q.body.active === true : !('active' in q.body)));
  await evaluate(`qa.show('panel',390);true`);
  check('rail-no-select', await evaluate(`!frame('panel').contentDocument.querySelector('[data-testid="selection-mode"]')`));
  check('browser-console', browser.page.errors.length === 0);
} catch (e) { failure = String(e); }
finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ checks, failure, syntheticHost: true, browserErrors: browser?.page.errors ?? [] }, null, 2));
  if (failure && browser) {
    const png = await browser.page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(artifacts, 'failure.png'), Buffer.from(png.data, 'base64'));
  }
  await browser?.stop(); await fixture?.stop(); await service.stop();
}
if (failure) throw Error(failure);
console.log(JSON.stringify({ checks: checks.length, failure }));
