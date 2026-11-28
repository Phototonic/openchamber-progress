import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProgressServer } from '../../service/server.ts';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import type { Actor } from '../../shared/progress.ts';
import { productionFixture } from '../fixtures/production.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';

const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const artifacts = option('--artifacts') ?? '';
if (!artifacts) throw Error('Pass --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });
const f = productionFixture(), { store, actor } = f, source = f.source.id, plan = 'sample';
const binding = { sourceId: source, verified: true }, token = 'fixture-only';
const service = createProgressServer(store, token);
const a = { ...f.child, sessionId: 'child-A' }, b = { ...f.child, sessionId: 'child-B' };
const long = 'retired-task-' + '0123456789'.repeat(6);
const items = [
  { id: long, title: 'Retired example task', kind: 'task' },
  { id: 'review', title: 'Review the example', kind: 'task' },
  { id: 'publish', title: 'Prepare example output', kind: 'task' },
];
let rev = 0;
function apply(request: Record<string, unknown>, who: Actor = actor, child?: Actor) {
  rev = store.apply({ plan, rev, oid: `report-${rev}`, ...request }, who, undefined, child).rev;
}
const checks: string[] = [], screenshots: string[] = [];
let shell: Awaited<ReturnType<typeof startLanguageFixture>> | undefined, browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
let phase = 'startup';
let failDetail = false;
try {
  store.bindReads(source, true);
  apply({ op: 'start', title: 'Sample plan', items });
  apply({ op: 'link', child: a.sessionId, assign: [long, 'review'] }, actor, a);
  apply({ op: 'link', child: b.sessionId, assign: ['publish'] }, actor, b);
  while (rev < 253) apply({ op: 'change', changes: [{ id: 'review', status: 'working' }] });
  apply({ op: 'change', changes: [{ id: long, status: 'done' }, { id: 'review', status: 'working' }] }, a); // 254
  apply({ op: 'change', attributed: b.sessionId, changes: [{ id: 'publish', status: 'working' }] }, actor, b);
  apply({ op: 'change', changes: [{ id: 'publish', status: 'pending' }] }, b);
  const cancelled = store.cancelPlan({ storeId: store.list().storeId, binding, source, plan, rev, cleanupRev: 0, oid: 'user-cancel', confirmed: true });
  rev = cancelled.rev; // 257
  apply({ op: 'revise', title: 'Sample plan', items: items.slice(1), reopen: true });
  apply({ op: 'finish', outcome: 'cancelled', changes: [{ id: 'publish', status: 'pending' }] });
  apply({ op: 'revise', title: 'Sample plan', reopen: true });
  apply({ op: 'change', changes: [{ id: 'review', status: 'working' }] }); // 261 without a contribution
  store.db.prepare('DELETE FROM contributions WHERE source=? AND plan=? AND revision=?').run(source, plan, rev);
  apply({ op: 'change', changes: [{ id: 'review', status: 'working' }] }, a);
  apply({ op: 'change', changes: [{ id: 'publish', status: 'working' }] }, b);
  assert.equal(rev, 263);
  const recordedTime = (revision: number) => JSON.parse(String(store.db.prepare(
    'SELECT payload FROM contributions WHERE source=? AND plan=? AND revision=?',
  ).get(source, plan, revision)?.payload)).reportedAt;

  service.listen(0, '127.0.0.1');
  await once(service, 'listening');
  const base = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
  shell = await startLanguageFixture({ source: process.argv.includes('--source'), async service(q) {
    const url = new URL(q.path, base);
    if (url.origin !== base || q.method !== 'GET') return { status: 404, body: '{"error":"not-found"}' };
    if (failDetail && q.path === '/v1/plan') return { status: 503, body: '{"error":"busy"}' };
    url.search = new URLSearchParams(q.query).toString();
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    return { status: res.status, body: await res.text() };
  } });
  browser = await launchChromium(chromiumPath(option('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Accessibility.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function evaluate<T = unknown>(expression: string): Promise<T> {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }
  let surface = 'page', width = 1280;
  const guest = <T = unknown>(body: string) => evaluate<T>(`(()=>{const w=frame(${js(surface)}).contentWindow,d=w.document;${body}})()`);
  const by = (selector: string) => `d.querySelector(${js(selector)})`;
  const hook = (id: string) => `[data-testid="${id}"]`;
  const toggle = hook('activity-toggle'), older = hook('activity-older'), newer = hook('activity-newer');
  const row = (n: number) => hook(`activity-revision-${n}`);
  const activityRequests = () => evaluate<number[]>(`qa.requests.filter(q=>q.path==='/v1/history'&&q.surface===${js(surface)}&&q.query?.through).map(q=>Number(q.query.through))`);
  async function wait(condition: string) {
    const ok = await evaluate(`(async()=>{const end=performance.now()+8500;while(performance.now()<end){
      try{const w=frame(${js(surface)}).contentWindow,d=w.document;if(${condition})return true}catch{}
      await new Promise(r=>requestAnimationFrame(r));
    }return false})()`);
    assert.ok(ok, `${phase}: ${surface}: ${condition}${ok ? '' : `; activity requests ${await activityRequests()}`}`);
  }
  const exists = (selector: string) => wait(`!!${by(selector)}`);
  const text = (selector: string) => guest<string>(`return ${by(selector)}.textContent`);
  async function focus(selector: string) {
    await exists(selector);
    await guest(`const node=${by(selector)};node.focus();node.scrollIntoView({block:'center'});`);
  }
  async function pressSpace() {
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  }
  async function click(selector: string) {
    await exists(selector);
    const [x, y] = await guest<[number, number]>(`const n=${by(selector)};n.scrollIntoView({block:'center'});
      const r=n.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    if (width === 390) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  async function shot(name: string, at = toggle) {
    await guest(`${by(at)}.scrollIntoView({block:'start'});return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 844, scale: 1 } });
    const file = `${name}.png`;
    writeFileSync(join(artifacts, file), Buffer.from(png.data, 'base64')); screenshots.push(file);
  }
  async function start(name: string, size: number) {
    surface = name; width = size;
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width === 390 });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390 });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${shell!.port}/` });
    await evaluate(`(async()=>{while(!window.qa || !frame(${js(surface)}))await new Promise(r=>requestAnimationFrame(r));
      document.querySelector('#outside').hidden=true;
      document.querySelectorAll('section').forEach(n=>n.style.margin='0');
      qa.context(${js(actor.sessionId)});
      qa.ready(undefined,{locale:'en',device:{formFactor:${js(width === 390 ? 'phone' : 'desktop')},pointer:${js(width === 390 ? 'coarse' : 'fine')}}});
      qa.show(${js(surface)},${width});
      return true;})()`);
    await exists(`${hook('plan-view-list')} button`);
    await click(`${hook('plan-view-list')} button`);
    await wait(`${by(toggle)}?.getAttribute('aria-expanded')==='false'`);
  }
  async function open() { await focus(toggle); await pressSpace(); await exists(row(rev)); }
  async function pageIs(first: number, last: number) {
    const actual = await guest<number[]>(`return [...d.querySelectorAll('[data-testid^="activity-revision-"]')].map(n=>Number(n.dataset.testid.split('-').at(-1)))`);
    assert.deepEqual(actual, Array.from({ length: first - last + 1 }, (_, i) => first - i));
  }
  for (const [name, size] of [['page', 1280], ['panel', 390], ['panel', 1280], ['page', 390]] as const) {
    phase = `${name} ${size}`;
    failDetail = name === 'page' && size === 390;
    await start(name, size);
    assert.deepEqual(await activityRequests(), []);
    if (name === 'page' && size === 1280) {
      await shot('collapsed');
      assert.ok(await guest(`return ${by(toggle)}.closest('article')?.querySelector('.ap-tasks').compareDocumentPosition(${by(toggle)}) & 4`));
    }
    await open(); await pageIs(263, 244);
    if (failDetail) {
      await wait(`${by(hook('detail-loading'))}?.textContent.includes('could not be loaded')`);
      checks.push('board: Activity remains readable when task detail fails');
    }
    assert.deepEqual(await activityRequests(), [263]);
    const frames = await c.send('Page.getFrameTree');
    const frameId = frames.frameTree.childFrames.find((entry: any) => entry.frame.url.endsWith(`/ui/${surface}/index.html`)).frame.id;
    const ax = await c.send('Accessibility.getFullAXTree', { frameId });
    assert.ok(ax.nodes.some((n: any) => n.role?.value === 'button' && n.name?.value === 'Activity' &&
      n.properties?.some((p: any) => p.name === 'expanded' && p.value?.value === true)));
    assert.equal(await guest(`return ${by(row(254))}.querySelector('time').dateTime`), recordedTime(254));
    assert.match(await text(row(254)), /Sub-agent · reported directly by .*child-A/);
    assert.match(await text(row(255)), /Coordinator · reported by .* for .*child-B/);
    assert.ok((await text(row(254))).includes(`${long}, review`));
    assert.ok((await text(row(257))).includes('Cancelled by user'));
    assert.equal(await guest(`return ${by(row(257))}.querySelector('time').dateTime`), cancelled.reportedAt);
    assert.match(await text(row(259)), /Coordinator · reported directly by .*Task IDs: publish/);
    assert.match(await text(row(258)), /No task IDs reported/);
    assert.match(await text(row(261)), /Report details unavailable/);
    assert.equal(await guest(`return ${by(row(261))}.querySelector('.ap-activity-report')`), null);
    assert.ok(await guest(`return [...d.querySelectorAll('.ap-activity-report,.ap-activity button')].every(n=>n.scrollWidth<=n.clientWidth)`));
    if (width === 390) {
      const line = `${row(254)} .ap-activity-report:last-child`;
      const wraps = await guest(`const n=${by(line)};return n.offsetHeight>parseFloat(w.getComputedStyle(n).lineHeight)`);
      assert.equal(wraps, true);
    }
    await shot(name === 'page' && width === 1280 ? 'activity' : `${name}-${width}-activity`);
    if (name === 'page' && width === 1280) {
      await evaluate(`qa.holds.push({tag:'retired-window',kind:'service',surface:'page',path:'/v1/history'});true`);
      await focus(older); await pressSpace(); await wait('qa.held.some(h=>h.tag==="retired-window")');
      assert.deepEqual(await activityRequests(), [263, 243]);
      await wait(`${by(older)}?.getAttribute('aria-disabled')==='true' && d.activeElement===${by(older)}`);
      await pressSpace(); assert.deepEqual(await activityRequests(), [263, 243]);
      await focus(`${hook('item-toggle-review')} summary`); await pressSpace();
      await wait(`${by(hook('item-toggle-review'))}?.open===true`);
      await focus(toggle); await pressSpace();
      await wait(`${by(toggle)}?.getAttribute('aria-expanded')==='false'`);
      await evaluate(`qa.holds=[];true`);
      await open();
      await evaluate(`qa.release('retired-window')`);
      await wait(`qa.responses.some(q=>q.query?.through==='243')`);
      await pageIs(263, 244);
      assert.equal(await guest(`return d.activeElement.dataset.testid`), 'activity-toggle');
      await focus(older); await pressSpace(); await exists(row(243));
      await pageIs(243, 224);
      assert.equal(await guest(`return d.activeElement.dataset.testid`), 'activity-older');
      assert.deepEqual(await activityRequests(), [263, 243, 263, 243]);
      await shot('older');
      await focus(newer); await pressSpace(); await exists(row(263)); await pageIs(263, 244);
      const prior = await evaluate<number>(`qa.responses.filter(r=>r.path==='/v1/plans'&&r.surface==='page').length`);
      await evaluate(`qa.tick('page');true`);
      await wait(`qa.responses.filter(r=>r.path==='/v1/plans'&&r.surface==='page').length>${prior}`);
      assert.deepEqual(await activityRequests(), [263, 243, 263, 243, 263]);
      await click(`${hook('plan-view-history')} button`);
      const history = hook('revision-257');
      await exists(history);
      assert.match(await text(history), /Cancelled by user/);
      assert.equal(await guest(`return ${by(toggle)}`), null);
      assert.ok(await evaluate(`qa.requests.some(q=>q.surface==='page'&&q.path==='/v1/change-digest')`));
      assert.ok(await evaluate(`qa.requests.some(q=>q.surface==='page'&&q.path==='/v1/history'&&q.query?.cursor==='13')`));
      assert.deepEqual(await activityRequests(), [263, 243, 263, 243, 263]);
      checks.push('board: older/newer, no duplicate keys, retained focus, cancel/reopen during a held reply, no refresh work, independent History and digest');
    }
    if (name === 'panel' && width === 390) {
      for (const [task, mode, revision] of [['review', 'direct', 254], ['publish', 'parent-relay', 255]] as const) {
        const taskToggle = hook(`item-toggle-${task}`);
        await focus(`${taskToggle} summary`); await pressSpace();
        const taskReport = `${taskToggle} [data-report="${mode}"]`;
        await exists(taskReport);
        // The task facts can list multiple distinct reporters for one mode.
        const phrases = await guest<string[]>(`return [...d.querySelectorAll(${js(taskReport)})].map(n=>n.textContent.replace(/^Task /,''))`);
        const activity = await text(row(revision));
        assert.ok(phrases.some(phrase => activity.includes(phrase)), `${task} task facts do not include the report displayed in activity`);
      }
      for (const [locale, title, cancel, relay] of [
        ['ru', 'Активность', 'Отменён пользователем', 'передан сессией'],
        ['zh-CN', '活动', '由用户取消', '为'],
      ]) {
        await evaluate(`qa.ready('panel',{locale:${js(locale)}});true`);
        await wait(`d.documentElement.lang===${js(locale)} && ${by(toggle)}?.textContent===${js(title)}`);
        assert.ok((await text(row(257))).includes(cancel));
        assert.ok((await text(row(255))).includes(relay));
        assert.deepEqual(await activityRequests(), [263]);
        await shot(`panel-390-${locale}`, row(255));
      }
      checks.push('rail: changed language while open without fetching or moving the page');
    }
    checks.push(`${name} ${size}px: accessible disclosure, 20 contiguous rows, exact recorded times, direct/relay attribution, user and agent cancellation, absent details and literal IDs`);
  }
  assert.deepEqual(c.errors, []);
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ chromium: browser.version, checks, screenshots, consoleErrors: 0 }, null, 2) + '\n');
  console.log(`Plan Activity rendered QA passed (${checks.length} checks, ${screenshots.length} screenshots).`);
} catch (e) {
  console.error(`Plan Activity phase: ${phase}`);
  throw e;
} finally {
  await browser?.stop();
  await shell?.stop();
  if (service.listening) { service.close(); await once(service, 'close'); }
  f.cleanup();
}
