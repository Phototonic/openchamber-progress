// Rendered reading-state QA: fresh Chromium, synthetic SDK host, disposable built service.
// node --experimental-strip-types tests/browser/interface-language-reading-qa.ts --artifacts <external-dir> [--chromium <installed-path>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';
import { LANGUAGE_KEY } from './interface-language-fixture.ts';
import { startReadingFixture } from './interface-language-reading-fixture.ts';
import { S } from './fixtures.ts';

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
  diagnose = () => evaluate(`({guest:(()=>{const d=frame('page').contentDocument;return {buttons:[...d.querySelectorAll('button')].slice(0,100).map(n=>({id:n.closest('[data-testid]')?.dataset.testid,text:n.textContent.slice(0,80)})),search:d.querySelector('[data-testid="search-results"]')?.textContent.slice(0,500),documents:[...d.querySelectorAll('[data-testid^="document-"]')].map(n=>({id:n.dataset.testid,text:n.textContent.slice(0,250)}))}})(),requests:qa.requests.slice(-100).map(q=>({surface:q.surface,path:q.path,query:q.query})),responses:qa.responses.slice(-100),faults:qa.faults})`);
  const condition = (code: string) => `(()=>{const w=frame('page').contentWindow,d=w.document;return ${code}})()`;
  const wait = async (code: string, name: string) => { if (!await evaluate(`(async()=>{const end=Date.now()+8000;while(Date.now()<end){try{if(${code})return true}catch{}await new Promise(r=>setTimeout(r,25))}return false})()`)) throw Error('Timed out: ' + name); };
  const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,0))))');
  const key = async (key: string) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: ({ Enter: 13, Escape: 27, Home: 36, ArrowDown: 40 } as Record<string, number>)[key] ?? 0, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }); };
  const click = async (selector: string) => {
    const point = await evaluate<number[]>(`(()=>{const f=frame('page'),n=f.contentDocument.querySelector(${literal(selector)});if(!n)throw Error('Missing QA target');n.scrollIntoView({block:'center'});const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return[a.x+b.x+a.width/2,a.y+b.y+a.height/2]})()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: 'left', clickCount: 1 });
    await frames();
  };
  const focus = async (selector: string) => { await guest(`const n=d.querySelector(${literal(selector)});n.scrollIntoView({block:'center'});n.focus();return true`); await frames(); };
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
  // The board row arrives before the automatically selected detail's continuation.
  await wait(`qa.responses.some(q=>q.surface==='page'&&q.path==='/v1/plan'&&q.query?.plan==='P-history'&&q.query.cursor&&q.status===503)&&${condition(`!!d.querySelector('[data-testid="detail-loading"] button')`)}`, 'initial historical continuation completed');
  await change('initial-explicit-English', 'en', 'en');

  const verifyResultOnlySession = () => scenario('result-only-session', async () => {
    const hellos = await evaluate<number>(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length`);
    await evaluate(`qa.workspace=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[{id:'alpha',name:'Alpha',directory:'/fixture/Alpha'}]}:{kind:q.kind,state:'ready',projectId:q.projectId,worktrees:[],coverage:[{directory:'/fixture/Alpha',state:'ready'}],sessions:q.kind==='sessions'?[{id:${literal(S.M)},title:'Owner A',projectId:'alpha',directory:'/fixture/Alpha',parentId:null,createdAt:1,updatedAt:2,archivedAt:null,worktree:null,activity:'idle',outcome:null,items:[]}]:[]};qa.reload('page')`);
    await wait(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length>${hellos}&&${condition(`!!d.querySelector('[data-testid="plan-row-P-reading"]')`)}`, 'workspace board');
    try {
      await click('[data-testid="board-filters-trigger"]');
      await focus('[data-testid="filter-session"] button'); await key('Enter');
      await wait(condition(`!!d.querySelector(${literal(popup)})`), 'owner session popup');
      await key('Home'); await key('ArrowDown'); await key('Enter');
      await wait(condition(`!!d.querySelector('[data-testid="board-filters-trigger"]')`), 'owner board committed');
      if (await guest(`return d.querySelector('[data-testid="board-filters-trigger"]').getAttribute('aria-expanded')!=='true'`)) await click('[data-testid="board-filters-trigger"]');
      check('result-only-session:literal-prior-owner', await guest(`return d.querySelector('[data-testid="filter-session"] button')?.textContent.includes('Owner A')`));
      await click('[data-testid="board-filters-close"]');
      await focus('#ap-search-q'); await send('Input.insertText', { text: 'Resultonly' }); await key('Enter');
      await wait(condition(`!!d.querySelector('[data-testid$="/P-result"]')&&!d.querySelector('[data-testid="search-loading"]')`), 'result-only owner hit');
      check('result-only-session:A-matches-search-only-B', await evaluate(`qa.requests.filter(q=>q.surface==='page'&&q.path==='/v1/search').at(-1)?.query.session===${literal(S.M)}`));
      await click('[data-testid="board-filters-trigger"]');
      await focus('[data-testid="filter-session"] button'); await key('Enter');
      await wait(condition(`!!d.querySelector(${literal(popup)})`), 'result session popup');
      const options = await guest<string[]>(`return [...d.querySelectorAll(${literal(popup + ' [role="option"]')})].map(n=>n.textContent)`);
      const resultIndex = options.findIndex(text => text.includes('Session …result'));
      check('result-only-session:generated-option-offered', resultIndex >= 0);
      const ownerRequestStart = await evaluate<number>('qa.requests.length');
      await key('Home'); for (let i = 0; i < resultIndex; i++) await key('ArrowDown'); await key('Enter');
      // Changing the session also reloads its board scope; finish that read before measuring language I/O.
      const ownerReply = (path: string) => `qa.responses.findLast(q=>q.request>=${ownerRequestStart}&&q.surface==='page'&&q.path===${literal(path)}&&q.query?.session==='session-result')`;
      await wait(`(()=>{const r=${ownerReply('/v1/plans')};return r?.status===200&&!r.parseError&&r.ids?.includes('P-result')&&r.nextCursor===null})()`, 'result owner board completed successfully');
      const resultRendered = `!!d.querySelector('[data-testid="search-plan-${fixture!.source}/P-result"]')&&!d.querySelector('[data-testid="search-loading"],[data-testid="search-failed"]')`;
      await wait(`(()=>{const r=${ownerReply('/v1/search')};return r?.status===200&&!r.parseError&&r.hits?.some(h=>h.plan==='P-result'&&h.owner==='session-result')})()&&${condition(resultRendered)}`, 'result owner search completed with rendered B hit');
      check('result-only-session:submitted-owner-B', await evaluate(`qa.requests.filter(q=>q.surface==='page'&&q.path==='/v1/search').at(-1)?.query.session==='session-result'`));
      const englishChip = await guest(`return d.querySelector('[data-testid="search-chip-session"]')?.textContent`);
      await change('result-only-session-language', 'ru', 'ru');
      check('result-only-session:chip-never-reuses-owner-A', englishChip?.includes('Session …result') && !englishChip.includes('Owner A'));
      check('result-only-session:Russian-generated-chip', await guest(`const t=d.querySelector('[data-testid="search-chip-session"]')?.textContent;return t?.includes('Сессия …result')&&!t.includes('Owner A')`));
      check('result-only-session:Russian-result-B-retained', await evaluate(condition(resultRendered)));
    } finally {
      await key('Escape');
      await guest(`d.querySelector('[data-testid="search-clear"] button')?.click();return true`);
      const hellos = await evaluate<number>(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length`);
      await evaluate(`delete qa.workspace;qa.reload('page')`);
      await wait(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length>${hellos}&&${condition(`!!d.querySelector('[data-testid="plan-row-P-reading"]')`)}`, 'default board restored');
      await choose('en'); await settled('en');
    }
  });

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
  await focus('[data-testid="map-help-trigger"]'); await key('Enter');
  // An external preference change does not intentionally activate the help's outside-click dismissal.
  await unchanged('map-language', async () => { await evaluate(`qa.seed({v:1,preference:'ru'});qa.focus('page')`); await settled('ru'); }); check('map:selection-pan-zoom-preserved', JSON.stringify(map) === JSON.stringify(await mapState()));
  check('map:disclosure-preserved', await guest(`return d.querySelector('[data-testid="map-group-context"]').open`));
  check('map:help-open-and-translated', await guest(`return d.querySelector('[data-testid="map-help"]').open&&d.querySelector('[data-testid="map-help-trigger"]').textContent==='Справка и определения карты'&&d.querySelector('[data-testid="map-arrow-key"]').textContent.length>0`));
  check('map:selected-details-accessible-and-translated', await guest(`const n=d.querySelector('[data-testid="map-inspector"]');return !n.hidden&&n.dataset.selected==='A'&&d.getElementById(n.getAttribute('aria-labelledby')).textContent.includes('Выбран')&&n.textContent.includes('Export example')`));
  await focus('[data-testid="map-help-trigger"]'); await key('Enter');

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
  await verifyResultOnlySession();
  await scenario('large-map-counts', async () => {
    await openPlan('P-large'); await click(tab('map'));
    await wait(condition(`d.querySelector('[data-testid="map-summary"] [data-kind="working"]')?.dataset.count==='1000'`), '1000-task map summary');
    const count = () => guest(`const n=d.querySelector('[data-testid="map-summary"] [data-kind="working"]');return {raw:n?.dataset.count,text:n?.querySelector('strong')?.textContent}`);
    check('large-map:English-ungrouped', JSON.stringify(await count()) === JSON.stringify({ raw: '1000', text: '1000' }));
    await change('large-map-Russian-language', 'ru', 'ru');
    const russianCount = await count();
    const russianSummaries = await guest(`return {hidden:d.querySelector('[data-testid="map-hidden"]')?.textContent,counts:d.querySelector('[data-testid="map-counts"]')?.textContent}`);
    operations.push({ id: 'large-map:Russian-text', ...russianSummaries });
    await click('[data-testid="map-fit-all"]');
    await wait(condition(`!!d.querySelector('[data-testid="map-announcer"]')?.textContent`), 'map fit announcement');
    const russianAnnouncement = await guest(`return d.querySelector('[data-testid="map-announcer"]')?.textContent.includes('1\u00a0000')`);
    await change('large-map-English-language', 'en', 'en');
    check('large-map:English-restored-ungrouped', JSON.stringify(await count()) === JSON.stringify({ raw: '1000', text: '1000' }));
    check('large-map:Russian-grouped-stat-raw-count-preserved', JSON.stringify(russianCount) === JSON.stringify({ raw: '1000', text: '1\u00a0000' }));
    check('large-map:Russian-heading-and-filter-counts', russianSummaries.hidden === 'Показаны все: 1\u00a0000 задач' && russianSummaries.counts === 'Выполнено: 0 из 1\u00a0000 · Осталось: 1\u00a0000');
    check('large-map:Russian-fit-announcement-grouped', russianAnnouncement);
   });
   await scenario('subagent-loss-language', async () => {
     fixture!.seedSubagents();
     await choose('en'); await settled('en');
     const hellos = await evaluate<number>(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length`);
     await evaluate(`qa.faults=[];qa.workspace=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[{id:'alpha',name:'Alpha',directory:'/fixture/Alpha'}]}:{kind:q.kind,state:'ready',projectId:q.projectId,worktrees:[],coverage:[{directory:'/fixture/Alpha',state:'ready'}],sessions:q.kind==='sessions'?[${JSON.stringify([S.M, S.C1].map((id, i) => ({ id, title: i ? 'Reading helper' : 'Reading owner', projectId: 'alpha', directory: '/fixture/Alpha', parentId: i ? S.M : null, createdAt: 1, updatedAt: 2, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [] }))).slice(1, -1)}]:[]};qa.reload('page')`);
     await wait(`qa.messages.filter(q=>q.surface==='page'&&q.type==='hello').length>${hellos}&&${condition(`!!d.querySelector('[data-testid="plan-row-P-reading"]')`)}`, 'subagent workspace board');
     await openPlan('P-reading'); await click(tab('progress'));
     await wait(condition(`!!d.querySelector('[data-testid="subagent-coverage-cue"]')&&!!d.querySelector('[data-testid="subagent-dismiss-loss"]')`), 'real service recording gap');
     await click('[data-testid="subagent-coverage-cue"]');
     const lossDate = await guest(`return d.querySelector('[data-testid="subagent-loss-date"]').dateTime`);
     await change('subagent-open-notes-language', 'ru', 'ru');
     check('subagent:open-notes-translated-and-date-preserved', await guest(`const b=d.querySelector('[data-testid="subagent-coverage-cue"]'),n=d.getElementById(b.getAttribute('aria-controls'));return b.getAttribute('aria-expanded')==='true'&&!n.hidden&&b.textContent==='Неполный охват субагентов'&&n.textContent.includes('Некоторые сведения о запусках не записаны.')&&d.querySelector('[data-testid="subagent-loss-date"]').dateTime===${literal(lossDate)}`));
     check('subagent:dismiss-accessible-explanation-translated', await guest(`const b=d.querySelector('[data-testid="subagent-dismiss-loss"]');return b.textContent==='Скрыть предупреждение'&&d.getElementById(b.getAttribute('aria-describedby')).textContent.includes('Новые пробелы')`));
     await change('subagent-before-dismiss-English', 'en', 'en');
     await evaluate(`qa.faults.push({kind:'service',surface:'page',path:'/v1/subagent-runs/dismiss-loss',status:503})`);
     const beforeDismiss = await io();
     await click('[data-testid="subagent-dismiss-loss"]');
     await wait(condition(`d.querySelector('[data-testid="subagent-dismiss-status"]')?.dataset.state==='error'&&d.querySelector('[data-testid="subagent-announcer"]')?.textContent==='Couldn’t dismiss the warning. Try again.'`), 'explicit dismissal error');
     const afterDismiss = await io();
     check('subagent:explicit-dismiss-once', (afterDismiss.services['/v1/subagent-runs/dismiss-loss'] ?? 0) === (beforeDismiss.services['/v1/subagent-runs/dismiss-loss'] ?? 0) + 1);
     await change('subagent-retained-dismiss-error-language', 'ru', 'ru');
     check('subagent:retained-visible-dismiss-error-translated', await guest(`return d.querySelector('[data-testid="subagent-dismiss-status"]').textContent==='Не удалось скрыть предупреждение. Попробуйте снова.'&&d.querySelector('[data-testid="subagent-coverage-cue"]').getAttribute('aria-expanded')==='true'`));
     check('subagent:retained-accessible-dismiss-error-translated', await guest(`const n=d.querySelector('[data-testid="subagent-announcer"]');return n.textContent==='Не удалось скрыть предупреждение. Попробуйте снова.'&&n.getAttribute('role')==='status'&&n.getAttribute('aria-live')==='polite'`));
   });
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
