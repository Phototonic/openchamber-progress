/**
 * Local only: node --experimental-strip-types scripts/promote.ts <main-revision> <dev-revision> <new-branch>
 * Requires a clean checkout and pinned build tools. Never pushes, tags or publishes.
 * Builds in a disposable worktree; on failure the input refs remain unchanged.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAll, outputHashes, compareOutputs, outputs } from './build-all.ts';
import { trackedOutputs, revisionKind } from './revision-kind.ts';
import { verifyCompanionEntry } from './companion-entry.ts';

const git = (cwd: string, args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
};
const root = process.cwd();
const [mainRef, devRef, branch, ...extra] = process.argv.slice(2);
if (!mainRef || !devRef || !branch || extra.length || ['main', 'dev'].includes(branch))
  throw new Error('Usage: promote.ts <main-revision> <dev-revision> <new-branch-not-main-or-dev>');
git(root, ['check-ref-format', '--branch', branch]);
if (git(root, ['status', '--porcelain'])) throw new Error('Promotion requires a clean working tree');
if (spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 1)
  throw new Error('Promotion branch already exists or cannot be checked');
const main = git(root, ['rev-parse', '--verify', `${mainRef}^{commit}`]);
const dev = git(root, ['rev-parse', '--verify', `${devRef}^{commit}`]);
revisionKind({ ref: 'refs/heads/dev' }, trackedOutputs(dev));
const temporary = mkdtempSync(join(tmpdir(), 'progress-promotion-')), work = join(temporary, 'work');
let added = false;
try {
  git(root, ['worktree', 'add', '--detach', work, main]); added = true;
  // Use normal three-way source merging, but discard generated conflicts before
  // inspecting the result. Never resolve a source conflict on the user's behalf.
  const merge = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'merge', '--no-commit', '--no-ff', dev], { cwd: work, encoding: 'utf8' });
  if (merge.status !== 0 && !git(work, ['diff', '--name-only', '--diff-filter=U']))
    throw new Error(`Source merge failed: ${merge.stderr}`);
  git(work, ['rm', '-rf', '--ignore-unmatch', '--', ...outputs]);
  const conflicts = git(work, ['diff', '--name-only', '--diff-filter=U']);
  if (conflicts) throw new Error(`Source merge conflicts: ${conflicts}`);
  const different = git(work, ['diff', '--cached', '--name-only', dev, '--'])
    .split('\n').filter(file => file && !outputs.includes(file));
  if (different.length) throw new Error(`Distribution-only changes must reach dev first: ${different.join(', ')}`);
  // The accepted source is authoritative, not the incidental merge result.
  git(work, ['read-tree', '--reset', '-u', dev]);
  const install = spawnSync('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: work, stdio: 'inherit' });
  if (install.status !== 0) throw new Error('Frozen dependency install failed');
  buildAll(work);
  const before = outputHashes(work);
  buildAll(work); compareOutputs(before, work);
  verifyCompanionEntry(work);
  const version = JSON.parse(readFileSync(join(work, 'package.json'), 'utf8')).version;
  if (!readFileSync(join(work, 'shared/release.ts'), 'utf8').includes(`export const RELEASE = '${version}';`))
    throw new Error('Source version mismatch');
  for (const file of ['build/service/main.js', 'build/setup/main.js'])
    if (!readFileSync(join(work, file), 'utf8').includes(`var RELEASE = "${version}";`))
      throw new Error(`Compiled version mismatch: ${file}`);
  git(work, ['add', '-f', '--', ...outputs]);
  const tree = git(work, ['write-tree']);
  const differences = git(work, ['diff', '--cached', '--name-status', dev]).split('\n').filter(Boolean).sort();
  if (JSON.stringify(differences) !== JSON.stringify(outputs.map(file => `A\t${file}`).sort()))
    throw new Error(`Promotion tree differs outside the nine added outputs: ${differences.join(', ')}`);
  const commit = git(work, ['-c', 'core.hooksPath=/dev/null', 'commit-tree', tree, '-p', main, '-p', dev, '-m', `build: promote runtime outputs for ${version}`]);
  git(root, ['update-ref', `refs/heads/${branch}`, commit, '0'.repeat(40)]);
  console.log(`Local promotion ${branch}: ${commit}\nParents: ${main} ${dev}\nNo push, tag or publication performed.`);
} finally {
  if (added) git(root, ['worktree', 'remove', '--force', work]);
  rmSync(temporary, { recursive: true, force: true });
}
