import { formatCount } from './format.ts';
import type { InterfaceLanguage } from './i18n.ts';

type Report = { lifecycle: string; reportedAt: string };
const DAY = 86_400_000;

/** A factual classification, independent of live session state or task status. */
export function quietDays(plan: Report, now: number): number | null {
  if (plan.lifecycle !== 'active' || !Number.isFinite(now)) return null;
  const time = Date.parse(plan.reportedAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== plan.reportedAt) return null;
  const elapsed = Math.floor((now - time) / DAY);
  return elapsed >= 7 ? elapsed : null;
}

export const admitsQuiet = (plan: Report, hide: boolean, now: number) => !hide || quietDays(plan, now) === null;

export function quietLabel(days: number, locale: InterfaceLanguage): string {
  const n = formatCount(days, locale);
  if (locale === 'zh-CN') return `已 ${n} 天没有报告`;
  if (locale === 'ru') {
    const form = new Intl.PluralRules(locale).select(days);
    return `Нет отчётов ${n} ${form === 'one' ? 'день' : form === 'few' ? 'дня' : 'дней'}`;
  }
  return `No reports for ${n} days`;
}
