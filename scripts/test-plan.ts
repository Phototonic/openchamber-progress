/** The portable check groups, shared by CI (`scripts/ci.ts`) and the local
 * runner (`scripts/test.ts`) so they cannot drift apart. Nothing here weakens a
 * check: it only decides which groups may run side by side.
 *
 * The backend files that acquire target-derived Setup coordination ports stay in
 * one serial `--test-concurrency=1` invocation (see `scripts/ci-backend.ts`). They
 * spend most of their time waiting on deadlines and HTTP replies, and no other
 * group acquires those ports, so the other groups run beside them rather than
 * before them. */
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { backendTestCommands, nativeOnlyTests } from './ci-backend.ts';
import type { Lane } from './test-lanes.ts';

export const testFiles = (dir: string) => readdirSync(dir).filter(f => f.endsWith('.test.ts')).sort().map(f => `${dir}/${f}`);

export function portableLanes(options: { fenced: boolean }): Lane[] {
  const backend = testFiles('tests/backend').filter(f => !nativeOnlyTests.includes(f.split('/').at(-1)!));
  const [parallel, serial] = backendTestCommands(backend);
  // Leave two cores for the serial lane and the type checker; the lanes are
  // short of waiting time, not of cores, and a starved timing test is a false failure.
  const workers = `--test-concurrency=${Math.max(1, availableParallelism() - 2)}`;
  const withWorkers = (args: string[]) => [...args.slice(0, 2), workers, ...args.slice(2)];
  const node = (label: string, args: string[]) => ({ label, command: 'node', args });
  const types = [
    { label: 'root typecheck', command: 'bun', args: ['run', 'typecheck'] },
    { label: 'UI typecheck', command: './node_modules/.bin/tsc', args: ['-p', 'ui/tsconfig.json', '--noEmit'] },
  ];
  const rest = [
    node('backend tests (parallel group)', withWorkers(parallel)),
    node('browser-model and automation tests', withWorkers(['--experimental-strip-types', '--test', ...testFiles('tests/browser'), ...testFiles('tests/automation')])),
  ];
  return options.fenced
    ? [
      { name: 'port-bound backend', steps: [node('backend tests (serial group, Setup ports)', serial)] },
      { name: 'everything else', steps: [...types, ...rest] },
    ]
    : [
      { name: 'types', steps: types },
      { name: 'tests', steps: rest },
    ];
}
