// Locale-aware time text. Age is shown as information only: no overdue or stuck inference.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

export function relativeAge(iso: string, now: number, locale: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'at an unknown time';
  const seconds = Math.round((t - now) / 1000);
  if (Math.abs(seconds) < 45) return 'just now';
  let rtf: Intl.RelativeTimeFormat;
  try { rtf = new Intl.RelativeTimeFormat(locale || 'en', { numeric: 'auto' }); } catch { rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); }
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  return rtf.format(Math.round(seconds / 60), 'minute');
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
export const baseName = (dir: string) => dir.replace(/\/+$/, '').split('/').pop() || dir;
