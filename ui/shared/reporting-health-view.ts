import { button, el, testid } from './components.ts';
import { reportingCopyText, supportSummary, type ReportingHealth } from './reporting-health.ts';
import { resolveLanguage } from './i18n.ts';
import { managedCopy } from './managed-copy.ts';
const en = {
  close:'Close reporting health', title:'Reporting health', checked:'Last explicit check · recorded observations only', checking:'Checking reporting observations…',
  meanings:'What these checks mean', limits:'Service platform and session tool availability are unknown. These checks do not prove recent reporting or task completion.',
  serviceUnavailable:'The reporting service could not be checked. Review the host connection and Setup diagnostics, then retry.',
  support:'Support summary', preview:'Support summary preview', copy:'Copy support summary', refresh:'Refresh observations',
  labels:{service:'Service',installation:'Delivery setup',loaded:'Load observation',capture:'Stored capture control',report:'Selected report',scope:'Source',viewer:'Viewer'},
  short:{observed:'Responding',installed:'Installed','not-configured':'Not configured','not-observed':'Not confirmed','matching-observation':'Match observed','reload-required':'Reload needed',on:'On',off:'Off','recorded-revision':'Recorded','not-checked':'Not checked','selected-source':'Matches selection','source-mismatch':'Different source','association-unknown':'Not verified','selected-report':'Revision matches','revision-changed':'Refresh needed',stale:'Stale',unknown:'Unknown',unavailable:'Unavailable','context-changed':'Recheck needed',busy:'Busy',damaged:'Unreadable',incompatible:'Incompatible','store-unavailable':'Unavailable','not-approved':'Access needed',paused:'Paused'},
  explain:{
  observed:'The service answered this explicit setup check. This does not prove recent reporting.',busy:'The progress store is busy. Try again shortly.',damaged:'The store could not be read because damage was reported. Preserve its files and review Setup diagnostics.',incompatible:'The store format is incompatible. Review the installed extension version.',
  'store-unavailable':'The configured store could not be opened. Review Setup and restore access before retrying.',
  'not-approved':'Service access is not granted. Review the extension service permissions in the host.',paused:'The extension is paused. Resume it in the host before checking again.',
  'association-unknown':'This setup observation cannot be associated with the viewer source. Report verification was not attempted.',
  'source-mismatch':'The selected plan belongs to a different source from this configured companion. Select a plan from the configured source to check its reporting.',
  'selected-source':'The selected report belongs to the configured source and is included in this viewer selection.',
  'not-configured':'No configured installation was observed. Open Setup to review your folders.',installed:'Companion installation observed.',
  'not-observed':'An installed companion could not be established. Review Setup diagnostics.',
  'reload-required':'The selected companion files have no matching loaded observation. Restart OpenCode when convenient; this check does not restart it.',
  'matching-observation':'A matching companion load was recorded. Other running instances may still use earlier files.',
  on:'Capture is on. Agents still need to report explicitly.',off:'Capture is off. Existing history remains readable; review Setup to enable capture.',
  'not-checked':'No selected report checked. Select a plan, then open reporting health.',
  'recorded-revision':'A stored revision of the selected plan was read. This does not prove recent reporting or task completion.',
  unavailable:'The selected report could not be read. Refresh the board and review its service diagnostics.',
  'context-changed':'Setup and viewer identity could not be matched. Refresh the board before checking again.',
  stale:'The viewer has a failed refresh. Its displayed data may be stale.',
  'selected-report':'The selected report revision matches the viewer. This does not prove that a user reviewed it.',
  'revision-changed':'The stored revision differs from the viewer. Refresh the board.',unknown:'Unknown; this check has no supporting observation.',
}};
const ru: typeof en = {
  close:'Закрыть диагностику отчётности', title:'Диагностика отчётности', checked:'Последняя явная проверка · только записанные наблюдения', checking:'Проверка наблюдений отчётности…',
  meanings:'Что означают эти проверки', limits:'Платформа сервиса и доступность инструментов сессии неизвестны. Проверки не доказывают недавнюю отчётность или выполнение задач.',
  serviceUnavailable:'Не удалось проверить сервис отчётности. Проверьте соединение с хостом и диагностику настройки, затем повторите попытку.',
  support:'Сводка для поддержки', preview:'Предпросмотр сводки для поддержки', copy:'Копировать сводку для поддержки', refresh:'Обновить наблюдения',
  labels:{service:'Сервис',installation:'Настройка доставки',loaded:'Наблюдение загрузки',capture:'Управление записью',report:'Выбранный отчёт',scope:'Источник',viewer:'Просмотр'},
  short:{observed:'Отвечает',installed:'Установлен','not-configured':'Не настроен','not-observed':'Не подтверждён','matching-observation':'Совпадение записано','reload-required':'Нужен перезапуск',on:'Включена',off:'Выключена','recorded-revision':'Записан','not-checked':'Не проверен','selected-source':'Соответствует выбору','source-mismatch':'Другой источник','association-unknown':'Не подтверждён','selected-report':'Ревизия совпадает','revision-changed':'Нужно обновить',stale:'Устаревшие данные',unknown:'Неизвестно',unavailable:'Недоступен','context-changed':'Нужна повторная проверка',busy:'Занят',damaged:'Не читается',incompatible:'Несовместим','store-unavailable':'Недоступен','not-approved':'Нужен доступ',paused:'Приостановлен'},
  explain:{
    observed:'Сервис ответил на эту явную проверку настройки. Это не доказывает недавнюю отчётность.',
    busy:'Хранилище прогресса занято. Повторите попытку чуть позже.',
    damaged:'Не удалось прочитать хранилище: сообщено о повреждении. Сохраните его файлы и проверьте диагностику настройки.',
    incompatible:'Формат хранилища несовместим. Проверьте установленную версию расширения.',
    'store-unavailable':'Настроенное хранилище не удалось открыть. Проверьте настройку и восстановите доступ перед повторной попыткой.',
    'not-approved':'Доступ к сервису не разрешён. Проверьте разрешения сервисов расширения в хосте.',
    paused:'Расширение приостановлено. Возобновите его в хосте перед повторной проверкой.',
    'association-unknown':'Наблюдение настройки невозможно связать с источником просмотра. Проверка отчёта не выполнялась.',
    'source-mismatch':'Выбранный план относится к другому источнику, а не к настроенному компаньону. Выберите план настроенного источника для проверки отчётности.',
    'selected-source':'Выбранный отчёт относится к настроенному источнику и включён в текущий выбор просмотра.',
    'not-configured':'Настроенная установка не наблюдалась. Откройте настройку для проверки папок.',
    installed:'Наблюдалась установка компаньона.',
    'not-observed':'Наличие установленного компаньона не подтверждено. Проверьте диагностику настройки.',
    'reload-required':'Для выбранных файлов компаньона нет наблюдения соответствующей загрузки. Перезапустите OpenCode, когда удобно; эта проверка его не перезапускает.',
    'matching-observation':'Записана загрузка соответствующего компаньона. Другие работающие экземпляры могут использовать прежние файлы.',
    on:'Запись включена. Агенты по-прежнему должны явно сообщать о прогрессе.',
    off:'Запись выключена. История остаётся доступной для чтения; включить запись можно в настройке.',
    'not-checked':'Выбранный отчёт не проверен. Выберите план, затем откройте диагностику отчётности.',
    'recorded-revision':'Прочитана сохранённая ревизия выбранного плана. Это не доказывает недавнюю отчётность или выполнение задач.',
    unavailable:'Выбранный отчёт не удалось прочитать. Обновите доску и проверьте диагностику сервиса.',
    'context-changed':'Не удалось сопоставить идентификаторы настройки и просмотра. Обновите доску перед повторной проверкой.',
    stale:'Обновление просмотра завершилось ошибкой. Показанные данные могут быть устаревшими.',
    'selected-report':'Ревизия выбранного отчёта совпадает с просмотром. Это не доказывает, что пользователь его проверил.',
    'revision-changed':'Сохранённая ревизия отличается от показанной. Обновите доску.',
    unknown:'Неизвестно; у проверки нет подтверждающего наблюдения.',
  },
};
export function reportingHealthBlock(p:ReturnType<ReportingHealth['claim']>, locale='en'){
  const text=resolveLanguage('auto',locale)==='ru'?ru:en;
  const box=testid(el('section','ap-health'),'reporting-health');
  button(box,'reporting-health-toggle',p.open?text.close:text.title,p.toggle,'ghost');
  box.querySelector('button')?.setAttribute('aria-expanded',String(p.open));
  if(!p.open)return box;
  box.append(el('p','ap-note',text.checked));
  box.setAttribute('aria-busy',String(p.busy));
  if(p.busy)box.append(el('p','ap-note',text.checking));
  if(p.facts){
    const labels=Object.entries(text.labels) as [keyof typeof text.labels,string][];
    const managed=managedCopy(locale);
    const short:Readonly<Record<string,string>>={...text.short,'managed-configured':managed.configured,'invalid-binding':text.short.unavailable,'different-bytes':managed.different,'legacy-unresolved':managed.resume,'legacy-unsupported':text.short.unavailable};
    const explain:Readonly<Record<string,string>>={...text.explain,'managed-configured':managed.reach,'invalid-binding':managed.invalid,'different-bytes':managed.warning,'legacy-unresolved':managed.pending,'legacy-unsupported':managed.unsupported,'matching-observation':managed.observation,'not-observed':managed.missing+' · '+managed.observation,on:managed.on+' · '+managed.observation,off:managed.off};
    const positive=new Set(['observed','installed','managed-configured','matching-observation','on','recorded-revision','selected-source','selected-report']);
    const neutral=new Set(['unknown','not-checked','not-observed','association-unknown']);
    const list=el('dl','ap-health-grid');
    for(const [key,label] of labels){const value=p.facts[key];const row=el('div','ap-health-row');const status=el('dd','ap-health-status');status.dataset.tone=positive.has(value)?'good':neutral.has(value)?'neutral':'attention';const mark=el('span','ap-health-mark',positive.has(value)?'✓':neutral.has(value)?'—':'!');mark.setAttribute('aria-hidden','true');status.append(mark,el('span','',short[value]??text.short.unknown));row.append(el('dt','',label),status);list.append(row);}
    box.append(list);
    const details=testid(el('details','ap-health-details'),'reporting-explanations');details.append(el('summary','',text.meanings));
    const explanations=el('dl','ap-health-explanations');
    for(const [key,label] of labels)explanations.append(el('dt','',label),el('dd','',key==='service'&&p.facts[key]==='unavailable'?text.serviceUnavailable:explain[p.facts[key]]??explain.unknown));
    details.append(explanations,el('p','ap-note',text.limits),el('p','ap-note',managed.lifecycle),el('p','ap-note',managed.reach));box.append(details);
    const support=testid(el('details','ap-health-details'),'reporting-support');support.append(el('summary','',text.support));
    const preview=testid(el('textarea'),'reporting-support-preview');preview.dataset.observation=p.observation;preview.readOnly=true;preview.value=supportSummary(p.facts);preview.rows=8;preview.className='ap-summary-text';preview.setAttribute('aria-label',text.preview);support.append(preview);
    button(support,'reporting-support-copy',text.copy,p.copySummary);
    const status=el('p','ap-note',reportingCopyText(p.copyState,locale));status.setAttribute('role','status');support.append(status);box.append(support);
  }
  button(box,'reporting-health-refresh',text.refresh,p.refresh,'outline',p.busy);
  return box;
}
