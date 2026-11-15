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
}, 'zh-CN': {
  heading: '比较已记录的采集', intro: '查看此计划文档两个已保存版本之间的变更。不会重新检查当前文件。', unavailable: '此服务版本不支持采集比较。', close: '关闭比较', older: '较早的采集', newer: '较新的采集', comparing: '正在比较…', compare: '比较', refresh: '刷新采集', more: '查找更早的采集', reversed: '请先选择较早的采集。', loading: '正在查找已记录的采集…', retry: '重试采集查找', empty: '尚未为此计划记录任何文档采集。', single: '只有一个已记录的采集。需要第二个采集才能显示变更。', end: '已到达已记录采集历史的起点。', partial: '可能还有更早的历史。请查找更早的采集以继续限定范围的搜索。', newReport: '有更新的计划报告可用。采集对保持选中；刷新采集以发现版本，或再次比较以获取当前清单元数据。', currentSynced: '当前采集：在观察到的修订上已确认任务列表与之对应。', currentUnsynced: '当前采集：未在观察到的修订上确认任务列表同步。', historical: '历史采集：清单同步状态未知。', disabled: '采集已关闭；保留的版本仍可读取。', disclaimer: '此比较不能确定审批、完成情况或当前文件的内容。', equal: '这些采集包含相同的文本。这并不表示当前文件未更改。', unknown: '未知', revision: '修订', noNewline: '无结尾换行', missing: '此计划或采集已不再可用。请刷新计划列表。', conflict: '来源或归档状态已更改。请先刷新此视图再比较。', failed: '无法读取已记录的采集。请在服务可用时重试。', boundary: '采集查找边界已更改。请刷新采集以重新开始。',
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
  'zh-CN': { unbound: '未关联文件', captured: '已采集', denied: '访问被拒绝', missing: '文件缺失', moved: '文件已移动', oversized: '文件过大', 'non-text': '不是文本文件', unavailable: '文件不可用', 'changed-during-read': '读取期间已更改' },
} satisfies Record<InterfaceLanguage, Record<DocumentState, string>>;

type Sentences = {
  currentMetadata: (revision: number, checked: string) => string;
  latestCheck: (state: string) => string;
  limited: (reason: string) => string;
  diffSummary: (added: number, removed: number) => string;
  omitted: (count: number) => string;
  hunk: (oldStart: number, newStart: number) => string;
};
const SENTENCES: Readonly<Record<InterfaceLanguage, Sentences>> = {
  en: {
    currentMetadata: (revision, checked) => `Current metadata observed at plan revision ${revision}. Last file check: ${checked}.`,
    latestCheck: state => `The latest file check is ${state}. These retained captures are not the current file.`,
    limited: reason => `Comparison is limited because ${reason}. No partial diff is shown. Choose a closer pair or read the recorded document above.`,
    diffSummary: (added, removed) => `${added} added · ${removed} removed. + means added; − means removed. LF, CRLF and “no final newline” identify line endings.`,
    omitted: count => `${count} unchanged lines omitted`,
    hunk: (oldStart, newStart) => `Older line ${oldStart} · newer line ${newStart}`,
  },
  ru: {
    currentMetadata: (revision, checked) => `Текущие метаданные наблюдались на ревизии плана ${revision}. Последняя проверка файла: ${checked}.`,
    latestCheck: state => `Последняя проверка файла: ${state}. Эти сохранённые снимки не являются текущим файлом.`,
    limited: reason => `Сравнение ограничено: ${reason}. Частичная разница не показана. Выберите более близкую пару или прочитайте записанный документ выше.`,
    diffSummary: (added, removed) => `Добавлено: ${added} · удалено: ${removed}. + означает добавление; − означает удаление. LF, CRLF и «нет завершающего перевода строки» обозначают окончания строк.`,
    omitted: count => `Пропущено неизменённых строк: ${count}`,
    hunk: (oldStart, newStart) => `Строка старого снимка ${oldStart} · нового ${newStart}`,
  },
  'zh-CN': {
    currentMetadata: (revision, checked) => `当前元数据观察于计划修订 ${revision}。上次文件检查：${checked}。`,
    latestCheck: state => `上次文件检查结果：${state}。这些保留的采集不是当前文件。`,
    limited: reason => `比较受限：${reason}。未显示部分差异。请选择更接近的一对采集，或阅读上方的已记录文档。`,
    diffSummary: (added, removed) => `新增 ${added} 行 · 删除 ${removed} 行。+ 表示新增；− 表示删除。LF、CRLF 和“无结尾换行”表示行尾符。`,
    omitted: count => `已省略 ${count} 行未更改内容`,
    hunk: (oldStart, newStart) => `旧版第 ${oldStart} 行 · 新版第 ${newStart} 行`,
  },
};

const when = (value: string, locale: string) => new Date(value).toLocaleString(locale);
/** Literal text only: captured markup never reaches an HTML or Markdown renderer. */
export function captureComparisonBlock(p: CapturePanel, locale: string): HTMLElement {
  const language = resolveLanguage('auto', locale), copy = COPY[language], sentences = SENTENCES[language];
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
  section.append(el('p','ap-note',sentences.currentMetadata(r.current.revision, checked)));
  const state = Object.hasOwn(DOCUMENT_STATES[language], r.current.state) ? DOCUMENT_STATES[language][r.current.state as DocumentState] : copy.unknown;
  if(r.current.state!=='captured')section.append(el('p','ap-note',sentences.latestCheck(state)));
  if(!r.current.captureEnabled)section.append(el('p','ap-note',copy.disabled));
  section.append(el('p','ap-note',copy.disclaimer));
  const result=r.result;
  if(result.state==='equal'){section.append(testid(el('p','ap-note',copy.equal),'capture-equal'));return section;}
  if(result.state==='limited'){
    const reasons = { en: {bytes:'the stored document exceeds the supported size',lines:'there are too many lines',work:'the changes exceed the comparison work limit',output:'the diff is too large to display'}, ru: {bytes:'размер сохранённого документа превышает допустимый',lines:'слишком много строк',work:'изменения превышают лимит работы сравнения',output:'разница слишком велика для показа'}, 'zh-CN': {bytes:'存储的文档超出了支持的大小',lines:'行数过多',work:'变更超出了比较的工作量限制',output:'差异过大，无法显示'} } satisfies Record<InterfaceLanguage, Record<'bytes'|'lines'|'work'|'output',string>>;
    const reason=reasons[language][result.reason];
    section.append(testid(el('p','ap-note',sentences.limited(reason)),'capture-limited'));return section;
  }
  section.append(testid(el('p','ap-note',sentences.diffSummary(result.added, result.removed)),'capture-diff-summary'));
  const diff=testid(el('div','ap-capture-diff'),'capture-diff');
  for(const h of result.hunks){
    if(h.omittedBefore)diff.append(el('p','ap-capture-context',sentences.omitted(h.omittedBefore)));
    diff.append(el('p','ap-capture-context',sentences.hunk(h.oldStart, h.newStart)));
    for(const l of h.lines){
      const line=el('div',`ap-capture-line ap-capture-${l.kind}`);
      line.append(el('span','ap-capture-number',`${l.oldLine??'·'} ${l.newLine??'·'} ${l.kind==='added'?'+':l.kind==='removed'?'−':' '}`),el('code','ap-capture-text',l.text));
      if(l.kind!=='context')line.append(el('span','ap-capture-ending',l.ending==='none'?copy.noNewline:l.ending.toUpperCase()));
      diff.append(line);
    }
  }
  if(result.omittedAfter)diff.append(el('p','ap-capture-context',sentences.omitted(result.omittedAfter)));
  section.append(diff);return section;
}
