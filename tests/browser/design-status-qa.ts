// Five-line Status QA. Synthetic SDK host, disposable real service, isolated Chromium.
// Usage: node --experimental-strip-types tests/browser/design-status-qa.ts --source
//   --chromium <binary> --artifacts <dir>
// Built guests are used without --source. Neither mode uses a live profile or paid model.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GUEST_STATUS_SECTION_HEIGHT_MAX } from '@openchamber/sdk';
import { javascriptLiteral } from '../../shared/javascript-literal.ts';
import type { designRefactorQa } from './design-refactor-qa.ts';

/** Retains the established design-refactor driver's Status entry. */
export async function designStatusQa(q: Parameters<typeof designRefactorQa>[0]) {
  await q.show(['status'], 280);
  await q.wait('status', `d.querySelector('[data-testid="counts"]')`);
  for (const width of [190, 280, 390]) {
    await q.show(['status'], width);
    for (const theme of ['light', 'dark'] as const) {
      await q.theme(theme);
      const m = await q.guest('status', `const r=d.querySelector('[data-testid="progress-root"]');return {height:r.getBoundingClientRect().height,overflow:d.documentElement.scrollWidth>w.innerWidth+1}`);
      q.check(`status:${width}:${theme}:fits`, !m.overflow && m.height <= GUEST_STATUS_SECTION_HEIGHT_MAX);
      q.check(`status:${width}:${theme}:compact`, await q.guest('status', `return !d.querySelector('[data-testid="state-chip"],[data-testid="current-work"],[data-testid="subagent-activity"],[data-testid="more-plans"]')`));
      await q.shot(`status-${width}-${theme}`, '[data-testid="progress-root"]', 0, Math.ceil(m.height) + 1, 'status');
    }
  }
}

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i < 0 ? undefined : process.argv[i + 1]; };
  const artifacts = arg('--artifacts'), chromium = arg('--chromium');
  if (!artifacts || !chromium) throw Error('Pass --artifacts and --chromium');
  mkdirSync(artifacts, { recursive: true });
  const { productionFixture } = await import('../fixtures/production.ts');
  const { createProgressServer } = await import('../../service/server.ts');
  const { startLanguageFixture } = await import('./interface-language-fixture.ts');
  const { launchChromium } = await import('./phone-cdp.ts');
  const f = productionFixture();
  let oid = 0;
  const apply = (plan: string, request: Record<string, unknown>, actor = f.actor) => {
    f.store.apply({ plan, oid: `status-qa-${++oid}`, rev: f.store.get(f.source.id, plan)?.revision ?? 0, ...request }, actor);
  };
  const items = [
    { id: 'done', title: 'Prepare the release', kind: 'task', status: 'done' },
    { id: 'working', title: 'Build the release', kind: 'task', status: 'working' },
    { id: 'decision', title: 'Choose the release window', kind: 'task', status: 'blocked', blocker: { category: 'decision', reason: 'Choose a window.', nextAction: 'Choose morning or evening.' } },
  ];
  apply('main', { op: 'start', title: 'Release checklist', items });
  apply('second', { op: 'start', title: 'Review checklist', items: [{ ...items[2], id: 'review' }] });
  apply('outside', { op: 'start', title: 'Another session', items: [{ ...items[2], id: 'outside' }] }, { ...f.actor, sessionId: 'other' });
  for (const outcome of ['finished', 'cancelled', 'failed']) {
    apply(outcome, { op: 'start', title: `${outcome} plan`, items: [{ ...items[0] }] });
    apply(outcome, { op: 'finish', outcome });
  }
  apply('group', { op: 'start', title: 'Context only', items: [{ id: 'group', title: 'Context', kind: 'group' }] });
  apply('picker-extra', { op: 'start', title: 'Additional checklist', items: [{ id: 'extra', title: 'Later step', kind: 'task' }] });
  apply('skipped-only', { op: 'start', title: 'Skipped-only plan', items: [{ id: 'skipped', title: 'Optional step', kind: 'task', status: 'skipped' }] }, { ...f.actor, sessionId: 'skipped-session' });
  apply('long', { op: 'start', title: 'A deliberately long synthetic plan title that keeps its full accessible name while its compact visual title wraps. '.repeat(2), items: [{ id: 'next', title: 'Continue', kind: 'task' }] });
  const many = Array.from({ length: 148 }, (_, i) => ({ id: `many-${i}`, title: `Task ${i + 1}`, kind: 'task', status: i < 12 ? 'done' : 'pending' }));
  apply('multi', { op: 'start', title: 'Multi-digit progress', items: many.slice(0, 50) });
  for (let chunk = 0; chunk < 3; chunk++) apply('multi', { op: 'stage', upload: 'many-tasks', chunk, items: many.slice(chunk * 50, (chunk + 1) * 50) });
  apply('multi', { op: 'commit', upload: 'many-tasks', chunks: 3 });
  f.store.bindReads(f.source.id, true);
  const storeId = f.store.detail(f.source.id, 'main').storeId;
  // Enable the real run reader and settle its empty synthetic history through
  // production writes, so run-read faults exercise an admitted request, not a hidden capability.
  f.store.installSubagentRuns();
  f.store.requestRunReconciliation({ storeId, binding: { sourceId: f.source.id, verified: true }, source: f.source.id, root: 'M' });
  const history = f.store.claimRunRecovery(f.source.id, 'M');
  if (!history) throw Error('Synthetic history job missing');
  f.store.finishRunRecovery(history, 'complete');
  const service = createProgressServer(f.store, 'status-fixture-only');
  await new Promise<void>(r => service.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
  let empty = false, setup = false, partial = false, partialZero = false, old = false;
  const fixture = await startLanguageFixture({ source: process.argv.includes('--source'), service: async q => {
    if (q.path === '/health' && setup) return { status: 200, body: JSON.stringify({ ok: true, ready: false, sqlite: false, protocolVersion: 2, schemaVersion: 2 }) };
    const r = await fetch(`${origin}${q.path}?${new URLSearchParams(q.query)}`, {
      method: q.body ? 'POST' : 'GET', headers: { authorization: 'Bearer status-fixture-only', 'content-type': 'application/json' }, ...(q.body ? { body: q.body } : {}),
    });
    const body = await r.json() as any;
    if (q.path === '/v1/plans') {
      if (empty) body.data = [];
      if (old) for (const p of body.data ?? []) p.reportedAt = new Date(Date.now() - 7_200_000).toISOString();
      if (partial && body.needsYou) {
        body.needsYou.coverage.complete = false; body.needsYou.coverage.gapped = true;
        body.needsYou.coverage.skippedRecords = 1; body.needsYou.coverage.reasons = ['invalid-snapshot'];
        if (partialZero) { body.needsYou.rows = []; body.needsYou.counts = { needsYou: 0, alsoBlocked: 0 }; }
      }
    }
    return { status: r.status, body: JSON.stringify(body) };
  } });
  const browser = await launchChromium(chromium), c = browser.page;
  const checks: { id: string; pass: boolean; facts?: unknown }[] = [], measurements: unknown[] = [];
  let failure: string | null = null;
  const check = (id: string, pass: boolean, facts?: unknown) => { checks.push({ id, pass, facts }); if (!pass) throw Error(`${id}: ${JSON.stringify(facts)}`); };
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const guest = <T = any>(code: string) => evaluate<T>(`(()=>{const w=frame('status').contentWindow,d=w.document;${code}})()`);
  const fractionFits = async (id: string) => {
    // Range boxes use advance widths; actual glyph ink may overhang those boxes.
    // Reconstruct the font from longhands: tabular numerals can make `.font` empty.
    const fraction = await guest(`const n=d.querySelector('[data-testid="counts"]'),r=n.getBoundingClientRect(),card=n.closest('.ap-status-plan').getBoundingClientRect(),bar=d.querySelector('[data-testid="progress-bar"]').getBoundingClientRect(),total=n.querySelector('.ap-muted'),range=d.createRange();range.selectNodeContents(total);const text=range.getBoundingClientRect(),ctx=d.createElement('canvas').getContext('2d'),s=w.getComputedStyle(total);ctx.font=s.fontStyle+' '+s.fontWeight+' '+s.fontSize+' '+s.fontFamily;const ink=ctx.measureText(total.textContent);return {right:r.right,cardRight:card.right,viewport:w.innerWidth,barRight:bar.right,barWidth:bar.width,fractionLeft:r.left,text:n.textContent,textRight:text.right,inkRight:text.left+ink.actualBoundingBoxRight,textWidth:text.width,advance:ink.width,font:ctx.font}`);
    check(`${id}:fraction-inside-card`, fraction.right <= fraction.cardRight && fraction.right <= fraction.viewport, fraction);
    check(`${id}:fraction-ink-inside-card`, fraction.inkRight <= fraction.cardRight, fraction);
  };
  const wait = async (cond: string) => {
    const ok = await evaluate(`(async()=>{const end=performance.now()+20000;while(performance.now()<end){try{const w=frame('status').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`);
    if (!ok) throw Error(`Timeout: ${cond}; ${await guest('return d.body.innerText')}`);
  };
  const refresh = async () => {
    // The ordinary poll is installed after the previous response settles. Focus alone
    // refreshes language, not progress, and must not be mistaken for a completed poll.
    // The fixture also freezes SDK request deadlines. Never tick those while a
    // service reply is still in flight; let its result message clear the deadline.
    await wait(`w.__qaClock.pending.size>0&&d.defaultView.parent.qa.requests.length===d.defaultView.parent.qa.responses.length`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await evaluate(`qa.tick('status')`);
  };
  const observedPoll = async () => {
    const before = await evaluate<number>(`qa.responses.filter(r=>r.surface==='status'&&r.path==='/v1/plans').length`);
    await refresh();
    await wait(`d.defaultView.parent.qa.responses.filter(r=>r.surface==='status'&&r.path==='/v1/plans').length>${javascriptLiteral(before)}&&w.__qaClock.pending.size>0&&d.defaultView.parent.qa.requests.length===d.defaultView.parent.qa.responses.length`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  };
  const reload = async () => {
    // A selector can still match the retired document until navigation commits.
    // Wait for the new document before accepting its own loading/read state.
    await evaluate(`frame('status').contentWindow.__qaRetired=true;qa.reload('status')`);
    await wait(`!w.__qaRetired&&d.readyState==='complete'`);
  };
  const key = async (key: string) => {
    const code = ({ Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, Home: 36, End: 35 } as Record<string, number>)[key];
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) });
  };
  const click = async (selector: string, touch = false) => {
    // The SDK intentionally closes popups on viewport resize/outside scroll.
    // Finish the harness's preceding resize/scroll before activating a control.
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    const point = await evaluate(`(async()=>{
      const f=frame('status'),selector=${javascriptLiteral(selector)},target=f.contentDocument.querySelector(selector),popup=target?.closest('.oc-sdk-popup');
      if(popup){const a=target.getBoundingClientRect(),p=popup.getBoundingClientRect();popup.scrollTop+=a.y+a.height/2-p.y-p.height/2}else target?.scrollIntoView({block:'nearest'});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const n=f.contentDocument.querySelector(selector);if(!n)throw Error('Missing click target: '+selector);
      const a=n.getBoundingClientRect(),b=f.getBoundingClientRect(),p=popup?.getBoundingClientRect();
      const left=Math.max(a.left,p?.left??0,0),right=Math.min(a.right,p?.right??f.contentWindow.innerWidth,f.contentWindow.innerWidth);
      const top=Math.max(a.top,p?.top??0,0),bottom=Math.min(a.bottom,p?.bottom??f.contentWindow.innerHeight,f.contentWindow.innerHeight);
      const x=(left+right)/2,y=(top+bottom)/2,hit=f.contentDocument.elementFromPoint(x,y);
      if(right<=left||bottom<=top||!hit||!n.contains(hit))throw Error('Obscured click target: '+JSON.stringify({selector,x,y,viewport:f.contentWindow.innerHeight,hit:hit?.tagName,target:a.toJSON(),popup:p?.toJSON()}));
      return {x:b.x+x,y:b.y+y}
    })()`);
    if (touch) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  const shot = async (name: string) => {
    const clip = await evaluate(`(()=>{const f=frame('status'),a=f.getBoundingClientRect(),b=f.contentDocument.querySelector('[data-testid="progress-root"]').getBoundingClientRect();return{x:a.x,y:a.y,width:a.width,height:Math.ceil(b.height),scale:1}})()`);
    const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    writeFileSync(join(artifacts, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const narrowStates = async (name: string) => {
    for (const locale of ['en', 'ru', 'zh-CN']) {
      await evaluate(`qa.show('status',190);qa.ready('status',${javascriptLiteral({ locale })})`);
      await wait(`d.documentElement.lang===${javascriptLiteral(locale)}`);
      const m = await guest(`const r=d.querySelector('[data-testid="progress-root"]');return {height:r.getBoundingClientRect().height,overflow:d.documentElement.scrollWidth>w.innerWidth+1}`);
      check(`${name}:${locale}:host-height-and-wrap`, !m.overflow && m.height <= GUEST_STATUS_SECTION_HEIGHT_MAX, m);
      await shot(`${name}-${locale}-190`);
    }
    await evaluate(`qa.show('status',390);qa.ready('status',{locale:'en'})`);
    await wait(`d.documentElement.lang==='en'`);
  };
  const dark = { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryForeground: '#191b20', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58e', warning: '#e8c372', error: '#ff9e9e', info: '#83aff7', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' };
  try {
    await c.send('Runtime.enable'); await c.send('Page.enable');
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 844, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${fixture.port}` });
    // Showing/resizing an existing host section preserves its accepted guest height.
    // The generic fixture resets it to 240px; unchanged context need not repaint
    // and cannot owe another height message to undo that artificial reset.
    await evaluate(`{const show=qa.show.bind(qa);qa.show=(s,width)=>{const height=frame(s).style.height;show(s,width);frame(s).style.height=height}}`);
    await evaluate(`qa.show('status',390);qa.workspace=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[{id:'Alpha',directory:'/fixture/Alpha',name:'Example'}]}:q.kind==='worktrees'?{kind:'worktrees',projectId:'Alpha',state:'ready',worktrees:[]}:{kind:'sessions',state:'ready',projectId:'Alpha',coverage:[{directory:'/fixture/Alpha',state:'ready'}],sessions:['M','C1','C2'].map(id=>({id,title:'Example session',projectId:'Alpha',directory:'/fixture/Alpha',parentId:id==='M'?null:'M',createdAt:1,updatedAt:2,archivedAt:null,worktree:null,activity:id==='M'?'idle':'running',outcome:null,items:[]}))};qa.context('M');qa.reload('status')`);
    await wait(`d.querySelector('[data-testid="needs-you-count"]')?.dataset.count==='2'&&d.querySelector('[data-testid="status-activity"]')?.textContent.includes('2 running')`);
    check('session-scope-excludes-other-session', await guest(`return d.querySelector('[data-testid="needs-you-count"]').dataset.count==='2'`));
    // The same device record used by the rail: hide exactly one main-session wait.
    // Reopen with the persisted device record. This shell freezes ordinary refresh timers;
    // a ready delivered while the initial storage read is busy is not a completed refresh.
    // The hidden-item key is JSON data; encode that complete string as a JS literal.
    await evaluate(`qa.maps.get('primary').set('progress-view.v1',${javascriptLiteral({ v: 1, hidden: [JSON.stringify([storeId, f.source.id, 'main', 'decision', 1])], expanded: {}, dismissed: {} })})`);
    await reload();
    await wait(`d.querySelector('[data-testid="needs-you-count"]')?.dataset.count==='1'`);
    // Nine plans plus Automatic in the real, auto-height narrow frame. Navigate
    // every option with native keys, then activate the last via native pointer.
    for (const height of ['auto', 'maximum']) {
      await evaluate(`qa.show('status',190);qa.ready('status',{locale:'ru'})`);
      await wait(`d.documentElement.lang==='ru'&&Math.abs(w.innerHeight-Math.ceil(d.querySelector('[data-testid="progress-root"]').getBoundingClientRect().height))<=1`);
      if (height === 'maximum') await evaluate(`frame('status').style.height=${javascriptLiteral(GUEST_STATUS_SECTION_HEIGHT_MAX + 'px')}`);
      // Let the frame's resize event finish before opening the SDK popup.
      await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      // Maximum-height probe intentionally exercises a host frame taller than the card.
      await guest(`d.querySelector('[data-testid="status-plan-selector"] button').focus();return true`);
      await key('Enter'); await wait(`d.querySelector('[role="listbox"]')`);
      const count = await guest<number>(`return d.querySelectorAll('[role="option"]').length`);
      check(`picker:${height}:nine-plans`, count === 10, { count });
      await key('Home');
      for (let i = 0; i < count; i++) {
        if (i) await key('ArrowDown');
        const fit = await guest(`const p=d.querySelector('.oc-sdk-popup'),r=p.getBoundingClientRect(),n=p.querySelector('[data-active="true"]'),a=n.getBoundingClientRect(),top=Math.max(a.top,r.top+1,0),bottom=Math.min(a.bottom,r.bottom-1,w.innerHeight),left=Math.max(a.left,r.left+1,0),right=Math.min(a.right,r.right-1,w.innerWidth),hit=d.elementFromPoint((left+right)/2,(top+bottom)/2);return {frame:w.innerHeight,popup:r.toJSON(),option:a.toJSON(),id:n.id,visible:bottom>top&&right>left&&!!hit&&n.contains(hit),scroll:p.scrollHeight,client:p.clientHeight}`);
        check(`picker:${height}:option-${i}:reachable`, fit.visible && fit.popup.top >= 0 && fit.popup.bottom <= fit.frame && fit.popup.left >= 0 && fit.popup.right <= 190, fit);
      }
      const lastId = await guest<string>(`return d.querySelector('.oc-sdk-popup [data-active="true"]').id`);
      await key('Home');
      const wheel = await evaluate(`(()=>{const f=frame('status'),r=f.contentDocument.querySelector('.oc-sdk-popup').getBoundingClientRect(),b=f.getBoundingClientRect();return {x:b.x+r.x+r.width/2,y:b.y+r.y+r.height/2}})()`);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel, deltaX: 0, deltaY: 10000 });
      await wait(`(()=>{const p=d.querySelector('.oc-sdk-popup');return p.scrollTop+p.clientHeight>=p.scrollHeight-1})()`);
      check(`picker:${height}:wheel-reaches-last`, await guest(`const p=d.querySelector('.oc-sdk-popup'),r=p.getBoundingClientRect(),n=d.getElementById(${javascriptLiteral(lastId)}),a=n.getBoundingClientRect();return Math.min(a.bottom,r.bottom)>Math.max(a.top,r.top)`));
      await click(`[role="option"][id=${JSON.stringify(lastId)}]`);
      await wait(`!d.querySelector('[role="listbox"]')&&d.querySelector('[data-testid="plan-finished"]')`);
      check(`picker:${height}:last-option-clicked`, true);
      await click('[data-testid="status-plan-selector"] button'); await wait(`d.querySelector('[role="listbox"]')`);
      await key('Home'); await key('Enter');
      await wait(`d.querySelector('[data-testid="plan-main"]')`);
    }
    for (const locale of ['en', 'ru', 'zh-CN']) for (const width of [190, 280, 390]) for (const mode of ['light', 'dark']) {
      await evaluate(`${mode === 'light' ? 'delete qa.ctx.theme;' : ''}qa.show('status',${javascriptLiteral(width)});qa.ready('status',${javascriptLiteral({ locale, ...(mode === 'dark' ? { theme: { mode: 'dark', tokens: dark } } : {}) })})`);
      await wait(`d.documentElement.lang===${javascriptLiteral(locale)}&&d.documentElement.dataset.ocTheme===${javascriptLiteral(mode)}`);
      const m = await guest(`const r=d.querySelector('[data-testid="progress-root"]');return {height:r.getBoundingClientRect().height,overflow:d.documentElement.scrollWidth>w.innerWidth+1,text:r.innerText,bar:d.querySelector('[data-testid="progress-bar"]')?.getAttribute('aria-label')}`);
      measurements.push({ locale, width, mode, ...m });
      await fractionFits(`${locale}:${width}:${mode}`);
      check(`${locale}:${width}:${mode}:height-and-wrap`, !m.overflow && m.height <= GUEST_STATUS_SECTION_HEIGHT_MAX, m);
      check(`${locale}:${width}:${mode}:removed-rows`, await guest(`return !d.querySelector('[data-testid="state-chip"],[data-testid="current-work"],[data-testid="subagent-activity"],[data-testid="more-plans"],[data-testid="incomplete-counts"]')`));
      check(`${locale}:${width}:${mode}:fresh-no-time`, await guest(`return !d.querySelector('time,[data-testid="status-stale-time"]')`));
      check(`${locale}:${width}:${mode}:summary`, !!m.bar && await guest(`return d.querySelector('[data-testid="counts"]').dataset.total==='3'`), m.bar);
      await shot(`status-${locale}-${width}-${mode}`);
    }
    await evaluate(`qa.show('status',390);qa.ready('status',${javascriptLiteral({ locale: 'en', theme: { mode: 'dark', tokens: dark } })})`);
    await wait(`d.documentElement.lang==='en'`);
    await evaluate(`qa.show('status',322)`); await shot('status-readme-dark');
    await evaluate(`qa.show('status',390)`);
    await click('[data-testid="status-plan-selector"] button');
    await wait(`d.querySelector('[role="listbox"]')`);
    await click('[role="option"][id$="/multi"]');
    await wait(`d.querySelector('[data-testid="counts"]')?.dataset.done==='12'&&d.querySelector('[data-testid="counts"]')?.dataset.total==='148'`);
    for (const locale of ['en', 'ru', 'zh-CN']) for (const width of [190, 280, 390]) {
      await evaluate(`qa.show('status',${javascriptLiteral(width)});qa.ready('status',${javascriptLiteral({ locale })})`);
      await wait(`d.documentElement.lang===${javascriptLiteral(locale)}`);
      await fractionFits(`multi:${locale}:${width}`);
      await shot(`status-multi-${locale}-${width}`);
    }
    await evaluate(`qa.show('status',390);qa.ready('status',{locale:'en'})`);
    await wait(`d.documentElement.lang==='en'`);
    await click('[data-testid="status-plan-selector"] button');
    await wait(`d.querySelector('[role="listbox"]')`);
    await click('[role="option"][id$="-automatic"]');
    await wait(`d.querySelector('[data-testid="plan-main"] [data-testid="counts"]')?.dataset.total==='3'`);
    // A dedicated selected session makes this a direct zero-total render regression,
    // independent of an extra plan-picker interaction in the short Status frame.
    await evaluate(`qa.context('skipped-session')`);
    await wait(`d.querySelector('[data-testid="plan-skipped-only"] [data-testid="counts"]')?.dataset.skipped==='1'`);
    for (const locale of ['ru', 'en', 'zh-CN']) for (const width of [190, 280, 390]) {
      await evaluate(`qa.show('status',${javascriptLiteral(width)});qa.ready('status',${javascriptLiteral({ locale })})`);
      await wait(`d.documentElement.lang===${javascriptLiteral(locale)}`);
      const prose = await guest(`const n=d.querySelector('[data-testid="counts"]'),r=n.getBoundingClientRect(),card=n.closest('.ap-status-plan').getBoundingClientRect();return {right:r.right,cardRight:card.right,scroll:d.documentElement.scrollWidth,width:w.innerWidth,total:n.dataset.total,skipped:n.dataset.skipped,bar:!!d.querySelector('[data-testid="progress-bar"]')}`);
      check(`skipped-only:${locale}:${width}:summary-wraps`, prose.right <= prose.cardRight && prose.scroll <= prose.width && prose.total === '0' && prose.skipped === '1' && !prose.bar, prose);
      await shot(`status-skipped-only-${locale}-${width}`);
    }
    await evaluate(`qa.show('status',390);qa.ready('status',{locale:'en'})`);
    await wait(`d.documentElement.lang==='en'`);
    await evaluate(`qa.context('M')`);
    await wait(`d.querySelector('[data-testid="plan-main"] [data-testid="counts"]')?.dataset.total==='3'`);
    const ageBoundary = Date.parse(f.store.get(f.source.id, 'main')!.reportedAt) + 3_600_000;
    const ageRevision = await guest(`return d.querySelector('[data-testid="plan-main"]').dataset.revision`);
    await wait(`d.defaultView.parent.qa.responses.length===d.defaultView.parent.qa.requests.length`);
    await guest(`w.__qaStatusNow=w.Date.now;w.Date.now=()=>${javascriptLiteral(ageBoundary - 1)};return true`);
    await observedPoll();
    check('age-boundary:fresh-before-hour', await guest(`return !d.querySelector('[data-testid="status-stale-time"]')`));
    await guest(`w.Date.now=()=>${javascriptLiteral(ageBoundary + 1)};return true`);
    await observedPoll();
    await wait(`!!d.querySelector('[data-testid="status-stale-time"]')`);
    const ageFacts = await guest(`return {shown:!!d.querySelector('[data-testid="status-stale-time"]'),revision:d.querySelector('[data-testid="plan-main"]').dataset.revision,now:w.Date.now(),boundary:${javascriptLiteral(ageBoundary)}}`);
    check('age-boundary:unchanged-poll-shows-time', ageFacts.shown && ageFacts.revision === ageRevision, ageFacts);
    await guest(`w.Date.now=w.__qaStatusNow;delete w.__qaStatusNow;return true`);
    await observedPoll();
    await wait(`!d.querySelector('[data-testid="status-stale-time"]')`);
    // Keyboard uses real Tab/Enter/Escape; a fresh pointer lookup is used after each paint.
    await evaluate(`document.querySelector('#outside').focus()`);
    await key('Tab');
    await wait(`d.activeElement?.closest('[data-testid="status-plan-selector"]')`);
    await key('Enter'); await wait(`d.querySelector('[role="listbox"]')`);
    check('automatic-first', await guest(`return d.querySelector('[role="option"]')?.textContent.includes('Automatic')`));
    await key('Escape');
    await wait(`!d.querySelector('[role="listbox"]')&&d.activeElement?.closest('[data-testid="status-plan-selector"]')`);
    await key('Tab'); await key('Enter');
    await wait(`d.defaultView.parent.qa.messages.some(m=>m.surface==='status'&&m.type==='open-surface')`);
    check('keyboard-needs-you-opens-rail', await evaluate(`qa.messages.some(m=>m.surface==='status'&&m.type==='open-surface')`));
    await key('Tab'); await key('Enter');
    check('open-progress-keyboard', await guest(`return d.activeElement?.closest('[data-testid="open-detail"]')!==null`));
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await click('[data-testid="status-plan-selector"] button', true);
    await wait(`d.querySelector('[role="listbox"]')`);
    await key('Escape');
    check('phone-tap-picker', await guest(`return !d.querySelector('[role="listbox"]')`));
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 844, deviceScaleFactor: 1, mobile: false });
    const frames = await c.send('Page.getFrameTree');
    const frameId = frames.frameTree.childFrames.find((f: any) => f.frame.url.includes('/ui/status/')).frame.id;
    const tree = await c.send('Accessibility.getFullAXTree', { frameId });
    writeFileSync(join(artifacts, 'accessibility.json'), JSON.stringify(tree, null, 2));
    check('accessible-controls-and-summary', tree.nodes.some((n: any) => n.name?.value === 'Open progress') && tree.nodes.some((n: any) => n.name?.value?.includes('1 needs you')) && tree.nodes.some((n: any) => n.name?.value?.includes('remaining')));
    old = true; await refresh(); await wait(`d.querySelector('[data-testid="status-stale-time"]')`);
    await shot('status-stale');
    await narrowStates('status-stale');
    old = false; f.store.setEnabled(false); await refresh(); await wait(`d.querySelector('[data-testid="capture-off"]')`);
    await shot('status-recording-off');
    await narrowStates('status-recording-off');
    f.store.setEnabled(true); await refresh(); await wait(`!d.querySelector('[data-testid="capture-off"]')`);
    partial = true; await refresh(); await wait(`d.querySelector('[data-testid="needs-you-count"]')?.dataset.exact==='false'`);
    check('partial-plus-without-note', await guest(`return d.querySelector('[data-testid="needs-you-count"]').textContent.includes('1+')&&!d.querySelector('[data-testid="incomplete-counts"]')`));
    await shot('status-partial');
    partialZero = true; await refresh(); await wait(`!d.querySelector('[data-testid="needs-you-count"]')`);
    for (const locale of ['en', 'ru', 'zh-CN']) for (const width of [190, 280, 390]) {
      await evaluate(`qa.show('status',${width});qa.ready('status',${javascriptLiteral({ locale })})`);
      await wait(`d.documentElement.lang===${javascriptLiteral(locale)}`);
      check(`incomplete-zero:${locale}:${width}:no-badge`, await guest(`return !d.querySelector('[data-testid="needs-you-count"]')&&!/\\b0\\+/.test(d.body.textContent)`));
      const tree = await c.send('Accessibility.getFullAXTree', { frameId });
      check(`incomplete-zero:${locale}:${width}:accessible-no-zero-plus`, !tree.nodes.some((n: any) => /\b0\+/.test(n.name?.value ?? '')));
      await shot(`status-incomplete-zero-${locale}-${width}`);
    }
    partialZero = false; partial = false;
    await evaluate(`qa.show('status',390);qa.ready('status',{locale:'en'})`);
    await refresh(); await wait(`d.querySelector('[data-testid="needs-you-count"]')?.dataset.exact==='true'`);
    for (const lifecycle of ['finished', 'cancelled', 'failed', 'group', 'long']) {
      await click('[data-testid="status-plan-selector"] button'); await wait(`d.querySelector('[role="listbox"]')`);
      await click(`[role="option"][id$="/${lifecycle}"]`);
      await wait(`d.querySelector(${javascriptLiteral(`[data-testid="plan-${lifecycle}"]`)})`);
      check(`lifecycle:${lifecycle}`, await guest(`return d.querySelector('[data-testid="status-activity"]').textContent.includes(${javascriptLiteral(lifecycle === 'finished' ? 'Finished' : lifecycle === 'group' || lifecycle === 'long' ? 'running' : lifecycle === 'cancelled' ? 'Cancelled' : 'Failed')})`));
      await shot(`status-${lifecycle}`);
      await narrowStates(`status-${lifecycle}`);
    }
    for (const path of ['/v1/plan', '/v1/subagent-runs']) {
      await evaluate(`qa.faults=${javascriptLiteral([{ kind: 'service', surface: 'status', path }])}`);
      await reload();
      await wait(`d.querySelector(${javascriptLiteral(path === '/v1/plan' ? '[data-testid="status-detail-unavailable"]' : '[data-testid="status-runs-error"]')})`);
      await shot(path === '/v1/plan' ? 'status-detail-error' : 'status-runs-error');
      await narrowStates(path === '/v1/plan' ? 'status-detail-error' : 'status-runs-error');
    }
    await evaluate(`qa.faults=[]`); await reload(); await wait(`d.querySelector('[data-testid="counts"]')`);
    await evaluate(`qa.faults=[{kind:'service',surface:'status',path:'/v1/plans'}]`); await refresh();
    await wait(`d.querySelector('[data-testid="stale-banner"]')`);
    await shot('status-refresh-error');
    await narrowStates('status-refresh-error');
    await evaluate(`qa.faults=[]`); await click('[data-testid="status-retry"] button');
    await wait(`!d.querySelector('[data-testid="stale-banner"]')`);
    empty = true; await refresh(); await wait(`d.querySelector('[data-testid="empty-state"]')`); await narrowStates('status-empty');
    await evaluate(`qa.context(null)`); await wait(`d.querySelector('[data-testid="unscoped-state"]')`); await narrowStates('status-no-session');
    setup = true; await evaluate(`qa.context('M')`); await reload(); await wait(`d.querySelector('[data-testid="setup-needed"]')`); await narrowStates('status-setup');
    setup = false; await evaluate(`qa.holds=[{kind:'service',surface:'status',path:'/v1/plans',tag:'loading'}]`); await reload();
    await wait(`d.querySelector('[data-testid="state-loading"]')`);
    await narrowStates('status-loading');
    await evaluate(`qa.faults=[{kind:'service',surface:'status',path:'/v1/plans'}];qa.release('loading')`);
    await wait(`d.querySelector('[data-testid="state-busy"]')`);
    await narrowStates('status-initial-error');
    check('no-map-or-search-traffic', await evaluate(`!qa.requests.some(r=>r.surface==='status'&&['/v1/search','/v1/plan-graph'].includes(r.path))`));
    check('no-browser-exceptions', c.errors.length === 0, c.errors);
  } catch (e) { failure = String(e); throw e; }
  finally {
    writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ failure, checks, measurements, browserErrors: c.errors, browser: browser.version, host: 'synthetic', service: 'disposable real HTTP/SQLite', limits: 'No native host, physical phone or screen-reader speech certification.' }, null, 2));
    await browser.stop(); await fixture.stop(); service.closeAllConnections(); await new Promise<void>(r => service.close(() => r())); f.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
