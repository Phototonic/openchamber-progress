import { mountSelect } from '@openchamber/sdk/ui';
import { RECENT_SCOPES, startView, type ViewContext } from '../shared/app.ts';
import { age, allDone, button, el, elapsedLabel, emptyBlock, failureBlock, glyph, lifecycleBadge, loadingBlock, retryRead, testid, type Env } from '../shared/components.ts';
import { PANEL_SURFACE_ID } from '../shared/config.ts';
import { clockTime, formatCount, plural } from '../shared/format.ts';
import { coverageFor, liveLabel, planProject } from '../shared/live.ts';
import { censusFor, planFacts } from '../shared/census.ts';
import { runClaim, subagentsBlock } from '../shared/census-view.ts';
import { lifecycleLabel, showsLiveness, summarize, summaryText, type PlanSummary, type PlanView } from '../shared/model.ts';
import { resolveLanguage, type InterfaceLanguage } from '../shared/i18n.ts';
import { contextListScope, contextScope, projectsFor } from '../shared/scope.ts';
import { segmentedBar, stateChip, warningLine, type MarkStatus } from '../shared/primitives.ts';
import { StatusSelection } from './selection.ts';
import { projectStatus, type StatusProjection } from './projection.ts';
import { afterAnimationFrames, HeightSync } from '../shared/height.ts';
import { statusInboxLine } from '../shared/inbox-view.ts';

type Ui = { selection: StatusSelection };
const messages = {
  en: { openFailed: 'Progress details could not open here.', noSession: 'No session selected', openSession: 'Open a session to see its reported progress.', setup: 'Agent progress is not set up yet', setupHelp: 'Set it up to see plans here.', setUp: 'Set up', noPlan: 'No plan reported for this session', appears: 'Progress appears here when an agent reports a plan.', featured: 'Featured plan', automatic: 'Automatic', prefer: 'Prefer reported working tasks', chosen: 'Chosen', chosenLabel: 'chosen', automaticLabel: 'chosen automatically', working: (n: number) => `${n} working`, picker: (title: string, chosen: boolean, n: number) => `Featured plan: ${title}, ${chosen ? 'chosen' : 'chosen automatically'}. ${plural(n, 'plan', 'plans')}; choose another`, updated: 'Updated ', more: (n: number) => plural(n, 'more plan', 'more plans'), moreAria: (n: number) => `${plural(n, 'more plan', 'more plans')} in this session: choose the featured plan`, open: 'Open progress', progress: 'in progress', ready: 'ready', waiting: 'waiting', blocked: 'blocked', pending: 'pending', skipped: 'skipped', counts: (n: number, skipped: number) => ` done, ${n} remaining${skipped ? `, ${skipped} skipped` : ''}`, stale: (time: string) => `Not refreshed since ${time}. Counts may be out of date.`, capture: 'Capture off: these are the last reported counts.', unavailable: 'Task details couldn’t be loaded.', invalid: 'Ready and waiting are unavailable for this report.', incomplete: 'Some recorded prerequisites aren’t in this plan.', focus: 'Blocked and in progress' },
  ru: { openFailed: 'Не удалось открыть подробности прогресса.', noSession: 'Сессия не выбрана', openSession: 'Откройте сессию, чтобы увидеть её отчёты о прогрессе.', setup: 'Прогресс агента ещё не настроен', setupHelp: 'Настройте его, чтобы видеть планы.', setUp: 'Настроить', noPlan: 'В этой сессии нет отчёта о плане', appears: 'Прогресс появится здесь, когда агент сообщит о плане.', featured: 'Основной план', automatic: 'Автоматически', prefer: 'Предпочитать задачи с отчётом о работе', chosen: 'Выбран', chosenLabel: 'выбран', automaticLabel: 'выбран автоматически', working: (n: number) => `В работе: ${formatCount(n, 'ru')}`, picker: (title: string, chosen: boolean, n: number) => `Основной план: ${title}, ${chosen ? 'выбран' : 'выбран автоматически'}. Планов: ${formatCount(n, 'ru')}; выбрать другой`, updated: 'Обновлено ', more: (n: number) => `Ещё планов: ${formatCount(n, 'ru')}`, moreAria: (n: number) => `Других планов в этой сессии: ${formatCount(n, 'ru')}; выбрать основной план`, open: 'Открыть прогресс', progress: 'в работе', ready: 'готово к работе', waiting: 'ожидает', blocked: 'заблокировано', pending: 'не начато', skipped: 'пропущено', counts: (n: number, skipped: number) => ` выполнено, осталось: ${formatCount(n, 'ru')}${skipped ? `, пропущено: ${formatCount(skipped, 'ru')}` : ''}`, stale: (time: string) => `Не обновлялось с ${time}. Счётчики могут быть устаревшими.`, capture: 'Запись отключена: показаны последние полученные счётчики.', unavailable: 'Не удалось загрузить подробности задач.', invalid: 'Готовность и ожидание недоступны для этого отчёта.', incomplete: 'Некоторые записанные предварительные условия отсутствуют в этом плане.', focus: 'Заблокированные и в работе' },
} satisfies Record<InterfaceLanguage, Record<string, string | ((...args: never[]) => string)>>;
let heights: HeightSync | null = null;

const enter = (vc: ViewContext<Ui>) => vc.ui.selection.enter(
  JSON.stringify([vc.ctx.connection?.account ?? '', vc.identity]), vc.session?.id ?? null, vc.directory,
);

const openRail = (vc: ViewContext<Ui>) => {
  void vc.host.openSurface(PANEL_SURFACE_ID).catch(() => vc.host.toast({ kind: 'error', message: messages[resolveLanguage('auto', vc.env.locale)].openFailed }).catch(() => {}));
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
  // The source-wide Needs you count only (no waiting times): its line opens the rail's inbox.
  needsYou: 'count',
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
    const t = messages[resolveLanguage('auto', env.locale)];
    if (!read) {
      if (!vc.session?.id) root.append(emptyBlock('unscoped-state', t.noSession, t.openSession, true));
      if (failure) root.append(failureBlock(failure, retryRead(vc), env.locale));
      else if (vc.health && !vc.health.ready) root.append(emptyBlock('setup-needed', t.setup, t.setupHelp, true, { label: t.setUp, onClick: () => openRail(vc) }));
      else if (vc.session?.id) root.append(loadingBlock(env.locale));
      return;
    }
    // Source-wide and independent of the featured plan: first, so it is never displaced.
    const inbox = vc.inbox?.model ? statusInboxLine(vc.inbox.model, env.locale, () => openRail(vc), failure ? vc.lastGoodAt : null) : null;
    if (inbox) root.append(inbox);
    const scope = contextScope(read.plans, vc.session?.id, vc.directory);
    const generation = enter(vc);
    const { plan, selected } = vc.ui.selection.resolve(scope);
    if (scope.kind === 'none') {
      root.append(emptyBlock('unscoped-state', t.noSession, t.openSession, true));
      return;
    }
    if (!scope.plans.length) {
      // No plan in scope: no sub-agent section, count or prompt, whatever the host lists.
      root.append(failure ? failureBlock(failure, retryRead(vc), env.locale) : emptyBlock('empty-state', t.noPlan, t.appears, true));
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
        label: t.featured,
        value: selected ?? 'automatic',
        options: [
          { id: 'automatic', label: t.automatic, hint: t.prefer },
          ...scope.plans.map((x) => ({ id: x.key, label: x.title, hint: x.lifecycle === 'active' ? t.working(x.working.length) : lifecycleLabel(x.lifecycle, env.locale) })),
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
        trigger.setAttribute('aria-label', t.picker(plan.title, !!selected, scope.plans.length));
        trigger.prepend(el('span', 'ap-title-picker-hint', selected ? t.chosen : t.automatic));
        openPicker = () => trigger.click();
        // The title reads as the picker too (pointer only; the trigger is the keyboard control).
        title.classList.add('ap-plan-title-pick');
        title.addEventListener('click', () => trigger.click());
      }
      head.append(holder);
    }
    if (plan.lifecycle !== 'active') head.append(lifecycleBadge(plan, env.locale));
    box.append(head, statusProgress(p, plan, env.locale));
    const quals = qualifiers(p, read.captureEnabled, failure && vc.lastGoodAt ? clockTime(vc.lastGoodAt, env.locale) : null, env.locale);
    if (quals) box.append(quals);
    const focus = focusRows(p, plan, env);
    if (focus) box.append(focus);
    // Age and live state, one compact line; other titles and working/lifecycle hints are in the picker.
    const meta = el('div', 'ap-meta ap-status-meta');
    meta.append(age(plan.reportedAt, env, t.updated), el('span', '', liveLabel(coverageFor(plan.ownerSessionId, plan.directory, env.live), env.locale).label));
    box.append(meta);
    if (rest.length && openPicker) {
      const open = openPicker;
      const more = testid(el('button', 'ap-link ap-status-more'), 'more-plans');
      more.type = 'button';
      more.textContent = `+${t.more(rest.length)}`;
      more.setAttribute('aria-label', t.moreAria(rest.length));
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
    button(actions, 'open-detail', t.open, () => openRail(vc), 'ghost');
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
 * guidance (in progress, blocked, ready, waiting) only from complete current active detail;
 * otherwise the reported statuses. Without complete detail only the list's in-progress count.
 */
function statusProgress(p: StatusProjection, plan: PlanView, locale: string) {
  const language = resolveLanguage('auto', locale), t = messages[language];
  const s: PlanSummary = p.summary;
  const wrap = el('div', 'ap-progress ap-status-progress');
  const count = (n: number) => language === 'ru' ? formatCount(n, language) : String(n);
  const bar = segmentedBar(s, `${summaryText(s, language)}${s.working ? `, ${count(s.working)} ${t.progress}` : ''}${s.blocked ? `, ${count(s.blocked)} ${t.blocked}` : ''}`);
  if (bar) wrap.append(bar);
  const line = el('div', 'ap-status-counts');
  const counts = testid(el('span', 'ap-status-fraction'), 'counts');
  Object.assign(counts.dataset, { done: String(s.done), total: String(s.total), remaining: String(s.remaining), skipped: String(s.skipped) });
  if (s.total) counts.append(el('strong', '', count(s.done)), el('span', 'ap-muted', `/${count(s.total)}`), el('span', 'ap-sr', t.counts(s.remaining, s.skipped)));
  else counts.append(el('span', 'ap-muted', summaryText(s, language)));
  allDone(counts, s);
  line.append(counts);
  const r = p.reported;
  const guided = p.ready !== null && p.waiting !== null && r !== null;
  const chips: [MarkStatus, number, string][] = guided
    // Every reported blocker counts here; only decision/review waits are Needs you (the line above).
    ? [['working', r.working, t.progress], ['blocked', r.blocked, t.blocked], ['ready', p.ready!, t.ready], ['waiting', p.waiting!, t.waiting], ['skipped', r.skipped, t.skipped]]
    : r ? [['working', r.working, t.progress], ['blocked', r.blocked, t.blocked], ['pending', r.pending, t.pending], ['skipped', r.skipped, t.skipped]]
    : plan.lifecycle === 'active' ? [['working', plan.working.length, t.progress]] : [];
  for (const [state, count, label] of chips) { const c = stateChip({ state, count, label, locale }); if (c) line.append(c); }
  wrap.append(line);
  return wrap;
}

/** Concrete states beside the counts they qualify; never behind an explanation. */
function qualifiers(p: StatusProjection, captureEnabled: boolean, staleAt: string | null, locale: string) {
  const t = messages[resolveLanguage('auto', locale)];
  const box = el('div', 'ap-quals');
  if (staleAt) box.append(testid(warningLine(t.stale(staleAt), 'warning', 'div'), 'stale-banner'));
  if (!captureEnabled) box.append(testid(warningLine(t.capture, 'info', 'div'), 'capture-off'));
  if (p.detailUnavailable) box.append(testid(warningLine(t.unavailable, 'warning', 'div'), 'status-detail-unavailable'));
  const r = p.readiness;
  if (r.state === 'invalid') box.append(testid(warningLine(t.invalid, 'warning', 'div'), 'status-readiness-invalid'));
  else if (r.state === 'ready' && r.incomplete) box.append(testid(warningLine(t.incomplete, 'warning', 'div'), 'status-readiness-incomplete'));
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
  list.setAttribute('aria-label', messages[resolveLanguage('auto', env.locale)].focus);
  for (const item of p.focus) {
    const li = testid(el('li', 'ap-status-row'), `status-focus-${item.id}`);
    li.dataset.status = item.status;
    li.append(glyph(item.status, env.locale), el('span', 'ap-grow', item.title));
    const elapsed = elapsedLabel(plan, item, p.detail, env);
    if (elapsed) li.append(elapsed);
    list.append(li);
  }
  return list;
}
