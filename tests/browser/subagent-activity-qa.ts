// Chromium QA of the sub-agents section (runs revision 1) over the synthetic fixture
// (tests/browser/subagent-activity-fixture.ts). Synthetic SDK workspace/service events; this is
// rendered-UI evidence, not native-host proof, screen-reader certification or installation.
// Usage: subagent-activity-qa.ts --source --chromium <binary> --artifacts <dir> [--only indicator]
// --source starts/stops its own source-built fixture; otherwise build:all first and pass --fixture.
// Without CDP_PORT it starts/stops isolated headless Chromium (never downloads or uses a live profile).
import { javascriptLiteral } from '../../shared/javascript-literal.ts';
import { progressInput } from './progress-qa.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { verifyIncompleteCounts } from './incomplete-counts-qa.ts';
import { internalCopy } from './interface-copy.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
let fixturePort = Number(opt('--fixture') ?? 47873);
const out = opt('--artifacts') ?? opt('--out') ?? 'evidence/subagent-run-tracking/browser';
const only = opt('--only');
mkdirSync(out, { recursive: true });

let chrome: ChildProcess | null = null;
let profile: string | null = null;
let fixture: ChildProcess | null = null;
let cdpPort = Number(args[0]);
if (!Number.isInteger(cdpPort) || args[0]?.startsWith('--')) {
  const cache = join(homedir(), '.cache/ms-playwright');
  const candidates = [...(existsSync(cache) ? readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map((n) => join(cache, n, 'chrome-linux64/chrome')) : []), '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const executable = opt('--chromium') ?? process.env.CHROMIUM_PATH ?? candidates.find(existsSync);
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
const cleanup = async () => {
  try { ws?.close(); } catch { /* closed */ }
  if (fixture && fixture.exitCode === null) { const stopped = once(fixture, 'exit'); fixture.kill('SIGTERM'); await stopped; }
  if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = once(chrome, 'exit');
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* already exiting */ }
    await exited;
  }
  if (profile) rmSync(profile, { recursive: true, force: true });
};

try {
  if (args.includes('--source') && !opt('--fixture')) {
    fixture = spawn(process.execPath, ['--experimental-strip-types', 'tests/browser/subagent-activity-fixture.ts', '0', '--source'], { stdio: ['ignore', 'pipe', 'inherit'] });
    fixturePort = await new Promise<number>((resolve, reject) => {
      let text = '';
      fixture!.stdout!.on('data', chunk => { text += String(chunk); const match = /ready on loopback port (\d+)/.exec(text); if (match) resolve(Number(match[1])); });
      fixture!.once('exit', code => reject(Error(`Fixture exited: ${code}`)));
    });
  }
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
      const seen = await evaluate(`(()=>{const d=frame('${s}').contentDocument,c=d.querySelector('[data-testid="subagent-activity"]');return {state:c?.dataset.state,text:c?.textContent.slice(0,400),indicator:d.querySelector('[data-testid="incomplete-counts"]')?.dataset.reasons,more:d.querySelector('[data-testid="incomplete-counts-more"]')?.textContent,error:d.querySelector('[data-testid="incomplete-counts-load-error"]')?.textContent,reads:qa.requests.filter(q=>q.surface==='${s}'&&q.path==='/v1/subagent-runs').slice(-4).map(q=>q.query)}})()`).catch(() => null);
      throw new Error(`Timed out (${s}): ${label} · section ${JSON.stringify(seen)}`);
    }
  };
  const check = (id: string, pass: boolean, facts?: unknown) => { results.push({ id, pass, ...(facts === undefined ? {} : { facts }) }); if (!pass) throw new Error(`Failed: ${id} ${facts === undefined ? '' : JSON.stringify(facts)}`); };
  const KEYS: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, Home: 36, ArrowDown: 40 };
  const key = async (k: string, shift = false) => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: KEYS[k] ?? 0, modifiers: shift ? 8 : 0, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : type === 'keyDown' && k === ' ' ? { text: ' ' } : {}) });
  };
  const click = async (s: string, selector: string) => {
    const xy = await evaluate<[number, number]>(`(async()=>{const f=frame('${s}'),d=f.contentDocument,n=d.querySelector(${javascriptLiteral(selector)});if(!n)throw Error(${javascriptLiteral(`Missing ${selector}`)});n.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const a=d.querySelector(${javascriptLiteral(selector)}).getBoundingClientRect(),b=f.getBoundingClientRect();return [a.x+b.x+Math.min(12,a.width/2),a.y+b.y+a.height/2]})()`);
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
  const text = (s: string, sel: string) => guest<string | null>(s, `return d.querySelector(${javascriptLiteral(sel)})?.textContent??null`);
  const sec = '[data-testid="subagent-activity"]';
  const progressUi = progressInput({ guest, wait, click });
  const row = (session: string) => `${sec} [data-session="${session}"]`;
  const fact = (session: string, f: string) => `${row(session)} [data-fact="${f}"]`;
  const has = (s: string, sel: string) => guest<boolean>(s, `return !!d.querySelector(${javascriptLiteral(sel)})`);
  /** The lead count line and the counts inside Show more, part by part. */
  const lineParts = (s: string, scope = '') => guest<{ lead: string[]; later: string[] }>(s, `const t=k=>[...d.querySelectorAll(${javascriptLiteral(scope)}+' [data-testid="'+k+'"] .ap-sub-part')].map(n=>n.textContent);return {lead:t('subagent-count'),later:t('subagent-count-more')}`);
  const sectionText = (s: string) => guest<string>(s, `return (d.querySelector('${sec}')?.textContent??'').replace(/\\s+/g,' ')`);
  const runRequests = (root: string) => evaluate<number>(`qa.requests.filter(q=>q.path.startsWith('/v1/subagent-runs')&&(q.query?.root===${javascriptLiteral(root)}||q.method==='POST')).length`);
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  /** One activation, then the selected reading's accepted complete detail. */
  const selectPlan = async (source: string, id = 'plan-alpha') => {
    await click('page', `[data-testid="plan-row-${id}"][data-source="${source}"]`);
    await progressUi.list('page', { id, source });
    await wait('page', `d.querySelector('article[data-testid="plan-${id}"][data-source="${source}"] .ap-tasks[data-complete]')`, 'selected complete reading');
  };
  /** Clutter the owner reported must never come back. */
  const noClutter = async (s: string, label: string) => {
    const t = await sectionText(s);
    check(`${label}: no unassigned/no-update/root/seen-just-now/cap-warning lines`, !/Unassigned|No update reported|This session|Main session|seen just now|only the first|may be incomplete/i.test(t), t.slice(0, 300));
  };

  await evaluate(`(async()=>{for(let i=0;i<200&&!window.qa;i++)await new Promise(r=>setTimeout(r,25));return true})()`);
  for (const s of ['panel', 'status', 'page']) await wait(s, `d.querySelector('[data-testid="progress-root"]')`, `${s} mounted`);
  for (const s of ['panel', 'status']) await wait(s, `d.querySelector('[data-testid="unscoped-state"]')`, 'draft');

  if (only !== 'indicator') {
  // 1. Rail, plan in scope: Ran / Claimed / Accepted on featured rows only.
  await evaluate(`qa.context('A');true`);
  await show('panel');
  // Run facts and host activity arrive separately; wait for both (N1's host-reported wait).
  await wait('panel', `d.querySelector('${fact('C2', 'accepted')}') && d.querySelector('${row('N1')}')?.dataset.ran==='waiting' && d.querySelector('[data-testid="subagent-count"]')`, 'rail roster');
  const featured = await guest<string[]>('panel', `return [...d.querySelectorAll('${sec} > .ap-obs-list > li')].map(n=>n.dataset.session+':'+n.dataset.ran)`);
  check('rail features only running children; waiting and task-linked records remain reachable', JSON.stringify(featured) === JSON.stringify(['C1:active']) && await guest('panel', `return !!d.querySelector('[data-testid="observed-more"] ${row('N1')},[data-testid="observed-more"] [data-session="N1"]')&&!!d.querySelector('[data-testid="observed-more"] [data-session="C2"]')`), featured);
  await progressUi.records('panel');
  // The line leads with what matters now; finished and unknown open Show more, with the same words and marks.
  check('summary parts', JSON.stringify(await lineParts('panel')) === JSON.stringify({ lead: ['1+ waiting for you', '1+ running', '1 failed', '1 interrupted'], later: ['4 finished', '1 unknown'] }), await lineParts('panel'));
  const c1 = (await text('panel', fact('C1', 'ran')))!.replace(/\s+/g, ' ');
  check('C1 run: Running with its real host start, not a receipt', /^RunRunning · started 4 minutes ago$/.test(c1), c1);
  check('N1 Ran: waiting for an answer (host activity on an open run)', (await text('panel', fact('N1', 'ran')))!.includes('Waiting for an answer'));
  const c2 = { ran: await text('panel', fact('C2', 'ran')), claimed: await text('panel', fact('C2', 'claimed')), accepted: await text('panel', fact('C2', 'accepted')) };
  check('C2: finished run, child says done, task still blocked', /^RunFinished · \d+ minutes ago · took 3 min$/.test(c2.ran!.replace(/\s+/g, ' ')) && c2.claimed!.startsWith('Sub-agentsays done') && c2.claimed!.includes('<i>wording</i>') && c2.accepted === 'Task stateTask blocked: Review the release note', c2);
  check('literal markup in description and claim', await guest('panel', `const r=d.querySelector('${row('C2')}');return !r.querySelector('b,i')&&r.querySelector('.ap-obs-title').textContent==='<b>Review</b> the release note'`) === true);
  check('no child-claim line without that fact (C1 has no claim)', !(await has('panel', fact('C1', 'claimed'))) && (await text('panel', fact('C1', 'accepted'))) === 'Task state2 tasks: 1 done, 1 in progress');
  await noClutter('panel', 'rail');
  check('complete history: no coverage line, Partial cue or cap warning at all', !(await has('panel', '[data-testid="subagent-coverage"]')) && !(await has('panel', '[data-testid="subagent-coverage-cue"]')) && await has('panel', '[data-testid="info-trigger"][aria-label="About sub-agent records"]'));
  await click('panel', '[data-testid="info-trigger"][aria-label="About sub-agent records"]');
  check('record meanings reachable by accessible info', await guest('panel', `const b=d.querySelector('[aria-label="About sub-agent records"]'),n=d.getElementById(b.getAttribute('aria-controls'));return b.getAttribute('aria-expanded')==='true'&&n.textContent.includes('tracks runs, not task completion')&&n.textContent.includes('its own account')&&n.textContent.includes('task’s state is separate')`));
  await evaluate(`qa.context('A');true`);
  await guest('panel', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  check('roster info survives same-reading repaint', await guest('panel', `return d.querySelector('[aria-label="About sub-agent records"]')?.getAttribute('aria-expanded')==='true'`));
  await evaluate(`qa.context(null);true`);
  await wait('panel', `!d.querySelector('[data-testid="subagent-activity"]')`, 'retired rail reading');
  await evaluate(`qa.context('A');true`);
  await wait('panel', `d.querySelector('[aria-label="About sub-agent records"]')&&d.querySelector('${row('N1')}')?.dataset.ran==='waiting'`, 'returned roster reading');
  check('roster info does not resurrect after reading retirement', await guest('panel', `return d.querySelector('[aria-label="About sub-agent records"]')?.getAttribute('aria-expanded')==='false'`));
  await key('Escape');
  await shot('panel', 'rail-mixed', 4000, true);

  // Keyboard: Tab reaches an Open control; focus survives a repaint; Enter opens that child.
  await progressUi.records('panel');
  await guest('panel', `w.focus();d.querySelector('${row('N1')} details > summary').focus();return true`);
  for(let n=0;n<8;n++) { await key('Tab'); if(await guest('panel', `return d.activeElement?.dataset.testid==='open-observed-N1'`)) break; }
  const firstOpen = await guest<string>('panel', `return d.activeElement?.dataset.testid`);
  check('Tab reaches the first featured Open control', firstOpen === 'open-observed-N1', firstOpen);
  await evaluate(`qa.set('C2',{title:'Restricted reviewer (renamed)'});true`);
  await settle();
  check('focus survives a host refresh', await guest('panel', `return d.activeElement?.dataset.testid`) === 'open-observed-N1');
  await key('Enter');
  await evaluate(`(async()=>{for(let i=0;i<50&&!qa.opened.length;i++)await new Promise(r=>setTimeout(r,20));return true})()`);
  check('keyboard Enter opens that child only', JSON.stringify(await evaluate('qa.opened')) === JSON.stringify([{ surface: 'panel', id: 'N1' }]));

  // 2. Earlier disclosure: failed/interrupted rows, then the history page on request.
  await click('panel', '[data-testid="observed-more"] > summary');
  await guest('panel', `d.querySelector('[data-testid="observed-more"] summary').focus();return true`);
  await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="observed-more"]').open && d.querySelector('[data-testid="observed-more"] [data-ran="failed"]')`, 'earlier list opened by keyboard');
  check('records summary counts all nonrunning records', (await text('panel', '[data-testid="observed-more"] > summary')) === 'Show more · 8');
  check('opened Show more leads with the finished and unknown counts', await guest('panel', `const m=d.querySelector('[data-testid="observed-more"]'),c=m.querySelector(':scope > [data-testid="subagent-count-more"]');return !!c&&c.checkVisibility()&&c.previousElementSibling===m.querySelector('summary')&&c.textContent==='4 finished1 unknown'`));
  await progressUi.records('panel');
  const earlier = await guest<string[]>('panel', `return [...d.querySelectorAll('[data-testid="observed-more"] li')].map(n=>n.querySelector('[data-fact="ran"] .ap-obs-label').textContent)`);
  check('failed and interrupted stay distinct from finished', earlier.includes('Failed: SyntheticFailure') && earlier.includes('Interrupted: stopped by the user') && earlier.filter((x) => x === 'Finished').length === 3, earlier);
  await shot('panel', 'failed-interrupted', 4000, true);
  const historyBefore = await runRequests('A');
  await guest('panel', `d.querySelector('[data-testid="subagent-more"]').focus();return true`);
  await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="observed-more"] [data-session="OLD1"]')`, 'history page loaded on request');
  check('history rows only on explicit request', (await runRequests('A')) > historyBefore && await evaluate(`qa.requests.some(q=>q.query?.view==='history')`) === true);
  const old = (await text('panel', `[data-testid="observed-more"] [data-session="OLD1"] .ap-obs`))!;
  check('historical session: outcome unknown with its honest two-day-old time', /^Outcome unknown · 2 days ago$/.test(old.replace(/\s+/g, ' ')), old);
  check('historical row labelled as session history', (await text('panel', `[data-testid="observed-more"] [data-session="OLD1"] .ap-obs`))!.length > 0 && await guest('panel', `return d.querySelector('[data-testid="observed-more"] [data-session="OLD1"] .ap-obs').title.includes('session history')`) === true);
  await shot('panel', 'historical-unknown', 4000, true);
  // Old activity stays old after A → B → A and host reloads (no receipt time anywhere).
  await evaluate(`qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'B');
  await evaluate(`qa.context('A');qa.reload();true`);
  await wait('panel', `d.querySelector('${row('C2')}')`, 'A again');
  await settle(600);
  check('A→B→A + reload: C2 still finished 9+ minutes ago, never just now', /\d+ minutes ago/.test((await text('panel', fact('C2', 'ran')))!) && !/just now/.test(await sectionText('panel')));

  // 3. Defect A: no plan in scope → no section, count or request, with two host children (one running).
  const before = await runRequests('B');
  await evaluate(`qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'B no plan');
  await settle(3500);
  check('no plan (B, two children, one running): no section and no count on the rail', !(await has('panel', sec)) && !(await has('panel', '[data-testid="subagent-count"]')));
  check('no plan: no sub-agent-only read or reconciliation starts', (await runRequests('B')) === before);
  await shot('panel', 'no-plan-two-children');
  await show('status', 280);
  await wait('status', `d.querySelector('[data-testid="empty-state"]')`, 'status B');
  check('no plan: Work Status has no section either', !(await has('status', sec)));
  // A child session without a plan (E1) and a helper child with a plan but no sub-agents (C2).
  await show('panel');
  await evaluate(`qa.context('E1');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'E1 no plan');
  check('child without a plan: no section, no root row', !(await has('panel', sec)));
  await evaluate(`qa.context('C2');true`);
  await wait('panel', `d.querySelector('[data-testid="plan-plan-alpha"]')`, 'C2 helping plan');
  await settle(800);
  check('helper child with a plan but no sub-agents: plan shown, no empty sub-agent section', !(await has('panel', sec)));
  await shot('panel', 'child-empty');

  // 4. Plan → no plan with held replies: nothing reappears and nothing continues.
  await evaluate(`qa.context('A');true`);
  await wait('panel', `d.querySelector('${row('C1')}')`, 'A');
  await evaluate(`qa.hold=true;true`);
  await evaluate(`(async()=>{const n=qa.held.length;for(let i=0;i<100&&qa.held.length===n;i++)await new Promise(r=>setTimeout(r,50));return true})()`);
  await evaluate(`qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]') && !d.querySelector('${sec}')`, 'switched to no plan');
  const afterSwitch = await runRequests('A');
  await evaluate(`qa.hold=false;qa.release();true`);
  await settle(1500);
  check('held replies after plan → no plan: no section, no further run reads', !(await has('panel', sec)) && (await runRequests('A')) === afterSwitch);

  // 5. Work Status is a five-line summary, never a second sub-agent roster.
  // Keep the many-child roster and disclosure checks on the rail, where they still exist.
  await evaluate(`qa.context('M');true`);
  await show('status', 280);
  await wait('status', `d.querySelector('[data-testid="status-plan-title"]')?.textContent==='Data migration sweep' && d.querySelector('[data-testid="status-activity"]')`, 'five-line status for many children');
  check('Status keeps activity without roster or disclosure rows', await guest('status', `return d.querySelector('[data-testid="status-activity"]').textContent.includes('running')&&!d.querySelector('${sec},[data-testid="observed-more"],[data-testid="subagent-count"]')&&!!d.querySelector('[data-testid="counts"]')`));
  await shot('status', 'status-213');
  await show('panel', 390);
  await wait('panel', `d.querySelector('${row('M-live')}') && d.querySelector('[data-testid="subagent-count"]')`, 'rail 213');
  const many = await lineParts('panel');
  check('213 children: compact truthful summary, running and interrupted first', JSON.stringify(many) === JSON.stringify({ lead: ['1+ running', '4 failed', '2 interrupted'], later: ['205 finished', '1 unknown'] }), many);
  check('213 children: finished and unknown wait behind the closed Show more', await guest('panel', `const m=d.querySelector('[data-testid="observed-more"]');return !m.open&&!m.querySelector('[data-testid="subagent-count-more"]').checkVisibility()`));
  check('213 children: one featured row, the rest folded', (await guest<number>('panel', `return d.querySelectorAll('${sec} > .ap-obs-list > li').length`)) === 1 && (await text('panel', '[data-testid="observed-more"] summary')) === 'Show more · 212');
  check('213 children: no repeated coverage line in the roster', !(await has('panel', '[data-testid="subagent-coverage"]')));
  await noClutter('panel', 'rail 213');
  await click('panel', `${row('M-live')} details > summary`);
  await wait('panel', `d.querySelector('${row('M-live')} details')?.open`, 'rail roster disclosure opens');
  check('rail roster disclosure exposes real run facts', await has('panel', fact('M-live', 'ran')));
  await click('panel', `${row('M-live')} details > summary`);
  await wait('panel', `!d.querySelector('${row('M-live')} details')?.open`, 'rail roster disclosure closes');
  // The lead line at 320 px: one short row of current counts, the rest one disclosure away.
  await show('panel', 320);
  await wait('panel', `d.querySelector('${row('M-live')}') && d.querySelector('[data-testid="subagent-count"]')`, 'rail 213 at 320');
  check('213 children at 320 px: the lead fits one line', await guest('panel', `const p=[...d.querySelectorAll('[data-testid="subagent-count"] .ap-sub-part')].map(n=>n.getBoundingClientRect());return p.every(r=>Math.abs(r.top-p[0].top)<2)`));
  await shot('panel', 'subagents-line-rail-320', 4000, true);
  await click('panel', '[data-testid="observed-more"] > summary');
  await wait('panel', `d.querySelector('[data-testid="observed-more"]').open && d.querySelector('[data-testid="subagent-count-more"]')?.checkVisibility()`, 'tucked counts shown');
  check('213 children: opened Show more names 205 finished and 1 unknown', (await text('panel', '[data-testid="subagent-count-more"]')) === '205 finished1 unknown');
  await shot('panel', 'subagents-line-rail-320-open', 4000, true);
  await click('panel', '[data-testid="observed-more"] > summary');
  await wait('panel', `!d.querySelector('[data-testid="observed-more"]').open`, 'Show more closed again');
  // Nothing current: the lead says so in words (no "0+"), the history counts stay behind Show more.
  await evaluate(`qa.set('M-live',{activity:'idle'});qa.runs.M.saved=qa.runs.M.useful;n=950;qa.runs.M.useful=Array.from({length:3},(_,i)=>run('M','F'+i,'succeeded',{ago:30+i,plan:'plan-many',description:'Finished batch '+i,agent:'migrator'}));qa.bump();qa.push('sessions');true`);
  await wait('panel', `!d.querySelector('[data-testid="subagent-count"] [data-kind="running"]') && d.querySelector('[data-testid="subagent-count"] [data-kind="none"]')`, 'nothing running');
  const idle = await lineParts('panel');
  check('nothing running: the lead says so plainly; finished stay behind Show more', JSON.stringify(idle.later) === JSON.stringify(['3 finished']) && idle.lead.length === 1 && ['Nothing running now', 'None seen running'].includes(idle.lead[0]!) && !/0\+/.test(idle.lead[0]!), idle);
  await shot('panel', 'subagents-line-nothing-running-320', 4000, true);
  await evaluate(`qa.set('M-live',{activity:'running'});qa.runs.M.useful=qa.runs.M.saved;qa.bump();qa.push('sessions');true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-count"] [data-kind="running"]') && d.querySelector('${row('M-live')}')`, 'many children restored');
  // 51 recorded children, all finished; the first page holds 50. The host lists the unloaded Q50 as
  // running again: its Running row may be a recorded child, so it adds no count, yet the line must
  // not say nothing is running above it (rail and board).
  await evaluate(`qa.set('M-live',{activity:'idle'});qa.runs.M.saved=qa.runs.M.useful;n=1100;qa.runs.M.useful=Array.from({length:51},(_,i)=>run('M','Q'+i,'succeeded',{ago:30+i,took:2,plan:'plan-many',description:'Resumable batch '+i,agent:'migrator'}));qa.ws.sessions['proj-alpha'].push({id:'Q50',title:'Resumable batch 50',projectId:'proj-alpha',directory:'/fixture/Alpha',parentId:'M',createdAt:400,updatedAt:0,archivedAt:null,worktree:null,activity:'running',outcome:null,items:[]});qa.bump();qa.push('sessions');true`);
  const resumedRow = `${sec} > .ap-obs-list > li[data-session="Q50"]:not([data-run])[data-ran="active"]`;
  await wait('panel', `d.querySelector('${resumedRow}') && d.querySelector('[data-testid="subagent-count-more"]')?.textContent==='51 finished'`, 'rail resumed unloaded child');
  const resumedRail = await lineParts('panel');
  check('resumed child on an unloaded page (rail): the lead counts its Running row, qualified', JSON.stringify(resumedRail) === JSON.stringify({ lead: ['1+ running'], later: ['51 finished'] }), resumedRail);
  await shot('panel', 'subagents-line-resumed-unloaded-rail', 4000, true);
  await show('page', 1100);
  await selectPlan('src-local', 'plan-many');
  await wait('page', `d.querySelector('[data-testid="plan-detail"] ${resumedRow}') && d.querySelector('[data-testid="plan-detail"] [data-testid="subagent-count-more"]')?.textContent==='51 finished'`, 'board resumed unloaded child');
  const resumedBoard = await lineParts('page', '[data-testid="plan-detail"]');
  check('resumed child on an unloaded page (board): the lead counts its Running row, qualified', JSON.stringify(resumedBoard) === JSON.stringify({ lead: ['1+ running'], later: ['51 finished'] }), resumedBoard);
  await shot('page', 'subagents-line-resumed-unloaded-board', 4000, true);
  await evaluate(`qa.set('M-live',{activity:'running'});qa.runs.M.useful=qa.runs.M.saved;qa.ws.sessions['proj-alpha']=qa.ws.sessions['proj-alpha'].filter(s=>s.id!=='Q50');qa.bump();qa.push('sessions');true`);
  await show('panel', 320);
  // The restored run read, not just the host rows: the pager below must start from it.
  await wait('panel', `d.querySelector('[data-testid="observed-more"] > summary')?.textContent==='Show more · 212' && d.querySelector('${row('M-live')}') && !d.querySelector('${row('Q50')}')`, 'many children restored after the resumed child');
  // Paging in the rail: keyboard, bounded steps, focus kept on the pager.
  await show('panel');
  await wait('panel', `d.querySelector('${row('M-live')}')`, 'rail 213');
  await guest('panel', `d.querySelector('[data-testid="observed-more"] summary').focus();return true`);
  await key('Enter');
  await wait('panel', `d.querySelectorAll('[data-testid="observed-more"] li').length===10`, 'first step');
  await guest('panel', `d.querySelector('[data-testid="subagent-more"]').focus();return true`);
  await key('Enter');
  await wait('panel', `d.querySelectorAll('[data-testid="observed-more"] li').length===20`, 'second step');
  check('pager keeps focus and the disclosure stays open', await guest('panel', `return d.activeElement?.dataset.testid==='subagent-more'&&d.querySelector('[data-testid="observed-more"]').open`) === true);
  for (const count of [30, 40, 50, 60]) {
    await key('Enter');
    await wait('panel', `d.querySelectorAll('[data-testid="observed-more"] li').length===${count} && d.querySelector('[data-testid="subagent-more"]')?.getAttribute('aria-disabled')!=='true'`, `step to ${count}`);
  }
  check('focus stays on the pager across a server page read', await guest('panel', `return d.activeElement?.dataset.testid==='subagent-more'`) === true);
  check('later server pages read on demand with the cursor', await evaluate(`qa.requests.some(q=>q.query?.root==='M'&&q.query?.cursor==='50')`) === true);

  // 6. Page: rooted in the selected plan's coordinator, independent of host selection.
  await evaluate(`qa.context('B');true`);
  await show('page', 1100);
  await wait('page', `d.querySelector('[data-testid="plan-row-plan-alpha"]')`, 'board');
  await selectPlan('src-local');
  await wait('page', `d.querySelector('[data-testid="plan-detail"] .ap-tasks[data-complete]') && d.querySelector('[data-testid="plan-detail"] ${sec}[data-state="ready"] ${row('C1').replace(sec+' ', '')}[data-run]') && d.querySelector('[data-testid="plan-detail"] [data-testid="observed-more"]')`, 'page recorded roster and complete reading');
  await progressUi.records('page');
  await wait('page', `d.querySelector('[data-testid="plan-detail"] [data-testid="subagent-more"]')`, 'page earlier');
  await guest('page', `w.focus();d.querySelector('[data-testid="plan-detail"] [data-testid="subagent-more"]').focus();return true`);
  await key('Enter');
  await wait('page', `d.querySelector('[data-testid="plan-detail"] [data-session="OLD2"]')`, 'page history expanded');
  await noClutter('page', 'page');
  const board = await lineParts('page', '[data-testid="plan-detail"]');
  // The board's census of the coordinator is complete, so its current counts are exact.
  check('board: leads with current counts; finished and unknown behind Show more', JSON.stringify(board) === JSON.stringify({ lead: ['1 waiting for you', '1 running', '1 failed', '1 interrupted'], later: ['4 finished', '1 unknown'] }), board);
  await shot('page', 'subagents-line-board-1100', 4000, true);
  await shot('page', 'page-history-expanded');
  await evaluate(`qa.context(null);qa.context('A');qa.context('B');true`);
  await settle(600);
  check('page selection and root unchanged by host A/B/null', await guest('page', `return d.querySelector('[data-testid="plan-detail"] article').dataset.testid==='plan-plan-alpha'&&!!d.querySelector('[data-testid="plan-detail"] ${row('C1')}')`) === true);
  await selectPlan('src-other');
  await wait('page', `d.querySelector('[data-testid="surface-header"]')?.textContent.includes('From another OpenCode install')`, 'foreign plan');
  check('foreign-source lookalike borrows no roster or navigation', !(await has('page', sec)) && !(await has('page', '[data-testid="surface-header"] [data-testid^="open-session-"]')));

  // 7. Defect B in the real ticker: advance this frame's clock past 60 s; the same node stays Running.
  await evaluate(`qa.context('A');true`);
  await show('panel');
  await wait('panel', `d.querySelector('${fact('C1', 'ran')}')`, 'rail A again');
  // Identical host callbacks and a periodic loading → ready reload first: they are not activity.
  await evaluate(`qa.reload();qa.push('sessions');qa.push('sessions');true`);
  await settle(800);
  check('reload and identical callbacks leave C1 Running', (await text('panel', `${fact('C1', 'ran')} .ap-obs-label`)) === 'Running');
  await guest('panel', `d.querySelector('${row('C1')}').__steady=true;return true`);
  const startText = (await text('panel', `${fact('C1', 'ran')} time`))!;
  const startTime = await guest<string>('panel', `return d.querySelector('${fact('C1', 'ran')} time').dateTime`);
  await guest('panel', `const off=95000,n=w.Date.now.bind(w.Date),p=w.performance.now.bind(w.performance);w.Date.now=()=>n()+off;w.performance.now=()=>p()+off;return true`);
  await wait('panel', `d.querySelector('${fact('C1', 'ran')} time')?.textContent!==${javascriptLiteral(startText)}`, 'label ticker advanced the start age', 40_000);
  const steady = await guest<{ same: boolean; label: string; state: string; time: string }>('panel', `const r=d.querySelector('${row('C1')}');return {same:r.__steady===true,label:r.querySelector('.ap-obs-label').textContent,state:r.querySelector('.ap-obs').dataset.state,time:r.querySelector('time').textContent}`);
  check('steady run past 60 s: same node (no repaint), still Running, only its age moved', steady.same && steady.label === 'Running' && steady.state === 'active' && steady.time !== startText, { ...steady, startText });
  await shot('panel', 'steady-running', 4000, true);
  // Re-entering the view (new subscriptions) neither expires nor restarts it.
  await evaluate(`qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'away');
  await evaluate(`qa.context('A');true`);
  await wait('panel', `d.querySelector('${fact('C1', 'ran')} .ap-obs-label')?.textContent==='Running'`, 'back');
  check('view re-entry: still Running from the same real start', await guest('panel', `return d.querySelector('${fact('C1', 'ran')} time').dateTime===${javascriptLiteral(startTime)}`), { startTime });
  // A valid host status change updates it promptly; tasks stay as reported.
  await evaluate(`qa.set('C1',{activity:'waiting-permission'});true`);
  await wait('panel', `d.querySelector('${fact('C1', 'ran')} .ap-obs-label')?.textContent==='Waiting for permission'`, 'host change applies');
  check('host change does not touch task facts', (await text('panel', fact('C1', 'accepted'))) === 'Task state2 tasks: 1 done, 1 in progress');
  await evaluate(`qa.set('C1',{activity:'running'});true`);

  // Pager while a continuation cursor exists: 51 recorded running children, all host-listed.
  await evaluate(`qa.context('M');true`);
  // M-live (unrecorded in this swapped run set) is idled so only the 51 recorded children are in play.
  await evaluate(`qa.set('M-live',{activity:'idle'});qa.runs.M.saved=qa.runs.M.useful;n=900;qa.runs.M.useful=Array.from({length:51},(_,i)=>run('M','P'+i,'running',{ago:1+i,plan:'plan-many',description:'Parallel batch '+i,agent:'migrator'}));for(let i=0;i<51;i++)qa.ws.sessions['proj-alpha'].push({id:'P'+i,title:'Parallel batch '+i,projectId:'proj-alpha',directory:'/fixture/Alpha',parentId:'M',createdAt:300+i,updatedAt:0,archivedAt:null,worktree:null,activity:'running',outcome:null,items:[]});qa.bump();qa.push('sessions');true`);
  await show('panel');
  await wait('panel', `d.querySelector('[data-testid="subagent-count"]')?.textContent.includes('51+ running') && d.querySelector('[data-testid="observed-more"]')`, '51 running children, qualified until their rows load');
  await progressUi.records('panel');
  for (let i = 0; i < 8 && !(await has('panel', `${sec} [data-session="P50"][data-run]`)); i++) {
    if (!(await has('panel', '[data-testid="subagent-more"]'))) break;
    await click('panel', '[data-testid="subagent-more"]');
    await settle(500);
  }
  const pagerFacts = await guest('panel', `const m=d.querySelector('[data-testid="observed-more"]');return {open:m?.open,earlier:m?.querySelectorAll('li').length,summary:m?.querySelector('summary')?.textContent,pager:d.querySelector('[data-testid="subagent-more"]')?.textContent??null,p50:[...d.querySelectorAll('${sec} [data-session="P50"]')].map(n=>n.dataset.run?'run':'host'),count:d.querySelector('[data-testid="subagent-count"]')?.textContent,cursorReads:qa.requests.filter(q=>q.query?.root==='M'&&q.query?.cursor).length}`);
  check('pager kept while the cursor exists: the 51st record loads', await has('panel', `${sec} [data-session="P50"][data-run]`) && (await text('panel', '[data-testid="subagent-count"]'))!.includes('51 running'), pagerFacts);
  await evaluate(`qa.set('M-live',{activity:'running'});qa.runs.M.useful=qa.runs.M.saved;qa.ws.sessions['proj-alpha']=qa.ws.sessions['proj-alpha'].filter(s=>!/^P\\d+$/.test(s.id));qa.bump();qa.push('sessions');qa.context('A');true`);
  await wait('panel', `d.querySelector('${row('C1')}')`, 'back to A');

  // Work Status height: a dropped resize request is re-sent and the frame recovers; a steady card sends none.
  await show('status', 280);
  await wait('status', `d.querySelector('[data-testid="status-plan-title"]')`, 'status card');
  await settle(1500);
  const quiet = await evaluate<number>(`qa.resizes.length`);
  await settle(1200);
  check('steady Work Status: no further height requests', (await evaluate<number>(`qa.resizes.length`)) === quiet);
  const fits = `(()=>{const f=frame('status'),m=f.contentDocument.querySelector('main');return !!m&&f.clientHeight===Math.ceil(m.getBoundingClientRect().height)})()`;
  await evaluate(`qa.context('A');true`);
  await wait('status', `d.querySelector('[data-testid="plan-plan-alpha"]')&&!d.querySelector('[data-testid="status-stale-time"]')`, 'fresh status before recording change');
  await evaluate(`(async()=>{let n=-1;for(let i=0;i<40;i++){if(qa.resizes.length===n)return true;n=qa.resizes.length;await new Promise(r=>setTimeout(r,250))}return false})()`);
  const beforeResize = await evaluate<number>(`frame('status').clientHeight`);
  // Recording-off changes the real five-line card. Its qualification and activity
  // counts can change wrapping in either direction; recovery must fit the new size,
  // not necessarily grow like the removed roster disclosure did.
  await evaluate(`qa.resizes=[];qa.dropResize=1;qa.capture=false;qa.bump();true`);
  await wait('status', `d.querySelector('[data-testid="capture-off"]')`, 'recording-off qualification');
  const recovered = await evaluate<boolean>(`(async()=>{for(let i=0;i<60;i++){if(qa.resizes.some(x=>x.dropped)&&${fits})return true;await new Promise(r=>setTimeout(r,50))}return false})()`);
  // A service refresh can paint both list and run facts. Exact one-retry ownership is
  // tested directly in height-sync.test.ts; this driver checks the whole refresh.
  // Observe beyond the full 6+12+24-frame retry budget before bounding its requests.
  await guest('status', `return new Promise(resolve=>{let frames=48;const tick=()=>--frames? w.requestAnimationFrame(tick):resolve(true);w.requestAnimationFrame(tick)})`);
  const resizes = await evaluate<{ h: number; dropped: boolean }[]>(`qa.resizes`);
  const dropped = resizes.find((x) => x.dropped);
  check('dropped Work Status height: changed size recovers with bounded requests', recovered && !!dropped && dropped.h !== beforeResize && resizes.some(x => x.h === dropped.h && !x.dropped) && resizes.length <= 4, { beforeResize, recovered, resizes: resizes.map((x) => `${x.h}${x.dropped ? '(dropped)' : ''}`) });
  await evaluate(`qa.capture=true;qa.bump();true`);
  await wait('status', `!d.querySelector('[data-testid="capture-off"]')`, 'recording restored');
  await evaluate(`qa.context('A');true`);
  await wait('status', `d.querySelector('[data-testid="plan-plan-alpha"]')`, 'status back on A');
  await show('panel');
  await wait('panel', `d.querySelector('${row('C1')}')`, 'rail back on A');

  // Idle task-linked children only and no recorded runs: the section has rows but no count part,
  // and still leads with the nothing-running words on rail and board (qualified when coverage is not complete).
  await evaluate(`qa.saved={runs:qa.runs.A,activity:qa.ws.sessions['proj-alpha'].map(s=>[s.id,s.activity,s.outcome])};qa.runs.A={useful:[],history:[],recovery:{state:'complete',reason:null,token:null},loss:false};for(const id of ['C1','N1','C2'])Object.assign(qa.ws.sessions['proj-alpha'].find(s=>s.id===id),{activity:'idle',outcome:null});qa.bump();qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'away before the idle-only roster');
  await evaluate(`qa.context('A');true`);
  const idleOnly = `const s=d.querySelector('${sec}');return !!s&&[...s.querySelectorAll('[data-session]')].map(n=>n.dataset.session+':'+n.dataset.ran).sort().join()`;
  for (const [coverage, words, ran] of [['ready', 'Nothing running now', 'idle'], ['loading', 'None seen running', 'unknown']] as const) {
    await evaluate(`qa.ws.coverage['proj-alpha']=[{directory:'/fixture/Alpha',state:'${coverage}'}];qa.push('sessions');true`);
    const rows = ['C1', 'C2', 'N1'].map((id) => `${id}:${ran}`).join();
    await show('panel');
    await wait('panel', `(()=>{${idleOnly}})()===${javascriptLiteral(rows)} && d.querySelector('[data-testid="subagent-count"]')?.textContent===${javascriptLiteral(words)}`, `rail idle-only roster, ${coverage} coverage`);
    const rail = await lineParts('panel');
    check(`idle-only roster, ${coverage} coverage (rail): the lead says "${words}"; no count, no running list`, JSON.stringify(rail) === JSON.stringify({ lead: [words], later: [] }) && await guest('panel', `return !d.querySelector('${sec} > .ap-obs-list')&&d.querySelector('${sec} [data-testid="subagent-count"] [data-kind="none"]')?.closest('.ap-census-head')!==null&&d.querySelector('[data-testid="observed-more"] > summary').textContent==='Sub-agents · 3'`), rail);
    await shot('panel', `subagents-line-idle-only-${coverage}-rail`, 4000, true);
    await show('page', 1100);
    await selectPlan('src-local');
    await wait('page', `d.querySelector('[data-testid="plan-detail"] [data-testid="subagent-count"]')?.textContent===${javascriptLiteral(words)}`, `board idle-only roster, ${coverage} coverage`);
    const boardIdle = await lineParts('page', '[data-testid="plan-detail"]');
    check(`idle-only roster, ${coverage} coverage (board): the lead says "${words}"`, JSON.stringify(boardIdle) === JSON.stringify({ lead: [words], later: [] }) && await guest('page', `const s=d.querySelector('[data-testid="plan-detail"] ${sec}');return !s.querySelector(':scope > .ap-obs-list')&&s.querySelectorAll('[data-testid="observed-more"] [data-session]').length===3`), boardIdle);
    await shot('page', `subagents-line-idle-only-${coverage}-board`, 4000, true);
  }
  await evaluate(`qa.ws.coverage['proj-alpha']=[{directory:'/fixture/Alpha',state:'ready'}];qa.runs.A=qa.saved.runs;for(const [id,activity,outcome] of qa.saved.activity)Object.assign(qa.ws.sessions['proj-alpha'].find(s=>s.id===id),{activity,outcome});qa.bump();qa.push('sessions');qa.context('B');true`);
  await show('panel');
  await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'away after the idle-only roster');
  await evaluate(`qa.context('A');true`);
  await wait('panel', `d.querySelector('${row('C1')}[data-run]')?.dataset.ran==='active'`, 'rail roster restored');

  }
  await evaluate(`qa.context('A');true`);
  await wait('panel', `d.querySelector('${row('C1')}')`, 'indicator root ready');
  await verifyIncompleteCounts({ evaluate, guest, wait, show, click, key, send, shot, check });

  // 9. Narrow + dark + reduced motion; 200% reflow equivalents without horizontal overflow.
  await evaluate(`qa.dark();true`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await show('status', 280);
  await wait('status', `d.querySelector('[data-testid="status-plan-title"]') && d.documentElement.dataset.ocTheme==='dark'`, 'dark status');
  check('reduced motion: the card runs no animation and has no roster', await guest('status', `return !d.querySelector('${sec}')&&d.querySelector('[data-testid="progress-root"]').getAnimations({subtree:true}).length===0`));
  await shot('status', 'narrow-dark');
  for (const [s, width] of [['panel', 180], ['status', 190], ['page', 390]] as const) {
    await show(s, width);
    if (s === 'page') await wait('page', `d.querySelector('[data-testid="plan-detail"]')`, 'page narrow');
    const overflow = await guest<boolean>(s, `return d.documentElement.scrollWidth>d.documentElement.clientWidth`);
    const wide = await guest<string[]>(s, `const cw=d.documentElement.clientWidth;return [...d.querySelectorAll('main *')].filter(n=>n.getBoundingClientRect().right>cw+1).slice(0,6).map(n=>n.tagName+'.'+n.className+'['+(n.closest('[data-testid]')?.dataset.testid??'')+']')`);
    check(`${s} at ${width}px (200% reflow of ${width * 2}px): no horizontal overflow`, !overflow, wide);
  }

  // Copy-guide audit: the same live fixture, default roster and expanded facts in all catalogs.
  for (const locale of ['en', 'ru', 'zh-CN']) {
    await evaluate(`qa.locale=${javascriptLiteral(locale)};qa.context('A');true`);
    await show('panel', 390);
    await wait('panel', `d.documentElement.lang===${javascriptLiteral(locale)}&&!!d.querySelector('${row('C1')}')`, `${locale} rail roster`);
    if (await guest('panel', `return !!d.querySelector('[data-testid="observed-more"][open]')`)) await click('panel', '[data-testid="observed-more"] > summary');
    if (await guest('panel', `return !!d.querySelector('${row('C1')} details[open]')`)) await click('panel', `${row('C1')} details > summary`);
    const visible = await guest<string>('panel', `return d.querySelector('${sec}').innerText`);
    check(`${locale}: default roster uses plain copy`, internalCopy(visible).length === 0, internalCopy(visible));
    await shot('panel', `rail-${locale}-dark`);
    await progressUi.records('panel');
    check(`${locale}: child claim and task state stay distinct`, await guest('panel', `return !!d.querySelector('${fact('C2', 'claimed')}')&&!!d.querySelector('${fact('C2', 'accepted')}')&&d.querySelector('${row('C2')}').dataset.ran==='finished'`));
    await shot('panel', `rail-${locale}-expanded-dark`);
  }
  check('no console errors or exceptions', problems.length === 0, problems);
  check('no non-loopback requests', remote.length === 0, remote);
  const summary = { passed: true, evidenceClass: 'synthetic SDK workspace/service fixture, real Chromium, current built guests', nativeHostProof: false, checks: results.length, results };
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, checks: results.length }, null, 2));
} catch (error) {
  if ((error as Error).message === 'smoke-done') console.log(JSON.stringify({ smoke: true, results }, null, 2));
  else { console.error(JSON.stringify({ passed: false, error: (error as Error).message, results: results.slice(-5), problems: problems.slice(0, 5) }, null, 2)); process.exitCode = 1; }
} finally { await cleanup(); }
