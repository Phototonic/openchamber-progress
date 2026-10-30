/** Real disposable host, production guests and actual SDK ancestry. No injected host records. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startActivityHost } from './subagent-activity-host.ts';
import { nativeActions, readyAssignmentSnapshot, screenshotFrame, screenshotSection, stableScreenshot } from './subagent-activity-harness.ts';

export async function nativeProductionViews(root: string, env: Record<string, string>, ids: { a: string; b: string; c1: string; c2: string; bound: string; n1: string }, evidence: any, activity: { start(): Promise<void>; stop(): Promise<void> }) {
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
  try {
    await send('Page.bringToFront');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 3600, deviceScaleFactor: 1, mobile: false });
    evidence.stage = 'panel-frame';
    let panel = await guestFrame('panel');
    evidence.stage = 'panel-native-lineage';
    const selector = (id: string) => `[data-testid="observed-session-${id}"]`;
    const census = '[data-testid="subagent-activity"]';
    const lineageReady = await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector(ids.n1))}))`, panel));
    evidence.panelDiagnostic = await evaluate(`({hasMain:!!document.querySelector('main'),hasCensus:!!document.querySelector('${census}'),hasPlan:!!document.querySelector('[data-testid="plan-plan-alpha"]'),hasFailure:!!document.querySelector('[data-testid="failure-state"]'),hasSetup:!!document.querySelector('[data-testid="setup-needed"]'),testids:[...document.querySelectorAll('[data-testid]')].map(n=>n.dataset.testid).filter(s=>!s.startsWith('observed-session-')&&!s.includes('ses_'))})`, panel);
    assert.ok(lineageReady, 'native N1 row');
    evidence.stage = 'panel-assignment-readiness';
    const facts = await readyAssignmentSnapshot(host.controls, panel, ids);
    evidence.assignmentSnapshot = { ready: facts.ready, rows: facts.rows.map(r => ({ role: Object.entries(ids).filter(([, id]) => id === r.id).map(([role]) => role).join('/'), depth: r.depth, assignment: r.assignment })) };
    const assertFresh = async (frame: string, surface: string) => {
      const fresh = await evaluate(`(()=>{const s=document.querySelector('${census}'),r=document.querySelector(${JSON.stringify(selector(ids.bound))}),o=r?.querySelector('.ap-obs');return {ready:s?.dataset.state==='ready',complete:s?.dataset.complete==='true',noDisconnectedCopy:!s?.textContent.toLowerCase().includes('disconnected'),state:o?.dataset.state,remainingMs:Number(o?.dataset.expires)-performance.now()}})()`, frame);
      assert.ok(fresh.ready && fresh.complete && fresh.noDisconnectedCopy, `${surface}: ready coverage without disconnected copy`);
      assert.ok(fresh.state && fresh.state !== 'unknown' && fresh.remainingMs > 0 && fresh.remainingMs <= 60000, `${surface}: bound child is fresh/current`);
      assert.ok(await evaluate(`(()=>{const o=document.querySelector(${JSON.stringify(selector(ids.c2) + ' .ap-obs')});return !!o&&o.dataset.state!=='unknown'&&Number(o.dataset.expires)>performance.now()})()`, frame), `${surface}: unassigned child is fresh/current`);
      return fresh;
    };
    evidence.panelFresh = await assertFresh(panel, 'rail');
    for (const id of [ids.a, ids.c1, ids.c2, ids.bound, ids.n1]) assert.ok(facts.rows.some((r: any) => r.id === id));
    assert.ok(!facts.rows.some((r: any) => r.id === ids.b));
    assert.ok(facts.rows.some((r: any) => r.id === ids.c2 && r.unassigned));
    assert.ok(facts.rows.some((r: any) => r.id === ids.bound && r.assigned));
    assert.equal(facts.rows.find((r: any) => r.id === ids.n1)?.depth, '2');
    evidence.panel = { nativeLineage: true, unassigned: true, bound: true, nested: true, noHorizontalOverflow: !facts.overflow };
    evidence.screenshots = [];
    const shot = async (frame: string, name: string, observation: string | null = null) => {
      const started = performance.now();
      const attempt: any = { name, phase: 'foreground', samples: [] };
      evidence.screenshotAttempt = attempt;
      await send('Page.bringToFront');
      attempt.phase = 'scroll';
      await evaluate(`document.querySelector('${census}').scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`, frame);
      const href = await evaluate('location.href', frame);
      await evaluate(`document.querySelectorAll('iframe').forEach(f=>{if(f.src===${JSON.stringify(href)})f.scrollIntoView({block:'center',behavior:'instant'})})`);
      attempt.phase = 'state-and-paint';
      const sample = await stableScreenshot(host.controls, async () => {
        // After foregrounding/scrolling, require both renderer turns to paint.
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`, frame);
        const outer = await evaluate(`(${screenshotFrame.toString()})(${JSON.stringify(href)})`);
        const inner = await evaluate(`(${screenshotSection.toString()})(${JSON.stringify(census)},${JSON.stringify(observation)})`, frame);
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
        attempt.sectionAtFailure = await evaluate(`(${screenshotSection.toString()})(${JSON.stringify(census)},${JSON.stringify(observation)})`, frame).catch(() => ({ unavailable: true }));
        throw error;
      }
      attempt.captureMs = Math.round(performance.now() - captureStarted);
      attempt.phase = 'complete';
      fs.writeFileSync(`${root}/screenshots/${name}.png`, Buffer.from(image.data, 'base64'));
      evidence.screenshots.push({ name, width: Math.round(clip.width), height: Math.round(clip.height), frameScale: { x: sx, y: sy }, fullSection: clip.height >= inner.height * sy - 1, readyMs: attempt.readyMs, captureMs: attempt.captureMs });
    };
    evidence.stage = 'rail-screenshot';
    await shot(panel, 'native-rail-children');
    evidence.stage = 'status-screenshot';
    // Work Status may already be mounted but hidden; the real host toggle makes it visible.
    if (!await evaluate(`!!document.querySelector('button[aria-label="Toggle work-status panel"][aria-pressed="true"]')`))
      await clickMain(`document.querySelector('button[aria-label="Toggle work-status panel"]')`, 'work-status open');
    const status = await guestFrame('status');
    assert.ok(await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector(ids.n1))}))`, status)), 'status native lineage');
    evidence.statusFresh = await assertFresh(status, 'status');
    await shot(status, 'native-status-children');
    evidence.status = { nativeLineage: true };
    evidence.stage = 'selection-B';
    await actions.select(ids.b, 'select B');
    evidence.hostSelectedB = true;
    assert.ok(await wait(() => evaluate(`!document.querySelector(${JSON.stringify(selector(ids.c1))})&&!!document.querySelector(${JSON.stringify(selector(ids.b))})`, panel)), 'A rows retired on B');
    await shot(panel, 'native-selected-B');
    evidence.stage = 'selection-none';
    await clickMain(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='New session')??document.querySelector('button[aria-label="New session"]')`, 'draft selection');
    const draftReady = await wait(() => evaluate(`!!document.querySelector('[data-testid="unscoped-state"]')&&!document.querySelector('${census}')`, panel).catch(() => evaluate(`document.querySelectorAll('iframe').length===0`)));
    evidence.draftDiagnostic = { productionFramesUnmounted: await evaluate(`document.querySelectorAll('iframe').length===0`) };
    assert.ok(draftReady, 'draft retires census');
    evidence.selection = { AtoBtoNone: true, railRetiresChildren: true };
    await actions.select(ids.a, 'return A');
    const railRestored = await wait(async () => { for (const f of frames) if (await evaluate(`document.querySelector('main')?.dataset.surface==='panel'`, f).catch(() => false)) return true; return false; }, 2000);
    if (!railRestored) await clickMain(`document.querySelector('[data-context-surface="plugin:activity-probe"]')`, 'reopen native rail');
    panel = await guestFrame('panel');
    assert.ok(await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector(ids.n1))}))`, panel)), 'return A lineage');
    evidence.stage = 'page-screenshot';
    await actions.click(`[...document.querySelectorAll('button[aria-label="Activity probe"]')].filter(b=>!b.hasAttribute('data-context-surface'))`, 'native page open');
    const page = await guestFrame('page');
    assert.ok(await wait(() => evaluate(`Boolean(document.querySelector('[data-testid="plan-row-plan-alpha"]'))`, page)), 'native page plan');
    await evaluate(`document.querySelector('[data-testid="plan-row-plan-alpha"]').click()`, page);
    assert.ok(await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector(ids.n1))}))`, page)), 'page native lineage');
    evidence.pageFresh = await assertFresh(page, 'page');
    const expiry = await evaluate(`Number(document.querySelector(${JSON.stringify(selector(ids.bound) + ' .ap-obs')}).dataset.expires)`, page);
    // Passive allowlisted SDK metadata only, to distinguish real stream resets
    // or activity changes from an incorrectly renewed freshness receipt.
    await evaluate(`(()=>{const trace=[],subs=new Map();window.__u4ObservationTrace=trace;addEventListener('message',e=>{if(e.source!==parent)return;const m=e.data;if(!m||!['workspace','ready','session','directory'].includes(m.type))return;const p=m.payload,s=p?.snapshot,r=s?.sessions?.find(r=>r.id===${JSON.stringify(ids.bound)});const key=p?.subscriptionId;if(key&&!subs.has(key))subs.set(key,subs.size+1);trace.push({at:Math.round(performance.now()),type:m.type,kind:s?.kind,state:s?.state,subscription:key?subs.get(key):undefined,coverage:s?.coverage?.map(c=>c.state),bound:r?{activity:r.activity,outcome:r.outcome}:undefined,sessionPresent:m.type==='session'?!!p?.session:undefined,directoryPresent:m.type==='directory'?!!p?.directory:undefined});if(trace.length>160)trace.shift()});return true})()`, page);
    await shot(page, 'native-page-children');
    evidence.page = { nativeLineage: true, planRoot: true };
    evidence.stage = 'unknown-row';
    const becameUnknown = await wait(() => evaluate(`(()=>{const s=document.querySelector('${census}');return performance.now()>=${expiry}&&s?.dataset.state==='ready'&&s?.dataset.complete==='true'&&!!document.querySelector(${JSON.stringify(selector(ids.bound) + ' .ap-obs[data-state="unknown"]')})})()`, page), 75000);
    evidence.observationTrace = await evaluate('window.__u4ObservationTrace', page);
    evidence.expiryDiagnostic = await evaluate(`(()=>{const o=document.querySelector(${JSON.stringify(selector(ids.bound) + ' .ap-obs')});return {visibility:document.visibilityState,focused:document.hasFocus(),state:o?.dataset.state,originalExpiryPassed:performance.now()>=${expiry},lateByMs:Math.round(performance.now()-${expiry}),remainingMs:o?.hasAttribute('data-expires')?Number(o.dataset.expires)-performance.now():null}})()`, page);
    assert.ok(becameUnknown, 'native unknown row');
    assert.ok(evidence.expiryDiagnostic.lateByMs <= 15000, 'silent row expires near its original 60-second deadline');
    const reloads = evidence.observationTrace.filter((e: any) => e.kind === 'sessions');
    assert.ok(reloads.some((e: any) => e.state === 'loading') && reloads.some((e: any) => e.state === 'ready'), 'actual native reload exercised');
    assert.equal(new Set(reloads.map((e: any) => e.subscription)).size, 1, 'reload stays in the same subscription');
    assert.ok(reloads.every((e: any) => e.bound?.activity === 'idle' && e.bound?.outcome === null), 'silent child unchanged through native reload');
    await shot(page, 'native-unknown-stale', selector(ids.bound) + ' .ap-obs[data-state="unknown"]');
    const stale = await evaluate(`(()=>{const s=document.querySelector('${census}'),o=document.querySelector(${JSON.stringify(selector(ids.bound) + ' .ap-obs')});return {ready:s?.dataset.state==='ready',complete:s?.dataset.complete==='true',noDisconnectedCopy:!s?.textContent.toLowerCase().includes('disconnected'),unknown:o?.dataset.state==='unknown',expired:performance.now()>=${expiry},expiryRemoved:!o?.hasAttribute('data-expires'),lastSeenShown:!!o?.querySelector('.ap-obs-last')?.textContent.trim()}})()`, page);
    assert.ok(stale.ready && stale.complete && stale.noDisconnectedCopy && stale.unknown && stale.expired && stale.expiryRemoved && stale.lastSeenShown, 'real expiry, not lost coverage, makes the bound child unknown');
    evidence.unknown = { visible: true, clockOverridden: false, reason: 'real monotonic expiry', realFreshnessExpiryProven: true, ...stale };
    evidence.stage = 'genuine-activity-renewal';
    try {
      await activity.start();
      assert.ok(await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector(ids.bound) + ' .ap-obs[data-state="active"]')}))`, page)), 'real native activity renews the expired bound child');
      const renewed = await evaluate(`(()=>{const o=document.querySelector(${JSON.stringify(selector(ids.bound) + ' .ap-obs')}),sibling=document.querySelector(${JSON.stringify(selector(ids.c2) + ' .ap-obs')});return {active:o?.dataset.state==='active',remainingMs:Number(o?.dataset.expires)-performance.now(),newDeadline:Number(o?.dataset.expires)>${expiry},silentSiblingUnknown:sibling?.dataset.state==='unknown'}})()`, page);
      assert.ok(renewed.active && renewed.newDeadline && renewed.remainingMs > 0 && renewed.remainingMs <= 60000 && renewed.silentSiblingUnknown, 'only the changed child renews');
      evidence.renewal = { realNativeTurn: true, ...renewed };
      await shot(page, 'native-renewed-child', selector(ids.bound) + ' .ap-obs[data-state="active"]');
    } finally { await activity.stop(); }
    evidence.defects = [];
    evidence.stage = 'complete';
  } finally {
    evidence.hostControls = await evaluate(`({surfaces:[...document.querySelectorAll('[data-context-surface]')].map(n=>n.getAttribute('data-context-surface')),buttons:[...document.querySelectorAll('button')].map(b=>({title:b.title,aria:b.getAttribute('aria-label'),text:b.textContent?.trim().slice(0,60)})).filter(b=>/status|progress|activity|new session|draft/i.test(b.title+' '+b.aria+' '+b.text))})`).catch(() => null);
    evidence.frames = await Promise.all(frames.map(f => evaluate(`({scheme:location.protocol,surface:document.querySelector('main')?.dataset.surface,hasCensus:!!document.querySelector('[data-testid="subagent-activity"]'),plan:!!document.querySelector('[data-testid="plan-plan-alpha"]')})`, f).catch(() => ({ unavailable: true }))));
    await host.stop();
  }
}
