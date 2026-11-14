export type InterfaceLanguage = 'en' | 'ru' | 'zh-CN';
export type LanguagePreference = 'auto' | InterfaceLanguage;

export function resolveLanguage(preference: LanguagePreference, hostLocale: string): InterfaceLanguage {
  if (preference !== 'auto') return preference;
  try {
    const [locale] = Intl.getCanonicalLocales(hostLocale);
    const language = locale?.split('-')[0];
    // 简体中文界面同时用于繁体区域：目前只提供简体译文。
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
    label: 'Language', automatic: 'OpenChamber language',
    unsupported: 'This host does not support device storage. The interface follows the OpenChamber language; manual selection is unavailable.',
    readFailed: 'The saved language could not be read. The last confirmed choice is still in use.',
    saveFailed: 'The language could not be saved. The last confirmed choice is still in use. Try again.',
    saving: 'Saving language…', saved: 'Language saved.',
  }),
  ru: Object.freeze({
    label: 'Язык', automatic: 'Язык OpenChamber',
    unsupported: 'Этот хост не поддерживает хранилище устройства. Интерфейс следует языку OpenChamber; ручной выбор недоступен.',
    readFailed: 'Не удалось прочитать сохранённый язык. Действует последний подтверждённый выбор.',
    saveFailed: 'Не удалось сохранить язык. Действует последний подтверждённый выбор. Попробуйте снова.',
    saving: 'Сохранение языка…', saved: 'Язык сохранён.',
  }),
  'zh-CN': Object.freeze({
    label: '语言', automatic: '跟随 OpenChamber 语言',
    unsupported: '此主机不支持设备存储。界面将跟随 OpenChamber 语言，无法手动选择。',
    readFailed: '无法读取已保存的语言，仍使用上次确认的选择。',
    saveFailed: '无法保存语言，仍使用上次确认的选择。请重试。',
    saving: '正在保存语言…', saved: '语言已保存。',
  }),
});
export function languageMessages(language: InterfaceLanguage): LanguageMessages { return catalogs[language]; }
