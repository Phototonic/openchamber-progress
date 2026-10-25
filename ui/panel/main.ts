import { mountSelect } from '@openchamber/sdk/ui';
import { RECENT_SCOPES, startView, type ViewContext } from '../shared/app.ts';
import { RecentMemory } from '../shared/refresh.ts';
import { detailsBlock, el, emptyBlock, failureBlock, failureFacts, loadingBlock, planDetail, staleBlock, testid } from '../shared/components.ts';
import { baseName } from '../shared/format.ts';
import { sessionLabel } from '../shared/live.ts';
import { LIFECYCLE_LABEL, summarize, type PlanView } from '../shared/model.ts';
import { contextListScope, contextScope, pickPlan, projectsFor } from '../shared/scope.ts';
import { officialMainBlock } from '../shared/official.ts';
import { initialSetupUi, reloadNote, setupBlock, type SetupUi } from '../shared/setup.ts';

type Ui = { selected: string | null; setup: SetupUi };
const storeKey = (sessionId: string) => `rail-plan:${sessionId}`;
// Recent sessions' chosen plan, so a remembered session repaints with its own selection at once
// (host storage stays the durable copy and is still read on every switch).
const recentSelection = new RecentMemory<string>(RECENT_SCOPES);
let contextSession: string | null | undefined;

// Right rail: the selected session's plan, progress first; diagnostics collapsed at the end.
startView<Ui>({
  surface: 'panel',
  maxSessionSubscriptions: 4,
  initialUi: () => ({ selected: null, setup: initialSetupUi() }),
  scope: ({ session, directory }) => contextListScope(session?.id, directory),
  wantProjects: ({ read, live, directory }) => (read ? projectsFor(read.plans, live, directory) : []),
  wantDetails: (vc) => { const p = current(vc); return p ? [p] : []; },
  // The chosen plan is remembered per session, so reopening the panel keeps it.
  onContext: (vc) => {
    const id = vc.session?.id ?? null;
    if (id === contextSession) return; // another step of the same switch keeps the selection
    contextSession = id;
    vc.setUi({ selected: id ? recentSelection.get(id) ?? null : null });
    if (!id) return;
    void vc.storage.get(storeKey(id)).then((v) => {
      if (typeof v !== 'string' || vc.session?.id !== id) return;
      recentSelection.set(id, v);
      if (vc.ui.selected !== v) vc.setUi({ selected: v });
    }).catch(() => {});
  },
  paint(root, vc) {
    const { read, failure, env } = vc;
    root.append(el('h1', 'ap-sr', 'Agent progress'));
    // The official-main notice does not depend on companion setup or the store.
    const official = officialMainBlock(vc);
    if (!read) {
      if (failure) root.append(failureBlock(failure, vc.retry));
      else if (vc.health && !vc.health.ready) {
        if (official) root.append(official);
        root.append(emptyBlock('setup-needed', 'Agent progress is not set up yet', 'Connect it to your OpenCode setup to start showing plans.', true));
        root.append(setupBlock(vc, { compact: true }));
      } else root.append(loadingBlock());
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
      root.append(scope.kind === 'session'
        ? emptyBlock('empty-state', 'No plan reported for this session', 'When an agent in this session reports a plan, its progress appears here.')
        : emptyBlock('empty-state', 'No plans recorded in this folder', 'Open a session, or wait for an agent here to report a plan.'));
    } else {
      if (scope.kind === 'directory') root.append(testid(el('p', 'ap-note', `No session selected · plans recorded in ${baseName(scope.directory)}`), 'scope-note'));
      const plan = pickPlan(scope.plans, vc.ui.selected);
      if (scope.plans.length > 1 && plan) root.append(picker(scope.plans, plan, scope.kind === 'session' ? scope.sessionId : null, (key) => {
        vc.setUi({ selected: key });
        if (vc.session) { recentSelection.set(vc.session.id, key); void vc.storage.set(storeKey(vc.session.id), key).catch(() => {}); }
      }));
      if (plan && scope.kind === 'session' && plan.ownerSessionId !== scope.sessionId) {
        root.append(testid(el('p', 'ap-note', `This session contributes to a plan from ${sessionLabel(plan.ownerSessionId, env.live)}.`), 'helping-note'));
      }
      if (plan) root.append(planDetail(plan, env, hooks(vc, plan), { document: 'disclosure' }));
      if (read.truncated) root.append(el('p', 'ap-note', 'Some older plans were not loaded.'));
    }
    root.append(detailsBlock(read, current(vc), [['Live sessions watched', String(Math.max(0, vc.liveSubscriptions - 1))], ...failureFacts(failure)], env));
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
