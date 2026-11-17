import { mountSelect } from '@openchamber/sdk/ui';
import { RECENT_SCOPES, startView, type ViewContext } from '../shared/app.ts';
import { age, allDone, button, el, emptyBlock, failureBlock, loadingBlock, retryRead, testid } from '../shared/components.ts';
import { PANEL_SURFACE_ID } from '../shared/config.ts';
import { clockTime, formatCount, plural } from '../shared/format.ts';
import { planProject } from '../shared/live.ts';
import { censusFor, planFacts } from '../shared/census.ts';
import { runClaim } from '../shared/census-view.ts';
import { rosterFor } from '../shared/subagents.ts';
import { lifecycleLabel, showsLiveness, summaryText, type PlanSummary, type PlanView } from '../shared/model.ts';
import { resolveLanguage, type InterfaceLanguage } from '../shared/i18n.ts';
import { contextListScope, contextScope, projectsFor } from '../shared/scope.ts';
import { segmentedBar } from '../shared/primitives.ts';
import { StatusSelection } from './selection.ts';
import { projectStatus, type StatusProjection } from './projection.ts';
import { afterAnimationFrames, HeightSync } from '../shared/height.ts';
import { scopeInbox } from '../shared/inbox.ts';

type Ui = { selection: StatusSelection };
const messages = {
  en: { openFailed: 'Progress details could not open here.', noSession: 'No session selected', openSession: 'Open a session to see its reported progress.', setup: 'Agent progress is not set up yet', setupHelp: 'Set it up to see plans here.', setUp: 'Set up', noPlan: 'No plan reported for this session', appears: 'Progress appears here when an agent reports a plan.', featured: 'Featured plan', automatic: 'Automatic', prefer: 'Prefer reported working tasks', chosen: 'Chosen', chosenLabel: 'chosen', automaticLabel: 'chosen automatically', working: (n: number) => `${n} working`, picker: (title: string, chosen: boolean, n: number) => `Featured plan: ${title}, ${chosen ? 'chosen' : 'chosen automatically'}. ${plural(n, 'plan', 'plans')}; choose another`, updated: 'Updated ', more: (n: number) => plural(n, 'more plan', 'more plans'), moreAria: (n: number) => `${plural(n, 'more plan', 'more plans')} in this session: choose the featured plan`, open: 'Open progress', progress: 'in progress', ready: 'ready', waiting: 'waiting', blocked: 'blocked', pending: 'pending', skipped: 'skipped', counts: (n: number, skipped: number) => ` done, ${n} remaining${skipped ? `, ${skipped} skipped` : ''}`, stale: (time: string) => `Not refreshed since ${time}. Counts may be out of date.`, capture: 'Capture off: these are the last reported counts.', unavailable: 'Task details couldn’t be loaded.', invalid: 'Ready and waiting are unavailable for this report.', incomplete: 'Some recorded prerequisites aren’t in this plan.', focus: 'Blocked and in progress' },
  ru: { openFailed: 'Не удалось открыть подробности прогресса.', noSession: 'Сессия не выбрана', openSession: 'Откройте сессию, чтобы увидеть её отчёты о прогрессе.', setup: 'Прогресс агента ещё не настроен', setupHelp: 'Настройте его, чтобы видеть планы.', setUp: 'Настроить', noPlan: 'В этой сессии нет отчёта о плане', appears: 'Прогресс появится здесь, когда агент сообщит о плане.', featured: 'Основной план', automatic: 'Автоматически', prefer: 'Предпочитать задачи с отчётом о работе', chosen: 'Выбран', chosenLabel: 'выбран', automaticLabel: 'выбран автоматически', working: (n: number) => `В работе: ${formatCount(n, 'ru')}`, picker: (title: string, chosen: boolean, n: number) => `Основной план: ${title}, ${chosen ? 'выбран' : 'выбран автоматически'}. Планов: ${formatCount(n, 'ru')}; выбрать другой`, updated: 'Обновлено ', more: (n: number) => `Ещё планов: ${formatCount(n, 'ru')}`, moreAria: (n: number) => `Других планов в этой сессии: ${formatCount(n, 'ru')}; выбрать основной план`, open: 'Открыть прогресс', progress: 'в работе', ready: 'готово к работе', waiting: 'ожидает', blocked: 'заблокировано', pending: 'не начато', skipped: 'пропущено', counts: (n: number, skipped: number) => ` выполнено, осталось: ${formatCount(n, 'ru')}${skipped ? `, пропущено: ${formatCount(skipped, 'ru')}` : ''}`, stale: (time: string) => `Не обновлялось с ${time}. Счётчики могут быть устаревшими.`, capture: 'Запись отключена: показаны последние полученные счётчики.', unavailable: 'Не удалось загрузить подробности задач.', invalid: 'Готовность и ожидание недоступны для этого отчёта.', incomplete: 'Некоторые записанные предварительные условия отсутствуют в этом плане.', focus: 'Заблокированные и в работе' },
  'zh-CN': { openFailed: '无法在此处打开进度详情。', noSession: '未选择会话', openSession: '打开一个会话，查看其已报告的进度。', setup: '尚未设置智能体进度', setupHelp: '完成设置后即可在此查看计划。', setUp: '开始设置', noPlan: '此会话尚未报告计划', appears: '智能体报告计划后，进度将显示在这里。', featured: '重点计划', automatic: '自动选择', prefer: '优先显示已报告进行中的任务', chosen: '已选择', chosenLabel: '已选择', automaticLabel: '自动选择', working: (n: number) => `${n} 个进行中`, picker: (title: string, chosen: boolean, n: number) => `重点计划：${title}，${chosen ? '手动选择' : '自动选择'}。共 ${n} 个计划；选择其他计划`, updated: '更新于 ', more: (n: number) => `${n} 个其他计划`, moreAria: (n: number) => `此会话另有 ${n} 个计划：选择重点计划`, open: '打开进度', progress: '进行中', needs: '需要你处理', ready: '已就绪', waiting: '等待中', blocked: '受阻', pending: '未开始', skipped: '已跳过', counts: (n: number, skipped: number) => ` 已完成，剩余 ${n}${skipped ? `，已跳过 ${skipped}` : ''}`, stale: (time: string) => `自 ${time} 起尚未刷新，计数可能已过期。`, capture: '采集已关闭：这些是上次报告的计数。', unavailable: '无法加载任务详情。', invalid: '此报告的就绪和等待状态不可用。', incomplete: '部分已记录的前置任务不在此计划中。', focus: '受阻和进行中的任务' },
} satisfies Record<InterfaceLanguage, Record<string, string | ((...args: never[]) => string)>>;
let heights: HeightSync | null = null;
let reportAgeShown = false;

const wantsReportAge = (vc: ViewContext<Ui>, plan: PlanView | null) => !!plan
  && plan.lifecycle === 'active' && !!vc.read?.captureEnabled && !vc.failure
  && vc.env.now - Date.parse(plan.reportedAt) > 3_600_000;

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
  refreshed: (vc) => {
    // Successful unchanged polls still cross wall-clock boundaries. Invalidate
    // only when visibility differs from the last paint, through the data guard.
    if (wantsReportAge(vc, primary(vc)) !== reportAgeShown) vc.invalidate();
  },
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
    reportAgeShown = false;
    const { read, failure, env } = vc;
    const t = messages[resolveLanguage('auto', env.locale)];
    if (!read) {
      if (!vc.session?.id) root.append(emptyBlock('unscoped-state', t.noSession, t.openSession, true));
      if (failure) root.append(failureBlock(failure, retryRead(vc), env.locale));
      else if (vc.health && !vc.health.ready) root.append(emptyBlock('setup-needed', t.setup, t.setupHelp, true, { label: t.setUp, onClick: () => openRail(vc) }));
      else if (vc.session?.id) root.append(loadingBlock(env.locale));
      return;
    }
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
    const p = projectStatus(plan, vc.detail(plan), env.view);
    const box = testid(el('section', 'ap-status-plan'), `plan-${plan.id}`);
    box.dataset.source = plan.sourceId;
    box.dataset.lifecycle = plan.lifecycle;
    box.dataset.revision = String(plan.revision);
    if (showsLiveness(plan.lifecycle, p.summary, env.view)) box.dataset.motion = 'on';
    // One title with a compact position picker; its popup keeps Automatic and every full title.
    const head = el('div', 'ap-status-head');
    // Owning heading of a recovered read (docs/ui.md Restoration): a focus target, never a Tab stop.
    const title = testid(el('span', 'ap-status-title', plan.title), 'status-plan-title');
    title.title = plan.title;
    title.tabIndex = -1;
    head.append(title);
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
        const position = `${scope.plans.indexOf(plan) + 1}/${scope.plans.length}${read.truncated ? '+' : ''}`;
        trigger.removeAttribute('aria-labelledby');
        trigger.setAttribute('aria-label', `${t.featured}: ${plan.title}. ${selected ? t.chosen : t.automatic}. ${position}`);
        trigger.prepend(el('span', 'ap-title-picker-hint', position));
        // The title reads as the picker too (pointer only; the trigger is the keyboard control).
        title.classList.add('ap-plan-title-pick');
        title.addEventListener('click', () => trigger.click());
      }
      head.append(holder);
    }
    box.append(head, statusProgress(p, plan, env.locale));
    // Reuse the roster's proven, deduplicated session counts, never task-working counts.
    // No roster/pager is mounted here; failures still have an undismissable compact home.
    const session = vc.session?.id;
    const runs = session && read.binding.verified && plan.sourceId === env.boundSource
      ? vc.runs(runClaim(read, session, plan)) : null;
    const roster = session && read.binding.verified && plan.sourceId === env.boundSource
      ? rosterFor({
        surface: 'status', plan, census: censusFor(session, vc.directory, vc.live), facts: planFacts(plan, vc.detail(plan), env.boundSource),
        runs, verified: true, currentSession: session, liveSeq: vc.live.seq,
      }, resolveLanguage('auto', env.locale)) : null;
    const activity = testid(el('div', 'ap-status-activity'), 'status-activity');
    for (const part of [...(roster?.summary ?? [])].sort((a, b) => Number(b.kind === 'running') - Number(a.kind === 'running'))) {
      if (part.kind === 'running' || part.kind === 'waiting') {
        if (activity.childNodes.length) activity.append(' · ');
        activity.append(el('span', '', part.text));
      }
    }
    const inbox = vc.inbox?.model ? scopeInbox(vc.inbox.model, new Set(scope.plans.map(p => p.key)), !failure && !read.truncated, vc.inbox.device, vc.inbox.storeId).model : null;
    const compact = compactMessages[resolveLanguage('auto', env.locale)];
    if (inbox?.availability === 'ready' && (inbox.counts.needsYou || !inbox.complete)) {
      if (activity.childNodes.length) activity.append(' · ');
      const count = testid(el('button', 'ap-link', compact.needs(`${formatCount(inbox.counts.needsYou, env.locale)}${inbox.complete ? '' : '+'}`)), 'needs-you-count');
      count.type = 'button';
      Object.assign(count.dataset, { count: String(inbox.counts.needsYou), exact: String(inbox.complete) });
      count.setAttribute('aria-label', `${count.textContent}. ${t.open}`);
      count.addEventListener('click', () => openRail(vc));
      activity.append(count);
    }
    if (plan.lifecycle !== 'active') {
      if (activity.childNodes.length) activity.prepend(`${lifecycleLabel(plan.lifecycle, env.locale)} · `);
      else activity.append(lifecycleLabel(plan.lifecycle, env.locale));
    }
    if (activity.childNodes.length) box.append(activity);
    // Report age is not host activity. Only old active reports need an age line.
    if (!read.captureEnabled) box.append(testid(el('div', 'ap-note', compact.off), 'capture-off'));
    else if (wantsReportAge(vc, plan)) {
      reportAgeShown = true;
      box.append(testid(age(plan.reportedAt, env, t.updated), 'status-stale-time'));
    }
    if (failure) {
      const failed = testid(el('div', 'ap-note', t.stale(clockTime(vc.lastGoodAt ?? env.now, env.locale))), 'stale-banner');
      failed.setAttribute('role', 'status');
      button(failed, 'status-retry', compact.retry, retryRead(vc), 'ghost');
      box.append(failed);
    }
    if (p.detailUnavailable) box.append(testid(el('p', 'ap-note', compact.detailFailed), 'status-detail-unavailable'));
    if (inbox && inbox.availability !== 'ready') box.append(testid(el('p', 'ap-note', compact.inboxFailed), 'status-inbox-error'));
    if (inbox?.moreFailed) box.append(testid(el('p', 'ap-note', compact.moreFailed), 'status-inbox-page-error'));
    if (runs?.state === 'error' || runs?.failure) box.append(testid(el('p', 'ap-note', compact.runsFailed), 'status-runs-error'));
    if (runs?.pageError) box.append(testid(el('p', 'ap-note', compact.moreFailed), 'subagent-page-error'));
    if (runs?.historyRequestFailed || runs?.read?.recovery.state === 'failed') box.append(testid(el('p', 'ap-note', compact.historyFailed), 'status-history-error'));
    root.append(box);
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
    // Keep the existing bounded layout-change guard; a queued event from a retired
    // or already measured layout cannot send another height request.
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
 * Whole-plan bar and fraction. The accessible summary retains remaining/skipped
 * and reported working/blocked facts without adding visible chips.
 */
function statusProgress(p: StatusProjection, plan: PlanView, locale: string) {
  const language = resolveLanguage('auto', locale), t = messages[language];
  const s: PlanSummary = p.summary;
  const wrap = el('div', 'ap-progress ap-status-progress');
  const count = (n: number) => language === 'en' ? String(n) : formatCount(n, language);
  const bar = segmentedBar(s, `${summaryText(s, language)}${s.working ? `, ${count(s.working)} ${t.progress}` : ''}${s.blocked ? `, ${count(s.blocked)} ${t.blocked}` : ''}`);
  if (bar) wrap.append(bar);
  const line = el('div', 'ap-status-counts');
  const counts = testid(el('span', 'ap-status-fraction'), 'counts');
  Object.assign(counts.dataset, { done: String(s.done), total: String(s.total), remaining: String(s.remaining), skipped: String(s.skipped) });
  if (s.total) counts.append(el('strong', '', count(s.done)), el('span', 'ap-muted', `/${count(s.total)}`), el('span', 'ap-sr', t.counts(s.remaining, s.skipped)));
  else counts.append(el('span', 'ap-muted', summaryText(s, language)));
  allDone(counts, s);
  line.append(counts);
  wrap.append(line);
  return wrap;
}

const compactMessages = {
  en: { needs: (n: string) => `${n} needs you`, retry: 'Retry', off: 'Recording is off.', detailFailed: 'Task details could not load.', inboxFailed: 'Needs you is unavailable.', runsFailed: 'Sub-agent records could not load.', moreFailed: 'More records could not load. Open progress to retry.', historyFailed: 'Earlier history could not load. Open progress to retry.' },
  ru: { needs: (n: string) => `Нужны вы: ${n}`, retry: 'Повторить', off: 'Запись отключена.', detailFailed: 'Не удалось загрузить задачи.', inboxFailed: 'Список «Нужны вы» недоступен.', runsFailed: 'Не удалось загрузить записи субагентов.', moreFailed: 'Не удалось загрузить ещё записи. Откройте прогресс для повтора.', historyFailed: 'Не удалось загрузить раннюю историю. Откройте прогресс для повтора.' },
  'zh-CN': { needs: (n: string) => `${n} 项需要你处理`, retry: '重试', off: '记录已关闭。', detailFailed: '无法加载任务详情。', inboxFailed: '需要你处理的事项暂不可用。', runsFailed: '无法加载子智能体记录。', moreFailed: '无法加载更多记录，请打开进度重试。', historyFailed: '无法加载较早的历史，请打开进度重试。' },
} satisfies Record<InterfaceLanguage, unknown>;
