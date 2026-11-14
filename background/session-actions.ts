// One invocation per hidden host frame. No timers, subscriptions to workspaces or writes.
import type { HostClient, HostReadyContext } from '@openchamber/sdk';
import { formatComposerSummary } from '../shared/summary.ts';
import { parseHealth } from '../ui/shared/adapter.ts';
import { resolveLanguage, type InterfaceLanguage } from '../ui/shared/i18n.ts';
import { readEffectiveLanguage } from '../ui/shared/language.ts';
import { automaticPlan, railPlanKey } from '../ui/shared/plan-selection.ts';
import { contextScope } from '../ui/shared/scope.ts';
import { classify, readDetail, readList, type ReadFailure, type ServiceHost } from '../ui/shared/source.ts';

export const SESSION_ACTIONS = { handoff: 'insert-handoff', progress: 'insert-progress-update' } as const;
const TEXT = {
  en: {
    noPlan: 'No plan reported for this session',
    unavailable: 'Progress is unavailable. Check the Agent progress setup and service.',
    unsupported: 'This progress service does not support composer handoffs. Update it before trying again.',
    source: 'The session’s OpenCode setup could not be verified. No text was added.',
    incomplete: 'Complete progress could not be read. No text was added.',
    preference: 'The saved plan choice could not be read. No text was added.',
    permission: 'Access to Agent progress was denied. Check the extension permissions.',
    paused: 'Agent progress is disabled or disconnected. No text was added.',
    invalid: 'This action requires a session. No text was added.',
    timeout: 'Preparing the summary took too long. No text was added.',
    uncertain: 'The host did not confirm the insertion. Check the active chat before trying again.',
    added: 'Added to the active chat. Review before sending.',
  },
  ru: {
    noPlan: 'В этой сессии нет отчёта о плане',
    unavailable: 'Прогресс недоступен. Проверьте настройку и сервис прогресса агента.',
    unsupported: 'Этот сервис прогресса не поддерживает вставку сводок в чат. Обновите его и повторите попытку.',
    source: 'Не удалось подтвердить установку OpenCode этой сессии. Текст не добавлен.',
    incomplete: 'Не удалось прочитать полный отчёт о прогрессе. Текст не добавлен.',
    preference: 'Не удалось прочитать сохранённый выбор плана. Текст не добавлен.',
    permission: 'Доступ к прогрессу агента запрещён. Проверьте разрешения расширения.',
    paused: 'Прогресс агента отключён или соединение потеряно. Текст не добавлен.',
    invalid: 'Для этого действия нужна сессия. Текст не добавлен.',
    timeout: 'Подготовка сводки заняла слишком много времени. Текст не добавлен.',
    uncertain: 'Хост не подтвердил вставку. Проверьте текущий чат перед повторной попыткой.',
    added: 'Добавлено в текущий чат. Проверьте текст перед отправкой.',
  },
} satisfies Record<InterfaceLanguage, Record<string, string>>;
type Notice = keyof typeof TEXT.en;
class Refusal extends Error {
  readonly notice: Notice;
  constructor(notice: Notice) { super(notice); this.notice = notice; }
}
class Retired extends Error {}
type ActionHost = Pick<HostClient, 'onAction' | 'onReady' | 'onConnection' | 'serviceRequest' | 'storage' | 'compose' | 'toast'>;
const failureNotice = (failure: ReadFailure, fallback: Notice): Notice => failure.kind === 'not-approved' ? 'permission'
  : failure.kind === 'paused' || failure.kind === 'disconnected' ? 'paused' : fallback;

/** Register synchronously, before readiness. The host owns permission/runtime teardown;
 * local checkpoints also retire pending reads on pagehide or changed host authority. */
export function registerSessionActions(host: ActionHost, mono: () => number = () => performance.now()): () => void {
  let retired = false, invoked = false;
  let context: HostReadyContext | null = null;
  let readyResolve!: (context: HostReadyContext | null) => void;
  const ready = new Promise<HostReadyContext | null>(resolve => { readyResolve = resolve; });
  const retire = () => { retired = true; readyResolve(null); };

  const offAction = host.onAction(async item => {
    if (invoked || retired) return;
    invoked = true;
    const deadline = mono() + 18_000; // Leave the host's 20-second frame budget headroom.
    let language: InterfaceLanguage = 'en';
    const checkpoint = () => {
      if (retired) throw new Retired();
      if (mono() >= deadline) throw new Refusal('timeout');
    };
    const prepare = async (): Promise<Notice | null> => {
      const ctx = await ready;
      checkpoint();
      if (!ctx) return null;
      language = resolveLanguage('auto', ctx.locale);
      language = await readEffectiveLanguage(host.storage, ctx.locale, ctx.features?.deviceStorage === true);
      checkpoint();
      if (ctx.surface !== 'background' || item.kind !== 'session' || !item.sessionId
        || !Object.values(SESSION_ACTIONS).includes(item.action as typeof SESSION_ACTIONS[keyof typeof SESSION_ACTIONS])) throw new Refusal('invalid');

      // Guard every continuation, not only the final result: retired work reads no more pages.
      // Preserve fixed action failures across the existing reader's classified failure boundary.
      let serviceRefusal: Refusal | null = null;
      const guarded: ServiceHost = { serviceRequest: async request => {
        try {
          checkpoint();
          const reply = await host.serviceRequest(request);
          checkpoint();
          if (request.path === '/health' && reply.status === 200) {
            const health = parseHealth(reply.body);
            if (!health.ready && health.state !== 'starting' && health.state !== 'refused') throw new Refusal('unavailable');
            if (health.ready && health.planComposerHandoff !== 1) throw new Refusal('unsupported');
          }
          return reply;
        }
        catch (error) { if (error instanceof Refusal) serviceRefusal = error; throw error; }
      } };
      let saved: unknown;
      try { saved = await host.storage.get(railPlanKey(item.sessionId)); }
      catch (error) { throw new Refusal(failureNotice(classify(error), 'preference')); }
      checkpoint();
      if (saved !== undefined && typeof saved !== 'string') throw new Refusal('preference');

      const listed = await readList(guarded, { session: item.sessionId, archived: 'exclude' });
      checkpoint();
      if (serviceRefusal) throw serviceRefusal;
      if (!listed.ok) throw new Refusal(failureNotice(listed.failure, 'unavailable'));
      const read = listed.read;
      if (!read) throw new Refusal('unavailable');
      if (read.truncated) throw new Refusal('incomplete');
      const bound = read.binding.sourceId;
      if (!read.binding.verified || !bound || !read.sources.some(s => s.id === bound && s.verified)
        || read.plans.some(p => p.sourceId !== bound)) throw new Refusal('source');
      if (read.plans.some(p => p.cleanup?.state === 'archived')) throw new Refusal('incomplete');
      const scope = contextScope(read.plans, item.sessionId);
      const plan = read.plans.find(p => p.key === saved) ?? automaticPlan(scope);
      if (!plan) return 'noPlan';
      const result = await readDetail(guarded, plan, mono, read);
      checkpoint();
      if (!result.ok) throw new Refusal(failureNotice(result.failure, 'incomplete'));
      if (result.plan.cleanup?.state === 'archived'
        || (result.plan.cleanup?.revision ?? 0) !== (plan.cleanup?.revision ?? 0)) throw new Refusal('incomplete');
      const text = formatComposerSummary(result, item.action === SESSION_ACTIONS.handoff ? 'handoff' : 'progress', language, { otherPlans: read.plans.length - 1, source: 'bound' });
      if (text === null) throw new Refusal('incomplete');
      checkpoint();
      try { await host.compose({ text, mode: 'append' }); }
      catch { return 'uncertain'; }
      // No retry after an uncertain acknowledgement, and no success after retirement.
      return 'added';
    };
    let notice: Notice | null;
    try { notice = await prepare(); }
    catch (error) {
      if (retired || error instanceof Retired) return;
      notice = error instanceof Refusal ? error.notice : failureNotice(classify(error), 'unavailable');
    }
    if (retired || notice === null) return;
    try {
      await host.toast({ kind: notice === 'added' || notice === 'noPlan' ? 'info' : 'error', message: TEXT[language][notice] });
    } catch (error) {
      // The SDK may surface a thrown handler error. Never pass it a host/raw diagnostic.
      if (!retired) throw new Error(TEXT[language][notice]);
    }
  });
  const offReady = host.onReady(ctx => {
    if (context && (ctx.surface !== context.surface || ctx.connection.account !== context.connection.account || ctx.connection.connected !== context.connection.connected)) retire();
    if (!retired) { context = ctx; readyResolve(ctx); }
  });
  const offConnection = host.onConnection(connection => {
    if (context && (connection.account !== context.connection.account || connection.connected !== context.connection.connected)) retire();
  });
  return () => { retire(); offAction(); offReady(); offConnection(); };
}
