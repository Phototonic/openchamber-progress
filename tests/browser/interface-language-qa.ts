// Current-bundle synthetic SDK-shell QA, NOT native-host/Windows/screen-reader certification.
// Own loopback fixture and fresh Chromium profile only; never attach to an existing browser.
// node --experimental-strip-types tests/browser/interface-language-qa.ts --artifacts <dir> [--chromium <path>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';
import { LANGUAGE_KEY, USER_TASK_TITLE, startLanguageFixture } from './interface-language-fixture.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const destination = arg('--artifacts');
if (!destination) throw new Error('usage: interface-language-qa.ts --artifacts <external-dir> [--chromium <path>]');
const artifacts = resolve(destination), repo = resolve('.');
if (artifacts === repo || artifacts.startsWith(repo + '/')) throw new Error('Artifacts must be outside the repository.');
mkdirSync(artifacts, { recursive: true });

function findChromium() {
  const explicit = arg('--chromium') ?? process.env.CHROMIUM_PATH;
  if (explicit) { if (!isAbsolute(explicit) || !existsSync(explicit)) throw new Error('Chromium path must be an installed absolute executable.'); return explicit; }
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const b of builds) { const p = join(cache, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p; }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p;
  throw new Error('No installed Chromium found; no download or installation attempted.');
}

type Cdp = { send: (method: string, params?: object) => Promise<any>; close: () => void; errors: string[] };
async function connect(url: string, origin: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('CDP connection failed')); });
  let next = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const errors: string[] = [];
  const send: Cdp['send'] = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (event) => {
    const m = JSON.parse(String(event.data)), p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method === 'Fetch.requestPaused') {
      const allowed = m.params.request.url.startsWith(origin + '/');
      if (!allowed) errors.push('blocked unexpected external request');
      void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) });
    } else if (m.method === 'Runtime.exceptionThrown') errors.push('guest runtime exception');
    // Service 404/503 responses are intentional fault seams, not guest runtime exceptions.
  };
  return { send, errors, close: () => { for (const p of pending.values()) p.reject(new Error('CDP closed')); pending.clear(); ws.close(); } };
}

const results: { id: string; pass: boolean }[] = [], screenshots: string[] = [];
const facts: Record<string, unknown> = {};
const PUBLIC_TITLE = 'Alpha implementation';
let failure: string | null = null;
const check = (id: string, pass: boolean) => { results.push({ id, pass }); if (!pass) throw new Error(id); };
mkdirSync('/tmp/opencode', { recursive: true });
const profile = mkdtempSync('/tmp/opencode/interface-language-qa-');
let chrome: ReturnType<typeof spawn> | undefined, page: Cdp | undefined, browser: Cdp | undefined;
let fixture: Awaited<ReturnType<typeof startLanguageFixture>> | undefined;
try {
  const executable = findChromium();
  fixture = await startLanguageFixture();
  const origin = `http://127.0.0.1:${fixture.port}`;
  chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true });
  let port = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !port;) {
    const file = join(profile, 'DevToolsActivePort');
    if (existsSync(file)) port = readFileSync(file, 'utf8').split('\n')[0];
    else await new Promise((r) => setTimeout(r, 50));
  }
  if (!port) throw new Error('Disposable Chromium did not start.');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
  browser = await connect(version.webSocketDebuggerUrl, origin);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  page = await connect(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl, origin);
  const c = page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await c.send('Page.navigate', { url: origin + '/' });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('QA expression failed: ' + r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(s: string, code: string) => evaluate<T>(`(()=>{const w=frame(${literal(s)}).contentWindow,d=w.document;${code}})()`);
  const wait = async (condition: string, name: string, ms = 5000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=Date.now()+${ms};while(Date.now()<end){try{if(await (${condition}))return true}catch{}await new Promise(r=>setTimeout(r,25))}return false})()`);
    if (!ok) throw new Error('Timed out: ' + name);
  };
  const inFrame = (s: string, condition: string) => `(()=>{const w=frame(${literal(s)}).contentWindow,d=w.document;return ${condition}})()`;
  const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,0))))');
  const key = async (key: string, modifiers = 0) => {
    const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, Home: 36, End: 35 };
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key, code: key, modifiers, windowsVirtualKeyCode: codes[key] ?? 0, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  };
  const click = async (s: string, selector: string) => {
    const point = await evaluate<number[] | null>(`(()=>{const f=frame(${literal(s)}),n=f.contentDocument.querySelector(${literal(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=f.getBoundingClientRect();return[o.x+r.x+r.width/2,o.y+r.y+r.height/2]})()`);
    if (!point) throw new Error('Missing synthetic QA target: ' + selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: 'left', clickCount: 1 });
  };
  const all = ['panel', 'page', 'status'];
  const container = '[data-testid="interface-language"]', trigger = container + ' button[aria-haspopup="listbox"]';
  const show = async (s: string, width = 360) => { await evaluate(`qa.show(${literal(s)},${width})`); await frames(); };
  const ready = async (patch: object) => { await evaluate(`qa.ready(null,${literal(patch)})`); await frames(); };
  const lang = async (expected: string, surfaces = all) => {
    for (const s of surfaces) await wait(inFrame(s, `d.documentElement.lang===${literal(expected)}`), `${s} lang=${expected}`);
  };
  const focusRead = async () => { await evaluate(`['panel','page','status'].forEach(s=>qa.focus(s))`); await frames(); };
  const reload = async (s: string) => {
    const before = await evaluate<number>(`qa.messages.filter(m=>m.surface===${literal(s)}&&m.type==='hello').length`);
    await evaluate(`qa.reload(${literal(s)})`);
    await wait(`qa.messages.filter(m=>m.surface===${literal(s)}&&m.type==='hello').length>${before}&&${inFrame(s, `!!d.querySelector('[data-testid="progress-root"]')`)}`, `${s} reloaded`);
    await frames();
  };
  const count = (op: string) => evaluate<number>(`qa.storageLog.filter(q=>q.key===${literal(LANGUAGE_KEY)}&&q.op===${literal(op)}).length`);
  const saved = () => evaluate(`qa.maps.get(qa.space)?.get(${literal(LANGUAGE_KEY)})??null`);
  const selectStart = async (s: string, preference: 'auto' | 'en' | 'ru') => {
    await show(s);
    await wait(inFrame(s, `d.querySelector(${literal(trigger)})?.disabled===false`), `${s} selector enabled`);
    await guest(s, `d.querySelector(${literal(trigger)}).focus();return true`);
    // Let focus-induced scrolling finish before the SDK installs its scroll-to-close listener.
    await frames();
    const selectorStates = (facts.selectorStates ??= []) as unknown[];
    selectorStates.push(await guest(s, `const b=d.querySelector(${literal(trigger)});return {surface:${literal(s)},phase:'focused',focused:d.activeElement===b,ownsFocus:d.hasFocus(),active:d.activeElement?.tagName,expanded:b?.getAttribute('aria-expanded')}`));
    await key('Enter');
    selectorStates.push(await guest(s, `const b=d.querySelector(${literal(trigger)});return {surface:${literal(s)},phase:'entered',focused:d.activeElement===b,ownsFocus:d.hasFocus(),active:d.activeElement?.tagName,expanded:b?.getAttribute('aria-expanded'),popups:d.querySelectorAll('.oc-sdk-popup').length}`));
    await wait(inFrame(s, `!!d.querySelector('.oc-sdk-popup [role="listbox"]')`), 'SDK listbox opened');
    const options = await guest<string[]>(s, `return [...d.querySelectorAll('.oc-sdk-popup [role="listbox"] [role="option"]')].map(n=>n.id.split('-').pop())`);
    check('selector:SDK-option-ids-auto-en-ru', JSON.stringify(options) === JSON.stringify(['auto', 'en', 'ru']));
    check('selector:endonyms', await guest<boolean>(s, `return [...d.querySelectorAll('.oc-sdk-popup [role="option"]')].some(n=>n.textContent==='English')&&[...d.querySelectorAll('.oc-sdk-popup [role="option"]')].some(n=>n.textContent==='Русский')`));
    await key('Home');
    for (let i = 0; i < ['auto', 'en', 'ru'].indexOf(preference); i++) await key('ArrowDown');
    await key('Enter'); await frames();
  };
  const choose = async (s: string, preference: 'auto' | 'en' | 'ru') => {
    await selectStart(s, preference);
    await wait(`qa.maps.get(qa.space)?.get(${literal(LANGUAGE_KEY)})?.preference===${literal(preference)}`, 'confirmed device value');
    await wait(inFrame(s, `d.querySelector(${literal(trigger)})?.disabled===false`), 'save settled');
    await focusRead();
    await lang(preference === 'ru' ? 'ru' : preference === 'en' ? 'en' : await evaluate(`qa.ctx.locale.startsWith('ru')?'ru':'en'`));
  };
  const effects = () => evaluate<string>(`JSON.stringify({requests:qa.requests,storage:qa.storageLog.filter(q=>q.op!=='get'&&q.key!==${literal(LANGUAGE_KEY)})})`);
  const unchanged = async (name: string, run: () => Promise<unknown>) => { const before = await effects(); await run(); await frames(); check(name + ':no-extra-service-or-checkpoint-IO', before === await effects()); };
  const explanation = (s: string) => guest<string>(s, `const n=d.querySelector(${literal(container)}),b=n?.querySelector('button'),ids=[b?.getAttribute('aria-describedby'),n?.getAttribute('aria-describedby')].filter(Boolean).join(' ').split(' ').filter(Boolean);return ids.map(id=>d.getElementById(id)?.textContent||'').join(' ').trim()`);
  const shot = async (name: string) => { const png = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, name + '.png'), Buffer.from(png.data, 'base64')); screenshots.push(name + '.png'); };

  await wait(`window.qa&&['panel','page','status'].every(s=>frame(s).contentDocument?.querySelector('[data-testid="progress-root"]'))`, 'three real guest bundles mounted');
  facts.simultaneouslyMountedGuests = 3;
  await show('panel');
  // This is intentionally the first feature assertion: unchanged bundles must fail here (RED).
  for (const s of ['panel', 'page']) check(`${s}:no-session:exactly-one-language-selector`, await guest<boolean>(s, `return d.querySelectorAll(${literal(container)}).length===1&&!!d.querySelector(${literal(trigger)})`));
  check('status:no-selector', await guest<boolean>('status', `return !d.querySelector(${literal(container)})`));
  await lang('en');
  check('default:auto-without-write', await count('set') === 0 && await saved() === null);
  for (const s of ['panel', 'page']) {
    check(`${s}:accessible-language-label`, await guest<boolean>(s, `const b=d.querySelector(${literal(trigger)});return (d.getElementById(b.getAttribute('aria-labelledby'))?.textContent||b.getAttribute('aria-label'))==='Language'`));
    await selectStart(s, 'auto'); // already selected: must not create a preference or write.
  }
  check('same-auto:no-automatic-save', await count('set') === 0);
  for (const [host, expected] of [['ru-RU', 'ru'], ['de-DE', 'en'], ['not_a_locale!', 'en'], ['en', 'en']]) {
    await unchanged(`auto:${host}`, async () => { await ready({ locale: host }); await lang(expected); });
  }
  await choose('page', 'ru');
  check('persisted:exact-v1-record', JSON.stringify(await saved()) === '{"v":1,"preference":"ru"}');
  for (const s of all) await reload(s);
  await lang('ru');
  check('storage:only-explicit-device-for-language', await evaluate(`qa.storageLog.filter(q=>q.key===${literal(LANGUAGE_KEY)}).every(q=>q.scope==='device')`));
  await ready({ locale: 'de-DE', directory: '/fixture/Beta', connection: { connected: true, account: 'other-fixture' } });
  await evaluate(`qa.context(${literal(fixture.session)})`); await focusRead(); await lang('ru');
  check('explicit:survives-host-context', (await saved()).preference === 'ru');

  // Namespace isolation is host-provided. Switch the synthetic host namespace, then focus-read.
  await evaluate(`qa.namespace('secondary')`); await focusRead(); await lang('en');
  check('namespace:second-has-no-record', await saved() === null);
  await evaluate(`qa.namespace('primary')`); await focusRead(); await lang('ru');

  // Errors never repair storage or display raw host error text. Reset through reload, not a new UI seam.
  await ready({ locale: 'en' });
  for (const bad of [null, { v: 2, preference: 'ru' }, { v: 1, preference: 'ru', extra: true }, '<script>synthetic</script>']) {
    const before = await count('set');
    await evaluate(`qa.seed(${literal(bad)})`); await reload('panel'); await lang('en', ['panel']);
    await wait(inFrame('panel', `d.querySelector(${literal(trigger)})?.disabled===false`), 'malformed read settles');
    check('malformed:no-repair', before === await count('set') && JSON.stringify(await saved()) === JSON.stringify(bad));
    check('malformed:accessible-explanation', (await explanation('panel')).length > 0);
  }
  await evaluate(`qa.seed({v:1,preference:'en'})`); await focusRead(); await lang('en');
  for (const [reason, code] of [['denied', 'HOST_REJECTED'], ['quota', 'HOST_REJECTED'], ['unsupported', 'UNSUPPORTED']]) {
    await evaluate(`qa.faults=[{tag:${literal(reason)},kind:'storage',op:'set',key:${literal(LANGUAGE_KEY)},code:${literal(code)}}]`);
    await selectStart('panel', 'ru');
    await wait(inFrame('panel', `d.querySelector(${literal(trigger)})?.disabled===false`), 'failed save settles');
    await lang('en'); check(`failed-save:${reason}:confirmed-value-unchanged`, (await saved()).preference === 'en');
    check(`failed-save:${reason}:accessible-error`, (await explanation('panel')).length > 0);
    check('failed-save:raw-error-not-visible', await guest<boolean>('panel', `return !d.body.textContent.includes('synthetic-private-error-never-render')`));
  }
  await evaluate('qa.faults=[]');
  await evaluate(`qa.holds=[{tag:'write',kind:'storage',surface:'panel',op:'set',key:${literal(LANGUAGE_KEY)}}]`);
  const sets = await count('set'); await selectStart('panel', 'ru');
  await wait(`qa.held.some(h=>h.tag==='write')`, 'held device write');
  check('pending:disabled-no-false-save', await guest<boolean>('panel', `return d.querySelector(${literal(trigger)}).disabled`) && (await saved()).preference === 'en');
  await key('Enter'); await key('Enter');
  check('pending:one-set-only', await count('set') === sets + 1);
  await evaluate(`qa.release('write')`); await focusRead(); await lang('ru');
  check('keyboard:focus-on-surviving-trigger', await guest<boolean>('panel', `return d.activeElement===d.querySelector(${literal(trigger)})`));
  await key('Tab'); await key('Tab', 8);
  check('keyboard:visible-focus', await guest<boolean>('panel', `const n=d.activeElement,cs=w.getComputedStyle(n);return n.matches(':focus-visible')&&(cs.outlineStyle!=='none'||cs.boxShadow!=='none')`));

  await choose('panel', 'en');
  await evaluate(`qa.holds=[{tag:'resumed-write',kind:'storage',surface:'panel',op:'set',key:${literal(LANGUAGE_KEY)}}]`);
  await selectStart('panel', 'ru');
  await wait(`qa.held.some(h=>h.tag==='resumed-write')`, 'write before hide');
  await evaluate(`qa.visible('panel',false);qa.visible('panel',true);qa.holds.push({tag:'resumed-read',kind:'storage',surface:'panel',op:'get',key:${literal(LANGUAGE_KEY)}});qa.release('resumed-write')`);
  await wait(`qa.held.some(h=>h.tag==='resumed-read')`, 'held reread after returning');
  await wait(inFrame('panel', `d.querySelector(${literal(trigger)})?.disabled===false`), 'completed resumed write enables selector before reread');
  check('resumed-write:pending-cleared-before-held-read', await guest<boolean>('panel', `return !d.querySelector(${literal(trigger)}).disabled&&d.documentElement.lang==='en'`));
  await evaluate(`qa.release('resumed-read')`); await focusRead(); await lang('ru');
  await choose('panel', 'en');
  await evaluate(`qa.holds=[{tag:'stale',kind:'storage',surface:'panel',op:'get',key:${literal(LANGUAGE_KEY)}}];qa.focus('panel')`);
  await wait(`qa.held.some(h=>h.tag==='stale')`, 'captured stale English read');
  await selectStart('panel', 'ru'); await lang('ru', ['panel']);
  await evaluate(`qa.release('stale')`); await frames(); await lang('ru', ['panel']);
  check('late-read:does-not-overwrite-save', (await saved()).preference === 'ru');

  await evaluate(`document.querySelector('#outside').focus();qa.seed({v:1,preference:'en'})`);
  await unchanged('external-repaint', async () => { await focusRead(); await lang('en'); });
  check('external-repaint:outside-frame-focus-not-stolen', await evaluate(`document.activeElement.id==='outside'`));
  await evaluate(`qa.faults=[{kind:'storage',op:'get',key:${literal(LANGUAGE_KEY)},code:'HOST_REJECTED'}]`);
  await focusRead(); await lang('en');
  check('read-failure:keeps-confirmed', (await saved()).preference === 'en');
  await evaluate('qa.faults=[]');

  const storageBeforeUnsupported = await count('get') + await count('set');
  await ready({ features: {}, locale: 'ru-RU' }); await focusRead(); await lang('ru');
  for (const s of ['panel', 'page']) {
    check(`${s}:unsupported-disabled`, await guest<boolean>(s, `return d.querySelector(${literal(trigger)})?.disabled===true`));
    check(`${s}:unsupported-accessible-explanation`, (await explanation(s)).length > 0);
  }
  check('unsupported:no-storage-requests', storageBeforeUnsupported === await count('get') + await count('set'));
  await ready({ features: { deviceStorage: true }, locale: 'en' }); await focusRead(); await lang('en');

  // Footer must exist independently of progress/setup. Reload eliminates a last-good read.
  for (const mode of ['empty', 'setup', 'failure', 'loading']) {
    await evaluate(`qa.mode=${literal(mode === 'loading' ? 'plan' : mode)};qa.holds=${mode === 'loading' ? "[{tag:'progress',kind:'service',path:'/health'}]" : '[]'}`);
    for (const s of all) await reload(s);
    const observed = mode === 'loading' ? `qa.held.some(h=>h.tag==='progress')` : mode === 'failure' ? inFrame('panel', `!!d.querySelector('[data-testid="failure-state"]')||d.body.textContent.includes('503')||d.body.textContent.includes('busy')`) : mode === 'setup' ? inFrame('panel', `!!d.querySelector('[data-testid="setup-needed"]')`) : inFrame('panel', `!!d.querySelector('[data-testid="empty-state"]')`);
    await wait(observed, mode + ' actually observed');
    let setupValues: string[] | null = null;
    if (mode === 'setup') {
      await show('panel');
      await wait(inFrame('panel', `!!d.querySelector('[data-testid="setup-configRoot"] input')`), 'editable setup form');
      await click('panel', '[data-testid="setup-configRoot"] input');
      await c.send('Input.insertText', { text: '/fixture/Edited' });
      await frames();
      setupValues = await guest<string[]>('panel', `return [...d.querySelectorAll('[data-testid="setup-form"] input')].map(n=>n.value)`);
    }
    for (const s of ['panel', 'page']) check(`${s}:${mode}:one-selector-outside-plan`, await guest<boolean>(s, `const n=d.querySelector(${literal(container)});return d.querySelectorAll(${literal(container)}).length===1&&!n.closest('article.ap-plan,form')`));
    check(`status:${mode}:no-selector`, await guest<boolean>('status', `return !d.querySelector(${literal(container)})`));
    await unchanged(`${mode}:language-change`, () => choose('page', 'ru'));
    if (setupValues) check('setup:edited-fields-survive-language-change', JSON.stringify(setupValues) === JSON.stringify(await guest('panel', `return [...d.querySelectorAll('[data-testid="setup-form"] input')].map(n=>n.value)`)));
    await unchanged(`${mode}:language-return`, () => choose('page', 'en')); // works despite failed/held service.
    await evaluate(`qa.release('progress')`);
  }
  await evaluate(`qa.holds=[];qa.mode='plan';qa.context(${literal(fixture.session)})`);
  for (const s of all) await reload(s);
  await wait(inFrame('panel', `!!d.querySelector('article.ap-plan')`), 'synthetic plan displayed');

  // Translation must not authorize or repeat a setup action behind an open confirmation.
  await show('page');
  await click('page', '[data-testid="setup-section"] > summary');
  await wait(inFrame('page', `!!d.querySelector('[data-testid="setup-disable"] button')`), 'setup capture control');
  await click('page', '[data-testid="setup-disable"] button');
  await wait(inFrame('page', `!!d.querySelector('[data-testid="setup-confirm-disable"]')`), 'explicit setup confirmation');
  const confirmationEnglish = await guest<string>('page', `return d.querySelector('[data-testid="setup-confirm-disable"]').textContent`);
  await unchanged('setup-confirmation-language-only', () => choose('panel', 'ru'));
  check('setup:confirmation-preserved-and-translated', await guest<boolean>('page', `const n=d.querySelector('[data-testid="setup-confirm-disable"]');return !!n&&n.textContent!==${literal(confirmationEnglish)}&&!!n.querySelector('[data-testid="setup-confirm"] button')`));
  await show('page'); await click('page', '[data-testid="setup-cancel"] button');
  await choose('panel', 'en');

  // Hide/show is a lifecycle seam, independent of CSS used to compose screenshots.
  await evaluate(`qa.visible('status',false)`); const hiddenGets = await count('get');
  await evaluate(`qa.focus('status');qa.tick('status')`); await frames();
  check('hidden:no-language-read', hiddenGets === await count('get'));
  const visibleGets = await count('get');
  await evaluate(`qa.visible('status',true);qa.focus('status')`); await frames();
  check('focus-visible:coalesced-read', await count('get') === visibleGets + 1);

  // Open a retained preview, change only language, then copy the displayed text exactly.
  await show('panel');
  const listButton = '[data-testid="plan-view-list"] button';
  if (await guest<boolean>('panel', `return !!d.querySelector(${literal(listButton)})`)) await click('panel', listButton);
  await wait(inFrame('panel', `!!d.querySelector('[data-testid="item-toggle-I3"]')`), 'user task rendered');
  await click('panel', '[data-testid="item-toggle-I3"] > summary');
  await wait(inFrame('panel', `d.querySelector('[data-testid="item-toggle-I3"]').open`), 'task disclosure open');
  await unchanged('task-reading-external-language-only', () => choose('page', 'ru'));
  check('task-reading:external-language-preserves-disclosure', await guest<boolean>('panel', `return d.querySelector('[data-testid="item-toggle-I3"]').open`));
  check('task-reading:external-language-does-not-steal-focus', await guest<boolean>('page', `return d.hasFocus()`)
    && !await guest<boolean>('panel', `return d.hasFocus()`));
  await choose('page', 'en');
  check('task-reading:external-language-return-preserves-disclosure', await guest<boolean>('panel', `return d.querySelector('[data-testid="item-toggle-I3"]').open`));
  await unchanged('task-reading-language-only', () => choose('panel', 'ru'));
  check('task-reading:disclosure-and-user-text-preserved', await guest<boolean>('panel', `return d.querySelector('[data-testid="item-toggle-I3"]').open&&d.body.textContent.includes(${literal(USER_TASK_TITLE)})&&!w.__qaInjected`));
  await choose('panel', 'en');
  await click('panel', '[data-testid="task-copy-I3"]');
  await wait(inFrame('panel', `!!d.querySelector('[data-testid="task-copy-text-I3"]')`), 'task details preview');
  const taskText = () => guest<string>('panel', `return d.querySelector('[data-testid="task-copy-text-I3"]').value`);
  const taskEnglish = await taskText();
  check('task-copy:literal-user-text-preserved', taskEnglish.includes(USER_TASK_TITLE));
  await click('panel', '[data-testid="task-copy-confirm-I3"] button');
  await wait(`navigator.clipboard.readText().then(t=>t===${literal(taskEnglish)})`, 'task clipboard equals English preview');
  await guest('panel', `w.__qaTaskCopies=[];Object.defineProperty(w.navigator.clipboard,'writeText',{configurable:true,value:t=>new Promise(r=>{w.__qaTaskCopies.push(t);w.__qaReleaseTaskCopy=r})});return true`);
  await click('panel', '[data-testid="task-copy-confirm-I3"] button');
  await wait(inFrame('panel', `typeof w.__qaReleaseTaskCopy==='function'`), 'held task clipboard');
  await unchanged('task-copy-language-only', () => choose('page', 'ru'));
  const taskRussian = await taskText();
  check('task-copy:only-labels-translated', taskRussian !== taskEnglish && taskRussian.includes(USER_TASK_TITLE));
  check('task-copy:old-write-retains-old-text', await guest<boolean>('panel', `return w.__qaTaskCopies.length===1&&w.__qaTaskCopies[0]===${literal(taskEnglish)}`));
  const taskStatus = await guest<string>('panel', `return d.querySelector('[data-testid="task-copy-status-I3"]').textContent`);
  await guest('panel', `w.__qaReleaseTaskCopy();return true`); await frames();
  check('task-copy:late-feedback-cannot-confirm-translation', taskStatus === await guest<string>('panel', `return d.querySelector('[data-testid="task-copy-status-I3"]').textContent`));
  await guest('panel', `delete w.navigator.clipboard.writeText;return true`);
  await show('panel'); await click('panel', '[data-testid="task-copy-confirm-I3"] button');
  await wait(`navigator.clipboard.readText().then(t=>t===${literal(taskRussian)})`, 'task clipboard equals Russian preview');
  check('task-copy:clipboard-equals-Russian-preview', await evaluate('navigator.clipboard.readText()') === taskRussian);
  await click('panel', '[data-testid="task-copy-close-I3"] button');
  await choose('panel', 'en');
  await click('panel', '[data-testid="plan-actions"] button');
  await wait(inFrame('panel', `!!d.querySelector('[role="menuitem"][id$="-document"]')`), 'document action');
  await click('panel', '[role="menuitem"][id$="-document"]');
  await wait(inFrame('panel', `!!d.querySelector('[data-testid="document-text"]')`), 'captured document loaded');
  const documentText = await guest<string>('panel', `return d.querySelector('[data-testid="document-text"]').textContent`);
  await unchanged('open-document-language-only', () => choose('panel', 'ru'));
  check('document:user-text-safe-and-unchanged', await guest<boolean>('panel', `return d.querySelector('[data-testid="document-text"]')?.textContent===${literal(documentText)}&&!w.__apInjected`));
  await choose('panel', 'en');
  await click('panel', '[data-testid="plan-actions"] button');
  await wait(inFrame('panel', `!!d.querySelector('[role="menu"]')`), 'plan actions menu');
  await key('Home'); await key('Enter');
  await wait(inFrame('panel', `!!d.querySelector('[data-testid="summary-text"]')`), 'English preview');
  const text = () => guest<string>('panel', `return d.querySelector('[data-testid="summary-text"]').value`);
  const english = await text();
  const generation = () => guest<string>('panel', `return d.querySelector('[data-testid="summary-text"]').dataset.generation`);
  const englishGeneration = await generation();
  await guest('panel', `d.querySelector('[data-testid="summary-text"]').setSelectionRange(3,11);return true`);
  const previewSelection = () => guest<number[]>('panel', `const n=d.querySelector('[data-testid="summary-text"]');return [n.selectionStart,n.selectionEnd]`);
  check('preview:nonempty-selection-created', JSON.stringify(await previewSelection()) === '[3,11]');
  await unchanged('same-effective-language', () => choose('panel', 'auto'));
  check('same-effective-language:preview-generation-stable', english === await text() && englishGeneration === await generation());
  check('same-effective-language:preview-selection-preserved', JSON.stringify(await previewSelection()) === '[3,11]');
  await evaluate(`navigator.clipboard.writeText('synthetic clipboard sentinel')`);
  await unchanged('preview-language-only', () => choose('panel', 'ru'));
  const russian = await text();
  check('preview:translation-from-retained-snapshot', russian !== english && russian.includes(PUBLIC_TITLE) && englishGeneration !== await generation());
  const translatedSelection = await previewSelection();
  check('preview:changed-text-clears-selection', translatedSelection[0] === translatedSelection[1]);
  check('preview:no-auto-copy', await evaluate(`navigator.clipboard.readText()`) === 'synthetic clipboard sentinel');
  await click('panel', '[data-testid="summary-copy"]');
  await wait(`navigator.clipboard.readText().then(t=>t===${literal(russian)})`, 'clipboard equals displayed Russian');
  check('preview:copy-equals-display', await evaluate(`navigator.clipboard.readText()`) === russian);
  await guest('panel', `const cb=w.navigator.clipboard;w.__qaCopies=[];Object.defineProperty(cb,'writeText',{configurable:true,value:t=>new Promise(r=>{w.__qaCopies.push(t);w.__qaReleaseCopy=r})});return true`);
  await click('panel', '[data-testid="summary-copy"]');
  await wait(inFrame('panel', `typeof w.__qaReleaseCopy==='function'`), 'held clipboard write');
  await unchanged('held-copy-language-only', () => choose('page', 'en'));
  check('held-copy:captured-old-text', await guest<boolean>('panel', `return w.__qaCopies.length===1&&w.__qaCopies[0]===${literal(russian)}`));
  const statusBefore = await guest<string>('panel', `return d.querySelector('[data-testid="summary-status"]')?.textContent||''`);
  await guest('panel', `w.__qaReleaseCopy();return true`); await frames();
  check('held-copy:no-new-preview-success', statusBefore === await guest<string>('panel', `return d.querySelector('[data-testid="summary-status"]')?.textContent||''`));
  await guest('panel', `delete w.navigator.clipboard.writeText;return true`);

  for (const [s, width] of [['status', 190], ['panel', 280], ['page', 280]] as const) {
    await show(s, width); await choose('panel', 'ru'); await show(s, width);
    check(`${s}:${width}:no-horizontal-overflow`, await guest<boolean>(s, `return d.documentElement.scrollWidth<=d.documentElement.clientWidth+1`));
    await shot(`${s}-${width}-ru`);
    if (s !== 'status') for (const zoom of [2, 4]) {
      await show(s, 1280);
      await guest(s, `d.documentElement.style.zoom=${zoom};return true`); await frames();
      check(`${s}:${zoom * 100}percent:language-control-reflows`, await guest<boolean>(s, `const b=d.querySelector(${literal(trigger)}),r=b.getBoundingClientRect();return r.width>0&&r.left>=-1&&r.right<=w.innerWidth+1`));
      await shot(`${s}-reflow-${zoom * 100}`);
      await guest(s, `d.documentElement.style.zoom='';return true`);
    }
  }
  facts.storage = await evaluate(`({gets:qa.storageLog.filter(q=>q.key===${literal(LANGUAGE_KEY)}&&q.op==='get').length,sets:qa.storageLog.filter(q=>q.key===${literal(LANGUAGE_KEY)}&&q.op==='set').length,instanceLanguage:qa.storageLog.filter(q=>q.key===${literal(LANGUAGE_KEY)}&&q.scope!=='device').length})`);
  facts.serviceCounts = await evaluate(`Object.fromEntries([...new Set(qa.requests.map(q=>q.path))].map(p=>[p,qa.requests.filter(q=>q.path===p).length]))`);
  check('no-progress-mutations', await evaluate(`qa.requests.every(q=>q.method==='GET')`));
  check('no-runtime-exceptions-or-external-network', c.errors.length === 0);
} catch (error) {
  // Do not serialize raw browser exceptions, paths or host messages into public-safe artifacts.
  failure = error instanceof Error ? error.message.split('\n')[0].slice(0, 220) : 'QA failed';
  if (page) try { const png = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, 'failure.png'), Buffer.from(png.data, 'base64')); screenshots.push('failure.png'); } catch { /* Browser startup may have failed. */ }
} finally {
  page?.close(); browser?.close();
  if (chrome?.pid) {
    const exited = new Promise<void>((r) => { if (chrome!.exitCode !== null) r(); else chrome!.once('exit', () => r()); });
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 3000))]);
    if (chrome.exitCode === null) try { process.kill(-chrome.pid, 'SIGKILL'); } catch { chrome.kill('SIGKILL'); }
  }
  await fixture?.stop();
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  const report = { evidenceClass: 'synthetic SDK shell, pure service envelopes, three current guest bundles, disposable Chromium; refresh timers manually advanced', nativeHostProof: false, passed: !failure && results.every((r) => r.pass), failure, assertions: results.length, results, facts, screenshots };
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, assertions: results.length, failure, screenshots }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
