/** Real disposable host, production guests and actual SDK ancestry. No injected host records. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startActivityHost } from './subagent-activity-host.ts';
import { nativeActions, readyRosterSnapshot, rosterSnapshot, screenshotFrame, screenshotSection, stableScreenshot, type RosterIds } from './subagent-activity-harness.ts';

export async function nativeProductionViews(root: string, env: Record<string, string>, ids: RosterIds, evidence: any, activity: { start(): Promise<void>; stop(): Promise<void> }) {
  const host = await startActivityHost(root, env, ids.a, true);
  evidence.host = { available: host.available, reason: host.reason, diagnostics: host.diagnostics };
  assert.ok(host.available && host.controls, 'production guest mounted');
  const { evaluate, send, frames, wait } = host.controls;
  const version = await send('Browser.getVersion'); evidence.browser = { product: version.product, protocolVersion: version.protocolVersion };
  const guestFrame = async (surface: string) => {
    let frame: string | undefined;
    assert.ok(await wait(async () => { for (const f of frames) if (await evaluate(`document.querySelector('main')?.dataset.surface==='${surface}'`, f).catch(() => false)) { frame = f; return true; } return false; }), `${surface} guest frame`);
    return frame!;
  };
  const actions = nativeActions(host.controls);
  const clickMain = (expression: string, label: string) => actions.click(`[${expression}].filter(Boolean)`, label);
  // Sanitized evidence: native IDs become fixture roles.
  const roleOf = (session: string | null) => session === null ? 'unconfirmed' : Object.entries(ids).filter(([, id]) => id === session).map(([role]) => role).join('/') || 'other-child';
  const sanitize = (r: ReturnType<typeof rosterSnapshot>) => ({ summary: r.summary, clutter: r.clutter, clutterMatch: r.clutterMatch, canary: r.canary, overflow: r.overflow, rows: r.rows.map(x => ({ ...x, session: roleOf(x.session) })) });
  const census = '[data-testid="subagent-activity"]';
  const row = (id: string) => `${census} [data-session="${id}"]`;
  const snapshot = (frame: string) => evaluate(`(${rosterSnapshot.toString()})(${JSON.stringify(ids)})`, frame) as Promise<ReturnType<typeof rosterSnapshot>>;
  /** Q-N1 browser expectations on one surface with plan-alpha in scope for A. */
  const assertRoster = (r: ReturnType<typeof rosterSnapshot>, surface: string, cap: number) => {
    evidence.lastRoster = { surface, ...sanitize(r) };
    const featured = r.rows.filter(x => x.featured);
    assert.ok(!r.clutter, `${surface}: no unassigned/no-update/root/seen-just-now/cap-warning/unknown-now copy`);
    assert.ok(!r.canary, `${surface}: no prompt, output or raw error text`);
    assert.ok(!r.overflow, `${surface}: no horizontal overflow`);
    assert.ok(!r.rows.some(x => x.session === ids.a), `${surface}: no root row for the session itself`);
    assert.ok(!r.rows.some(x => x.session === ids.b), `${surface}: the unrelated session never joins`);
    assert.ok(!r.rows.some(x => x.session === ids.n1), `${surface}: an idle child without a run or task is not listed`);
    assert.ok(featured.length <= cap, `${surface}: featured rows bounded to ${cap}`);
    const bound = r.rows.filter(x => x.session === ids.bound);
    assert.equal(bound.filter(x => x.facts.includes('accepted')).length, 1, `${surface}: the linked child's task facts appear once, on its latest run`);
    assert.ok(bound.some(x => x.featured && x.recorded && x.ran === 'finished'), `${surface}: linked child featured with its recorded native run (finished, not done)`);
    assert.ok(!featured.some(x => x.session === ids.c2), `${surface}: unassigned finished child is folded, not featured`);
    for (const kind of ['finished', 'failed', 'interrupted']) assert.ok(r.summary.includes(kind), `${surface}: summary counts ${kind} native runs`);
    assert.ok(!r.summary.includes('running') && !r.summary.includes('waiting'), `${surface}: nothing is running before the renewal turn`);
  };
  try {
    await send('Page.bringToFront');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 3600, deviceScaleFactor: 1, mobile: false });
    evidence.stage = 'panel-frame';
    let panel = await guestFrame('panel');
    evidence.stage = 'panel-roster-readiness';
    let facts;
    try { facts = await readyRosterSnapshot(host.controls, panel, ids); }
    finally { evidence.panelDiagnostic = await evaluate(`({hasMain:!!document.querySelector('main'),hasRoster:!!document.querySelector('${census}'),state:document.querySelector('${census}')?.dataset.state,hasPlan:!!document.querySelector('[data-testid="plan-plan-alpha"]'),hasFailure:!!document.querySelector('[data-testid="failure-state"]'),hasSetup:!!document.querySelector('[data-testid="setup-needed"]')})`, panel).catch(() => null); }
    evidence.panelRoster = sanitize(facts);
    evidence.stage = 'panel-roster';
    assertRoster(facts, 'rail', 6);
    // Earlier list: the child's own handoff (Claimed) and distinct failed/interrupted native runs.
    await evaluate(`(()=>{const d=document.querySelector('${census} [data-testid="observed-more"]');if(d)d.open=true;return !!d})()`, panel);
    const earlier = await snapshot(panel);
    assert.ok(earlier.rows.some(x => !x.featured && x.facts.includes('claimed')), 'rail: registered child handoff shown as Claimed');
    assert.ok(earlier.rows.some(x => x.ran === 'failed') && earlier.rows.some(x => x.ran === 'interrupted'), 'rail: failed and interrupted runs stay distinct');
    evidence.panelEarlier = sanitize(earlier);
    evidence.panel = { roster: true, threeLayers: true, linkedOnce: true, noClutter: true, noCanary: true, noHorizontalOverflow: true };
    evidence.screenshots = [];
    const shot = async (frame: string, name: string, observation: string | null = null, target = census) => {
      const started = performance.now();
      const attempt: any = { name, phase: 'foreground', samples: [] };
      evidence.screenshotAttempt = attempt;
      await send('Page.bringToFront');
      attempt.phase = 'scroll';
      await evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`, frame);
      const href = await evaluate('location.href', frame);
      await evaluate(`document.querySelectorAll('iframe').forEach(f=>{if(f.src===${JSON.stringify(href)})f.scrollIntoView({block:'center',behavior:'instant'})})`);
      attempt.phase = 'state-and-paint';
      const sample = await stableScreenshot(host.controls, async () => {
        // After foregrounding/scrolling, require both renderer turns to paint.
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`, frame);
        const outer = await evaluate(`(${screenshotFrame.toString()})(${JSON.stringify(href)})`);
        const inner = await evaluate(`(${screenshotSection.toString()})(${JSON.stringify(target)},${JSON.stringify(observation)})`, frame);
        const sx = outer.width / outer.clientWidth, sy = outer.height / outer.clientHeight;
        const clip = { x: Math.max(0, outer.x + inner.x * sx), y: Math.max(0, outer.y + inner.y * sy), width: inner.width * sx, height: Math.min(inner.height * sy, outer.height - Math.max(0, inner.y * sy)), scale: 1 };
        const ready = outer.ready && inner.ready && clip.width > 0 && clip.height > 0 && Number.isFinite(clip.width) && Number.isFinite(clip.height);
        return { ready, signature: JSON.stringify({ outer, inner, clip }), outer, inner, clip, sx, sy };
      }, sample => {
        attempt.samples.push({ elapsedMs: Math.round(performance.now() - started), ...sample });
        if (attempt.samples.length > 8) attempt.samples.shift();
      });
      const { clip, inner, sx, sy } = sample;
      attempt.phase = 'capture';
      attempt.readyMs = Math.round(performance.now() - started);
      const captureStarted = performance.now();
      let image;
      try {
        image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
      } catch (error) {
        attempt.captureMs = Math.round(performance.now() - captureStarted);
        attempt.failure = 'cdp-capture';
        attempt.hostAtFailure = await evaluate(`({visible:document.visibilityState==='visible',focused:document.hasFocus(),frames:document.querySelectorAll('iframe').length,animating:document.getAnimations().filter(a=>a.playState==='running').length})`).catch(() => ({ unavailable: true }));
        attempt.sectionAtFailure = await evaluate(`(${screenshotSection.toString()})(${JSON.stringify(target)},${JSON.stringify(observation)})`, frame).catch(() => ({ unavailable: true }));
        throw error;
      }
      attempt.captureMs = Math.round(performance.now() - captureStarted);
      attempt.phase = 'complete';
      fs.writeFileSync(`${root}/screenshots/${name}.png`, Buffer.from(image.data, 'base64'));
      evidence.screenshots.push({ name, width: Math.round(clip.width), height: Math.round(clip.height), frameScale: { x: sx, y: sy }, fullSection: clip.height >= inner.height * sy - 1, readyMs: attempt.readyMs, captureMs: attempt.captureMs });
    };
    evidence.stage = 'rail-screenshot';
    await shot(panel, 'native-rail-roster');
    await evaluate(`(()=>{const d=document.querySelector('${census} [data-testid="observed-more"]');if(d)d.open=false;return true})()`, panel);
    evidence.stage = 'status-screenshot';
    // Work Status may already be mounted but hidden; the real host toggle makes it visible.
    if (!await evaluate(`!!document.querySelector('button[aria-label="Toggle work-status panel"][aria-pressed="true"]')`))
      await clickMain(`document.querySelector('button[aria-label="Toggle work-status panel"]')`, 'work-status open');
    const status = await guestFrame('status');
    const statusRoster = await readyRosterSnapshot(host.controls, status, ids);
    assertRoster(statusRoster, 'status', 3);
    assert.ok(!await evaluate(`!!document.querySelector('[data-testid="subagent-about"]')`, status), 'status: no records disclosure on the compact card');
    evidence.statusRoster = sanitize(statusRoster);
    await shot(status, 'native-status-roster');
    evidence.status = { roster: true };
    evidence.stage = 'selection-B';
    // Defect A natively: B has a real native child (its wrong-parent dispatch) but no plan.
    await actions.select(ids.b, 'select B');
    evidence.hostSelectedB = true;
    assert.ok(await wait(() => evaluate(`!!document.querySelector('[data-testid="empty-state"]')&&!document.querySelector('${census}')&&!document.querySelector('[data-testid="subagent-count"]')`, panel)), 'no plan in scope: no section or count on the rail');
    for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 1000)); assert.ok(await evaluate(`!document.querySelector('${census}')`, panel), 'no section reappears on later refreshes'); }
    const statusB = await evaluate(`!document.querySelector('${census}')`, status).catch(() => true);
    assert.ok(statusB, 'no plan in scope: no section on Work Status');
    await shot(panel, 'native-no-plan-B', null, 'main');
    evidence.noPlan = { rail: true, status: true, laterRefreshes: 4 };
    evidence.stage = 'selection-none';
    await clickMain(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='New session')??document.querySelector('button[aria-label="New session"]')`, 'draft selection');
    const draftReady = await wait(() => evaluate(`!!document.querySelector('[data-testid="unscoped-state"]')&&!document.querySelector('${census}')`, panel).catch(() => evaluate(`document.querySelectorAll('iframe').length===0`)));
    evidence.draftDiagnostic = { productionFramesUnmounted: await evaluate(`document.querySelectorAll('iframe').length===0`) };
    assert.ok(draftReady, 'draft has no section');
    evidence.selection = { AtoBtoNone: true, railRetiresRoster: true };
    await actions.select(ids.a, 'return A');
    const railRestored = await wait(async () => { for (const f of frames) if (await evaluate(`document.querySelector('main')?.dataset.surface==='panel'`, f).catch(() => false)) return true; return false; }, 2000);
    if (!railRestored) await clickMain(`document.querySelector('[data-context-surface="plugin:activity-probe"]')`, 'reopen native rail');
    panel = await guestFrame('panel');
    assertRoster(await readyRosterSnapshot(host.controls, panel, ids), 'rail after A→B→draft→A', 6);
    evidence.stage = 'page-screenshot';
    await actions.click(`[...document.querySelectorAll('button[aria-label="Activity probe"]')].filter(b=>!b.hasAttribute('data-context-surface'))`, 'native page open');
    const page = await guestFrame('page');
    assert.ok(await wait(() => evaluate(`Boolean(document.querySelector('[data-testid="plan-row-plan-alpha"]'))`, page)), 'native page plan');
    await evaluate(`document.querySelector('[data-testid="plan-row-plan-alpha"]').click()`, page);
    const pageRoster = await readyRosterSnapshot(host.controls, page, ids);
    assertRoster(pageRoster, 'page', 10);
    evidence.pageRoster = sanitize(pageRoster);
    // Passive allowlisted SDK metadata only, to prove a real same-subscription reload happened
    // while the child kept running, and that nothing but host activity changed its word.
    await evaluate(`(()=>{const trace=[],subs=new Map();window.__u4ObservationTrace=trace;addEventListener('message',e=>{if(e.source!==parent)return;const m=e.data;if(!m||!['workspace','ready','session','directory'].includes(m.type))return;const p=m.payload,s=p?.snapshot,r=s?.sessions?.find(r=>r.id===${JSON.stringify(ids.bound)});const key=p?.subscriptionId;if(key&&!subs.has(key))subs.set(key,subs.size+1);trace.push({at:Math.round(performance.now()),type:m.type,kind:s?.kind,state:s?.state,subscription:key?subs.get(key):undefined,coverage:s?.coverage?.map(c=>c.state),bound:r?{activity:r.activity,outcome:r.outcome}:undefined});if(trace.length>200)trace.shift()});return true})()`, page);
    await shot(page, 'native-page-roster');
    evidence.page = { roster: true, planRoot: true };
    evidence.stage = 'steady-running';
    const boundNow = `${row(ids.bound)}[data-now="active"]`;
    try {
      await activity.start();
      assert.ok(await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(boundNow)}))`, page), 30000), 'a real native turn shows the linked child running again');
      const started = await evaluate('performance.now()', page);
      await shot(page, 'native-running-again', boundNow);
      // Sample until the host itself reports something else. While the latest host value for the
      // child is running, the row must say running: no time-based decay, at any elapsed time.
      // (The observer fixture ends a held turn after 15 s, so this native run cannot reach 60 s;
      // the >60 s proof is the controlled-clock and real-ticker browser regressions.)
      const samples: { elapsedMs: number; running: boolean; hostRunning: boolean; ran: string | null; accepted: boolean }[] = [];
      for (;;) {
        await new Promise(r => setTimeout(r, 500));
        const s = await evaluate(`(()=>{const rows=[...document.querySelectorAll(${JSON.stringify(row(ids.bound))})],live=rows.find(r=>r.dataset.now==='active'),latest=rows.find(r=>r.querySelector('[data-fact="accepted"]'));const t=(window.__u4ObservationTrace||[]).filter(e=>e.kind==='sessions'&&e.state==='ready'&&e.bound);return {elapsedMs:Math.round(performance.now()-${started}),running:!!live,hostRunning:t.at(-1)?.bound.activity==='running',ran:latest?.dataset.ran??null,accepted:!!latest}})()`, page);
        samples.push(s);
        if (!s.hostRunning) break;
        assert.ok(s.running, `still running at ${s.elapsedMs} ms while the host still reports running`);
        assert.ok(s.elapsedMs < 100000, 'the native turn ends within 100 s');
      }
      const during = samples.filter(x => x.hostRunning);
      assert.ok(during.length >= 2 && during.every(x => x.running), 'running for every sample while the host reports running');
      assert.ok(samples.every(x => x.ran === 'finished' && x.accepted), 'the recorded run and task facts are never rewritten by host activity');
      const trace = (await evaluate('window.__u4ObservationTrace', page)).filter((e: any) => e.kind === 'sessions');
      evidence.steadyRunning = { clockOverridden: false, realNativeTurn: true, runningForMs: during.at(-1)!.elapsedMs, samples: samples.length, everySampleRunningWhileHostRunning: true, runFactUnchanged: true,
        beyond60s: false, limitedBy: 'observer fixture held-turn deadline (15 s)', subscriptions: new Set(trace.map((e: any) => e.subscription)).size, nativeReloadDuringRun: trace.some((e: any) => e.state === 'loading' && e.at >= started && e.at <= started + during.at(-1)!.elapsedMs) };
    } finally { await activity.stop(); }
    evidence.stage = 'host-change';
    // A genuine host change (the turn ends) updates the word promptly; nothing else moves.
    const idleAt = await evaluate('performance.now()', page);
    assert.ok(await wait(() => evaluate(`!document.querySelector(${JSON.stringify(boundNow)})`, page), 5000), 'host idle removes the running-again word promptly');
    evidence.hostChangeLatencyMs = Math.round(await evaluate('performance.now()', page) - idleAt);
    const after = await readyRosterSnapshot(host.controls, page, ids);
    assertRoster(after, 'page after the turn ended', 10);
    evidence.hostChange = { promptlyUpdated: true, rosterUnchanged: true };
    evidence.defects = [];
    evidence.stage = 'complete';
  } catch (error) {
    // This module's own fixed assertion text (no page text or IDs), so a failure names its check.
    if (error instanceof assert.AssertionError) evidence.assertion = error.message;
    for (const f of frames) { const t = await evaluate('window.__u4ObservationTrace??null', f).catch(() => null); if (t) evidence.observationTrace = t; }
    for (const f of frames) evidence.boundRows = await evaluate(`[...document.querySelectorAll(${JSON.stringify(`[data-testid="subagent-activity"] [data-session="${ids.bound}"]`)})].map(r=>({ran:r.dataset.ran,now:r.dataset.now??null,featured:!r.closest('[data-testid="observed-more"]')}))`, f).then((v: any) => [...(evidence.boundRows ?? []), { surface: 'frame', rows: v }]).catch(() => evidence.boundRows);
    throw error;
  } finally {
    evidence.hostControls = await evaluate(`({surfaces:[...document.querySelectorAll('[data-context-surface]')].map(n=>n.getAttribute('data-context-surface')),buttons:[...document.querySelectorAll('button')].map(b=>({title:b.title,aria:b.getAttribute('aria-label'),text:b.textContent?.trim().slice(0,60)})).filter(b=>/status|progress|activity|new session|draft/i.test(b.title+' '+b.aria+' '+b.text))})`).catch(() => null);
    evidence.frames = await Promise.all(frames.map(f => evaluate(`({scheme:location.protocol,surface:document.querySelector('main')?.dataset.surface,hasCensus:!!document.querySelector('[data-testid="subagent-activity"]'),plan:!!document.querySelector('[data-testid="plan-plan-alpha"]')})`, f).catch(() => ({ unavailable: true }))));
    await host.stop();
  }
}
