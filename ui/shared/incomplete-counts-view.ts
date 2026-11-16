import { el, testid } from './components.ts';
import { resolveLanguage } from './i18n.ts';
import type { DeviceViewState, ViewSurface } from './device-view-state.ts';
import { countReasonIdentity, emptyCountFacts, type CountFacts } from './incomplete-counts.ts';
import type { RunsPanel } from './runs.ts';
import type { InboxPanel } from './inbox.ts';
import { absoluteTime } from './format.ts';

const COPY = {
  en: { title: 'Counts may be incomplete.', more: 'Load more', detail: 'Some earlier work has not been checked yet.', gap: 'Some runs were not recorded, and dismissing this note acknowledges the recording gap.', dismiss: 'Dismiss note', failed: 'Couldn’t dismiss this note; try again.', conflict: 'A newer recording gap was found; review it before dismissing.', loadFailed: 'More work couldn’t be read; try again.', retry: 'Retry', loading: 'Loading…' },
  ru: { title: 'Числа могут быть неполными.', more: 'Загрузить ещё', detail: 'Часть прежней работы ещё не проверена.', gap: 'Некоторые запуски не записаны; скрытие этой заметки подтвердит ознакомление с пробелом в записи.', dismiss: 'Скрыть заметку', failed: 'Не удалось скрыть заметку; попробуйте снова.', conflict: 'Обнаружен новый пробел в записи; просмотрите его перед скрытием.', loadFailed: 'Не удалось прочитать больше работы; попробуйте снова.', retry: 'Повторить', loading: 'Загрузка…' },
  'zh-CN': { title: '计数可能不完整。', more: '加载更多', detail: '部分较早的工作尚未检查。', gap: '部分运行未被记录，关闭此提示也会确认你已知晓记录缺口。', dismiss: '关闭提示', failed: '无法关闭此提示，请重试。', conflict: '发现了新的记录缺口，请先查看再关闭。', loadFailed: '无法读取更多工作，请重试。', retry: '重试', loading: '加载中…' },
};
export const COUNT_CSS = `
.ap-count-note>.ap-link{align-self:flex-start;text-align:start;min-height:24px;color:var(--oc-muted)}
.ap-count-note .ap-row{flex-wrap:wrap;gap:4px 16px}
.ap-count-note .ap-link{min-height:24px}
.ap-count-note .ap-link[aria-disabled="true"]{color:var(--oc-muted);cursor:default;text-decoration:none}
@media(forced-colors:active){.ap-count-note .ap-link:focus-visible{outline:2px solid Highlight;outline-offset:2px;box-shadow:none}}
`;
const failedAt = {
  en: (time: string) => `More work couldn’t be read; last updated ${time}.`,
  ru: (time: string) => `Не удалось прочитать больше работы; последнее обновление: ${time}.`,
  'zh-CN': (time: string) => `无法读取更多工作；上次更新于 ${time}。`,
};

/** Frame-local expansion; only dismissal uses the existing device record. */
export class IncompleteCounts {
  facts: CountFacts = emptyCountFacts();
  private identity = '';
  private expanded = false;
  private pending = false;
  private error = false;
  private announced = '';
  private announcedRefresh = -1;
  private announcementText = '';
  private announcer: HTMLElement | null = null;
  private outcomeAnnouncer: HTMLElement | null = null;
  private outcome: unknown = 'idle';
  private outcomeText = '';
  private outcomeGeneration = 0;
  private changed: () => void;
  constructor(changed: () => void) { this.changed = changed; }
  dispose() { this.identity = ''; this.announced = ''; this.announcer?.remove(); this.announcer = null; this.outcomeGeneration++; this.outcomeAnnouncer?.remove(); this.outcomeAnnouncer = null; }

  /** Keep dismissal outcomes outside the repainted root, including repeated failures. */
  announceOutcome(runs: RunsPanel | null, attention: boolean, locale: string) {
    const language = resolveLanguage('auto', locale), c = COPY[language];
    const state = runs?.lossDismissal ?? 'idle';
    const token = state === 'error' || state === 'conflict' ? runs?.lossDismissalFailure ?? state : state;
    const text = state === 'success' ? attention ? '' : language === 'ru' ? 'Заметка скрыта.' : language === 'zh-CN' ? '提示已关闭。' : 'Note dismissed.'
      : state === 'error' ? c.failed : state === 'conflict' ? c.conflict : '';
    if (token === this.outcome && text === this.outcomeText) return;
    this.outcome = token; this.outcomeText = text;
    const generation = ++this.outcomeGeneration;
    if (!text) { if (this.outcomeAnnouncer) this.outcomeAnnouncer.textContent = ''; return; }
    if (!this.outcomeAnnouncer) {
      this.outcomeAnnouncer = testid(el('p', 'ap-sr'), 'incomplete-counts-outcome');
      this.outcomeAnnouncer.setAttribute('role', 'status'); this.outcomeAnnouncer.setAttribute('aria-live', 'polite'); this.outcomeAnnouncer.setAttribute('aria-atomic', 'true');
      document.body.append(this.outcomeAnnouncer);
    }
    const node = this.outcomeAnnouncer;
    node.textContent = '';
    requestAnimationFrame(() => { if (this.outcomeGeneration === generation) node.textContent = text; });
  }

  paint(root: HTMLElement, options: { facts: CountFacts; store: string; surface: ViewSurface; device: DeviceViewState | null; runs: RunsPanel | null; inbox: InboxPanel | null; locale: string; lastGoodAt: number | null; refresh: number }) {
    const { facts, store, surface, device, runs, inbox } = options;
    this.announceOutcome(runs, !!runs?.read?.capture.lossNotice?.attention, options.locale);
    this.facts = facts;
    const identity = countReasonIdentity(store, facts);
    if (identity !== this.identity) { this.identity = identity; this.expanded = false; this.error = false; }
    if (runs?.lossDismissal === 'error' || runs?.lossDismissal === 'conflict' || this.error) this.expanded = true;
    const c = COPY[resolveLanguage('auto', options.locale)];
    const failed = !!inbox?.model.moreFailed || !!runs?.pageError || !!runs?.historyRequestFailed
      || runs?.read?.recovery.state === 'failed' && runs.read.recovery.reason !== 'capture-disabled';
    const history = !!runs && (runs.read?.recovery.state === 'partial' || runs.read?.recovery.state === 'failed' && runs.read.recovery.reason !== 'capture-disabled' || runs.historyRequestFailed);
    const load = () => {
      if (inbox?.model.moreFailed) inbox.retry();
      else if (inbox?.model.canContinue) inbox.more();
      else if (history) runs!.retryHistory();
      else runs?.loadMore?.();
    };
    if (failed) {
      // A failed read is never hidden inside, or dismissed with, the indicator.
      const at = runs?.read?.readAt ?? options.lastGoodAt;
      const message = at === null ? c.loadFailed : failedAt[resolveLanguage('auto', options.locale)](absoluteTime(new Date(at).toISOString(), options.locale));
      const line = testid(el('p', 'ap-note', message), 'incomplete-counts-load-error');
      const retry = testid(el('button', 'ap-link', c.retry), 'incomplete-counts-retry'); retry.type = 'button';
      retry.addEventListener('click', load); line.append(' ', retry); root.append(line);
    }
    if (!facts.reasons.length || device?.dismissed(surface, identity)) {
      this.announced = ''; if (this.announcer) this.announcer.textContent = ''; return;
    }
    const box = testid(el('section', 'ap-section ap-count-note'), 'incomplete-counts');
    box.dataset.reasons = facts.reasons.join(' ');
    const toggle = testid(el('button', 'ap-link', c.title), 'incomplete-counts-toggle'); toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(this.expanded)); toggle.setAttribute('aria-controls', 'incomplete-counts-body');
    const body = testid(el('div'), 'incomplete-counts-body'); body.id = 'incomplete-counts-body'; body.hidden = !this.expanded;
    const attention = !!runs?.read?.capture.lossNotice?.attention;
    const actions = el('div', 'ap-row');
    body.append(el('p', 'ap-note', attention ? c.gap : c.detail), actions);
    toggle.addEventListener('click', () => { this.expanded = !this.expanded; toggle.setAttribute('aria-expanded', String(this.expanded)); body.hidden = !this.expanded; });
    const action = (hook: string, text: string, run: () => void, busy = false) => {
      const b = testid(el('button', 'ap-link', text), hook); b.type = 'button';
      if (busy) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('click', () => { if (!busy && this.identity === identity) run(); }); actions.append(b);
    };
    const canLoad = inbox?.model.canContinue || history || runs?.hasMore && facts.reasons.includes('runs-not-loaded');
    const loading = inbox?.model.loadingMore || runs?.reconciling || runs?.paging;
    if (canLoad && !failed) action('incomplete-counts-more', loading ? c.loading : c.more, load, !!loading);
    action('incomplete-counts-dismiss', c.dismiss, () => {
      if (this.pending) return;
      this.pending = true; this.error = false; this.expanded = true; this.changed();
      void (async () => {
        const acknowledged = !attention || await runs?.dismissLoss() === true;
        if (this.identity !== identity) { this.pending = false; this.changed(); return; }
        const saved = acknowledged && !!await device?.dismiss(surface, identity);
        this.error = !saved; this.pending = false; this.changed();
      })();
    }, this.pending);
    if (this.error || runs?.lossDismissal === 'error' || runs?.lossDismissal === 'conflict') {
      const line = testid(el('p', 'ap-note', runs?.lossDismissal === 'conflict' ? c.conflict : c.failed), 'incomplete-counts-dismiss-error');
      if (this.error && runs?.lossDismissal !== 'error' && runs?.lossDismissal !== 'conflict') line.setAttribute('role', 'status');
      body.append(line);
    }
    box.append(toggle, body); root.append(box);
    const announcement = JSON.stringify([identity, options.locale]);
    if (this.announced !== announcement) {
      this.announced = announcement;
      this.announcementText = c.title;
      if (this.announcedRefresh === options.refresh) return;
      this.announcedRefresh = options.refresh;
      if (!this.announcer) {
        this.announcer = testid(el('p', 'ap-sr'), 'incomplete-counts-announcer');
        this.announcer.setAttribute('role', 'status'); this.announcer.setAttribute('aria-live', 'polite');
        document.body.append(this.announcer);
      }
      this.announcer.textContent = '';
      requestAnimationFrame(() => { if (this.announced && this.announcedRefresh === options.refresh && this.announcer) this.announcer.textContent = this.announcementText; });
    }
  }
}
