import { mountSelect } from '@openchamber/sdk/ui';
import { button, el, testid } from './components.ts';
import type { CapturePanel, CaptureFailure } from './capture-comparison.ts';
import type { DocumentState } from '../../shared/progress.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';

const EN = {
  heading: 'Compare recorded captures', intro: 'See changes between two saved versions of this plan document. The live file is not rechecked.', unavailable: 'Capture comparison is unavailable with this service version.', close: 'Close comparison', older: 'Older capture', newer: 'Newer capture', comparing: 'Comparing…', compare: 'Compare', refresh: 'Refresh captures', more: 'Look for older captures', reversed: 'Choose the older capture first.', loading: 'Looking for recorded captures…', retry: 'Retry capture discovery', empty: 'No document captures have been recorded for this plan.', single: 'Only one recorded capture is available. A second capture is needed to show changes.', end: 'Reached the beginning of recorded capture history.', partial: 'More history may be available. Look for older captures to continue the bounded search.', newReport: 'A newer plan report is available. Your capture pair stays selected; refresh captures to discover versions, or Compare again for current checklist metadata.', currentSynced: 'Current capture: the task list was confirmed against it at the observed revision.', currentUnsynced: 'Current capture: task-list synchronization was not confirmed at the observed revision.', historical: 'Historical capture: checklist synchronization is unknown.', disabled: 'Capture is disabled; retained versions remain readable.', disclaimer: 'This comparison does not establish approval, completion, or the live file’s current contents.', equal: 'These captures contain identical text. This does not mean the live file is unchanged.', unknown: 'unknown', revision: 'revision', noNewline: 'no final newline', missing: 'This plan or capture is no longer available. Refresh the plan list.', conflict: 'The source or archive state changed. Refresh this view before comparing.', failed: 'The recorded captures could not be read. Retry when the service is available.', boundary: 'The capture discovery boundary changed. Refresh captures to start again.',
};
const COPY = { en: EN, ru: {
  heading: 'Сравнить записанные снимки', intro: 'Изменения между двумя сохранёнными версиями документа плана. Текущий файл не перепроверяется.', unavailable: 'Эта версия сервиса не поддерживает сравнение снимков.', close: 'Закрыть сравнение', older: 'Более старый снимок', newer: 'Более новый снимок', comparing: 'Сравнение…', compare: 'Сравнить', refresh: 'Обновить снимки', more: 'Искать более старые снимки', reversed: 'Сначала выберите более старый снимок.', loading: 'Поиск записанных снимков…', retry: 'Повторить поиск снимков', empty: 'Для этого плана снимки документа не записаны.', single: 'Доступен только один снимок. Для показа изменений нужен второй.', end: 'Достигнуто начало истории записанных снимков.', partial: 'Возможно, есть более ранняя история. Продолжите ограниченный поиск более старых снимков.', newReport: 'Доступен новый отчёт плана. Выбранная пара снимков сохранена; обновите снимки для поиска версий или сравните снова для актуальных метаданных списка задач.', currentSynced: 'Текущий снимок: список задач подтверждён по нему на наблюдаемой ревизии.', currentUnsynced: 'Текущий снимок: синхронизация списка задач на наблюдаемой ревизии не подтверждена.', historical: 'Исторический снимок: синхронизация списка задач неизвестна.', disabled: 'Создание снимков отключено; сохранённые версии доступны для чтения.', disclaimer: 'Это сравнение не подтверждает одобрение, выполнение или текущее содержимое файла.', equal: 'Эти снимки содержат одинаковый текст. Это не означает, что текущий файл не изменился.', unknown: 'неизвестно', revision: 'ревизия', noNewline: 'нет завершающего перевода строки', missing: 'План или снимок больше недоступен. Обновите список планов.', conflict: 'Источник или состояние архива изменились. Обновите представление перед сравнением.', failed: 'Не удалось прочитать записанные снимки. Повторите попытку, когда сервис будет доступен.', boundary: 'Граница поиска снимков изменилась. Обновите снимки для нового поиска.',
} } satisfies Record<InterfaceLanguage, typeof EN>;

/** Fixed controller outcomes only; arbitrary service errors never become interface text. */
export function captureErrorText(failure: CaptureFailure | null | undefined, language: InterfaceLanguage = 'en') {
  switch (failure) {
    case 'missing': case 'conflict': case 'boundary': return COPY[language][failure];
    default: return COPY[language].failed;
  }
}

const DOCUMENT_STATES = {
  en: { unbound: 'no file linked', captured: 'captured', denied: 'access denied', missing: 'file missing', moved: 'file moved', oversized: 'file too large', 'non-text': 'not a text file', unavailable: 'file unavailable', 'changed-during-read': 'changed while being read' },
  ru: { unbound: 'файл не привязан', captured: 'снимок записан', denied: 'доступ запрещён', missing: 'файл не найден', moved: 'файл перемещён', oversized: 'файл слишком большой', 'non-text': 'не текстовый файл', unavailable: 'файл недоступен', 'changed-during-read': 'изменился во время чтения' },
} satisfies Record<InterfaceLanguage, Record<DocumentState, string>>;

const when = (value: string, locale: string) => new Date(value).toLocaleString(locale);
/** Literal text only: captured markup never reaches an HTML or Markdown renderer. */
export function captureComparisonBlock(p: CapturePanel, locale: string): HTMLElement {
  const language = resolveLanguage('auto', locale), copy = COPY[language], ru = language === 'ru';
  const section = testid(el('section', 'ap-capture'), 'capture-comparison');
  section.setAttribute('aria-label', copy.heading);
  section.append(el('h3', 'ap-h', copy.heading));
  section.append(el('p', 'ap-note', copy.intro));
  if (!p.capable) { section.append(el('p', 'ap-note', copy.unavailable)); return section; }
  const opener = button(section, 'capture-toggle', p.open ? copy.close : copy.heading, p.toggle);
  opener.querySelector('button')?.setAttribute('aria-expanded', String(p.open));
  if (!p.open) return section;
  const controls = el('div', 'ap-capture-controls');
  for (const [side,label] of [['before',copy.older],['after',copy.newer]] as const) {
    const holder = testid(el('div'), `capture-${side}`);
    mountSelect(holder, { label, value: p[side] ? String(p[side]!.id) : '', options: p.entries.map(e => ({ id: String(e.id), label: `#${e.id} · ${when(e.capturedAt,locale)} · ${copy.revision} ${e.revision}` })), onChange: id => p.choose(side, Number(id)) });
    controls.append(holder);
  }
  section.append(controls);
  const actions = el('div', 'ap-row'), reversed = !!p.before && !!p.after && p.before.id > p.after.id;
  button(actions,'capture-compare',p.comparing ? copy.comparing : copy.compare,p.compare,'outline',p.comparing || !p.before || !p.after || reversed);
  button(actions,'capture-refresh',copy.refresh,p.refresh,'ghost',p.loading);
  if (!p.exhausted && p.hasRead) button(actions,'capture-more',copy.more,p.more,'ghost',p.loading);
  section.append(actions);
  if (reversed) section.append(el('p','ap-note',copy.reversed));
  if (p.loading) section.append(testid(el('p','ap-note',copy.loading),'capture-loading'));
  if (p.indexFailure || p.indexError) { section.append(testid(el('p','ap-note',captureErrorText(p.indexFailure, language)),'capture-index-error'));button(section,'capture-retry',copy.retry,p.retryIndex,'outline',p.loading); }
  if (p.hasRead && !p.loading && !p.indexFailure && !p.indexError) {
    const count=p.entries.length;
    const message=p.exhausted ? count===0 ? copy.empty : count===1 ? copy.single : copy.end : copy.partial;
    section.append(testid(el('p','ap-note',message),'capture-coverage'));
  }
  if (p.newer) section.append(testid(el('p','ap-note',copy.newReport),'capture-newer'));
  if (p.comparisonFailure || p.comparisonError) section.append(testid(el('p','ap-note',captureErrorText(p.comparisonFailure, language)),'capture-error'));
  const r=p.result;if(!r)return section;
  const metadata=el('div','ap-capture-metadata');
  for(const [label,e] of [[copy.older,r.before],[copy.newer,r.after]] as const){
    const box=el('div');box.append(el('h4','ap-h',`${label} #${e.id}`),el('p','ap-note',`${when(e.capturedAt,locale)} · ${copy.revision} ${e.revision}`),el('p','ap-capture-path',e.path));
    box.append(el('p','ap-note',e.id===r.current.captureId ? r.current.checklistSynchronized ? copy.currentSynced : copy.currentUnsynced : copy.historical));
    metadata.append(box);
  }
  section.append(metadata);
  const checked = r.current.checkedAt ? when(r.current.checkedAt,locale) : copy.unknown;
  section.append(el('p','ap-note',ru ? `Текущие метаданные наблюдались на ревизии плана ${r.current.revision}. Последняя проверка файла: ${checked}.` : `Current metadata observed at plan revision ${r.current.revision}. Last file check: ${checked}.`));
  const state = Object.hasOwn(DOCUMENT_STATES[language], r.current.state) ? DOCUMENT_STATES[language][r.current.state as DocumentState] : copy.unknown;
  if(r.current.state!=='captured')section.append(el('p','ap-note',ru ? `Последняя проверка файла: ${state}. Эти сохранённые снимки не являются текущим файлом.` : `The latest file check is ${state}. These retained captures are not the current file.`));
  if(!r.current.captureEnabled)section.append(el('p','ap-note',copy.disabled));
  section.append(el('p','ap-note',copy.disclaimer));
  const result=r.result;
  if(result.state==='equal'){section.append(testid(el('p','ap-note',copy.equal),'capture-equal'));return section;}
  if(result.state==='limited'){
    const reasons = { en: {bytes:'the stored document exceeds the supported size',lines:'there are too many lines',work:'the changes exceed the comparison work limit',output:'the diff is too large to display'}, ru: {bytes:'размер сохранённого документа превышает допустимый',lines:'слишком много строк',work:'изменения превышают лимит работы сравнения',output:'разница слишком велика для показа'} };
    const reason=reasons[language][result.reason];
    section.append(testid(el('p','ap-note',ru ? `Сравнение ограничено: ${reason}. Частичная разница не показана. Выберите более близкую пару или прочитайте записанный документ выше.` : `Comparison is limited because ${reason}. No partial diff is shown. Choose a closer pair or read the recorded document above.`),'capture-limited'));return section;
  }
  section.append(testid(el('p','ap-note',ru ? `Добавлено: ${result.added} · удалено: ${result.removed}. + означает добавление; − означает удаление. LF, CRLF и «нет завершающего перевода строки» обозначают окончания строк.` : `${result.added} added · ${result.removed} removed. + means added; − means removed. LF, CRLF and “no final newline” identify line endings.`),'capture-diff-summary'));
  const diff=testid(el('div','ap-capture-diff'),'capture-diff');
  for(const h of result.hunks){
    if(h.omittedBefore)diff.append(el('p','ap-capture-context',ru ? `Пропущено неизменённых строк: ${h.omittedBefore}` : `${h.omittedBefore} unchanged lines omitted`));
    diff.append(el('p','ap-capture-context',ru ? `Строка старого снимка ${h.oldStart} · нового ${h.newStart}` : `Older line ${h.oldStart} · newer line ${h.newStart}`));
    for(const l of h.lines){
      const line=el('div',`ap-capture-line ap-capture-${l.kind}`);
      line.append(el('span','ap-capture-number',`${l.oldLine??'·'} ${l.newLine??'·'} ${l.kind==='added'?'+':l.kind==='removed'?'−':' '}`),el('code','ap-capture-text',l.text));
      if(l.kind!=='context')line.append(el('span','ap-capture-ending',l.ending==='none'?copy.noNewline:l.ending.toUpperCase()));
      diff.append(line);
    }
  }
  if(result.omittedAfter)diff.append(el('p','ap-capture-context',ru ? `Пропущено неизменённых строк: ${result.omittedAfter}` : `${result.omittedAfter} unchanged lines omitted`));
  section.append(diff);return section;
}
