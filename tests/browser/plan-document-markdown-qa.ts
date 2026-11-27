// Run after build:all: CHROMIUM_PATH=<binary> timeout 120s node --experimental-strip-types
// tests/browser/plan-document-markdown-qa.ts <artifact-dir> [baseline-bundle-root]
// Synthetic SDK host + real service/store + fresh Chromium. No native host or live profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureDocument } from '../../plugin/document.ts';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { chromiumPath } from './phone-cdp.ts';
import { startSearchShell } from './plan-task-search-shell.ts';

const sample = '# Sample plan\n\n## Next steps\n\n- [x] Write the draft\n- [ ] Review the draft\n\n**Note:** Review the sample only.\n';
const live = 'Unreported local edit. Do not preview.\n';
const body = '[data-testid="document-text"]';
const marks = `${body} :is(input[type="checkbox"], [role="checkbox"])`;
const link = `${body} a[role="link"]`;
const url = ['https://document.invalid/secure', 'http://document.invalid/plain'];
const extra = `
<aside id="qa-raw-aside">Ordinary embedded HTML.</aside>

![Remote example](https://document.invalid/image.png) ![Relative example](/qa-document-image.png) ![Embedded example](data:image/png;base64,AA==) ![Reference example][image]

[image]: https://document.invalid/reference.png

[Secure example](HTTPS://DOCUMENT.INVALID/secure) [Plain example](${url[1]})

[Relative label](/qa-document-page) [Protocol label](//document.invalid/protocol) [Fragment label](#qa-document) [Mail label](mailto:sample@example.invalid) [Invalid label](https://[invalid)

[Userinfo label](https://document.invalid@other.invalid/)

Reflow${'LongWord'.repeat(38)}
`;
const longText = '\n' + 'A recorded paragraph with enough lines to scroll.\n\n'.repeat(335) + 'Earlier capture end.\n';
const largeReferenceUses = 21_000;
const largeReferenceCapture = `[ref]: https://document.invalid/${'x'.repeat(130 * 1024)}\n\n${'[ref] '.repeat(largeReferenceUses)}\n`;
const output = process.argv[2];
if (!output) throw Error('Pass a disposable artifact directory.');
const binary = chromiumPath();
mkdirSync(output, { recursive: true });
const results: { name: string; pass: boolean; notes?: unknown }[] = [];
const check = (name: string, pass: unknown, notes?: unknown) => results.push({ name, pass: !!pass, notes });

const fx = await startSearchShell(false, false, 'document-markdown', false, false, { guestRoot: process.argv[3] });
const f = fx.fixture!;
let stopBrowser: (() => Promise<void>) | undefined;
let failure: string | undefined;
let diagnose: (() => Promise<unknown>) | undefined;
try {
  const file = (name: string) => join(f.root, `sample-plan.${name}`);
  const oid = (plan: string) => `doc-browser-${plan}-${f.store.get(fx.source, plan)?.revision ?? 0}`;
  async function report(plan: string, name: string, text: string, options: { denied?: boolean; confirm?: boolean } = {}) {
    const source = file(name);
    writeFileSync(source, text);
    const previous = f.store.get(fx.source, plan)!.document;
    const cap = await captureDocument(source, f.root, async () => { if (options.denied) throw Error('Fixture permission denied'); }, previous.path === source ? previous : undefined);
    assert.equal(cap.state, options.denied ? 'denied' : 'captured');
    f.store.apply({ op: 'bind', plan, source, confirm: options.confirm ?? false, rev: f.store.get(fx.source, plan)!.revision, oid: oid(plan) }, { ...f.actor, sessionId: plan }, cap);
  }
  const seed = (id: string) => f.seedPlan(id, `Document fixture ${id}`, [{ id: 'T', title: 'Reported work is independent', kind: 'task', status: 'pending' }], { ...f.actor, sessionId: id });
  for (const id of ['markdown', 'literal-txt', 'literal-unknown', 'missing', 'denied', 'race-page', 'race-panel', 'comparison', 'large-reference']) seed(id);
  await report('markdown', 'MD', sample + extra + longText);
  writeFileSync(file('MD'), live);
  await report('literal-txt', 'txt', sample, { confirm: true });
  await report('literal-unknown', 'unknown', sample);
  await report('missing', 'missing.md', sample);
  await report('denied', 'denied.md', sample);
  await report('denied', 'denied.md', live, { denied: true });
  await report('large-reference', 'large-reference.md', largeReferenceCapture);
  for (const s of ['page', 'panel']) await report(`race-${s}`, `${s}.md`, sample + longText);
  await report('comparison', 'before.md', sample);
  const compareBefore = f.store.get(fx.source, 'comparison')!.document.captureId;
  const newer = '# Later recorded heading\r\n\r\n**New Markdown line.**\r\n';
  await report('comparison', 'after.md', newer);
  const compareAfter = f.store.get(fx.source, 'comparison')!.document.captureId;

  const profile = mkdtempSync('/tmp/opencode/plan-document-markdown-');
  const chrome = spawn(binary, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank'], { stdio: 'ignore', detached: true });
  let ws: WebSocket | undefined;
  let launchFailed = false;
  chrome.once('error', () => { launchFailed = true; });
  stopBrowser = async () => {
    ws?.close();
    if (chrome.pid) {
      try { process.kill(-chrome.pid, 'SIGTERM'); } catch {}
      for (let i = 0; chrome.exitCode === null && chrome.signalCode === null && i < 40; i++) await delay(50);
      try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
    }
    rmSync(profile, { recursive: true, force: true });
  };
  const deadline = Date.now() + 95_000;
  async function until<T>(read: () => T | Promise<T>, label: string): Promise<NonNullable<T>> {
    const end = Math.min(Date.now() + 7500, deadline);
    while (Date.now() < end) {
      const value = await read();
      if (value) return value;
      await delay(35);
    }
    throw Error(`Timed out: ${label}`);
  }
  const portFile = join(profile, 'DevToolsActivePort');
  await until(() => { if (launchFailed) throw Error('Chromium launch failed'); return existsSync(portFile); }, 'DevTools startup');
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3500) })).json() as { type: string; webSocketDebuggerUrl: string }[];
  const socket = ws = new WebSocket(targets.find(t => t.type === 'page')!.webSocketDebuggerUrl);
  await until(() => socket.readyState === WebSocket.OPEN, 'DevTools connection');
  let next = 0;
  const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const id = ++next;
    const onReply = (event: MessageEvent) => {
      const m = JSON.parse(String(event.data));
      if (m.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onReply);
      if (m.error) reject(Error(`${method}: ${m.error.message}`));
      else resolve(m.result);
    };
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onReply);
      reject(Error(`DevTools timeout: ${method}`));
    }, 4500);
    socket.addEventListener('message', onReply);
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      socket.removeEventListener('message', onReply);
      reject(error);
    }
  });
  const origin = `http://127.0.0.1:${fx.port}`;
  const shellPaths = new Set(['/', '/service', '/favicon.ico', ...['page', 'panel'].flatMap(s => [`/ui/${s}/index.html`, `/ui/${s}/main.js`])]);
  let unexpectedRequests = 0, navigations = 0, runtimeErrors = 0;
  const allowed = (value: string) => { const u = new URL(value); return u.origin === origin && shellPaths.has(u.pathname); };
  socket.onmessage = e => {
    const m = JSON.parse(String(e.data));
    if (m.id) return;
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const permitted = allowed(request.url);
      if (!permitted) unexpectedRequests++;
      void send(permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(permitted ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => runtimeErrors++);
    } else if (m.method === 'Network.requestWillBeSent' && !allowed(m.params.request.url)) unexpectedRequests++;
    else if (['Page.frameNavigated', 'Page.navigatedWithinDocument', 'Page.windowOpen'].includes(m.method)) navigations++;
    else if (m.method === 'Runtime.exceptionThrown') runtimeErrors++;
  };
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error('Browser evaluation failed');
    return r.result.value;
  };
  let surface: 'page' | 'panel' = 'page';
  const guest = <T = any>(code: string) => evaluate<T>(`(()=>{const f=window.frame?.(${js(surface)}),w=f?.contentWindow,d=f?.contentDocument,n=d?.querySelector(${js(body)});${code}})()`);
  const wait = (condition: string, label: string) => until(() => guest(`return !!d && (${condition})`), `${surface}: ${label}`);
  const has = (selector: string) => `d.querySelector(${js(selector)})`;
  diagnose = () => guest(`return {buttons:[...d.querySelectorAll('button')].slice(0,24).map(el=>({id:el.dataset.testid,text:el.textContent.trim().slice(0,80)})),calls:qa.requests.slice(-12).map(q=>[q.frame,q.path])}`);
  const click = async (selector: string, index = 0) => {
    const xy = await until(() => guest<[number, number] | null>(`const el=d?.querySelectorAll(${js(selector)})[${index}];if(!el?.getClientRects().length)return null;
      f.scrollIntoView({block:'start',behavior:'instant'});el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const a=el.getBoundingClientRect(),b=f.getBoundingClientRect(),x=a.x+a.width/2,y=a.y+a.height/2;
      return y+b.y>=0&&y+b.y<innerHeight&&el.contains(d.elementFromPoint(x,y))?[x+b.x,y+b.y]:null;`), `${surface}: pointer target ${selector}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
  };
  const key = async (k: 'Tab' | 'Enter' | 'PageDown' | 'Escape') => {
    const codes = { Tab: 9, Enter: 13, PageDown: 34, Escape: 27 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: codes[k], ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}) });
  };
  const focus = (selector: string) => guest(`const el=${has(selector)};el.focus();return el===d.activeElement`);
  const doc = (id: string) => `[data-testid="document-${id}"]`;
  const opened = () => evaluate<{ frame: string; url: string }[]>('qa.opened');
  const reads = (id: string) => evaluate<number>(`qa.requests.filter(q=>q.frame===${js(surface)}&&q.path==='/v1/document'&&q.query?.plan===${js(id)}).length`);
  const shot = async (name: string, selector: string) => {
    await guest(`${has(selector)}.scrollIntoView({block:'start'});n.scrollTop=0;return true`);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(output, `${name}.png`), Buffer.from(png.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Fetch.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1060, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: origin });
  await until(() => evaluate(`window.frame?.('page')?.contentDocument?.readyState==='complete' && window.frame?.('panel')?.contentDocument?.readyState==='complete' && frame('panel').contentWindow.location.pathname==='/ui/panel/index.html'`), 'fixture frames');
  await evaluate(`for(const f of document.querySelectorAll('iframe')) f.style.height='970px'`);
  const initialNavigations = navigations;
  const documentButton = '[data-testid="plan-view-document"] button';
  async function open(id: string) {
    if (surface === 'page') {
      const row = `[data-testid="plan-row-${id}"]`;
      await click(row);
    } else {
      await evaluate(`qa.context(${js(id)})`);
      await wait(`${has('[data-testid="plan-title"]')}?.textContent?.includes(${js(`Document fixture ${id}`)})`, `${id} rail selected`);
    }
    await wait(`!!${has(documentButton)}`, `${id} plan view`);
    assert(await focus(documentButton)); await key('Enter');
    await wait(`!!${has(doc(id))}`, `${id} document opened`);
  }
  const leave = async () => {
    assert(await focus('[data-testid="surface-panel-back"] button'));
    await key('Enter');
    await wait(`!!${has(documentButton)}`, 'Back returns to the plan view');
  };
  const semantic = () => guest<string[]>(`return [...n.querySelectorAll('h1,h2,strong')].map(el=>el.tagName+':'+el.textContent)`);
  const markState = () => guest<{ checked: boolean; inert: boolean }[]>(`return [...d.querySelectorAll(${js(marks)})].map(el=>({checked:el.checked??(el.getAttribute('aria-checked')==='true'),inert:el.tagName==='INPUT'?el.disabled:el.tabIndex<0}))`);
  const snapshot = () => ({
    plan: f.store.get(fx.source, 'markdown'),
    captures: f.store.db.prepare('SELECT id, plan, hash, text, captured_at FROM captures ORDER BY id').all(),
    file: readFileSync(file('MD'), 'utf8'),
  });
  const before = snapshot();
  const signatures: string[][] = [];

  for (const s of ['page', 'panel'] as const) {
    surface = s;
    const opensBeforeRender = (await opened()).length;
    const claim = (label: string, pass: unknown, notes?: unknown) => check(`${s}: ${label}`, pass, notes);
    // Model older WebViews that support the URL constructor but not URL.parse.
    assert.equal(await guest(`delete w.URL.parse;return typeof w.URL.parse`), 'undefined');
    await evaluate(`qa.show([${js(s)}],${s === 'page' ? 1000 : 440});qa.theme('light');qa.noDocumentText='missing'`);
    claim('lazy document read', await reads('markdown') === 0);
    await evaluate(`qa.holds.push({path:'/v1/document',frame:${js(s)},plan:'markdown',tag:'loading'})`);
    // Hold one real response to observe loading; the missing-body case below exercises retry.
    await open('markdown');
    claim('activation focuses the document heading', await guest(`return d.activeElement===${has('[data-testid="surface-panel-heading"]')}`));
    await wait(`qa.held.some(x=>x.tag==='loading')`, 'held document request');
    claim('loading status, no body', await guest(`return !n&&${has('[data-testid="document-loading"][role="status"] [aria-label="Loading the document"]')}!==null`));
    await evaluate(`qa.release('loading')`);
    await wait('!!n', 'ready recorded Markdown');
    const headings = await semantic();
    signatures.push(headings);
    const formatted = JSON.stringify(headings) === JSON.stringify(['H1:Sample plan', 'H2:Next steps', 'STRONG:Note:']);
    claim('uppercase .MD has formatted headings and emphasis', formatted, headings);
    claim('preview is recorded, not the edited bound file', await guest(`return n.textContent.includes('Review the sample only.')&&!n.textContent.includes(${js(live.trim())})&&${has(doc('markdown'))}.textContent.includes('The current file has not been rechecked since this capture.')`));
    claim('body remains focusable and scroll-keyed', await guest(`return n.tabIndex===0&&n.dataset.scrollKey?.startsWith('doc-')`));
    if (formatted) {
      const states = await markState();
      const markerOk = JSON.stringify(states) === '[{"checked":true,"inert":true},{"checked":false,"inert":true}]';
      claim('checked and unchecked inert list marks', markerOk && await guest(`return [...d.querySelectorAll(${js(marks)})].every(el=>el.closest('li'))`), states);
      claim('no activation during render', (await opened()).length === opensBeforeRender && unexpectedRequests === 0 && navigations === initialNavigations);
      claim('benign HTML is inert; four images are alt text only', await guest(`return !n.querySelector('aside,#qa-raw-aside,img,svg,picture,[src],[srcset]')&&['Remote example','Relative example','Embedded example','Reference example'].every(t=>n.textContent.includes(t))`));
      const links = await guest<string[]>(`return [...n.querySelectorAll('a,[role="link"],button,[href]')].filter(el=>el.matches('a[role="link"][tabindex="0"]:not([href])')).map(el=>el.textContent)`);
      claim('only the approved link labels are actionable', JSON.stringify(links) === '["Secure example","Plain example"]' && await guest(`return n.querySelectorAll('a,[role="link"],button,[href],[tabindex="0"]').length===2&&['Relative label','Protocol label','Fragment label','Mail label','Invalid label','Userinfo label'].every(t=>n.textContent.includes(t))`), links);
      claim('link titles expose normalized destinations', JSON.stringify(await guest(`return [...n.querySelectorAll(${js(link)})].map(el=>el.title)`)) === JSON.stringify(url));
      if (markerOk) {
        for (let i = 0; i < 2; i++) await click(marks, i);
        // They must not acquire focus, nor take a Tab stop between the body and its first link.
        claim('marks reject focus', !await focus(marks));
        await focus(body); await key('Tab');
        claim('pointer attempts and keyboard leave both mark states unchanged', JSON.stringify(await markState()) === JSON.stringify(states));
      }
      if (links.length === 2) {
        const count = (await opened()).length;
        await click(link);
        await until(async () => (await opened()).length > count, `${s} pointer SDK activation`);
        await focus(body); await key('Tab');
        claim('Tab enters document links without stopping on checklist marks', await guest(`return d.activeElement===${has(link)}`));
        await key('Tab'); await key('Enter');
        await until(async () => (await opened()).length > count + 1, `${s} keyboard SDK activation`);
        claim('explicit click and Enter send only intercepted SDK URLs', JSON.stringify((await opened()).slice(count)) === JSON.stringify(url.map(u => ({ frame: s, url: u }))));
      }
      for (const [width, label] of [[360, 'narrow'], [s === 'page' ? 1000 : 440, 'wide']] as const) {
        for (const theme of ['light', 'dark'] as const) {
          await evaluate(`qa.show([${js(s)}],${width});qa.theme(${js(theme)})`);
          const box = await guest<{ fits: boolean; background: string; minimum: number }>(`const rgb=c=>(c.match(/[0-9.]+/g)||[]).map(Number);
            const background=el=>{for(;el;el=el.parentElement){const c=rgb(w.getComputedStyle(el).backgroundColor);if(c.length===3||c[3]===1)return c}return []};
            const luminance=c=>c.slice(0,3).reduce((sum,v,i)=>{v/=255;return sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i]},0);
            const ratios=[n,...n.querySelectorAll('h1,h2,strong,a')].map(el=>{const a=luminance(rgb(w.getComputedStyle(el).color)),b=luminance(background(el));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
            return {fits:n.scrollWidth<=n.clientWidth+1&&d.documentElement.scrollWidth<=w.innerWidth+1,background:background(n).join(','),minimum:Math.min(...ratios)};`);
          claim(`${label} ${theme} reflows and text has 4.5:1 contrast`, box.fits && box.minimum >= 4.5 && (theme === 'dark' ? Number(box.background.split(',')[0]) < 100 : Number(box.background.split(',')[0]) > 190), box);
          await shot(`${s}-${label}-${theme}`, doc('markdown'));
        }
      }
      if (s === 'page') {
        for (const width of [1180, 390]) {
          await send('Emulation.setDeviceMetricsOverride', { width, height: 1060, deviceScaleFactor: 1, mobile: false });
          await evaluate(`qa.show(['page'],${width});frame('page').closest('section').style.margin='0';qa.theme('light');qa.rejectDocumentLink=true`);
          assert.equal(await guest(`return w.innerWidth`), width);
          await shot(`page-${width}-document`, doc('markdown'));
          const expected: { frame: string; kind: 'error'; message: string } = { frame: s, kind: 'error', message: 'Could not open this link.' };
          const count = await evaluate<number>('qa.toasts.length');
          await click(link);
          const toast = await until(() => evaluate<typeof expected | null>(`qa.toasts[${count}]??null`), 'host open failure toast');
          assert.deepEqual(toast, expected);
          claim(`host rejection shows an error toast at ${width}px`, await evaluate(`document.querySelector('[data-qa-toast]')?.textContent===${js(expected.message)}`));
          await shot(`page-${width}-link-failure`, doc('markdown'));
          await evaluate(`document.querySelector('[data-qa-toast]').remove();qa.rejectDocumentLink=false`);
        }
        await evaluate(`frame('page').closest('section').style.margin=''`);
        await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1060, deviceScaleFactor: 1, mobile: false });
      }
    }
    assert(await focus(body));
    await guest(`n.scrollTop=0;return true`);
    await key('PageDown');
    await wait('n?.scrollTop>0', 'keyboard scroll moves document body');
    claim('keyboard reads long body by scrolling its own region', await guest(`return d.activeElement===n&&n.scrollHeight>n.clientHeight`));
    await leave();
    claim('Back restores focus to the document button', await guest(`return d.activeElement===${has(documentButton)}`));
    await evaluate(`qa.show([${js(s)}],280)`);
    await click('[data-testid="plan-view-map"] button');
    await wait(`${has('[data-testid="plan-view-map"] button')}?.getAttribute('aria-pressed')==='true'`, 'Map selected');
    claim('Map, List and Document fit in one control group at 280px', await guest(`const group=${has('[data-testid="plan-view"]')};return [...group.children].map(x=>x.dataset.testid).join() === 'plan-view-map,plan-view-list,plan-view-document'&&group.scrollWidth<=group.clientWidth+1&&d.documentElement.scrollWidth<=w.innerWidth+1`));
    await click('[data-testid="more-trigger"]');
    claim('More no longer duplicates the document action', await guest(`return !!${has('[data-testid="more-popup"]')}&&!${has('[data-menu-id="document"]')}`));
    await key('Escape');
    assert(await focus(documentButton)); await key('Enter');
    await wait(`d.activeElement===${has('[data-testid="surface-panel-heading"]')}`, 'keyboard opens the document');
    await key('Escape');
    await wait(`${has('[data-testid="plan-view-map"] button')}?.getAttribute('aria-pressed')==='true'`, 'Escape restores Map');
    claim('Escape preserves Map and focuses the document button', await guest(`return d.activeElement===${has(documentButton)}`));
    await click('[data-testid="plan-view-list"] button');
    await evaluate(`qa.show([${js(s)}],${s === 'page' ? 1000 : 440})`);
    for (const id of ['literal-txt', 'literal-unknown']) {
      await open(id); await wait('!!n', `${id} literal body`);
      claim(`${id} retains byte-identical literal markup`, await guest(`return n.tagName==='PRE'&&n.textContent===${js(sample)}`));
      if (id === 'literal-txt') claim('confirmed capture keeps checklist synchronization qualification', await guest(`return ${has(doc(id))}.textContent.includes('The task list was confirmed against this capture. The current file has not been rechecked since.')`));
      await leave();
    }
    await evaluate(`qa.fail.push({frame:${js(s)},path:'/v1/document',once:true})`);
    await open('missing');
    const retry = '[data-testid="document-loading"] button';
    await wait(`!!${has(retry)}`, 'document retry shown');
    claim('failure wording, no fabricated preview', await guest(`return !n&&${has('[data-testid="document-loading"]')}.textContent.includes('The document could not be loaded.')&&${has(retry)}.textContent==='Try again'`));
    await click(retry);
    await wait(`${has(doc('missing'))}.textContent.includes('The captured text is not available.')`, 'successful retry with unavailable body');
    claim('retry re-reads; unavailable text has no preview', await reads('missing') === 2 && await guest('return !n'));
    await leave();
    await open('denied'); await wait('!!n', 'retained capture after denied file check');
    claim('last-good capture kept with failed-check and source qualifications', await guest(`return n.textContent.includes('Review the sample only.')&&!n.textContent.includes(${js(live.trim())})&&${has('[data-testid="document-state"]')}?.textContent.includes('not allowed to read')&&${has(doc('denied'))}.textContent.includes('This is the last successful capture, not the current file.')`));
    await leave();
  }
  check('both surfaces render the same formatted semantics', signatures.length === 2 && signatures[0].length > 0 && JSON.stringify(signatures[0]) === JSON.stringify(signatures[1]));
  check('viewing and attempt to toggle made no progress write', await evaluate(`qa.requests.every(q=>q.method==='GET')`));
  check('viewing and attempt to toggle kept file, captures and reported tasks unchanged', JSON.stringify(before) === JSON.stringify(snapshot()));

  surface = 'page';
  await evaluate(`qa.show(['page'],1000)`);
  const started = performance.now();
  await open('large-reference');
  await wait('!!n', 'near-limit capture with repeated reference');
  const elapsed = Math.round(performance.now() - started);
  check('near-limit capture with repeated oversized destination stays responsive',
    elapsed < 2500 && await guest(`return !n.querySelector('a,[role="link"]')&&n.textContent.trim()===${js('ref ')}.repeat(${largeReferenceUses}).trim()`), { elapsed });
  await leave();

  for (const s of ['page', 'panel'] as const) {
    surface = s;
    const id = `race-${s}`;
    const oldId = f.store.get(fx.source, id)!.document.captureId;
    await evaluate(`qa.show([${js(s)}],${s === 'page' ? 1000 : 440});qa.theme('light');
      qa.holds.push({frame:${js(s)},path:'/v1/document',plan:${js(id)},cursor:false,tag:'race'})`);
    await open(id);
    // The service snapshots page one before this report; the guest has not received it yet.
    await wait(`qa.replies.some(q=>q.frame===${js(s)}&&q.path==='/v1/document'&&q.query?.plan===${js(id)})`, 'real first page reply held');
    await report(id, `${s}-updated.txt`, newer);
    const newId = f.store.get(fx.source, id)!.document.captureId;
    assert.notEqual(newId, oldId);
    await evaluate(`qa.release('race')`);
    await wait(`!!${has('[data-testid="document-historical"]')}`, 'historical capture note');
    check(`${s}: older pinned capture shown with warning, no newer bytes`, await guest(`return n.textContent.includes('Earlier capture end.')&&!n.textContent.includes('Later recorded heading')&&${has('[data-testid="document-historical"]')}.textContent.includes('This is the earlier capture.')`));
    check(`${s}: earlier Markdown remains formatted after binding changes to .txt`, await guest(`return n.querySelector('h1')?.textContent==='Sample plan'`));
    await leave();
  }
  surface = 'page';
  await evaluate(`qa.show(['page'],1000)`);
  await open('comparison'); await wait('!!n', 'comparison fixture body');
  const compare = '[data-testid="capture-toggle"] button';
  await wait(`!!${has(compare)}`, 'comparison control');
  assert(await focus(compare)); await key('Enter');
  await wait(`!!${has('[data-testid="capture-diff"]')}`, 'recorded capture comparison');
  check('comparison keeps literal Markdown and metadata', await guest(`const diff=${has('[data-testid="capture-diff"]')},meta=${has('[data-testid="capture-comparison"]')};return !diff.querySelector('h1,strong')&&diff.textContent.includes('# Later recorded heading')&&diff.textContent.includes('**New Markdown line.**')&&meta.textContent.includes('CRLF')&&meta.textContent.includes('sample-plan.after.md')&&meta.textContent.includes('#${compareBefore}')&&meta.textContent.includes('#${compareAfter}')&&meta.textContent.includes('Historical capture: checklist synchronization is unknown.')&&meta.textContent.includes('This comparison does not establish approval, completion, or the live file’s current contents.')`));
  check('no document-originated network requests or navigation', unexpectedRequests === 0 && navigations === initialNavigations, { unexpectedRequests, extraNavigations: navigations - initialNavigations });
  check('no browser or fixture errors', runtimeErrors === 0 && await evaluate('qa.errors.length===0'), { runtimeErrors });
} catch (error) {
  failure = error instanceof Error ? error.message : 'Unexpected fixture failure';
  if (diagnose) writeFileSync(join(output, 'failure-state.json'), JSON.stringify(await diagnose().catch(() => null), null, 2) + '\n');
} finally {
  await stopBrowser?.();
  await fx.stop();
  const summary = { scope: 'Synthetic SDK shell, disposable Chromium and real disposable capture store', checks: results, failure };
  writeFileSync(join(output, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).map(r => r.name), failure }));
  if (failure || results.some(r => !r.pass)) process.exitCode = 1;
}
