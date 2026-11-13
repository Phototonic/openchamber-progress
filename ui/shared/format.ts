// Locale-aware time text. Age is shown as information only: no overdue or stuck inference.
import { directoryKey } from './path.ts';
import { resolveLanguage } from './i18n.ts';

const TIME = {
  en: { unknown: 'at an unknown time', recent: 'just now', minute: 'min', hour: 'h', days: { one: 'day', few: 'days', many: 'days', other: 'days' } },
  ru: { unknown: 'в неизвестное время', recent: 'только что', minute: 'мин', hour: 'ч', days: { one: 'день', few: 'дня', many: 'дней', other: 'дня' } },
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

export function relativeAge(iso: string, now: number, locale: string): string {
  const copy = TIME[resolveLanguage('auto', locale)];
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return copy.unknown;
  const seconds = Math.round((t - now) / 1000);
  if (Math.abs(seconds) < 45) return copy.recent;
  let rtf: Intl.RelativeTimeFormat;
  try { rtf = new Intl.RelativeTimeFormat(locale || 'en', { numeric: 'auto' }); } catch { rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); }
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  return rtf.format(Math.round(seconds / 60), 'minute');
}

/**
 * Whole-minute duration of a reported-working interval: "<1 min", "12 min", "3 h 5 min",
 * "2 days 4 h". No seconds: the start is when work was reported, not when it began. Null when
 * the value cannot be a duration.
 */
export function elapsedText(ms: number, locale = 'en'): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const language = resolveLanguage('auto', locale), copy = TIME[language];
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `<1 ${copy.minute}`;
  if (minutes < 60) return `${formatCount(minutes, language)} ${copy.minute}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${formatCount(hours, language)} ${copy.hour} ${minutes % 60} ${copy.minute}` : `${formatCount(hours, language)} ${copy.hour}`;
  const days = Math.floor(hours / 24);
  const form = new Intl.PluralRules(language).select(days);
  const dayForms: Partial<Record<Intl.LDMLPluralRule, string>> = copy.days;
  return `${formatCount(days, language)} ${dayForms[form] ?? copy.days.other}${hours % 24 ? ` ${hours % 24} ${copy.hour}` : ''}`;
}

export function absoluteTime(iso: string, locale: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  try { return new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(t); } catch { return t.toISOString(); }
}

export function clockTime(ms: number, locale: string): string {
  try { return new Intl.DateTimeFormat(locale || undefined, { timeStyle: 'short' }).format(new Date(ms)); } catch { return new Date(ms).toISOString(); }
}

export function formatCount(n: number, locale: string) {
  try { return new Intl.NumberFormat(locale || undefined).format(n); } catch { return String(n); }
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Last path segment, for compact location labels. */
export const baseName = (dir: string) => directoryKey(dir).split('/').pop() || dir;
