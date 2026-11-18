/** Runs independent groups of checks side by side. A lane is an ordered list of
 * steps that stop at the first failure; lanes share nothing but the checkout.
 * Output is captured per step and written whole when the step ends, so lines
 * from different lanes never interleave. The first failure stops every lane. */
import { spawn } from 'node:child_process';

/** `lowPriority` runs the step under `nice`, so a lane that must keep its timing
 * headroom wins the cores when the machine is short of them. */
export type Step = { label: string; command: string; args: string[]; lowPriority?: boolean };
export type Lane = { name: string; steps: Step[] };
export type StepResult = { lane: string; label: string; seconds: number; status: 'passed' | 'failed' | 'stopped' };

const github = process.env.GITHUB_ACTIONS === 'true';
const stamp = (seconds: number) => `${seconds.toFixed(1)}s`;

function print(label: string, text: string, ok: boolean) {
  // One write per block keeps another lane's output out of the middle of it.
  const body = text.endsWith('\n') || text === '' ? text : `${text}\n`;
  process.stdout.write(github ? `::group::${label}\n${body}::endgroup::\n` : `\n=== ${label} ${ok ? '' : '(failed) '}===\n${body}`);
}

export async function runLanes(lanes: Lane[]): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const children = new Set<number>();
  let failed = false;
  const stopAll = () => {
    for (const pid of children) { try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ } }
    // A step that ignores SIGTERM must not outlive the run.
    setTimeout(() => { for (const pid of children) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } } }, 10_000).unref();
  };
  const runStep = (lane: Lane, step: Step) => new Promise<boolean>(resolve => {
    const started = performance.now();
    const label = `${lane.name}: ${step.label}`;
    console.log(`start  ${label}`);
    const chunks: Buffer[] = [];
    // Own process group, so stopping a step also stops the test files it started.
    const niced = step.lowPriority && process.platform !== 'win32';
    const child = spawn(niced ? 'nice' : step.command, niced ? ['-n', '10', step.command, ...step.args] : step.args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    if (child.pid) children.add(child.pid);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    const finish = (ok: boolean, note = '') => {
      if (child.pid) children.delete(child.pid);
      const seconds = (performance.now() - started) / 1000;
      const status = ok ? 'passed' : failed ? 'stopped' : 'failed';
      if (!ok && !failed) { failed = true; stopAll(); }
      if (status !== 'stopped') print(label, Buffer.concat(chunks).toString('utf8') + note, ok);
      console.log(`${ok ? 'passed' : status} ${label} (${stamp(seconds)})`);
      results.push({ lane: lane.name, label: step.label, seconds, status });
      resolve(ok);
    };
    child.on('error', error => finish(false, `Could not start: ${error.message}\n`));
    child.on('close', (code, signal) => finish(code === 0, code === 0 ? '' : `Exited with ${signal ?? `code ${code}`}\n`));
  });
  await Promise.all(lanes.map(async lane => {
    for (const step of lane.steps) {
      if (failed) { results.push({ lane: lane.name, label: step.label, seconds: 0, status: 'stopped' }); continue; }
      if (!await runStep(lane, step)) break;
    }
  }));
  console.log('\nStep timings');
  for (const r of results) console.log(`  ${r.status.padEnd(7)} ${stamp(r.seconds).padStart(7)}  ${r.lane}: ${r.label}`);
  if (failed) throw new Error('Portable check failed');
  return results;
}
