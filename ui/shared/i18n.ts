export type InterfaceLanguage = 'en' | 'ru' | 'zh-CN';
export type LanguagePreference = 'auto' | InterfaceLanguage;

export function resolveLanguage(preference: LanguagePreference, hostLocale: string): InterfaceLanguage {
  if (preference !== 'auto') return preference;
  try {
    const [locale] = Intl.getCanonicalLocales(hostLocale);
    const language = locale?.split('-')[0];
    // Traditional Chinese locales also use the single Simplified Chinese catalog.
    return language === 'ru' ? 'ru' : language === 'zh' ? 'zh-CN' : 'en';
  } catch { return 'en'; }
}

export interface LanguageMessages {
  readonly label: string;
  readonly automatic: string;
  readonly unsupported: string;
  readonly readFailed: string;
  readonly saveFailed: string;
  readonly saving: string;
  readonly saved: string;
}
const catalogs: Readonly<Record<InterfaceLanguage, LanguageMessages>> = Object.freeze({
  en: Object.freeze({
    label: 'Language', automatic: 'Automatic (OpenChamber)',
    unsupported: 'Follows OpenChamber’s language on this version.',
    readFailed: 'Couldn’t read your language choice; keeping the last choice.',
    saveFailed: 'Couldn’t save your language choice; try again.',
    saving: 'Saving language…', saved: 'Language saved.',
  }),
  ru: Object.freeze({
    label: 'Язык', automatic: 'Автоматически (OpenChamber)',
    unsupported: 'В этой версии используется язык OpenChamber.',
    readFailed: 'Не удалось прочитать выбор языка; остаётся прежний.',
    saveFailed: 'Не удалось сохранить язык; попробуйте снова.',
    saving: 'Сохранение языка…', saved: 'Язык сохранён.',
  }),
  'zh-CN': Object.freeze({
    label: '语言', automatic: '跟随 OpenChamber 语言',
    unsupported: '此版本跟随 OpenChamber 的语言。',
    readFailed: '无法读取已保存的语言，仍使用上次确认的选择。',
    saveFailed: '无法保存语言，仍使用上次确认的选择，请重试。',
    saving: '正在保存语言…', saved: '语言已保存。',
  }),
});
export function languageMessages(language: InterfaceLanguage): LanguageMessages { return catalogs[language]; }
