import { RECENT_SCOPES, startView, type ViewContext } from '../shared/app.ts';
import { RecentMemory } from '../shared/refresh.ts';
import { button, detailsBlock, el, emptyBlock, failureBlock, failureFacts, info, languageBlock, loadingBlock, planDetail, planPicker, recordedLabel, recoveredHeading, retryRead, revealCurrentTask, staleBlock, testid } from '../shared/components.ts';
import { checkReading, inboxSection, openReading, readingHeader, ReadingFocus, readingRequest, type InboxReading, type ReadingCheck } from '../shared/inbox-view.ts';
import type { InboxRowView } from '../shared/model.ts';
import { lifecycleLabel, summarize, type PlanView } from '../shared/model.ts';
import { resolveLanguage, type InterfaceLanguage } from '../shared/i18n.ts';
import { contextListScope, contextScope, pickPlan, projectsFor } from '../shared/scope.ts';
import { initialSetupUi, reloadNote, setupBlock, type SetupUi } from '../shared/setup.ts';
import { cleanupBlock, cleanupNotice } from '../shared/cleanup-view.ts';
import { censusFor, planFacts } from '../shared/census.ts';
import { runClaim, subagentsBlock } from '../shared/census-view.ts';
import { planProject, sessionLabel } from '../shared/live.ts';
import { createMapFrame, planViewSwitch, preserveMapFocus } from '../shared/dependency-map-view.ts';
import { warningLine } from '../shared/primitives.ts';
import { DefaultViewChoice, resolveDefaultView, viewReadingKey } from '../shared/default-view.ts';
import { railPlanKey as storeKey } from '../shared/plan-selection.ts';

const messages = {
  en: { heading: 'Agent progress', noSession: 'No session selected', openProgress: 'Open a session to see its reported progress.', setup: 'Agent progress is not set up yet', connect: 'Connect it to your OpenCode setup to start showing plans.', capture: 'Capture is off, so no new progress is being recorded.', openPlan: 'Open a session to see the plan its agent reported.', noPlan: 'No plan reported for this session', appears: 'When an agent in this session reports a plan, its progress appears here.', about: 'About this plan', contribution: (name: string) => `This session contributes to a plan from ${name}.`, details: 'Details', truncated: 'Some older plans were not loaded.', watched: 'Live sessions watched', helping: 'helping · ' },
  ru: { heading: 'Прогресс агента', noSession: 'Сессия не выбрана', openProgress: 'Откройте сессию, чтобы увидеть её отчёты о прогрессе.', setup: 'Прогресс агента ещё не настроен', connect: 'Подключите его к вашей установке OpenCode, чтобы видеть планы.', capture: 'Запись отключена: новый прогресс не сохраняется.', openPlan: 'Откройте сессию, чтобы увидеть план из отчёта её агента.', noPlan: 'В этой сессии нет отчёта о плане', appears: 'Когда агент этой сессии сообщит о плане, здесь появится его прогресс.', about: 'Об этом плане', contribution: (name: string) => `Эта сессия участвует в плане сессии ${name}.`, details: 'Подробности', truncated: 'Некоторые старые планы не загружены.', watched: 'Отслеживаемые живые сессии', helping: 'участие · ' },
} satisfies Record<InterfaceLanguage, Record<string, string | ((name: string) => string)>>;

/**
 * `presentation`: Plan view List (default) or Map, in this frame only; never stored.
 * `inbox`: an open source-wide Needs you reading (inbox-view.ts); never stored, never the session pin.
 */
type Ui = { selected: string | null; setup: SetupUi; presentation: 'list' | 'map'; inbox: InboxReading | null };
// Recent sessions' chosen plan, so a remembered session repaints with its own selection at once
// (host storage stays the durable copy and is still read on every switch).
const recentSelection = new RecentMemory<string>(RECENT_SCOPES);
let contextSession: string | null | undefined;
let contextAuthority = '';
let contextAction = false;
let selectionGeneration = 0;
/** The rail hosts the full map itself (the host can't open the board from here). View as list stays in this frame. */
const viewChoice = new DefaultViewChoice();
const chooseView = (vc: ViewContext<Ui>, mode: 'list' | 'map') => { const plan = current(vc); if (plan && vc.session) viewChoice.choose(viewReadingKey(vc, `rail:${vc.session.id}`, plan), mode); vc.setUi({ presentation: mode }); };
const railMap = createMapFrame<Ui>('rail', (vc) => chooseView(vc, 'list'));
const listSwitch = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid="plan-view-list"] button');
/** Reveal-once and focus follow-ups of the inbox reading; the last paint's revalidation. */
// Created on first use: frames that never open an inbox reading construct nothing.
let inboxFocus: ReadingFocus | null = null;
const readingFocus = () => (inboxFocus ??= new ReadingFocus());
let inboxCheck: ReadingCheck | null = null;
const inboxRequestOf = (vc: ViewContext<Ui>) => {
  if (!vc.ui.inbox) return null;
  const request = readingRequest(vc.ui.inbox, vc.inbox?.model);
  return readingRequest(vc.ui.inbox, vc.inbox?.model, vc.detailPlan(request));
};
const openInbox = (vc: ViewContext<Ui>, row: InboxRowView) => {
  if (!vc.read) return;
  const reading = openReading(row, vc.read.storeId);
  readingFocus().opening(reading);
  vc.setUi({ inbox: reading });
};
const closeInbox = (vc: ViewContext<Ui>) => { if (vc.ui.inbox) readingFocus().leaving(vc.ui.inbox); vc.setUi({ inbox: null }); };

// Right rail: the selected session's plan, progress first; diagnostics collapsed at the end.
startView<Ui>({
  surface: 'panel',
  maxSessionSubscriptions: 4,
  initialUi: () => ({ selected: null, setup: initialSetupUi(), presentation: 'list', inbox: null }),
  // Source-wide Needs you rows with waiting times, on the ordinary list read.
  needsYou: 'rows',
  prepareUi: (vc) => {
    const decision = resolveDefaultView(viewChoice, vc, `rail:${vc.session?.id ?? ''}`, current(vc));
    const presentation = decision.view === 'map' ? 'map' : 'list';
    return vc.ui.presentation === presentation ? null : { presentation };
  },
  // No plan cleanup from a source-wide inbox reading.
  actionPlan: (vc) => (vc.ui.inbox ? null : current(vc)),
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
  wantDetails: (vc) => { const r = inboxRequestOf(vc); if (r) return [r]; const p = current(vc); return p ? [p] : []; },
  refreshDetails: (vc) => { const request = inboxRequestOf(vc); return request ? [request] : []; },
  // Task reading belongs to the selected session's view of the plan: another session (even of the
  // same plan) or plan starts at Show all again; nothing about it is stored.
  reading: (vc) => {
    // An inbox reading is its own identity: it never shares task-reading state with the rail's plan.
    const r = inboxRequestOf(vc); if (r) return { plan: r.key, scope: `inbox:${vc.ui.inbox!.token}` };
    const p = current(vc); return p && vc.session ? { plan: p.key, scope: `rail:${vc.session.id}` } : null;
  },
  // An unsettled map re-pins its graph on the existing refresh cadence (no extra poller); no hook without a shown map.
  get refreshed() { return railMap.refreshed; },
  retire: (reason) => { if (reason !== 'hidden') { viewChoice.reset(); inboxFocus?.reset(reason); } railMap.retire(reason); },
  afterPaint: (root, vc) => {
    railMap.afterPaint(root, vc, vc.ui.inbox ? null : current(vc), listSwitch);
    inboxFocus?.afterPaint(root, vc.ui.inbox, inboxCheck, revealCurrentTask);
  },
  preserveFocus: preserveMapFocus,
  // The chosen plan is remembered per session, so reopening the panel keeps it.
  onContext: (vc) => {
    const id = vc.session?.id ?? null;
    if (contextAction !== !!vc.progressAction) { contextSession = undefined; contextAction = !!vc.progressAction; }
    if (contextAuthority !== vc.identity) { recentSelection.clear(); contextSession = undefined; contextAuthority = vc.identity; }
    if (id === contextSession) return; // another step of the same switch keeps the selection
    contextSession = id;
    const generation = ++selectionGeneration;
    // A new rail reading (also A → B → A, or none) starts on List with no map or task-target state.
    railMap.resetReading();
    viewChoice.reset();
    // A session switch also leaves any source-wide inbox reading (its target belongs to the old context).
    vc.setUi({ selected: id ? recentSelection.get(id) ?? null : null, presentation: 'list', inbox: null });
    if (!id) return;
    void vc.storage.get(storeKey(id)).then((v) => {
      if (typeof v !== 'string' || generation !== selectionGeneration) return;
      recentSelection.set(id, v);
      if (vc.ui.selected !== v) vc.setUi({ selected: v });
    }).catch(() => {});
  },
  paint(root, vc) {
    const { read, failure, env } = vc;
    const language = resolveLanguage('auto', env.locale), t = messages[language];
    // Map work belongs to the selected session's reading of its plan, and runs only while Map is shown.
    const shown = vc.ui.inbox ? null : current(vc), session = vc.session?.id;
    const mapShown = vc.ui.presentation === 'map' && !!shown && !!session;
    railMap.sync(vc, shown && session ? shown : null, `rail:${session}`, mapShown);
    root.append(el('h1', 'ap-sr', t.heading));
    if (vc.progressAction) root.append(pinnedScope(vc, language));
    if (vc.progressContext) {
      const text = {
        en: { checking: 'Checking the selected session’s location and access…', invalid: 'This Progress action has no valid session context.', unavailable: 'The selected session is unavailable here. Its current location and access could not be verified.' },
        ru: { checking: 'Проверка расположения и доступа выбранной сессии…', invalid: 'У этого действия нет допустимого контекста сессии.', unavailable: 'Выбранная сессия здесь недоступна. Не удалось подтвердить её текущее расположение и доступ.' },
      }[language];
      const state = testid(el('p', 'ap-note', text[vc.progressContext]), 'session-action-context');
      state.setAttribute('role', 'status');
      root.append(state);
      if (failure) root.append(failureBlock(failure, retryRead(vc), env.locale));
      root.append(languageBlock(vc.language, env.locale));
      return;
    }
    const notice = cleanupNotice(vc); if (notice) root.append(notice);
    if (!read) {
      if (vc.progressAction && failure?.code === 'ACTION_CONTEXT') root.append(testid(el('p', 'ap-note', language === 'ru'
        ? 'Не удалось подтвердить полный отчёт о прогрессе выбранной сессии и его установку OpenCode.'
        : 'The selected session’s complete progress and OpenCode setup could not be verified.'), 'session-action-read-refused'));
      if (!vc.session?.id) root.append(emptyBlock('unscoped-state', t.noSession, t.openProgress));
      if (failure) root.append(failureBlock(failure, retryRead(vc), env.locale));
      else if (vc.health && !vc.health.ready) {
        root.append(emptyBlock('setup-needed', t.setup, t.connect, true));
        root.append(setupBlock(vc, { compact: true }));
      } else if (vc.session?.id) root.append(loadingBlock(env.locale));
      root.append(languageBlock(vc.language, env.locale));
      return;
    }
    if (failure && vc.lastGoodAt) root.append(staleBlock(failure, vc.lastGoodAt, env.locale, retryRead(vc)));
    const reload = reloadNote(vc);
    if (reload) root.append(reload);
    if (!read.captureEnabled) root.append(testid(warningLine(t.capture), 'capture-off'));
    inboxCheck = null;
    if (vc.ui.inbox) {
      // A labelled, read-only reading of the current plan, revalidated before its task is revealed.
      const r = vc.ui.inbox, request = inboxRequestOf(vc)!, detail = vc.detail(request);
      const check = inboxCheck = checkReading(r, detail, vc.detailPlan(request), { storeId: read.storeId, boundSource: env.boundSource }, env.locale);
      root.append(readingHeader(r, check, 'panel', env.locale, () => closeInbox(vc), vc.retry));
      if (check.kind === 'ready') root.append(planDetail(check.plan, env, { detail, retryDetail: vc.retry, document: { get: () => vc.document(check.plan), request: () => vc.requestDocument(check.plan) } }, { document: 'omit', compareSession: null, reading: vc.reading }));
      root.append(languageBlock(vc.language, env.locale));
      return;
    }
    // Source-wide and independent of the selected session's plan: at the start, before it.
    if (vc.inbox) root.append(inboxSection(vc.inbox, env, { open: (row) => openInbox(vc, row), stale: failure && vc.lastGoodAt ? vc.lastGoodAt : null }));
    const scope = contextScope(read.plans, vc.session?.id, vc.directory);
    // One run visit of the selected session, shared by its separate roster and the map's cards (never widened).
    const verified = !!shown && !!session && read.binding.verified && shown.sourceId === env.boundSource;
    const runRequest = shown && session ? runClaim(read, session, shown) : null;
    const runs = runRequest && verified ? vc.runs(runRequest) : null;
    if (scope.kind === 'none') {
      root.append(emptyBlock('unscoped-state', t.noSession, t.openPlan));
    } else if (!scope.plans.length) {
      root.append(emptyBlock('empty-state', t.noPlan, t.appears));
    } else {
      const generation = selectionGeneration;
      const plan = pickPlan(scope.plans, vc.ui.selected);
      if (vc.progressAction && scope.plans.length > 1) root.append(testid(el('p', 'ap-note', language === 'ru'
        ? (scope.plans.some(p => p.key === vc.ui.selected) ? 'Выбранный план' : 'План выбран автоматически')
        : (scope.plans.some(p => p.key === vc.ui.selected) ? 'Chosen plan' : 'Plan chosen automatically')), 'session-action-choice'));
      // The title is the picker (several plans): built fresh each paint, so it carries this paint's choice guard.
      const choose = plan && scope.plans.length > 1 ? (standalone = false) => picker(scope.plans, plan, scope.kind === 'session' ? scope.sessionId : null, standalone, (key) => {
        if (generation !== selectionGeneration) return;
        selectionGeneration++; // a manual choice also retires a pending preference restore
        vc.setUi({ selected: key });
        if (vc.session) { recentSelection.set(vc.session.id, key); void vc.storage.set(storeKey(vc.session.id), key).catch(() => {}); }
      }, language) : null;
      // Plan view: List / Map, first (also with one plan), like the board's tabs above its detail.
      // D8 wiring (S2-H): the pressed view comes from the frame's default-view decision, and this
      // activation records the explicit choice (including re-pressing the provisional List).
      if (plan && session) root.append(planViewSwitch(vc.ui.presentation, (mode) => { if (mode === 'map') railMap.enter(); else railMap.leave(); chooseView(vc, mode); }, language));
      // Contribution context, not ownership: behind the header's ⓘ.
      const helping = plan && scope.kind === 'session' && plan.ownerSessionId !== scope.sessionId
        ? info(`${plan.key}|helping`, t.about, testid(el('p', '', t.contribution(recordedLabel(plan, env)(plan.ownerSessionId))), 'helping-note')) : null;
      if (plan && mapShown && session) {
        // The map keeps its own header and title; the compact picker stays above it.
        const pick = choose?.(true);
        if (pick) { const row = el('div', 'ap-rail-pick'); row.append(pick); if (helping) row.append(helping); root.append(row); }
        else if (helping) root.append(helping);
        const host = testid(el('div', 'ap-map-host'), 'map-host');
        root.append(host);
        railMap.paint(host, vc, { plan, scope: `rail:${session}`, runs: runRequest ? { request: runRequest.request, panel: runs } : null, census: censusFor(session, vc.directory, vc.live) });
        root.append(cleanupBlock(vc, plan));
      } else if (plan) {
        // D8 wiring (S2-H): pass `pending: true` while this reading's default view is undecided, so
        // only the loading placeholder paints (no complete rows) until List or Map is settled.
        const article = planDetail(plan, env, hooks(vc, plan), {
          document: 'disclosure', compareSession: scope.kind === 'session' ? scope.sessionId : null, reading: vc.reading,
          picker: choose?.() ?? null, info: helping, actions: [{ id: 'details', label: t.details, run: openDetails }],
          pending: viewChoice.current.pending,
        });
        // An explicit task focus/reveal or pointer selection here is what Map opens on.
        railMap.listTargets(article);
        root.append(article, cleanupBlock(vc, plan));
      }
      if (read.truncated) root.append(el('p', 'ap-note', t.truncated));
    }
    // Sub-agents of the selected session, only with a plan in scope, kept apart from the plan above.
    if (shown && session && verified) {
      const census = subagentsBlock({
        surface: 'panel', plan: shown, census: censusFor(session, vc.directory, vc.live), facts: planFacts(shown, vc.detail(shown), env.boundSource),
        runs, verified: true, currentSession: session, liveSeq: vc.live.seq, env,
      });
      if (census) root.append(census);
    }
    root.append(detailsBlock(read, current(vc), [[t.watched, String(vc.sessionSubscriptions)], ...failureFacts(failure, env.locale)], env));
    root.append(languageBlock(vc.language, env.locale));
  },
});

const scopeCopy = {
  en: { label: 'Progress for selected session', reset: 'Show current session', done: 'Showing the current session' },
  ru: { label: 'Прогресс выбранной сессии', reset: 'Показать текущую сессию', done: 'Показана текущая сессия' },
} satisfies Record<InterfaceLanguage, Record<string, string>>;

/**
 * The pinned scope of a session action, with its explicit local way back (also while the target is
 * checking, unavailable or invalid). Focus that was on the reset goes to the resulting state's heading.
 */
function pinnedScope(vc: ViewContext<Ui>, language: InterfaceLanguage) {
  const copy = scopeCopy[language];
  const line = testid(el('div', 'ap-row ap-note'), 'session-action-scope');
  if (vc.session) line.append(el('span', '', `${copy.label}: ${sessionLabel(vc.session.id, vc.live, language)}`));
  if (vc.progressReset) {
    const reset = vc.progressReset;
    button(line, 'session-action-reset', copy.reset, () => {
      vc.handoff({ heading: (root) => recoveredHeading(root) ?? root.querySelector<HTMLElement>('[role="alert"] button'), notice: (_heading, locale = language) => scopeCopy[locale].done });
      reset();
    }, 'ghost');
  }
  return line;
}

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

/** ⋯ → Details: open the collapsed diagnostics below and move focus to them. */
function openDetails() {
  const d = document.querySelector<HTMLDetailsElement>('[data-testid="details"]');
  if (!d) return;
  d.open = true;
  const summary = d.querySelector<HTMLElement>('summary');
  summary?.focus({ preventScroll: true });
  summary?.scrollIntoView({ block: 'nearest' });
}

/** The title-picker: every scoped plan with its done/total or lifecycle, and the helping role. */
function picker(plans: PlanView[], current: PlanView, sessionId: string | null, standalone: boolean, onChange: (key: string) => void, language: InterfaceLanguage) {
  return planPicker({
    title: current.title, index: plans.indexOf(current) + 1, count: plans.length, value: current.key, standalone, locale: language,
    options: plans.map((p) => {
      const s = summarize(p);
      const role = sessionId && p.ownerSessionId !== sessionId ? messages[language].helping : '';
      return { id: p.key, label: p.title, hint: `${role}${p.lifecycle === 'active' ? (s.total ? `${s.done}/${s.total}` : '—') : lifecycleLabel(p.lifecycle, language)}` };
    }),
    onChange,
  });
}
