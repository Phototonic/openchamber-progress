import { mountSelect } from '@openchamber/sdk/ui';
import { RECENT_SCOPES, startView, type ViewContext } from '../shared/app.ts';
import { age, allDone, button, el, elapsedLabel, emptyBlock, failureBlock, glyph, lifecycleBadge, loadingBlock, retryRead, testid, type Env } from '../shared/components.ts';
import { PANEL_SURFACE_ID } from '../shared/config.ts';
import { clockTime, plural } from '../shared/format.ts';
import { coverageFor, liveLabel, planProject } from '../shared/live.ts';
import { censusFor, planFacts } from '../shared/census.ts';
import { runClaim, subagentsBlock } from '../shared/census-view.ts';
import { LIFECYCLE_LABEL, showsLiveness, summarize, summaryText, type PlanSummary, type PlanView } from '../shared/model.ts';
import { officialMainLine } from '../shared/official.ts';
import { contextListScope, contextScope, projectsFor } from '../shared/scope.ts';
import { segmentedBar, stateChip, warningLine, type MarkStatus } from '../shared/primitives.ts';
import { StatusSelection } from './selection.ts';
import { projectStatus, type StatusProjection } from './projection.ts';
import { afterAnimationFrames, HeightSync } from '../shared/height.ts';

type Ui = { selection: StatusSelection };
let heights: HeightSync | null = null;

const enter = (vc: ViewContext<Ui>) => vc.ui.selection.enter(
  JSON.stringify([vc.ctx.connection?.account ?? '', vc.identity]), vc.session?.id ?? null, vc.directory,
);

const openRail = (vc: ViewContext<Ui>) => {
  void vc.host.openSurface(PANEL_SURFACE_ID).catch(() => vc.host.toast({ kind: 'error', message: 'Progress details could not open here.' }).catch(() => {}));
};

const primary = (vc: ViewContext<Ui>) => {
  if (!vc.read) return null;
  enter(vc);
  const scope = contextScope(vc.read.plans, vc.session?.id, vc.directory);
  return vc.ui.selection.resolve(scope).plan;
};

// Work Status section: compact, scoped only to its explicit host-selected session.
// The host draws the section title; this frame never writes a badge.
startView<Ui>({
  surface: 'status',
  maxSessionSubscriptions: 2,
  initialUi: () => ({ selection: new StatusSelection(RECENT_SCOPES) }),
  forgetPlans: (keys, ui) => { ui.selection.forget(keys); return {}; },
  scope: ({ session, directory }) => contextListScope(session?.id, directory),
  onContext: (vc) => { enter(vc); },
  wantProjects: (vc) => {
    const p = primary(vc);
    // The selected session's own project (its sub-agents), then the featured plan first, even if it
    // is the fourth/older choice. LiveWorkspace keeps the two-stream cap.
    const own = vc.session ? planProject(vc.session.id, vc.directory ?? '', vc.live) : undefined;
    return vc.read ? [...new Set([
      ...(own ? [own.id] : []),
      ...projectsFor(p ? [p] : [], vc.live),
      ...projectsFor(vc.read.plans.slice(0, 3), vc.live, vc.directory),
    ])] : [];
  },
  wantDetails: (vc) => { const p = primary(vc); return p ? [p] : []; },
  paint(root, vc) {
    const { read, failure, env } = vc;
    // Compact official-main line; it does not depend on setup or on this session having plans.
    const official = () => officialMainLine(vc, () => openRail(vc));
    const withOfficial = (block: HTMLElement) => { const line = official(); if (line) block.append(line); return block; };
    if (!read) {
      if (!vc.session?.id) root.append(withOfficial(emptyBlock('unscoped-state', 'No session selected', 'Open a session to see its reported progress.', true)));
      if (failure) root.append(failureBlock(failure, retryRead(vc)));
      else if (vc.health && !vc.health.ready) root.append(withOfficial(emptyBlock('setup-needed', 'Agent progress is not set up yet', 'Set it up to see plans here.', true, { label: 'Set up', onClick: () => openRail(vc) })));
      else if (vc.session?.id) root.append(loadingBlock());
      return;
    }
    const scope = contextScope(read.plans, vc.session?.id, vc.directory);
    const generation = enter(vc);
    const { plan, selected } = vc.ui.selection.resolve(scope);
    if (scope.kind === 'none') {
      root.append(withOfficial(emptyBlock('unscoped-state', 'No session selected', 'Open a session to see its reported progress.', true)));
      return;
    }
    if (!scope.plans.length) {
      // No plan in scope: no sub-agent section, count or prompt, whatever the host lists.
      root.append(failure ? failureBlock(failure, retryRead(vc)) : withOfficial(emptyBlock('empty-state', 'No plan reported for this session', 'Progress appears here when an agent reports a plan.', true)));
      return;
    }
    if (!plan) return;
    const rest = scope.plans.filter((p) => p.key !== plan.key);
    const p = projectStatus(plan, vc.detail(plan), env.view);
    const box = testid(el('section', 'ap-status-plan'), `plan-${plan.id}`);
    box.dataset.source = plan.sourceId;
    box.dataset.lifecycle = plan.lifecycle;
    box.dataset.revision = String(plan.revision);
    if (showsLiveness(plan.lifecycle, p.summary, env.view)) box.dataset.motion = 'on';
    // One title. With several plans the title is the featured-plan picker: a quiet "⌄ Automatic"
    // trigger beside it when space permits, otherwise below, whose popup keeps Automatic and every plan.
    const head = el('div', 'ap-status-head');
    // Owning heading of a recovered read (docs/ui.md Restoration): a focus target, never a Tab stop.
    const title = testid(el('span', 'ap-status-title', plan.title), 'status-plan-title');
    title.tabIndex = -1;
    head.append(title);
    let openPicker: (() => void) | null = null;
    if (scope.plans.length > 1) {
      const holder = testid(el('div', 'ap-picker ap-title-picker ap-status-pick'), 'status-plan-selector');
      mountSelect(holder, {
        label: 'Featured plan',
        value: selected ?? 'automatic',
        options: [
          { id: 'automatic', label: 'Automatic', hint: 'Prefer reported working tasks' },
          ...scope.plans.map((x) => ({ id: x.key, label: x.title, hint: x.lifecycle === 'active' ? `${x.working.length} working` : LIFECYCLE_LABEL[x.lifecycle] })),
        ],
        onChange: (key) => vc.updateUi((ui) => {
          // A picker from a retired store/context cannot restore its old choice.
          if (ui.selection !== vc.ui.selection || !ui.selection.choose(generation, key === 'automatic' ? null : key)) return {};
          return { selection: ui.selection };
        }),
      });
      const trigger = holder.querySelector<HTMLButtonElement>('.oc-sdk-trigger');
      if (trigger) {
        trigger.removeAttribute('aria-labelledby');
        trigger.setAttribute('aria-label', `Featured plan: ${plan.title}, ${selected ? 'chosen' : 'chosen automatically'}. ${plural(scope.plans.length, 'plan', 'plans')}; choose another`);
        trigger.prepend(el('span', 'ap-title-picker-hint', selected ? 'Chosen' : 'Automatic'));
        openPicker = () => trigger.click();
        // The title reads as the picker too (pointer only; the trigger is the keyboard control).
        title.classList.add('ap-plan-title-pick');
        title.addEventListener('click', () => trigger.click());
      }
      head.append(holder);
    }
    if (plan.lifecycle !== 'active') head.append(lifecycleBadge(plan));
    box.append(head, statusProgress(p, plan));
    const quals = qualifiers(p, read.captureEnabled, failure && vc.lastGoodAt ? clockTime(vc.lastGoodAt, env.locale) : null);
    if (quals) box.append(quals);
    const focus = focusRows(p, plan, env);
    if (focus) box.append(focus);
    // Age and live state, one compact line; other titles and working/lifecycle hints are in the picker.
    const meta = el('div', 'ap-meta ap-status-meta');
    meta.append(age(plan.reportedAt, env, 'Updated '), el('span', '', liveLabel(coverageFor(plan.ownerSessionId, plan.directory, env.live)).label));
    box.append(meta);
    if (rest.length && openPicker) {
      const open = openPicker;
      const more = testid(el('button', 'ap-link ap-status-more'), 'more-plans');
      more.type = 'button';
      more.textContent = `+${plural(rest.length, 'more plan', 'more plans')}`;
      more.setAttribute('aria-label', `${plural(rest.length, 'more plan', 'more plans')} in this session: choose the featured plan`);
      more.addEventListener('click', () => open());
      box.append(more);
    }
    root.append(box);

    // After the featured plan and its picker, so sub-agents never displace them.
    const session = vc.session?.id;
    if (session && read.binding.verified && plan.sourceId === env.boundSource) {
      const observed = subagentsBlock({
        surface: 'status', plan, census: censusFor(session, vc.directory, vc.live), facts: planFacts(plan, vc.detail(plan), env.boundSource),
        runs: vc.runs(runClaim(read, session, plan)), verified: true, currentSession: session, liveSeq: vc.live.seq, env,
      });
      if (observed) root.append(observed);
    }
    const actions = el('div', 'ap-row ap-between');
    button(actions, 'open-detail', 'Open progress', () => openRail(vc), 'ghost');
    const line = official();
    if (line) actions.append(line);
    root.append(actions);
  },
  afterPaint(root, vc) {
    // Asked once per paint; re-sent a bounded number of times if the host leaves the frame unchanged.
    if (!heights) {
      const sync = heights = new HeightSync({ send: (h) => vc.host.setHeight(h), actual: () => innerHeight, visible: () => document.visibilityState !== 'hidden', afterFrames: afterAnimationFrames });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sync.hidden(); else sync.visible(); });
      addEventListener('pagehide', () => sync.dispose());
    }
    let height = Math.ceil(root.getBoundingClientRect().height);
    heights.request(height);
    // A roster row or record list opened in place changes the height without a repaint: ask once
    // per actual disclosure change (the same bounded HeightSync), never per row or chip.
    const sync = heights;
    root.addEventListener('toggle', () => {
      if (!root.isConnected) return;
      const next = Math.ceil(root.getBoundingClientRect().height);
      // Restored open disclosures can deliver their queued toggle after paint.
      // The paint already reported that layout; only a new layout needs a request.
      if (next === height) return;
      height = next;
      sync.request(height);
    }, true);
  },
});

/**
 * The bar (whole plan), then "3/8" and the counts as informational chips (no list to filter):
 * guidance (in progress, needs you, ready, waiting) only from complete current active detail;
 * otherwise the reported statuses. Without complete detail only the list's in-progress count.
 */
function statusProgress(p: StatusProjection, plan: PlanView) {
  const s: PlanSummary = p.summary;
  const wrap = el('div', 'ap-progress ap-status-progress');
  const bar = segmentedBar(s, `${summaryText(s)}${s.working ? `, ${s.working} in progress` : ''}${s.blocked ? `, ${s.blocked} blocked` : ''}`);
  if (bar) wrap.append(bar);
  const line = el('div', 'ap-status-counts');
  const counts = testid(el('span', 'ap-status-fraction'), 'counts');
  Object.assign(counts.dataset, { done: String(s.done), total: String(s.total), remaining: String(s.remaining), skipped: String(s.skipped) });
  if (s.total) counts.append(el('strong', '', String(s.done)), el('span', 'ap-muted', `/${s.total}`), el('span', 'ap-sr', ` done, ${s.remaining} remaining${s.skipped ? `, ${s.skipped} skipped` : ''}`));
  else counts.append(el('span', 'ap-muted', summaryText(s)));
  allDone(counts, s);
  line.append(counts);
  const r = p.reported;
  const guided = p.ready !== null && p.waiting !== null && r !== null;
  const chips: [MarkStatus, number, string][] = guided
    ? [['working', r.working, 'in progress'], ['blocked', r.blocked, 'needs you'], ['ready', p.ready!, 'ready'], ['waiting', p.waiting!, 'waiting'], ['skipped', r.skipped, 'skipped']]
    : r ? [['working', r.working, 'in progress'], ['blocked', r.blocked, 'blocked'], ['pending', r.pending, 'pending'], ['skipped', r.skipped, 'skipped']]
    : plan.lifecycle === 'active' ? [['working', plan.working.length, 'in progress']] : [];
  for (const [state, count, label] of chips) { const c = stateChip({ state, count, label }); if (c) line.append(c); }
  wrap.append(line);
  return wrap;
}

/** Concrete states beside the counts they qualify; never behind an explanation. */
function qualifiers(p: StatusProjection, captureEnabled: boolean, staleAt: string | null) {
  const box = el('div', 'ap-quals');
  if (staleAt) box.append(testid(warningLine(`Not refreshed since ${staleAt}. Counts may be out of date.`, 'warning', 'div'), 'stale-banner'));
  if (!captureEnabled) box.append(testid(warningLine('Capture off: these are the last reported counts.', 'info', 'div'), 'capture-off'));
  if (p.detailUnavailable) box.append(testid(warningLine('Task details couldn’t be loaded.', 'warning', 'div'), 'status-detail-unavailable'));
  const r = p.readiness;
  if (r.state === 'invalid') box.append(testid(warningLine('Ready and waiting are unavailable for this report.', 'warning', 'div'), 'status-readiness-invalid'));
  else if (r.state === 'ready' && r.incomplete) box.append(testid(warningLine('Some recorded prerequisites aren’t in this plan.', 'warning', 'div'), 'status-readiness-incomplete'));
  return box.childNodes.length ? box : null;
}

/** At most two rows, first reported blocked then first reported working; each task once. */
function focusRows(p: StatusProjection, plan: PlanView, env: Env) {
  if (!p.detail) {
    // Detail still loading: the list's own count only (no fabricated rows or zeros).
    return null;
  }
  if (!p.focus.length) return null;
  const list = testid(el('ul', 'ap-status-focus'), 'current-work');
  list.setAttribute('aria-label', 'Needs attention and in progress');
  for (const item of p.focus) {
    const li = testid(el('li', 'ap-status-row'), `status-focus-${item.id}`);
    li.dataset.status = item.status;
    li.append(glyph(item.status), el('span', 'ap-grow', item.title));
    const elapsed = elapsedLabel(plan, item, p.detail, env);
    if (elapsed) li.append(elapsed);
    list.append(li);
  }
  return list;
}
