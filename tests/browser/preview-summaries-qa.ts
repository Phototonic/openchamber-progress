// Current-bundle preview/copy QA in an isolated Chromium (Q4). It starts its own loopback synthetic
// SDK shell over the real built service (preview-summaries-fixture.ts) and a headless Chromium with
// a fresh disposable profile, drives real CDP pointer/keyboard input, and stops only what it
// started. Never attaches to an existing browser or uses a real profile. Synthetic SDK-shell
// coverage only: not native-host, relay or native-Windows certification.
// Usage: node --experimental-strip-types tests/browser/preview-summaries-qa.ts --artifacts <dir> [--chromium <path>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PLANS, startPreviewFixture, type Fault } from './preview-summaries-fixture.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: preview-summaries-qa.ts --artifacts <dir> [--chromium <path>]');
mkdirSync(artifacts, { recursive: true });

function findChromium() {
  const explicit = arg('--chromium') ?? process.env.CHROMIUM_PATH;
  if (explicit) return explicit;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const b of builds) { const p = join(cache, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p; }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p;
  throw new Error('No installed Chromium found; pass --chromium (this driver never downloads one).');
}

type Result = { id: string; pass: boolean; facts?: string[] };
const results: Result[] = [];
const shots: string[] = [];
function check(id: string, pass: boolean, facts?: string[], diagnostic?: unknown) {
  results.push({ id, pass, ...(facts ? { facts } : {}) });
  if (!pass) throw new Error(`${id} failed${diagnostic === undefined ? '' : `: ${JSON.stringify(diagnostic)}`}`);
}

type Cdp = { send: (method: string, params?: object) => Promise<any>; close: () => void; events: { method: string; params: any }[] };
async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('CDP connect failed')); });
  let next = 1;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const events: Cdp['events'] = [];
  ws.onmessage = (event) => {
    const m = JSON.parse(String(event.data));
    const w = m.id && waiting.get(m.id);
    if (w) { waiting.delete(m.id); if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')) events.push({ method: m.method, params: m.params });
  };
  return {
    events,
    send: (method, params = {}) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }),
    close: () => ws.close(),
  };
}

mkdirSync('/tmp/opencode', { recursive: true });
const profile = mkdtempSync('/tmp/opencode/preview-summaries-qa-');
const fx = await startPreviewFixture();
const origin = `http://127.0.0.1:${fx.port}`;
const chrome = spawn(findChromium(), ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true });
let page: Cdp | null = null, browser: Cdp | null = null;
let failure: string | null = null;
const facts: Record<string, unknown> = {};
try {
  let devtools = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0];
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
  const version = await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json() as { webSocketDebuggerUrl: string };
  browser = await connect(version.webSocketDebuggerUrl);
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  page = await connect(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  const c = page, b = browser;
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // Test-granted clipboard access for this disposable origin only.
  const grant = () => b.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await grant();
  await c.send('Page.navigate', { url: `${origin}/` });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  /** Run `code` with `w`/`d` = the guest window/document of surface `s`. */
  const guest = <T = any>(s: string, code: string) => evaluate<T>(`(()=>{const w=frame('${s}').contentWindow,d=w.document;${code}})()`);
  /** Bounded named-state wait: polls a condition, never a fixed sleep. */
  const wait = async (s: string, cond: string, what = cond, ms = 12_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=Date.now()+${ms};while(Date.now()<end){try{const w=frame('${s}').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>setTimeout(r,40));}return false})()`);
    if (!ok) throw new Error(`timed out waiting (${s}): ${what}`);
  };
  const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const key = async (k: string, times = 1, modifiers = 0) => {
    const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, ArrowDown: 40, Home: 36, a: 65 };
    const code = k === ' ' ? 'Space' : k === 'a' ? 'KeyA' : k;
    for (let i = 0; i < times; i++) {
      const text = modifiers ? {} : k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: codes[k] ?? 0, ...text, ...(k === 'a' && modifiers === 2 ? { commands: ['selectAll'] } : {}) });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: codes[k] ?? 0 });
    }
  };
  const click = async (s: string, selector: string) => {
    const point = await evaluate<[number, number] | null>(`(()=>{const f=frame('${s}'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=f.getBoundingClientRect();return [o.x+r.x+Math.min(16,r.width/2),o.y+r.y+Math.min(12,r.height/2)]})()`);
    if (!point) throw new Error(`missing ${selector} in ${s}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: 'left', clickCount: 1 });
  };
  const show = async (s: string, width: number) => { await evaluate(`qa.show('${s}',${width});true`); await wait(s, `w.innerWidth===${width}`, `${s} width ${width}`); };
  const theme = async (mode: 'light' | 'dark') => { await evaluate(`qa.theme('${mode}');true`); await frames(); };
  const context = (id: string | null) => evaluate(`qa.context(${JSON.stringify(id)});true`);
  const scope = (s: string) => (s === 'page' ? '[data-testid="plan-detail"] ' : 'article.ap-plan ');
  const hook = (s: string, id: string) => `${scope(s)}[data-testid="${id}"]`;
  const has = (s: string, id: string) => `!!d.querySelector('${hook(s, id)}')`;
  const text = (s: string) => guest<string | null>(s, `return d.querySelector('${hook(s, 'summary-text')}')?.value??null`);
  const status = (s: string) => guest<string>(s, `return d.querySelector('${hook(s, 'summary-preview')}')?.textContent??''`);
  const copyEnabled = (s: string) => `d.querySelector('${hook(s, 'summary-copy')}')?.disabled===false`;
  const showsText = (s: string, value: string) => `d.querySelector('${hook(s, 'summary-text')}')?.value===${JSON.stringify(value)}&&${copyEnabled(s)}`;
  const loading = (s: string) => `${has(s, 'summary-preview')}&&!${has(s, 'summary-text')}&&d.querySelector('${hook(s, 'summary-copy')}')?.disabled===true&&d.querySelector('${hook(s, 'summary-preview')}').textContent.includes('Loading complete plan')`;
  const announced = (s: string, words: string) => `(()=>{const n=d.querySelector('${hook(s, 'summary-status')}');return !!n&&n.getAttribute('role')==='status'&&n.getAttribute('aria-live')==='polite'&&n.textContent===${JSON.stringify(words)}})()`;
  const clipboard = () => evaluate<string>('navigator.clipboard.readText()');
  const setClipboard = (value: string) => evaluate(`navigator.clipboard.writeText(${JSON.stringify(value)}).then(()=>true)`);
  const SENTINEL = 'synthetic clipboard sentinel';
  /** Side effects a preview/copy action must never cause. Fixture setup is counted separately. */
  const effects = () => evaluate<{ document: number; history: number; mutations: number; navigation: number }>(`({document:qa.requests.filter(q=>q.path==='/v1/document').length,history:qa.requests.filter(q=>q.path==='/v1/history').length,mutations:qa.requests.filter(q=>q.method!=='GET').length,navigation:qa.messages.filter(m=>m.type==='open-session').length})`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  async function quiet<T>(id: string, run: () => Promise<T>) {
    const before = await effects();
    const out = await run();
    const after = await effects();
    check(`${id}:no-document-history-mutation-navigation`, same(before, after), ['Preview/copy caused no document or history read, service mutation or session navigation'], { before, after });
    return out;
  }
  const noOverflow = (s: string) => guest<boolean>(s, `const cw=d.documentElement.clientWidth;if(d.documentElement.scrollWidth>cw)return false;const t=d.querySelector('${hook(s, 'summary-text')}');if(t&&t.scrollWidth>t.clientWidth+1)return false;return [...d.querySelectorAll('${scope(s)}.ap-summary button,${scope(s)}.ap-summary textarea')].every(n=>{const r=n.getBoundingClientRect();return r.left>=-0.5&&r.right<=cw+0.5})`);
  const shot = async (s: string, name: string, scrollTo: string) => {
    check(`${name}:no-horizontal-overflow`, await noOverflow(s));
    await guest(s, `d.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView({block:'start'});return true`);
    await frames();
    const r = await evaluate<number[]>(`(()=>{const r=document.querySelector('section[data-surface="${s}"]').getBoundingClientRect();return [Math.max(0,r.x-8),Math.max(0,r.y-8),r.width+16,Math.min(r.height+16,innerHeight)]})()`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  /** Bounded wait until no forwarded service request is still awaiting its reply. */
  const flightDone = async () => { if (!(await evaluate<boolean>(`new Promise(r=>{const end=Date.now()+5000;const t=()=>qa.flight===0?r(true):Date.now()>end?r(false):setTimeout(t,40);t()})`))) throw new Error('service requests did not quiesce'); };
  const row = (id: string) => `[data-testid="plan-row-${id}"][data-source="source-fixture"]`;
  const selectBoard = async (id: string) => { await click('page', row(id)); await wait('page', `d.querySelector('[data-testid="plan-detail"] [data-testid="plan-${id}"]')&&${has('page', 'summary-progress')}`, `board selects ${id}`); };

  /** Open a preview with a real click, assert exact formatter text and copy it with a real click. */
  async function openAndCopy(s: string, mode: 'progress' | 'handoff', plan: string, label: string) {
    const expected = (await fx.expected(plan, mode))!;
    await setClipboard(SENTINEL);
    await quiet(`${label}:${mode}`, async () => {
      await click(s, hook(s, `summary-${mode}`));
      await wait(s, showsText(s, expected), `${mode} preview text`);
      check(`${label}:${mode}:preview-equals-formatter`, (await text(s)) === expected, ['Preview value equals formatter output over an actual authenticated service read']);
      check(`${label}:${mode}:opening-does-not-copy`, (await clipboard()) === SENTINEL);
      await click(s, hook(s, 'summary-copy'));
      await wait(s, announced(s, 'Markdown copied.'), 'copy success announced');
      check(`${label}:${mode}:clipboard-exact`, (await clipboard()) === expected, ['Clipboard read back equals the displayed preview exactly']);
      await wait(s, `d.activeElement?.dataset?.testid==='summary-copy'`, 'focus on Copy after pointer copy', 5000).catch(() => {});
      check(`${label}:${mode}:copy-focus-after-pointer`, await guest<boolean>(s, `return d.activeElement?.dataset?.testid==='summary-copy'`));
    });
    return expected;
  }

  await evaluate(`new Promise(r=>{const t=()=>window.qa&&frame('page').contentDocument?.querySelector('[data-testid="progress-root"]')?r(true):setTimeout(t,50);t()})`);

  // ------------------------------------------------ Step 1a: rail, light, 360px
  await show('panel', 360);
  await context(PLANS.summary.session);
  await wait('panel', `d.querySelector('article.ap-plan[data-testid="plan-P-summary"]')&&${has('panel', 'summary-progress')}`, 'rail shows F1');
  const progress = await openAndCopy('panel', 'progress', 'P-summary', 'S1:rail');
  check('S1:rail:progress-fields', progress.includes('Progress: 5/9 done; 4 remaining; 1 skipped') && !progress.includes('Origin session:') && !progress.includes('## Not started'), ['Server counts; progress omits handoff sections']);
  await shot('panel', 'progress-rail-light', 'article.ap-plan');
  const handoff = await openAndCopy('panel', 'handoff', 'P-summary', 'S1:rail');
  check('S1:rail:handoff-fields', handoff.includes('Recorded reports: 5 direct; 2 parent-relay') && handoff.includes('Coverage: full (revision 7)') && handoff.includes('Review rollout checklist\n\n## Freshness'), ['5 direct / 2 parent-relay', 'Labelled suggestion is Review rollout checklist']);

  // ------------------------------------------------ Step 2: denied/rejecting/absent clipboard
  await quiet('S2:fallback', async () => {
    const failed = 'Clipboard unavailable. Select and copy the preview text below.';
    await setClipboard(SENTINEL);
    await b.send('Browser.resetPermissions', {});
    await b.send('Browser.setPermission', { origin, permission: { name: 'clipboard-write' }, setting: 'denied' });
    await b.send('Browser.setPermission', { origin, permission: { name: 'clipboard-read' }, setting: 'granted' });
    await click('panel', hook('panel', 'summary-copy'));
    await wait('panel', `d.querySelector('${hook('panel', 'summary-status')}').textContent!=='Copying…'&&${copyEnabled('panel')}&&d.querySelector('${hook('panel', 'summary-status')}').textContent!==''`, 'denied copy settles');
    const denied = await guest<string>('panel', `return d.querySelector('${hook('panel', 'summary-status')}').textContent`);
    await grant();
    const deniedClip = await clipboard();
    facts.permissionDenied = denied === failed && deniedClip === SENTINEL ? 'failure-reported' : denied;
    check('S2:permission-denied-not-success', denied === failed && deniedClip === SENTINEL, ['Denied browser permission reports failure, clipboard unchanged']);
    // Test-only API seams inside the guest window (never in a shipped bundle).
    await guest('panel', `const cb=w.navigator.clipboard;Object.defineProperty(cb,'writeText',{configurable:true,value:()=>Promise.reject(new w.DOMException('synthetic','NotAllowedError'))});return true`);
    await click('panel', hook('panel', 'summary-copy'));
    await wait('panel', announced('panel', failed), 'rejecting API reports failure');
    check('S2:rejecting-api-not-success', (await clipboard()) === SENTINEL);
    await wait('panel', `d.activeElement?.dataset?.testid==='summary-copy'`, 'focus on Copy after failed copy', 5000).catch(() => {});
    check('S2:copy-focus-after-failure', await guest<boolean>('panel', `return d.activeElement?.dataset?.testid==='summary-copy'`), ['Focus returns to Copy after a failed write']);
    await guest('panel', `delete w.navigator.clipboard.writeText;Object.defineProperty(w.navigator,'clipboard',{configurable:true,get:()=>undefined});return true`);
    // A distinct preview generation so the absent-API status is a new announcement.
    await click('panel', hook('panel', 'summary-handoff'));
    await wait('panel', showsText('panel', handoff));
    await click('panel', hook('panel', 'summary-copy'));
    await wait('panel', announced('panel', failed), 'absent API reports failure');
    check('S2:absent-api-not-success', (await clipboard()) === SENTINEL, ['Absent and rejecting clipboard APIs report failure, never success']);
    await click('panel', hook('panel', 'summary-text'));
    await key('a', 1, 2);
    const selected = await guest('panel', `const t=d.querySelector('${hook('panel', 'summary-text')}');return {focused:d.activeElement===t,all:t.selectionStart===0&&t.selectionEnd===t.value.length,equal:t.value.slice(t.selectionStart,t.selectionEnd)===${JSON.stringify(handoff)},readOnly:t.readOnly}`);
    check('S2:keyboard-select-all-equals-preview', selected.focused && selected.all && selected.equal && selected.readOnly, ['Ctrl+A in the read-only textarea selects the full preview value'], selected);
    await shot('panel', 'clipboard-fallback', 'article.ap-plan .ap-summary');
    await guest('panel', `delete w.navigator.clipboard;return !!w.navigator.clipboard?.writeText`);
  });

  // ------------------------------------------------ Work Status exposes no preview controls
  await show('status', 360);
  await wait('status', `d.querySelector('[data-testid="counts"]')`, 'status counts');
  check('S3:work-status-no-preview', await guest<boolean>('status', `return !d.querySelector('[data-testid^="summary-"]')&&!d.querySelector('.ap-summary')`), ['Work Status renders no summary actions or preview']);

  // ------------------------------------------------ Step 3: 280px dark rail, keyboard only
  await show('panel', 360);
  if (await guest<boolean>('panel', `return ${has('panel', 'summary-close')}`)) { await click('panel', hook('panel', 'summary-close')); await wait('panel', `!${has('panel', 'summary-preview')}`); }
  await theme('dark');
  await show('panel', 280);
  await wait('panel', `${has('panel', 'summary-progress')}&&getComputedStyle(d.body).backgroundColor!=='rgb(250, 250, 250)'`, 'dark rail');
  await quiet('S3:keyboard', async () => {
    const active = () => guest<string>('panel', `return d.activeElement?.dataset?.testid??d.activeElement?.tagName??''`);
    await guest('panel', `w.focus();d.activeElement?.blur?.();d.querySelector('article.ap-plan').scrollIntoView({block:'start'});return true`);
    let steps = 0;
    while ((await active()) !== 'summary-progress' && steps < 40) { await key('Tab'); steps++; }
    check('S3:tab-reaches-progress', (await active()) === 'summary-progress', [`Reached Copy progress update by Tab`]);
    const ring = () => guest<boolean>('panel', `const n=d.activeElement,cs=getComputedStyle(n);return n.matches(':focus-visible')&&(cs.boxShadow!=='none'||cs.outlineStyle!=='none')`);
    check('S3:focus-visible-progress', await ring());
    await key('Tab');
    check('S3:tab-reaches-handoff', (await active()) === 'summary-handoff');
    await key('Tab', 1, 8);
    await key('Enter');
    const expected = (await fx.expected('P-summary', 'progress'))!;
    await wait('panel', showsText('panel', expected), 'Enter opens progress preview');
    check('S3:enter-opens-progress', (await active()) === 'summary-progress', ['Focus stays on the opening action across the preview paint']);
    await key('Tab'); await key('Tab');
    check('S3:tab-reaches-text', (await active()) === 'summary-text');
    await key('Tab');
    check('S3:tab-reaches-copy', (await active()) === 'summary-copy');
    check('S3:focus-visible-copy', await ring());
    await setClipboard(SENTINEL);
    await key(' ');
    await wait('panel', announced('panel', 'Markdown copied.'), 'Space copies, announced');
    check('S3:space-copies-exact', (await clipboard()) === expected, ['Space activates Copy; polite status announces success'], undefined);
    await wait('panel', `d.activeElement?.dataset?.testid==='summary-copy'`, 'focus returns to Copy after keyboard copy', 5000).catch(() => {});
    check('S3:focus-kept-after-copy', (await active()) === 'summary-copy', ['Focus is on Copy after keyboard activation completes (no Tab-walk)'], await active());
    const wrap = await guest('panel', `const t=d.querySelector('${hook('panel', 'summary-text')}'),cs=getComputedStyle(t);return {wraps:cs.whiteSpace!=='pre'&&cs.whiteSpace!=='nowrap'&&t.scrollWidth<=t.clientWidth+1,width:d.documentElement.clientWidth}`);
    check('S3:narrow-wraps-no-overflow', wrap.wraps && wrap.width === 280 && await noOverflow('panel'), ['280px: preview text wraps, no horizontal overflow, controls inside width'], wrap);
    await shot('panel', 'preview-narrow-keyboard', 'article.ap-plan .ap-summary');
    await key('Tab');
    check('S3:tab-reaches-close', (await active()) === 'summary-close');
    await key('Enter');
    await wait('panel', `!${has('panel', 'summary-preview')}&&d.activeElement?.dataset?.testid==='summary-progress'`, 'Close returns focus');
    results.push({ id: 'S3:close-returns-focus', pass: true, facts: ['Enter on Close returns focus to Copy progress update'] });
    await key('Tab');
    await key(' ');
    const handoffText = (await fx.expected('P-summary', 'handoff'))!;
    await wait('panel', showsText('panel', handoffText), 'Space opens handoff preview');
    await key('Tab');
    await key('a', 1, 2);
    check('S3:narrow-text-selectable', await guest<boolean>('panel', `const t=d.activeElement;return t?.dataset?.testid==='summary-text'&&t.selectionStart===0&&t.selectionEnd===t.value.length`));
    await click('panel', hook('panel', 'summary-close'));
    await wait('panel', `!${has('panel', 'summary-preview')}`);
  });

  // ------------------------------------------------ Step 1b: board, dark, 1100px
  await show('page', 1100);
  await wait('page', `d.querySelector('${row('P-summary')}')`, 'board lists F1');
  await selectBoard('P-summary');
  check('S1:board:progress-tab', await guest<boolean>('page', `const t=[...d.querySelectorAll('[data-testid="detail-tabs"] [role="tab"]')].find(n=>n.getAttribute('aria-selected')==='true');return !t||t.textContent==='Progress'`));
  await openAndCopy('page', 'progress', 'P-summary', 'S1:board');
  await openAndCopy('page', 'handoff', 'P-summary', 'S1:board');
  await shot('page', 'handoff-board-dark', '[data-testid="plan-detail"]');

  // ------------------------------------------------ Step 3b: narrow light board (no extra screenshot)
  await theme('light');
  await show('page', 360);
  await wait('page', `${has('page', 'summary-progress')}`, 'narrow board detail');
  await quiet('S3:board-narrow', async () => {
    await click('page', hook('page', 'summary-progress'));
    await wait('page', showsText('page', (await fx.expected('P-summary', 'progress'))!));
    check('S3:board-narrow-light-no-overflow', await noOverflow('page'), ['360px light board: preview wraps, controls inside width']);
  });

  // ------------------------------------------------ Step 4a: F2 held continuation
  await show('page', 1100);
  await evaluate(`qa.holds.push({tag:'f2',surface:'page',path:'/v1/plan',plan:'P-paged',cursor:true});true`);
  await click('page', row('P-paged'));
  await wait('page', `qa.held.some(h=>h.tag==='f2')&&${has('page', 'summary-handoff')}&&d.querySelector('[data-testid="plan-detail"] [data-testid="plan-P-paged"]')`, 'F2 continuation held');
  await quiet('S4:f2', async () => {
    await click('page', hook('page', 'summary-handoff'));
    await wait('page', loading('page'), 'F2 loading');
    check('S4:f2-held-no-copyable-prefix', await guest<boolean>('page', `return !${has('page', 'summary-text')}&&!${has('page', 'summary-only')}&&d.querySelector('${hook('page', 'summary-copy')}').disabled`), ['Held continuation: loading, Copy disabled, no partial text']);
    await evaluate(`qa.release('f2')`);
    const expected = (await fx.expected('P-paged', 'handoff'))!;
    await wait('page', showsText('page', expected), 'F2 full text after release');
    check('S4:f2-full-counts', expected.includes('Progress: 1/21 done; 20 remaining; 0 skipped') && expected.includes('Recorded reports: 41 direct; 0 parent-relay') && expected.includes('…showing 10 of 20') && expected.includes('Task 21 (Done)'), ['21 tasks, 41 reports, later-page prerequisite, showing 10 of 20']);
    await setClipboard(SENTINEL);
    await click('page', hook('page', 'summary-copy'));
    await wait('page', announced('page', 'Markdown copied.'));
    check('S4:f2-clipboard-exact', (await clipboard()) === expected);
  });

  // ------------------------------------------------ Step 4b: F4 failure after a valid first page
  const busy: Fault = { cursor: true, status: 503, error: 'busy' };
  await evaluate(`qa.faults=[{surface:'page',path:'/v1/plan',plan:'P-paged',cursor:true,status:503,error:'busy'}];true`);
  fx.advance('paged');
  await wait('page', `${has('page', 'summary-only')}&&${has('page', 'summary-retry')}&&d.querySelector('${hook('page', 'summary-preview')}').textContent.includes('The progress store returned busy (HTTP 503).')`, 'continuation failure offers summary-only + retry');
  check('S4:f4-failure-no-partial', await guest<boolean>('page', `return !${has('page', 'summary-text')}&&d.querySelector('${hook('page', 'summary-copy')}').disabled`), ['Failure after first page: actual cause, Retry and Preview summary only; no copyable detail']);
  await quiet('S4:f4', async () => {
    const summaryOnly = await fx.expectedSummaryOnly('P-paged', busy);
    await click('page', hook('page', 'summary-only'));
    await wait('page', showsText('page', summaryOnly), 'summary-only text');
    check('S4:f4-summary-only-explicit', summaryOnly.includes('Coverage: summary-only historical snapshot; full detail is unavailable.') && !/## Current work|## Not started|Origin session:|Recorded reports:|Suggested next step|Remaining breakdown/.test(summaryOnly), ['Explicit historical coverage label; no detail-derived sections']);
    // The fault stays active: background refreshes at the same identity keep failing. Two further
    // failed continuation reads (the second starts only after the first was absorbed) must leave the
    // chosen text, its generation, its keyboard selection and Copy unchanged.
    const generation = await guest<string>('page', `return d.querySelector('${hook('page', 'summary-text')}').dataset.generation`);
    await click('page', hook('page', 'summary-text'));
    await key('a', 1, 2);
    const mark = await evaluate<number>('qa.requests.length');
    const refreshed = await evaluate<boolean>(`(async()=>{const end=Date.now()+30000;while(Date.now()<end){if(qa.requests.slice(${mark}).filter(q=>q.surface==='page'&&q.path==='/v1/plan'&&q.query?.plan==='P-paged'&&q.query?.cursor).length>=2&&qa.flight===0)return true;await new Promise(r=>setTimeout(r,40))}return false})()`);
    check('S4:f4-background-failed-refresh-observed', refreshed, ['Two further background reads failed at the same identity while summary-only was shown']);
    await frames();
    const stable = await guest('page', `const t=d.querySelector('${hook('page', 'summary-text')}');return {text:t?.value===${JSON.stringify(summaryOnly)},generation:t?.dataset.generation===${JSON.stringify(generation)},copy:${copyEnabled('page')},selected:!!t&&d.activeElement===t&&t.selectionStart===0&&t.selectionEnd===t.value.length,summaryOnlyButton:${has('page', 'summary-only')},retry:${has('page', 'summary-retry')}}`);
    check('S4:f4-summary-only-stable-through-failed-refresh', stable.text && stable.generation && stable.copy && stable.selected && !stable.summaryOnlyButton && stable.retry, ['Chosen summary-only text, generation, selection and enabled Copy unchanged; Retry still offered'], stable);
    await setClipboard(SENTINEL);
    await click('page', hook('page', 'summary-copy'));
    await wait('page', announced('page', 'Markdown copied.'));
    check('S4:f4-summary-only-clipboard-exact', (await clipboard()) === summaryOnly);
    await shot('page', 'summary-only-failure', '[data-testid="plan-detail"]');
    await evaluate(`qa.faults=[];true`);
    await click('page', hook('page', 'summary-retry'));
    await wait('page', showsText('page', (await fx.expected('P-paged', 'handoff'))!), 'Retry recovers full handoff');
    results.push({ id: 'S4:f4-retry-recovers', pass: true, facts: ['Retry re-reads and shows the complete handoff'] });
  });

  // ------------------------------------------------ Step 4c: initial-page failure → Retry only
  await selectBoard('P-summary');
  await evaluate(`qa.faults=[{surface:'page',path:'/v1/plan',plan:'P-paged',cursor:false,status:503,error:'busy'}];true`);
  fx.advance('paged');
  await wait('page', `d.querySelector('${row('P-paged')}')`);
  await quiet('S4:initial', async () => {
    await selectBoard('P-paged');
    await click('page', hook('page', 'summary-progress'));
    await wait('page', `${has('page', 'summary-retry')}&&d.querySelector('${hook('page', 'summary-preview')}').textContent.includes('The progress store returned busy (HTTP 503).')`, 'initial failure');
    check('S4:initial-failure-retry-only', await guest<boolean>('page', `return !${has('page', 'summary-only')}&&!${has('page', 'summary-text')}&&d.querySelector('${hook('page', 'summary-copy')}').disabled`), ['Initial-page failure: Retry only, nothing copyable']);
    await evaluate(`qa.faults=[];true`);
    await click('page', hook('page', 'summary-retry'));
    await wait('page', showsText('page', (await fx.expected('P-paged', 'progress'))!), 'Retry after initial failure');
  });

  // ------------------------------------------------ Step 5a: rail progress-revision race + retained callback
  await show('panel', 360);
  await context(PLANS.race.session);
  await wait('panel', `d.querySelector('article.ap-plan[data-testid="plan-P-race"]')&&${has('panel', 'summary-progress')}`, 'rail shows race plan');
  await quiet('S5:rail-race', async () => {
    const first = (await fx.expected('P-race', 'progress'))!;
    await click('panel', hook('panel', 'summary-progress'));
    await wait('panel', showsText('panel', first));
    await guest('panel', `window.qaOld=d.querySelector('${hook('panel', 'summary-copy')}');return true`);
    await setClipboard(SENTINEL);
    await evaluate(`qa.holds.push({tag:'race',surface:'panel',path:'/v1/plan',plan:'P-race'});true`);
    fx.advance('race');
    await wait('panel', `qa.held.some(h=>h.tag==='race')&&${loading('panel')}`, 'new revision retires old text');
    check('S5:revision-change-retires-text', true, ['Progress revision change: old text retired, loading while the new read is held']);
    await guest('panel', `window.qaOld.click();return true`);
    await frames();
    check('S5:retained-copy-inert', (await clipboard()) === SENTINEL && !(await status('panel')).includes('Markdown copied.'), ['Retained old Copy button writes nothing and announces nothing']);
    await context(PLANS.summary.session);
    await wait('panel', `d.querySelector('article.ap-plan[data-testid="plan-P-summary"]')&&!${has('panel', 'summary-preview')}`, 'rail B has no preview');
    await evaluate(`qa.release('race')`);
    await flightDone();
    await frames();
    check('S5:late-reply-no-stale-preview', await guest<boolean>('panel', `return !!d.querySelector('article.ap-plan[data-testid="plan-P-summary"]')&&!${has('panel', 'summary-preview')}`) && (await clipboard()) === SENTINEL, ['Released late reply paints no preview on the new selection']);
    await context(null);
    await wait('panel', `d.querySelector('[data-testid="unscoped-state"]')&&!d.querySelector('[data-testid="summary-preview"]')`, 'rail null');
    await context(PLANS.race.session);
    await wait('panel', `d.querySelector('article.ap-plan[data-testid="plan-P-race"]')&&${has('panel', 'summary-progress')}&&!${has('panel', 'summary-preview')}`, 'rail back: preview ephemeral');
    const second = (await fx.expected('P-race', 'progress'))!;
    await click('panel', hook('panel', 'summary-progress'));
    await wait('panel', showsText('panel', second));
    check('S5:rail-switch-regenerates', second !== first && await guest<boolean>('panel', `return d.querySelector('article.ap-plan[data-testid="plan-P-race"]').dataset.revision===${JSON.stringify(String(fx.revision('P-race')))}`), ['A→B→null→A: preview retired; reopened text is for the new revision']);
  });

  // ------------------------------------------------ Step 5b: cleanup-revision change without progress revision
  const archiveRevision = fx.revision('P-archive');
  // Rail: the session's only plan stays selected, so the same selection must refresh and rebind.
  await context(PLANS.archive.session);
  await wait('panel', `d.querySelector('article.ap-plan[data-testid="plan-P-archive"]')&&${has('panel', 'summary-handoff')}`, 'rail shows archive plan');
  await quiet('S5:cleanup-race-rail', async () => {
    const expected = (await fx.expected('P-archive', 'handoff'))!;
    await click('panel', hook('panel', 'summary-handoff'));
    await wait('panel', showsText('panel', expected));
    const generation = await guest<string>('panel', `return d.querySelector('${hook('panel', 'summary-text')}').dataset.generation`);
    await evaluate(`qa.holds.push({tag:'list',surface:'panel',path:'/v1/plans',before:true});true`);
    await flightDone();
    await fx.bounce('P-archive');
    await evaluate(`qa.holds.push({tag:'detail',surface:'panel',path:'/v1/plan',plan:'P-archive'});qa.release('list');true`);
    await wait('panel', `qa.held.some(h=>h.tag==='detail')&&${loading('panel')}`, 'cleanup revision change retires text');
    check('S5:cleanup-revision-only', fx.revision('P-archive') === archiveRevision && fx.cleanupState('P-archive')?.state === 'visible', ['Cleanup revision moved; progress revision unchanged']);
    results.push({ id: 'S5:cleanup-change-retires-text', pass: true, facts: ['Same rail selection: old text retired, loading while the re-read is held'] });
    await evaluate(`qa.release('detail')`);
    await wait('panel', `${showsText('panel', expected)}&&d.querySelector('${hook('panel', 'summary-text')}').dataset.generation!==${JSON.stringify(generation)}`, 'cleanup change regenerates');
    results.push({ id: 'S5:cleanup-change-regenerates', pass: true, facts: ['Cleanup-only change regenerated the same-selection preview'] });
  });
  // Board: the existing cleanup contract evicts the affected selection; its preview retires with it.
  await show('page', 1100);
  await selectBoard('P-archive');
  await quiet('S5:cleanup-race-board', async () => {
    await click('page', hook('page', 'summary-handoff'));
    await wait('page', showsText('page', (await fx.expected('P-archive', 'handoff'))!));
    await fx.bounce('P-archive');
    await wait('page', `!d.querySelector('[data-testid="plan-detail"] [data-testid="plan-P-archive"]')&&!d.querySelector('[data-testid="summary-preview"]')&&d.querySelector('${row('P-archive')}')`, 'board cleanup change retires preview');
    results.push({ id: 'S5:board-cleanup-change-retires-preview', pass: true, facts: ['Board: cleanup-only change evicts the selection (existing cleanup contract) and retires its preview; no stale text'] });
    await selectBoard('P-archive');
    await click('page', hook('page', 'summary-handoff'));
    await wait('page', showsText('page', (await fx.expected('P-archive', 'handoff'))!), 'board reselect regenerates');
  });

  // ------------------------------------------------ Step 5c: archive → Archived plans → copy (archived) → restore
  const mutations0 = (await effects()).mutations;
  await click('page', '[data-testid="cleanup-archive"] button');
  await wait('page', `d.querySelector('[data-testid="cleanup-notice"]')&&!d.querySelector('${row('P-archive')}')`, 'archived via UI');
  await wait('page', `!d.querySelector('[data-testid="plan-detail"] [data-testid="plan-P-archive"]')&&!d.querySelector('[data-testid="summary-preview"]')`, 'removed selection retires preview');
  await click('page', '[data-testid="cleanup-archived"] button');
  await wait('page', `d.querySelector('${row('P-archive')}')`, 'archived list');
  await selectBoard('P-archive');
  const archived = await openAndCopy('page', 'handoff', 'P-archive', 'S5:archived');
  check('S5:archived-title', archived.startsWith('Plan: Completed export example (P\\-archive) (archived)\nLifecycle: Finished'), ['Archived plan readable; regenerated title carries (archived)']);
  await shot('page', 'archived-handoff', '[data-testid="plan-detail"]');
  await click('page', '[data-testid="cleanup-restore"] button');
  await wait('page', `!d.querySelector('${row('P-archive')}')`, 'restored out of archived list');
  await click('page', '[data-testid="cleanup-visible"] button');
  await wait('page', `d.querySelector('${row('P-archive')}')`);
  await selectBoard('P-archive');
  const restored = await openAndCopy('page', 'handoff', 'P-archive', 'S5:restored');
  check('S5:restored-no-archive-label', !restored.includes('(archived)'), ['Restore removes the archive label']);
  const setupClicks = (await effects()).mutations - mutations0;
  check('S5:only-explicit-cleanup-mutations', setupClicks === 2 && same((await evaluate<string[]>(`qa.requests.filter(q=>q.method!=='GET').map(q=>q.path)`)), ['/v1/plan/archive', '/v1/plan/restore']), ['Guest mutations are exactly the two explicit archive/restore setup clicks']);

  // ------------------------------------------------ Step 5d: delete during detail continuation → actual not-found
  await evaluate(`qa.holds.push({tag:'detail',surface:'page',path:'/v1/plan',plan:'P-delete',cursor:true,before:true});true`);
  await click('page', row('P-delete'));
  await wait('page', `qa.held.some(h=>h.tag==='detail')&&d.querySelector('[data-testid="plan-detail"] [data-testid="plan-P-delete"]')&&${has('page', 'summary-handoff')}`, 'delete plan continuation held');
  await quiet('S5:delete', async () => {
    await click('page', hook('page', 'summary-handoff'));
    await wait('page', loading('page'));
    await evaluate(`qa.holds.push({tag:'list',surface:'page',path:'/v1/plans',before:true});true`);
    await flightDone();
    await fx.remove('P-delete');
    check('S5:fixture-deleted', !fx.exists('P-delete'));
    await evaluate(`qa.release('detail')`);
    await wait('page', `d.querySelector('${hook('page', 'summary-preview')}')?.textContent.includes('The plan was not found.')`, 'actual not-found');
    const shown = await status('page');
    check('S5:delete-actual-not-found', !/restart budget|identity|archiv|page limit/i.test(shown) && await guest<boolean>('page', `return !${has('page', 'summary-text')}&&${has('page', 'summary-retry')}`), ['Deletion during continuation shows actual not-found, not revision churn or archive-unavailable']);
    await evaluate(`qa.release('list')`);
    await wait('page', `!d.querySelector('${row('P-delete')}')&&!d.querySelector('[data-testid="plan-detail"] [data-testid="plan-P-delete"]')`, 'list converges after delete');
  });

  const total = await effects();
  facts.documentReads = total.document; facts.historyReads = total.history; facts.guestMutations = total.mutations; facts.sessionNavigation = total.navigation; facts.fixtureSetupMutations = fx.setupMutations();
  check('S5:no-session-navigation', total.navigation === 0);
  check('S5:no-document-history-reads', total.document === 0 && total.history === 0, ['No document or history reads in the whole run']);
  check('S0:no-proxy-errors', same(await evaluate('qa.errors'), []));
  const errors = c.events.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(' ') ?? '').split('\n')[0].slice(0, 160));
  check('S0:no-guest-exceptions-or-console-errors', errors.length === 0, undefined, errors);
} catch (e) {
  failure = e instanceof Error ? e.message.split('\n')[0].slice(0, 300) : String(e);
} finally {
  page?.close(); browser?.close();
  // Our own Chromium process group only (its helpers too), never another browser.
  const exited = new Promise((r) => { if (chrome.exitCode !== null) r(null); else chrome.once('exit', r); });
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
  await exited;
  await fx.stop();
  const summary = {
    evidenceClass: 'synthetic SDK shell, real built HTTP service over disposable SQLite, isolated headless Linux Chromium, current guest bundles',
    nativeHostProof: false, nativeWindowsProof: false,
    passed: !failure && results.every((r) => r.pass), failure, assertions: results.length, results, facts, screenshots: shots,
  };
  writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ passed: summary.passed, assertions: summary.assertions, failure, screenshots: shots }, null, 2));
  if (!summary.passed) process.exitCode = 1;
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
