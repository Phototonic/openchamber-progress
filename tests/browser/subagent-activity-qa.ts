// Current-bundle Chromium QA of the sub-agents section (runs revision 1) over the synthetic fixture
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
const out = opt('--out') ?? 'evidence/subagent-run-tracking/browser';
const only = opt('--only');
const from = opt('--from');
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
      const seen = await evaluate(`(()=>{const d=frame('${s}').contentDocument,c=d.querySelector('[data-testid="subagent-activity"]');return c?{state:c.dataset.state,text:c.textContent.slice(0,400)}:{body:d.body.textContent.slice(0,400)}})()`).catch(() => null);
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
  const sec = '[data-testid="subagent-activity"]';
  const row = (session: string) => `${sec} [data-session="${session}"]`;
  const fact = (session: string, f: string) => `${row(session)} [data-fact="${f}"]`;
  const has = (s: string, sel: string) => guest<boolean>(s, `return !!d.querySelector(${JSON.stringify(sel)})`);
  const sectionText = (s: string) => guest<string>(s, `return (d.querySelector('${sec}')?.textContent??'').replace(/\\s+/g,' ')`);
  const runRequests = (root: string) => evaluate<number>(`qa.requests.filter(q=>q.path.startsWith('/v1/subagent-runs')&&(q.query?.root===${JSON.stringify(root)}||q.method==='POST')).length`);
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  /** Selects the page row of that source; the list can repaint under the pointer, so verify and retry. */
  const selectPlan = async (source: string, id = 'plan-alpha') => {
    for (let i = 0; i < 4; i++) {
      await click('page', `[data-testid="plan-row-${id}"][data-source="${source}"]`);
      const ok = await evaluate(`(async()=>{for(let i=0;i<40;i++){const a=frame('page').contentDocument.querySelector('[data-testid="plan-detail"] article');if(a?.dataset.source==='${source}'&&a.dataset.testid==='plan-${id}')return true;await new Promise(r=>setTimeout(r,25))}return false})()`);
      if (ok) return;
    }
    throw new Error(`Could not select the ${source} plan`);
  };
  /** Clutter the owner reported must never come back. */
  const noClutter = async (s: string, label: string) => {
    const t = await sectionText(s);
    check(`${label}: no unassigned/no-update/root/seen-just-now/cap-warning lines`, !/Unassigned|No update reported|This session|Main session|seen just now|only the first|may be incomplete/i.test(t), t.slice(0, 300));
  };

  await evaluate(`(async()=>{for(let i=0;i<200&&!window.qa;i++)await new Promise(r=>setTimeout(r,25));return true})()`);
  for (const s of ['panel', 'status', 'page']) await wait(s, `d.querySelector('[data-testid="progress-root"]')`, `${s} mounted`);
  for (const s of ['panel', 'status']) await wait(s, `d.querySelector('[data-testid="unscoped-state"]')`, 'draft');

  // 1. Rail, plan in scope: Ran / Claimed / Accepted on featured rows only.
  await evaluate(`qa.context('A');true`);
  await show('panel');
  // Run facts and host activity arrive separately; wait for both (N1's host-reported wait).
  await wait('panel', `d.querySelector('${fact('C2', 'accepted')}') && d.querySelector('${row('N1')}')?.dataset.ran==='waiting' && d.querySelector('[data-testid="subagent-count"]')`, 'rail roster');
  const featured = await guest<string[]>('panel', `return [...d.querySelectorAll('${sec} > .ap-obs-list > li')].map(n=>n.dataset.session+':'+n.dataset.ran)`);
  check('rail features waiting, running and task-linked children only (E1 idle without tasks is not listed)', JSON.stringify(featured) === JSON.stringify(['N1:waiting', 'C1:active', 'C2:finished']), featured);
  check('summary parts', JSON.stringify(await guest('panel', `return [...d.querySelectorAll('[data-testid="subagent-count"] .ap-sub-part')].map(n=>n.textContent)`)) === JSON.stringify(['1 waiting on you', '1 running', '4 finished', '1 failed', '1 interrupted', '1 unknown']));
  const c1 = (await text('panel', fact('C1', 'ran')))!.replace(/\s+/g, ' ');
  check('C1 Ran: Running with its real host start, not a receipt', /^RanRunning · started 4 minutes ago$/.test(c1), c1);
  check('N1 Ran: waiting for an answer (host activity on an open run)', (await text('panel', fact('N1', 'ran')))!.includes('Waiting for an answer'));
  const c2 = { ran: await text('panel', fact('C2', 'ran')), claimed: await text('panel', fact('C2', 'claimed')), accepted: await text('panel', fact('C2', 'accepted')) };
  check('C2: finished run, claim labelled as reported, accepted task still blocked', /^RanFinished · \d+ minutes ago · took 3 min$/.test(c2.ran!.replace(/\s+/g, ' ')) && c2.claimed!.startsWith('ClaimedReported done') && c2.claimed!.includes('<i>wording</i>') && c2.accepted === 'AcceptedTask reported blocked: Review the release note', c2);
  check('literal markup in description and claim', await guest('panel', `const r=d.querySelector('${row('C2')}');return !r.querySelector('b,i')&&r.querySelector('.ap-obs-title').textContent==='<b>Review</b> the release note'`) === true);
  check('no Claimed or Accepted line without those facts (C1 has no claim)', !(await has('panel', fact('C1', 'claimed'))) && (await text('panel', fact('C1', 'accepted'))) === 'Accepted2 tasks reported: 1 done, 1 in progress');
  await noClutter('panel', 'rail');
  check('complete history: no coverage or cap warning at all', !(await has('panel', '[data-testid="subagent-about"]')));
  await shot('panel', 'rail-mixed', 4000, true);

  // Keyboard: Tab reaches an Open control; focus survives a repaint; Enter opens that child.
  await guest('panel', `const h=d.querySelector('${sec} h2');h.setAttribute('tabindex','-1');h.focus();return true`);
  await key('Tab');
  const firstOpen = await guest<string>('panel', `return d.activeElement?.dataset.testid`);
  check('Tab reaches the first featured Open control', firstOpen === 'open-observed-N1', firstOpen);
  await evaluate(`qa.set('C2',{title:'Restricted reviewer (renamed)'});true`);
  await settle();
  check('focus survives a host refresh', await guest('panel', `return d.activeElement?.dataset.testid`) === 'open-observed-N1');
  await key('Enter');
  await evaluate(`(async()=>{for(let i=0;i<50&&!qa.opened.length;i++)await new Promise(r=>setTimeout(r,20));return true})()`);
  check('keyboard Enter opens that child only', JSON.stringify(await evaluate('qa.opened')) === JSON.stringify([{ surface: 'panel', id: 'N1' }]));

  // 2. Earlier disclosure: failed/interrupted rows, then the history page on request.
  await guest('panel', `d.querySelector('[data-testid="observed-more"] summary').focus();return true`);
  await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="observed-more"]').open && d.querySelector('[data-testid="observed-more"] [data-ran="failed"]')`, 'earlier list opened by keyboard');
  check('earlier summary counts the rest', (await text('panel', '[data-testid="observed-more"] summary')) === 'Earlier sub-agents · 6');
  const earlier = await guest<string[]>('panel', `return [...d.querySelectorAll('[data-testid="observed-more"] li')].map(n=>n.querySelector('.ap-obs-label').textContent)`);
  check('failed and interrupted stay distinct from finished', earlier.includes('Failed: SyntheticFailure') && earlier.includes('Interrupted: stopped by the user') && earlier.filter((x) => x === 'Finished').length === 2, earlier);
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

  // 5. Many children on the narrow Work Status card: summary, one running row, no cap warning.
  await evaluate(`qa.context('M');true`);
  await show('status', 280);
  await wait('status', `d.querySelector('${row('M-live')}') && d.querySelector('[data-testid="subagent-count"]')`, 'status 213');
  const many = await guest<string[]>('status', `return [...d.querySelectorAll('[data-testid="subagent-count"] .ap-sub-part')].map(n=>n.textContent)`);
  check('213 children: compact truthful summary', JSON.stringify(many) === JSON.stringify(['1 running', '205 finished', '4 failed', '2 interrupted', '1 unknown']), many);
  check('213 children: one featured row, the rest folded', (await guest<number>('status', `return d.querySelectorAll('${sec} > .ap-obs-list > li').length`)) === 1 && (await text('status', '[data-testid="observed-more"] summary')) === 'Earlier sub-agents · 212');
  check('213 children: no warning line on the card', !(await has('status', '[data-testid="subagent-coverage"]')));
  await noClutter('status', 'status 213');
  const card = await guest<number>('status', `return Math.round(d.querySelector('${sec}').getBoundingClientRect().height)`);
  check('213 children: the card section stays compact', card < 140, card);
  await shot('status', 'status-213');
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
  await wait('page', `d.querySelector('[data-testid="plan-detail"] ${row('C1')}') && d.querySelector('[data-testid="plan-detail"] [data-testid="observed-more"]')`, 'page roster');
  await guest('page', `d.querySelector('[data-testid="plan-detail"] [data-testid="observed-more"]').open=true;return true`);
  await wait('page', `d.querySelector('[data-testid="plan-detail"] [data-testid="subagent-more"]')`, 'page earlier');
  await click('page', '[data-testid="plan-detail"] [data-testid="subagent-more"]');
  await wait('page', `d.querySelector('[data-testid="plan-detail"] [data-session="OLD2"]')`, 'page history expanded');
  await noClutter('page', 'page');
  await shot('page', 'page-history-expanded');
  await evaluate(`qa.context(null);qa.context('A');qa.context('B');true`);
  await settle(600);
  check('page selection and root unchanged by host A/B/null', await guest('page', `return d.querySelector('[data-testid="plan-detail"] article').dataset.testid==='plan-plan-alpha'&&!!d.querySelector('[data-testid="plan-detail"] ${row('C1')}')`) === true);
  await selectPlan('src-other');
  await wait('page', `d.querySelector('[data-testid="other-source"]')`, 'foreign plan');
  check('foreign-source lookalike borrows no roster or navigation', !(await has('page', sec)));

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
  await guest('panel', `const off=95000,n=w.Date.now.bind(w.Date),p=w.performance.now.bind(w.performance);w.Date.now=()=>n()+off;w.performance.now=()=>p()+off;return true`);
  await wait('panel', `d.querySelector('${fact('C1', 'ran')} time')?.textContent!==${JSON.stringify(startText)}`, 'label ticker advanced the start age', 40_000);
  const steady = await guest<{ same: boolean; label: string; state: string; time: string }>('panel', `const r=d.querySelector('${row('C1')}');return {same:r.__steady===true,label:r.querySelector('.ap-obs-label').textContent,state:r.querySelector('.ap-obs').dataset.state,time:r.querySelector('time').textContent}`);
  check('steady run past 60 s: same node (no repaint), still Running, only its age moved', steady.same && steady.label === 'Running' && steady.state === 'active' && steady.time !== startText, { ...steady, startText });
  await shot('panel', 'steady-running', 4000, true);
  // Re-entering the view (new subscriptions) neither expires nor restarts it.
  await evaluate(`qa.context('B');true`);
  await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'away');
  await evaluate(`qa.context('A');true`);
  await wait('panel', `d.querySelector('${fact('C1', 'ran')} .ap-obs-label')?.textContent==='Running'`, 'back');
  check('view re-entry: still Running from the same real start', (await text('panel', `${fact('C1', 'ran')} time`)) === steady.time);
  // A valid host status change updates it promptly; tasks stay as reported.
  await evaluate(`qa.set('C1',{activity:'waiting-permission'});true`);
  await wait('panel', `d.querySelector('${fact('C1', 'ran')} .ap-obs-label')?.textContent==='Waiting for permission'`, 'host change applies');
  check('host change does not touch task facts', (await text('panel', fact('C1', 'accepted'))) === 'Accepted2 tasks reported: 1 done, 1 in progress');
  await evaluate(`qa.set('C1',{activity:'running'});true`);

  // 8. Absent capability, capture off, recovery unavailable: short honest notes, no fake zeros.
  await evaluate(`qa.capable=false;true`);
  await wait('panel', `d.querySelector('${sec}')?.dataset.state==='host-only'`, 'capability absent', 20_000);
  check('absent capability: host-only roster with its note, no recorded counts', (await text('panel', '[data-testid="subagent-coverage"]'))!.includes('aren’t available') && !(await sectionText('panel')).includes('finished'));
  await evaluate(`qa.capable=true;qa.capture=false;qa.bump();true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-coverage"]')?.dataset.notes?.includes('capture-off')`, 'capture off', 20_000);
  check('capture off: records stay readable with a short note', !!(await text('panel', fact('C2', 'claimed'))));
  await evaluate(`qa.capture=true;qa.runs.A.recovery={state:'unavailable',reason:null,token:null};qa.bump();true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-coverage"]')?.dataset.notes?.includes('history-unavailable')`, 'recovery unavailable', 20_000);
  await guest('panel', `d.querySelector('[data-testid="subagent-about"]').open=true;return true`);
  check('recovery unavailable: says so inside the compact disclosure', (await text('panel', '[data-testid="subagent-coverage"]'))!.includes('until the companion is running'));
  await evaluate(`qa.runs.A.recovery={state:'complete',reason:null,token:null};qa.bump();true`);

  // Incomplete host coverage: retained rows give no current activity; recorded Running stays; disclosed.
  await guest('panel', `const a=d.querySelector('[data-testid="subagent-about"]');if(a)a.open=false;return true`);
  check('full coverage: N1 waiting on you, no coverage note', (await sectionText('panel')).includes('waiting on you') && !(await guest<boolean>('panel', `return !!d.querySelector('[data-testid="subagent-coverage"]')?.dataset.notes?.includes('host-activity-unavailable')`)));
  // The host's periodic reload of that complete snapshot: still current, no note, no flicker.
  await evaluate(`qa.reloadStart();true`);
  await settle(600);
  check('periodic reload of a complete snapshot: "waiting on you" kept, no coverage note', (await sectionText('panel')).includes('waiting on you') && !(await guest<boolean>('panel', `return !!d.querySelector('[data-testid="subagent-coverage"]')?.dataset.notes?.includes('host-activity-unavailable')`)));
  await evaluate(`qa.push('sessions');true`);
  await settle(300);
  await evaluate(`qa.ws.coverage['proj-alpha']=[{directory:'/fixture/Alpha',state:'loading'}];qa.push('sessions');true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-coverage"]')?.dataset.notes?.includes('host-activity-unavailable')`, 'coverage gap disclosed');
  check('incomplete ready coverage: no "waiting on you"; recorded Running stays', !(await sectionText('panel')).includes('waiting on you') && (await text('panel', `${fact('N1', 'ran')} .ap-obs-label`)) === 'Running' && (await text('panel', `${fact('C1', 'ran')} .ap-obs-label`)) === 'Running');
  await show('status', 280);
  await wait('status', `d.querySelector('[data-testid="subagent-coverage"]')?.dataset.notes==='host-activity-unavailable'`, 'status short line');
  check('incomplete coverage: Work Status says so in one short line', (await text('status', '[data-testid="subagent-coverage"]')) === 'Current activity unavailable.' && !(await sectionText('status')).includes('waiting on you'));
  await evaluate(`qa.ws.coverage['proj-alpha']=[{directory:'/fixture/Alpha',state:'error'}];qa.push('sessions');true`);
  await settle(500);
  check('failed coverage: still withheld, with the short line', (await text('status', '[data-testid="subagent-coverage"]')) === 'Current activity unavailable.' && !(await sectionText('status')).includes('waiting on you'));
  await evaluate(`qa.ws.coverage['proj-alpha']=[{directory:'/fixture/Alpha',state:'ready'}];qa.push('sessions');true`);
  await wait('status', `!d.querySelector('[data-testid="subagent-coverage"]') && d.querySelector('[data-testid="subagent-count"]')?.textContent.includes('waiting on you')`, 'coverage restored on the card');
  await show('panel');
  await wait('panel', `d.querySelector('${row('N1')}')?.dataset.ran==='waiting'`, 'coverage restored on the rail');

  // 9. Narrow + dark + reduced motion; 200% reflow equivalents without horizontal overflow.
  await evaluate(`qa.dark();true`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await show('status', 280);
  await wait('status', `d.querySelector('${row('C1')}') && d.documentElement.dataset.ocTheme==='dark'`, 'dark status');
  check('reduced motion: the section runs no animation', await guest('status', `return d.querySelector('${sec}').getAnimations({subtree:true}).length`) === 0);
  await shot('status', 'narrow-dark');
  for (const [s, width] of [['panel', 180], ['status', 140], ['page', 390]] as const) {
    await show(s, width);
    if (s === 'page') await wait('page', `d.querySelector('[data-testid="plan-detail"]')`, 'page narrow');
    const overflow = await guest<boolean>(s, `return d.documentElement.scrollWidth>d.documentElement.clientWidth`);
    const wide = await guest<string[]>(s, `const cw=d.documentElement.clientWidth;return [...d.querySelectorAll('main *')].filter(n=>n.getBoundingClientRect().right>cw+1).slice(0,6).map(n=>n.tagName+'.'+n.className+'['+(n.closest('[data-testid]')?.dataset.testid??'')+']')`);
    check(`${s} at ${width}px (200% reflow of ${width * 2}px): no horizontal overflow`, !overflow, wide);
  }

  check('no console errors or exceptions', problems.length === 0, problems);
  check('no non-loopback requests', remote.length === 0, remote);
  const summary = { passed: true, evidenceClass: 'synthetic SDK workspace/service fixture, real Chromium, current built guests', nativeHostProof: false, checks: results.length, results };
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, checks: results.length }, null, 2));
} catch (error) {
  if ((error as Error).message === 'smoke-done') console.log(JSON.stringify({ smoke: true, results }, null, 2));
  else { console.error(JSON.stringify({ passed: false, error: (error as Error).message, results: results.slice(-5), problems: problems.slice(0, 5) }, null, 2)); process.exitCode = 1; }
} finally { cleanup(); }
