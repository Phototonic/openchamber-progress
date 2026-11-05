// Presentation primitives shared by the three surfaces (docs/ui.md Shared primitives): status
// marks, state chips, the segmented progress bar, the ⓘ info disclosure, the ⋯ plan-actions menu
// and compact warnings. Presentation only: no reads, timers, storage or reading state. Every
// string lands through textContent; colours come from host tokens in style.ts.
// Kept apart from components.ts so a guest (or a test supplement) can mount a primitive without
// the whole plan view; it depends only on the SDK kit.
import { mountMenu, type MenuHandle, type MenuItem } from '@openchamber/sdk/ui';

const SVG = 'http://www.w3.org/2000/svg';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
}

/** One SVG shape: [element, attributes]. `cut` parts are drawn in the background colour. */
type Part = [tag: 'circle' | 'path', attrs: Record<string, string | number>, role?: 'cut' | 'core'];

const RING: Part = ['circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }];
const DISC: Part = ['circle', { cx: 8, cy: 8, r: 7, fill: 'currentColor' }];
const LINE = { fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

/**
 * Task and readiness states a mark can show. Recorded statuses keep their own names; `ready` and
 * `waiting` are the readiness classes of an active plan's pending task (recorded prerequisites only).
 */
export type MarkStatus = 'pending' | 'working' | 'blocked' | 'done' | 'skipped' | 'ready' | 'waiting';

/** One distinct shape per state, so colour is never the only difference. */
const MARK_SHAPES: Record<MarkStatus, Part[]> = {
  done: [DISC, ['path', { d: 'M4.9 8.3l2.1 2.1 4.1-4.5', ...LINE, 'stroke-width': 1.8 }, 'cut']],
  working: [RING, ['circle', { cx: 8, cy: 8, r: 3, fill: 'currentColor' }, 'core']],
  blocked: [DISC, ['path', { d: 'M8 4.2v4.5', ...LINE, 'stroke-width': 2 }, 'cut'], ['circle', { cx: 8, cy: 11.5, r: 1.15, fill: 'currentColor' }, 'cut']],
  pending: [RING],
  skipped: [['circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-dasharray': '2.4 2' }], ['path', { d: 'M5.2 8h5.6', ...LINE, 'stroke-width': 1.6 }]],
  ready: [RING, ['path', { d: 'M6.7 5.3v5.4L10.8 8z', fill: 'currentColor' }]],
  waiting: [RING, ['path', { d: 'M8 5.1V8l1.9 1.3', ...LINE, 'stroke-width': 1.4 }]],
};

/**
 * Spoken name of a mark that has no adjacent equivalent text. A task is "Reported working", never
 * "Running": only sessions and sub-agents are observed running.
 */
export const MARK_LABEL: Record<MarkStatus, string> = {
  pending: 'Pending',
  working: 'Reported working',
  blocked: 'Blocked',
  done: 'Done',
  skipped: 'Skipped',
  ready: 'Ready to start',
  waiting: 'Waiting on prerequisites',
};

/** Plain interface icons (never status). Decorative unless given a name. */
export type IconName = 'info' | 'more' | 'chevron-down' | 'close' | 'warning';

const ICON_SHAPES: Record<IconName, Part[]> = {
  info: [['circle', { cx: 8, cy: 8, r: 6.3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }], ['path', { d: 'M8 7.3v3.6', ...LINE, 'stroke-width': 1.6 }], ['circle', { cx: 8, cy: 5.1, r: 0.95, fill: 'currentColor' }]],
  more: [['circle', { cx: 3.5, cy: 8, r: 1.3, fill: 'currentColor' }], ['circle', { cx: 8, cy: 8, r: 1.3, fill: 'currentColor' }], ['circle', { cx: 12.5, cy: 8, r: 1.3, fill: 'currentColor' }]],
  'chevron-down': [['path', { d: 'M4.5 6.2 8 9.8l3.5-3.6', ...LINE, 'stroke-width': 1.6 }]],
  close: [['path', { d: 'm4 4 8 8M12 4l-8 8', ...LINE, 'stroke-width': 1.6 }]],
  warning: [['path', { d: 'M8 2.4 14.2 13H1.8z', ...LINE, 'stroke-width': 1.4 }], ['path', { d: 'M8 6.4v3', ...LINE, 'stroke-width': 1.6 }], ['circle', { cx: 8, cy: 11.2, r: 0.9, fill: 'currentColor' }]],
};

/** A decorative inline SVG: hidden from accessibility, never focusable. */
function svg(parts: Part[], className: string) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', className);
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const [tag, attrs, role] of parts) {
    const p = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, String(v));
    if (role) p.setAttribute('class', `ap-mark-${role}`);
    s.append(p);
  }
  return s;
}

export interface MarkOptions {
  /** Spoken name; defaults to MARK_LABEL. Ignored when decorative. */
  label?: string;
  /** True when adjacent text already says the status: the mark is then hidden from accessibility. */
  decorative?: boolean;
  /** Extra class names on the root (for example `ap-glyph` for existing row hooks). */
  className?: string;
}

/**
 * Status mark: `<span data-testid="status-mark" data-status>` around a decorative SVG. Named
 * (`role="img"`) unless `decorative`; never a tab stop.
 */
export function statusMark(status: MarkStatus, options: MarkOptions = {}): HTMLSpanElement {
  const root = node('span', `ap-mark${options.className ? ` ${options.className}` : ''}`);
  root.dataset.testid = 'status-mark';
  root.dataset.status = status;
  if (options.decorative) root.setAttribute('aria-hidden', 'true');
  else {
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', options.label ?? MARK_LABEL[status]);
  }
  root.append(svg(MARK_SHAPES[status], 'ap-mark-svg'));
  return root;
}

/** Interface icon (not a status). Decorative unless `label` is given. */
export function icon(name: IconName, label?: string): HTMLSpanElement {
  const root = node('span', 'ap-icon');
  root.dataset.icon = name;
  if (label) { root.setAttribute('role', 'img'); root.setAttribute('aria-label', label); }
  else root.setAttribute('aria-hidden', 'true');
  root.append(svg(ICON_SHAPES[name], 'ap-icon-svg'));
  return root;
}

export interface StateChipOptions {
  /** The state this chip counts; also its mark. */
  state: MarkStatus;
  /** Whole-plan count; a zero chip is not drawn. */
  count: number;
  /** State word shown after the count, e.g. "Needs you". */
  label: string;
  /** Interactive chips only: whether this state is the current filter. */
  pressed?: boolean;
  /** Present → a native toggle button (Enter/Space/click activate once). Absent → informational text. */
  onToggle?: () => void;
}

/**
 * One state count. Interactive: the root is a native `<button aria-pressed>` whose name is its
 * visible text ("1 Needs you"). Informational: a plain `<span>` with no role or tab stop.
 * Returns null for a zero count: zero chips are absent, not hidden.
 */
export function stateChip(options: StateChipOptions): HTMLButtonElement | HTMLSpanElement | null {
  const count = Math.max(0, Math.trunc(options.count));
  if (!Number.isFinite(count) || count === 0) return null;
  const root = options.onToggle ? node('button', 'ap-state-chip') : node('span', 'ap-state-chip');
  root.dataset.testid = 'state-chip';
  root.dataset.state = options.state;
  root.dataset.count = String(count);
  root.append(statusMark(options.state, { decorative: true }), node('b', 'ap-state-chip-n', String(count)), node('span', 'ap-state-chip-label', options.label));
  if (root instanceof HTMLButtonElement) {
    root.type = 'button';
    root.setAttribute('aria-pressed', String(Boolean(options.pressed)));
    const run = options.onToggle!;
    root.addEventListener('click', () => run());
  }
  return root;
}

/**
 * A labelled group around state chips (the legend and, when interactive, the filter). Its hook
 * deliberately avoids the `state-` prefix, which names read-failure states elsewhere.
 */
export function stateChips(label: string, chips: (HTMLElement | null)[]): HTMLDivElement | null {
  const shown = chips.filter((c): c is HTMLElement => c !== null);
  if (!shown.length) return null;
  const group = node('div', 'ap-state-chips');
  group.dataset.testid = 'progress-chips';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  group.append(...shown);
  return group;
}

export interface BarCounts { done: number; total: number; working: number; blocked: number }

/**
 * The segmented progress bar: done, reported working and blocked over the task total; the track is
 * the rest. Decorative segments carry `data-status` for tests; the bar's accessible name is the
 * caller's summary sentence. Static widths, never animated. Null when there is nothing to divide
 * (no zero-denominator percentage).
 */
export function segmentedBar(counts: BarCounts, label: string): HTMLDivElement | null {
  const total = Number.isFinite(counts.total) ? counts.total : 0;
  if (total <= 0) return null;
  const bar = node('div', 'ap-seg');
  bar.dataset.testid = 'progress-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', label);
  for (const [k, n] of [['done', counts.done], ['working', counts.working], ['blocked', counts.blocked]] as const) {
    if (!(n > 0)) continue;
    const seg = node('i');
    seg.dataset.k = k;
    seg.dataset.status = k;
    seg.setAttribute('aria-hidden', 'true');
    seg.style.width = `${(Math.min(n, total) / total) * 100}%`;
    bar.append(seg);
  }
  return bar;
}

let infoCount = 0;

export interface InfoOptions {
  /** Contextual accessible name of the trigger, e.g. "About readiness". */
  label: string;
  /** Explanation; strings become paragraphs. Literal text only. */
  content: string | string[] | Node;
  /**
   * Initial state, for an owner that keeps it across a repaint of the same reading. Content opened
   * before the root is attached is positioned once it is attached (within about a second; a later
   * `open()` positions it again).
   */
  open?: boolean;
  /** Called after a user action opens or closes it. */
  onToggle?: (open: boolean) => void;
}

export interface InfoHandle {
  root: HTMLSpanElement;
  trigger: HTMLButtonElement;
  content: HTMLDivElement;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  /** Closes and removes every listener; the root stays wherever the owner put it. */
  dispose: () => void;
}

/**
 * The ⓘ info disclosure for generic caveats (never warnings, which stay visible). A native button
 * opens it on keyboard focus (without moving focus) or click; the content follows the trigger in
 * Tab order, so its controls are reachable. Escape closes and keeps focus on the trigger without
 * reopening it; focus leaving or an outside press dismisses. Not a dialog: no focus trap. Not a
 * host popup: no `aria-haspopup`, so it never defers the frame's repaint.
 */
export function infoDisclosure(options: InfoOptions): InfoHandle {
  const id = `ap-info-${infoCount += 1}`;
  const root = node('span', 'ap-info');
  root.dataset.testid = 'info-disclosure';
  const trigger = node('button', 'ap-info-btn');
  trigger.type = 'button';
  trigger.dataset.testid = 'info-trigger';
  trigger.setAttribute('aria-label', options.label);
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  // The explanation is also the trigger's description, so it is spoken on focus.
  trigger.setAttribute('aria-describedby', id);
  trigger.append(icon('info'));
  const content = node('div', 'ap-info-content');
  content.id = id;
  content.dataset.testid = 'info-content';
  content.hidden = true;
  // Pressing on the text (to select or copy it) keeps focus inside, so it stays open.
  content.tabIndex = -1;
  const body = options.content;
  if (typeof body === 'string' || Array.isArray(body)) for (const p of typeof body === 'string' ? [body] : body) content.append(node('p', '', p));
  else content.append(body);
  root.append(trigger, content);

  let isOpen = false;
  let disposed = false;
  // A pointer press focuses the trigger first; its click (not that focus) decides.
  let pressing = false;
  // After Escape the trigger keeps focus; that is not a fresh focus, so it must not reopen.
  let quiet = false;

  const onOutside = (event: Event) => {
    if (!root.isConnected) { setOpen(false, false); return; }
    if (event.target instanceof Node && root.contains(event.target)) return;
    setOpen(false, true);
  };
  const place = () => {
    content.style.removeProperty('--ap-info-shift');
    const r = content.getBoundingClientRect();
    const max = document.documentElement.clientWidth - 8;
    const shift = r.right > max ? Math.max(8 - r.left, max - r.right) : r.left < 8 ? 8 - r.left : 0;
    if (shift) content.style.setProperty('--ap-info-shift', `${Math.round(shift)}px`);
  };
  // Opened before the owner attached the root (a restored-open repaint): place it once it is in
  // the document. A short, bounded frame wait; nothing keeps running for a root never attached.
  let pending = 0;
  const unschedule = () => { if (pending) cancelAnimationFrame(pending); pending = 0; };
  const placeWhenAttached = () => {
    if (root.isConnected) { unschedule(); place(); return; }
    if (pending) return;
    let frames = 0;
    const step = () => {
      pending = 0;
      if (disposed || !isOpen) return;
      if (root.isConnected) place();
      else if (++frames < 60) pending = requestAnimationFrame(step);
    };
    pending = requestAnimationFrame(step);
  };
  function setOpen(next: boolean, user: boolean) {
    if (disposed || next === isOpen) return;
    isOpen = next;
    content.hidden = !next;
    trigger.setAttribute('aria-expanded', String(next));
    root.toggleAttribute('data-open', next);
    if (next) {
      document.addEventListener('pointerdown', onOutside, true);
      placeWhenAttached();
    } else {
      document.removeEventListener('pointerdown', onOutside, true);
      unschedule();
    }
    if (user) options.onToggle?.(next);
  }

  trigger.addEventListener('pointerdown', () => { pressing = true; });
  trigger.addEventListener('focus', () => {
    if (pressing || quiet) return;
    setOpen(true, true);
  });
  trigger.addEventListener('blur', () => { quiet = false; pressing = false; });
  trigger.addEventListener('click', () => {
    pressing = false;
    quiet = false;
    setOpen(!isOpen, true);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen) return;
    event.preventDefault();
    event.stopPropagation();
    quiet = true;
    setOpen(false, true);
    if (document.activeElement !== trigger) trigger.focus({ preventScroll: true });
  });
  root.addEventListener('focusout', (event) => {
    if (!isOpen) return;
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && root.contains(next)) return;
    setOpen(false, true);
  });
  if (options.open) setOpen(true, false);

  return {
    root, trigger, content,
    isOpen: () => isOpen,
    // Already open (for example restored open, then attached late): position it again.
    open: () => { if (isOpen && !disposed) placeWhenAttached(); else setOpen(true, false); },
    close: () => setOpen(false, false),
    dispose: () => { setOpen(false, false); disposed = true; },
  };
}

export interface PlanActionsOptions {
  items: MenuItem[];
  onSelect: (id: string) => void;
  /** Accessible name of the ⋯ trigger. */
  label?: string;
}

export interface PlanActionsHandle {
  root: HTMLDivElement;
  menu: MenuHandle;
  /** The SDK's native trigger button (named, visibly ⋯). */
  trigger: HTMLButtonElement | null;
  dispose: () => void;
}

/**
 * The ⋯ plan-actions menu: the SDK menu (roles, arrows, Enter, Escape, return to the trigger),
 * with a visible ⋯ label and the accessible name "Plan actions". Items only open existing panes
 * or controls, which render outside the menu.
 */
export function planActions(options: PlanActionsOptions): PlanActionsHandle {
  const root = node('div', 'ap-actions');
  root.dataset.testid = 'plan-actions';
  const menu = mountMenu(root, { label: '⋯', variant: 'ghost', size: 'xs', items: options.items, onSelect: options.onSelect });
  const trigger = root.querySelector<HTMLButtonElement>('button');
  trigger?.setAttribute('aria-label', options.label ?? 'Plan actions');
  trigger?.classList.add('ap-actions-btn');
  return { root, menu, trigger, dispose: () => menu.dispose() };
}

export type WarningTone = 'warning' | 'error' | 'info';

/**
 * A compact, always-visible qualification line (stale, capture off, partial coverage, read
 * failure). Words carry the meaning; the mark and tone only reinforce it. It may wrap; never clipped.
 */
export function warningLine(text: string, tone: WarningTone = 'warning', tag: 'p' | 'div' | 'span' = 'p'): HTMLElement {
  const line = node(tag, 'ap-warn');
  line.dataset.tone = tone;
  line.append(icon(tone === 'info' ? 'info' : 'warning'), node('span', 'ap-warn-text', text));
  return line;
}

/** A short inline warning badge beside a title or row (e.g. "Unverified setup"). */
export function warningBadge(text: string, tone: WarningTone = 'warning'): HTMLSpanElement {
  const badge = node('span', 'ap-warn-badge', text);
  badge.dataset.tone = tone;
  return badge;
}
