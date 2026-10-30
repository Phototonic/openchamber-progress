import { mountSelect } from '@openchamber/sdk/ui';
import { RECENT_SCOPES, startView, type ViewContext } from '../shared/app.ts';
import { age, button, el, elapsedLabel, emptyBlock, failureBlock, glyph, lifecycleBadge, loadingBlock, progressBlock, testid } from '../shared/components.ts';
import { PANEL_SURFACE_ID } from '../shared/config.ts';
import { clockTime } from '../shared/format.ts';
import { coverageFor, liveLabel, planProject } from '../shared/live.ts';
import { censusFor, planFacts } from '../shared/census.ts';
import { runClaim, subagentsBlock } from '../shared/census-view.ts';
import { blockedWork, currentWork, LIFECYCLE_LABEL, showsLiveness, summarize } from '../shared/model.ts';
import { officialMainLine } from '../shared/official.ts';
import { contextListScope, contextScope, projectsFor } from '../shared/scope.ts';
import { StatusSelection } from './selection.ts';

type Ui = { selection: StatusSelection };

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
      if (failure) root.append(failureBlock(failure, vc.retry));
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
      root.append(failure ? failureBlock(failure, vc.retry) : withOfficial(emptyBlock('empty-state', 'No plan reported for this session', 'Progress appears here when an agent reports a plan.', true)));
      return;
    }
    if (!plan) return;
    const rest = scope.plans.filter((p) => p.key !== plan.key);
    if (scope.plans.length > 1) {
      const holder = testid(el('div', 'ap-picker ap-status-picker'), 'status-plan-selector');
      mountSelect(holder, {
        label: 'Featured plan',
        value: selected ?? 'automatic',
        options: [
          { id: 'automatic', label: 'Automatic', hint: 'Prefer reported working tasks' },
          ...scope.plans.map((p) => ({ id: p.key, label: p.title, hint: p.lifecycle === 'active' ? `${p.working.length} working` : LIFECYCLE_LABEL[p.lifecycle] })),
        ],
        onChange: (key) => vc.updateUi((ui) => {
          // A picker from a retired store/context cannot restore its old choice.
          if (ui.selection !== vc.ui.selection || !ui.selection.choose(generation, key === 'automatic' ? null : key)) return {};
          return { selection: ui.selection };
        }),
      });
      // The compact value may truncate; keep its full text available on hover too.
      holder.querySelector('button')?.setAttribute('title', selected ? plan.title : 'Automatic');
      root.append(holder);
    }
    const d = vc.detail(plan);
    const detail = d?.state === 'ready' && d.value.revision === plan.revision ? d.value : null;
    const box = testid(el('section', 'ap-status-plan'), `plan-${plan.id}`);
    box.dataset.source = plan.sourceId;
    box.dataset.lifecycle = plan.lifecycle;
    box.dataset.revision = String(plan.revision);
    const summary = summarize(plan, detail);
    if (showsLiveness(plan.lifecycle, summary, env.view)) box.dataset.motion = 'on';
    const head = el('div', 'ap-status-row');
    head.append(el('span', 'ap-status-title ap-grow', plan.title));
    if (plan.lifecycle !== 'active') head.append(lifecycleBadge(plan));
    box.append(head, progressBlock(summary, true));
    if (detail) {
      const working = currentWork(detail);
      const focus = working.length ? working : blockedWork(detail);
      if (focus.length) {
        const now = testid(el('div', 'ap-status-row'), 'current-work');
        now.append(glyph(focus[0].status), el('span', 'ap-grow', `${working.length ? '' : 'Blocked: '}${focus[0].title}`));
        const elapsed = elapsedLabel(plan, focus[0], detail, env);
        if (elapsed) now.append(elapsed);
        if (focus.length > 1) now.append(el('span', 'ap-muted ap-small', `+${focus.length - 1}`));
        box.append(now);
      }
    } else if (plan.working.length) {
      box.append(testid(el('div', 'ap-status-row ap-muted ap-small', `${plan.working.length} in progress`), 'current-work'));
    }
    const meta = el('div', 'ap-meta');
    meta.append(age(plan.reportedAt, env, 'Updated '), el('span', '', liveLabel(coverageFor(plan.ownerSessionId, plan.directory, env.live)).label));
    if (!read.captureEnabled) meta.append(testid(el('span', '', 'Capture off'), 'capture-off'));
    if (failure && vc.lastGoodAt) meta.append(testid(el('span', '', `Not refreshed since ${clockTime(vc.lastGoodAt, env.locale)}`), 'stale-banner'));
    box.append(meta);
    root.append(box);

    if (rest.length) {
      const more = testid(el('ul', 'ap-status-more'), 'more-plans');
      more.setAttribute('aria-label', 'Other plans');
      for (const p of rest.slice(0, 2)) {
        const s = summarize(p);
        const li = testid(el('li', 'ap-status-row'), `plan-${p.id}`);
        li.dataset.source = p.sourceId;
        li.append(el('span', 'ap-grow', p.title), el('span', 'ap-muted ap-small', p.lifecycle === 'active' ? (s.total ? `${s.done}/${s.total}` : 'No tasks') : LIFECYCLE_LABEL[p.lifecycle]));
        more.append(li);
      }
      if (rest.length > 2) more.append(el('li', 'ap-note', `${rest.length - 2} more`));
      root.append(more);
    }
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
    void vc.host.setHeight(Math.ceil(root.getBoundingClientRect().height)).catch(() => {});
  },
});
