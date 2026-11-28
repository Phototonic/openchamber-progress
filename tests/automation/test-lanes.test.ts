import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as lanes from '../../scripts/test-lanes.ts';

// The runner is POSIX-first: its process groups and the catchable SIGINT, SIGHUP and SIGTERM these tests send
// do not exist on Windows, where ChildProcess.kill() cannot deliver them. The stop-command test below runs everywhere.
const posixOnly = { skip: process.platform === 'win32' && 'process groups and catchable signals are POSIX-only' };
const moduleUrl = JSON.stringify(pathToFileURL(resolve('scripts/test-lanes.ts')).href);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// The harness's own process group, found once: a recorded pid must never lead to a signal for it. If `ps` cannot
// run (no binary, no permission) the result has no stdout, and the group is simply unknown.
function lookupGroup(run: typeof spawnSync = spawnSync, platform: NodeJS.Platform = process.platform): number | undefined {
  if (platform === 'win32') return undefined;
  const group = Number(run('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' })?.stdout?.trim());
  return Number.isSafeInteger(group) && group > 1 ? group : undefined;
}
const ownGroup = lookupGroup();
/** A pid read back from a fixture file, or undefined for anything that is not a whole number above 1 that is
 * neither the harness, its parent nor its group: an empty file is Number('') === 0, which is the whole group. */
function safePid(text: string): number | undefined {
  if (!/^[0-9]+$/.test(text.trim())) return undefined;
  const pid = Number(text.trim());
  return Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid && pid !== process.ppid && pid !== ownGroup ? pid : undefined;
}
type Send = (pid: number, signal: NodeJS.Signals) => void;
type Command = (command: string, args: string[]) => void;
const runCommand: Command = (command, args) => { spawnSync(command, args, { stdio: 'ignore' }); };
/** Stop a fixture process and, on POSIX, the group it leads. With the harness's own group unknown no group signal is
 * sent at all, only one to the validated pid itself: it could otherwise be the harness's group. */
function killTree(pid: number | undefined, harness: { group: number | undefined } = { group: ownGroup }, send: Send = (target, signal) => { process.kill(target, signal); }, platform: NodeJS.Platform = process.platform, command: Command = runCommand) {
  if (pid === undefined || safePid(String(pid)) === undefined) return;
  if (platform === 'win32') { command('taskkill', ['/T', '/F', '/PID', String(pid)]); return; }
  if (harness.group !== undefined && pid !== harness.group) { try { send(-pid, 'SIGKILL'); } catch { /* not a group leader */ } }
  try { send(pid, 'SIGKILL'); } catch { /* gone */ }
}
const launched = new Set<ChildProcess>();
after(() => { for (const child of launched) if (child.pid) killTree(child.pid); });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(condition: () => boolean, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (condition()) return true; await sleep(25); }
  return condition();
}

/** One disposable folder holding a step program whose behaviour comes from its environment:
 * `ignore` ignores SIGTERM, `hang` runs for ever, `life=N` runs N ms, `code=N` exits with N,
 * `grandchild` starts a same-group child that ignores SIGTERM and hangs, `session=...` starts a
 * descendant in its own session (outside the step's group) that holds the step's pipes with the
 * given modes, `wait=NAME` waits for the harness to release a gate, `print` and `flood` write output.
 * Each process records its pid under ROOT. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'portable-lanes-'));
  writeFileSync(join(root, 'child.cjs'), `
const fs = require('node:fs'), cp = require('node:child_process');
const { once } = require('node:events'), { setTimeout: sleep } = require('node:timers/promises');
const { ROOT, NAME, MODE = '' } = process.env;
const modes = MODE.split(',');
const value = key => (modes.find(m => m.startsWith(key + '=')) ?? '').split('=').slice(1).join('=') || undefined;
const again = async (suffix, mode, options = {}) => {
  const name = NAME + '-' + suffix;
  const child = cp.spawn(process.execPath, [__filename], { env: { ...process.env, NAME: name, MODE: mode }, stdio: ['ignore', 'inherit', 'inherit'], ...options });
  await once(child, 'spawn');
  // Spawning the process does not mean Node has run the fixture. Wait until it publishes its PID
  // (and has installed any SIGTERM handler) so the leader cannot exit and start cleanup first.
  while (!fs.existsSync(ROOT + '/' + name + '.pid')) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(name + ' exited before publishing its PID');
    await sleep(25);
  }
};
async function main() {
  if (modes.includes('ignore')) process.on('SIGTERM', () => {});
  fs.writeFileSync(ROOT + '/' + NAME + '.pid.tmp', String(process.pid));
  fs.renameSync(ROOT + '/' + NAME + '.pid.tmp', ROOT + '/' + NAME + '.pid');
  const descendants = [];
  if (modes.includes('grandchild')) descendants.push(again('grandchild', 'ignore,hang'));
  if (value('session')) descendants.push(again('session', value('session').replaceAll('+', ','), { detached: true }));
  await Promise.all(descendants);
  if (modes.includes('print')) console.log('PRINTED-BY-' + NAME);
  if (modes.includes('flood')) console.log('x'.repeat(5000) + 'END');
  if (modes.includes('hang')) setInterval(() => {}, 1000);
  const gate = value('wait');
  while (gate && !fs.existsSync(ROOT + '/' + gate + '.gate')) await sleep(25);
  if (value('life')) setTimeout(() => process.exit(Number(value('code') ?? 0)), Number(value('life')));
  else if (!modes.includes('hang')) process.exit(Number(value('code') ?? 0));
}
main().catch(error => { console.error(error); process.exit(1); });
`);
  const step = (label: string, mode: string) =>
    `{label:${JSON.stringify(label)},command:process.execPath,args:[${JSON.stringify(join(root, 'child.cjs'))}],env:{ROOT:${JSON.stringify(root)},NAME:${JSON.stringify(label)},MODE:${JSON.stringify(mode)}}}`;
  const pid = (name: string) => (existsSync(join(root, name + '.pid')) ? safePid(readFileSync(join(root, name + '.pid'), 'utf8')) : undefined);
  const release = (name: string) => writeFileSync(join(root, name + '.gate'), '');
  // Every fixture process records its pid here: stop whatever a failed test left running, then delete the files.
  const dispose = () => {
    if (!existsSync(root)) return;
    for (const name of readdirSync(root)) if (name.endsWith('.pid')) killTree(safePid(readFileSync(join(root, name), 'utf8')));
    rmSync(root, { recursive: true, force: true });
  };
  return { root, step, pid, release, dispose };
}

function launch(script: string, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--experimental-strip-types', script], { env: { ...process.env, GITHUB_ACTIONS: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  launched.add(child);
  let out = '';
  child.stdout.on('data', c => { out += c; });
  child.stderr.on('data', c => { out += c; });
  const exited = new Promise<number | null>(done => child.on('close', code => done(code)));
  return { child, output: () => out, exited };
}

/** A runner script. `${steps}` is written as real code so each test lists its lanes plainly. */
function program(f: ReturnType<typeof fixture>, lanesCode: (s: (label: string, mode: string) => string) => string, options = '{}') {
  const file = join(f.root, 'run.ts');
  writeFileSync(file, `import * as lanes from ${moduleUrl};
try { await lanes.runLanes(${lanesCode(f.step)}, ${options}); console.log('RUN-OK'); }
catch (error) { console.log('REJECTED ' + (error as Error).message); process.exit((error as { exitCode?: number }).exitCode ?? 1); }`);
  return file;
}
const bounded = async <T>(promise: Promise<T>, ms: number) => Promise.race([promise, sleep(ms).then(() => 'hung' as const)]);

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
  test(`${signal} stops every step, keeps what they wrote and exits ${code}`, posixOnly, async () => {
    const f = fixture();
    try {
      const run = launch(program(f, s => `[{name:'a',steps:[${s('one', 'print,hang')}]},{name:'b',steps:[${s('two', 'print,hang')}]}]`));
      assert.ok(await until(() => f.pid('one') !== undefined && f.pid('two') !== undefined), 'both steps started');
      await sleep(300);
      const pids = [f.pid('one')!, f.pid('two')!];
      run.child.kill(signal);
      assert.equal(await bounded(run.exited, 15_000), code, run.output());
      assert.match(run.output(), new RegExp(`REJECTED Portable check interrupted by ${signal}`));
      assert.match(run.output(), /PRINTED-BY-one/); assert.match(run.output(), /PRINTED-BY-two/);
      assert.match(run.output(), /Interrupted before it ended/);
      for (const pid of pids) assert.ok(await until(() => !alive(pid), 5000), `step ${pid} outlives the runner`);
    } finally { f.dispose(); }
  });
}

test('a grandchild that ignores SIGTERM and a descendant that holds the pipes from its own session do not hold the runner', posixOnly, async () => {
  const f = fixture();
  let session: number | undefined;
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('one', 'ignore,hang,grandchild,session=hang')}]}]`, '{killAfterMs:1500}'));
    assert.ok(await until(() => ['one', 'one-grandchild', 'one-session'].every(n => f.pid(n) !== undefined)), 'processes started');
    await sleep(300);
    session = f.pid('one-session');
    const group = [f.pid('one')!, f.pid('one-grandchild')!];
    const started = Date.now();
    run.child.kill('SIGTERM');
    assert.equal(await bounded(run.exited, 15_000), 143, run.output());
    assert.ok(Date.now() - started < 12_000, 'bounded exit');
    for (const pid of group) assert.ok(await until(() => !alive(pid), 5000), `${pid} outlives the runner`);
  } finally { if (session && alive(session)) process.kill(session, 'SIGKILL'); f.dispose(); }
});

test('a leader that exits 0 leaving a same-group descendant on the pipes does not leave the descendant running when the runner returns', posixOnly, async () => {
  const f = fixture();
  try {
    // The leader exits once its grandchild (same group, ignores SIGTERM) is ready and holding the pipes.
    // The grace period abandons the pipes, and the step passes, but the group is still alive.
    const run = launch(program(f, s => `[{name:'a',steps:[${s('one', 'grandchild')}]}]`, '{graceMs:400,sweepMs:600}'));
    assert.ok(await until(() => f.pid('one-grandchild') !== undefined), 'the grandchild is ready');
    const descendant = f.pid('one-grandchild')!;
    assert.equal(await bounded(run.exited, 15_000), 0, run.output());
    assert.match(run.output(), /^passed a: one/m);
    assert.ok(await until(() => !alive(descendant), 3000), 'the descendant outlives a passing run');
  } finally { f.dispose(); }
});

test('an interrupt during the grace period, which ends before the kill timer, still stops the descendant of a leader that already exited', posixOnly, async () => {
  const f = fixture();
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('one', 'grandchild')}]}]`, '{graceMs:1500,killAfterMs:30000,sweepMs:600}'));
    assert.ok(await until(() => f.pid('one-grandchild') !== undefined), 'the grandchild is ready');
    const descendant = f.pid('one-grandchild')!;
    const leader = f.pid('one')!;
    assert.ok(await until(() => !alive(leader)), 'the leader exited');
    assert.ok(alive(descendant), 'the grace period is still running');
    run.child.kill('SIGTERM');
    assert.equal(await bounded(run.exited, 15_000), 143, run.output());
    assert.ok(await until(() => !alive(descendant), 3000), 'the descendant outlives the interrupted run');
  } finally { f.dispose(); }
});

test('a repeated SIGINT is not swallowed: it kills steps that ignore the first one', posixOnly, async () => {
  const f = fixture();
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('one', 'ignore,hang,grandchild')}]}]`, '{killAfterMs:60000}'));
    assert.ok(await until(() => f.pid('one') !== undefined && f.pid('one-grandchild') !== undefined));
    await sleep(300);
    const pids = [f.pid('one')!, f.pid('one-grandchild')!];
    run.child.kill('SIGINT');
    await sleep(400);
    assert.ok(alive(pids[0]), 'the first signal alone does not stop a step that ignores it');
    run.child.kill('SIGINT');
    assert.equal(await bounded(run.exited, 10_000), 130, run.output());
    for (const pid of pids) assert.ok(await until(() => !alive(pid), 5000), `${pid} outlives the runner`);
  } finally { f.dispose(); }
});

test('a closed output pipe stops the steps instead of orphaning them', posixOnly, async () => {
  const f = fixture();
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('one', 'ignore,hang')}]}]`, '{heartbeatMs:100,killAfterMs:1000}'));
    assert.ok(await until(() => f.pid('one') !== undefined));
    const pid = f.pid('one')!;
    run.child.stdout!.destroy();
    assert.notEqual(await bounded(run.exited, 15_000), 'hung', 'the runner exits');
    assert.ok(await until(() => !alive(pid), 5000), 'the step outlives the runner');
  } finally { f.dispose(); }
});

test('a crash of the runner still kills every group it started', posixOnly, async () => {
  const f = fixture();
  try {
    const file = join(f.root, 'crash.ts');
    writeFileSync(file, `import {runLanes} from ${moduleUrl};
const pending = runLanes([{name:'a',steps:[${f.step('one', 'ignore,hang')}]}]).catch(() => {});
setTimeout(() => { throw new Error('boom'); }, 600);
await pending;`);
    const run = launch(file);
    assert.ok(await until(() => f.pid('one') !== undefined));
    const pid = f.pid('one')!;
    assert.notEqual(await bounded(run.exited, 15_000), 0);
    assert.ok(await until(() => !alive(pid), 5000), 'the step outlives the crashed runner');
  } finally { f.dispose(); }
});

test('a step that cannot start is reported once', async () => {
  const f = fixture();
  try {
    const run = launch(program(f, () => `[{name:'a',steps:[{label:'missing',command:'definitely-not-a-command-xyz',args:[]}]}]`));
    assert.equal(await bounded(run.exited, 15_000), 1, run.output());
    const rows = run.output().split('\n').filter(l => /^(passed|failed|stopped) a: missing/.test(l));
    assert.equal(rows.length, 1, run.output());
    assert.match(rows[0], /^failed/);
    assert.equal(run.output().split('\n').filter(l => /^\s+(passed|failed|stopped)\s+[\d.]+s\s+a: missing/.test(l)).length, 1);
    assert.match(run.output(), /Could not start/);
  } finally { f.dispose(); }
});

test('a step that fails on its own after the first failure is a failure with its output, not a stopped step', async () => {
  const f = fixture();
  try {
    // "early" exits with 4 before "first", but its detached descendant holds its pipes
    // until "first" fails. The runner never stopped the "early" leader.
    const run = launch(program(f, s => `[{name:'a',steps:[${s('first', 'wait=first,code=3')}]},{name:'b',steps:[${s('early', 'print,code=4,session=wait=session')}]}]`));
    assert.ok(await until(() => f.pid('early') !== undefined && !alive(f.pid('early')!)), 'early exited on its own');
    f.release('first');
    assert.ok(await until(() => /^failed a: first/m.test(run.output())), run.output());
    f.release('session');
    assert.equal(await bounded(run.exited, 15_000), 1, run.output());
    assert.match(run.output(), /^failed a: first/m);
    assert.match(run.output(), /^failed b: early/m);
    assert.match(run.output(), /PRINTED-BY-early/);
    assert.match(run.output(), /^\s+failed\s+[\d.]+s\s+b: early/m);
  } finally { f.dispose(); }
});

test('a step the runner stopped is "stopped" and prints nothing, even if it exits non-zero in reply', async () => {
  const f = fixture();
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('first', 'life=500,code=3')}]},{name:'b',steps:[${s('victim', 'print,hang')}]}]`));
    assert.equal(await bounded(run.exited, 15_000), 1, run.output());
    assert.match(run.output(), /^failed a: first/m);
    assert.match(run.output(), /^stopped b: victim/m);
    assert.doesNotMatch(run.output(), /PRINTED-BY-victim/);
  } finally { f.dispose(); }
});

test('the runner names the steps still running about every heartbeat', async () => {
  const f = fixture();
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('slow', 'life=900')}]}]`, '{heartbeatMs:150}'));
    assert.equal(await bounded(run.exited, 15_000), 0, run.output());
    assert.match(run.output(), /still running: a: slow \(\d+\.\ds\)/);
  } finally { f.dispose(); }
});

test('a step keeps only the tail of its output and says what was dropped', async () => {
  const f = fixture();
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('noisy', 'flood,code=1')}]}]`, '{maxOutputBytes:1000}'));
    assert.equal(await bounded(run.exited, 15_000), 1, run.output());
    assert.match(run.output(), /\[\d+ bytes of earlier output dropped\]/);
    assert.match(run.output(), /xEND/);
    assert.ok((run.output().match(/x/g) ?? []).length < 1500, 'the dropped bytes are not printed');
  } finally { f.dispose(); }
});

test('a pass whose leftover process holds the pipes is abandoned after the grace period, not waited for', posixOnly, async () => {
  const f = fixture();
  let session: number | undefined;
  try {
    const run = launch(program(f, s => `[{name:'a',steps:[${s('one', 'print,session=hang')}]}]`, '{graceMs:500}'));
    assert.ok(await until(() => f.pid('one-session') !== undefined));
    session = f.pid('one-session');
    assert.equal(await bounded(run.exited, 10_000), 0, run.output());
    assert.match(run.output(), /^passed a: one/m);
    assert.match(run.output(), /held its output open/);
  } finally { if (session && alive(session)) process.kill(session, 'SIGKILL'); f.dispose(); }
});

test('a failed lookup of the harness group leaves it unknown, the module still loads, and cleanup then sends no group signal', () => {
  const failed = (() => ({ pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null, error: Object.assign(new Error('spawn ps ENOENT'), { code: 'ENOENT' }) })) as unknown as typeof spawnSync;
  assert.equal(lookupGroup(failed, 'linux'), undefined);
  assert.equal(lookupGroup((() => undefined) as unknown as typeof spawnSync, 'linux'), undefined);
  assert.equal(lookupGroup((() => ({ stdout: '' })) as unknown as typeof spawnSync, 'linux'), undefined, 'an empty answer is not group 0');
  assert.equal(lookupGroup((() => ({ stdout: ' 4321\n' })) as unknown as typeof spawnSync, 'linux'), 4321);
  assert.equal(lookupGroup(failed, 'win32'), undefined);
  // Every call below names its platform and injects both the signal and the command: none can reach a real kill or taskkill.
  const noCommand: Command = (name) => { assert.fail(`${name} must not run on this platform`); };
  const noSignal: Send = () => { assert.fail('no signal may be sent on this platform'); };
  const sent: number[] = [];
  killTree(4242, { group: undefined }, pid => { sent.push(pid); }, 'linux', noCommand);
  assert.deepEqual(sent, [4242], 'only the validated pid itself, never -4242');
  killTree(0, { group: undefined }, pid => { sent.push(pid); }, 'linux', noCommand); killTree(process.pid, { group: undefined }, pid => { sent.push(pid); }, 'linux', noCommand);
  assert.deepEqual(sent, [4242], 'an unsafe pid is not signalled at all');
  const known: number[] = [];
  killTree(4242, { group: 777 }, pid => { known.push(pid); }, 'linux', noCommand);
  assert.deepEqual(known, [-4242, 4242], 'with the group known a leader is stopped as a group too');
  killTree(777, { group: 777 }, pid => { known.push(pid); }, 'linux', noCommand);
  assert.deepEqual(known, [-4242, 4242, 777], 'but never the harness group itself');
  const commands: [string, string[]][] = [];
  killTree(4242, { group: 777 }, noSignal, 'win32', (name, args) => { commands.push([name, args]); });
  assert.deepEqual(commands, [['taskkill', ['/T', '/F', '/PID', '4242']]], 'on Windows a safe pid goes to taskkill, through the injected runner only');
  killTree(0, { group: undefined }, noSignal, 'win32', (name, args) => { commands.push([name, args]); });
  assert.equal(commands.length, 1, 'and an unsafe pid to nothing');
});

test('an empty or garbage pid file is ignored by the fixture cleanup and the harness survives', async () => {
  const f = fixture();
  const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    for (const [name, text] of Object.entries({ empty: '', blank: ' \n', zero: '0', init: '1', word: 'abc', negative: '-5', fraction: '2.5', harness: String(process.pid), parent: String(process.ppid) }))
      writeFileSync(join(f.root, `${name}.pid`), text);
    writeFileSync(join(f.root, 'real.pid'), String(sleeper.pid));
    for (const text of ['', ' ', '0', '1', 'abc', '-5', '2.5', String(process.pid), String(process.ppid)]) assert.equal(safePid(text), undefined, JSON.stringify(text));
    assert.equal(f.pid('empty'), undefined, 'a half-written file is not pid 0');
    f.dispose();
    assert.ok(await until(() => !alive(sleeper.pid!), 5000), 'the recorded fixture process is stopped');
    assert.ok(alive(process.pid), 'the harness is still here');
    assert.ok(alive(process.ppid), 'so is its parent');
  } finally { killTree(sleeper.pid); f.dispose(); }
});

test('the runner signals only a whole number above 1 that is not itself or its parent, and Windows stops only a child that has not exited', () => {
  for (const bad of [0, 1, -1, -3, 1.5, NaN, Infinity, '12', null, undefined, process.pid, process.ppid]) assert.equal(lanes.validPid(bad), false, String(bad));
  assert.equal(lanes.validPid(4242), true);
  assert.equal(lanes.stopAction('win32', true, 4242, false), undefined, 'an exited PID may belong to someone else now');
  assert.deepEqual(lanes.stopAction('win32', false, 4242, true), { kind: 'command', command: 'taskkill', args: ['/T', '/F', '/PID', '4242'] });
  assert.deepEqual(lanes.stopAction('linux', true, 4242, false), { kind: 'group', group: -4242, signal: 'SIGTERM' }, 'POSIX groups are probed before any signal, not skipped here');
  assert.equal(lanes.stopAction('linux', false, 0, false), undefined);
  assert.equal(lanes.stopAction('win32', false, process.pid, true), undefined);
});

test('a group is retired as soon as its step is swept and nothing is sent to it afterwards, even if its id is reused', posixOnly, async () => {
  const f = fixture();
  try {
    const file = join(f.root, 'retire.ts');
    writeFileSync(file, `import * as lanes from ${moduleUrl};
const calls: string[] = [];
const retired = new Set<number>();
// Once a group answered ESRCH it is retired; any later call to that id stands for an unrelated process that reused it.
const kill = (pid: number, signal: NodeJS.Signals | 0) => {
  const group = Math.abs(pid);
  if (retired.has(group)) { calls.push(group + ' AFTER-RETIRED ' + signal); return; }
  try { process.kill(pid, signal); calls.push(group + ' ' + signal + ' ok'); }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; calls.push(group + ' ' + signal + ' ' + code); if (code === 'ESRCH') retired.add(group); throw error; }
};
await lanes.runLanes([{name:'a',steps:[${f.step('one', 'code=0')},${f.step('two', 'grandchild')}]}], {graceMs:300,sweepMs:800,kill});
console.log('CALLS ' + JSON.stringify(calls));`);
    const run = launch(file);
    assert.equal(await bounded(run.exited, 20_000), 0, run.output());
    const calls: string[] = JSON.parse(/CALLS (.*)/.exec(run.output())?.[1] ?? '[]');
    const one = f.pid('one')!, two = f.pid('two')!;
    const of = (group: number) => calls.filter(c => c.startsWith(group + ' '));
    assert.ok(calls.length > 0, 'the runner reports its probes and signals through the injected function');
    assert.equal(calls.filter(c => c.includes('AFTER-RETIRED')).length, 0, calls.join('; '));
    assert.deepEqual(of(one), [`${one} 0 ESRCH`], 'an empty group is probed once and retired without a signal');
    assert.ok(of(two).some(c => c.endsWith('SIGTERM ok')) && of(two).some(c => c.endsWith('SIGKILL ok')), 'a stubborn descendant gets TERM then KILL');
    assert.equal(of(two).at(-1), `${two} 0 ESRCH`, 'and the group is confirmed empty');
    assert.ok(calls.findIndex(c => c.startsWith(two + ' ')) > calls.findIndex(c => c.startsWith(one + ' ')) , 'the first step is swept before the next one starts');
    for (const c of calls) assert.ok(Number(c.split(' ')[0]) > 1, c);
  } finally { f.dispose(); }
});

test('steps are stopped with a process group on POSIX and with taskkill /T /F on Windows, and only POSIX detaches them', () => {
  assert.deepEqual(lanes.stopPlan('linux', 4242, false), { kind: 'group', group: -4242, signal: 'SIGTERM' });
  assert.deepEqual(lanes.stopPlan('darwin', 4242, true), { kind: 'group', group: -4242, signal: 'SIGKILL' });
  for (const force of [false, true]) assert.deepEqual(lanes.stopPlan('win32', 4242, force), { kind: 'command', command: 'taskkill', args: ['/T', '/F', '/PID', '4242'] });
  assert.equal(lanes.detachesSteps('linux'), true);
  assert.equal(lanes.detachesSteps('darwin'), true);
  assert.equal(lanes.detachesSteps('win32'), false);
});

test('lane runner starts a yielding step at lower priority and an ordinary one at the usual priority', posixOnly, async () => {
  const f = fixture();
  try {
    const file = join(f.root, 'priority.ts');
    writeFileSync(file, `import {runLanes} from ${moduleUrl};
const show=(label:string,lowPriority?:boolean)=>({label,command:process.execPath,args:['-e',"console.log('PRIORITY '+require('node:os').getPriority())"],lowPriority});
await runLanes([{name:'a',steps:[show('usual')]},{name:'b',steps:[show('yielding',true)]}]);`);
    const run = launch(file);
    assert.equal(await bounded(run.exited, 20_000), 0, run.output());
    const seen = (label: string) => Number(new RegExp(`=== ${label} ===\\nPRIORITY (-?\\d+)`).exec(run.output())?.[1]);
    assert.ok(seen('b: yielding') > seen('a: usual'), 'the yielding step has the larger niceness');
  } finally { f.dispose(); }
});

test('lane runner stops every lane at the first failure and reports it without interleaving', async () => {
  const f = fixture();
  try {
    const file = join(f.root, 'first-failure.ts');
    writeFileSync(file, `import {runLanes} from ${moduleUrl};
const node=(label:string,code:string)=>({label,command:process.execPath,args:['-e',code]});
try{await runLanes([
  {name:'slow',steps:[node('hangs',"setTimeout(()=>{},60000)"),node('never starts',"console.log('LATE-STEP')")]},
  {name:'fails',steps:[node('breaks',"console.log('FAIL-OUTPUT');process.exit(3)")]},
  {name:'ok',steps:[node('passes',"console.log('PASS-OUTPUT')"),node('skipped after failure',"setTimeout(()=>console.log('LATE-STEP'),5000)")]},
]);}catch(error){console.log('REJECTED '+(error as Error).message);process.exit(1);}`);
    const started = performance.now();
    const run = launch(file);
    assert.equal(await bounded(run.exited, 20_000), 1);
    assert.ok(performance.now() - started < 15_000, 'the hanging lane is stopped, not waited for');
    assert.match(run.output(), /FAIL-OUTPUT/); assert.match(run.output(), /Exited with code 3/); assert.match(run.output(), /REJECTED Portable check failed/);
    assert.doesNotMatch(run.output(), /LATE-STEP/);
    assert.match(run.output(), /stopped\s+[\d.]+s\s+slow: hangs/);
    assert.match(run.output(), /failed\s+[\d.]+s\s+fails: breaks/);
  } finally { f.dispose(); }
});
