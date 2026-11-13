import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Actions ignores case in string equality. Only gate-produced booleans, never
// branch names, should reach the downstream expression comparison.
const actionsStringEquals = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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
    const gate = source.split('\n  gate:\n')[1]?.split(/\n  [\w-]+:\n/)[0];
    assert.ok(gate);
    assert.match(gate, /run: \$\{\{ steps.decide.outputs.run \}\}/);
    assert.match(gate, /shell: bash/);
    for (const [key, expression] of Object.entries({
      EVENT_NAME: 'github.event_name', HEAD_REF: 'github.head_ref',
      HEAD_REPOSITORY: 'github.event.pull_request.head.repo.full_name', REPOSITORY: 'github.repository',
    })) assert.ok(gate.includes(`${key}: ` + '${{ ' + expression + ' }}'), `${key} is passed through env`);
    const script = gate.split('        run: |\n')[1]?.replace(/^          /gm, '');
    assert.ok(script);
    assert.ok(!script.includes('${{'), 'Untrusted event values must not be interpolated into Bash');
    for (const job of jobs) {
      const block = source.split(`\n  ${job}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0];
      assert.ok(block, `${workflow}/${job} exists`);
      assert.match(block, /^    needs: gate$/m);
      assert.match(block, /^    if: needs.gate.outputs.run == 'true'$/m);
    }
    const root = mkdtempSync(join(tmpdir(), 'workflow-gate-'));
    try {
      let index = 0;
      for (const [eventName, headRef, headRepo, expected] of [
        ['push', 'dev', repository, true],
        ['push', 'main', repository, true],
        ['schedule', '', '', true],
        ['workflow_dispatch', 'dev', repository, true],
        ['pull_request', 'dev', repository, false],
        ['pull_request', 'main', repository, false],
        ['pull_request', 'Dev', repository, true],
        ['pull_request', 'MAIN', repository, true],
        ['pull_request', 'feature', repository, true],
        ['pull_request', 'dev', 'example/fork', true],
        ['pull_request', 'main', 'example/fork', true],
        ['pull_request', 'Dev', 'example/fork', true],
        ['pull_request', 'MAIN', 'example/fork', true],
        ['pull_request', 'feature', 'example/fork', true],
        ['pull_request', '$(exit 9)', repository, true],
        ['pull_request', 'dev', '', true],
      ] as const) {
        const output = join(root, `output-${index++}`);
        const result = spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', script], {
          timeout: 5_000, encoding: 'utf8',
          env: { PATH: process.env.PATH, EVENT_NAME: eventName, HEAD_REF: headRef,
            HEAD_REPOSITORY: headRepo, REPOSITORY: repository, GITHUB_OUTPUT: output },
        });
        assert.equal(result.status, 0, result.stderr);
        const value = readFileSync(output, 'utf8').trim().match(/^run=(true|false)$/)?.[1];
        assert.ok(value, 'Gate emits one boolean output');
        assert.equal(actionsStringEquals(value, 'true'), expected,
          `${workflow}: ${eventName}/${headRef}/${headRepo}`);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
    if (workflow !== 'ci') assert.match(source, /schedule:\n/);
    else {
      const publish = source.split('\n  publish:\n')[1];
      assert.match(publish, /^    needs: \[portable, windows-native\]$/m);
      assert.match(publish, /^    if: github.event_name == 'push' && github.repository == 'Phototonic\/openchamber-progress' && github.ref == 'refs\/heads\/main' && needs.portable.outputs.eligible == 'true'$/m);
    }
  }
});
