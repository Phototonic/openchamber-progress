// Rendered reading-state QA: fresh Chromium, synthetic SDK host, disposable built service.
// node --experimental-strip-types tests/browser/interface-language-reading-qa.ts --artifacts <external-dir> [--chromium <installed-path>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';
import { LANGUAGE_KEY } from './interface-language-fixture.ts';
import { startReadingFixture } from './interface-language-reading-fixture.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const destination = arg('--artifacts');
if (!destination) throw Error('Pass --artifacts <external-directory> [--chromium <installed-path>].');
const artifacts = resolve(destination), repo = resolve('.');
if (artifacts === repo || artifacts.startsWith(repo + '/')) throw Error('Artifacts must be outside the repository.');
mkdirSync(artifacts, { recursive: true });
const explicit = arg('--chromium') ?? process.env.CHROMIUM_PATH;
const cache = join(homedir(), '.cache/ms-playwright');
const candidates = [...(existsSync(cache) ? readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')) : []), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
const executable = explicit ?? candidates.find(existsSync);
if (!executable || !isAbsolute(executable) || !existsSync(executable)) throw Error('No installed Chromium; no downloads attempted.');
const profile = mkdtempSync('/tmp/opencode/interface-language-reading-');
const results: { id: string; pass: boolean }[] = [], operations: unknown[] = [];
const check = (id: string, pass: boolean) => { results.push({ id, pass }); if (!pass) throw Error(id); };
let failure: string | null = null, ws: WebSocket | undefined, chrome: ReturnType<typeof spawn> | undefined;
let fixture: Awaited<ReturnType<typeof startReadingFixture>> | undefined;
let diagnose: (() => Promise<unknown>) | undefined;
try {
  fixture = await startReadingFixture();
  const historicalExpected = fixture.historicalExpected;
  const origin = `http://127.0.0.1:${fixture.port}`;
  chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true });
  for (const end = Date.now() + 15000; !existsSync(join(profile, 'DevToolsActivePort')) && Date.now() < end;) await new Promise(r => setTimeout(r, 50));
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  ws = new WebSocket(targets.find(t => t.type === 'page')!.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = () => reject(Error('CDP connection failed')); });
  let next = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const errors: string[] = [];
  const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = event => {
    const m = JSON.parse(String(event.data)), p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push('runtime exception');
    else if (m.method === 'Fetch.requestPaused') {
      const allowed = m.params.request.url.startsWith(origin + '/');
      if (!allowed) errors.push('external request blocked');
      void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) });
    }
  };
  const evaluate = async <T = any>(expression: string): Promise<T> => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error('QA expression failed: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r.result.value; };
  const guest = <T = any>(code: string) => evaluate<T>(`(()=>{const w=frame('page').contentWindow,d=w.document;${code}})()`);
  diagnose = () => evaluate(`({guest:(()=>{const d=frame('page').contentDocument;return {buttons:[...d.querySelectorAll('button')].map(n=>({id:n.closest('[data-testid]')?.dataset.testid,text:n.textContent.slice(0,80)})),documents:[...d.querySelectorAll('[data-testid^="document-"]')].map(n=>({id:n.dataset.testid,text:n.textContent.slice(0,250)}))}})(),requests:qa.requests.map(q=>({surface:q.surface,path:q.path})),faults:qa.faults})`);
  const condition = (code: string) => `(()=>{const w=frame('page').contentWindow,d=w.document;return ${code}})()`;
  const wait = async (code: string, name: string) => { if (!await evaluate(`(async()=>{const end=Date.now()+8000;while(Date.now()<end){try{if(${code})return true}catch{}await new Promise(r=>setTimeout(r,25))}return false})()`)) throw Error('Timed out: ' + name); };
  const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,0))))');
  const key = async (key: string) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: ({ Enter: 13, Escape: 27, Home: 36, ArrowDown: 40 } as Record<string, number>)[key] ?? 0, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }); };
  const click = async (selector: string) => {
    const point = await evaluate<number[]>(`(()=>{const f=frame('page'),n=f.contentDocument.querySelector(${literal(selector)});if(!n)throw Error('Missing QA target');n.scrollIntoView({block:'center'});const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return[a.x+b.x+a.width/2,a.y+b.y+a.height/2]})()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: 'left', clickCount: 1 });
    await frames();
  };
  const focus = async (selector: string) => { await guest(`d.querySelector(${literal(selector)}).focus();return true`); await frames(); };
  const popup = '.oc-sdk-popup [role="listbox"]';
  const trigger = '[data-testid="interface-language"] button[aria-haspopup="listbox"]';
  const choose = async (preference: 'auto' | 'en' | 'ru') => {
    await wait(condition(`d.querySelector(${literal(trigger)})?.disabled===false`), 'language enabled');
    await focus(trigger); await key('Enter'); await wait(condition(`!!d.querySelector(${literal(popup)})`), 'language popup');
    await key('Home'); for (let i = 0; i < ['auto', 'en', 'ru'].indexOf(preference); i++) await key('ArrowDown'); await key('Enter'); await frames();
  };
  const settled = (language: string) => wait(condition(`d.documentElement.lang===${literal(language)}&&d.querySelector(${literal(trigger)})?.disabled===false`), 'language settled');
  const io = () => evaluate<any>(`({services:qa.requests.reduce((a,q)=>(a[q.path]=(a[q.path]||0)+1,a),{}),writes:qa.storageLog.filter(q=>q.op==='set'||q.op==='delete').map(q=>({key:q.key,op:q.op,scope:q.scope}))})`);
  const unchanged = async (id: string, run: () => Promise<unknown>, languageWrites = 0) => {
    const before = await io(); await run(); await frames(); const after = await io();
    const added = after.writes.slice(before.writes.length);
    operations.push({ id, before, after });
    check(id + ':service-counts-unchanged', JSON.stringify(before.services) === JSON.stringify(after.services));
    check(id + ':exact-storage-writes', added.length === languageWrites && added.every((q: any) => q.key === LANGUAGE_KEY && q.op === 'set' && q.scope === 'device'));
  };
  const change = (id: string, preference: 'auto' | 'en' | 'ru', language: string) => unchanged(id, async () => { await choose(preference); await settled(language); }, 1);
  const scenarioFailures: string[] = [];
  const scenario = async (id: string, run: () => Promise<void>) => {
    const before = await io();
    try { await run(); } catch (error) { const message = error instanceof Error ? error.message.split('\n')[0] : id; scenarioFailures.push(message); results.push({ id: id + ':' + message, pass: false }); }
    finally { operations.push({ id: id + ':scenario-total', before, after: await io() }); }
  };
  const tab = (id: string) => `[role="tab"][data-id="${id}"]`;
  const openPlan = async (id: string) => { await click(`[data-testid="plan-row-${id}"]`); await wait(condition(`d.querySelector('[data-testid="plan-row-${id}"]')?.getAttribute('aria-selected')==='true'`), 'selected plan'); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Page.navigate', { url: origin + '/' });
  await wait(`window.qa&&${condition(`!!d.querySelector('[data-testid="plan-row-P-reading"]')`)}`, 'reading board');
  await evaluate(`qa.show('page',1100)`); await frames();
  await change('initial-explicit-English', 'en', 'en');

  // Typed draft, selected status filter, submitted query and retained result identity.
  await click('[data-testid="board-filters-trigger"]');
  await focus('[data-testid="search-task-status"] button'); await key('Enter'); await key('Home'); for (let i = 0; i < 4; i++) await key('ArrowDown'); await key('Enter');
  const filter = () => guest(`const b=d.querySelector('[data-testid="search-task-status"] button');return b?.getAttribute('aria-activedescendant')||b?.textContent`);
  await focus('#ap-search-q'); await send('Input.insertText', { text: 'Export' });
  await change('typed-search-language', 'ru', 'ru');
  check('typed-search:preserved', await guest(`return d.querySelector('#ap-search-q').value==='Export'`));
  await click('[data-testid="board-filters-trigger"]');
  check('draft-filter:still-done', String(await filter()).includes('Выполн') || String(await filter()).includes('Done'));
  await focus('#ap-search-q'); await key('Enter');
  await wait(condition(`!!d.querySelector('[data-testid="search-results"]')&&!d.querySelector('[data-testid="search-loading"]')`), 'submitted search');
  const hits = () => guest(`return [...d.querySelectorAll('[data-testid^="search-task-"],[data-testid^="search-plan-"]')].map(n=>n.dataset.testid)`);
  const submitted = await hits(); check('submitted-search:has-match', submitted.length > 0);
  await focus('#ap-search-q');
  await guest(`const n=d.querySelector('#ap-search-q');n.select();return true`);
  await send('Input.insertText', { text: 'Review' });
  await change('submitted-search-language', 'en', 'en');
  check('submitted-search:results-preserved', JSON.stringify(submitted) === JSON.stringify(await hits()));
  check('submitted-search:newer-unsubmitted-draft-preserved', await guest(`return d.querySelector('#ap-search-q').value==='Review'&&!d.querySelector('[data-testid="search-pending-edit"]').hidden`));
  check('submitted-search:filter-preserved', await evaluate(`qa.requests.filter(q=>q.surface==='page'&&q.path==='/v1/search').every(q=>q.query.status==='done')`));
  // Leave search through its actual clear control, then select a concrete detail.
  await click('[data-testid="search-clear"] button');
  await wait(condition(`!!d.querySelector('[data-testid="plan-row-P-reading"]')`), 'board restored');
  await openPlan('P-reading'); await click(tab('document'));
  await wait(condition(`!!d.querySelector('[data-testid="document-text"]')`), 'ready document');
  const documentText = await guest(`return d.querySelector('[data-testid="document-text"]').textContent`);
  const verifyDocumentState = async (state: 'ready' | 'errored') => {
    if (state === 'errored') {
      const hellos = await evaluate<number>(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length`);
      await evaluate(`qa.faults=[{kind:'service',surface:'page',path:'/v1/document',status:503}];qa.reload('page')`);
      await wait(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length>${hellos}&&${condition(`!!d.querySelector('[data-testid="plan-row-P-reading"]')`)}`, 'reloaded board');
      await openPlan('P-reading'); await click(tab('document'));
      await wait(condition(`!!d.querySelector('[data-testid="document-loading"] button')`), 'document error');
    }
    await unchanged(state + ':saving', async () => {
      await evaluate(`qa.holds=[{tag:'save',kind:'storage',surface:'page',op:'set',key:${literal(LANGUAGE_KEY)}}]`); await choose('ru');
      await wait(`qa.held.some(h=>h.tag==='save')`, 'held save');
      check(state + ':pending-retains-English', await guest(`return d.documentElement.lang==='en'`));
    }, 1);
    await unchanged(state + ':failed-save', async () => {
      await evaluate(`qa.faults.push({kind:'storage',surface:'page',op:'set',key:${literal(LANGUAGE_KEY)}});qa.release('save')`); await settled('en');
    });
    await evaluate(`qa.faults=qa.faults.filter(q=>q.kind!=='storage')`);
    await change(state + ':same-effective', 'auto', 'en');
    await change(state + ':changed-language', 'ru', 'ru');
    check(state + ':document-state-retained', await guest(state === 'ready' ? `return d.querySelector('[data-testid="document-text"]')?.textContent===${literal(documentText)}` : `return !!d.querySelector('[data-testid="document-loading"] button')&&!d.querySelector('[data-testid="document-text"]')`));
    await change(state + ':reset-English', 'en', 'en');
  };
  await verifyDocumentState('ready');
  await click('[data-testid="capture-toggle"] button');
  await wait(condition(`!!d.querySelector('[data-testid="capture-diff"]')`), 'comparison pair');
  const pair = () => guest(`return ['before','after'].map(s=>d.querySelector('[data-testid="capture-'+s+'"] button')?.textContent?.match(/#[0-9]+/)?.[0])`);
  const selectedPair = await pair(); check('comparison:two-distinct-captures', selectedPair.every(Boolean) && selectedPair[0] !== selectedPair[1]);
  await change('comparison-language', 'ru', 'ru');
  check('comparison:pair-preserved', JSON.stringify(selectedPair) === JSON.stringify(await pair()));
  check('selected-tab-and-plan:preserved', await guest(`return d.querySelector(${literal(tab('document'))})?.getAttribute('aria-selected')==='true'&&!!d.querySelector('[data-testid="plan-P-reading"]')`));

  await click(tab('history'));
  await wait(condition(`!!d.querySelector('[data-testid="change-digest"]')?.dataset.to`), 'pinned digest');
  const interval = () => guest(`const n=d.querySelector('[data-testid="change-digest"]');return {to:n.dataset.to,after:n.dataset.after}`);
  const pinned = await interval();
  await change('pinned-digest-language', 'en', 'en');
  check('pinned-digest:interval-preserved', JSON.stringify(pinned) === JSON.stringify(await interval()));

  await click(tab('progress'));
  await click(tab('map'));
  await wait(condition(`!!d.querySelector('[data-testid="map-card-B"]')`), 'dependency map');
  const mapState = () => guest(`return {transform:d.querySelector('[data-testid="map-world"]')?.style.transform,selected:d.querySelector('[data-testid="map-card-A"]')?.getAttribute('aria-current')}`);
  await click('[data-testid="map-card-A"]');
  const initialMap = await mapState();
  await click('[data-testid="map-zoom-in"]');
  const zoomedMap = await mapState(); check('map:zoom-control-changes-transform', initialMap.transform !== zoomedMap.transform);
  await click('[data-testid="map-pan-right"]');
  const map = await mapState(); check('map:nontrivial-transform-and-selection', !!map.transform && map.selected === 'true');
  check('map:pan-control-changes-transform', map.transform !== zoomedMap.transform);
  await click('[data-testid="map-group-context"] summary');
  await change('map-language', 'ru', 'ru'); check('map:selection-pan-zoom-preserved', JSON.stringify(map) === JSON.stringify(await mapState()));
  check('map:disclosure-preserved', await guest(`return d.querySelector('[data-testid="map-group-context"]').open`));

  // Separate SDK picker remains in its painted language through external preference + label tick.
  const verifyIndependentPicker = async () => {
  await evaluate(`qa.seed({v:1,preference:'ru'});qa.focus('page')`); await settled('ru');
  await click(tab('document'));
  await click('[data-testid="capture-toggle"] button');
  await wait(condition(`!!d.querySelector('[data-testid="capture-diff"]')`), 'independent capture picker');
  const independent = '[data-testid="capture-before"] button';
  check('independent-picker:outside-live-popup', await guest(`return !d.querySelector(${literal(independent)}).closest('[data-live-popup]')`));
  await focus(independent); await key('Enter'); await wait(condition(`!!d.querySelector(${literal(popup)})`), 'independent picker');
  const painted = await guest(`return d.querySelector(${literal(popup)}).textContent`);
  const paintedLabels = await guest(`return [...d.querySelectorAll('time[data-age],time[data-elapsed]')].map(n=>n.textContent)`);
  check('independent-picker:has-ticking-labels', paintedLabels.length > 0);
  await unchanged('independent-picker-external-language-and-tick', async () => {
    await evaluate(`qa.seed({v:1,preference:'en'});qa.focus('page')`); await frames();
  });
  const beforeTick = await io();
  const ticks = await evaluate(`qa.tick('page')[0]`); await frames();
  const afterTick = await io(); operations.push({ id: 'independent-picker-existing-timers', ticks, before: beforeTick, after: afterTick });
  check('independent-picker:existing-timers-fired', ticks > 0);
  check('independent-picker:tick-no-storage-writes', afterTick.writes.length === beforeTick.writes.length);
  check('independent-picker:painted-language-held', await guest(`return d.documentElement.lang==='ru'&&d.querySelector(${literal(popup)})?.textContent===${literal(painted)}`));
  check('independent-picker:labels-stay-painted-language', JSON.stringify(paintedLabels) === JSON.stringify(await guest(`return [...d.querySelectorAll('time[data-age],time[data-elapsed]')].map(n=>n.textContent)`)));
  await key('Escape'); await settled('en');
  };

  await scenario('historical-summary', async () => {
  await change('historical-prepare-English', 'en', 'en');
  await openPlan('P-history');
  await click(tab('progress'));
  await wait(condition(`!!d.querySelector('[data-testid="detail-loading"] button')`), 'failed continuation');
  // Returning to a retired reading cannot reuse its degraded snapshot. Explicitly retry
  // in this visit to obtain a valid first-page summary before its continuation fails.
  const detailReads = await evaluate<number>(`qa.requests.filter(q=>q.surface==='page'&&q.path==='/v1/plan').length`);
  await click('[data-testid="detail-loading"] button');
  await wait(`qa.requests.filter(q=>q.surface==='page'&&q.path==='/v1/plan').length>${detailReads}&&${condition(`!!d.querySelector('[data-testid="detail-loading"] button')`)}`, 'current-visit historical snapshot');
  await wait(condition(`!!d.querySelector('[data-testid="plan-actions"] button')`), 'historical actions');
  await click('[data-testid="plan-actions"] button'); await key('Home'); await key('Enter');
  await wait(condition(`!!d.querySelector('button[data-testid="summary-only"]')`), 'summary-only choice');
  await click('button[data-testid="summary-only"]');
  const historical = await guest(`return d.querySelector('[data-testid="summary-text"]')?.value`);
  check('historical:exact-English-permitted-snapshot-only', historical === historicalExpected.en);
  await change('historical-summary-language', 'ru', 'ru');
  check('historical:exact-same-snapshot-in-Russian-no-full-list', await guest(`return d.querySelector('[data-testid="summary-text"]')?.value===${literal(historicalExpected.ru)}&&!d.querySelector('[data-testid="summary-only"]')`));
  });

  await scenario('support-summary', async () => {
  await choose('en'); await settled('en');
  await click('[data-testid="reporting-health-toggle"] button');
  await wait(condition(`!!d.querySelector('[data-testid="reporting-support"]')`), 'support summary');
  await click('[data-testid="reporting-support"] summary');
  const support = await guest(`return d.querySelector('[data-testid="reporting-support-preview"]').value`);
  await click('[data-testid="reporting-support-copy"] button');
  await wait(`navigator.clipboard.readText().then(t=>t===${literal(support)})`, 'support copied');
  await change('support-summary-language', 'ru', 'ru');
  check('support-summary:bytes-and-disclosure-preserved', await guest(`return d.querySelector('[data-testid="reporting-support-preview"]').value===${literal(support)}&&d.querySelector('[data-testid="reporting-support"]').open`));
  await click('[data-testid="reporting-support-copy"] button');
  check('support-summary:copied-bytes-unchanged', await evaluate('navigator.clipboard.readText()') === support);
  });
  await scenario('independent-picker', async () => { await openPlan('P-reading'); await verifyIndependentPicker(); });
  await key('Escape'); await evaluate(`qa.seed({v:1,preference:'en'});qa.focus('page')`); await settled('en');
  await scenario('errored-document', () => verifyDocumentState('errored'));
  check('no-runtime-errors-or-external-network', errors.length === 0);
  if (scenarioFailures.length) throw Error(scenarioFailures.join('; '));
} catch (error) {
  failure = error instanceof Error ? error.message.split('\n')[0].slice(0, 220) : 'QA failed';
  if (diagnose) writeFileSync(join(artifacts, 'failure-state.json'), JSON.stringify(await diagnose().catch(() => null), null, 2));
} finally {
  ws?.close();
  if (chrome?.pid) {
    const exited = new Promise<void>(r => { if (chrome!.exitCode !== null) r(); else chrome!.once('exit', () => r()); });
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    if (chrome.exitCode === null) try { process.kill(-chrome.pid, 'SIGKILL'); } catch { chrome.kill('SIGKILL'); }
  }
  await fixture?.stop(); rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  const report = { evidenceClass: 'synthetic SDK host, disposable built backend and Chromium; not native-host proof', passed: !failure, failure, results, operations };
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, assertions: results.length, failure }));
  if (failure) process.exitCode = 1;
}
