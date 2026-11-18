/** The portable check groups, shared by CI (`scripts/ci.ts`) and the local
 * runner (`scripts/test.ts`) so they cannot drift apart. Nothing here weakens a
 * check: it only decides which groups may run side by side.
 *
 * The backend files that acquire target-derived Setup coordination ports stay in
 * one serial `--test-concurrency=1` invocation (see `scripts/ci-backend.ts`). It is
 * a chain of requests, each starting a worker thread, with a few deliberate
 * deadline waits, so it is bound by latency rather than by the number of cores. No
 * other group acquires those ports (checked with a probe on the acquisition call),
 * so the other groups run beside it rather than before it. */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { backendTestCommands, nativeOnlyTests } from './ci-backend.ts';
import type { Lane } from './test-lanes.ts';

export const testFiles = (dir: string) => readdirSync(dir).filter(f => f.endsWith('.test.ts')).sort().map(f => `${dir}/${f}`);

/** Node's compile cache keeps V8's compiled code for each source file it loads and
 * checks it against the source's hash, so a changed file is recompiled, never
 * served stale. Every test file runs in its own process and the managed-step tests
 * start a worker per request, all loading the same modules: with the cache they
 * compile each module once. Entries are keyed by file name and the fixtures run
 * from fresh temporary folders, so a cache kept across runs only grows (about
 * 30 MB a run); each run starts from an empty one instead. It sits in the ignored
 * dependency folder, never in tracked or packaged paths. A missing or unwritable
 * folder only turns the cache off. */
export function freshCompileCache(root = process.cwd()): Record<string, string> {
  const directory = resolve(root, 'node_modules/.cache/agent-progress-compile');
  try {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
  } catch {
    console.log('Compile cache disabled: node_modules/.cache/agent-progress-compile could not be prepared; tests run without it.');
    return {};
  }
  return { NODE_COMPILE_CACHE: directory };
}

export function portableLanes(options: { fenced: boolean; env?: Record<string, string>; cpus?: number; environment?: NodeJS.ProcessEnv }): Lane[] {
  const env = options.env ?? {};
  const backend = testFiles('tests/backend').filter(f => !nativeOnlyTests.includes(f.split('/').at(-1)!));
  const [parallel, serial] = backendTestCommands(backend, options.environment ?? process.env);
  // The serial group's chain keeps about two cores busy (its main thread and the
  // workers it starts). Leave them free so its timing assertions keep their
  // headroom, and run this lane under `nice` as well.
  const workers = `--test-concurrency=${Math.max(1, (options.cpus ?? availableParallelism()) - 2)}`;
  const withWorkers = (args: string[]) => [...args.slice(0, 2), workers, ...args.slice(2)];
  const node = (label: string, args: string[]) => ({ label, command: 'node', args, env });
  const types = [
    { label: 'root typecheck', command: 'bun', args: ['run', 'typecheck'], env },
    { label: 'UI typecheck', command: './node_modules/.bin/tsc', args: ['-p', 'ui/tsconfig.json', '--noEmit'], env },
  ];
  const rest = [
    node('backend tests (parallel group)', withWorkers(parallel)),
    node('browser-model and automation tests', withWorkers(['--experimental-strip-types', '--test', ...testFiles('tests/browser'), ...testFiles('tests/automation')])),
  ];
  // Beside the serial group, the other lane yields cores to it.
  const yielding = [...types, ...rest].map(step => ({ ...step, lowPriority: true }));
  return options.fenced
    ? [
      { name: 'port-bound backend', steps: [node('backend tests (serial group, Setup ports)', serial)] },
      { name: 'everything else', steps: yielding },
    ]
    : [
      { name: 'types', steps: types },
      { name: 'tests', steps: rest },
    ];
}
