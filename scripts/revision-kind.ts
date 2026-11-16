import { spawnSync } from 'node:child_process';
import { outputs } from './build-all.ts';

type Event = { ref?: string; pull_request?: { base?: { ref?: string } } };
/** Events select policy; only an event-free local run may infer it from the tree. */
export function revisionKind(event: Event | undefined, tracked: string[]): 'source' | 'distribution' {
  const present = outputs.filter(file => tracked.includes(file));
  const distribution = event
    ? (event.pull_request ? event.pull_request.base?.ref === 'main' : event.ref === 'refs/heads/main')
    : present.length === outputs.length;
  if (distribution && present.length !== outputs.length)
    throw new Error(`Distribution revision is missing generated outputs: ${outputs.filter(file => !present.includes(file)).join(', ')}`);
  if (!distribution && present.length)
    throw new Error(`Source revision tracks generated outputs: ${present.join(', ')}`);
  return distribution ? 'distribution' : 'source';
}
export function trackedOutputs(revision: string, cwd = process.cwd()): string[] {
  const result = spawnSync('git', ['ls-tree', '-r', '--name-only', '-z', revision, '--', ...outputs], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot read revision output inventory');
  return result.stdout.split('\0').filter(Boolean);
}
