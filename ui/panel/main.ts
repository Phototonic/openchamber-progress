import { mountSelect } from '@openchamber/sdk/ui';
import { RECENT_SCOPES, startView, type ViewContext } from '../shared/app.ts';
import { RecentMemory } from '../shared/refresh.ts';
import { detailsBlock, el, emptyBlock, failureBlock, failureFacts, loadingBlock, planDetail, recordedLabel, staleBlock, testid } from '../shared/components.ts';
import { LIFECYCLE_LABEL, summarize, type PlanView } from '../shared/model.ts';
import { contextListScope, contextScope, pickPlan, projectsFor } from '../shared/scope.ts';
import { officialMainBlock } from '../shared/official.ts';
import { initialSetupUi, reloadNote, setupBlock, type SetupUi } from '../shared/setup.ts';
import { cleanupBlock, cleanupNotice } from '../shared/cleanup-view.ts';
import { censusFor, planFacts } from '../shared/census.ts';
import { censusBlock } from '../shared/census-view.ts';
import { planProject } from '../shared/live.ts';

type Ui = { selected: string | null; setup: SetupUi };
const storeKey = (sessionId: string) => `rail-plan:${sessionId}`;
// Recent sessions' chosen plan, so a remembered session repaints with its own selection at once
// (host storage stays the durable copy and is still read on every switch).
const recentSelection = new RecentMemory<string>(RECENT_SCOPES);
let contextSession: string | null | undefined;
let contextAuthority = '';
let selectionGeneration = 0;

// Right rail: the selected session's plan, progress first; diagnostics collapsed at the end.
startView<Ui>({
  surface: 'panel',
  maxSessionSubscriptions: 4,
  initialUi: () => ({ selected: null, setup: initialSetupUi() }),
  actionPlan: current,
  forgetPlans: (keys, ui, vc) => {
    selectionGeneration++;
    recentSelection.deleteWhere((key, session) => {
      if (!keys.has(key)) return false;
      void vc.storage.delete(storeKey(session)).catch(() => {});
      return true;
    });
    if (keys.has(ui.selected ?? '') && vc.session) void vc.storage.delete(storeKey(vc.session.id)).catch(() => {});
    return keys.has(ui.selected ?? '') ? { selected: null } : {};
  },
  scope: ({ session, directory }) => contextListScope(session?.id, directory),
  // The selected session's own project first: its sub-agents need no reported plan to be listed.
  wantProjects: ({ read, live, directory, session }) => {
    if (!read) return [];
    const own = session ? planProject(session.id, directory ?? '', live) : undefined;
    return [...new Set([...(own ? [own.id] : []), ...projectsFor(read.plans, live, directory)])];
  },
  wantDetails: (vc) => { const p = current(vc); return p ? [p] : []; },
  // Task reading belongs to the selected session's view of the plan: another session (even of the
  // same plan) or plan starts at Show all again; nothing about it is stored.
  reading: (vc) => { const p = current(vc); return p && vc.session ? { plan: p.key, scope: `rail:${vc.session.id}` } : null; },
  // The chosen plan is remembered per session, so reopening the panel keeps it.
  onContext: (vc) => {
    const id = vc.session?.id ?? null;
    if (contextAuthority !== vc.identity) { recentSelection.clear(); contextSession = undefined; contextAuthority = vc.identity; }
    if (id === contextSession) return; // another step of the same switch keeps the selection
    contextSession = id;
    const generation = ++selectionGeneration;
    vc.setUi({ selected: id ? recentSelection.get(id) ?? null : null });
    if (!id) return;
    void vc.storage.get(storeKey(id)).then((v) => {
      if (typeof v !== 'string' || generation !== selectionGeneration) return;
      recentSelection.set(id, v);
      if (vc.ui.selected !== v) vc.setUi({ selected: v });
    }).catch(() => {});
  },
  paint(root, vc) {
    const { read, failure, env } = vc;
    root.append(el('h1', 'ap-sr', 'Agent progress'));
    const notice = cleanupNotice(vc); if (notice) root.append(notice);
    // The official-main notice does not depend on companion setup or the store.
    const official = officialMainBlock(vc);
    if (!read) {
      if (!vc.session?.id) root.append(emptyBlock('unscoped-state', 'No session selected', 'Open a session to see its reported progress.'));
      if (failure) root.append(failureBlock(failure, vc.retry));
      else if (vc.health && !vc.health.ready) {
        if (official) root.append(official);
        root.append(emptyBlock('setup-needed', 'Agent progress is not set up yet', 'Connect it to your OpenCode setup to start showing plans.', true));
        root.append(setupBlock(vc, { compact: true }));
      } else if (vc.session?.id) root.append(loadingBlock());
      else if (official) root.append(official);
      return;
    }
    if (failure && vc.lastGoodAt) root.append(staleBlock(failure, vc.lastGoodAt, env.locale, vc.retry));
    const reload = reloadNote(vc);
    if (reload) root.append(reload);
    if (official) root.append(official);
    if (!read.captureEnabled) root.append(testid(el('p', 'ap-doc-warn', 'Capture is off, so no new progress is being recorded.'), 'capture-off'));
    const scope = contextScope(read.plans, vc.session?.id, vc.directory);
    if (scope.kind === 'none') {
      root.append(emptyBlock('unscoped-state', 'No session selected', 'Open a session to see the plan its agent reported.'));
    } else if (!scope.plans.length) {
      root.append(emptyBlock('empty-state', 'No plan reported for this session', 'When an agent in this session reports a plan, its progress appears here.'));
    } else {
      const generation = selectionGeneration;
      const plan = pickPlan(scope.plans, vc.ui.selected);
      if (scope.plans.length > 1 && plan) root.append(picker(scope.plans, plan, scope.kind === 'session' ? scope.sessionId : null, (key) => {
        if (generation !== selectionGeneration) return;
        selectionGeneration++; // a manual choice also retires a pending preference restore
        vc.setUi({ selected: key });
        if (vc.session) { recentSelection.set(vc.session.id, key); void vc.storage.set(storeKey(vc.session.id), key).catch(() => {}); }
      }));
      if (plan && scope.kind === 'session' && plan.ownerSessionId !== scope.sessionId) {
        root.append(testid(el('p', 'ap-note', `This session contributes to a plan from ${recordedLabel(plan, env)(plan.ownerSessionId)}.`), 'helping-note'));
      }
      if (plan) root.append(planDetail(plan, env, hooks(vc, plan), { document: 'disclosure', compareSession: scope.kind === 'session' ? scope.sessionId : null, reading: vc.reading }), cleanupBlock(vc, plan));
      if (read.truncated) root.append(el('p', 'ap-note', 'Some older plans were not loaded.'));
    }
    // Observed sub-agents of the selected session, kept apart from the reported plan above.
    const shown = current(vc);
    const census = censusBlock({
      surface: 'panel', census: censusFor(vc.session?.id, vc.directory, vc.live),
      facts: planFacts(shown, shown ? vc.detail(shown) : null), verified: read.binding.verified, captureEnabled: read.captureEnabled, env,
    });
    if (census) root.append(census);
    root.append(detailsBlock(read, current(vc), [['Live sessions watched', String(vc.sessionSubscriptions)], ...failureFacts(failure)], env));
  },
});

function current(vc: ViewContext<Ui>) {
  if (!vc.read) return null;
  const scope = contextScope(vc.read.plans, vc.session?.id, vc.directory);
  return scope.kind === 'none' ? null : pickPlan(scope.plans, vc.ui.selected);
}

function hooks(vc: ViewContext<Ui>, plan: PlanView) {
  return {
    detail: vc.detail(plan),
    summary: vc.summary(plan),
    retryDetail: vc.retry,
    document: { get: () => vc.document(plan), request: () => vc.requestDocument(plan) },
  };
}

function picker(plans: PlanView[], current: PlanView, sessionId: string | null, onChange: (key: string) => void) {
  const holder = testid(el('div', 'ap-picker'), 'plan-selector');
  mountSelect(holder, {
    label: `${plans.length} plans`,
    value: current.key,
    options: plans.map((p) => {
      const s = summarize(p);
      const role = sessionId && p.ownerSessionId !== sessionId ? 'helping · ' : '';
      return { id: p.key, label: p.title, hint: `${role}${p.lifecycle === 'active' ? (s.total ? `${s.done}/${s.total}` : '—') : LIFECYCLE_LABEL[p.lifecycle]}` };
    }),
    onChange,
  });
  return holder;
}
