import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
import type { windowsSecurityQuery } from '../../shared/platform.ts';

const result = [{ owned:true, private:true, reparse:false, unsafeParent:false }];
const success = (): SpawnSyncReturns<string> => ({ pid:1, output:[], stdout:JSON.stringify(result), stderr:'', status:0, signal:null });
const timeout = (): SpawnSyncReturns<string> => ({ ...success(), status:null, error:Object.assign(new Error('synthetic timeout'), { code:'ETIMEDOUT' }) });

let moduleId = 0;
async function run(t: TestContext, attempts: SpawnSyncReturns<string>[]) {
  // Isolate process-lifetime state without exposing a product reset hook.
  const { windowsSecurityQuery, PlatformError, PlatformRequestBudget, withPlatformRequestBudget, platformSecurityScope } = await import(`../../shared/platform.ts?query-test=${moduleId++}`) as typeof import('../../shared/platform.ts');
  const previous = process.env.SystemRoot;
  process.env.SystemRoot = 'C:\\Windows';
  t.after(() => { if (previous === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = previous; });
  const calls: Parameters<NonNullable<Parameters<typeof windowsSecurityQuery>[2]>>[] = [];
  const query = () => windowsSecurityQuery(['C:\\Synthetic'], ['C:\\Synthetic'], (...args) => {
    calls.push(args);
    assert.ok(calls.length <= attempts.length, 'unexpected retry');
    return attempts[calls.length - 1]!;
  });
  return { query, calls, PlatformError, PlatformRequestBudget, withPlatformRequestBudget, platformSecurityScope };
}

test('step requests charge every actual attempt and refuse the seventh before spawning',async t=>{
  const {query,calls,PlatformRequestBudget,withPlatformRequestBudget}=await run(t,Array.from({length:6},success));
  const budget=new PlatformRequestBudget();
  withPlatformRequestBudget(budget,()=>{
    for(let i=0;i<6;i++)assert.deepEqual(query(),result);
    assert.throws(query,/managed-step-budget/);
  });
  assert.equal(calls.length,6);assert.equal(budget.securitySpawns,6);
  assert.ok(calls.every(c=>Number(c[2].timeout)>0&&Number(c[2].timeout)<=16000));
});

test('step cold timeout consumes one attempt and has no automatic retry',async t=>{
  const {query,calls,PlatformRequestBudget,withPlatformRequestBudget}=await run(t,[timeout()]);
  const budget=new PlatformRequestBudget();
  assert.throws(()=>withPlatformRequestBudget(budget,query),/managed-step-deadline/);
  assert.equal(calls.length,1);assert.equal(budget.securitySpawns,1);
});

test('budget reservation and settlement headroom refuse before a helper starts',async t=>{
  const {query,calls,PlatformRequestBudget,withPlatformRequestBudget}=await run(t,[]);
  const exhausted=new PlatformRequestBudget(process.hrtime.bigint()-17_000_000_000n);
  assert.throws(()=>withPlatformRequestBudget(exhausted,query),/managed-step-deadline/);
  const settling=new PlatformRequestBudget(process.hrtime.bigint()-16_500_000_000n);
  assert.throws(()=>withPlatformRequestBudget(settling,query),/managed-step-deadline/);
  const budget=new PlatformRequestBudget();
  assert.throws(()=>budget.require(7),/managed-step-budget/);
  assert.throws(()=>budget.require(0,18000),/managed-step-deadline/);
  assert.equal(calls.length,0);assert.equal(settling.securitySpawns,0);
});

test('a shared attempt counter cannot be reset by a new budget or nested scope',async t=>{
  const {query,calls,PlatformRequestBudget,withPlatformRequestBudget,platformSecurityScope}=await run(t,[success()]);
  const first=new PlatformRequestBudget(),second=new PlatformRequestBudget(first.startedAt,first.counter.buffer as SharedArrayBuffer);
  withPlatformRequestBudget(first,()=>{
    query();
    assert.throws(()=>withPlatformRequestBudget(second,query),/managed-step-conflict/);
  });
  assert.equal(second.securitySpawns,1);
  assert.throws(()=>platformSecurityScope(()=>withPlatformRequestBudget(second,query)),/managed-step-conflict/);
  assert.equal(calls.length,1);
});

test('failed process starts consume the request allowance without enabling retries',async t=>{
  const failure={...success(),error:Object.assign(new Error('synthetic'),{code:'ENOENT'})};
  const {query,calls,PlatformRequestBudget,withPlatformRequestBudget}=await run(t,[failure]);
  const budget=new PlatformRequestBudget();
  assert.throws(()=>withPlatformRequestBudget(budget,query),/windows-security-unavailable/);
  assert.equal(budget.securitySpawns,1);assert.equal(calls.length,1);
});

test('first security query retries a timeout once with identical inputs and a 30-second bound', async t => {
  const { query, calls, PlatformError } = await run(t, [timeout(), success(), timeout()]);
  assert.deepEqual(query(), result);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0]![2].timeout, 30000);
  assert.throws(query, (error: unknown) => error instanceof PlatformError && error.reason === 'timeout');
  assert.equal(calls.length, 3);
  assert.equal(calls[2]![2].timeout, 10000);
});

test('first security query fails closed after two timeouts and consumes the extended budget', async t => {
  const { query, calls, PlatformError } = await run(t, [timeout(), timeout(), timeout()]);
  assert.throws(query, (error: unknown) => error instanceof PlatformError && error.code === 'windows-security-unavailable' && error.reason === 'timeout');
  assert.equal(calls.length, 2);
  assert.throws(query, (error: unknown) => error instanceof PlatformError && error.reason === 'timeout');
  assert.equal(calls.length, 3);
  assert.equal(calls[2]![2].timeout, 10000);
});

test('successful first attempt consumes the extended budget without retry', async t => {
  const { query, calls, PlatformError } = await run(t, [success(), timeout()]);
  assert.deepEqual(query(), result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![2].timeout, 30000);
  assert.throws(query, (error: unknown) => error instanceof PlatformError && error.reason === 'timeout');
  assert.equal(calls.length, 2);
  assert.equal(calls[1]![2].timeout, 10000);
});

for (const [name, attempt, reason] of [
  ['non-zero exit', { ...success(), status:1 }, 'exit'],
  ['spawn error', { ...success(), error:Object.assign(new Error('synthetic spawn failure'), { code:'ENOENT' }) }, 'spawn'],
  ['malformed JSON', { ...success(), stdout:'not JSON' }, undefined],
  ['invalid security result', { ...success(), stdout:'[{"owned":true}]' }, undefined],
] as const) {
  test(`security query does not retry ${name} and consumes the extended budget`, async t => {
    const { query, calls, PlatformError } = await run(t, [attempt, timeout()]);
    assert.throws(query, (error: unknown) => error instanceof PlatformError && error.code === 'windows-security-unavailable' && error.reason === reason);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![2].timeout, 30000);
    assert.throws(query, (error: unknown) => error instanceof PlatformError && error.reason === 'timeout');
    assert.equal(calls.length, 2);
    assert.equal(calls[1]![2].timeout, 10000);
  });
}
