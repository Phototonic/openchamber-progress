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

/** Read in the guest after a rendering handshake; never includes text or IDs. */
export function screenshotSection(census: string, observation: string | null) {
  const section = document.querySelector<HTMLElement>(census);
  const r = section?.getBoundingClientRect();
  const mark = observation ? section?.querySelector<HTMLElement>(observation) : null;
  const animating = section?.getAnimations({ subtree: true }).some(a => (a.pending || a.playState === 'running') && a.effect?.getTiming().iterations !== Infinity) ?? false;
  return { ready: !!section && section.dataset.state === 'ready' && section.dataset.complete === 'true' &&
    (!observation || !!mark) && !animating && document.fonts.status === 'loaded' && document.visibilityState === 'visible',
    observationPresent: !observation || !!mark, state: mark?.dataset.state, animating,
    x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0, viewportHeight: innerHeight };
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

/** Executed in the guest in one turn, so readiness and the asserted rows agree. */
export function assignmentSnapshot(ids: { a: string; c2: string; bound: string }) {
  const section = document.querySelector<HTMLElement>('[data-testid="subagent-activity"]');
  const rows = Array.from(section?.querySelectorAll<HTMLElement>('[data-testid^="observed-session-"]') ?? []).map(r => ({
    id: r.dataset.testid!.slice(17), depth: r.dataset.depth,
    assignment: r.querySelector<HTMLElement>('[data-assignment]')?.dataset.assignment,
    assigned: r.querySelector<HTMLElement>('[data-assignment]')?.dataset.assignment === 'assigned',
    unassigned: r.querySelector<HTMLElement>('[data-assignment]')?.dataset.assignment === 'unassigned',
  }));
  const ready = !!document.querySelector('[data-testid="plan-plan-alpha"]') &&
    !document.querySelector('[data-testid="detail-loading"], [data-testid="failure-state"], [data-testid="setup-needed"]') &&
    section?.dataset.state === 'ready' && section.dataset.complete === 'true' &&
    rows.some(r => r.id === ids.a && r.depth === '0') &&
    [ids.c2, ids.bound].every(id => rows.some(r => r.id === id && ['assigned', 'unassigned'].includes(r.assignment ?? '')));
  return { ready, rows, overflow: document.documentElement.scrollWidth > innerWidth };
}

export async function readyAssignmentSnapshot(adapter: NativeAdapter, frame: string, ids: { a: string; c2: string; bound: string }) {
  let snapshot: ReturnType<typeof assignmentSnapshot> | undefined;
  const ready = await adapter.wait(async () => {
    snapshot = await adapter.evaluate(`(${assignmentSnapshot.toString()})(${JSON.stringify(ids)})`, frame);
    return snapshot!.ready;
  });
  if (!ready) throw new Error('current-plan-assignment-readiness-timeout');
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
