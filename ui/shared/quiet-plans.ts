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

const COPY = {
  en: { filter: 'Hide plans with no reports for 7 days', empty: 'No plans match this filter.', show: 'Show all plans', unsupported: 'This choice lasts only while this view is open.', read: 'Couldn’t read this filter choice. Using the default: hide plans with no reports for 7 days.', write: 'Couldn’t save this filter choice. Keeping the previous choice.', saving: 'Saving filter…', changed: 'Plan filter changed.', retry: 'Retry' },
  ru: { filter: 'Скрывать планы без отчётов 7 дней', empty: 'Нет планов, подходящих под этот фильтр.', show: 'Показать все планы', unsupported: 'Этот выбор действует только пока открыт этот экран.', read: 'Не удалось загрузить настройку фильтра. По умолчанию планы без отчётов 7 дней скрыты.', write: 'Не удалось сохранить настройку фильтра. Прежний выбор сохранён.', saving: 'Сохранение фильтра…', changed: 'Фильтр планов изменён.', retry: 'Повторить' },
  'zh-CN': { filter: '隐藏 7 天没有报告的计划', empty: '没有符合此筛选条件的计划。', show: '显示所有计划', unsupported: '此选择仅在当前视图打开时有效。', read: '无法读取此筛选设置。将使用默认设置：隐藏 7 天没有报告的计划。', write: '无法保存此筛选设置。将保留之前的选择。', saving: '正在保存筛选设置…', changed: '计划筛选设置已更改。', retry: '重试' },
} as const;
export const quietCopy = (locale: InterfaceLanguage) => COPY[locale];
