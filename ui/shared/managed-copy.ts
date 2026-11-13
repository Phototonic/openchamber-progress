import { resolveLanguage } from './i18n.ts';

const en = {
  title: 'Extension-managed capture', unsupported: 'Managed setup is unsupported by this service. Update the extension and service together; no global plugin will be installed here.',
  choose: 'Review the managed OpenCode source and a private progress store. Opening Setup changes nothing. A custom store is optional; retained history is never reset.',
  store: 'Progress store folder', helper: 'Optional absolute path to a private store; leave blank to review the default',
  review: 'Review configuration', configure: 'Configure capture', migrate: 'Switch to extension-managed capture', resume: 'Review interrupted switch', enable: 'Turn on capture', disable: 'Turn off capture',
  confirm: 'Confirm', cancel: 'Cancel', ack: 'I reviewed this source, store and the effects below',
  privilege: 'Plugin code and the progress service run with your full account access. Approval in OpenChamber is separate from this store confirmation. Reports are explicit; tool access still depends on host policy.',
  lifecycle: 'Delivery mode is unknown. With a watched managed file, disabling or removing the extension retires its plugin; with caller-owned OPENCODE_CONFIG, an explicit OpenCode restart is required. Closing this view does not stop capture. Binding and history are kept. Held permission requests may fail while their session still needs interruption.',
  reach: 'Managed delivery covers only OpenChamber-managed OpenCode. Terminal, external or remote servers, isolated spaces and VS Code are not covered. Independent legacy or global entries can outlive the extension.',
  switchEffect: 'This switch disables capture, removes only validated legacy global discovery files, and selects the same store and source before re-enabling. History and retained recovery files stay. Cached legacy copies may need an explicit reload; independent legacy processes must be stopped or reloaded if you need their execution ended. No runtime is restarted here.',
  pending: 'The switch is pending or partly finished. Capture may remain off and recovery files are retained. Inspect the same target before explicitly retrying; do not assume a failed response undid changes. Nothing is automatically enabled or restored.',
  conflict: 'Legacy ownership or store/source identity conflicts. Nothing can be switched here until the conflict is resolved; no takeover or deletion is authorized.',
  unavailable: 'Legacy inspection is unavailable. Review the storage or platform diagnostic, resolve the failure and retry. This is not evidence of an ownership conflict. A verified managed store can still be turned off.',
  retry: 'Retry inspection',
  invalid: 'The managed binding is invalid. Existing files are left untouched. Review the diagnostics; no alternate store is selected.',
  configured: 'Private store configured', unconfigured: 'Private store not configured', complete: 'Legacy switch recorded; matching managed load is still a separate observation.',
  unknown: 'Loaded companion observation unknown', missing: 'No managed companion load observed', matching: 'Matching managed companion load observed',
  different: 'Loaded companion bytes differ', warning: 'The loaded version or bytes differ from the expected package. This warning alone does not block reporting. Fingerprints are observations, not publisher signatures or proof of exactly what the importer executed; matching bytes do not prove current activity or tool availability.',
  observation: 'A load observation is not a heartbeat, host approval, every session’s tool inventory, a recent report or task completion. Companion bytes ship with the extension; updates are managed in OpenChamber Settings → Extensions. Delivery mode is unknown here: a watched managed file can reload. With caller-owned OPENCODE_CONFIG, adding, removing or toggling the extension’s plugin requires an explicit OpenCode restart. An update to an installed extension may be picked up without a restart; check the load observation in Setup/Reporting health. An extension update alone does not prove that every running session loaded new bytes. Nothing is restarted here.',
  control: 'Capture control', on: 'Stored control: on', off: 'Stored control: off', controlUnknown: 'Stored control: unknown',
  controlEffect: 'This changes the verified store’s capture control, not task status or recorded history. It does not revoke independently installed copies or prove that a session has loaded the managed plugin.',
  configRoot: 'Reviewed OpenCode config', dataRoot: 'Reviewed OpenCode data', done: 'Configuration response received. Review the current control and load observations separately.',
  failed: 'The request did not finish successfully. Its effects may be partial; inspect the same target before retrying.',
  scope: 'This OpenCode scope uses an unsupported override. No effective runtime scope will be guessed; review its configuration outside this view.',
  selection: 'The selected store or source conflicts with the verified binding. Keep the existing selection and review the same target; nothing will be overwritten.',
  busy: 'Another configuration is in progress, or an interrupted configuration retained its lock. No lock or recovery files are removed automatically.',
  stale: 'The reviewed setup changed. Inspect again before confirming.', path: 'Use an absolute private store path, or leave it blank to review the default.',
};
const ru: typeof en = {
  title: 'Запись под управлением расширения', unsupported: 'Этот сервис не поддерживает управляемую настройку. Обновите расширение и сервис вместе; глобальный плагин здесь не устанавливается.',
  choose: 'Проверьте источник управляемого OpenCode и приватное хранилище прогресса. Открытие настройки ничего не меняет. Можно указать своё хранилище; история не сбрасывается.',
  store: 'Папка хранилища прогресса', helper: 'Необязательный абсолютный путь к приватному хранилищу; пустое поле — проверка стандартного пути',
  review: 'Проверить настройку', configure: 'Настроить запись', migrate: 'Перейти на запись под управлением расширения', resume: 'Проверить прерванный переход', enable: 'Включить запись', disable: 'Выключить запись',
  confirm: 'Подтвердить', cancel: 'Отмена', ack: 'Я проверил источник, хранилище и последствия ниже',
  privilege: 'Код плагина и сервис прогресса работают с полными правами вашей учётной записи. Разрешение OpenChamber не заменяет подтверждения хранилища. Отчёты явные; доступ к инструменту зависит от политики хоста.',
  lifecycle: 'Режим доставки неизвестен. При отслеживаемом управляемом файле отключение или удаление расширения завершает работу плагина; при пользовательском OPENCODE_CONFIG нужен явный перезапуск OpenCode. Закрытие просмотра не останавливает запись. Привязка и история сохраняются. Запросы, ожидающие разрешения, могут завершиться ошибкой, а сессии всё ещё может требоваться прерывание.',
  reach: 'Доставка действует только для OpenCode под управлением OpenChamber. Терминал, внешние и удалённые серверы, изолированные пространства и VS Code не охвачены. Независимые старые или глобальные плагины могут пережить расширение.',
  switchEffect: 'Переход выключает запись, удаляет только проверенные файлы глобального обнаружения старой установки и выбирает то же хранилище и источник перед включением. История и файлы восстановления сохраняются. Загруженным старым копиям может требоваться явная перезагрузка; независимые старые процессы нужно остановить или перезагрузить, если требуется завершить их работу. Здесь ничего не перезапускается.',
  pending: 'Переход ожидает завершения или выполнен частично. Запись может оставаться выключенной; файлы восстановления сохранены. Проверьте ту же цель перед явным повтором: ошибка ответа не означает отмену изменений. Автоматического включения или восстановления нет.',
  conflict: 'Конфликт владельца старой установки или хранилища/источника. Переход недоступен до разрешения конфликта; захват и удаление не разрешены.',
  unavailable: 'Проверка старой установки недоступна. Проверьте диагностику хранилища или платформы, устраните сбой и повторите проверку. Это не доказательство конфликта владельца. Запись в проверенное управляемое хранилище всё ещё можно выключить.',
  retry: 'Повторить проверку',
  invalid: 'Управляемая привязка недействительна. Файлы оставлены нетронутыми. Проверьте диагностику; другое хранилище не выбирается.',
  configured: 'Приватное хранилище настроено', unconfigured: 'Приватное хранилище не настроено', complete: 'Переход со старой установки записан; соответствующая управляемая загрузка проверяется отдельно.',
  unknown: 'Наблюдение загрузки компаньона неизвестно', missing: 'Управляемая загрузка компаньона не наблюдалась', matching: 'Записана соответствующая управляемая загрузка компаньона',
  different: 'Загруженные байты компаньона отличаются', warning: 'Загруженная версия или байты отличаются от ожидаемого комплекта. Само предупреждение не блокирует отчёты. Отпечатки — наблюдения, не подпись издателя и не доказательство точного исполнения импортёром; совпадение не доказывает текущую активность или доступность инструмента.',
  observation: 'Наблюдение загрузки — не сигнал активности, не разрешение хоста, не наличие инструмента во всех сессиях, не недавний отчёт и не выполнение задач. Байты компаньона входят в расширение; обновлениями управляет OpenChamber в настройках → Расширения. Режим доставки здесь неизвестен: отслеживаемый управляемый файл может перезагрузиться. При пользовательском OPENCODE_CONFIG добавление, удаление, включение или отключение плагина расширения требует явного перезапуска OpenCode. Обновление уже установленного расширения может подхватиться без перезапуска; проверьте наблюдение загрузки в настройке или диагностике отчётов. Само обновление расширения не доказывает загрузку новых байтов всеми работающими сессиями. Здесь ничего не перезапускается.',
  control: 'Управление записью', on: 'Сохранённое управление: включено', off: 'Сохранённое управление: выключено', controlUnknown: 'Сохранённое управление: неизвестно',
  controlEffect: 'Меняется управление записью проверенного хранилища, не статусы задач и не история. Это не отзывает независимые копии и не доказывает загрузку управляемого плагина сессией.',
  configRoot: 'Проверенная конфигурация OpenCode', dataRoot: 'Проверенные данные OpenCode', done: 'Получен ответ настройки. Проверьте управление записью и наблюдение загрузки отдельно.',
  failed: 'Запрос не завершился успешно. Изменения могут быть частичными; проверьте ту же цель перед повтором.',
  scope: 'Эта область OpenCode использует неподдерживаемое переопределение. Область работающей среды не будет угадана; проверьте её конфигурацию вне этого просмотра.',
  selection: 'Выбранное хранилище или источник конфликтует с проверенной привязкой. Сохраните выбор и проверьте ту же цель; ничего не будет перезаписано.',
  busy: 'Настройка уже выполняется или после прерывания сохранилась блокировка. Блокировки и файлы восстановления не удаляются автоматически.',
  stale: 'Проверенная настройка изменилась. Проверьте снова перед подтверждением.', path: 'Укажите абсолютный путь к приватному хранилищу или оставьте поле пустым для проверки стандартного пути.',
};
export const managedCopy = (locale = 'en') => resolveLanguage('auto',locale) === 'ru' ? ru : en;

export function managedErrorText(code:string, locale='en'): string | null {
  const text=managedCopy(locale);
  const errors: Record<string,string> = {
    'managed-action-required':text.unsupported,'managed-service-required':text.unsupported,
    'managed-binding-invalid':text.invalid,'managed-binding-modified':text.invalid,
    'managed-path-unverified':text.path,'managed-path-input':text.path,'managed-scope-unsupported':text.scope,
    'managed-review-stale':text.stale,'managed-selection-conflict':text.selection,'managed-source-conflict':text.selection,
    'managed-configuration-busy':text.busy,'managed-migration-required':text.switchEffect,
    'managed-migration-conflict':text.conflict,'managed-migration-pending':text.pending,
    'managed-migration-unavailable':text.unavailable,
    'legacy-update-requires-managed-migration':text.switchEffect,
  };
  return Object.hasOwn(errors,code)?errors[code]:null;
}
