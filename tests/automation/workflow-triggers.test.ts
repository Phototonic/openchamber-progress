import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('only duplicate same-repository main/dev PR check jobs are skipped', () => {
  const repository = 'example/project';
  for (const [workflow, jobs] of [
    ['ci', ['portable', 'node-latest', 'windows-native']],
    ['codeql', ['analyze']],
    ['secrets-scan', ['gitleaks']],
  ] as const) {
    const source = readFileSync(new URL(`../../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
    assert.match(source, /push:\n    branches: \[main, dev\]/);
    assert.match(source, /pull_request:\n    branches: \[main, dev\]/);
    for (const job of jobs) {
      const block = source.split(`\n  ${job}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0];
      assert.ok(block, `${workflow}/${job} exists`);
      const condition = block.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];
      assert.ok(condition, `${workflow}/${job} has a job-level condition`);
      for (const [event_name, head_ref, headRepo, expected] of [
        ['push', undefined, undefined, true],
        ['schedule', undefined, undefined, true],
        ['pull_request', 'dev', repository, false],
        ['pull_request', 'main', repository, false],
        ['pull_request', 'feature', repository, true],
        ['pull_request', 'dev', 'example/fork', true],
        ['pull_request', 'main', 'example/fork', true],
        ['pull_request', 'feature', 'example/fork', true],
      ] as const) {
        const github = { event_name, repository, head_ref, event: headRepo
          ? { pull_request: { head: { repo: { full_name: headRepo } } } } : {} };
        assert.equal(runInNewContext(condition, { github }), expected,
          `${workflow}/${job}: ${event_name}/${head_ref}/${headRepo}`);
      }
    }
    if (workflow !== 'ci') assert.match(source, /schedule:\n/);
  }
});
