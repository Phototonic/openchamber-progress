import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { outputs, compareOutputs, outputHashes } from '../../scripts/build-all.ts';
import { revisionKind, trackedOutputs } from '../../scripts/revision-kind.ts';

const command = resolve('scripts/promote.ts');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'promotion-test-'));
  const repo = join(root, 'repo'), bin = join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  const write = (file: string, value: string) => { mkdirSync(dirname(join(repo, file)), { recursive: true }); writeFileSync(join(repo, file), value); };
  git('init', '-q', '-b', 'main');
  write('package.json', readFileSync('package.json', 'utf8'));
  write('shared/release.ts', readFileSync('shared/release.ts', 'utf8'));
  write('source.txt', 'first\n');
  const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
if(process.env.PROMOTION_BUILD_FAIL&&process.argv[2]!=='install')process.exit(3);
const outputs=${JSON.stringify(outputs)};
if(process.argv[2]==='install')process.exit(0);
const version=JSON.parse(fs.readFileSync('package.json')).version;
for(const file of outputs){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,file.endsWith('package.json')?JSON.stringify({version,type:'module',exports:{'.':'./index.js'}}):'var RELEASE = "'+version+'";\\n'+fs.readFileSync('source.txt'));}
`;
  writeFileSync(join(bin, 'bun'), stub, { mode: 0o755 });
  for (const file of outputs) write(file, 'old output');
  git('add', '.'); git('commit', '-qm', 'Distribution baseline');
  const main = git('rev-parse', 'HEAD');
  git('switch', '-qc', 'dev'); git('rm', '-q', '--', ...outputs);
  write('.gitignore', '/build/\n/background/main.js\n/ui/*/main.js\n');
  git('add', '.'); git('commit', '-qm', 'Source only');
  const dev = git('rev-parse', 'HEAD');
  const promote = (branch: string, extra = {}) => spawnSync(process.execPath,
    ['--experimental-strip-types', command, 'main', 'dev', branch],
    { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30_000 });
  return { root, repo, env, git, write, main, dev, promote };
}

test('revision kinds follow event targets and otherwise the whole tree, rejecting misplaced outputs', () => {
  const f = fixture();
  try {
    const source = trackedOutputs(f.dev, f.repo), distribution = trackedOutputs(f.main, f.repo);
    assert.equal(revisionKind(undefined, source), 'source');
    assert.equal(revisionKind(undefined, distribution), 'distribution');
    for (const event of [{ ref: 'refs/heads/main' }, { pull_request: { base: { ref: 'main' } } }]) {
      assert.equal(revisionKind(event, distribution), 'distribution');
      assert.throws(() => revisionKind(event, source), /missing generated outputs: build\/service\/main.js/);
    }
    for (const event of [{ ref: 'refs/heads/dev' }, { pull_request: { base: { ref: 'feature' } } }]) {
      assert.equal(revisionKind(event, source), 'source');
      assert.throws(() => revisionKind(event, distribution), /Source revision tracks generated outputs/);
    }
    assert.throws(() => revisionKind(undefined, [outputs[0]]), /build\/service\/main.js/);
    assert.throws(() => revisionKind({ ref: 'refs/heads/main' }, [outputs[0]]), /build\/setup\/main.js/);
    for (const file of outputs) f.write(file, 'fresh');
    const before = outputHashes(f.repo); f.write(outputs[0], 'stale');
    assert.throws(() => compareOutputs(before, f.repo), /build\/service\/main.js/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('local promotion builds first and second two-parent trees without generated conflicts or remote operations', () => {
  const f = fixture();
  try {
    for (let round = 1; round <= 2; round++) {
      const main = f.git('rev-parse', 'main'), dev = f.git('rev-parse', 'dev');
      const result = f.promote(`promote-${round}`);
      assert.equal(result.status, 0, result.stderr);
      const commit = f.git('rev-parse', `promote-${round}`);
      assert.deepEqual(f.git('rev-list', '--parents', '-n', '1', commit).split(' '), [commit, main, dev]);
      assert.deepEqual(f.git('diff', '--name-status', dev, commit).split('\n').sort(), outputs.map(p => `A\t${p}`).sort());
      assert.equal(f.git('rev-parse', 'main'), main); assert.equal(f.git('rev-parse', 'dev'), dev);
      assert.equal(f.git('status', '--porcelain'), '');
      f.git('switch', '-q', 'main'); f.git('merge', '-q', '--no-ff', `promote-${round}`, '-m', 'Promotion');
      assert.equal(f.git('diff', commit, 'main'), '');
      f.git('switch', '-q', 'dev'); f.write('source.txt', 'second\n'); f.git('add', '.');
      if (round === 1) f.git('commit', '-qm', 'Next source');
    }
    assert.equal(f.git('tag', '--list'), ''); assert.equal(f.git('remote', '-v'), '');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('promotion refuses unsafe inputs without creating a branch or moving inputs', () => {
  for (const kind of ['distribution-only', 'dirty', 'tracked-output', 'build-failure']) {
    const f = fixture();
    try {
      if (kind === 'distribution-only') {
        f.git('switch', '-q', 'main'); f.write('main-only.txt', 'must reach dev first');
        f.git('add', '.'); f.git('commit', '-qm', 'Distribution only'); f.git('switch', '-q', 'dev');
      } else if (kind === 'dirty') f.write('dirty.txt', 'uncommitted');
      else if (kind === 'tracked-output') { f.write(outputs[0], 'accidental'); f.git('add', '-f', outputs[0]); f.git('commit', '-qm', 'Accidental output'); }
      const refs = f.git('show-ref');
      const result = f.promote('refused', kind === 'build-failure' ? { PROMOTION_BUILD_FAIL: '1' } : {});
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, kind === 'distribution-only' ? /main-only.txt/ : kind === 'dirty' ? /clean working tree/ : kind === 'tracked-output' ? /build\/service\/main.js/ : /Runtime build failed/);
      assert.equal(f.git('show-ref'), refs);
      assert.equal(f.git('worktree', 'list', '--porcelain').match(/^worktree /gm)?.length, 1);
      assert.equal(f.git('tag', '--list'), ''); assert.equal(f.git('remote', '-v'), '');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
