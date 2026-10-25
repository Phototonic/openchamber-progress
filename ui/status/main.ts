import { startView, type ViewContext } from '../shared/app.ts';
import { age, button, el, elapsedLabel, emptyBlock, failureBlock, glyph, lifecycleBadge, loadingBlock, progressBlock, testid } from '../shared/components.ts';
import { PANEL_SURFACE_ID } from '../shared/config.ts';
import { baseName, clockTime } from '../shared/format.ts';
import { coverageFor, liveLabel } from '../shared/live.ts';
import { blockedWork, currentWork, LIFECYCLE_LABEL, showsLiveness, summarize } from '../shared/model.ts';
import { officialMainLine } from '../shared/official.ts';
import { contextListScope, contextScope, projectsFor } from '../shared/scope.ts';

type Ui = Record<string, never>;

const openRail = (vc: ViewContext<Ui>) => {
  void vc.host.openSurface(PANEL_SURFACE_ID).catch(() => vc.host.toast({ kind: 'error', message: 'Progress details could not open here.' }).catch(() => {}));
};

const primary = (vc: ViewContext<Ui>) => {
  if (!vc.read) return null;
  const scope = contextScope(vc.read.plans, vc.session?.id, vc.directory);
  return scope.kind === 'none' ? null : scope.plans[0] ?? null;
};

// Work Status section: compact, scoped to the section's own session/directory context.
// The host draws the section title; this frame never writes a badge.
startView<Ui>({
  surface: 'status',
  maxSessionSubscriptions: 2,
  initialUi: () => ({}),
  scope: ({ session, directory }) => contextListScope(session?.id, directory),
  wantProjects: ({ read, live, directory }) => (read ? projectsFor(read.plans.slice(0, 3), live, directory) : []),
  wantDetails: (vc) => { const p = primary(vc); return p ? [p] : []; },
  paint(root, vc) {
    const { read, failure, env } = vc;
    // Compact official-main line; it does not depend on setup or on this session having plans.
    const official = () => officialMainLine(vc, () => openRail(vc));
    const withOfficial = (block: HTMLElement) => { const line = official(); if (line) block.append(line); return block; };
    if (!read) {
      if (failure) root.append(failureBlock(failure, vc.retry));
      else if (vc.health && !vc.health.ready) root.append(withOfficial(emptyBlock('setup-needed', 'Agent progress is not set up yet', 'Set it up to see plans here.', true, { label: 'Set up', onClick: () => openRail(vc) })));
      else root.append(loadingBlock());
      return;
    }
    const scope = contextScope(read.plans, vc.session?.id, vc.directory);
    if (scope.kind === 'none') {
      root.append(withOfficial(emptyBlock('unscoped-state', 'No project open', 'Open a project or session to see agent progress.', true)));
      return;
    }
    if (!scope.plans.length) {
      root.append(withOfficial(scope.kind === 'session'
        ? emptyBlock('empty-state', 'No plan reported for this session', 'Progress appears here when an agent reports a plan.', true)
        : emptyBlock('empty-state', `No plans recorded in ${baseName(scope.directory)}`, 'Progress appears here when an agent reports a plan.', true)));
      return;
    }
    const [plan, ...rest] = scope.plans;
    const d = vc.detail(plan);
    const detail = d?.state === 'ready' && d.value.revision === plan.revision ? d.value : null;
    const box = testid(el('section', 'ap-status-plan'), `plan-${plan.id}`);
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
        li.append(el('span', 'ap-grow', p.title), el('span', 'ap-muted ap-small', p.lifecycle === 'active' ? (s.total ? `${s.done}/${s.total}` : 'No tasks') : LIFECYCLE_LABEL[p.lifecycle]));
        more.append(li);
      }
      if (rest.length > 2) more.append(el('li', 'ap-note', `${rest.length - 2} more`));
      root.append(more);
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
