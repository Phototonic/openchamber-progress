import test from 'node:test';
import assert from 'node:assert/strict';
import { languageMessages, resolveLanguage, type LanguagePreference } from '../../ui/shared/i18n.ts';
import { LanguageController, type LanguageStorageValue } from '../../ui/shared/language.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Drain promise continuations, not elapsed time or a background timer.
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fixture(initial?: LanguageStorageValue) {
  let value = initial;
  const gets: { key: string; scope: string }[] = [];
  const sets: { key: string; value: LanguageStorageValue; scope: string }[] = [];
  let getHold: ReturnType<typeof deferred<LanguageStorageValue | undefined>> | undefined;
  let setHold: ReturnType<typeof deferred<void>> | undefined;
  let readFail = false, writeFail = false;
  const storage = {
    async get(key: string, options: { scope: 'device' }) {
      gets.push({ key, scope: options.scope });
      if (readFail) throw Error('private-storage-sentinel');
      const held = getHold; getHold = undefined;
      return held ? held.promise : value;
    },
    async set(key: string, next: LanguageStorageValue, options: { scope: 'device' }) {
      sets.push({ key, value: next, scope: options.scope });
      if (writeFail) throw Error('private-storage-sentinel');
      const held = setHold; setHold = undefined;
      if (held) await held.promise;
      value = structuredClone(next);
    },
  };
  let changes = 0;
  const frame = (changed?: () => void) => new LanguageController({ storage, changed: () => { changes++; changed?.(); } });
  return { frame, gets, sets, changes: () => changes, value: () => value,
    external: (next?: LanguageStorageValue) => { value = next; },
    failRead: (fail = true) => { readFail = fail; }, failWrite: (fail = true) => { writeFail = fail; },
    holdRead: () => getHold = deferred<LanguageStorageValue | undefined>(),
    holdWrite: () => setHold = deferred<void>(),
  };
}
const record = (preference: LanguagePreference): LanguageStorageValue => ({ v: 1, preference });

test('auto validates host tags; explicit languages override even malformed locales', () => {
  for (const locale of ['ru', 'ru-RU', 'RU-cyrl-RU', 'ru-UA', 'ru-u-nu-latn']) assert.equal(resolveLanguage('auto', locale), 'ru');
  for (const locale of ['', 'en', 'en-US', 'de-DE', 'ru_RU', 'ru-', 'not a tag', 'russian']) assert.equal(resolveLanguage('auto', locale), 'en');
  for (const preference of ['en', 'ru'] as const) for (const locale of ['ru-RU', 'en', 'invalid_locale']) assert.equal(resolveLanguage(preference, locale), preference);
  const keys = ['label', 'automatic', 'unsupported', 'readFailed', 'saveFailed', 'saving', 'saved'];
  for (const language of ['en', 'ru'] as const) {
    const messages = languageMessages(language);
    assert.deepEqual(Object.keys(messages).sort(), [...keys].sort());
    for (const text of Object.values(messages)) assert.equal(typeof text, 'string');
    assert(Object.isFrozen(messages));
  }
  assert.equal(languageMessages('en').label, 'Language');
  assert.equal(languageMessages('ru').label, 'Язык');
});

test('absent means auto without writes; only the strict immutable v1 shape is accepted', async () => {
  const invalid: LanguageStorageValue[] = [null, false, 1, 'ru', [], {}, { v: 2, preference: 'ru' }, { v: 1, preference: 'RU' }, { v: 1, preference: null }, { v: 1, preference: 'ru', extra: true }];
  for (const value of [undefined, ...invalid, Object.freeze({ v: 1, preference: 'en' }), record('auto'), record('ru')]) {
    const x = fixture(value), c = x.frame();
    c.ready('ru-RU', true); await settle();
    const valid = value !== undefined && !invalid.includes(value);
    assert.equal(c.snapshot().readError, value === undefined || valid ? null : 'readFailed');
    assert.equal(c.snapshot().preference, valid ? (value as { preference: string }).preference : 'auto');
    assert.equal(c.snapshot().language, valid && (value as { preference: string }).preference === 'en' ? 'en' : 'ru');
    assert.deepEqual(x.gets, [{ key: 'interface-language.v1', scope: 'device' }]);
    assert.equal(x.sets.length, 0);
  }
});

test('save/reopen, read and write failures preserve confirmation and expose only safe codes', async () => {
  const x = fixture(record('en')), c = x.frame();
  c.ready('ru', true); await settle();
  x.failRead(); c.refresh(); await settle();
  assert.equal(c.snapshot().preference, 'en'); assert.equal(c.snapshot().readError, 'readFailed');
  x.failWrite(); c.choose('ru'); await settle();
  assert.equal(c.snapshot().preference, 'en'); assert.equal(c.snapshot().writeError, 'saveFailed');
  assert.equal(c.snapshot().saveStatus, 'failed'); assert.equal(c.snapshot().readError, 'readFailed');
  assert(!JSON.stringify(c.snapshot()).includes('private-storage-sentinel'));
  x.failRead(false); c.refresh(); await settle();
  assert.equal(c.snapshot().readError, null); assert.equal(c.snapshot().writeError, 'saveFailed');
  x.failWrite(false); c.choose('ru'); await settle();
  assert.equal(c.snapshot().preference, 'ru'); assert.equal(c.snapshot().writeError, null); assert.equal(c.snapshot().saveStatus, 'saved');
  assert.equal(c.snapshot().confirmed, 'ru');
  assert.deepEqual(x.sets.at(-1), { key: 'interface-language.v1', value: record('ru'), scope: 'device' });
  const reopened = x.frame(); reopened.ready('en', true); await settle(); assert.equal(reopened.snapshot().language, 'ru');
  x.external(); c.refresh(); await settle(); assert.equal(c.snapshot().preference, 'auto'); assert.equal(c.snapshot().confirmed, null);
  c.ready('en', true); await settle(); assert.equal(c.snapshot().language, 'en');
  c.choose('auto'); await settle(); assert.deepEqual(x.value(), record('auto'));
});

test('first read failure retains auto; unsupported has zero requests and feature re-enable reads afresh', async () => {
  const x = fixture(record('en')), c = x.frame();
  c.ready('ru', false); c.refresh(); c.choose('en'); c.visible(); await settle();
  assert.equal(x.gets.length, 0); assert.equal(x.sets.length, 0); assert.equal(c.snapshot().language, 'ru');
  x.failRead(); c.ready('ru', true); await settle();
  assert.equal(c.snapshot().preference, 'auto'); assert.equal(c.snapshot().readError, 'readFailed');
  x.failRead(false); c.refresh(); await settle(); assert.equal(c.snapshot().language, 'en');
  c.ready('ru', false); assert.equal(c.snapshot().language, 'ru');
  const count = x.gets.length; x.external(record('ru')); c.ready('en', true); await settle();
  assert.equal(x.gets.length, count + 1); assert.equal(c.snapshot().language, 'ru');
});

test('one coalesced read and one pending write; a pre-choice read cannot undo a confirmed save', async () => {
  const x = fixture(record('en')), c = x.frame(), read = x.holdRead();
  c.ready('en', true); c.refresh(); c.visible(); c.refresh();
  assert.equal(x.gets.length, 1);
  const write = x.holdWrite(); c.choose('ru'); c.choose('en'); c.choose('ru'); c.refresh();
  assert.equal(x.sets.length, 1); assert.equal(c.snapshot().pending, true);
  assert.equal(c.snapshot().preference, 'auto'); assert.equal(c.snapshot().saveStatus, 'saving');
  write.resolve(); await settle(); assert.equal(c.snapshot().preference, 'ru');
  read.resolve(record('en')); await settle(); assert.equal(c.snapshot().preference, 'ru');
  x.external(record('en')); c.refresh(); await settle(); assert.equal(c.snapshot().preference, 'en');
});

test('competing frames converge by rereading the final atomic write; namespaces are independent', async () => {
  const shared = fixture(), separate = fixture(), a = shared.frame(), b = shared.frame(), other = separate.frame();
  for (const c of [a, b, other]) c.ready('en', true);
  await settle();
  const held = shared.holdWrite(); a.choose('ru'); b.choose('en'); await settle();
  held.resolve(); await settle();
  for (const c of [a, b, other]) c.refresh(); await settle();
  assert.equal(a.snapshot().language, 'ru'); assert.equal(b.snapshot().language, 'ru'); assert.equal(other.snapshot().language, 'en');
  assert.equal(separate.sets.length, 0);
});

test('hidden and disposed frames ignore held reads without painting or issuing hidden requests', async () => {
  for (const mode of ['hidden', 'dispose'] as const) {
    const x = fixture(record('en')), c = x.frame(), held = x.holdRead();
    c.ready('en', true); c[mode](); const changes = x.changes();
    c.refresh(); c.choose('ru'); held.resolve(record('ru')); await settle();
    assert.equal(x.changes(), changes); assert.equal(c.snapshot().language, 'en'); assert.equal(x.gets.length, 1); assert.equal(x.sets.length, 0);
    c.visible(); c.ready('en', true); await settle();
    assert.equal(x.gets.length, mode === 'hidden' ? 2 : 1);
  }
});

test('visible queues a fresh read behind an obsolete held read, never two simultaneous gets', async () => {
  const x = fixture(record('ru')), c = x.frame(), held = x.holdRead();
  c.ready('en', true); c.hidden(); c.visible(); c.refresh();
  assert.equal(x.gets.length, 1);
  held.resolve(record('en')); await settle();
  assert.equal(x.gets.length, 2); assert.equal(c.snapshot().language, 'ru');
});

test('sent writes cannot be revoked by hiding, but hidden completion cannot confirm or paint', async () => {
  for (const succeeds of [true, false]) for (const mode of ['hidden', 'dispose', 'feature-off'] as const) {
    const x = fixture(record('en')), c = x.frame(); c.ready('en', true); await settle();
    const held = x.holdWrite(); c.choose('ru');
    if (mode === 'feature-off') c.ready('en', false); else c[mode]();
    const changes = x.changes();
    if (succeeds) held.resolve(); else held.reject(Error('private-storage-sentinel'));
    await settle();
    assert.deepEqual(x.value(), record(succeeds ? 'ru' : 'en')); assert.equal(x.changes(), changes); assert.equal(c.snapshot().language, 'en');
    assert.equal(c.snapshot().pending, false); assert.equal(c.snapshot().writeError, null); assert.equal(c.snapshot().saveStatus, 'idle');
    if (mode === 'hidden') c.visible(); else c.ready('en', true);
    await settle(); assert.equal(c.snapshot().language, mode === 'dispose' || !succeeds ? 'en' : 'ru');
  }
});

for (const succeeds of [true, false]) test(`returning clears notified pending before reread after an obsolete write ${succeeds ? 'succeeds' : 'rejects'}`, async () => {
  for (const mode of ['hidden', 'feature-off'] as const) {
    const x = fixture(record('en'));
    const notifications: ReturnType<LanguageController['snapshot']>[] = [];
    const c = x.frame(() => notifications.push(c.snapshot()));
    c.ready('en', true); await settle();
    const write = x.holdWrite(); c.choose('ru');
    if (mode === 'hidden') { c.hidden(); c.visible(); }
    else { c.ready('en', false); c.ready('en', true); }
    c.refresh(); c.choose('auto');
    assert.equal(notifications.at(-1)?.pending, true);
    assert.equal(x.sets.length, 1); assert.equal(x.gets.length, 1);
    const read = x.holdRead();
    if (succeeds) write.resolve(); else write.reject(Error('private-storage-sentinel'));
    await settle();
    assert.equal(c.snapshot().pending, false);
    assert.equal(notifications.at(-1)?.pending, false, 'write completion must enable the visible control without waiting for get');
    assert.equal(notifications.at(-1)?.preference, mode === 'hidden' ? 'en' : 'auto');
    assert.equal(notifications.at(-1)?.writeError, null);
    assert.equal(notifications.at(-1)?.saveStatus, 'idle');
    assert.equal(x.gets.length, 2); assert.equal(x.sets.length, 1);
    c.refresh(); c.visible(); c.refresh();
    assert.equal(x.gets.length, 2);
    read.resolve(record(succeeds ? 'ru' : 'en')); await settle();
    assert.equal(notifications.at(-1)?.language, succeeds ? 'ru' : 'en');
    assert.equal(x.gets.length, 2);
  }
});

test('returning while a write is held keeps one set and reads the persisted result after completion', async () => {
  const x = fixture(record('en')), c = x.frame(); c.ready('en', true); await settle();
  const held = x.holdWrite(); c.choose('ru'); c.hidden(); c.visible(); c.choose('auto'); c.refresh();
  assert.equal(c.snapshot().pending, true); assert.equal(x.sets.length, 1); assert.equal(x.gets.length, 1);
  held.resolve(); await settle();
  assert.equal(c.snapshot().pending, false); assert.equal(c.snapshot().saveStatus, 'idle');
  assert.equal(c.snapshot().language, 'ru'); assert.equal(x.gets.length, 2);
});

test('feature off/on retires the old held read, and malformed rereads retain confirmation', async () => {
  const x = fixture(record('ru')), c = x.frame(), held = x.holdRead();
  c.ready('en', true); c.ready('en', false); c.ready('en', true);
  assert.equal(x.gets.length, 1); held.resolve(record('en')); await settle();
  assert.equal(c.snapshot().language, 'ru'); assert.equal(x.gets.length, 2);
  x.external({ v: 1, preference: 'en', extra: 'private-storage-sentinel' }); c.refresh(); await settle();
  assert.equal(c.snapshot().preference, 'ru'); assert.equal(c.snapshot().readError, 'readFailed'); assert.equal(x.sets.length, 0);
  const snapshot = c.snapshot(); assert(Object.isFrozen(snapshot)); assert(!JSON.stringify(snapshot).includes('private-storage-sentinel'));
});
