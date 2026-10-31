/** Test-only readiness and native coordinate-input seams. No host state injection. */
export interface NativeAdapter {
  evaluate(expression: string, frame?: string): Promise<any>;
  send(method: string, params?: object): Promise<any>;
  wait(condition: () => Promise<boolean>, ms?: number): Promise<boolean>;
}

/** Two rendered samples must agree, not merely the outer iframe rectangle. */
export async function stableScreenshot<T extends { ready: boolean; signature: string }>(adapter: NativeAdapter, read: () => Promise<T>, record: (sample: T) => void) {
  let previous: string | undefined, snapshot: T | undefined;
  if (!await adapter.wait(async () => {
    snapshot = await read(); record(snapshot);
    const stable = snapshot.ready && previous === snapshot.signature;
    previous = snapshot.ready ? snapshot.signature : undefined;
    return stable;
  })) throw new Error('native-screenshot-state-not-stable');
  return snapshot!;
}

/** Read in the guest after a rendering handshake; never includes text or IDs. `target` is the
 * element to clip (the sub-agents section, or the frame's main for a view that must have none). */
export function screenshotSection(target: string, observation: string | null) {
  const section = document.querySelector<HTMLElement>(target);
  const r = section?.getBoundingClientRect();
  const mark = observation ? section?.querySelector<HTMLElement>(observation) : null;
  const animating = section?.getAnimations({ subtree: true }).some(a => (a.pending || a.playState === 'running') && a.effect?.getTiming().iterations !== Infinity) ?? false;
  const roster = section?.dataset.testid === 'subagent-activity';
  const settled = !!section && (!roster || section.dataset.state === 'ready') &&
    (!observation || !!mark) && !animating && document.fonts.status === 'loaded' && document.visibilityState === 'visible';
  // The whole section must be inside the frame: a frame the host has not grown yet (or left small)
  // would otherwise be captured as a clipped strip.
  const fits = !!r && r.y >= -1 && r.y + r.height <= innerHeight + 1;
  return { ready: settled && fits, settled, fits,
    observationPresent: !observation || !!mark, state: mark?.dataset.state, animating,
    x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0, viewportHeight: innerHeight };
}

/**
 * Why a screenshot would not show its whole section, or null when it would. `inner` is the last
 * screenshotSection() sample; `clipHeight`/`sectionHeight` are host-page pixels.
 */
export function partialCapture(name: string, inner: { settled?: boolean; fits?: boolean; y: number; height: number; viewportHeight: number } | undefined, clipHeight?: number, sectionHeight?: number) {
  if (inner?.settled && inner.fits === false) return `${name}: partial capture (frame ${Math.round(inner.viewportHeight)} px, section ends at ${Math.round(inner.y + inner.height)} px)`;
  if (clipHeight !== undefined && sectionHeight !== undefined && clipHeight < sectionHeight - 1) return `${name}: partial capture (clip ${Math.round(clipHeight)} of ${Math.round(sectionHeight)} px)`;
  return null;
}

/** Host-side frame geometry/transition readiness, without reading its URL back. */
export function screenshotFrame(href: string) {
  const frame = Array.from(document.querySelectorAll('iframe')).find(f => f.src === href);
  let animating = false;
  for (let node: Element | null = frame ?? null; node; node = node.parentElement)
    animating ||= node.getAnimations().some(a => (a.pending || a.playState === 'running') && a.effect?.getTiming().iterations !== Infinity);
  const r = frame?.getBoundingClientRect();
  return { ready: !!frame && document.visibilityState === 'visible' && !animating &&
    !frame.closest('[hidden],[inert],[aria-hidden="true"]') && getComputedStyle(frame).visibility === 'visible',
    animating, x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0,
    clientWidth: frame?.clientWidth ?? 0, clientHeight: frame?.clientHeight ?? 0 };
}

export interface RosterIds { a: string; b: string; c1: string; c2: string; bound: string; n1: string }
/**
 * Executed in the guest in one turn, so readiness and the asserted rows agree. Sub-agent runs
 * revision 1: rows by run/session with their Ran/Claimed/Accepted facts. Returns session IDs (the
 * caller maps them to roles), state tokens and booleans; never titles, handoff or task text.
 */
export function rosterSnapshot(ids: RosterIds) {
  // The removed copy, exactly and case-sensitively: a dispatch description may say "unassigned".
  const CLUTTER = /Unassigned (?:in this plan|here)|No update reported|No task recorded here|This session|Main session|seen just now|only the first \d+|may be incomplete|Unknown now/;
  const section = document.querySelector<HTMLElement>('[data-testid="subagent-activity"]');
  const rows = Array.from(section?.querySelectorAll<HTMLElement>('[data-testid^="subagent-row-"]') ?? []).map(r => ({
    session: r.dataset.session ?? null, recorded: !!r.dataset.run, ran: r.dataset.ran ?? null, now: r.dataset.now ?? null, depth: r.dataset.depth ?? null,
    featured: !r.closest('[data-testid="observed-more"]'),
    facts: Array.from(r.querySelectorAll<HTMLElement>('[data-fact]')).map(f => f.dataset.fact!),
  }));
  const summary = Array.from(section?.querySelectorAll<HTMLElement>('[data-testid="subagent-count"] [data-kind]') ?? []).map(n => n.dataset.kind!);
  const text = section?.textContent ?? '';
  const ready = !!document.querySelector('[data-testid="plan-plan-alpha"]') &&
    !document.querySelector('[data-testid="detail-loading"], [data-testid="failure-state"], [data-testid="setup-needed"]') &&
    section?.dataset.state === 'ready' && summary.length > 0 &&
    rows.some(r => r.session === ids.bound && r.featured && r.facts.includes('accepted'));
  return {
    ready, rows, summary,
    // The owner's removed clutter, and prompt/output/raw-error canaries of the native fixture.
    clutter: CLUTTER.test(text),
    /** Which fixed clutter phrase matched (vocabulary only, never page text). */
    clutterMatch: text.match(CLUTTER)?.[0] ?? null,
    canary: /Synthetic fixed|regression input|provider failure/i.test(text),
    overflow: document.documentElement.scrollWidth > innerWidth,
  };
}

export async function readyRosterSnapshot(adapter: NativeAdapter, frame: string, ids: RosterIds) {
  let snapshot: ReturnType<typeof rosterSnapshot> | undefined;
  const ready = await adapter.wait(async () => {
    snapshot = await adapter.evaluate(`(${rosterSnapshot.toString()})(${JSON.stringify(ids)})`, frame);
    return snapshot!.ready;
  });
  if (!ready) throw new Error('current-plan-roster-readiness-timeout');
  return snapshot!;
}

/** Executed in the host; inspect all representations, never trust the first box. */
export function actionablePoint(targets: Element[], scroll: boolean) {
  for (const target of targets) {
    if (!target?.isConnected || target.closest('[inert], [hidden], [disabled], [aria-hidden="true"]')) continue;
    let disabled = false;
    for (let node: Element | null = target; node; node = node.parentElement) {
      // The host's drag wrapper disables dragging independently of its nested
      // session-selection button. It does not disable that button's action.
      if (node.getAttribute('aria-disabled') === 'true' &&
        !(node !== target && node.getAttribute('aria-roledescription') === 'draggable')) disabled = true;
    }
    if (disabled) continue;
    const style = getComputedStyle(target);
    if (style.display === 'none' || style.visibility !== 'visible' || style.pointerEvents === 'none' || Number(style.opacity) === 0) continue;
    if (scroll) target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const r = target.getBoundingClientRect();
    const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    if (right <= left || bottom <= top) continue;
    const x = (left + right) / 2, y = (top + bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !target.contains(hit)) continue;
    // A nested menu/remove control is not the session-selection surface.
    const control = hit.closest('button, a, input, select, textarea, [role="button"]');
    if (control && control !== target && target.contains(control)) continue;
    return { x, y };
  }
  return null;
}

export const sessionTargets = (id: string) => `[...document.querySelectorAll(${JSON.stringify(`[data-session-row="${id}"] [data-session-row-main]`)})]`;

/** Poll state only; a blocked ancestor must clear before any input is sent. */
export async function waitForActionable(adapter: NativeAdapter, targets: string, label: string) {
  let accepted: { x: number; y: number } | null = null;
  const point = (scroll: boolean) => adapter.evaluate(`(${actionablePoint.toString()})(${targets},${scroll})`);
  if (!await adapter.wait(async () => {
    if (!await point(true)) return false;
    // Scrolling may replace the target: resolve and hit-test again before dispatch.
    accepted = await point(false);
    return !!accepted;
  })) throw new Error(`${label}: non-actionable-target`);
  return accepted!;
}

export function nativeActions(adapter: NativeAdapter) {
  const point = (targets: string, scroll: boolean) => adapter.evaluate(`(${actionablePoint.toString()})(${targets},${scroll})`);
  const click = async (targets: string, label: string) => {
    const accepted = await waitForActionable(adapter, targets, label);
    for (const type of ['mousePressed', 'mouseReleased']) await adapter.send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...accepted });
  };
  const selected = (id: string) => adapter.evaluate(`location.href.includes(${JSON.stringify(id)})`);
  const select = async (id: string, label: string) => {
    // The host retains non-interactive sidebar rows while closed. Reveal it
    // through its real toggle, only when the read-only pressed state says closed.
    if (await adapter.evaluate(`document.querySelector('[data-sidebar-toggle]')?.getAttribute('aria-pressed')==='false'`))
      await click(`[...document.querySelectorAll('[data-sidebar-toggle]')]`, `${label}: reveal sessions`);
    await click(sessionTargets(id), label);
    if (!await adapter.wait(() => selected(id))) throw new Error(`${label}: host-selection-timeout`);
  };
  return { click, select, selected, actionable: (targets: string) => point(targets, false) };
}

/**
 * Evidence text for a non-assertion failure: only this harness's own fixed messages are kept
 * (they carry no page text, IDs or paths); anything else is a generic code.
 */
const RUNTIME_PLAIN = new Set(['CDP connection deadline', 'CDP deadline', 'CDP evaluation failed', 'CDP request failed', 'CDP unavailable',
  'current-plan-roster-readiness-timeout', 'native-screenshot-state-not-stable', 'native-renderer-startup', 'native-application-not-ready',
  'fixture-rail-not-discovered', 'fixture-guest-not-mounted']);
const RUNTIME_LABELS = ['select B', 'return A', 'draft selection', 'work-status open', 'native page open', 'reopen native rail', 'initial root', 'fixture rail'];
const RUNTIME_LABELLED = new Set(RUNTIME_LABELS.flatMap((label) => ['', ': reveal sessions'].flatMap((via) => ['non-actionable-target', 'host-selection-timeout'].map((code) => `${label}${via}: ${code}`))));
export function runtimeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : null;
  return message !== null && (RUNTIME_PLAIN.has(message) || RUNTIME_LABELLED.has(message)) ? message : 'other-runtime-failure';
}
