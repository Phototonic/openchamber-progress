import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupBody, parseCleanupReceipt, parseHealth, parsePlansPage, type CleanupRequest } from '../../ui/shared/adapter.ts';
import { cleanupEligible, cleanupMatches, cleanupTarget, cleanupError, cleanupFeedback } from '../../ui/shared/cleanup.ts';
import { cleanupCall, readList } from '../../ui/shared/source.ts';
import { RecentMemory } from '../../ui/shared/refresh.ts';
import { StatusSelection } from '../../ui/status/selection.ts';
import { HEALTH, plansPage, summary } from './fixtures.ts';
import { fieldHint, initialSetupUi, reviewVersions, setupErrorText, setupDiagnosticText, updateNotice, captureOffNote } from '../../ui/shared/setup.ts';
import { oldUpdateModule } from '../fixtures/pre-retirement-updates.ts';
const { officialMainText } = oldUpdateModule('official.ts');
import { parseSetup } from '../../ui/shared/adapter.ts';

const plan = parsePlansPage(JSON.stringify(plansPage([summary('finished', [], { lifecycle: 'finished' })]))).data[0];
const request: CleanupRequest = { storeId: 'store-fixture', source: plan.sourceId, plan: plan.id, rev: 2, cleanupRev: 3, oid: 'cleanup-example' };
test('cleanup feedback translates semantic outcomes and never echoes arbitrary service errors', () => {
  assert.match(cleanupError('conflict', 'ru'), /План изменился/);
  assert.match(cleanupError('private-error-sentinel', 'ru'), /не удалось подтвердить/);
  assert.doesNotMatch(cleanupError('private-error-sentinel', 'ru'), /sentinel/);
  const message = { kind: 'restore' } as const;
  assert.match(cleanupFeedback(message, 'en'), /still finished/);
  assert.match(cleanupFeedback(message, 'ru'), /завершённым/);
});
test('setup translates fixed explanations and version facts without changing entered paths or state', () => {
  const s=initialSetupUi();s.form.configRoot='/fixture/Review';s.edited.configRoot=true;
  assert.match(fieldHint('configRoot',s,undefined,'ru'),/Абсолютный путь/);
  assert.equal(s.form.configRoot,'/fixture/Review');assert.equal(s.edited.configRoot,true);
  assert.match(setupErrorText('store-permissions','ru'),/принадлежать вам/);
  assert.match(setupDiagnosticText('rollback-payloads-retained','ru'),/восстановления/);
  for(const locale of ['en','ru']) {
    assert.doesNotMatch(setupErrorText('private storage failure at /secret',locale),/private|secret/);
    assert.doesNotMatch(setupDiagnosticText('private storage failure at /secret',locale),/private|secret/);
    assert.equal(typeof setupErrorText('__proto__',locale),'string');
  }
  const result=parseSetup(JSON.stringify({configured:true,installed:true,separateLifecycle:true,activation:'reload-required',version:'1.2.3',diagnostics:[]}));
  const update={state:'available',candidateVersion:'1.2.4',rootVersion:null} as const;
  const snap={version:'1.2.3',update};
  const review={action:'update',targets:null,result} as const;
  const en=reviewVersions(review,snap,'en'), ru=reviewVersions(review,snap,'ru');
  assert.deepEqual(en.rows.map(r=>r[1]),ru.rows.map(r=>r[1]));
  assert.equal(ru.rows[0][0],'Установленная версия');
  assert.equal(updateNotice({...result,update},'ru')?.action,'Проверить обновление');
  assert.match(captureOffNote(null,'ru').text,/не записывается/);
});
test('official-main instructions and stale reasons are localized without a source or updater claim', () => {
  const notice={candidate:'1.2.4',installed:'1.2.3',stale:true,checkedAt:'2026-10-25T10:00:00Z',diagnostic:'timeout'} as const;
  const text=officialMainText(notice,'ru',Date.parse('2026-10-25T11:00:00Z'));
  assert.match(text.title,/1\.2\.4.*1\.2\.3/);assert.match(text.body,/превысила время ожидания/);
  assert.match(text.body,/не может определить источник/);assert.match(text.body,/ZIP/);
  assert.match(officialMainText(notice,'en').body,/timed out/);
});
test('cleanup capability and metadata are explicit and fail closed', () => {
  for (const planCleanup of [undefined, 0, true, '1', 2]) assert.equal(parseHealth(JSON.stringify({ ...HEALTH, planCleanup })).planCleanup, undefined);
  assert.equal(parseHealth(JSON.stringify({ ...HEALTH, planCleanup: 1 })).planCleanup, 1);
  for (const cleanup of [{ state: 'deleted', revision: 1 }, { state: 'archived', revision: -1 }, { state: 'visible', revision: 0.2 }, null]) {
    assert.throws(() => parsePlansPage(JSON.stringify(plansPage([{ ...summary('finished', [], { lifecycle: 'finished' }), cleanup } as never]))));
  }
});
test('cleanup bodies are bounded to the contract; only delete confirms', () => {
  assert.deepEqual(JSON.parse(cleanupBody({ ...request, privatePath: 'not allowed' } as CleanupRequest, 'archive')), request);
  assert.deepEqual(JSON.parse(cleanupBody(request, 'delete')), { ...request, confirmed: true });
  assert.deepEqual(JSON.parse(cleanupBody(request, 'restore')), request);
});
test('success receipt must bind key, store, oid, next generation and requested transition', () => {
  const receipt = { ...request, cleanup: { state: 'archived', revision: 4 } };
  assert.equal(parseCleanupReceipt(JSON.stringify(receipt), request, 'archive').state, 'archived');
  for (const patch of [{ storeId: 'other' }, { source: 'other' }, { plan: 'other' }, { oid: 'other' }, { cleanup: { state: 'visible', revision: 4 } }, { cleanup: { state: 'archived', revision: 3 } }]) assert.throws(() => parseCleanupReceipt(JSON.stringify({ ...receipt, ...patch }), request, 'archive'));
});
test('confirmation binds store, context, key, progress revision and cleanup generation; only finished is eligible', () => {
  const target = cleanupTarget(plan, 'store', 'context');
  assert.equal(cleanupMatches(target, plan, 'store', 'context'), true);
  for (const changed of [null, { ...plan, key: 'other' }, { ...plan, revision: plan.revision + 1 }, { ...plan, cleanup: { state: 'visible' as const, revision: 1 } }, { ...plan, lifecycle: 'active' as const }]) assert.equal(cleanupMatches(target, changed, 'store', 'context'), false);
  assert.equal(cleanupMatches(target, plan, 'other', 'context'), false);
  assert.equal(cleanupMatches(target, plan, 'store', 'other'), false);
  for (const lifecycle of ['active', 'cancelled', 'failed'] as const) for (const action of ['archive', 'restore', 'delete'] as const) assert.equal(cleanupEligible(action, { ...plan, lifecycle }), false);
  assert.equal(cleanupEligible('archive', plan), true);
  assert.equal(cleanupEligible('restore', plan), false);
  assert.equal(cleanupEligible('restore', { ...plan, cleanup: { state: 'archived', revision: 1 } }), true);
});
test('archive query is paged consistently; capability-less service never claims an empty archive', async () => {
  const calls: unknown[] = [];
  const old = await readList({ serviceRequest: async (q) => { calls.push(q); return { status: 200, body: JSON.stringify(HEALTH) }; } }, { archived: 'only' });
  assert.equal(old.ok && old.read, null); assert.equal(calls.length, 1);
  const queries: string[] = [];
  const result = await readList({ serviceRequest: async (q) => {
    if (q.path === '/health') return { status: 200, body: JSON.stringify({ ...HEALTH, planCleanup: 1 }) };
    queries.push(q.query?.archived ?? 'missing');
    return { status: 200, body: JSON.stringify({ ...plansPage([]), nextCursor: queries.length === 1 ? 'second' : null }) };
  } }, { archived: 'only' });
  assert.equal(result.ok, true); assert.deepEqual(queries, ['only', 'only']);
});
test('cleanup refuses conflicts and mismatched receipts without retrying', async () => {
  let count = 0;
  const result = await cleanupCall({ serviceRequest: async () => { count++; return { status: 409, body: '{"error":"conflict"}' }; } }, 'archive', request);
  assert.equal(result.ok, false); assert.equal(count, 1);
  const bad = await cleanupCall({ serviceRequest: async () => ({ status: 200, body: '{}' }) }, 'delete', request);
  assert.equal(bad.ok, false);
});
test('removed keys are evicted from all recent choices, not resurrected by another scope', () => {
  const memory = new RecentMemory<string>(); memory.set('M', plan.key); memory.set('U', plan.key); memory.set('other', 'keep');
  memory.deleteWhere((value) => value === plan.key);
  assert.equal(memory.get('M'), undefined); assert.equal(memory.get('U'), undefined); assert.equal(memory.get('other'), 'keep');
  const selection = new StatusSelection();
  selection.choose(selection.enter('store', 'M', null), plan.key);
  selection.choose(selection.enter('store', 'U', null), plan.key);
  selection.forget(new Set([plan.key])); selection.enter('store', 'M', null);
  assert.equal(selection.resolve({ kind: 'directory', directory: '/fixture', plans: [plan] }).selected, null);
});
