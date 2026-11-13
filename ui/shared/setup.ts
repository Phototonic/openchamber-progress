// Setup UI (plan T4). Every change shows the resolved folders, the service privilege and the
// separate capture lifecycle first, then needs an explicit confirmation. Controls act on the
// configured folders only; a different folder set goes through inspect + install/update.
import { mountBanner, mountCheckbox, mountTextField } from '@openchamber/sdk/ui';
import type { SetupAction } from './adapter.ts';
import type { ViewContext } from './app.ts';
import { button, el, partState, testid } from './components.ts';
import type { CompanionUpdateView, SetupSuggestions, SetupTargets, SetupView } from './model.ts';
import { resolveLanguage } from './i18n.ts';

export type SetupPhase = 'unconfigured' | 'recovery' | 'reload-required' | 'removed' | 'disabled' | 'installed';

export function setupPhase(s: SetupView): SetupPhase {
  if (!s.configured) return 'unconfigured';
  if (s.recovery && (s.recovery.stagedPackages || s.recovery.stagedActivations || s.recovery.stagedReleases)) return 'recovery';
  if (s.activation === 'reload-required') return 'reload-required';
  if (!s.installed) return 'removed';
  if (s.captureEnabled === false) return 'disabled';
  return 'installed';
}

const ERROR_TEXT = {
  'missing-folders': 'Fill in all three folders as absolute paths.',
  'confirmation-required': 'Review the folders and confirm before anything changes.',
  'targets-unverified': 'These folders could not be verified. Use absolute paths to existing folders you own, without symbolic links.',
  'path-unverified': 'A folder path is not absolute, does not exist, or is not owned by you.',
  'symlink-escape': 'A folder path goes through a symbolic link, which setup refuses for safety.',
  collision: 'Something else already exists where the companion would be installed. Setup will not overwrite it.',
  'foreign-files': 'The install folder contains files setup did not create. Nothing was changed.',
  'modified-owned-files': 'Installed companion files were changed outside setup. They were left untouched.',
  'store-permissions': 'The progress store folder must be owned by you and private to your account.',
  'private-permissions': 'A folder used for progress must be owned by you and private to your account.',
  'windows-security-unavailable': 'Windows could not check folder ownership and privacy using its built-in PowerShell. Check that Windows PowerShell is available, then try again.',
  'not-installed': 'The companion is not installed in these folders.',
  'ownership-invalid': 'The installation does not match the folders this extension is set up for. Nothing was changed.',
  'payload-invalid': 'The companion packaged with this extension is incomplete. Reinstall the extension.',
  'installation-changed': 'The installation changed while updating. Check the folders again before retrying.',
  'service-binding-collision': 'This extension’s own setup record was changed outside setup. It was left untouched.',
  'service-binding-modified': 'This extension’s own setup record was changed outside setup. It was left untouched.',
  'service-binding-unavailable': 'The companion files were installed, but this extension could not record the setup.',
  'service-binding-unavailable-capture-disabled': 'The companion files were installed, but this extension could not record the setup, so capture was turned off to stay safe.',
  'action-invalid': 'That setup action is not available.',
  'arguments-invalid': 'The setup request was not accepted.',
  invalid: 'The setup request was not accepted. Check that all three folders are filled in.',
  'request-too-large': 'The setup request was too large.',
  'setup-unavailable': 'Setup is not available from this service.',
  storage: 'The progress store could not be opened.',
  busy: 'The progress store is busy. Try again in a moment.',
  corrupt: 'The progress store is damaged. It was left untouched.',
  schema: 'The progress store uses a newer format than this extension.',
  binding: 'This extension is not connected to a progress store yet.',
};
const ERROR_RU: typeof ERROR_TEXT = {
  'missing-folders': 'Укажите все три папки абсолютными путями.',
  'confirmation-required': 'Проверьте папки и подтвердите действие до внесения изменений.',
  'targets-unverified': 'Не удалось проверить эти папки. Укажите абсолютные пути к существующим папкам, которыми вы владеете, без символических ссылок.',
  'path-unverified': 'Путь папки не абсолютный, папка не существует или принадлежит другому пользователю.',
  'symlink-escape': 'Путь папки проходит через символическую ссылку. Настройка запрещает это для безопасности.',
  collision: 'В месте установки компаньона уже есть другие данные. Настройка не будет их перезаписывать.',
  'foreign-files': 'Папка установки содержит файлы, созданные не настройкой. Ничего не изменено.',
  'modified-owned-files': 'Установленные файлы компаньона изменены вне настройки. Они оставлены нетронутыми.',
  'store-permissions': 'Папка хранилища прогресса должна принадлежать вам и быть доступна только вашей учётной записи.',
  'private-permissions': 'Папка прогресса должна принадлежать вам и быть доступна только вашей учётной записи.',
  'windows-security-unavailable': 'Windows не удалось проверить владельца и приватность папки встроенным PowerShell. Проверьте доступность Windows PowerShell и повторите попытку.',
  'not-installed': 'Компаньон не установлен в этих папках.',
  'ownership-invalid': 'Установка не соответствует папкам, для которых настроено расширение. Ничего не изменено.',
  'payload-invalid': 'Компаньон в комплекте расширения неполон. Переустановите расширение.',
  'installation-changed': 'Установка изменилась во время обновления. Проверьте папки перед повторной попыткой.',
  'service-binding-collision': 'Запись настройки расширения изменена вне настройки. Она оставлена нетронутой.',
  'service-binding-modified': 'Запись настройки расширения изменена вне настройки. Она оставлена нетронутой.',
  'service-binding-unavailable': 'Файлы компаньона установлены, но расширению не удалось сохранить запись настройки.',
  'service-binding-unavailable-capture-disabled': 'Файлы компаньона установлены, но расширению не удалось сохранить запись настройки. Для безопасности запись прогресса выключена.',
  'action-invalid': 'Это действие настройки недоступно.',
  'arguments-invalid': 'Запрос настройки не принят.',
  invalid: 'Запрос настройки не принят. Проверьте, заполнены ли все три папки.',
  'request-too-large': 'Запрос настройки слишком велик.',
  'setup-unavailable': 'Настройка недоступна через этот сервис.',
  storage: 'Не удалось открыть хранилище прогресса.',
  busy: 'Хранилище прогресса занято. Повторите попытку чуть позже.',
  corrupt: 'Хранилище прогресса повреждено. Оно оставлено нетронутым.',
  schema: 'Хранилище прогресса использует более новый формат, чем это расширение.',
  binding: 'Расширение ещё не подключено к хранилищу прогресса.',
};

/** Plain-language text for a fixed SetupError code; unknown codes stay honest. */
const diagnosticCode = (code:string) => /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(code) ? code : 'unknown';
export const setupErrorText = (code: string, locale = 'en') => {
  const errors: Readonly<Record<string,string>> = resolveLanguage('auto',locale)==='ru'?ERROR_RU:ERROR_TEXT;
  return Object.hasOwn(errors,code) ? errors[code] : textFor(locale).unknownError(diagnosticCode(code));
};

const DIAGNOSTIC_TEXT = {
  'targets-unverified': 'These folders are not confirmed yet.',
  'rollback-payloads-retained': 'Earlier companion versions are kept for recovery.',
  'unreferenced-payloads-retained': 'Some unused companion versions are kept; nothing is deleted automatically.',
  'staged-payloads-present': 'An interrupted setup left staged files.',
  'service-binding-collision': 'This extension’s setup record could not be used.',
};
const DIAGNOSTIC_RU: typeof DIAGNOSTIC_TEXT = {
  'targets-unverified': 'Эти папки ещё не подтверждены.',
  'rollback-payloads-retained': 'Прежние версии компаньона сохранены для восстановления.',
  'unreferenced-payloads-retained': 'Некоторые неиспользуемые версии компаньона сохранены; автоматического удаления нет.',
  'staged-payloads-present': 'После прерванной настройки остались подготовленные файлы.',
  'service-binding-collision': 'Не удалось использовать запись настройки расширения.',
};
export const setupDiagnosticText = (code: string, locale = 'en') => {
  const diagnostics: Readonly<Record<string,string>> = resolveLanguage('auto',locale)==='ru'?DIAGNOSTIC_RU:DIAGNOSTIC_TEXT;
  const errors: Readonly<Record<string,string>> = resolveLanguage('auto',locale)==='ru'?ERROR_RU:ERROR_TEXT;
  return Object.hasOwn(diagnostics,code) ? diagnostics[code] : Object.hasOwn(errors,code) ? errors[code] : diagnosticCode(code);
};

export const PRIVILEGE_TEXT = 'The progress service runs on this computer with your full user access. The companion records progress only when an agent reports it; it never reads conversations.';
export const LIFECYCLE_TEXT = 'Capture is separate from this extension: it keeps running if you close, pause or uninstall the extension. Remove capture here before uninstalling this extension; uninstalling the extension alone leaves capture installed (the companion’s remove utility also works afterwards). Recorded history is always kept.';

const en = {
  privilege: PRIVILEGE_TEXT, lifecycle: LIFECYCLE_TEXT,
  unknownError: (code:string) => `Setup could not finish (${code}).`,
  configHelp: 'Absolute path to your OpenCode global config folder', dataHelp: 'Absolute path to your OpenCode data folder', storeHelp: 'A private folder outside your projects; created if missing',
  storeHint: 'Suggested inside the OpenCode data folder; created private if missing', resolvedHint: 'Found on this computer; not yet confirmed as your OpenCode folder', usualHint: 'Usual location on this computer; not found there or not confirmed',
  newerTitle: 'Installed companion is newer than this extension',
  newerBody: (installed:string,bundled:string) => `Installed ${installed} · bundled ${bundled}. Nothing changes on its own. Choosing the bundled version would go back to an older companion; updating this extension is usually the better fix.`,
  rebuildTitle: 'Different companion build available', rebuildBody: (version:string) => `This extension bundles a different build of version ${version}. Nothing changes until you review and confirm.`,
  upgradeTitle: 'Companion update available', upgradeBody: (installed:string,bundled:string) => `Installed ${installed} → bundled ${bundled}. Nothing changes until you review and confirm.`,
  review: 'Review', reviewUpdate: 'Review update', installedVersion: 'Installed version', bundledVersion: 'Bundled version',
  noComparison: 'The service has not compared the bundled companion with the installed one, so this review cannot say which version updating selects.',
  same: 'The bundled companion has the same files as the installed one, so updating changes nothing.',
  rebuild: 'Same version number, different files: updating selects the bundled files.',
  downgrade: 'The bundled companion is older than the installed one. Choosing it goes back to that version.',
  updateEffect: 'Updating keeps these folders, your plans and history, and switches only the companion files. Agents use the new files once OpenCode loads the companion again.',
  switchEffect: 'Switching keeps these folders, your plans and history, and changes only the companion files. Agents use them once OpenCode loads the companion again.',
  reload: 'OpenCode has not loaded the current companion files yet. Restart OpenCode when convenient so agents use them; sessions already running may keep earlier files until then. This view does not restart anything.',
  foldersNeeded: 'Folders needed', unchanged: 'Setup did not change anything', partial: 'Setup only partly finished', dismiss: 'Dismiss',
  done: 'Done.', disabled: 'Capture is off.', enabled: 'Capture is on.', removedNotice: 'Capture removed. History is kept.',
  reviewInstall: 'Review before installing', reviewOlder: 'Review before switching to the older companion', reviewUpdating: 'Review before updating',
  alreadyInstalled: 'A companion is already installed in these folders. Use update instead.',
  ackInstall: 'I reviewed these folders and want to install the companion', ackOlder: 'I reviewed these folders and want to switch to the older bundled companion', ackUpdate: 'I reviewed these folders and want to update the companion',
  install: 'Install', useBundled: 'Use bundled version', update: 'Update', cancel: 'Cancel', companion: 'Companion', data: 'OpenCode data', store: 'Progress store',
  setupStatus: 'setup status', folderSuggestions: 'folder suggestions',
  disableQuestion: 'Turn off capture?', enableQuestion: 'Turn capture back on?', removeQuestion: 'Remove capture?',
  disableEffect: 'Agents stop recording progress in every open OpenCode session using this setup. Existing plans and history stay.',
  enableEffect: 'Agents can record progress again. Nothing else changes.',
  removeEffect: 'Capture is turned off first, then the companion files are removed. Do this before uninstalling this extension; uninstalling the extension alone leaves capture installed. Plans, revisions and captured documents stay in the progress store. Changed files are left untouched.',
  disable: 'Turn off capture', enable: 'Turn on capture', remove: 'Remove capture',
  setupTitle: 'Set up agent progress', chooseFolders: 'Choose your OpenCode global config and data folders and a private folder for the progress store. Nothing is written until you review and confirm.',
  looking: 'Looking for your OpenCode folders on this computer…', notDetected: 'Your OpenCode folders could not be detected on this computer. Enter them below.',
  configFolder: 'OpenCode config folder', dataFolder: 'OpenCode data folder', storeFolder: 'Progress store folder', check: 'Check these folders',
  on: 'Capture is on', off: 'Capture is off', installed: 'Companion installed', removed: 'Capture removed', interrupted: 'Setup was interrupted',
  removedEffect: 'The companion files were removed and capture is off. Recorded plans and history are kept in the progress store.',
  recovery: (count:number) => `An interrupted setup left ${count} staged item(s). Nothing was cleaned up automatically. Run the same update again to finish it, or check the folders.`,
  unverified: 'These folders are not a verified OpenCode setup, so sessions cannot be linked across agents.',
  enableBack: 'Turn capture back on', updateCompanion: 'Update companion', reinstall: 'Install again',
  removedNote: 'Capture was removed, so no new progress is being recorded. Use Install again under Setup to record again.',
  disabledNote: 'Capture is off, so no new progress is being recorded. Turn it back on under Setup.',
  unknownNote: 'Capture is off, so no new progress is being recorded.',
  sameFiles: (version:string) => `${version} · same files as installed`, utility: 'Folder utility',
  utilityVersion: (version:string) => `${version} · loader and remove script from when the companion was installed; updates keep it`,
};
const ru: typeof en = {
  privilege: 'Сервис прогресса работает на этом компьютере с полными правами вашей учётной записи. Компаньон записывает прогресс только по явному отчёту агента; он никогда не читает переписку.',
  lifecycle: 'Запись работает отдельно от расширения: она продолжается, если закрыть, приостановить или удалить расширение. Удалите запись здесь до удаления расширения; удаление только расширения оставляет запись установленной (утилита удаления компаньона работает и после этого). Записанная история всегда сохраняется.',
  unknownError: (code) => `Не удалось завершить настройку (${code}).`,
  configHelp: 'Абсолютный путь к глобальной папке конфигурации OpenCode', dataHelp: 'Абсолютный путь к папке данных OpenCode', storeHelp: 'Приватная папка вне проектов; будет создана, если отсутствует',
  storeHint: 'Предложена внутри папки данных OpenCode; будет создана приватной, если отсутствует', resolvedHint: 'Найдена на этом компьютере; ещё не подтверждена как ваша папка OpenCode', usualHint: 'Обычное расположение на этом компьютере; папка не найдена или не подтверждена',
  newerTitle: 'Установленный компаньон новее, чем в этом расширении',
  newerBody: (installed,bundled) => `Установлен ${installed} · в комплекте ${bundled}. Ничего не меняется автоматически. Выбор комплектной версии вернёт более старый компаньон; обычно лучше обновить расширение.`,
  rebuildTitle: 'Доступна другая сборка компаньона', rebuildBody: (version) => `В расширении другая сборка версии ${version}. Ничего не изменится без проверки и подтверждения.`,
  upgradeTitle: 'Доступно обновление компаньона', upgradeBody: (installed,bundled) => `Установлен ${installed} → в комплекте ${bundled}. Ничего не изменится без проверки и подтверждения.`,
  review: 'Проверить', reviewUpdate: 'Проверить обновление', installedVersion: 'Установленная версия', bundledVersion: 'Версия в комплекте',
  noComparison: 'Сервис не сравнил комплектный и установленный компаньон, поэтому здесь нельзя определить, какую версию выберет обновление.',
  same: 'Файлы комплектного и установленного компаньона совпадают; обновление ничего не изменит.',
  rebuild: 'Номер версии совпадает, но файлы различаются: обновление выберет комплектные файлы.',
  downgrade: 'Комплектный компаньон старее установленного. Его выбор вернёт эту старую версию.',
  updateEffect: 'Обновление сохраняет папки, планы и историю; меняются только файлы компаньона. Агенты начнут использовать новые файлы после повторной загрузки компаньона в OpenCode.',
  switchEffect: 'Переключение сохраняет папки, планы и историю; меняются только файлы компаньона. Агенты начнут использовать их после повторной загрузки компаньона в OpenCode.',
  reload: 'OpenCode ещё не загрузил текущие файлы компаньона. Перезапустите OpenCode, когда удобно, чтобы агенты использовали их; работающие сессии до этого могут использовать прежние файлы. Этот интерфейс ничего не перезапускает.',
  foldersNeeded: 'Нужно указать папки', unchanged: 'Настройка ничего не изменила', partial: 'Настройка завершена лишь частично', dismiss: 'Скрыть',
  done: 'Готово.', disabled: 'Запись выключена.', enabled: 'Запись включена.', removedNotice: 'Запись удалена. История сохранена.',
  reviewInstall: 'Проверка перед установкой', reviewOlder: 'Проверка перед переходом на старый компаньон', reviewUpdating: 'Проверка перед обновлением',
  alreadyInstalled: 'В этих папках уже установлен компаньон. Используйте обновление.',
  ackInstall: 'Я проверил папки и хочу установить компаньон', ackOlder: 'Я проверил папки и хочу перейти на старый комплектный компаньон', ackUpdate: 'Я проверил папки и хочу обновить компаньон',
  install: 'Установить', useBundled: 'Использовать комплектную версию', update: 'Обновить', cancel: 'Отмена', companion: 'Компаньон', data: 'Данные OpenCode', store: 'Хранилище прогресса',
  setupStatus: 'состояние настройки', folderSuggestions: 'предлагаемые папки',
  disableQuestion: 'Выключить запись?', enableQuestion: 'Включить запись снова?', removeQuestion: 'Удалить запись?',
  disableEffect: 'Агенты перестанут записывать прогресс во всех открытых сессиях OpenCode с этой настройкой. Существующие планы и история сохранятся.',
  enableEffect: 'Агенты снова смогут записывать прогресс. Больше ничего не изменится.',
  removeEffect: 'Сначала запись выключается, затем удаляются файлы компаньона. Сделайте это до удаления расширения; удаление только расширения оставляет запись установленной. Планы, ревизии и сохранённые документы остаются в хранилище прогресса. Изменённые файлы остаются нетронутыми.',
  disable: 'Выключить запись', enable: 'Включить запись', remove: 'Удалить запись',
  setupTitle: 'Настроить прогресс агентов', chooseFolders: 'Выберите глобальные папки конфигурации и данных OpenCode и приватную папку хранилища прогресса. Ничего не будет записано без проверки и подтверждения.',
  looking: 'Поиск папок OpenCode на этом компьютере…', notDetected: 'Не удалось определить папки OpenCode на этом компьютере. Укажите их ниже.',
  configFolder: 'Папка конфигурации OpenCode', dataFolder: 'Папка данных OpenCode', storeFolder: 'Папка хранилища прогресса', check: 'Проверить эти папки',
  on: 'Запись включена', off: 'Запись выключена', installed: 'Компаньон установлен', removed: 'Запись удалена', interrupted: 'Настройка прервана',
  removedEffect: 'Файлы компаньона удалены, запись выключена. Записанные планы и история сохранены в хранилище прогресса.',
  recovery: (count) => `После прерванной настройки осталось подготовленных элементов: ${count}. Автоматической очистки не было. Повторите то же обновление для завершения или проверьте папки.`,
  unverified: 'Не подтверждено, что эти папки относятся к OpenCode, поэтому сессии разных агентов нельзя связать.',
  enableBack: 'Включить запись снова', updateCompanion: 'Обновить компаньон', reinstall: 'Установить снова',
  removedNote: 'Запись удалена, поэтому новый прогресс не записывается. Выберите «Установить снова» в настройке для возобновления записи.',
  disabledNote: 'Запись выключена, поэтому новый прогресс не записывается. Включите её в настройке.',
  unknownNote: 'Запись выключена, поэтому новый прогресс не записывается.',
  sameFiles: (version) => `${version} · файлы совпадают с установленными`, utility: 'Утилита папки',
  utilityVersion: (version) => `${version} · загрузчик и скрипт удаления со времени установки компаньона; обновления сохраняют их`,
};
const textFor = (locale:string) => resolveLanguage('auto',locale)==='ru'?ru:en;

const STORE_SUFFIX = 'openchamber-progress';
/** A form-level absolute-path check; the service owns canonicalization and safety checks. */
export const absoluteSetupPath = (value: string) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
/** The store folder suggested for a data folder: `<data>/openchamber-progress` (a folder of its own). */
export const deriveStore = (dataRoot: string) => {
  const d = dataRoot.trim();
  if (!d) return '';
  const windows = /^[A-Za-z]:[\\/]/.test(d);
  const separator = windows && d.includes('\\') ? '\\' : '/';
  return `${d.replace(windows ? /[\\/]+$/ : /\/+$/, '')}${separator}${STORE_SUFFIX}`;
};

/**
 * Prefill the unconfigured form. Precedence: configured targets (no form at all) > the user's own
 * edits, including a deliberate clear > suggestions. Only untouched fields change; an unknown (null)
 * hint never wipes an earlier prefill. The store follows the data folder only while the store is
 * untouched, so a store folder the user chose or cleared is never overwritten.
 */
export function applySuggestions(s: Pick<SetupUi, 'form' | 'edited'>, hints: SetupSuggestions | undefined) {
  if (!s.edited.configRoot && hints?.configRoot) s.form.configRoot = hints.configRoot.value;
  if (!s.edited.dataRoot && hints?.dataRoot) s.form.dataRoot = hints.dataRoot.value;
  if (!s.edited.storeRoot) {
    const fromHint = !s.edited.dataRoot && hints?.storeRoot ? hints.storeRoot.value : null;
    const derived = fromHint ?? deriveStore(s.form.dataRoot);
    if (derived || !s.form.storeRoot) s.form.storeRoot = derived;
  }
}

/** Plain-language provenance for a field's current value. Never claims a verified OpenCode setup. */
export function fieldHint(key: keyof SetupTargets, s: Pick<SetupUi, 'form' | 'edited'>, hints: SetupSuggestions | undefined, locale = 'en') {
  const text = textFor(locale);
  const plain = {configRoot:text.configHelp,dataRoot:text.dataHelp,storeRoot:text.storeHelp};
  if (s.edited[key] || !s.form[key]) return plain[key];
  if (key === 'storeRoot') return text.storeHint;
  const h = hints?.[key];
  if (h && h.value === s.form[key]) {
    return h.state === 'resolved'
      ? text.resolvedHint
      : text.usualHint;
  }
  return plain[key];
}

/** The service's latest bundled-companion comparison, with the installed version it describes. */
export interface BundledComparison { update: CompanionUpdateView; version: string }

/** The comparison in a setup read, or null when it makes none (absent, not ready, no version). */
export const bundledComparison = (s: SetupView | null | undefined): BundledComparison | null => (s?.update && s.version ? { update: s.update, version: s.version } : null);

export interface SetupUi {
  form: SetupTargets;
  /** Fields the user has typed in (a cleared field counts); prefill never touches these. */
  edited: Record<keyof SetupTargets, boolean>;
  /** Inspect reply and the exact folders it describes; confirmation applies to these only. */
  review: { action: 'install' | 'update'; targets: SetupTargets | null; result: SetupView } | null;
  confirm: Extract<SetupAction, 'disable' | 'enable' | 'remove-capture'> | null;
  ack: boolean;
  busy: boolean;
  error: string | null;
  notice: 'done' | 'disabled' | 'enabled' | 'removedNotice' | null;
  /** Where the last action started: the update notice in the reading order, or the setup surface. */
  from: 'notice' | 'setup';
}

type Confirm = NonNullable<SetupUi['confirm']>;
/** The status action that opened each confirmation (its focus returns there). */
const OPENER: Record<Confirm, string> = { disable: 'setup-disable', enable: 'setup-enable', 'remove-capture': 'setup-remove' };

export const initialSetupUi = (): SetupUi => ({ form: { configRoot: '', dataRoot: '', storeRoot: '' }, edited: { configRoot: false, dataRoot: false, storeRoot: false }, review: null, confirm: null, ack: false, busy: false, error: null, notice: null, from: 'setup' });

type Host<U> = ViewContext<U & { setup: SetupUi }>;

export type UpdateKind = 'upgrade' | 'rebuild' | 'downgrade';
export interface UpdateNotice { kind: UpdateKind; tone: 'info' | 'warning'; title: string; body: string; action: string }

/**
 * Plain-language notice when the bundled companion differs from the installed one. `current` and an
 * absent comparison show nothing: absence is no claim either way. A same-version rebuild is never
 * called newer, and a newer installed companion is a warning, never an upgrade prompt.
 */
export function updateNotice(s: SetupView | null | undefined, locale = 'en'): UpdateNotice | null {
  const text = textFor(locale);
  const u = s?.update;
  if (!s?.version || !u || u.state === 'current') return null;
  if (u.state === 'newer-installed') {
    return { kind: 'downgrade', tone: 'warning', title: text.newerTitle, body: text.newerBody(s.version,u.candidateVersion), action: text.review };
  }
  if (u.candidateVersion === s.version) {
    return { kind: 'rebuild', tone: 'info', title: text.rebuildTitle, body: text.rebuildBody(s.version), action: text.reviewUpdate };
  }
  return { kind: 'upgrade', tone: 'info', title: text.upgradeTitle, body: text.upgradeBody(s.version,u.candidateVersion), action: text.reviewUpdate };
}

/**
 * Version facts for a review: the installed version from the inspect reply and, for an update, the
 * bundled version from the frame's latest setup read (inspect replies carry no comparison). A
 * comparison for another installed version is out of date, and a missing one makes no claim, so a
 * refused action whose re-read drops the comparison also drops it from the open review.
 */
export function reviewVersions(review: NonNullable<SetupUi['review']>, snap: BundledComparison | null, locale = 'en'): { rows: [string, string][]; kind: UpdateKind | 'same' | null; note: string | null } {
  const text = textFor(locale);
  const installed = review.result.version;
  const rows: [string, string][] = installed ? [[text.installedVersion, installed]] : [];
  if (review.action !== 'update') return { rows, kind: null, note: null };
  if (!snap || !installed || snap.version !== installed) {
    return { rows, kind: null, note: text.noComparison };
  }
  rows.push([text.bundledVersion, snap.update.candidateVersion]);
  if (snap.update.state === 'current') return { rows, kind: 'same', note: text.same };
  const kind = updateNotice({ ...review.result, update: snap.update })!.kind;
  const note = kind === 'rebuild' ? text.rebuild
    : kind === 'downgrade' ? text.downgrade : null;
  return { rows, kind, note };
}

/** Shared setup state, actions and their bookkeeping for one place (`from`) in the frame. */
function controls<U>(vc: Host<U>, from: SetupUi['from']) {
  const set = (patch: Partial<SetupUi>) => vc.updateUi((u) => ({ setup: { ...u.setup, ...patch } }) as Partial<U & { setup: SetupUi }>);
  const run = async (action: SetupAction, targets: SetupTargets | null, confirmed: boolean, after: (r: SetupView) => Partial<SetupUi>) => {
    set({ busy: true, error: null, notice: null, from });
    const r = await vc.runSetup(action, targets, confirmed);
    if (r.ok) set({ busy: false, ...after(r.setup) });
    else set({ busy: false, error: r.code });
  };
  /** Update review over the configured folders. */
  const reviewUpdate = () => {
    void run('inspect', null, false, (res) => ({ review: { action: 'update', targets: null, result: res }, ack: false }));
  };
  return { set, run, reviewUpdate };
}

/** Setup feedback banners; `onDismiss` lets them be closed where no other control would clear them. */
function banners(parent: ParentNode, s: SetupUi, locale: string, onDismiss?: () => void) {
  const text = textFor(locale);
  if (s.error) {
    const slot = testid(el('div'), 'setup-error');
    slot.dataset.code = diagnosticCode(s.error);
    slot.setAttribute('role', 'alert');
    mountBanner(slot, { tone: 'error', title: s.error === 'missing-folders' ? text.foldersNeeded : text.unchanged, body: setupErrorText(s.error,locale), ...(onDismiss ? { action: { label: text.dismiss, onClick: onDismiss } } : {}) });
    if (s.error === 'service-binding-unavailable' || s.error === 'service-binding-unavailable-capture-disabled') (slot.querySelector('.oc-sdk-banner-title') as HTMLElement | null)?.replaceChildren(text.partial);
    parent.append(slot);
  }
  if (s.notice) {
    const slot = testid(el('div'), 'setup-notice');
    slot.setAttribute('role', 'status');
    mountBanner(slot, { tone: 'success', title: text[s.notice], ...(onDismiss ? { action: { label: text.dismiss, onClick: onDismiss } } : {}) });
    parent.append(slot);
  }
}

/** Review step: shown before any install/update confirmation. */
function reviewCard<U>(vc: Host<U>, c: ReturnType<typeof controls<U>>) {
  const locale = vc.env.locale;
  const text = textFor(locale);
  const s = vc.ui.setup;
  const r = s.review!;
  const versions = reviewVersions(r, bundledComparison(vc.setup?.state === 'ready' ? vc.setup.value : null),locale);
  const back = versions.kind === 'downgrade';
  const card = testid(el('div', 'ap-setup-card'), 'setup-review');
  card.dataset.action = r.action;
  if (versions.kind) card.dataset.kind = versions.kind;
  card.append(el('h3', 'ap-setup-title', r.action === 'install' ? text.reviewInstall : back ? text.reviewOlder : text.reviewUpdating));
  const t = r.result.targets!;
  card.append(facts([...targetRows(t,locale), ...versions.rows]));
  if (versions.note) card.append(testid(el('p', back ? 'ap-doc-warn' : 'ap-note', versions.note), 'setup-review-versions'));
  if (r.result.installed && r.action === 'install') card.append(el('p', 'ap-doc-warn', text.alreadyInstalled));
  if (r.action === 'update') card.append(el('p', 'ap-note', back ? text.switchEffect : text.updateEffect));
  for (const d of r.result.diagnostics.filter((x) => x !== 'targets-unverified')) card.append(el('p', 'ap-note', setupDiagnosticText(d,locale)));
  disclosure(card,locale);
  const ack = testid(el('div'), 'setup-ack');
  const label = r.action === 'install' ? text.ackInstall
    : back ? text.ackOlder : text.ackUpdate;
  mountCheckbox(ack, { label, checked: s.ack, onChange: (checked) => c.set({ ack: checked }) });
  card.append(ack);
  const row = el('div', 'ap-row');
  button(row, 'setup-confirm', r.action === 'install' ? text.install : back ? text.useBundled : text.update, () => {
    void c.run(r.action, r.targets, true, (res) => ({ review: null, ack: false, notice: res.activation === 'reload-required' ? null : 'done' }));
  }, 'default', !s.ack || s.busy || (r.action === 'install' && r.result.installed));
  button(row, 'setup-cancel', text.cancel, () => c.set({ review: null, ack: false, error: null }), 'ghost', s.busy);
  card.append(row);
  return card;
}

/** The update notice as a kit banner; `onReview` adds its action (the reading-order notice). */
function updateBanner(id: string, n: UpdateNotice, onReview?: () => void) {
  const slot = testid(el('div'), id);
  slot.dataset.kind = n.kind;
  mountBanner(slot, { tone: n.tone, title: n.title, body: n.body, ...(onReview ? { action: { label: n.action, onClick: onReview } } : {}) });
  slot.querySelector('.oc-sdk-banner-action button')?.setAttribute('data-testid', `${id}-review`);
  return slot;
}

function facts(rows: [string, string][]) {
  const dl = el('dl', 'ap-facts ap-setup-facts');
  for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', 'ap-mono', v));
  return dl;
}

const targetRows = (t: SetupTargets, locale:string): [string, string][] => [
  [textFor(locale).companion, `${t.configRoot}/plugins/agent-progress`],
  [textFor(locale).data, t.dataRoot],
  [textFor(locale).store, t.storeRoot],
];

function disclosure(parent: Element, locale:string) {
  const box = testid(el('div', 'ap-setup-disclose'), 'setup-disclosure');
  box.append(el('p', '', textFor(locale).privilege), el('p', '', textFor(locale).lifecycle));
  parent.append(box);
}

/** The setup surface. `compact` is used inside the rail. */
export function setupBlock<U>(vc: Host<U>, options: { compact?: boolean } = {}) {
  const locale = vc.env.locale;
  const text = textFor(locale);
  const wrap = testid(el('section', 'ap-setup'), 'setup-panel');
  const s = vc.ui.setup;
  const c = controls(vc, 'setup');
  const { set, run } = c;
  // Feedback and a review started from the update notice stay with the notice (reloadNote).
  const mine = s.from !== 'notice';
  const state = vc.setup;
  if (!state) vc.requestSetup();
  // The service already says it is not set up: the form is usable at once; folder hints from the
  // setup reply fill untouched fields when (or if) they arrive.
  const early = (!state || state.state !== 'ready') && vc.health?.ready === false;
  if ((!state || state.state !== 'ready') && !early) {
    wrap.append(partState('setup-loading', text.setupStatus, state, vc.requestSetup,locale));
    return wrap;
  }
  const info = state && state.state === 'ready' ? state.value : null;
  const phase: SetupPhase = info ? setupPhase(info) : 'unconfigured';
  wrap.dataset.phase = phase;

  if (mine) banners(wrap, s,locale);

  if (mine && s.review) {
    wrap.append(reviewCard(vc, c));
    return wrap;
  }

  // Control confirmation: restates the configured folders and consequences. Like the cleanup
  // confirmation, Cancel receives focus; Cancel, Escape and a confirmed result return focus once to
  // the opener, or to the setup status heading when the result replaced it (docs/ui.md Setup).
  if (s.confirm && info?.targets) {
    const c = s.confirm;
    const back = () => vc.handoff({ to: OPENER[c], heading: (root) => root.querySelector<HTMLElement>('[data-testid="setup-status-heading"]') });
    const cancel = () => { back(); set({ confirm: null }); };
    const card = testid(el('div', 'ap-setup-card'), `setup-confirm-${c}`);
    const title = { disable: text.disableQuestion, enable: text.enableQuestion, 'remove-capture': text.removeQuestion }[c];
    const body = {
      disable: text.disableEffect,
      enable: text.enableEffect,
      'remove-capture': text.removeEffect,
    }[c];
    card.append(el('h3', 'ap-setup-title', title), el('p', '', body), facts(targetRows(info.targets,locale)));
    const row = el('div', 'ap-row');
    button(row, 'setup-confirm', { disable: text.disable, enable: text.enable, 'remove-capture': text.remove }[c], () => {
      back();
      void run(c, null, true, () => ({ confirm: null, notice: ({ disable: 'disabled', enable: 'enabled', 'remove-capture': 'removedNotice' } as const)[c] }));
    }, c === 'enable' ? 'default' : 'destructive', s.busy);
    button(row, 'setup-cancel', text.cancel, cancel, 'ghost', s.busy);
    card.append(row);
    card.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !s.busy) { event.preventDefault(); cancel(); } });
    wrap.append(card);
    return wrap;
  }

  if (phase === 'unconfigured') {
    const hints = info?.suggestions;
    applySuggestions(s, hints);
    // The setup panel's heading in every phase (a focus target after Try again recovers into setup).
    const heading = testid(el('h3', 'ap-setup-title', text.setupTitle), 'setup-status-heading');
    heading.tabIndex = -1;
    wrap.append(heading);
    wrap.append(el('p', 'ap-note', text.chooseFolders));
    if (!info) {
      if (state?.state === 'error') wrap.append(partState('setup-loading', text.folderSuggestions, state, vc.requestSetup,locale));
      else wrap.append(testid(el('p', 'ap-note', text.looking), 'setup-hints-loading'));
    } else if (!hints || (!hints.configRoot && !hints.dataRoot)) {
      wrap.append(testid(el('p', 'ap-note', text.notDetected), 'setup-hints-unknown'));
    }
    for (const d of (info?.diagnostics ?? []).filter((x) => x !== 'targets-unverified')) wrap.append(el('p', 'ap-doc-warn', setupDiagnosticText(d,locale)));
    const form = testid(el('div', 'ap-setup-form'), 'setup-form');
    const fields = {} as Record<keyof SetupTargets, ReturnType<typeof mountTextField>>;
    const field = (key: keyof SetupTargets, label: string) => {
      const holder = testid(el('div'), `setup-${key}`);
      holder.dataset.hint = s.edited[key] || !s.form[key] ? 'none' : key === 'storeRoot' ? 'derived' : hints?.[key]?.value === s.form[key] ? hints[key]!.state : 'none';
      // Typing updates the form in place (no repaint, caret untouched). A typed or cleared field is the
      // user's from then on; the store keeps following the data folder only while it is untouched.
      fields[key] = mountTextField(holder, {
        label, value: s.form[key], mono: true, helper: fieldHint(key, s, hints,locale),
        onChange: (value) => {
          const setup = vc.ui.setup;
          setup.form[key] = value;
          setup.edited[key] = true;
          holder.dataset.hint = 'none';
          fields[key].update({ value, helper: fieldHint(key, setup, hints,vc.env.locale) });
          if (key === 'dataRoot' && !setup.edited.storeRoot) {
            setup.form.storeRoot = deriveStore(value);
            fields.storeRoot.update({ value: setup.form.storeRoot, helper: fieldHint('storeRoot', setup, hints,vc.env.locale) });
            const storeHolder = form.querySelector<HTMLElement>('[data-testid=setup-storeRoot]');
            if (storeHolder) storeHolder.dataset.hint = setup.form.storeRoot ? 'derived' : 'none';
          }
        },
      });
      const input = holder.querySelector('input');
      input?.setAttribute('data-keep', `setup-${key}`);
      input?.setAttribute('data-fixed', 'form'); // the form state is authoritative (a late prefill must land)
      input?.setAttribute('spellcheck', 'false');
      form.append(holder);
    };
    field('configRoot', text.configFolder);
    field('dataRoot', text.dataFolder);
    field('storeRoot', text.storeFolder);
    wrap.append(form);
    const row = el('div', 'ap-row');
    button(row, 'setup-inspect', text.check, () => {
      const f = vc.ui.setup.form;
      const targets = { configRoot: f.configRoot.trim(), dataRoot: f.dataRoot.trim(), storeRoot: f.storeRoot.trim() };
      if (!Object.values(targets).every(absoluteSetupPath)) { set({ error: 'missing-folders' }); return; }
      // Folders that already hold the companion (e.g. this extension was reinstalled and lost its
      // binding) are re-bound by updating; installing over them is refused.
      void run('inspect', targets, false, (res) => ({ review: { action: res.installed ? 'update' : 'install', targets, result: res }, ack: false }));
    }, 'default', s.busy);
    wrap.append(row);
    if (!options.compact) disclosure(wrap,locale);
    return wrap;
  }
  if (!info) return wrap; // not reached: every other phase comes from a setup reply

  const status = testid(el('div', 'ap-setup-card'), 'setup-status');
  const headline = {
    installed: text.on, disabled: text.off, 'reload-required': text.installed, removed: text.removed, recovery: text.interrupted, unconfigured: '',
  }[phase];
  const heading = testid(el('h3', 'ap-setup-title', headline), 'setup-status-heading');
  heading.tabIndex = -1; // focus target when a confirmed action replaced its opener, never a Tab stop
  status.append(heading);
  // The comparison is independent of the setup phase: an update can be available while a reload is
  // still pending, and the two notes stay distinct.
  const update = updateNotice(info,locale);
  if (update) status.append(updateBanner('setup-update-notice', update));
  if (phase === 'reload-required') status.append(testid(el('p', 'ap-doc-warn', text.reload), 'setup-reload'));
  if (phase === 'removed') status.append(el('p', 'ap-note', text.removedEffect));
  if (phase === 'recovery' && info.recovery) {
    status.append(testid(el('p', 'ap-doc-warn', text.recovery(info.recovery.stagedPackages + info.recovery.stagedActivations + info.recovery.stagedReleases)), 'setup-recovery'));
  }
  if (!info.verified) status.append(el('p', 'ap-doc-warn', text.unverified));
  if (info.targets) status.append(facts([...targetRows(info.targets,locale), ...versionRows(info,locale)]));
  for (const d of info.diagnostics) status.append(el('p', 'ap-note', setupDiagnosticText(d,locale)));
  const row = el('div', 'ap-row');
  const confirm = (kind: Confirm) => { vc.handoff({ to: 'setup-cancel' }); set({ confirm: kind, error: null, notice: null }); };
  if (info.installed && info.captureEnabled !== false) button(row, 'setup-disable', text.disable, () => confirm('disable'), 'outline', s.busy);
  if (info.installed && info.captureEnabled === false) button(row, 'setup-enable', text.enableBack, () => confirm('enable'), 'outline', s.busy);
  if (info.installed) {
    button(row, 'setup-update', update?.action ?? text.updateCompanion, c.reviewUpdate, update?.kind === 'upgrade' || update?.kind === 'rebuild' ? 'outline' : 'ghost', s.busy);
    button(row, 'setup-remove', text.remove, () => confirm('remove-capture'), 'ghost', s.busy);
  } else if (info.targets) {
    const targets = info.targets;
    button(row, 'setup-reinstall', text.reinstall, () => {
      void run('inspect', targets, false, (res) => ({ review: { action: 'install', targets, result: res }, ack: false }));
    }, 'outline', s.busy);
  }
  status.append(row);
  wrap.append(status);
  if (!options.compact) disclosure(wrap,locale);
  return wrap;
}

/**
 * The "capture is off" note, worded from the established setup phase only: a removed companion
 * points to Install again, a disabled one to turning capture back on. Anything not established
 * (setup still loading, unreadable, interrupted or awaiting reload) gets no instruction.
 */
export function captureOffNote(setup: ViewContext<unknown>['setup'], locale='en'): { reason: 'removed' | 'disabled' | 'unknown'; text: string } {
  const text = textFor(locale);
  const phase = setup?.state === 'ready' ? setupPhase(setup.value) : null;
  if (phase === 'removed') return { reason: 'removed', text: text.removedNote };
  if (phase === 'disabled') return { reason: 'disabled', text: text.disabledNote };
  return { reason: 'unknown', text: text.unknownNote };
}

/**
 * Version facts for the configured setup: the selected installed version, the bundled one when the
 * service compared them, and the folder's utility from the install when it differs.
 */
function versionRows(info: SetupView, locale:string): [string, string][] {
  const text = textFor(locale);
  const rows: [string, string][] = [];
  const u = info.update;
  if (info.version) rows.push([text.installedVersion, info.version]);
  if (u) rows.push([text.bundledVersion, u.state === 'current' ? text.sameFiles(u.candidateVersion) : u.candidateVersion]);
  if (u?.rootVersion && u.rootVersion !== info.version) rows.push([text.utility, text.utilityVersion(u.rootVersion)]);
  return rows;
}

/**
 * Setup notes in the progress reading order (rail and page, above the plan): the companion update
 * notice with its review, then the pending-reload note. They are independent: an update can be
 * available while a reload is pending. The update notice clears only when the service reports the
 * bundled files selected, the reload note only when it observes them loaded. File installation is
 * never presented as activation, and nothing here restarts anything.
 */
export function reloadNote<U>(vc: Host<U>) {
  const locale = vc.env.locale;
  const out = document.createDocumentFragment();
  const s = vc.ui.setup;
  const info = vc.setup?.state === 'ready' ? vc.setup.value : null;
  const c = controls(vc, 'notice');
  const reviewing = s.from === 'notice' && !!s.review;
  if (s.from === 'notice') banners(out, s,locale, reviewing ? undefined : () => c.set({ error: null, notice: null }));
  if (reviewing) {
    const wrap = testid(el('section', 'ap-setup'), 'update-review-panel');
    wrap.append(reviewCard(vc, c));
    out.append(wrap);
  } else {
    const n = updateNotice(info,locale);
    if (n) out.append(updateBanner('update-notice', n, () => { if (!vc.ui.setup.busy) c.reviewUpdate(); }));
  }
  if (info?.activation === 'reload-required') out.append(testid(el('p', 'ap-doc-warn', textFor(locale).reload), 'setup-reload'));
  return out.childNodes.length ? out : null;
}
