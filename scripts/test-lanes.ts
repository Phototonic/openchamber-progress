/** Runs independent groups of checks side by side. A lane is an ordered list of
 * steps that stop at the first failure; lanes share nothing but the checkout.
 * Output is captured per step and written whole when the step ends, so lines
 * from different lanes never interleave.
 *
 * POSIX first. Each step runs in its own process group, so a signal to this
 * process would not reach it; the runner therefore stops every step itself, on the
 * first failure and on SIGINT, SIGTERM, SIGHUP or a closed output pipe, and a step
 * left running would keep holding the Setup ports the next run needs. A repeated
 * signal, or a step that ignores the first one for too long, is killed outright
 * and abandoned even if its output pipes are still held open; every group the
 * runner started is swept as soon as its leader has exited and its pipes have
 * closed, passing or not, since a leader that exits 0 can leave descendants
 * holding ports. A group is retired the moment a probe finds it empty and never
 * signalled afterwards (its id may then belong to someone else); every signal is
 * preceded by a probe, and the exit hook and closing sweep touch only groups not
 * yet confirmed empty. On Windows steps are not detached and are stopped with
 * `taskkill /T /F`; that path is untested on Windows. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

/** `lowPriority` runs the step under `nice`, so a lane that must keep its timing
 * headroom wins the cores when the machine is short of them. */
export type Step = { label: string; command: string; args: string[]; lowPriority?: boolean; env?: Record<string, string> };
export type Lane = { name: string; steps: Step[] };
export type StepResult = { lane: string; label: string; seconds: number; status: 'passed' | 'failed' | 'stopped' };
export type RunOptions = {
  /** How often to name the steps still running. */
  heartbeatMs?: number;
  /** How long a step may take to stop before it is killed and abandoned. */
  killAfterMs?: number;
  /** How long a step that has exited may keep its output pipes open. */
  graceMs?: number;
  /** The most output kept per step; the earliest is dropped first. */
  maxOutputBytes?: number;
  /** How long a group sweep waits for the group to leave after SIGTERM, and again after SIGKILL. */
  sweepMs?: number;
  /** Replaces process.kill for every probe and signal sent to a process group; for tests. */
  kill?: Kill;
};

export type Kill = (pid: number, signal: NodeJS.Signals | 0) => void;

const SIGNAL_NUMBER: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGPIPE: 13, SIGTERM: 15 };

/** `exitCode` is 1 for a failed run and 128 plus the signal number for an interrupted one. */
export class LanesError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) { super(message); this.exitCode = exitCode; }
}

export type StopPlan =
  | { kind: 'group'; group: number; signal: 'SIGTERM' | 'SIGKILL' }
  | { kind: 'command'; command: string; args: string[] };

/** How to stop a step and everything it started on a platform. */
export function stopPlan(platform: NodeJS.Platform, pid: number, force: boolean): StopPlan {
  if (platform === 'win32') return { kind: 'command', command: 'taskkill', args: ['/T', '/F', '/PID', String(pid)] };
  return { kind: 'group', group: -pid, signal: force ? 'SIGKILL' : 'SIGTERM' };
}

/** Steps get their own process group everywhere but Windows, which has none to use. */
export const detachesSteps = (platform: NodeJS.Platform) => platform !== 'win32';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A pid or group id the runner may signal: a whole number above 1 that is neither this process nor its
 * parent. Zero would be this process's own group, a negative number another group, and 1 is init. */
export function validPid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 1 && pid !== process.pid && pid !== process.ppid;
}

/** What to run to stop a step, if anything. On Windows `taskkill /T /F` goes only to a child whose `exit` has
 * not fired: its PID may have been reused since. On POSIX a group is signalled only after a fresh probe. */
export function stopAction(platform: NodeJS.Platform, exited: boolean, pid: number, force: boolean): StopPlan | undefined {
  if (!validPid(pid)) return undefined;
  if (platform === 'win32' && exited) return undefined;
  return stopPlan(platform, pid, force);
}

/** The last `max` bytes written, with a note of what was dropped. */
class Tail {
  private chunks: Buffer[] = [];
  private size = 0;
  private dropped = 0;
  private readonly max: number;
  constructor(max: number) { this.max = max; }
  push(chunk: Buffer) {
    this.chunks.push(chunk); this.size += chunk.length;
    while (this.size > this.max && this.chunks.length > 1) {
      const first = this.chunks.shift()!; this.size -= first.length; this.dropped += first.length;
    }
    if (this.size > this.max) {
      const cut = this.size - this.max;
      this.chunks[0] = this.chunks[0].subarray(cut); this.size -= cut; this.dropped += cut;
    }
  }
  text() {
    const text = Buffer.concat(this.chunks).toString('utf8');
    return this.dropped ? `[${this.dropped} bytes of earlier output dropped]\n${text}` : text;
  }
}

const github = process.env.GITHUB_ACTIONS === 'true';
const stamp = (seconds: number) => `${seconds.toFixed(1)}s`;

function print(label: string, text: string, ok: boolean) {
  // One write per block keeps another lane's output out of the middle of it.
  const body = text.endsWith('\n') || text === '' ? text : `${text}\n`;
  process.stdout.write(github ? `::group::${label}\n${body}::endgroup::\n` : `\n=== ${label} ${ok ? '' : '(failed) '}===\n${body}`);
}

type Live = { label: string; started: number; child: ChildProcess; exited: boolean; signalled: boolean; printed: boolean; dump: () => void; force: (note: string) => void };

export async function runLanes(lanes: Lane[], options: RunOptions = {}): Promise<StepResult[]> {
  const { heartbeatMs = 60_000, killAfterMs = 10_000, graceMs = 3_000, maxOutputBytes = 2 * 1024 * 1024, sweepMs = 2_000 } = options;
  const kill: Kill = options.kill ?? ((pid, signal) => { process.kill(pid, signal); });
  const results: StepResult[] = [];
  // Groups not yet known to be empty. A group leaves as soon as a probe finds it empty, because its id may
  // then be reused by an unrelated process; nothing is ever signalled once it has left.
  const groups = new Set<number>();
  const live = new Map<number, Live>();
  let failed = false;
  let interrupted: { signal: string; code: number } | undefined;
  let killTimer: NodeJS.Timeout | undefined;

  const groupAlive = (group: number) => {
    try { kill(-group, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  };
  /** Signal a recorded group, probing it first; an empty group is retired instead. */
  const signalGroup = (group: number, signal: 'SIGTERM' | 'SIGKILL') => {
    if (!groups.has(group) || !validPid(group)) return;
    if (!groupAlive(group)) { groups.delete(group); return; }
    try { kill(-group, signal); } catch { /* gone between probe and signal */ }
  };
  const stopStep = (pid: number, step: Live, force: boolean) => {
    const plan = stopAction(process.platform, step.exited, pid, force);
    if (plan?.kind === 'group') signalGroup(pid, plan.signal);
    else if (plan?.kind === 'command') spawnSync(plan.command, plan.args, { stdio: 'ignore', windowsHide: true });
  };
  /** TERM, a short bound, KILL, a short bound; retire the group once it is confirmed empty. */
  const sweepGroup = async (group: number) => {
    signalGroup(group, 'SIGTERM');
    for (const end = Date.now() + sweepMs; groups.has(group) && Date.now() < end;) { if (groupAlive(group)) await sleep(25); else groups.delete(group); }
    signalGroup(group, 'SIGKILL');
    for (const end = Date.now() + sweepMs; groups.has(group) && Date.now() < end;) { if (groupAlive(group)) await sleep(25); else groups.delete(group); }
  };
  const escalate = () => {
    clearTimeout(killTimer); killTimer = undefined;
    for (const [pid, step] of live) { step.signalled = true; stopStep(pid, step, true); }
    for (const step of [...live.values()]) step.force('Did not stop in time; killed and abandoned.\n');
  };
  const beginStop = () => {
    for (const [pid, step] of live) {
      // A leader that has exited on its own is not ours to call stopped, but its group may still be running.
      if (!step.exited && step.child.exitCode === null && step.child.signalCode === null) step.signalled = true;
      stopStep(pid, step, false);
    }
    // Not unref'd: steps are still running, and the run must outlast them.
    killTimer ??= setTimeout(escalate, killAfterMs);
  };
  const onSignal = (signal: string) => {
    if (interrupted) { escalate(); return; }
    interrupted = { signal, code: 128 + (SIGNAL_NUMBER[signal] ?? 0) }; failed = true;
    for (const step of live.values()) step.dump();
    beginStop();
  };
  const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal => [signal, () => onSignal(signal)] as const);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  // `test:all | head` closes our output: stop rather than die with groups running.
  const onStdoutError = (error: NodeJS.ErrnoException) => { if (error.code === 'EPIPE') onSignal('SIGPIPE'); };
  process.stdout.on('error', onStdoutError);
  // A crash or process.exit must not orphan a group either.
  const onExit = () => {
    for (const pid of [...groups]) signalGroup(pid, 'SIGKILL');
    for (const [pid, step] of live) stopStep(pid, step, true);
  };
  process.on('exit', onExit);
  const heartbeat = setInterval(() => {
    const names = [...live.values()].map(step => `${step.label} (${stamp((performance.now() - step.started) / 1000)})`);
    if (names.length) console.log(`still running: ${names.join('; ')}`);
  }, heartbeatMs);

  const runStep = (lane: Lane, step: Step) => new Promise<boolean>(resolve => {
    const started = performance.now();
    const label = `${lane.name}: ${step.label}`;
    console.log(`start  ${label}`);
    const tail = new Tail(maxOutputBytes);
    const niced = step.lowPriority && process.platform !== 'win32';
    const child = spawn(niced ? 'nice' : step.command, niced ? ['-n', '10', step.command, ...step.args] : step.args, {
      stdio: ['ignore', 'pipe', 'pipe'], detached: detachesSteps(process.platform), windowsHide: true, env: { ...process.env, ...step.env },
    });
    const pid = child.pid;
    let settled = false;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let grace: NodeJS.Timeout | undefined;
    const entry: Live = {
      label, started, child, exited: false, signalled: false, printed: false,
      dump: () => { entry.printed = true; print(label, `${tail.text()}Interrupted before it ended.\n`, false); },
      force: note => { child.stdout?.destroy(); child.stderr?.destroy(); finish(exit?.code === 0, note); },
    };
    if (pid) { live.set(pid, entry); if (detachesSteps(process.platform)) groups.add(pid); }
    child.stdout?.on('data', chunk => tail.push(chunk));
    child.stderr?.on('data', chunk => tail.push(chunk));
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    // ENOENT emits error and then close; the first word wins.
    const finish = (ok: boolean, note = '') => {
      if (settled) return;
      settled = true; clearTimeout(grace);
      if (pid) {
        live.delete(pid);
        if (!live.size) { clearTimeout(killTimer); killTimer = undefined; }
      }
      const seconds = (performance.now() - started) / 1000;
      // Only a step the runner stopped is "stopped"; one that fails on its own is a failure, whenever.
      const status = ok ? 'passed' : entry.signalled ? 'stopped' : 'failed';
      if (status === 'failed' && !failed) { failed = true; beginStop(); }
      if ((status === 'passed' || status === 'failed') && !entry.printed) print(label, tail.text() + note, ok);
      console.log(`${status} ${label} (${stamp(seconds)})`);
      results.push({ lane: lane.name, label: step.label, seconds, status });
      // Sweep the group now that its leader is gone and the pipes are closed, so a descendant (and a Setup
      // port it holds) cannot outlive the step, and the group id is retired while it is still ours.
      void (pid ? sweepGroup(pid) : Promise.resolve()).then(() => resolve(ok));
    };
    child.on('error', error => finish(false, `Could not start: ${error.message}\n`));
    child.on('exit', (code, signal) => {
      exit = { code, signal }; entry.exited = true;
      // A leftover process holding our pipes must not keep the step open for ever.
      grace = setTimeout(() => entry.force('A leftover process held its output open; abandoned.\n'), graceMs);
    });
    child.on('close', (code, signal) => finish(code === 0, code === 0 ? '' : `Exited with ${signal ?? `code ${code}`}\n`));
  });

  try {
    await Promise.all(lanes.map(async lane => {
      for (const step of lane.steps) {
        if (failed) { results.push({ lane: lane.name, label: step.label, seconds: 0, status: 'stopped' }); continue; }
        if (!await runStep(lane, step)) break;
      }
    }));
  } finally {
    clearInterval(heartbeat); clearTimeout(killTimer);
    // Only groups not yet confirmed empty are left: each step's own group was swept when it ended.
    await Promise.all([...groups].map(sweepGroup));
    for (const [signal, handler] of handlers) process.off(signal, handler);
    process.stdout.off('error', onStdoutError);
    process.stdout.on('error', () => {}); // a late EPIPE while exiting is not a crash
    process.off('exit', onExit);
  }
  console.log('\nStep timings');
  for (const r of results) console.log(`  ${r.status.padEnd(7)} ${stamp(r.seconds).padStart(7)}  ${r.lane}: ${r.label}`);
  if (interrupted) throw new LanesError(`Portable check interrupted by ${interrupted.signal}`, interrupted.code);
  if (failed) throw new LanesError('Portable check failed', 1);
  return results;
}
