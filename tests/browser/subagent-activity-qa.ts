// Current-bundle Chromium QA of the sub-agents section over the synthetic fixture
// (tests/browser/subagent-activity-fixture.ts). Synthetic SDK workspace/service events; this is
// rendered-UI evidence, not native-host proof, screen-reader certification or installation.
// node --experimental-strip-types tests/browser/subagent-activity-qa.ts [CDP_PORT] [--fixture 47873] [--out DIR] [--only smoke]
// Without CDP_PORT it launches and later stops its own isolated headless Chromium (never downloads one).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fixturePort = Number(opt('--fixture') ?? 47873);
const out = opt('--out') ?? 'evidence/subagent-activity/screenshots';
const only = opt('--only');
mkdirSync(out, { recursive: true });

let chrome: ChildProcess | null = null;
let profile: string | null = null;
let cdpPort = Number(args[0]);
if (!Number.isInteger(cdpPort) || args[0]?.startsWith('--')) {
  const cache = join(homedir(), '.cache/ms-playwright');
  const candidates = [...(existsSync(cache) ? readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map((n) => join(cache, n, 'chrome-linux64/chrome')) : []), '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const executable = process.env.CHROMIUM_PATH ?? candidates.find(existsSync);
  if (!executable) throw new Error('No installed Chromium; pass a CDP port or CHROMIUM_PATH (this never downloads one).');
  mkdirSync('/tmp/opencode', { recursive: true });
  profile = mkdtempSync('/tmp/opencode/subagent-activity-qa-');
  chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore', detached: true });
  for (let n = 0; !existsSync(join(profile, 'DevToolsActivePort')) && n < 200; n++) await new Promise((r) => setTimeout(r, 50));
  cdpPort = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
}

const results: { id: string; pass: boolean; facts?: unknown }[] = [];
const remote: string[] = [];
const problems: string[] = [];
let ws: WebSocket | null = null;
const cleanup = () => {
  try { ws?.close(); } catch { /* closed */ }
  if (chrome?.pid) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* gone */ } }
  if (profile) rmSync(profile, { recursive: true, force: true });
};

try {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  ws = new WebSocket(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = () => reject(new Error('Browser connection failed.')); });
  let next = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)), p = pending.get(m.id);
    if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`.slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push(`console ${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
    if (m.method === 'Network.requestWillBeSent' && !/^(http:\/\/127\.0\.0\.1:|data:|about:)/.test(m.params.request.url)) remote.push(m.params.request.url);
  };
  const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'Browser expression failed');
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Network.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${fixturePort}/` });
  const guest = <T = any>(s: string, code: string) => evaluate<T>(`(()=>{const d=frame('${s}').contentDocument,w=d.defaultView;${code}})()`);
  const wait = async (s: string, condition: string, label = condition, ms = 15000) => {
    const ok = await evaluate(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{const d=frame('${s}').contentDocument;if(${condition})return true}catch{}await new Promise(r=>setTimeout(r,40))}return false})()`);
    if (!ok) {
      const seen = await evaluate(`(()=>{const d=frame('${s}').contentDocument,c=d.querySelector('[data-testid="subagent-activity"]');return c?{state:c.dataset.state,complete:c.dataset.complete,note:d.querySelector('[data-testid="subagent-coverage"]')?.textContent??null,rows:c.querySelectorAll('[data-testid^="observed-session-"]').length,subs:[...qa.subs.values()].filter(x=>x.surface==='${s}').map(x=>x.query.kind+':'+(x.query.projectId||''))}:{detail:(d.querySelector('[data-testid="plan-detail"]')??d.body).textContent.slice(0,400)}})()`).catch(() => null);
      throw new Error(`Timed out (${s}): ${label} · section ${JSON.stringify(seen)}`);
    }
  };
  const check = (id: string, pass: boolean, facts?: unknown) => { results.push({ id, pass, ...(facts === undefined ? {} : { facts }) }); if (!pass) throw new Error(`Failed: ${id} ${facts === undefined ? '' : JSON.stringify(facts)}`); };
  const KEYS: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, Home: 36, ArrowDown: 40 };
  const key = async (k: string, shift = false) => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: KEYS[k] ?? 0, modifiers: shift ? 8 : 0, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : type === 'keyDown' && k === ' ' ? { text: ' ' } : {}) });
  };
  const click = async (s: string, selector: string) => {
    const xy = await evaluate<[number, number]>(`(()=>{const f=frame('${s}'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)throw Error(${JSON.stringify(`Missing ${selector}`)});n.scrollIntoView({block:'center'});const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return [a.x+b.x+Math.min(12,a.width/2),a.y+b.y+a.height/2]})()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
  };
  const viewport = async (width: number, height = 1000) => { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); };
  const show = async (s: string, width = 360) => {
    await viewport(width > 600 ? Math.max(1200, width + 40) : width + 40, 1000);
    await evaluate(`qa.show('${s}',${width});true`);
    await wait(s, `d.defaultView.innerWidth===${width}`, `${s} width ${width}`);
  };
  /** Fits the frame to its content, checks there is no horizontal overflow, then captures the section. */
  /** `section`: clip to the sub-agents section of that surface instead of the whole frame. */
  const shot = async (s: string, name: string, maxHeight = 4000, section = false) => {
    // Settle the frame to its content: grow, let the guest relayout, measure main, repeat until stable.
    const fit = await evaluate<{ overflow: boolean; height: number }>(`(async()=>{const f=frame('${s}'),d=f.contentDocument,w=d.defaultView,r=d.documentElement;d.scrollingElement.scrollTop=0;const tick=()=>new Promise(x=>w.requestAnimationFrame(()=>w.requestAnimationFrame(x)));let h=0;f.style.height='${maxHeight}px';for(let i=0;i<5;i++){await tick();const m=Math.ceil(d.querySelector('main').getBoundingClientRect().height)+12;if(m===h)break;h=Math.min(${maxHeight},m);f.style.height=h+'px';}await tick();return {overflow:r.scrollWidth>r.clientWidth,height:h}})()`);
    check(`${name}: no horizontal overflow`, !fit.overflow, fit);
    // Room for the whole fitted frame, then measure with the outer page unscrolled.
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: Math.min(4400, fit.height + 200), deviceScaleFactor: 1, mobile: false });
    await evaluate('scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const rect = await evaluate<number[]>(section
      ? `(()=>{const f=frame('${s}'),o=f.getBoundingClientRect(),r=f.contentDocument.querySelector('[data-testid="subagent-activity"]').getBoundingClientRect();return [o.x+r.x-12,o.y+r.y-12,r.width+24,r.height+24]})()`
      : `(()=>{const r=document.querySelector('section[data-surface="${s}"]').getBoundingClientRect();return [r.x-8,r.y-8,r.width+16,r.height+16]})()`);
    await send('Emulation.setDeviceMetricsOverride', { width: Math.max(1200, Math.ceil(rect[0] + rect[2]) + 20), height: Math.ceil(rect[1] + rect[3]) + 20, deviceScaleFactor: 1, mobile: false });
    const img = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3], scale: 1 } });
    results.push({ id: `${name}: captured`, pass: true, facts: { frameHeight: fit.height, clip: rect.map(Math.round) } });
    writeFileSync(join(out, `${name}.png`), Buffer.from(img.data, 'base64'));
  };
  const text = (s: string, sel: string) => guest<string | null>(s, `return d.querySelector(${JSON.stringify(sel)})?.textContent??null`);
  const row = (id: string) => `[data-testid="subagent-activity"] [data-testid="observed-session-${id}"]`;
  const fact = (id: string, f: string) => `${row(id)} [data-fact="${f}"] dd`;
  const census = (s: string) => `[data-testid="subagent-activity"]`;
  const ids = (s: string) => guest<string[]>(s, `return [...d.querySelectorAll('[data-testid="subagent-activity"] [data-testid^="observed-session-"]')].map(n=>n.dataset.testid.slice(17)+':'+n.dataset.depth)`);

  /** Selects the page row of that source; the list can repaint under the pointer, so verify and retry. */
  const selectPlan = async (source: string) => {
    for (let i = 0; i < 4; i++) {
      await click('page', `[data-testid="plan-row-plan-alpha"][data-source="${source}"]`);
      const ok = await evaluate(`(async()=>{for(let i=0;i<40;i++){const a=frame('page').contentDocument.querySelector('[data-testid="plan-detail"] article');if(a?.dataset.source==='${source}')return true;await new Promise(r=>setTimeout(r,25))}return false})()`);
      if (ok) return;
    }
    throw new Error(`Could not select the ${source} plan`);
  };
  async function pageAndThemes() {
  // 5. Page: rooted in the selected plan's coordinator, independent of host selection.
  await evaluate(`qa.context('B');true`);
  await show('page', 1100);
  await wait('page', `d.querySelector('[data-testid="plan-row-plan-alpha"]')`, 'board');
  await selectPlan('src-local');
  await wait('page', `d.querySelector('[data-testid="plan-detail"] ${row('N1')}')`, 'page census');
  check('page root is the plan coordinator, not the host selection (B)', JSON.stringify(await ids('page')) === JSON.stringify(['A:0', 'C1:1', 'N1:2', 'C2:1']) && (await text('page', `${row('A')} .ap-obs-tag`)) === 'Main session');
  check('page labels live observation as now, not history', (await text('page', `${census('page')} > .ap-note`))!.includes('not part of the plan’s recorded history'));
  await evaluate(`qa.context(null);qa.context('A');qa.context('B');true`);
  await wait('page', `d.querySelector('[data-testid="plan-detail"] ${row('N1')}')`, 'page stable across host switches');
  check('page selection and root unchanged by host A/B/null', await guest('page', `return d.querySelector('[data-testid="plan-detail"] article').dataset.testid`) === 'plan-plan-alpha');
  await shot('page', 'page-children');
  await click('page', '[data-testid="detail-tabs"] [role="tab"]:nth-child(3)');
  await wait('page', `d.querySelector('[data-testid="revision-4"]')`, 'history');
  check('history tab keeps its own scope (no live census inside history)', await guest('page', `return !d.querySelector('[data-testid="plan-detail"] [data-testid="subagent-activity"]')`) === true);
  await shot('page', 'page-history');
  await click('page', '[data-testid="detail-tabs"] [role="tab"]:nth-child(1)');
  await selectPlan('src-other');
  await wait('page', `d.querySelector('[data-testid="other-source"]')`, 'foreign plan');
  check('foreign-source lookalike borrows no census or navigation', await guest('page', `return !d.querySelector('[data-testid="subagent-activity"]')`) === true);

  // Narrow page, dark theme and reduced motion.
  await selectPlan('src-local');
  await evaluate(`qa.dark();true`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await show('page', 390);
  await wait('page', `d.querySelector('[data-testid="plan-detail"] ${row('N1')}') && d.documentElement.dataset.ocTheme==='dark'`, 'dark narrow page');
  check('reduced motion: the census runs no animation', await guest('page', `return d.querySelector('[data-testid="subagent-activity"]').getAnimations({subtree:true}).length`) === 0);
  await shot('page', 'page-narrow-dark');
  await evaluate(`qa.context('A');true`);
  await show('status', 276);
  await wait('status', `d.querySelector('${row('C1')}')`);
  await shot('status', 'status-dark');
  await show('panel');
  await wait('panel', `d.querySelector('${row('C1')}')`);
  await shot('panel', 'rail-dark', 4000, true);

  }

  await evaluate(`(async()=>{for(let i=0;i<200&&!window.qa;i++)await new Promise(r=>setTimeout(r,25));return true})()`);
  for (const s of ['panel', 'status', 'page']) await wait(s, `d.querySelector('[data-testid="progress-root"]')`, `${s} mounted`);
  for (const s of ['panel', 'status']) await wait(s, `d.querySelector('[data-testid="unscoped-state"]')`, 'draft');
  if (only === 'page') { await pageAndThemes(); throw new Error('smoke-done'); }

  // 1. Selected A: parent, C1/C2, nested N1; B, B-child and the Beta lookalike never enter.
  await evaluate(`qa.context('A');true`);
  await show('panel');
  await wait('panel', `d.querySelector('${row('N1')}') && d.querySelector('${fact('C1', 'assignment')}')?.textContent.startsWith('Assigned')`, 'rail census with facts');
  check('realistic context: no integration link, census ready and current', await evaluate(`qa.connected`) === false && await guest('panel', `const c=d.querySelector('[data-testid="subagent-activity"]');return c.dataset.state==='ready'&&c.dataset.complete==='true'&&d.querySelector('${row('C1')} .ap-obs').dataset.state==='active'`) === true);
  check('rail census: A with C1, nested N1 and C2 only', JSON.stringify(await ids('panel')) === JSON.stringify(['A:0', 'C1:1', 'N1:2', 'C2:1']), await ids('panel'));
  const facts = await guest<Record<string, Record<string, string>>>('panel', `const o={};for(const r of d.querySelectorAll('[data-testid="subagent-activity"] [data-testid^="observed-session-"]')){const id=r.dataset.testid.slice(17);o[id]={title:r.querySelector('.ap-obs-title').textContent};for(const f of r.querySelectorAll('[data-fact]'))o[id][f.dataset.fact]=f.querySelector('dd').textContent;}return o`);
  check('separate facts: C1 assigned two (one from delegation), relayed update, running now', facts.C1.assignment === 'Assigned 2 tasks · 1 from its delegation' && facts.C1.update.startsWith('Update relayed by parent') && facts.C1.now.startsWith('Running'), facts.C1);
  check('restricted C2: visible, unassigned in this plan, no update, turn ended (no success claim)', facts.C2.assignment === 'Unassigned in this plan' && facts.C2.update === 'No update reported' && facts.C2.now.startsWith('Turn ended') && !/success|complete/i.test(facts.C2.now), facts.C2);
  check('nested N1: assigned, direct report, waiting for an answer', facts.N1.assignment === 'Assigned 1 task' && facts.N1.update.startsWith('Reported an update') && facts.N1.now.startsWith('Waiting for an answer'), facts.N1);
  check('HTML-looking title renders as literal text', facts.C2.title === '<b>Literal</b> & restricted reviewer' && await guest('panel', `return !d.querySelector('${row('C2')} b')`) === true);
  check('nesting is not colour-only: depth and aria-level', await guest('panel', `const n=d.querySelector('${row('N1')}');return n.getAttribute('aria-level')==='3'&&!!n.querySelector('.ap-sr')?.textContent.includes('Research helper')`) === true);
  check('Open only for children (current session has none)', await guest('panel', `return !d.querySelector('${row('A')} button')&&!!d.querySelector('${row('C1')} [data-testid="open-observed-C1"]')`) === true);
  const before = await guest('panel', `const c=d.querySelector('[data-testid="counts"]').dataset;return JSON.stringify(c)`);
  await shot('panel', 'rail-children');
  if (only === 'smoke') throw new Error('smoke-done');

  // Status 276 px: compact rows after the featured plan.
  await show('status', 276);
  await wait('status', `d.querySelector('${row('C2')}')`, 'status census');
  check('status: census follows the featured plan, never displaces it', await guest('status', `const p=d.querySelector('[data-testid="plan-plan-alpha"]'),c=d.querySelector('[data-testid="subagent-activity"]');return !!p&&!!c&&!!(p.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING)`) === true);
  check('status rows: short words', (await text('status', `${row('C2')} .ap-obs-sub`))!.startsWith('Unassigned here') && (await text('status', `${row('C1')} .ap-obs-label`)) === 'Running');
  await shot('status', 'status-children');

  // 2. Pure observation changes nothing reported.
  await evaluate(`qa.set('C1',{activity:'idle',outcome:'failed'});qa.set('N1',{activity:'running'});true`);
  await show('panel');
  await wait('panel', `d.querySelector('${fact('C1', 'now')}')?.textContent.startsWith('Turn failed')`, 'C1 turn failed');
  check('observation changes no totals or task facts', before === await guest('panel', `return JSON.stringify(d.querySelector('[data-testid="counts"]').dataset)`) && (await text('panel', fact('C1', 'assignment'))) === 'Assigned 2 tasks · 1 from its delegation');
  await evaluate(`qa.set('C1',{activity:'running',outcome:null});qa.set('N1',{activity:'waiting-question'});true`);
  await wait('panel', `d.querySelector('${fact('C1', 'now')}')?.textContent.startsWith('Running')`);

  // Keyboard: reach C1's Open by Tab, focus survives an observation repaint, Enter opens it.
  await guest('panel', `d.querySelector('${row('A')}').closest('section').querySelector('h2').setAttribute('tabindex','-1');d.querySelector('${row('A')}').closest('section').querySelector('h2').focus();return true`);
  await key('Tab');
  check('Tab reaches the first child Open control', await guest('panel', `return d.activeElement?.dataset.testid`) === 'open-observed-C1');
  await evaluate(`qa.set('C2',{title:'Restricted reviewer (renamed)'});true`);
  await wait('panel', `d.querySelector('${row('C2')} .ap-obs-title')?.textContent.includes('renamed')`, 'repaint');
  check('focus survives refresh without scrolling', await guest('panel', `return d.activeElement?.dataset.testid`) === 'open-observed-C1');
  await key('Enter');
  await evaluate(`(async()=>{for(let i=0;i<50&&!qa.opened.length;i++)await new Promise(r=>setTimeout(r,20));return true})()`);
  check('keyboard Enter opens that child, nothing else navigates on refresh', JSON.stringify(await evaluate('qa.opened')) === JSON.stringify([{ surface: 'panel', id: 'C1' }]));

  // 3. Freshness: title-only, unchanged, other-child updates and the host's loading → ready reloads of the
  //    same subscription do not renew C1; after 60 s it is unknown.
  check('C1 fresh before expiry', (await guest<string>('panel', `return d.querySelector('${row('C1')} .ap-obs').dataset.state`)) === 'active');
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 10_500));
    await evaluate(i % 3 === 0 ? `qa.set('C1',{title:'Research helper ${i}'});true` : i % 3 === 1 ? `qa.reload();true` : `qa.set('C2',{activity:${i % 2 ? "'idle'" : "'running'"}});true`);
  }
  await wait('panel', `d.querySelector('${row('C1')} .ap-obs')?.dataset.state==='unknown'`, 'C1 unknown after 60 s', 20_000);
  const stale = await text('panel', fact('C1', 'now'));
  check('silent C1 turns unknown, keeping its last observation and time', /^Unknown now·?\s?last seen running/.test(stale!.replace(/\s+/g, ' ')) || stale!.startsWith('Unknown now'), stale);
  check('recently changed C2 stays current', (await guest<string>('panel', `return d.querySelector('${row('C2')} .ap-obs').dataset.state`)) !== 'unknown');
  await shot('panel', 'unknown-stale', 4000, true);
  // Reloads after expiry keep it unknown; the rows never vanish during a reload.
  await evaluate(`qa.reload();qa.reload();true`);
  await new Promise((r) => setTimeout(r, 400));
  check('loading → ready reload after expiry: rows kept, C1 still unknown', (await ids('panel')).length === 4 && (await guest<string>('panel', `return d.querySelector('${row('C1')} .ap-obs').dataset.state`)) === 'unknown');
  await evaluate(`qa.set('C1',{activity:'running'});true`);
  await new Promise((r) => setTimeout(r, 400));
  check('an unchanged running value is not a new observation', (await guest<string>('panel', `return d.querySelector('${row('C1')} .ap-obs').dataset.state`)) === 'unknown');
  await evaluate(`qa.set('C1',{activity:'idle'});true`);
  await wait('panel', `d.querySelector('${row('C1')} .ap-obs')?.dataset.state==='idle'`, 'genuine change renews');
  check('a genuine activity change renews C1', (await text('panel', fact('C1', 'now')))!.startsWith('Idle · seen just now'));

  // Lost coverage: immediately not current, distinct from an empty census; restored coverage re-observes.
  await evaluate(`qa.ws.coverage['proj-alpha']=[{directory:'/fixture/Alpha',state:'loading'}];qa.push('sessions');true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-coverage"]')?.dataset.gaps==='coverage'`, 'coverage gap');
  check('partial coverage: may be incomplete and nothing current', await guest('panel', `return [...d.querySelectorAll('${census('panel')} .ap-obs')].every(n=>n.dataset.state==='unknown')`) === true, await text('panel', '[data-testid="subagent-coverage"]'));
  await evaluate(`qa.ws.coverage['proj-alpha']=[{directory:'/fixture/Alpha',state:'ready'}];qa.set('C1',{activity:'idle'});qa.set('C1',{activity:'running'});true`);
  await wait('panel', `!d.querySelector('[data-testid="subagent-coverage"]') && d.querySelector('${row('C1')} .ap-obs')?.dataset.state==='active'`, 'coverage restored and re-observed');
  // The integration link is not host transport: linking and unlinking an account changes nothing here.
  for (const linked of [true, false]) {
    await evaluate(`qa.connection(${linked});true`);
    await new Promise((r) => setTimeout(r, 400));
    check(`integration link ${linked ? 'on' : 'off'}: census and activity unchanged`, await guest('panel', `const c=d.querySelector('[data-testid="subagent-activity"]');return c.dataset.state==='ready'&&c.dataset.complete==='true'&&!d.querySelector('[data-testid="subagent-coverage"]')&&d.querySelector('${row('C1')} .ap-obs').dataset.state==='active'`) === true);
  }
  check('no copy claims OpenChamber is disconnected', await guest('panel', `return !/disconnected/i.test(d.querySelector('[data-testid="subagent-activity"]').textContent)`) === true);
  await evaluate(`qa.ws.state['proj-alpha']='error';qa.push('sessions');true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-activity"]')?.dataset.state==='unavailable' && !d.querySelector('${row('C1')}')`, 'refused stream');
  check('refused stream says unavailable, never an empty census', (await text('panel', '[data-testid="subagent-coverage"]'))!.startsWith('Sub-agents can’t be listed right now'));
  await evaluate(`qa.ws.state['proj-alpha']='ready';qa.push('sessions');true`);
  await wait('panel', `d.querySelector('${row('C1')} .ap-obs')?.dataset.state==='active'`, 'stream ready again');

  // 4. A → B → null → A: no leaked rows; B with no plan keeps its observed child.
  await evaluate(`qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]') && d.querySelector('${row('B-child')}')`, 'B census');
  check('B: only its own child; no A rows leak', JSON.stringify(await ids('panel')) === JSON.stringify(['B:0', 'B-child:1']));
  check('no reported plan: observed child, no assignment claim', (await text('panel', fact('B-child', 'assignment'))) === 'Observed child · no task assignment recorded here' && !(await guest('panel', `return !!d.querySelector('${row('B-child')} [data-fact="update"]')`)));
  await show('status', 276);
  await wait('status', `d.querySelector('[data-testid="empty-state"]') && d.querySelector('${row('B-child')}')`, 'status B');
  check('status: no-plan message keeps the observed child', (await text('status', `${row('B-child')} .ap-obs-sub`)) === 'No task recorded here');
  await shot('status', 'status-no-plan');
  await evaluate(`qa.context(null);true`);
  for (const s of ['panel', 'status']) await wait(s, `d.querySelector('[data-testid="unscoped-state"]') && !d.querySelector('[data-testid="subagent-activity"]')`, `${s} draft`);
  check('draft has no census and starts no plan reads', await evaluate(`qa.requests.filter(q=>q.surface!=='page'&&q.context===null&&q.path.startsWith('/v1/plan')).length`) === 0);
  await evaluate(`qa.context('A');true`);
  await show('panel');
  await wait('panel', `d.querySelector('${row('N1')}')`, 'back to A');
  check('A again: exactly its own descendants', JSON.stringify(await ids('panel')) === JSON.stringify(['A:0', 'C1:1', 'N1:2', 'C2:1']));
  await shot('panel', 'unassigned-nested', 4000, true);

  // Identity conflict: C1 claims another project → C1 and nested N1 leave, with no Open; C2 stays.
  await evaluate(`qa.set('C1',{projectId:'proj-beta'});true`);
  await wait('panel', `!d.querySelector('${row('C1')}') && !d.querySelector('${row('N1')}') && d.querySelector('${row('C2')}') && d.querySelector('[data-testid="subagent-coverage"]')?.dataset.gaps==='conflict'`, 'conflicting subtree left out');
  check('descendant identity conflict: subtree omitted, no navigation, incomplete', await guest('panel', `return !d.querySelector('[data-testid="open-observed-C1"]')&&!d.querySelector('[data-testid="open-observed-N1"]')&&d.querySelector('[data-testid="subagent-activity"]').dataset.complete==='false'`) === true, await text('panel', '[data-testid="subagent-coverage"]'));
  await evaluate(`qa.set('C1',{projectId:'proj-alpha'});true`);
  await wait('panel', `d.querySelector('${row('N1')}') && !d.querySelector('[data-testid="subagent-coverage"]')`, 'conflict cleared');
  // Cycle through the selected root: B's parent is its own child → no descendant rows, said plainly.
  await evaluate(`qa.set('B',{parentId:'B-child'});qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-coverage"]')?.dataset.gaps==='cycle' && d.querySelector('${row('B')}') && !d.querySelector('${row('B-child')}')`, 'cyclic root');
  check('root/child cycle: no descendant exposed, incomplete, loop explained', (await text('panel', '[data-testid="subagent-coverage"]'))!.includes('loop back') && await guest('panel', `return d.querySelector('[data-testid="subagent-activity"]').dataset.complete==='false'`) === true);
  await evaluate(`qa.set('B',{parentId:null});qa.context('A');true`);
  await wait('panel', `d.querySelector('${row('N1')}') && !d.querySelector('[data-testid="subagent-coverage"]')`, 'back to A after cycle');

  // Overflow: bounded rows with an accessible disclosure; open state survives a repaint.
  await evaluate(`for(let i=1;i<=9;i++)qa.ws.sessions['proj-alpha'].push({id:'W'+i,title:'Batch worker '+i,projectId:'proj-alpha',directory:'/fixture/Alpha',parentId:'A',createdAt:10+i,updatedAt:0,archivedAt:null,worktree:null,activity:i%2?'running':'idle',outcome:null,items:[]});qa.push('sessions');true`);
  await wait('panel', `d.querySelector('[data-testid="observed-more"] summary')?.textContent==='4 more sub-agents'`, 'overflow disclosure');
  check('rail shows 8 sub-agents then names the rest', (await ids('panel')).length === 1 + 12 && await text('panel', '[data-testid="subagent-count"]') === '12 seen');
  await guest('panel', `d.querySelector('[data-testid="observed-more"] summary').focus();return true`);
  await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="observed-more"]').open`, 'disclosure opened by keyboard');
  await evaluate(`qa.set('W9',{activity:'running'});true`);
  await wait('panel', `d.querySelector('[data-testid="observed-more"]')?.open && d.activeElement?.tagName==='SUMMARY'`, 'disclosure and focus kept across repaint');
  check('disclosure opens by keyboard and stays open with focus through refresh', true);
  await show('status', 276);
  await wait('status', `d.querySelector('[data-testid="observed-more"] summary')`, 'status overflow');
  check('status bounded to 3 rows plus disclosure, featured plan intact', (await text('status', '[data-testid="observed-more"] summary')) === '9 more sub-agents' && await guest('status', `return !!d.querySelector('[data-testid="plan-plan-alpha"]')`) === true);
  await shot('status', 'status-overflow');

  // Capture off: host observations remain, plainly labelled; recorded tasks stay last reported.
  await evaluate(`qa.capture=false;true`);
  await show('panel');
  await wait('panel', `d.querySelector('[data-testid="subagent-capture-off"]')`, 'capture-off note', 20_000);
  check('capture off keeps observations and says no new task links', (await ids('panel')).length > 4 && (await text('panel', fact('C1', 'assignment')))!.startsWith('Assigned 2'));
  await shot('panel', 'capture-off', 4000, true);
  await evaluate(`qa.capture=true;qa.ws.sessions['proj-alpha']=qa.ws.sessions['proj-alpha'].filter(s=>!s.id.startsWith('W'));qa.push('sessions');true`);
  await wait('panel', `!d.querySelector('[data-testid="subagent-capture-off"]') && !d.querySelector('[data-testid="observed-more"]')`, 'capture back on', 20_000);

  await pageAndThemes();

  check('no console errors or exceptions', problems.length === 0, problems);
  check('no non-loopback requests', remote.length === 0, remote);
  const summary = { passed: true, evidenceClass: 'synthetic SDK workspace/service fixture, real Chromium, current built guests', nativeHostProof: false, checks: results.length, results };
  writeFileSync(join(out, '..', 'ui-qa.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, checks: results.length }, null, 2));
} catch (error) {
  if ((error as Error).message === 'smoke-done') console.log(JSON.stringify({ smoke: true, results }, null, 2));
  else { console.error(JSON.stringify({ passed: false, error: (error as Error).message, results: results.slice(-5), problems: problems.slice(0, 5) }, null, 2)); process.exitCode = 1; }
} finally { cleanup(); }
