// Current-bundle readiness QA in an isolated Chromium with deliberately synthetic SDK/service
// events (ready-tasks-fixture.ts). It starts its own loopback fixture and a headless Chromium
// with a fresh disposable profile, drives real mouse/keyboard input over CDP, and stops only
// what it started. Never attaches to an existing browser or uses a real profile.
// Usage: node --experimental-strip-types tests/browser/ready-tasks-qa.ts --artifacts <dir> [--chromium <path>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startReadyFixture } from './ready-tasks-fixture.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: ready-tasks-qa.ts --artifacts <dir> [--chromium <path>]');
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

type Result = { id: string; pass: boolean; detail?: unknown };
const results: Result[] = [];
const shots: string[] = [];
function check(id: string, pass: boolean, detail?: unknown) {
  results.push({ id, pass, ...(detail === undefined ? {} : { detail }) });
  if (!pass) throw new Error(`${id} failed${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}

// ---- minimal CDP client (page target only)
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

const profile = mkdtempSync(join(tmpdir(), 'ready-tasks-qa-'));
const { server, port } = await startReadyFixture(0);
const chrome = spawn(findChromium(), ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
let cdp: Cdp | null = null;
let failure: string | null = null;
try {
  let devtools = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0];
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  cdp = await connect(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  const c = cdp;
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  // Reduced motion is set before navigation so every guest starts under it.
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  /** Run `code` with `d` = the guest document of surface `s`. */
  const guest = <T = any>(s: string, code: string) => evaluate<T>(`(()=>{const w=frame('${s}').contentWindow,d=w.document;${code}})()`);
  const wait = async (s: string, cond: string, what = cond, ms = 10_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=Date.now()+${ms};while(Date.now()<end){try{const w=frame('${s}').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>setTimeout(r,40));}return false})()`);
    if (!ok) throw new Error(`timed out waiting (${s}): ${what}`);
  };
  const key = async (k: string, times = 1) => {
    const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, ArrowDown: 40, Home: 36 };
    const code = k === ' ' ? 'Space' : k;
    for (let i = 0; i < times; i++) {
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: codes[k] ?? 0, ...(k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {}) });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: codes[k] ?? 0 });
    }
  };
  const click = async (s: string, selector: string) => {
    const point = await evaluate<[number, number] | null>(`(()=>{const f=frame('${s}'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=f.getBoundingClientRect();return [o.x+r.x+Math.min(16,r.width/2),o.y+r.y+r.height/2]})()`);
    if (!point) throw new Error(`missing ${selector} in ${s}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: 'left', clickCount: 1 });
  };
  const show = async (s: string, width: number) => { await evaluate(`qa.show('${s}',${width});true`); await wait(s, `w.innerWidth===${width}`, `${s} width ${width}`); };
  const noOverflow = (s: string) => guest<boolean>(s, `const sw=d.documentElement.scrollWidth,cw=d.documentElement.clientWidth;return sw<=cw&&[...d.querySelectorAll('[data-testid="readiness"] button')].every(b=>{const r=b.getBoundingClientRect();return r.right<=cw+0.5&&r.left>=-0.5})`);
  const shot = async (s: string, name: string, scrollTo = '[data-testid="readiness"]') => {
    check(`${name}:no-horizontal-overflow`, await noOverflow(s));
    if (scrollTo) await guest(s, `d.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView({block:'start'});return true`);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const r = await evaluate<number[]>(`(()=>{const r=document.querySelector('section[data-surface="${s}"]').getBoundingClientRect();return [r.x-8,r.y-8,r.width+16,r.height+16]})()`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  const context = (id: string | null) => evaluate(`qa.context(${JSON.stringify(id)});true`);
  const rd = '[data-testid="readiness"]';
  /** Readiness membership by group in surface `s`, from per-entry attributes. */
  const groups = (s: string) => guest<Record<string, string[]>>(s, `const out={ready:[],waiting:[],skipped:[],blocked:[]};for(const e of d.querySelectorAll('${rd} [data-testid^="readiness-entry-"]'))out[e.dataset.group].push(e.dataset.item);return out`);
  const counts = (s: string) => guest<string[]>(s, `const n=d.querySelector('article.ap-plan [data-testid="counts"]');return [n.dataset.done,n.dataset.total,n.dataset.remaining,n.dataset.skipped]`);
  const requests = (filter = 'true') => evaluate<any[]>(`qa.requests.filter(q=>${filter})`);
  /** Session chips under the linked (W) and assigned (K) tasks in the canonical task list. */
  const taskChips = (s: string) => guest<{ name: string; state: string; nameClipped: boolean; stateClipped: boolean; inside: boolean; oneLine: boolean }[]>(s, `return ['W','K'].map(id=>{const c=d.querySelector('[data-testid="item-'+id+'"] .ap-item-sub .ap-chip'),b=c.querySelector('b'),st=c.querySelector('.ap-chip-state'),r=c.getBoundingClientRect();return {name:b.textContent,state:st.textContent,nameClipped:b.scrollWidth>b.clientWidth+1,stateClipped:st.scrollWidth>st.clientWidth+1,inside:r.right<=d.documentElement.clientWidth+0.5,oneLine:Math.abs(b.getBoundingClientRect().top-st.getBoundingClientRect().top)<1}})`);
  const FIXTURE_GROUPS = { ready: ['R', 'I'], waiting: ['W'], skipped: ['K'], blocked: ['B'] };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  await evaluate(`new Promise(r=>{const t=()=>window.qa&&frame('page').contentDocument?.querySelector('[data-testid="progress-root"]')?r(true):setTimeout(t,50);t()})`);
  check('Q5:reduced-motion-emulated', await guest('panel', `return w.matchMedia('(prefers-reduced-motion: reduce)').matches`));

  // ---------------------------------------------------------------- Q4 rail, light, 360px
  await show('panel', 360);
  await context('A');
  await wait('panel', `d.querySelector('${rd}[data-state="ready"]')`);
  check('Q4:rail-groups', same(await groups('panel'), FIXTURE_GROUPS), await groups('panel'));
  check('Q4:rail-counts-unchanged', same(await counts('panel'), ['1', '7', '6', '1']), await counts('panel'));
  const deps = await guest<Record<string, string[]>>('panel', `const o={};for(const e of d.querySelectorAll('${rd} [data-testid^="readiness-entry-"]'))o[e.dataset.item]=[...e.querySelectorAll('[data-dep]')].map(x=>x.dataset.dep+':'+x.dataset.depState+':'+(x.querySelector('button')?.getAttribute('aria-label')??'-')+':'+x.textContent);return o`);
  check('Q4:every-dependency-explained', same(deps, {
    R: ['D:done:Show prerequisite: Prepare inputs:Prepare inputsDone'], I: [], W: ['R:pending:Show prerequisite: Review the inputs:Review the inputsPending'],
    K: ['S:skipped:Show prerequisite: Optional benchmark:Optional benchmarkSkipped', 'W:pending:Show prerequisite: Write the summary:Write the summaryPending'], B: ['D:done:Show prerequisite: Prepare inputs:Prepare inputsDone'],
  }), deps);
  check('Q4:no-prerequisites-recorded-copy', await guest('panel', `return d.querySelector('[data-testid="readiness-entry-I"]').textContent.includes('No prerequisites recorded')&&!d.body.textContent.includes('No prerequisites exist')`));
  check('Q4:qualifier', await guest('panel', `return d.querySelector('${rd}').textContent.includes('Based on recorded prerequisites only. Other prerequisites may not be recorded.')`));
  const attribution = await guest('panel', `const t=id=>d.querySelector('[data-testid="readiness-entry-'+id+'"]');return {r:t('R').dataset.assignment,k:t('K').dataset.assignment,kText:t('K').querySelector('.ap-ready-meta').textContent,w:t('W').dataset.assignment,reports:[...t('K').querySelectorAll('[data-report]')].map(x=>x.dataset.report+':'+x.textContent)}`);
  check('Q4:rail-attribution', attribution.r === 'selected' && attribution.k === 'other' && attribution.w === 'none'
    && /Assigned to Session C.*Not open in this window/.test(attribution.kText)
    && same(attribution.reports, ['direct:Reported directly by Session C', 'parent-relay:Reported by Planner session for Session C']), attribution);
  // Recorded assignee, link only and neither: three distinct lines; a link never reads as an assignment.
  const who = await guest('panel', `const t=id=>d.querySelector('[data-testid="readiness-entry-'+id+'"]'),m=id=>t(id).querySelector('.ap-ready-meta').textContent;return {r:m('R'),w:m('W'),wLink:d.querySelector('[data-testid="readiness-link-W"]')?.textContent,wLinked:t('W').dataset.linked,wAssignee:!!d.querySelector('[data-testid="readiness-assignee-W"]'),i:m('I'),iLink:!!d.querySelector('[data-testid="readiness-link-I"]'),rLink:!!d.querySelector('[data-testid="readiness-link-R"]'),canonicalW:d.querySelector('[data-testid="item-W"] .ap-item-sub')?.textContent}`);
  check('Q4:link-three-cases', who.r.includes('Assigned to the selected session') && !who.rLink
    && who.wLink === 'Linked to Review session · Idle (no recorded assignment)' && who.wLinked === 'B' && !who.wAssignee && !who.w.includes('Assigned to') && !who.w.includes('No assignee recorded')
    && who.i.includes('No assignee recorded') && !who.iLink && !who.i.includes('Linked to'), who);
  check('Q4:relay-row-kept', await guest('panel', `return d.querySelector('[data-testid="item-K"] [data-testid="relay-K"]')?.textContent==='Reported by Planner session for Session C'`));
  check('Q4:no-canonical-testid-duplicates', await guest('panel', `return [...d.querySelectorAll('[data-testid^="item-"]')].every(n=>!n.closest('${rd}'))&&d.querySelectorAll('[data-testid="item-W"]').length===1`));
  await shot('panel', 'rail-light');

  // Keyboard: collapse G with a real click, then Tab from K to its W prerequisite and press Enter.
  const base = (await requests()).length;
  await click('panel', '[data-testid="group-toggle-G"] > summary');
  await wait('panel', `!d.querySelector('[data-testid="group-toggle-G"]').open`, 'G collapsed');
  await guest('panel', `w.focus();d.querySelector('[data-testid="readiness-entry-K"] .ap-ready-head button').focus();return true`);
  await key('Tab', 2);
  check('Q4:tab-reaches-W-blocker', await guest('panel', `return d.activeElement?.getAttribute('aria-label')==='Show prerequisite: Write the summary'&&!!d.activeElement.closest('[data-testid="readiness-entry-K"]')`));
  await key('Enter');
  await wait('panel', `d.activeElement?.dataset.testid==='item-W'`, 'focus on canonical W');
  const landed = await guest('panel', `const n=d.activeElement,r=n.getBoundingClientRect();return {open:d.querySelector('[data-testid="group-toggle-G"]').open,inView:r.top>=0&&r.bottom<=w.innerHeight,ring:getComputedStyle(n).boxShadow!=='none',group:!!n.closest('[data-testid="group-G"]'),animations:d.getAnimations().length}`);
  check('Q4:enter-reveals-and-focuses-W', landed.open && landed.inView && landed.ring && landed.group, landed);
  check('Q5:navigation-instant-no-animation', landed.animations === 0, landed);
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  {
    const r = await evaluate<number[]>(`(()=>{const r=document.querySelector('section[data-surface="panel"]').getBoundingClientRect();return [r.x-8,r.y-8,r.width+16,r.height+16]})()`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 } });
    writeFileSync(join(artifacts, 'keyboard-target.png'), Buffer.from(png.data, 'base64')); shots.push('keyboard-target.png');
  }
  // Space on W's R prerequisite, then a mouse click on R's D prerequisite.
  await guest('panel', `d.querySelector('[data-testid="readiness-entry-W"] .ap-ready-head button').focus();return true`);
  await key('Tab');
  await key(' ');
  await wait('panel', `d.activeElement?.dataset.testid==='item-R'`, 'Space focuses R');
  await click('panel', '[data-testid="readiness-entry-R"] [data-dep="D"] button');
  await wait('panel', `d.activeElement?.dataset.testid==='item-D'`, 'click focuses D');
  const after = await requests(`q.surface==='panel'`);
  check('Q4:navigation-sends-nothing', !after.slice(base).some((q: any) => q.method !== 'GET' || ['/v1/plan', '/v1/document', '/v1/history'].includes(q.path))
    && !(await evaluate<boolean>(`qa.messages.some(m=>m.type==='open-session')`)), after.slice(base).map((q: any) => q.path));
  check('Q4:rail-counts-after-navigation', same(await counts('panel'), ['1', '7', '6', '1']));

  // Work Status keeps its compact view without readiness.
  await show('status', 360);
  await wait('status', `d.querySelector('[data-testid="counts"]')`);
  check('Q4:status-has-no-readiness', await guest('status', `return !d.querySelector('${rd}')&&!d.querySelector('.ap-ready-entry')&&!!d.querySelector('[data-testid="counts"]')`));

  // ---------------------------------------------------------------- Q4/Q5 board, dark, 1100px
  await evaluate(`qa.theme('dark');true`);
  await show('page', 1100);
  await wait('page', `d.querySelector('[data-testid="plan-row-P-ready"][data-source="source-ready"]')`);
  const firstSelected = await guest<string>('page', `const a=d.querySelector('[data-testid="plan-detail"] article');return a.dataset.testid+'|'+a.dataset.source`);
  const pageMark = (await requests()).length;
  await click('page', '[data-testid="plan-row-P-ready"][data-source="source-ready"]');
  await wait('page', `d.querySelector('article[data-testid="plan-P-ready"][data-source="source-ready"] ${rd}[data-state="ready"]')`);
  check('Q4:board-groups', same(await groups('page'), FIXTURE_GROUPS), await groups('page'));
  check('Q4:board-counts-unchanged', same(await counts('page'), ['1', '7', '6', '1']));
  check('Q5:board-no-filter-neutral-assignee', await guest('page', `const r=d.querySelector('[data-testid="readiness-entry-R"]');return r.dataset.assignment==='other'&&!d.querySelector('${rd}').textContent.includes('selected session')`));
  await shot('page', 'board-dark');
  // Wide layout: each task-list chip keeps name and state on one line.
  await shot('page', 'task-chips-wide', '[data-testid="item-W"]');
  const wideChips = await taskChips('page');
  check('Q5:wide-task-chip-one-line', wideChips.length === 2 && wideChips.every((x) => x.oneLine && !x.nameClipped), wideChips);
  // Only the shown plan's detail is read: the default selection before the click, then P-ready.
  const all = await requests();
  const detailKey = (q: any) => `plan-${q.query.plan}|${q.query.source}`;
  const beforeClick = new Set(all.slice(0, pageMark).filter((q: any) => q.surface === 'page' && q.path === '/v1/plan').map(detailKey));
  const afterClick = new Set(all.slice(pageMark).filter((q: any) => q.surface === 'page' && q.path === '/v1/plan').map(detailKey));
  check('Q6:board-detail-only-selected', [...beforeClick].every((k) => k === firstSelected) && [...afterClick].every((k) => k === 'plan-P-ready|source-ready'), { firstSelected, beforeClick: [...beforeClick], afterClick: [...afterClick] });

  // Explicit board session filter A: "selected" only for the verified source; host A/B/null leave it alone.
  await click('page', '[data-testid="filter-session"] button');
  await wait('page', `d.querySelector('[role="listbox"]')`);
  const idx = await guest<number>('page', `return [...d.querySelectorAll('[role="listbox"] [role="option"]')].findIndex(o=>o.textContent.includes('Planner session'))`);
  check('Q4:filter-option-found', idx > 0, idx);
  await key('Home'); await key('ArrowDown', idx); await key('Enter');
  await wait('page', `d.querySelector('[data-testid="readiness-entry-R"][data-assignment="selected"]')`, 'board filter A marks R selected');
  await context('B'); await context(null);
  await wait('page', `d.querySelector('[data-testid="readiness-entry-R"][data-assignment="selected"]')`);
  const lastList = (await requests(`q.surface==='page'&&q.path==='/v1/plans'`)).at(-1);
  check('Q6:board-keeps-explicit-filter', lastList.query.session === 'A', lastList.query);
  await click('page', '[data-testid="plan-row-P-ready"][data-source="source-foreign"]');
  await wait('page', `d.querySelector('article[data-testid="plan-P-ready"][data-source="source-foreign"] ${rd}[data-state="ready"]')`);
  const foreign = await guest('page', `const r=d.querySelector('[data-testid="readiness-entry-R"]');return {a:r.dataset.assignment,t:r.querySelector('.ap-ready-meta').textContent,src:r.dataset.source}`);
  check('Q5:foreign-source-no-borrowed-identity', foreign.a === 'other' && foreign.src === 'source-foreign' && foreign.t.includes('Session A') && !foreign.t.includes('Planner session') && foreign.t.includes('another OpenCode setup'), foreign);
  const foreignLink = await guest('page', `const e=d.querySelector('[data-testid="readiness-entry-W"]');return {a:e.dataset.assignment,t:d.querySelector('[data-testid="readiness-link-W"]')?.textContent}`);
  check('Q5:foreign-link-no-borrowed-identity', foreignLink.a === 'none' && foreignLink.t === 'Linked to Session A · from another OpenCode setup (no recorded assignment)', foreignLink);

  // ---------------------------------------------------------------- Q5 narrow widths, pairwise themes
  await evaluate(`qa.theme('dark');true`);
  await show('panel', 280); await context('A');
  await wait('panel', `d.querySelector('${rd}[data-state="ready"]')`);
  await shot('panel', 'rail-narrow-dark');
  // Link only at 280px: full wrapped text, nothing clipped or ellipsized.
  const narrowLink = await guest('panel', `const n=d.querySelector('[data-testid="readiness-link-W"]'),line=n.querySelector('.ap-ready-who'),r=n.getBoundingClientRect(),cs=getComputedStyle(line);return {t:n.textContent,right:r.right<=d.documentElement.clientWidth+0.5,lines:Math.round(r.height/parseFloat(cs.lineHeight)),clipped:line.scrollWidth>line.clientWidth+1||cs.textOverflow==='ellipsis'||n.querySelector('b').scrollWidth>n.querySelector('b').clientWidth+1}`);
  check('Q5:narrow-link-only-wraps', narrowLink.t === 'Linked to Review session · Idle (no recorded assignment)' && narrowLink.right && narrowLink.lines > 1 && !narrowLink.clipped, narrowLink);
  // Task-list session chips at 280px: the name is never ellipsized; the state may move below it.
  await shot('panel', 'task-chips-narrow', '[data-testid="item-W"]');
  const narrowChips = await taskChips('panel');
  check('Q5:narrow-task-chip-name-readable', same(narrowChips.map((x) => x.name + '|' + x.state), ['Review session|Idle', 'Session C|Not open in this window'])
    && narrowChips.every((x) => !x.nameClipped && !x.stateClipped && x.inside), narrowChips);
  // A link to a session this window can't open gets no guessed name, and is never "the selected session",
  // even when that session is the rail's selected session.
  await evaluate(`qa.update('P-ready',p=>{p.links=[{sessionId:'C',itemIds:['K']},{sessionId:'C',itemIds:['W']}]});true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-link-W"]')?.textContent.includes('Session C')`, 'W linked to C');
  check('Q5:unavailable-link-plain-label', await guest<string>('panel', `return d.querySelector('[data-testid="readiness-link-W"]').textContent`) === 'Linked to Session C · Not open in this window (no recorded assignment)');
  await shot('panel', 'link-unavailable-narrow', '[data-testid="readiness-entry-W"]');
  await context('C');
  await wait('panel', `d.querySelector('[data-testid="helping-note"]')&&d.querySelector('[data-testid="readiness-entry-K"][data-assignment="selected"]')`, 'rail C');
  const asC = await guest('panel', `const e=d.querySelector('[data-testid="readiness-entry-W"]');return {a:e.dataset.assignment,t:e.querySelector('.ap-ready-meta').textContent}`);
  check('Q5:link-never-selected-session', asC.a === 'none' && !asC.t.includes('selected session') && !asC.t.includes('Assigned to') && asC.t.includes('(no recorded assignment)'), asC);
  check('Q5:link-counts-unchanged', same(await counts('panel'), ['1', '7', '6', '1']));
  await context('A');
  await evaluate(`qa.update('P-ready',p=>{p.links=${JSON.stringify([{ sessionId: 'C', itemIds: ['K'] }, { sessionId: 'B', itemIds: ['W'] }])}});true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-link-W"]')?.textContent.includes('Review session')&&d.querySelector('[data-assignment="selected"]')`, 'links restored');
  const wrapped = await guest('panel', `const b=d.querySelector('[data-testid="readiness-entry-I"] .ap-ready-head button'),cs=getComputedStyle(b);return {lines:Math.round(b.getBoundingClientRect().height/parseFloat(cs.lineHeight)),text:b.textContent.includes('<b>not markup</b>'),html:!!b.querySelector('b')}`);
  check('Q5:long-untrusted-title-wraps-as-text', wrapped.lines > 1 && wrapped.text && !wrapped.html, wrapped);
  check('Q5:focus-ring-visible-dark', await (async () => { await guest('panel', `w.focus();d.querySelector('[data-testid="readiness-entry-W"] .ap-ready-head button').focus();return true`); await key('Tab'); return guest<boolean>('panel', `return d.activeElement.matches(':focus-visible')&&getComputedStyle(d.activeElement).boxShadow!=='none'`); })());
  await evaluate(`qa.theme('light');true`);
  await show('page', 360);
  await click('page', '[data-testid="plan-row-P-ready"][data-source="source-ready"]');
  await wait('page', `d.querySelector('article[data-source="source-ready"] ${rd}[data-state="ready"]')`);
  await shot('page', 'board-narrow-light');

  // Missing targets and a group reference: identified, never linked.
  await evaluate(`qa.update('P-ready',p=>{p.items.find(i=>i.id==='I').dependencies=['gone','G']});true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-entry-I"][data-group="waiting"]')`, 'I waits on unavailable references');
  const missing = await guest('panel', `const e=d.querySelector('[data-testid="readiness-entry-I"]');return {gone:e.querySelector('[data-dep="gone"]').textContent,group:e.querySelector('[data-dep="G"]').textContent,buttons:[...e.querySelectorAll('[data-dep] button')].length,note:d.querySelector('${rd}').textContent.includes('aren’t in this plan')}`);
  check('Q5:missing-targets-identified-not-linked', missing.gone === 'gonePrerequisite task unavailable' && missing.group.includes('A group, not a task') && missing.buttons === 0 && missing.note, missing);
  await evaluate(`qa.update('P-ready',p=>{p.items.find(i=>i.id==='I').dependencies=[]});true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-entry-I"][data-group="ready"]')?.textContent.includes('No prerequisites recorded')`, 'explicit empty list');
  results.push({ id: 'Q5:explicit-empty-is-none-recorded', pass: true });
  check('Q5:blocked-stays-blocked', same((await groups('panel')).blocked, ['B']));

  // All tasks skipped: an empty ready group with no completion claim.
  const restore = await evaluate<string>(`JSON.stringify(qa.plan('P-ready').items)`);
  await evaluate(`qa.update('P-ready',p=>{for(const i of p.items)if(i.kind==='task')i.status='skipped'});true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-ready"][data-count="0"]')`, 'empty ready group');
  check('Q5:empty-no-completion-claim', await guest('panel', `const t=d.querySelector('article.ap-plan').textContent;return t.includes('No tasks are ready from the recorded information.')&&!/Finished|complete/i.test(d.querySelector('${rd}').textContent)&&d.querySelector('article.ap-plan').dataset.lifecycle==='active'`));
  await show('panel', 360);
  await shot('panel', 'empty');
  await evaluate(`qa.update('P-ready',p=>{p.items=${'JSON.parse(' + JSON.stringify(restore) + ')'}});true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-entry-R"][data-group="ready"]')`);

  // Inconsistent snapshot (cycle): unavailable, tasks still shown as reported.
  await evaluate(`qa.update('P-ready',p=>{p.items.find(i=>i.id==='R').dependencies=['D','W']});true`);
  await wait('panel', `d.querySelector('${rd}[data-state="invalid"][data-reason="cycle"]')`, 'cycle refused');
  check('Q5:invalid-snapshot-no-ready-work', await guest('panel', `return !d.querySelector('[data-testid^="readiness-entry-"]')&&!!d.querySelector('[data-testid="item-R"]')`));
  await evaluate(`qa.update('P-ready',p=>{p.items.find(i=>i.id==='R').dependencies=['D']});true`);
  await wait('panel', `d.querySelector('${rd}[data-state="ready"]')`);

  // Closed lifecycles: no readiness section at all.
  for (const lifecycle of ['finished', 'cancelled', 'failed']) {
    await evaluate(`qa.update('P-ready',p=>{p.summary.lifecycle='${lifecycle}'});true`);
    await wait('panel', `d.querySelector('article[data-testid="plan-P-ready"][data-lifecycle="${lifecycle === 'finished' ? 'completed' : lifecycle}"]')&&!d.querySelector('${rd}')`, `${lifecycle} has no readiness`);
    results.push({ id: `Q5:closed-${lifecycle}-no-readiness`, pass: true });
  }
  await evaluate(`qa.update('P-ready',p=>{p.summary.lifecycle='active'});true`);
  await wait('panel', `d.querySelector('${rd}[data-state="ready"]')`);

  // Stale refresh: retained readiness is visibly qualified.
  await evaluate(`qa.failList=true;true`);
  await wait('panel', `d.querySelector('[data-testid="stale-banner"]')&&d.querySelector('${rd}[data-stale="true"]')`, 'stale qualifier', 12_000);
  check('Q5:stale-qualified', await guest('panel', `return d.querySelector('${rd}').textContent.includes('may be out of date')`));
  await evaluate(`qa.failList=false;true`);
  await wait('panel', `!d.querySelector('[data-testid="stale-banner"]')&&d.querySelector('${rd}[data-state="ready"]:not([data-stale])')`, 'fresh again', 12_000);

  // ---------------------------------------------------------------- Q5/Q6 paging: held final page, failure, corrupt
  await context(null);
  await evaluate(`qa.theme('light');true`);
  await show('page', 1100);
  await click('page', '[data-testid="filter-session"] button');
  await wait('page', `d.querySelector('[role="listbox"]')`);
  await key('Home'); await key('Enter');
  await wait('page', `d.querySelector('[data-testid="plan-row-P-boundary"]')`);
  await evaluate(`qa.hold={surface:'page',path:'/v1/plan',cursor:true,plan:'P-boundary'};true`);
  await click('page', '[data-testid="plan-row-P-boundary"]');
  await wait('page', `qa.held.length===1`, 'page 2 held');
  check('Q5:held-final-page-is-loading', await guest('page', `return d.querySelector('article[data-testid="plan-P-boundary"] ${rd}')?.dataset.state==='loading'&&!d.querySelector('[data-testid^="readiness-entry-"]')&&!!d.querySelector('[data-testid="detail-loading"]')&&!d.body.textContent.includes('No tasks are ready')`));
  await shot('page', 'partial', '');
  await evaluate(`qa.release();true`);
  await wait('page', `d.querySelector('[data-testid="readiness-entry-T0"][data-group="ready"]')`, 'T0 ready after page 2');
  check('Q6:chromium-20+1-final-page-target', await guest('page', `return d.querySelector('[data-testid="readiness-entry-T0"] [data-dep="T20"]')?.dataset.depState==='done'`));
  await click('page', '[data-testid="readiness-entry-T0"] [data-dep="T20"] button');
  await wait('page', `d.activeElement?.dataset.testid==='item-T20'`, 'navigate to the final-page task');
  await evaluate(`qa.fail={cursor:true,plan:'P-boundary',error:'busy'};qa.update('P-boundary',()=>{},'source-ready');true`);
  await wait('page', `d.querySelector('${rd}[data-state="unavailable"]')&&d.querySelector('[data-testid="detail-loading"]')?.textContent.includes('could not be loaded')`, 'continuation failure', 12_000);
  check('Q5:continuation-failure-not-empty', await guest('page', `return !d.querySelector('[data-testid^="readiness-entry-"]')&&!d.querySelector('${rd}').textContent.includes('No tasks are ready')`));
  await shot('page', 'error', '');
  await evaluate(`qa.fail=null;qa.corrupt=true;qa.update('P-boundary',()=>{},'source-ready');true`);
  await wait('page', `d.querySelector('[data-testid="detail-loading"]')?.textContent.includes('could not be read')||d.querySelector('[data-testid="detail-loading"]')?.textContent.includes('could not be loaded')`, 'corrupt reply refused', 12_000);
  check('Q5:corrupt-reply-refused', await guest('page', `return d.querySelector('${rd}')?.dataset.state==='unavailable'&&!d.querySelector('[data-testid^="readiness-entry-"]')`));
  await evaluate(`qa.corrupt=false;true`);

  // ---------------------------------------------------------------- Q6 races and identity
  await show('panel', 360); await context('A');
  await wait('panel', `d.querySelector('${rd}[data-state="ready"]')`);
  // Focus W in P-ready, then switch to B (P-same also has item-W): no cross-plan focus restore.
  await guest('panel', `w.focus();d.querySelector('[data-testid="readiness-entry-K"] [data-dep="W"] button').focus();return true`);
  await key('Enter');
  await wait('panel', `d.activeElement?.dataset.testid==='item-W'`);
  await guest('panel', `window.qaOldButton=d.querySelector('[data-testid="readiness-entry-K"] [data-dep="W"] button');return true`);
  await context('B');
  await wait('panel', `d.querySelector('article[data-testid="plan-P-same"]')`, 'B shows P-same');
  check('Q6:no-cross-plan-focus-restore', await guest('panel', `return !d.activeElement?.closest('[data-testid="plan-P-same"]')`), await guest('panel', `return d.activeElement?.dataset.testid??d.activeElement?.tagName`));
  check('Q6:stale-button-inert', await guest('panel', `window.qaOldButton.click();return !d.activeElement?.closest('article')&&!d.querySelector('[data-testid="readiness-notice"]')?.textContent`));

  // Held detail for E's 21-task plan; A → B → null retires it: no paint, no continuation pages.
  await evaluate(`qa.hold={surface:'panel',path:'/v1/plan',plan:'P-boundary'};true`);
  await context('E');
  await wait('panel', `qa.held.length===1&&d.querySelector('article[data-testid="plan-P-boundary"] ${rd}[data-state="loading"]')`, 'E detail held');
  await context('B');
  await wait('panel', `d.querySelector('article[data-testid="plan-P-same"]')`);
  await context(null);
  await wait('panel', `d.querySelector('[data-testid="unscoped-state"]')`);
  const mark = (await requests()).length;
  await evaluate(`qa.release();true`);
  await evaluate('new Promise(r=>setTimeout(r,400))');
  const afterRelease = (await requests()).slice(mark).filter((q: any) => q.surface === 'panel');
  check('Q6:retired-reply-no-paint-no-continuation', !afterRelease.some((q: any) => q.path === '/v1/plan') && await guest('panel', `return !d.querySelector('article.ap-plan')&&!!d.querySelector('[data-testid="unscoped-state"]')`), afterRelease.map((q: any) => q.path));
  // Null rail/status: unscoped, no plan/list/document/history queries while null.
  await wait('status', `d.querySelector('[data-testid="unscoped-state"]')`);
  const nullMark = (await requests()).length;
  await evaluate('new Promise(r=>setTimeout(r,3500))'); // one poll period: absence of reads needs a window
  const nullReqs = (await requests()).slice(nullMark).filter((q: any) => q.surface !== 'page' && (q.path.startsWith('/v1/plan') || q.path === '/v1/document' || q.path === '/v1/history'));
  check('Q6:null-session-zero-plan-queries', nullReqs.length === 0 && (await requests(`q.surface!=='page'&&q.path==='/v1/plans'`)).every((q: any) => q.query?.session), nullReqs);
  await show('panel', 360);
  await shot('panel', 'session-null', '');

  // Revision change while detail is held: the older readiness is not reused.
  await context('A');
  await wait('panel', `d.querySelector('${rd}[data-state="ready"]')`);
  await evaluate(`qa.hold={surface:'panel',path:'/v1/plan',plan:'P-ready'};qa.update('P-ready',p=>{p.items.find(i=>i.id==='D').status='working'});true`);
  await wait('panel', `qa.held.length>0&&d.querySelector('${rd}[data-state="loading"]')`, 'new revision waits for its detail', 12_000);
  check('Q6:new-revision-not-old-readiness', await guest('panel', `return !d.querySelector('[data-testid^="readiness-entry-"]')`));
  await evaluate(`qa.release();true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-entry-R"][data-group="waiting"]')`, 'R waits once D is working');
  // Removal of the focused task: focus W, remove it; no restore elsewhere, no error.
  await guest('panel', `w.focus();d.querySelector('[data-testid="readiness-entry-K"] [data-dep="W"] button').focus();return true`);
  await key('Enter');
  await wait('panel', `d.activeElement?.dataset.testid==='item-W'`);
  await evaluate(`qa.update('P-ready',p=>{p.items=p.items.filter(i=>i.id!=='W');p.items.find(i=>i.id==='K').dependencies=['S']});true`);
  await wait('panel', `!d.querySelector('[data-testid="item-W"]')&&d.querySelector('${rd}[data-state="ready"]')`, 'W removed', 12_000);
  check('Q6:removed-focus-not-restored-elsewhere', await guest('panel', `return !d.activeElement?.closest('[data-testid^="item-"]')`));
  // Store/binding replacement with identical IDs and revision: held detail shows loading, not old readiness.
  await evaluate(`qa.hold={surface:'panel',path:'/v1/plan',plan:'P-ready'};qa.store='store-replaced';true`);
  await wait('panel', `qa.held.length>0&&d.querySelector('${rd}[data-state="loading"]')`, 'store replacement re-reads detail', 12_000);
  check('Q6:store-replacement-no-old-readiness', await guest('panel', `return !d.querySelector('[data-testid^="readiness-entry-"]')`));
  await evaluate(`qa.release();true`);
  await wait('panel', `d.querySelector('${rd}[data-state="ready"]')`);
  await evaluate(`qa.hold={surface:'panel',path:'/v1/plan',plan:'P-ready'};qa.binding={sourceId:'source-ready',verified:false};true`);
  await wait('panel', `qa.held.length>0&&d.querySelector('${rd}[data-state="loading"]')`, 'binding change re-reads detail', 12_000);
  await evaluate(`qa.release();true`);
  await wait('panel', `d.querySelector('[data-testid="readiness-entry-R"]')`);
  check('Q6:unverified-binding-no-selected-claim', await guest('panel', `return !d.querySelector('[data-assignment="selected"]')`));
  await evaluate(`qa.binding={sourceId:'source-ready',verified:true};true`);
  await wait('panel', `d.querySelector('[data-assignment="selected"]')`, 'verified again', 12_000);

  // Disposal: pagehide stops the frame's reads.
  await guest('panel', `w.dispatchEvent(new Event('pagehide'));return true`);
  const disposeMark = (await requests()).length;
  await evaluate('new Promise(r=>setTimeout(r,3500))'); // one poll period
  check('Q6:disposed-frame-reads-nothing', !(await requests()).slice(disposeMark).some((q: any) => q.surface === 'panel'));
  check('Q4:no-service-writes', (await requests(`q.method!=='GET'`)).length === 0);
  check('Q4:no-session-open', !(await evaluate<boolean>(`qa.messages.some(m=>m.type==='open-session')`)));
  // Bounded synthetic diagnostics only: the first line of any exception or console error.
  const errors = c.events.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(' ') ?? '').split('\n')[0].slice(0, 200));
  check('Q4:no-guest-exceptions-or-console-errors', errors.length === 0, errors);
} catch (e) {
  failure = e instanceof Error ? e.message : String(e);
} finally {
  cdp?.close();
  chrome.kill('SIGTERM');
  await new Promise((r) => { if (chrome.exitCode !== null) r(null); else chrome.once('exit', r); });
  server.close(); server.closeAllConnections();
  rmSync(profile, { recursive: true, force: true });
  const summary = { evidenceClass: 'synthetic SDK/service, isolated headless Linux Chromium, current guest bundles', nativeHostProof: false, passed: !failure && results.every((r) => r.pass), failure, assertions: results.length, results, screenshots: shots };
  writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const races = results.filter((r) => r.id.startsWith('Q6:'));
  writeFileSync(join(artifacts, 'race-results.json'), `${JSON.stringify({ evidenceClass: summary.evidenceClass, passed: summary.passed && races.every((r) => r.pass), failure, results: races }, null, 2)}\n`);
  console.log(JSON.stringify({ passed: summary.passed, assertions: summary.assertions, failure }, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
