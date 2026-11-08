import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import type { Item, PlanSummary } from '../../shared/progress.ts';
import { readDetail, MAX_DETAIL_PAGES, MAX_DETAIL_RESTARTS, type CompleteDetailResult, type DetailFailureCause, type DetailResult, type ServiceHost } from '../../ui/shared/source.ts';
import { describeDetailFailure, formatHandoff, formatProgressUpdate, formatSummaryOnly, markdownLiteral } from '../../ui/shared/summary.ts';
import { EXPECTED_HANDOFF, EXPECTED_HANDOFF_RU, EXPECTED_PROGRESS, EXPECTED_PROGRESS_RU, EXPECTED_SUMMARY_ONLY_RU, FORBIDDEN, pagedSummaryItems, SUMMARY_ITEMS, SUMMARY_REQUEST, summaryEnvelope, summaryPage, summaryPlan, summaryReports } from '../fixtures/preview-summaries.ts';

const reply = (body: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(body) });
const host = (route: (q: GuestRequest) => GuestRequestResult | Promise<GuestRequestResult>): ServiceHost => ({ serviceRequest: async (q) => route(q) });
async function fixture(items = SUMMARY_ITEMS, extra: Partial<PlanSummary> = {}, envelope = summaryEnvelope()): Promise<CompleteDetailResult> {
  const result = await readDetail(host((q) => reply(summaryPage(items, summaryReports(), Number(q.query?.cursor ?? 0), summaryPlan(items, extra), envelope))), SUMMARY_REQUEST);
  assert.ok(result.ok); return result;
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); } return value; }
function failure(r: DetailResult) { assert.equal(r.ok, false); if (r.ok) throw new Error('expected failure'); return r; }

test('localized summaries keep exact golden Markdown and the same frozen recorded facts', async () => {
  const r = freeze(await fixture());
  const before = JSON.stringify(r);
  assert.equal(formatProgressUpdate(r, 'ru'), EXPECTED_PROGRESS_RU);
  assert.equal(formatHandoff(r, 'ru'), EXPECTED_HANDOFF_RU);
  assert.equal(formatSummaryOnly(r.snapshot!, { kind: 'page-cap' }, 'ru'), EXPECTED_SUMMARY_ONLY_RU);
  assert.equal(formatProgressUpdate(r, 'en'), EXPECTED_PROGRESS);
  assert.equal(formatHandoff(r, 'en'), EXPECTED_HANDOFF);
  for (const language of ['en', 'ru'] as const) {
    for (const text of [formatProgressUpdate(r, language)!, formatHandoff(r, language)!, formatSummaryOnly(r.snapshot!, { kind: 'page-cap' }, language)]) {
      assert.ok(text.endsWith('\n')); assert.ok(!text.includes('\r'));
      assert.ok(!text.includes(FORBIDDEN));
      assert.doesNotMatch(text, /source-summary|captureId|reporterSessionId|objective|child agents/);
    }
    assert.equal(formatHandoff({ ...r, detail: { ...r.detail, revision: r.detail.revision + 1 } }, language), null);
    assert.equal(formatProgressUpdate({ ...r, snapshot: null }, language), null);
  }
  assert.equal(JSON.stringify(r), before);
});

test('localized historical failures use safe fixed copy for every cause and never include detail arrays', async () => {
  const r = freeze(await fixture());
  const causes: [DetailFailureCause, string][] = [
    [{ kind: 'revision-restarts' }, 'Исчерпан лимит перезапусков из-за смены ревизии.'],
    [{ kind: 'page-cap' }, 'Достигнут предел страниц подробных сведений.'],
    [{ kind: 'identity-contract' }, 'Отклонены идентичность подробных сведений или контракт ответа.'],
    [{ kind: 'unreachable-auth' }, 'Сервис недоступен, отключён или отказал в доступе.'],
    [{ kind: 'not-found' }, 'План не найден.'],
    ...(['unavailable', 'storage', 'binding', 'corrupt', 'schema', 'busy'] as const).map((code): [DetailFailureCause, string] => [{ kind: 'store', code }, `Хранилище прогресса вернуло ${code} (HTTP 503).`]),
    [{ kind: 'store', code: 'unknown' }, 'Хранилище прогресса недоступно (HTTP 503).'],
  ];
  for (const [cause, expected] of causes) {
    assert.equal(describeDetailFailure(cause, 'ru'), expected);
    for (const language of ['en', 'ru'] as const) {
      const text = formatSummaryOnly(r.snapshot!, cause, language);
      assert.ok(text.includes(describeDetailFailure(cause, language)));
      assert.doesNotMatch(text, /Validate import mapping|session-example|Recorded reports|Записанные отчёты|## Текущая работа|## Current work|Suggested next step|Предлагаемый следующий шаг/);
      assert.ok(!text.includes(FORBIDDEN));
    }
  }
});

test('both languages preserve HTML-looking user literals and safely omit unknown diagnostics', async () => {
  const title = 'Current work / Текущая работа <script> & *title*\nnext';
  const r = freeze(await fixture([{ id: FORBIDDEN, title, kind: 'task', status: 'working', reporterSessionId: FORBIDDEN }], { title }, summaryEnvelope({ diagnostics: [FORBIDDEN, '__proto__', 'constructor'] })));
  for (const language of ['en', 'ru'] as const) {
    const text = formatHandoff(r, language)!;
    assert.ok(text.includes(markdownLiteral(title)));
    assert.ok(!text.includes(FORBIDDEN));
    assert.doesNotMatch(text, /<script|function|\[object Object\]|__proto__|constructor/);
    assert.ok(text.includes(language === 'ru' ? 'Записана диагностика сервиса прогресса; подробности недоступны.' : 'A progress-service diagnostic was recorded; details are unavailable.'));
  }
});

test('Russian summaries retain count facts, pending limits, prerequisite facts and closed-plan safety', async () => {
  for (const n of [0, 1, 2, 5, 11, 21]) {
    const items = pagedSummaryItems(n).map((i): Item => ({ ...i, status: 'pending', dependencies: undefined }));
    const text = formatHandoff(freeze(await fixture(items)), 'ru')!;
    assert.ok(text.includes(`Прогресс: 0/${n} выполнено; ${n} осталось; 0 пропущено`));
    assert.equal(text.includes(`…показано 10 из ${n}`), n > 10);
    const section = text.split('## Не начато\n')[1].split('\n\n')[0];
    assert.equal(section.split('\n').filter((line) => line.startsWith('- ')).length, Math.min(n, 10));
  }
  const items: Item[] = [
    { id: 'group', title: 'Group', kind: 'group', status: 'pending' },
    { id: 'skip', title: 'Skipped title', kind: 'task', status: 'skipped' },
    { id: 'blocked', title: 'Blocked title', kind: 'task', status: 'blocked' },
    { id: 'pending', title: 'Pending title', kind: 'task', status: 'pending', dependencies: ['skip', 'group', 'blocked', 'pending', FORBIDDEN] },
  ];
  for (const [lifecycle, label] of [['finished', 'Завершён'], ['cancelled', 'Отменён'], ['failed', 'Не удался']] as const) {
    const text = formatHandoff(freeze(await fixture(items, { lifecycle, cleanup: { state: 'archived', revision: 1 } })), 'ru')!;
    assert.ok(text.includes(`Состояние: ${label}`)); assert.ok(text.includes('(в архиве)'));
    assert.ok(text.includes('Skipped title (Пропущено; не считается выполнением)'));
    assert.ok(text.includes('Group (группа; не задача предварительного условия)'));
    assert.ok(text.includes('Blocked title (Заблокировано)'));
    assert.ok(text.includes('Pending title (Не начато)'));
    assert.ok(text.includes('Задача предварительного условия недоступна'));
    assert.ok(text.includes('Готовый следующий шаг не записан.'));
    assert.ok(!text.includes(FORBIDDEN));
  }
});

test('Russian freshness warnings cover every document state and safely deduplicate known diagnostics', async () => {
  const expected = {
    unbound: 'К этому плану не привязан документ.',
    denied: 'При последнем отчёте агенту не разрешили прочитать документ плана.',
    missing: 'При последнем отчёте документ плана отсутствовал.',
    moved: 'Документ плана перемещён после привязки; агенту нужно привязать его снова.',
    oversized: 'Документ плана превышает предел размера снимка, поэтому снимок не создан.',
    'non-text': 'Документ плана не является обычным текстом, поэтому снимок не создан.',
    unavailable: 'Не удалось прочитать документ плана в этой системе.',
    'changed-during-read': 'Документ плана изменился во время чтения; снимок будет создан при следующем отчёте.',
  };
  for (const state of Object.keys(expected) as (keyof typeof expected)[]) {
    const r = freeze(await fixture(SUMMARY_ITEMS, { document: { ...summaryPlan().document, state, checklistSynchronized: false } }, summaryEnvelope({ captureEnabled: false, diagnostics: ['capture-disabled', 'historical-capture', 'source-unverified', 'host-source-binding-unverified', FORBIDDEN] })));
    const text = formatProgressUpdate(r, 'ru')!;
    assert.ok(text.includes(expected[state]));
    for (const message of ['Запись прогресса отключена.', 'Снимок документа является историческим.', 'Записанный источник не проверен.', 'Привязка источника хоста не проверена.', 'Записанный контрольный список не синхронизирован.', 'Последний успешный снимок документа сохранён; последняя попытка создания снимка не заменила его.']) {
      assert.equal(text.split(message).length - 1, 1);
    }
    assert.ok(!text.includes(FORBIDDEN));
  }
});

test('F1 exact deterministic Markdown, authoritative counts, recorded-report attribution and immutable inputs', async () => {
  const r = freeze(await fixture());
  const before = JSON.stringify(r);
  assert.equal(formatProgressUpdate(r), EXPECTED_PROGRESS);
  assert.equal(formatHandoff(r), EXPECTED_HANDOFF);
  assert.equal(formatHandoff(r), formatHandoff(r));
  assert.equal(JSON.stringify(r), before);
  for (const text of [formatProgressUpdate(r)!, formatHandoff(r)!]) {
    assert.ok(!text.includes(FORBIDDEN));
    assert.doesNotMatch(text, /child agents|objective|source-summary|captureId|reporterSessionId/);
  }
  if (process.env.EVIDENCE) {
    mkdirSync(process.env.EVIDENCE, { recursive: true });
    writeFileSync(`${process.env.EVIDENCE}/core.md`, `# Shared summary verification\n\nQ1 synthetic formatter/read-boundary cases are asserted by the unit suite. Exact F1 examples:\n\n## Progress update\n\n\`\`\`markdown\n${EXPECTED_PROGRESS}\`\`\`\n\n## Handoff\n\n\`\`\`markdown\n${EXPECTED_HANDOFF}\`\`\`\n`);
  }
});

test('F2 held continuation gives no complete candidate; contributions outlast items and all records count', async () => {
  const items = pagedSummaryItems(), reports = summaryReports(41);
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const continuation = new Promise<void>((r) => { reached = r; });
  let settled = false;
  const cursors: number[] = [];
  const pending = readDetail(host(async (q) => {
    const page = Number(q.query?.cursor ?? 0); cursors.push(page);
    if (page === 1) { reached(); await held; }
    return reply(summaryPage(items, reports, page));
  }), SUMMARY_REQUEST).then((r) => { settled = true; return r; });
  await continuation;
  assert.equal(settled, false);
  release();
  const r = await pending; assert.ok(r.ok);
  assert.deepEqual(cursors, [0, 1, 2]);
  assert.equal(r.detail.items.length, 21); assert.equal(r.detail.contributions.length, 41);
  assert.match(formatHandoff(r)!, /Recorded reports: 5 direct; 36 parent-relay/);
  assert.match(formatHandoff(r)!, /Task 21 \(Done\)/);
  assert.ok(formatHandoff(r)!.includes('…showing 10 of 20'));
  assert.deepEqual(r.snapshot?.plan.counts, summaryPlan(items).counts);
});

test('F2 pending 10/11 boundary, 1000 tasks and no incidental cap on working/blocked lists', async () => {
  for (const n of [10, 11, 1000]) {
    const items: Item[] = pagedSummaryItems(n).map((i) => ({ ...i, status: 'pending', dependencies: undefined }));
    const text = formatHandoff(await fixture(items))!;
    const section = text.split('## Not started\n')[1].split('\n\n')[0];
    assert.equal(section.split('\n').filter((line) => line.startsWith('- ')).length, Math.min(n, 10));
    assert.equal(text.includes(`…showing 10 of ${n}`), n > 10);
    assert.ok(text.includes(`Progress: 0/${n} done; ${n} remaining; 0 skipped`));
  }
  const items = pagedSummaryItems(42).map((i, n): Item => ({ ...i, status: n < 21 ? 'working' : 'blocked', dependencies: undefined }));
  const text = formatProgressUpdate(await fixture(items))!;
  assert.equal(text.split('\n').filter((line) => line.startsWith('- Task')).length, 42);
});

test('F3 suggestion comes only from complete valid active readiness in stored order', async () => {
  const base: Item[] = [{ id: 'ready', title: 'First ready', kind: 'task', status: 'pending' }, { id: 'other', title: 'Other task', kind: 'task', status: 'pending', dependencies: [] }];
  assert.match(formatHandoff(await fixture(base))!, /plan step\)\nFirst ready\n/);
  const variants: Item[][] = [
    [...base, { id: 'waiting', title: 'Waiting', kind: 'task', status: 'pending', dependencies: ['unavailable-id'] }],
    [...base, { id: 'group', title: 'Group', kind: 'group', status: 'pending' }, { id: 'waiting', title: 'Waiting', kind: 'task', status: 'pending', dependencies: ['group'] }],
    base.map((i) => ({ ...i, dependencies: [i.id === 'ready' ? 'other' : 'ready'] })),
    [...base, base[0]], base.map((i) => ({ ...i, dependencies: [i.id] })),
    [], base.map((i) => ({ ...i, status: 'done' })), base.map((i) => ({ ...i, status: 'skipped' })),
    base.map((i) => ({ ...i, status: 'working' })),
  ];
  for (const items of variants) assert.match(formatHandoff(await fixture(items))!, /No ready next step is recorded\./);
  for (const lifecycle of ['finished', 'cancelled', 'failed'] as const) {
    const r = await fixture(base, { lifecycle, cleanup: { state: 'archived', revision: 1 } });
    const text = formatHandoff(r)!;
    assert.match(text, /\(archived\)/); assert.match(text, /No ready next step is recorded\./);
    assert.match(text, /No prerequisites recorded/);
    if (lifecycle === 'finished') { assert.equal(r.plan.lifecycle, 'completed'); assert.match(text, /Lifecycle: Finished/); }
  }
});

test('F3 prerequisites describe recorded facts even on invalid/closed graphs; skipped is not done, absent IDs do not leak', async () => {
  const items: Item[] = [
    { id: 'skip', title: 'Optional path', kind: 'task', status: 'skipped' },
    { id: 'wait', title: 'Pending work', kind: 'task', status: 'pending', dependencies: ['skip', FORBIDDEN] },
    { id: 'block', title: 'Explicit blocker', kind: 'task', status: 'blocked', dependencies: [] },
  ];
  for (const lifecycle of ['active', 'finished'] as const) {
    const text = formatHandoff(await fixture(items, { lifecycle }))!;
    assert.match(text, /Skipped; does not count as done/);
    assert.match(text, /Prerequisite task unavailable/); assert.ok(!text.includes(FORBIDDEN));
    assert.match(text, /Explicit blocker — blocker details omitted from this summary — No prerequisites recorded/);
    assert.match(text, /No ready next step is recorded/);
  }
  const bad = await fixture([...items, { ...items[1], title: 'Duplicate reported task' }]);
  assert.match(formatHandoff(bad)!, /Duplicate reported task/);
});

test('F3 freshness facts: denied/missing/moved, retained captures, synchronization, capture off and safe diagnostics, never age inference', async () => {
  const doc = summaryPlan().document;
  for (const state of ['denied', 'missing', 'moved'] as const) {
    const text = formatProgressUpdate(await fixture(SUMMARY_ITEMS, { document: { ...doc, state, checklistSynchronized: false }, reportedAt: '2001-01-01T00:00:00.000Z' }, summaryEnvelope({ captureEnabled: false, diagnostics: ['historical-capture', FORBIDDEN, '__proto__', 'constructor'] })))!;
    assert.match(text, /last successful document snapshot is retained/);
    assert.match(text, /checklist is not synchronized/); assert.match(text, /capture is disabled/);
    assert.match(text, /snapshot is historical/); assert.match(text, /diagnostic was recorded/);
    assert.ok(!text.includes(FORBIDDEN)); assert.doesNotMatch(text, /out.of.sync|too old|stale|ago|function|\[object Object\]/i);
  }
  const text = formatProgressUpdate(await fixture(SUMMARY_ITEMS, { document: { ...doc, state: 'denied', captureId: undefined, checklistSynchronized: true } }))!;
  assert.doesNotMatch(text, /snapshot is retained|not synchronized/);
});

test('F3 Markdown punctuation, multiline and HTML-looking text remain literals, forbidden metadata never exported', async () => {
  const title = '# [export](https://example.test) *text*\n<script> & `code` \\ path';
  const r = await fixture([{ id: FORBIDDEN, title, kind: 'task', status: 'working', reporterSessionId: FORBIDDEN, assigneeSessionId: FORBIDDEN }], { title });
  const text = formatHandoff(r)!;
  assert.ok(text.includes(markdownLiteral(title)));
  assert.doesNotMatch(text, /<script\b|\n# \[export\]/i);
  assert.ok(!text.includes(FORBIDDEN));
  assert.equal(markdownLiteral('line\r\nnext\u2028last'), 'line next last');
});

test('missing/unusable server summary never becomes zero or item-derived authority; mismatched detail is refused', async () => {
  for (const counts of [undefined, { done: -1, total: 9, remaining: 10, skipped: 1 }, { done: 5, total: 9, remaining: 2, skipped: 1 }]) {
    const r = await fixture(SUMMARY_ITEMS, { counts });
    assert.equal(r.snapshot, null); assert.equal(formatHandoff(r), null); assert.equal(formatProgressUpdate(r), null);
  }
  const r = await fixture(); r.detail.revision++;
  assert.equal(formatHandoff(r), null);
});

test('F4 bounded successful restart replaces snapshot with accepted first page, never continuation warnings', async () => {
  const items = pagedSummaryItems(); let initial = 0;
  const result = await readDetail(host((q) => {
    const page = Number(q.query?.cursor ?? 0); if (!page) initial++;
    return reply(summaryPage(items, [], page, summaryPlan(items, { revision: initial === 1 && !page ? 1 : 2 }), summaryEnvelope({ diagnostics: page ? [FORBIDDEN] : [] })));
  }), SUMMARY_REQUEST);
  assert.ok(result.ok); assert.equal(result.restarts, 1); assert.equal(result.snapshot?.plan.revision, 2);
  assert.deepEqual(result.snapshot?.diagnostics, []); assert.ok(!formatHandoff(result)!.includes('diagnostic'));
});

test('F4 exhausted restarts, page cap and foreign continuations retain first-page-only historical fallback', async () => {
  const items = pagedSummaryItems(); let attempt = 0;
  const churn = failure(await readDetail(host((q) => {
    const page = Number(q.query?.cursor ?? 0); if (!page) attempt++;
    return reply(summaryPage(items, [], page, summaryPlan(items, { revision: page ? attempt + 1 : attempt })));
  }), SUMMARY_REQUEST));
  assert.equal(attempt, MAX_DETAIL_RESTARTS + 1); assert.equal(churn.cause.kind, 'revision-restarts');
  let calls = 0;
  const cap = failure(await readDetail(host(() => { calls++; const p = summaryPage(); p.items.nextCursor = 'again'; return reply(p); }), SUMMARY_REQUEST));
  assert.equal(calls, MAX_DETAIL_PAGES); assert.equal(cap.cause.kind, 'page-cap');
  const failures = [churn, cap];
  for (const change of ['store', 'binding', 'plan', 'contract']) {
    failures.push(failure(await readDetail(host((q) => {
      const page = Number(q.query?.cursor ?? 0); const p = summaryPage(items, [], page);
      if (page) {
        if (change === 'store') p.storeId = 'foreign';
        if (change === 'binding') p.sourceBinding = { sourceId: 'foreign', verified: false };
        if (change === 'plan') p.plan.id = 'foreign';
        if (change === 'contract') return reply({ invalid: FORBIDDEN });
      }
      return reply(p);
    }), SUMMARY_REQUEST)));
  }
  for (const r of failures) {
    assert.ok(r.snapshot); assert.ok(!('detail' in r)); assert.ok(!('items' in r.snapshot)); assert.ok(!('contributions' in r.snapshot)); assert.ok(!('links' in r.snapshot));
    for (const language of ['en', 'ru'] as const) {
      const text = formatSummaryOnly(r.snapshot, r.cause, language);
      assert.ok(text.includes(language === 'en' ? 'summary-only historical snapshot' : 'только исторический снимок сводки'));
      assert.ok(text.includes(describeDetailFailure(r.cause, language)));
      assert.doesNotMatch(text, /## Current work|## Not started|Recorded reports:|Origin session:|Suggested next step|Remaining breakdown|## Текущая работа|## Не начато|Записанные отчёты:|Исходная сессия:|Предлагаемый следующий шаг|Оставшаяся работа:/);
      assert.ok(!text.includes(FORBIDDEN));
    }
  }
  for (const r of failures.slice(2)) assert.equal(r.cause.kind, 'identity-contract');
});

test('F4 auth, host refusal, unreachable, not-found and store codes classify actual cause; initial failure has no fallback', async () => {
  for (const [status, code, kind] of [[401, 'unauthorized', 'unreachable-auth'], [404, 'not-found', 'not-found'], ...['unavailable', 'corrupt', 'schema', 'busy', FORBIDDEN].map((c) => [503, c, 'store'])] as const) {
    const first = failure(await readDetail(host(() => reply({ error: code }, status as number)), SUMMARY_REQUEST));
    assert.equal(first.snapshot, null); assert.equal(first.cause.kind, kind);
    const later = failure(await readDetail(host((q) => q.query?.cursor ? reply({ error: code }, status as number) : reply(summaryPage(pagedSummaryItems()))), SUMMARY_REQUEST));
    assert.ok(later.snapshot); assert.equal(later.cause.kind, kind);
    assert.ok(!formatSummaryOnly(later.snapshot, later.cause).includes(FORBIDDEN));
  }
  for (const code of ['NOT_GRANTED', 'HOST_UNAVAILABLE', 'DISCONNECTED', 'UNKNOWN']) {
    const r = failure(await readDetail(host(() => { throw Object.assign(new Error(FORBIDDEN), { code }); }), SUMMARY_REQUEST));
    assert.equal(r.cause.kind, 'unreachable-auth'); assert.equal(r.snapshot, null);
  }
  const foreign = summaryPage(); foreign.plan.id = 'foreign';
  assert.equal(failure(await readDetail(host(() => reply(foreign)), SUMMARY_REQUEST)).snapshot, null);
});
