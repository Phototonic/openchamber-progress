// Managed Setup requires a supported delivery revision, inspected source/store and explicit consent.
// Legacy projection helpers below remain compatibility-only; the normal surface never installs,
// updates or removes a permanent global plugin.
import { mountBanner, mountCheckbox, mountTextField } from '@openchamber/sdk/ui';
import type { SetupAction } from './adapter.ts';
import type { ViewContext } from './app.ts';
import { button, el, partState, testid } from './components.ts';
import type { CompanionUpdateView, SetupSuggestions, SetupTargets, SetupView } from './model.ts';
import { resolveLanguage } from './i18n.ts';
import { managedCopy, managedErrorText, managedFamilyStepCopy, managedFreshCopy } from './managed-copy.ts';
import { MANAGED_MIGRATION_STEPS, type ManagedFreshStepProgress, type ManagedFreshStepRef, type ManagedSetupStepProgress, type ManagedSetupStepRequest } from '../../shared/managed-steps.ts';
import type { ManagedFreshReview } from '../../shared/progress.ts';
import { StepDriver, canAbandon, type SetupStepDriver, currentProgress, isFreshProgress, isFreshReview, managedStepCall, nextAction, progressFamily, type StepAction, type StepFamily, type StepStop } from './setup-steps.ts';
import { ensureSetupStyle } from './setup-style.ts';

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
  'path-unverified': 'Use an existing absolute folder path owned by your account, then review again.',
  'symlink-escape': 'Use a folder without symbolic links or junctions, then review again.',
  'unsafe-parent': 'A parent folder can be changed by another account. Use a protected location or ask your administrator to check its permissions.',
  EACCES: 'Access was denied. Check your account’s folder permissions, then review again.',
  EPERM: 'The system refused the file operation. Check folder permissions and security software, then review again.',
  EBUSY: 'A file is in use. Close programs using it, then review again.',
  EIO: 'The system could not read or write a file. Check the disk before retrying.',
  ENOSPC: 'The disk is full. Free space, then review again.',
  EEXIST: 'A setup file already exists. Check Setup status before retrying; do not delete recovery files blindly.',
  ENOENT: 'A required file disappeared. Check the installation, then review again.',
  ENOTDIR: 'A required folder is now a file. Check the installation before retrying.',
  EROFS: 'The disk is read-only. Restore write access, then review again.',
  EMFILE: 'Too many files are open. Close unused programs, then review again.',
  ENFILE: 'The system cannot open more files. Close unused programs, then review again.',
  collision: 'Something else already exists where the companion would be installed. Setup will not overwrite it.',
  'foreign-files': 'The install folder contains files setup did not create. Nothing was changed.',
  'modified-owned-files': 'Installed companion files were changed outside setup. They were left untouched.',
  'store-permissions': 'The progress store folder must be owned by you and private to your account.',
  'private-permissions': 'Check that the progress folder belongs to your account and is private, then review again. Setup will not change existing permissions.',
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
  'not-found': 'The requested setup record was not found. Check Setup status again.',
  conflict: 'The stored state changed. Check Setup status before retrying.',
  'operation-reused': 'This request belongs to an earlier action. Check Setup status before retrying.',
  assignment: 'This action is not allowed for the selected progress data.',
  'source-unverified': 'The OpenCode source could not be verified. Check the folders again.',
  closed: 'The selected progress record is closed. Check Setup status before retrying.',
  unfinished: 'An earlier action is unfinished. Check Setup status before continuing.',
  disabled: 'Capture is off. Review its current state before turning it on.',
  'stage-incomplete': 'The current step is incomplete. Check Setup status before continuing.',
  'staged-activation-retained': 'Recovery files remain from an earlier action. Review the installation before retrying; do not delete them blindly.',
};
const ERROR_RU: typeof ERROR_TEXT = {
  'missing-folders': 'Укажите все три папки абсолютными путями.',
  'confirmation-required': 'Проверьте папки и подтвердите действие до внесения изменений.',
  'targets-unverified': 'Не удалось проверить эти папки. Укажите абсолютные пути к существующим папкам, которыми вы владеете, без символических ссылок.',
  'path-unverified': 'Укажите абсолютный путь к существующей папке вашей учётной записи и проверьте снова.',
  'symlink-escape': 'Выберите папку без символических ссылок и точек соединения и проверьте снова.',
  'unsafe-parent': 'Родительскую папку может изменить другая учётная запись. Выберите защищённое место или попросите администратора проверить права.',
  EACCES: 'Доступ запрещён. Проверьте права своей учётной записи на папки и повторите проверку.',
  EPERM: 'Система запретила операцию с файлом. Проверьте права на папки и защитное ПО, затем повторите проверку.',
  EBUSY: 'Файл занят. Закройте использующие его программы и повторите проверку.',
  EIO: 'Не удалось прочитать или записать файл. Проверьте диск перед повторной попыткой.',
  ENOSPC: 'Диск заполнен. Освободите место и повторите проверку.',
  EEXIST: 'Файл настройки уже существует. Проверьте состояние настройки; не удаляйте файлы восстановления вслепую.',
  ENOENT: 'Нужный файл исчез. Проверьте установку и повторите проверку.',
  ENOTDIR: 'Вместо нужной папки обнаружен файл. Проверьте установку перед повторной попыткой.',
  EROFS: 'Диск доступен только для чтения. Восстановите доступ для записи и повторите проверку.',
  EMFILE: 'Открыто слишком много файлов. Закройте ненужные программы и повторите проверку.',
  ENFILE: 'Система не может открыть больше файлов. Закройте ненужные программы и повторите проверку.',
  collision: 'В месте установки компаньона уже есть другие данные. Настройка не будет их перезаписывать.',
  'foreign-files': 'Папка установки содержит файлы, созданные не настройкой. Ничего не изменено.',
  'modified-owned-files': 'Установленные файлы компаньона изменены вне настройки. Они оставлены нетронутыми.',
  'store-permissions': 'Папка хранилища прогресса должна принадлежать вам и быть доступна только вашей учётной записи.',
  'private-permissions': 'Проверьте, что папка прогресса принадлежит вашей учётной записи и приватна, затем повторите проверку. Настройка не меняет существующие права.',
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
  'not-found': 'Запись настройки не найдена. Проверьте состояние настройки снова.',
  conflict: 'Сохранённое состояние изменилось. Проверьте состояние настройки перед повтором.',
  'operation-reused': 'Этот запрос относится к предыдущему действию. Проверьте состояние настройки перед повтором.',
  assignment: 'Это действие недоступно для выбранных данных прогресса.',
  'source-unverified': 'Не удалось проверить источник OpenCode. Проверьте папки снова.',
  closed: 'Выбранная запись прогресса закрыта. Проверьте состояние настройки перед повтором.',
  unfinished: 'Предыдущее действие не завершено. Проверьте состояние настройки перед продолжением.',
  disabled: 'Запись выключена. Проверьте её состояние перед включением.',
  'stage-incomplete': 'Текущий шаг не завершён. Проверьте состояние настройки перед продолжением.',
  'staged-activation-retained': 'Остались файлы восстановления от предыдущего действия. Проверьте установку перед повтором; не удаляйте их вслепую.',
};
const ERROR_ZH: typeof ERROR_TEXT = {
  'unsafe-parent': '其他账户可以更改上级文件夹。请使用受保护的位置，或请管理员检查其权限。',
  EACCES: '访问被拒绝。请检查你的账户对文件夹的权限后重新审阅。',
  EPERM: '系统拒绝了文件操作。请检查文件夹权限和安全软件后重新审阅。',
  EBUSY: '文件正被占用。请关闭使用它的程序后重新审阅。',
  EIO: '系统无法读写文件。请先检查磁盘再重试。',
  ENOSPC: '磁盘已满。请释放空间后重新审阅。',
  EEXIST: '设置文件已存在。请先检查设置状态再重试，不要盲目删除恢复文件。',
  ENOENT: '所需文件已消失。请检查安装后重新审阅。',
  ENOTDIR: '所需文件夹已变为文件。请检查安装后再重试。',
  EROFS: '磁盘为只读。请恢复写入权限后重新审阅。',
  EMFILE: '打开的文件过多。请关闭不使用的程序后重新审阅。',
  ENFILE: '系统无法打开更多文件。请关闭不使用的程序后重新审阅。',
  'not-found': '未找到请求的设置记录。请重新检查设置状态。',
  conflict: '存储的状态已更改。请先检查设置状态再重试。',
  'operation-reused': '此请求属于先前的操作。请先检查设置状态再重试。',
  assignment: '所选进度数据不允许此操作。',
  'source-unverified': '无法验证 OpenCode 来源。请重新检查文件夹。',
  closed: '所选进度记录已关闭。请先检查设置状态再重试。',
  unfinished: '先前的操作尚未完成。请先检查设置状态再继续。',
  disabled: '采集已关闭。请先审阅当前状态再开启采集。',
  'stage-incomplete': '当前步骤尚未完成。请先检查设置状态再继续。',
  'staged-activation-retained': '先前操作的恢复文件仍保留。请先审阅安装再重试，不要盲目删除这些文件。',
  'missing-folders': '请将三个文件夹都填写为绝对路径。',
  'confirmation-required': '请先审阅这些文件夹并确认，之后才会进行更改。',
  'targets-unverified': '无法验证这些文件夹。请使用你拥有的现有文件夹的绝对路径，且不要包含符号链接。',
  'path-unverified': '文件夹路径不是绝对路径、不存在，或不属于你。',
  'symlink-escape': '文件夹路径经过符号链接，出于安全考虑，设置拒绝此路径。',
  collision: 'companion 的安装位置已存在其他内容，设置不会覆盖它。',
  'foreign-files': '安装文件夹中包含并非由设置创建的文件，未做任何更改。',
  'modified-owned-files': '已安装的 companion 文件在设置之外被修改，这些文件保持原样。',
  'store-permissions': '进度存储文件夹必须归你所有，且仅你的账户可访问。',
  'private-permissions': '用于进度的文件夹必须归你所有，且仅你的账户可访问。',
  'windows-security-unavailable': 'Windows 无法使用内置 PowerShell 检查文件夹的所有权和私有性。请确认 Windows PowerShell 可用后重试。',
  'not-installed': '这些文件夹中未安装 companion。',
  'ownership-invalid': '安装内容与此扩展所设置的文件夹不匹配，未做任何更改。',
  'payload-invalid': '此扩展附带的 companion 不完整，请重新安装扩展。',
  'installation-changed': '更新期间安装内容发生了变化，请在重试前重新检查文件夹。',
  'service-binding-collision': '此扩展自身的设置记录在设置之外被修改，该记录保持原样。',
  'service-binding-modified': '此扩展自身的设置记录在设置之外被修改，该记录保持原样。',
  'service-binding-unavailable': 'companion 文件已安装，但此扩展无法记录设置。',
  'service-binding-unavailable-capture-disabled': 'companion 文件已安装，但此扩展无法记录设置，因此已关闭采集以确保安全。',
  'action-invalid': '该设置操作不可用。',
  'arguments-invalid': '设置请求未被接受。',
  invalid: '设置请求未被接受。请检查三个文件夹是否都已填写。',
  'request-too-large': '设置请求过大。',
  'setup-unavailable': '此服务无法提供设置。',
  storage: '无法打开进度存储。',
  busy: '进度存储正忙，请稍后重试。',
  corrupt: '进度存储已损坏，已保持原样。',
  schema: '进度存储使用的格式比此扩展更新。',
  binding: '此扩展尚未连接到进度存储。',
};

/** Plain-language text for a fixed SetupError code; unknown codes stay honest. */
const diagnosticCode = (code:string) => /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(code) ? code : 'unknown';
export const setupErrorText = (code: string, locale = 'en', family: StepFamily = 'migration') => {
  const managed = managedErrorText(code,locale,family);
  if (managed) return managed;
  const l = resolveLanguage('auto',locale);
  const errors: Readonly<Record<string,string>> = l==='ru'?ERROR_RU:l==='zh-CN'?ERROR_ZH:ERROR_TEXT;
  return Object.hasOwn(errors,code) ? errors[code] : family==='fresh' ? managedFreshCopy(locale).unavailable : textFor(locale).unknownError(diagnosticCode(code));
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
const DIAGNOSTIC_ZH: typeof DIAGNOSTIC_TEXT = {
  'targets-unverified': '这些文件夹尚未确认。',
  'rollback-payloads-retained': '较早版本的 companion 已保留以便恢复。',
  'unreferenced-payloads-retained': '部分未使用的 companion 版本被保留，不会自动删除任何内容。',
  'staged-payloads-present': '中断的设置留下了暂存文件。',
  'service-binding-collision': '无法使用此扩展的设置记录。',
};
export const setupDiagnosticText = (code: string, locale = 'en', family: StepFamily = 'migration') => {
  const managed=managedErrorText(code,locale,family);
  if(managed)return managed;
  const l = resolveLanguage('auto',locale);
  const diagnostics: Readonly<Record<string,string>> = l==='ru'?DIAGNOSTIC_RU:l==='zh-CN'?DIAGNOSTIC_ZH:DIAGNOSTIC_TEXT;
  const errors: Readonly<Record<string,string>> = l==='ru'?ERROR_RU:l==='zh-CN'?ERROR_ZH:ERROR_TEXT;
  return Object.hasOwn(diagnostics,code) ? diagnostics[code] : Object.hasOwn(errors,code) ? errors[code] : family==='fresh' ? managedFreshCopy(locale).unavailable : managedCopy(locale).failed;
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
const zh: typeof en = {
  privilege: '进度服务在此计算机上运行，拥有你的完整用户权限。companion 仅在智能体报告时记录进度；它不会读取对话。',
  lifecycle: '采集独立于此扩展：关闭、暂停或卸载扩展后仍会运行。卸载扩展前请在此移除采集；仅卸载扩展会保留采集功能（之后也可使用 companion 的移除工具）。已记录的历史始终保留。',
  unknownError: (code) => `设置无法完成（${code}）。`,
  configHelp: 'OpenCode 全局配置文件夹的绝对路径', dataHelp: 'OpenCode 数据文件夹的绝对路径', storeHelp: '项目之外的私有文件夹；不存在时创建',
  storeHint: '建议放在 OpenCode 数据文件夹内；不存在时创建为私有文件夹', resolvedHint: '已在此计算机上找到；尚未确认是你的 OpenCode 文件夹', usualHint: '此计算机上的常见位置；未找到或尚未确认',
  newerTitle: '已安装的 companion 比此扩展附带的版本较新',
  newerBody: (installed,bundled) => `已安装 ${installed} · 附带 ${bundled}。不会自行更改。选择附带版本会退回较旧的 companion；通常更好的做法是更新此扩展。`,
  rebuildTitle: '有不同构建的 companion 可用', rebuildBody: (version) => `此扩展附带的是版本 ${version} 的另一种构建。在你审阅并确认之前不会更改。`,
  upgradeTitle: '有 companion 更新可用', upgradeBody: (installed,bundled) => `已安装 ${installed} → 附带 ${bundled}。在你审阅并确认之前不会更改。`,
  review: '审阅', reviewUpdate: '审阅更新', installedVersion: '已安装版本', bundledVersion: '附带版本',
  noComparison: '服务尚未比较附带和已安装的 companion，因此此次审阅无法确定更新会选择哪个版本。',
  same: '附带的 companion 与已安装文件相同，更新不会更改任何内容。',
  rebuild: '版本号相同，但文件不同：更新会选择附带的文件。',
  downgrade: '附带的 companion 比已安装版本旧。选择它会退回该版本。',
  updateEffect: '更新会保留这些文件夹、计划和历史，只切换 companion 文件。OpenCode 再次加载 companion 后智能体才会使用新文件。',
  switchEffect: '切换会保留这些文件夹、计划和历史，只更改 companion 文件。OpenCode 再次加载 companion 后智能体才会使用这些文件。',
  reload: 'OpenCode 尚未加载当前 companion 文件。方便时请重启 OpenCode，使智能体使用这些文件；已运行的会话在此之前可能继续使用旧文件。此视图不会重启任何内容。',
  foldersNeeded: '需要填写文件夹', unchanged: '设置未更改任何内容', partial: '设置仅部分完成', dismiss: '关闭',
  done: '已完成。', disabled: '采集已关闭。', enabled: '采集已开启。', removedNotice: '已移除采集，历史记录保留。',
  reviewInstall: '安装前审阅', reviewOlder: '切换到较旧 companion 前审阅', reviewUpdating: '更新前审阅',
  alreadyInstalled: '这些文件夹中已安装 companion，请改用更新。',
  ackInstall: '我已审阅这些文件夹，并希望安装 companion', ackOlder: '我已审阅这些文件夹，并希望切换到附带的较旧 companion', ackUpdate: '我已审阅这些文件夹，并希望更新 companion',
  install: '安装', useBundled: '使用附带版本', update: '更新', cancel: '取消', companion: 'Companion', data: 'OpenCode 数据', store: '进度存储',
  setupStatus: '设置状态', folderSuggestions: '文件夹建议',
  disableQuestion: '关闭采集？', enableQuestion: '重新开启采集？', removeQuestion: '移除采集？',
  disableEffect: '使用此设置的所有已打开 OpenCode 会话中的智能体将停止记录进度。现有计划和历史会保留。',
  enableEffect: '智能体可以再次记录进度。其他内容不变。',
  removeEffect: '先关闭采集，再移除 companion 文件。卸载此扩展前请执行此操作；仅卸载扩展会保留采集功能。计划、修订和已采集文档会保留在进度存储中。已修改的文件保持原样。',
  disable: '关闭采集', enable: '开启采集', remove: '移除采集',
  setupTitle: '设置智能体进度', chooseFolders: '请选择 OpenCode 全局配置及数据文件夹，以及用于进度存储的私有文件夹。审阅并确认前不会写入任何内容。',
  looking: '正在此计算机上查找 OpenCode 文件夹…', notDetected: '无法在此计算机上检测到 OpenCode 文件夹，请在下方输入。',
  configFolder: 'OpenCode 配置文件夹', dataFolder: 'OpenCode 数据文件夹', storeFolder: '进度存储文件夹', check: '检查这些文件夹',
  on: '采集已开启', off: '采集已关闭', installed: 'companion 已安装', removed: '采集已移除', interrupted: '设置已中断',
  removedEffect: 'companion 文件已移除，采集已关闭。已记录的计划和历史保留在进度存储中。',
  recovery: (count) => `中断的设置留下了 ${count} 个暂存项。未自动清理任何内容，请再次运行相同的更新以完成，或检查这些文件夹。`,
  unverified: '这些文件夹尚未验证为 OpenCode 配置，因此无法跨智能体关联会话。',
  enableBack: '重新开启采集', updateCompanion: '更新 companion', reinstall: '重新安装',
  removedNote: '采集已移除，因此不会记录新进度。请在设置中选择“重新安装”以再次记录。',
  disabledNote: '采集已关闭，因此不会记录新进度。请在设置中重新开启。',
  unknownNote: '采集已关闭，因此不会记录新进度。',
  sameFiles: (version) => `${version} · 文件与已安装版本相同`, utility: '文件夹工具',
  utilityVersion: (version) => `${version} · 安装 companion 时的加载器和移除脚本；更新会保留它们`,
};
const textFor = (locale:string) => {
  const l = resolveLanguage('auto',locale);
  return l==='ru'?ru:l==='zh-CN'?zh:en;
};

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
  actionFailure?: SetupView['lastAction'] | null;
  managedReview?: { action: Extract<SetupAction, `managed-${string}`>; result: SetupView; opener: string } | null;
  managedRequest?: number;
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
  if (s?.delivery) return null;
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
  return managedSetupBlock(vc, options);
}

/** Retained legacy rendering helpers are not a normal installation path. */
function legacySetupBlock<U>(vc: Host<U>, options: { compact?: boolean } = {}) {
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
  if (setup?.state === 'ready' && setup.value.delivery) return { reason: 'disabled', text: managedCopy(locale).off };
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
 * Managed Setup observations in the progress reading order. Delivery is not activation;
 * differing bytes warn only. Legacy recovery keeps its separate review/reload semantics below.
 */
export function reloadNote<U>(vc: Host<U>) {
  const locale = vc.env.locale;
  const info = vc.setup?.state === 'ready' ? vc.setup.value : null;
  if (!info?.delivery) return null;
  const d = info.delivery;
  const stepped = d.managedMigrationSteps === 1 || d.managedFreshSteps === 1 ? currentProgress(stepDriver?.state.progress ?? null, d.freshProgress ?? d.migrationProgress) : null;
  if ((stepped && stepped.state !== 'complete') || info.delivery.migration === 'available' || info.delivery.migration === 'pending' || info.delivery.migration === 'conflict' || info.delivery.migration === 'unavailable') return managedSetupBlock(vc,{compact:true});
  if (info.delivery.observation === 'different') {
    const warning = testid(el('div'), 'managed-integrity-warning');
    mountBanner(warning, {tone:'warning', title:managedCopy(locale).different, body:managedCopy(locale).warning+' '+managedCopy(locale).observation});
    return warning;
  }
  return null;
}

function legacyReloadNote<U>(vc: Host<U>) {
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

let managedRequestSerial = 0;
/** A past attempt is separate from current admission and migration diagnostics. */
export function lastMigrationText(action: NonNullable<SetupView['lastAction']>, locale='en') {
  const language = resolveLanguage('auto', locale);
  const label = { en: 'Last migration attempt failed', ru: 'Последняя попытка переноса не удалась', 'zh-CN': '上次切换尝试失败' }[language];
  return `${label}: ${action.stage} · ${action.code}. ${setupErrorText(action.code,locale)}`;
}
/** One inspect, then one explicit consent. No managed action is inferred from legacy booleans. */
function managedSetupBlock<U>(vc: Host<U>, _options: {compact?: boolean}) {
  const text = managedCopy(vc.env.locale);
  const s = vc.ui.setup;
  const wrap = testid(el('section','ap-setup'),'setup-panel');
  wrap.setAttribute('aria-busy',String(s.busy));
  const heading = testid(el('h3','ap-setup-title',text.title),'setup-status-heading');
  heading.tabIndex = -1;
  wrap.append(heading);
  const state = vc.setup;
  const lastAction=s.actionFailure===undefined?(state?.state==='ready'?state.value.lastAction:undefined):s.actionFailure;
  if(lastAction){
    const failure=testid(el('p','ap-doc-warn',lastMigrationText(lastAction,vc.env.locale)),'setup-last-action');
    failure.setAttribute('role','alert');wrap.append(failure);
  }
  if (!state) vc.requestSetup();
  if (!state || state.state !== 'ready') {
    // An unreadable status must not hide an unfinished switch or its capture warning.
    const known = stepDriver?.state.progress;
    if (known && known.state !== 'complete') wrap.append(migrationCard(vc, stepsFor(vc), known));
    wrap.append(partState('setup-loading',text.title,state,vc.requestSetup,vc.env.locale));
    return wrap;
  }
  const info = state.value;
  const d = info.delivery;
  if (!d) { wrap.dataset.phase='unsupported'; wrap.append(el('p','ap-note',text.unsupported)); return wrap; }
  wrap.dataset.phase = d.configuration;
  wrap.dataset.migration = d.migration;
  // Each step family only when the service advertises it. Migration steps keep older services on the
  // single-request switch; fresh setup has no single-request fallback at all (update-together guidance).
  const migrationSteps = d.managedMigrationSteps === 1, freshSteps = d.managedFreshSteps === 1;
  const driver = migrationSteps || freshSteps ? stepsFor(vc) : null;
  // A refused fresh observation overrides this frame's cached resumable journal.
  const freshRefused=d.planKind==='fresh'&&(d.migration==='unavailable'||d.migration==='conflict'||d.configuration==='invalid');
  const progress = driver && !freshRefused ? currentProgress(driver.state.progress, d.freshProgress ?? d.migrationProgress) : null;
  const unfinished = !!progress && progress.state !== 'complete';
  // A fresh operation reuses the coarse pending/complete status; it is never described as a legacy switch.
  const freshShown = isFreshProgress(progress) || !!d.freshProgress || d.planKind==='fresh'&&d.migration!=='none';
  const family:StepFamily=freshShown || driver?.state.family==='fresh'&&(!!driver.state.busy||!!driver.state.outcome)?'fresh':'migration';
  const freshText=managedFreshCopy(vc.env.locale);
  if (driver) { wrap.dataset.steps = '1'; if (driver.state.busy) wrap.setAttribute('aria-busy','true'); }
  if (freshSteps) wrap.dataset.freshSteps = '1';
  const set = (patch: Partial<SetupUi>) => vc.updateUi(u => ({setup:{...u.setup,...patch}}) as Partial<U & {setup:SetupUi}>);
  const back = (opener:string) => vc.handoff({to:opener,heading:root=>root.querySelector<HTMLElement>('[data-testid="setup-status-heading"]')});
  const ownsFocus = (id:string) => document.hasFocus() && !!document.activeElement?.closest(`[data-testid="${id}"]`);
  const run = async (action: Extract<SetupAction, `managed-${string}`>, opener:string, review?: SetupView) => {
    if (migrationSteps && action === 'managed-migrate') return; // negotiated step flow: no old-route fallback
    if (action === 'managed-configure') return; // fresh setup runs only through negotiated steps
    const captureControl = !!driver && (action === 'managed-enable' || action === 'managed-disable');
    if (captureControl && !review) {
      // Keep the existing acknowledgement/copy, but no legacy inspect nonce:
      // the fenced bodyless route freshly validates the selected binding.
      if (!s.busy && info.targets) { set({managedReview:{action,result:info,opener},ack:false,error:null,notice:null}); if (ownsFocus(opener)) vc.handoff({to:'setup-cancel'}); }
      return;
    }
    const request = ++managedRequestSerial;
    const reviewed = review?.delivery?.review;
    // Inspection follows the user's current input; mutations use only the inspected canonical store.
    const store = reviewed?.targets.storeRoot ?? (d.configuration === 'configured' ? info.targets?.storeRoot : s.form.storeRoot.trim());
    if (store && !absoluteSetupPath(store)) { set({error:'managed-path-input'}); return; }
    const targets = store ? {configRoot:'',dataRoot:'',storeRoot:store} : null;
    let admitted=false;
    vc.updateUi(u=>{
      if (u.setup.busy || (review && (!u.setup.ack || (captureControl ? u.setup.managedReview?.result !== review : !reviewed || u.setup.managedReview?.result.delivery?.review?.expected !== reviewed.expected)))) return {};
      admitted=true;
      return {setup:{...u.setup,busy:true,error:null,notice:null,managedRequest:request}} as Partial<U & {setup:SetupUi}>;
    });
    if (!admitted) return;
    const result = await vc.runSetup(review ? action : 'managed-inspect',targets,!!review,reviewed?.expected);
    if (!result.ok && result.code === 'context-changed') {
      vc.updateUi(u => u.setup.managedRequest === request ? {setup:{...u.setup,busy:false,managedReview:null,ack:false}} as Partial<U & {setup:SetupUi}> : {});
      return;
    }
    vc.updateUi(u => {
      if (u.setup.managedRequest !== request) return {};
      const patch: Partial<SetupUi> = {busy:false,...(result.ok?{actionFailure:null}:result.lastAction?{actionFailure:result.lastAction}:{})};
      if (result.ok && !review) {
        const inspected = result.setup.delivery;
        if (inspected?.review && inspected.configuration !== 'invalid' && (action === 'managed-disable' || inspected.migration !== 'conflict' && inspected.migration !== 'unavailable')) {
          const next = action !== 'managed-disable' && (inspected.migration === 'available' || inspected.migration === 'pending') ? 'managed-migrate' : action;
          if (next === 'managed-migrate' && (migrationSteps || inspected.managedMigrationSteps === 1)) {
            // A step-capable service never receives the single-request switch: review it step by step.
            if (ownsFocus(opener)) vc.handoff({to:'setup-cancel'});
            queueMicrotask(() => { if (stepDriver && !stepDriver.state.busy) void stepDriver.inspect('begin', store ? {storeRoot:store} : {}); });
          } else {
            patch.managedReview = {action:next,result:result.setup,opener}; patch.ack=false;
            if (ownsFocus(opener)) vc.handoff({to:'setup-cancel'});
          }
        } else patch.error=inspected?.migration === 'conflict' ? 'managed-migration-conflict' : inspected?.migration === 'unavailable' ? 'managed-migration-unavailable' : 'managed-review-stale';
      } else {
        patch.managedReview=null; patch.ack=false;
        if (result.ok) patch.notice='done'; else patch.error=result.code;
        if (ownsFocus(review ? 'setup-confirm' : opener)) back(opener);
        // An uncertain response is never an automatic retry. Re-read actual partial/control state.
        if (!result.ok) vc.requestSetup();
      }
      return {setup:{...u.setup,...patch}} as Partial<U & {setup:SetupUi}>;
    });
  };
  if (s.error) {
    const message = managedErrorText(s.error,vc.env.locale,family) ?? `${text.failed} ${setupErrorText(s.error,vc.env.locale,family)}`;
    const alert = testid(el('p','ap-doc-warn',message),'setup-error'); alert.setAttribute('role','alert'); alert.dataset.code=diagnosticCode(s.error); wrap.append(alert);
  }
  if (s.notice) { const notice=testid(el('p','ap-note',text.done),'setup-notice'); notice.setAttribute('role','status'); wrap.append(notice); }
  if (driver && !freshRefused) {
    const review = stepReviewCard(vc, driver);
    if (review) { wrap.append(review); return wrap; }
    if (progress) wrap.append(migrationCard(vc, driver, progress));
    else if (driver.state.busy === 'run' || driver.state.busy === 'control') wrap.append(startingCard(vc, driver));
    else stepOutcome(wrap, driver, null, vc.env.locale);
    if (driver.state.busy === 'inspect') wrap.append(inspectingLine(vc, driver));
  }
  const r = s.managedReview;
  const captureReview = !!driver && (r?.action === 'managed-enable' || r?.action === 'managed-disable');
  const reviewed = r?.result.delivery?.review ?? (captureReview && r?.result.targets ? {targets:r.result.targets} : null);
  if (r && reviewed) {
    const card = testid(el('div','ap-setup-card'),'setup-review'); card.dataset.action=r.action;
    const migration = r.action === 'managed-migrate';
    card.append(el('h3','ap-setup-title', migration ? text.migrate : r.action === 'managed-enable' ? text.enable : r.action === 'managed-disable' ? text.disable : text.configure));
    card.append(facts([[text.configRoot,reviewed.targets.configRoot],[text.dataRoot,reviewed.targets.dataRoot],[text.store,reviewed.targets.storeRoot]]));
    for (const body of [text.privilege,text.lifecycle,text.reach,migration ? text.switchEffect : r.action === 'managed-configure' ? text.choose : text.controlEffect]) card.append(el('p','ap-note',body));
    if (r.result.delivery?.migration === 'pending') card.append(el('p','ap-doc-warn',text.pending));
    const ack=testid(el('div'),'setup-ack');
    mountCheckbox(ack,{label:text.ack,checked:s.ack,onChange:checked=>{if(!s.busy)set({ack:checked});}}); card.append(ack);
    const row=el('div','ap-row');
    button(row,'setup-confirm',text.confirm,()=>{if(!vc.ui.setup.busy&&vc.ui.setup.ack)void run(r.action,r.opener,r.result);},'default',!s.ack);
    row.querySelector('button')?.setAttribute('aria-disabled',String(s.busy||!s.ack));
    const cancel=()=>{if(s.busy)return;back(r.opener);set({managedReview:null,ack:false,error:null});};
    button(row,'setup-cancel',text.cancel,cancel,'ghost',s.busy);card.append(row);
    card.addEventListener('keydown',event=>{if(event.key==='Escape'&&!s.busy){event.preventDefault();cancel();}});
    wrap.append(card);return wrap;
  }
  wrap.append(el('p','ap-note',d.configuration === 'invalid' ? freshShown ? freshText.invalid : text.invalid : d.configuration === 'configured' ? text.configured : text.unconfigured));
  if (d.configuration === 'configured' && !info.verified) wrap.append(el('p','ap-doc-warn',textFor(vc.env.locale).unverified));
  if (d.migration === 'pending' && !unfinished && !freshShown) wrap.append(testid(el('p','ap-doc-warn',text.pending),'setup-recovery'));
  if (d.migration === 'pending' && !unfinished && freshShown) wrap.append(testid(el('p','ap-doc-warn',managedErrorText('managed-migration-required',vc.env.locale,'fresh')!),'setup-recovery'));
  if (d.migration === 'conflict') wrap.append(el('p','ap-doc-warn',freshShown ? freshText.conflict : text.conflict));
  if (d.migration === 'unavailable') wrap.append(testid(el('p','ap-doc-warn',freshShown ? freshText.unavailable : text.unavailable),'setup-migration-unavailable'));
  if (d.migration === 'complete') wrap.append(el('p','ap-note',freshShown ? managedFreshCopy(vc.env.locale).complete : text.complete));
  const unresolved = d.migration === 'available' || d.migration === 'pending' || d.migration === 'conflict' || d.migration === 'unavailable';
  const observation = {unknown:text.unknown,'not-observed':text.missing,matching:text.matching,different:text.different}[unresolved ? 'unknown' : d.observation];
  wrap.append(testid(el('p','ap-note',observation),'managed-load-observation'),el('p','ap-note',text.observation));
  if (!unresolved && d.observation === 'different') {
    const warning=testid(el('div'),'managed-integrity-warning'); mountBanner(warning,{tone:'warning',title:text.different,body:text.warning});wrap.append(warning);
  }
  // While a switch is unfinished its card carries the actual capture observation; an older stored
  // reading here could contradict it mid-run.
  if (!unfinished) wrap.append(testid(el('p','ap-note',info.captureEnabled === true ? text.on : info.captureEnabled === false ? text.off : text.controlUnknown),'managed-capture-control'));
  for (const diagnostic of info.diagnostics) wrap.append(el('p','ap-note',setupDiagnosticText(diagnostic,vc.env.locale,family)));
  // The store choice belongs to a fresh review that can actually run: not while one is unfinished or
  // when the service cannot negotiate fresh steps.
  if (d.configuration === 'unconfigured' && freshSteps && !unfinished && !freshShown && d.migration === 'none') {
    wrap.append(el('p','ap-note',text.choose));
    if (!s.edited.storeRoot && info.suggestions?.storeRoot) s.form.storeRoot=info.suggestions.storeRoot.value;
    const holder=testid(el('div'),'setup-storeRoot');
    mountTextField(holder,{label:text.store,value:s.form.storeRoot,helper:text.helper,mono:true,onChange:value=>{s.form.storeRoot=value;s.edited.storeRoot=true;}});
    const input=holder.querySelector('input');input?.setAttribute('data-keep','setup-storeRoot');input?.setAttribute('data-fixed','form');input?.setAttribute('spellcheck','false');wrap.append(holder);
  }
  const row=el('div','ap-row');
  const action=(id:string,label:string,kind:Extract<SetupAction, `managed-${string}`>)=>{button(row,id,label,()=>{if(!vc.ui.setup.busy)void run(kind,id);},'outline');row.lastElementChild?.querySelector('button')?.setAttribute('aria-disabled',String(s.busy));};
  if (d.configuration === 'configured' && info.verified && info.captureEnabled === true) action('setup-disable',text.disable,'managed-disable');
  if (d.configuration !== 'invalid' && d.migration !== 'conflict' && d.migration !== 'unavailable') {
    const legacy = !freshShown && (d.migration === 'available' || d.migration === 'pending');
    if (migrationSteps && driver && legacy) {
      if (!unfinished) {
        button(row,'setup-migrate',d.migration==='pending'?text.resume:text.migrate,()=>{
          const st = vc.ui.setup;
          if (driver.state.busy || st.busy) return;
          const store = d.configuration === 'configured' ? info.targets?.storeRoot : st.form.storeRoot.trim();
          if (store && !absoluteSetupPath(store)) { set({error:'managed-path-input'}); return; }
          if (st.error) set({error:null});
          void driver.inspect('begin', store ? {storeRoot:store} : {});
        },'outline');
        row.lastElementChild?.querySelector('button')?.setAttribute('aria-disabled',String(s.busy || !!driver.state.busy));
      }
    } else if (legacy) action('setup-migrate',d.migration==='pending'?text.resume:text.migrate,'managed-migrate');
    else if (d.configuration === 'unconfigured') {
      if (freshSteps && driver) {
        if (!unfinished && !freshShown) {
          button(row,'setup-inspect',text.review,()=>{
            const st = vc.ui.setup;
            if (driver.state.busy || st.busy) return;
            const store = st.form.storeRoot.trim();
            if (store && !absoluteSetupPath(store)) { set({error:'managed-path-input'}); return; }
            if (st.error) set({error:null});
            void driver.inspect('begin', {family:'fresh', ...(store ? {storeRoot:store} : {})});
          },'outline');
          row.lastElementChild?.querySelector('button')?.setAttribute('aria-disabled',String(s.busy || !!driver.state.busy));
        }
      } else if (d.migration === 'none') wrap.append(testid(el('p','ap-doc-warn',managedFreshCopy(vc.env.locale).unsupported),'setup-fresh-unsupported'));
    }
    else if (info.captureEnabled === false && !unfinished && (!freshShown || progress?.state==='complete')) action('setup-enable',text.enable,'managed-enable');
  }
  if (d.migration === 'unavailable') button(row,'setup-retry',text.retry,vc.requestSetup,'outline',s.busy);
  wrap.append(row);
  const disclosure=testid(el('div','ap-setup-disclose'),'setup-disclosure');
  for (const body of [text.privilege,text.lifecycle,text.reach]) disclosure.append(el('p','ap-note',body));
  wrap.append(disclosure);return wrap;
}

// ---- Step-by-step switch (shared/managed-steps.ts, setup/managed-steps.md) ----

let stepView: Host<unknown> | null = null;
let stepDriver: SetupStepDriver | null = null;
/** Called on visibility loss/disposal even when no hidden-frame paint occurs. */
export function retireSetupSteps() { stepDriver?.retire(); }
/** Alert keys already announced in this frame, so a full repaint does not repeat them. */
const announced = new Set<string>();
/** Host account, surface, session and directory; null while hidden. A change retires the driver. */
const stepContext = (vc: Host<unknown>) => document.visibilityState === 'hidden' ? null
  : JSON.stringify([vc.ctx?.connection?.account ?? '', vc.ctx?.surface ?? '', vc.session?.id ?? null, vc.directory ?? null]);
const ACTION_HOOK: Record<NonNullable<StepAction>, string> = { continue: 'setup-migration-continue', resume: 'setup-migration-resume', review: 'setup-migration-review-capture', status: 'setup-migration-status' };
const migrationHeading = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid="setup-migration-heading"]') ?? root.querySelector<HTMLElement>('[data-testid="setup-status-heading"]');

function readProgress(vc: Host<unknown>) {
  const info = vc.setup?.state === 'ready' ? vc.setup.value : null;
  return currentProgress(stepDriver?.state.progress ?? null, info?.delivery?.freshProgress ?? info?.delivery?.migrationProgress);
}
/** Where focus goes when a settled run removes the control it was on (docs/ui.md Restoration). */
/** The control that starts a journey of this family (a fresh review starts from Review configuration). */
const OPENER_HOOK: Record<StepFamily, string> = { migration: 'setup-migrate', fresh: 'setup-inspect' };
function stepHandoff(vc: Host<unknown>, stop: StepStop) {
  const st = stepDriver!.state;
  if (stop.reason === 'held') return;
  const opener = OPENER_HOOK[st.family];
  if (stop.reason === 'review') { vc.handoff({ to: st.review ? 'setup-cancel' : opener, heading: migrationHeading }); return; }
  const next = nextAction(readProgress(vc));
  vc.handoff({ to: st.outcome?.uncertain ? ACTION_HOOK.status : next ? ACTION_HOOK[next] : opener, heading: migrationHeading });
}
function stepsFor<U>(vc: Host<U>): SetupStepDriver {
  ensureSetupStyle();
  stepView = vc as unknown as Host<unknown>;
  stepDriver ??= new StepDriver<ManagedSetupStepRequest>({
    send: (request, current) => managedStepCall(stepView!.service(current), request),
    context: () => (stepView ? stepContext(stepView) : null),
    changed: (stop) => {
      const v = stepView;
      if (!v) return;
      if (stop) stepHandoff(v, stop);
      v.updateUi((u) => ({ setup: { ...u.setup } }));
    },
    refresh: (complete) => { stepView?.requestSetup(); if (complete) stepView?.retry(); },
  });
  stepDriver.observe(stepContext(stepView), vc.ctx?.connection?.account ?? '');
  return stepDriver;
}

const stageLabel = (stage: string, locale: string, family: StepFamily = 'migration') => managedFamilyStepCopy(family, locale).stages[stage] ?? stage;
const partOf = (ref: { name: string; batch: number }) => (ref.name === 'remove-selector' || ref.name === 'remove-discovery') ? ref.batch + 1 : null;
/** "Step 3 of 9: …" over the fixed migration stage list, or over a fresh operation's own frozen plan;
 * removal batches add a part number, never a guessed total. */
export function migrationStepText(p: ManagedSetupStepProgress, locale = 'en') {
  const t = managedFamilyStepCopy(progressFamily(p), locale);
  if (!p.step) return t.status.complete;
  if (isFreshProgress(p)) return t.step(p.plan.findIndex(s => s.name === p.step!.name) + 1, p.plan.length, stageLabel(p.step.name, locale, 'fresh'), null);
  return t.step(MANAGED_MIGRATION_STEPS.indexOf(p.step.name) + 1, MANAGED_MIGRATION_STEPS.length, stageLabel(p.step.name, locale), partOf(p.step));
}
export type MigrationTitle = keyof ReturnType<typeof managedFamilyStepCopy>['titles'];
/** Distinct running, pending, paused, stopped, failed, interrupted and review presentations. */
export function migrationTitle(p: ManagedSetupStepProgress, driving: boolean): MigrationTitle {
  if (driving) return 'running';
  if (p.state === 'complete') return 'complete';
  if (p.recovery === 'review') return 'review';
  if (p.state === 'running') return p.worker === 'active' ? 'active' : 'interrupted';
  return p.state;
}

/** Fixed stage/code plus actionable text for the last stop that still describes this progress. */
function stepOutcome(parent: Element, driver: SetupStepDriver, p: ManagedSetupStepProgress | null, locale: string) {
  const family = p ? progressFamily(p) : driver.state.family;
  const t = managedFamilyStepCopy(family, locale);
  const o = driver.state.outcome;
  const local = driver.state.progress;
  // A newer durable status read (higher sequence) supersedes this frame's last outcome.
  const fresh = o && (!p || !local || p.operationId !== local.operationId || p.sequence <= local.sequence);
  const diagnostic = fresh ? o : p?.diagnostic ? { ...p.diagnostic, uncertain: false } : null;
  if (!diagnostic) return null;
  const box = testid(el('div', 'ap-doc-warn ap-migration-failure'), 'setup-migration-failure');
  box.dataset.code = diagnosticCode(diagnostic.code);
  if (diagnostic.stage) box.dataset.stage = diagnostic.stage;
  const key = `failure:${p?.operationId ?? ''}:${p?.sequence ?? ''}:${diagnostic.stage ?? ''}:${diagnostic.code}`;
  if (!announced.has(key)) { box.setAttribute('role', 'alert'); announced.add(key); }
  const where = el('p', 'ap-migration-where', `${diagnostic.stage ? t.stoppedAt(stageLabel(diagnostic.stage, locale, family)) : t.stopped}`);
  if(family!=='fresh')where.append(' · ',el('code', 'ap-migration-code', diagnostic.code));
  box.append(where);
  // An unsettled capture step that needs a fresh decision points to that review, not to waiting.
  box.append(el('p', '', p?.recovery === 'review' && diagnostic.code === 'managed-step-unsettled' ? t.reviewNeeded : setupErrorText(diagnostic.code, locale, family)));
  // In every create plan, a checkpoint after prepare proves a folder or database
  // was created. A stage/error (or a family hint) alone proves no such resource.
  if (isFreshProgress(p) && p.state !== 'complete' && p.storeMode === 'create' && p.lastCompleted && p.lastCompleted.name !== 'prepare') {
    box.append(testid(el('p', '', managedFreshCopy(locale).partial), 'setup-fresh-partial'));
  }
  parent.append(box);
  return diagnostic;
}

function inspectingLine<U>(vc: Host<U>, driver: SetupStepDriver) {
  const family = driver.state.family;
  const t = managedFamilyStepCopy(family, vc.env.locale);
  const row = testid(el('div', 'ap-row'), 'setup-migration-inspecting');
  const line = el('p', 'ap-note', t.checking(driver.state.inspecting ? stageLabel(driver.state.inspecting, vc.env.locale, family) : null));
  line.setAttribute('role', 'status');
  row.append(line);
  button(row, 'setup-migration-cancel-inspect', t.cancel, () => { vc.handoff({ to: OPENER_HOOK[family] }); driver.cancelReview(); }, 'ghost');
  return row;
}

/** Guarded button: stays focusable while unavailable (aria-disabled) and never submits twice. */
function stepButton(row: Element, id: string, label: string, run: () => void, variant: Parameters<typeof button>[4], disabled: boolean) {
  button(row, id, label, () => { if (!disabled) run(); }, variant);
  row.lastElementChild?.querySelector('button')?.setAttribute('aria-disabled', String(disabled));
}

/** Capture warning wording: migration says "finish the switch"; fresh says whether a new store starts
 * off or a retained store keeps its own setting. */
function captureWarning(p: ManagedSetupStepProgress, locale: string) {
  const state = p.capture.state === 'off' ? 'off' : 'unknown';
  if (isFreshProgress(p)) return managedFreshCopy(locale).warn[p.storeMode][state];
  const t = managedFamilyStepCopy('migration', locale);
  return state === 'off' ? { title: t.warnOff, body: t.warnOffBody } : { title: t.warnUnknown, body: t.warnUnknownBody };
}
/** What a pause or stop leaves capture as, in this journey's terms. */
const staysText = (p: ManagedSetupStepProgress, locale: string) =>
  isFreshProgress(p) ? managedFreshCopy(locale).stays[p.storeMode][p.capture.state] : managedFamilyStepCopy('migration', locale).stays[p.capture.state];

function migrationCard<U>(vc: Host<U>, driver: SetupStepDriver, p: ManagedSetupStepProgress) {
  const locale = vc.env.locale;
  const family = progressFamily(p);
  const t = managedFamilyStepCopy(family, locale);
  const st = driver.state;
  const driving = st.busy === 'run' || st.busy === 'control';
  const pausing = driving && (st.pauseAfter || st.busy === 'control');
  const card = testid(el('section', 'ap-setup-card ap-migration'), 'setup-migration-progress');
  Object.assign(card.dataset, { family, state: p.state, worker: p.worker, effect: p.effect, capture: p.capture.state, recovery: p.recovery, sequence: String(p.sequence), driving: String(driving), step: p.step?.name ?? '', batch: p.step ? String(p.step.batch) : '' });
  if (isFreshProgress(p)) Object.assign(card.dataset, { storeMode: p.storeMode, sourceMode: p.sourceMode, total: String(p.plan.length) });
  const title = migrationTitle(p, driving);
  const heading = testid(el('h4', 'ap-setup-title', t.titles[title]), 'setup-migration-heading');
  heading.tabIndex = -1; heading.id = 'ap-migration-heading';
  card.setAttribute('aria-labelledby', heading.id);
  card.append(heading);
  if (p.state !== 'complete' && p.capture.state !== 'on') {
    // Conspicuous and never dropped: present at every step, failure, pause and reopen while unfinished.
    const warning = testid(el('div'), 'setup-migration-capture-warning');
    warning.dataset.capture = p.capture.state;
    mountBanner(warning, { tone: 'warning', ...captureWarning(p, locale) });
    const key = `capture:${p.operationId}:${p.capture.state}`;
    if (announced.has(key)) warning.querySelector('[role]')?.removeAttribute('role'); else announced.add(key);
    card.append(warning);
  }
  if (p.state !== 'complete') {
    const step = testid(el('p', 'ap-migration-step', migrationStepText(p, locale)), 'setup-migration-step');
    step.setAttribute('role', 'status');
    card.append(step);
    // Creation or reconnection is stated plainly; it is never called a migration.
    if (isFreshProgress(p)) card.append(testid(el('p', 'ap-note', managedFreshCopy(locale).mode[p.storeMode]), 'setup-fresh-mode'));
  }
  const dl = el('dl', 'ap-facts ap-setup-facts');
  dl.append(el('dt', '', t.last), el('dd', '', p.lastCompleted ? t.part(stageLabel(p.lastCompleted.name, locale, family), partOf(p.lastCompleted)) : t.none));
  dl.append(el('dt', '', t.capture), testid(el('dd', '', { on: t.on, off: t.off, unknown: t.unknown }[p.capture.state]), 'setup-migration-capture'));
  card.append(dl);
  const stateLine = testid(el('p', 'ap-note', pausing ? t.status.pausing : driving ? t.status.running : t.status[title]), 'setup-migration-state');
  card.append(stateLine);
  // A reconnected store keeps its own setting: completion with capture off is not a failure to enable.
  if (isFreshProgress(p) && p.state === 'complete' && p.storeMode === 'retain' && p.capture.state === 'off') {
    card.append(testid(el('p', 'ap-note', managedFreshCopy(locale).warn.retain.off.body), 'setup-fresh-kept'));
  }
  // Failed and interrupted sentences already say the result is unknown.
  if (!driving && p.effect === 'uncertain' && title !== 'failed' && title !== 'interrupted' && title !== 'complete') card.append(el('p', 'ap-note', t.status.uncertain));
  const outcome = driving ? null : stepOutcome(card, driver, p, locale);
  // After an unknown reply only a status check is offered; drop the state's own next-step advice.
  if (outcome?.uncertain) stateLine.remove();
  if (st.confirm) { card.append(stepConfirm(vc, driver, p)); return card; }
  const row = el('div', 'ap-row');
  if (driving) {
    stepButton(row, 'setup-migration-pause', pausing ? t.pausing : t.pause, () => { vc.handoff({ to: 'setup-migration-cancel' }); driver.requestPause(); }, 'outline', pausing);
  } else if (p.state !== 'complete') {
    const busy = !!st.busy;
    const action = outcome?.uncertain ? 'status' : nextAction(p);
    const go = (fn: () => Promise<void>) => () => { vc.handoff({ to: 'setup-migration-pause' }); void fn(); };
    if (action === 'continue') stepButton(row, ACTION_HOOK.continue, t.continue, go(() => driver.continueRun(p)), 'default', busy);
    if (action === 'resume') stepButton(row, ACTION_HOOK.resume, t.resume, go(() => driver.resume(p)), 'default', busy);
    if (action === 'review') stepButton(row, ACTION_HOOK.review, t.reviewCapture, () => { void driver.inspect('capture', { progress: p }); }, 'default', busy);
    if (action === 'status') stepButton(row, ACTION_HOOK.status, t.check, () => { void driver.status(p); }, outcome?.uncertain ? 'default' : 'outline', busy);
    if (action !== 'status' && canAbandon(p)) stepButton(row, 'setup-migration-abandon', t.abandon, () => { vc.handoff({ to: 'setup-migration-cancel' }); driver.requestAbandon(p); }, 'ghost', busy);
  }
  if (row.childElementCount) card.append(row);
  return card;
}

/** Confirmed begin still in flight: no progress exists yet, so nothing beyond step 1 is claimed.
 * A fresh begin counts against its own reviewed plan, not the nine migration stages. */
function startingCard<U>(vc: Host<U>, driver: SetupStepDriver) {
  const locale = vc.env.locale;
  const st = driver.state;
  const family = st.family;
  const t = managedFamilyStepCopy(family, locale);
  const plan: ManagedFreshStepRef[] | null = family === 'fresh' ? st.starting : null;
  const pausing = st.pauseAfter;
  const card = testid(el('section', 'ap-setup-card ap-migration'), 'setup-migration-progress');
  Object.assign(card.dataset, { family, state: 'starting', driving: 'true', step: 'prepare', batch: '0' });
  const heading = testid(el('h4', 'ap-setup-title', t.titles.running), 'setup-migration-heading');
  heading.tabIndex = -1; heading.id = 'ap-migration-heading';
  card.setAttribute('aria-labelledby', heading.id);
  const total = plan?.length ?? MANAGED_MIGRATION_STEPS.length;
  const step = testid(el('p', 'ap-migration-step', t.step(1, total, stageLabel('prepare', locale, family), null)), 'setup-migration-step');
  step.setAttribute('role', 'status');
  card.append(heading, step, testid(el('p', 'ap-note', pausing ? t.status.pausing : t.status.running), 'setup-migration-state'));
  if (st.confirm) {
    // No progress yet: the confirmation can only hold or record the pause once begin settles.
    const box = testid(el('div', 'ap-migration-confirm'), 'setup-migration-confirm-pause');
    box.setAttribute('role', 'group');
    const title = el('h5', 'ap-setup-title', t.pauseTitle); title.id = 'ap-migration-confirm-title'; box.setAttribute('aria-labelledby', title.id);
    // Before a fresh begin settles no store has been made: a new store is not on, a retained one is unchanged.
    const stays = plan ? managedFreshCopy(locale).stays[plan.some(s => s.name === 'create-store') ? 'create' : 'retain'].unknown : t.stays.on;
    box.append(title, el('p', 'ap-note', t.pauseBody), el('p', 'ap-note', stays));
    const row = el('div', 'ap-row');
    const cancel = () => { vc.handoff({ to: 'setup-migration-pause', heading: migrationHeading }); void driver.cancelConfirm(null); };
    stepButton(row, 'setup-migration-confirm', t.pause, () => { vc.handoff({ to: 'setup-migration-pause', heading: migrationHeading }); void driver.confirmStop(null); }, 'default', false);
    stepButton(row, 'setup-migration-cancel', t.keepGoing, cancel, 'ghost', false);
    box.append(row);
    box.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
    card.append(box);
    return card;
  }
  const row = el('div', 'ap-row');
  stepButton(row, 'setup-migration-pause', pausing ? t.pausing : t.pause, () => { vc.handoff({ to: 'setup-migration-cancel' }); driver.requestPause(); }, 'outline', pausing);
  card.append(row);
  return card;
}

/** Pause/stop confirmation. Cancel owns focus; Escape cancels; nothing is undone either way. */
function stepConfirm<U>(vc: Host<U>, driver: SetupStepDriver, p: ManagedSetupStepProgress) {
  const t = managedFamilyStepCopy(progressFamily(p), vc.env.locale);
  const kind = driver.state.confirm!;
  const box = testid(el('div', 'ap-migration-confirm'), `setup-migration-confirm-${kind}`);
  box.setAttribute('role', 'group');
  const title = el('h5', 'ap-setup-title', kind === 'pause' ? t.pauseTitle : t.abandonTitle);
  title.id = 'ap-migration-confirm-title'; box.setAttribute('aria-labelledby', title.id);
  box.append(title, el('p', 'ap-note', kind === 'pause' ? t.pauseBody : t.abandonBody), el('p', p.capture.state === 'on' ? 'ap-note' : 'ap-doc-warn', staysText(p, vc.env.locale)));
  const back = kind === 'pause' ? 'setup-migration-pause' : 'setup-migration-abandon';
  const cancel = () => {
    const next = nextAction(p);
    vc.handoff({ to: driver.state.busy ? 'setup-migration-pause' : next ? ACTION_HOOK[next] : back, heading: migrationHeading });
    void driver.cancelConfirm(p);
  };
  const row = el('div', 'ap-row');
  stepButton(row, 'setup-migration-confirm', kind === 'pause' ? t.pause : t.abandon, () => {
    vc.handoff({ to: driver.state.busy ? 'setup-migration-pause' : undefined, heading: migrationHeading });
    void driver.confirmStop(p);
  }, kind === 'pause' ? 'default' : 'destructive', false);
  stepButton(row, 'setup-migration-cancel', kind === 'pause' ? t.keepGoing : t.cancel, cancel, 'ghost', false);
  box.append(row);
  box.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
  return box;
}

/** Fresh review body: what is created or reused, the companion version, the capture consequence and
 * the actual frozen plan in order. Proposed identities stay private to the review. */
function freshReviewBody(card: Element, r: ManagedFreshReview, locale: string) {
  const text = managedCopy(locale), f = managedFreshCopy(locale), t = managedFamilyStepCopy('fresh', locale);
  card.append(facts([[text.configRoot, r.targets.configRoot], [text.dataRoot, r.targets.dataRoot], [text.store, r.targets.storeRoot]]));
  // Plain-language consequences, not paths: ordinary text rather than the monospace path style.
  const consequences = testid(el('dl', 'ap-facts ap-setup-facts ap-fresh-facts'), 'setup-fresh-facts');
  for (const [k, v] of [
    [f.rows.store, f.storeValue[r.storeMode]], [f.rows.source, f.sourceValue[r.sourceMode]], [f.rows.version, r.packageVersion],
    [f.rows.capture, r.storeMode === 'create' ? f.captureValue.create : f.captureValue.retain(t.stateWord[r.capture.state])],
  ]) consequences.append(el('dt', '', k), el('dd', '', v));
  card.append(consequences);
  const effect = r.storeMode === 'create' ? f.effect.create : r.sourceMode === 'create' ? f.effect['retain-create'] : f.effect['retain-reuse'];
  card.append(testid(el('p', r.storeMode === 'create' ? 'ap-note' : 'ap-doc-warn', effect), 'setup-fresh-effect'));
  const plan = testid(el('div', 'ap-fresh-plan'), 'setup-fresh-plan');
  const label = el('p', 'ap-note ap-fresh-plan-label', f.rows.plan); label.id = 'ap-fresh-plan-label';
  const list = el('ol', 'ap-fresh-steps'); list.setAttribute('aria-labelledby', label.id);
  for (const step of r.plan) list.append(testid(el('li', '', stageLabel(step.name, locale, 'fresh')), `setup-fresh-plan-${step.name}`));
  plan.append(label, list);
  card.append(plan);
  for (const body of [text.privilege, text.lifecycle, text.reach, f.stepwise]) card.append(el('p', 'ap-note', body));
}

/** Consent before begin, or fresh consent for exactly one uncertain capture decision. */
function stepReviewCard<U>(vc: Host<U>, driver: SetupStepDriver) {
  const r = driver.state.review;
  if (!r) return null;
  const locale = vc.env.locale;
  const family: StepFamily = r.kind === 'capture' ? progressFamily(r.progress) : isFreshReview(r.review) ? 'fresh' : 'migration';
  const text = managedCopy(locale), t = managedFamilyStepCopy(family, locale);
  const busy = !!driver.state.busy;
  const capture = r.kind === 'capture';
  const card = testid(el('div', 'ap-setup-card'), capture ? 'setup-migration-capture-review' : 'setup-review');
  card.dataset.family = family;
  const freshBegin = r.kind === 'begin' && isFreshReview(r.review) ? r.review : null;
  card.dataset.action = r.kind === 'capture' ? `capture-${r.progress.step!.name}` : freshBegin ? 'managed-fresh' : 'managed-migrate';
  if (freshBegin) Object.assign(card.dataset, { storeMode: freshBegin.storeMode, sourceMode: freshBegin.sourceMode, total: String(freshBegin.plan.length) });
  card.append(el('h3', 'ap-setup-title', capture ? t.captureTitle : freshBegin ? managedFreshCopy(locale).reviewTitle[freshBegin.storeMode] : text.migrate));
  const enable = r.kind === 'capture' && r.progress.step!.name === 'enable';
  if (freshBegin) freshReviewBody(card, freshBegin, locale);
  else {
    const reviewed = r.review.targets;
    card.append(facts([[text.configRoot, reviewed.configRoot], [text.dataRoot, reviewed.dataRoot], [text.store, reviewed.storeRoot]]));
    if (r.kind === 'capture') {
      const word = t.stateWord[r.progress.capture.state];
      card.append(el('p', 'ap-doc-warn', enable ? t.captureEnable(word) : t.captureDisable(word)));
    } else {
      for (const body of [text.privilege, text.lifecycle, text.reach, text.switchEffect, t.stepwise]) card.append(el('p', 'ap-note', body));
    }
  }
  const ack = testid(el('div'), 'setup-ack');
  mountCheckbox(ack, { label: capture ? (enable ? t.ackEnable : t.ackDisable) : text.ack, checked: driver.state.ack, onChange: (checked) => driver.setAck(checked) });
  card.append(ack);
  const row = el('div', 'ap-row');
  stepButton(row, 'setup-confirm', capture ? t.confirmCapture : text.confirm, () => {
    if (!driver.state.ack) return;
    vc.handoff({ to: 'setup-migration-pause', heading: migrationHeading });
    void (capture ? driver.confirmCapture() : driver.confirmBegin());
  }, 'default', busy || !driver.state.ack);
  const cancel = () => { if (busy) return; vc.handoff({ to: capture ? ACTION_HOOK.review : OPENER_HOOK[family], heading: migrationHeading }); driver.cancelReview(); };
  stepButton(row, 'setup-cancel', text.cancel, cancel, 'ghost', busy);
  card.append(row);
  card.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancel(); } });
  return card;
}
