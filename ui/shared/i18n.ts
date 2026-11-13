export type InterfaceLanguage = 'en' | 'ru';
export type LanguagePreference = 'auto' | InterfaceLanguage;

export function resolveLanguage(preference: LanguagePreference, hostLocale: string): InterfaceLanguage {
  if (preference !== 'auto') return preference;
  try {
    const [locale] = Intl.getCanonicalLocales(hostLocale);
    return locale?.split('-')[0] === 'ru' ? 'ru' : 'en';
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
});
export function languageMessages(language: InterfaceLanguage): LanguageMessages { return catalogs[language]; }
