import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Actions ignores case in string equality. Only gate-produced booleans, never
// branch names, should reach the downstream expression comparison.
const actionsStringEquals = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

test('native trace extraction tolerates TAP indentation and rejects a runner-only artifact',()=>{
  const source=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  const pattern=source.match(/if \(\$_ -match '([^']+WINDOWS_MIGRATION_TRACE[^']+)'\)/)?.[1];
  assert.ok(pattern);
  const regex=new RegExp(pattern);
  for(const prefix of ['', '# ', '    ', '  #   ']){
    const line=prefix+'WINDOWS_MIGRATION_TRACE {"request":"prepare","spawns":6}';
    assert.deepEqual(JSON.parse(regex.exec(line)![1]),{request:'prepare',spawns:6});
  }
  assert.equal(regex.test('unrelated output'),false);
  assert.match(source,/Where-Object \{ \$_\.request -and \$_\.request -notin @\('runner-start','summary'\) \}/);
  assert.match(source,/if \(\$requests\.Count -eq 0\) \{ throw 'Native Windows request trace is missing\.'/);
});

const gateScript = (workflow: string) => {
  const source = readFileSync(new URL(`../../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
  const gate = source.split('\n  gate:\n')[1]?.split(/\n  [\w-]+:\n/)[0];
  assert.ok(gate);
  const script = gate.split('        run: |\n')[1]?.replace(/^          /gm, '');
  assert.ok(script);
  return { gate, script };
};

test('pull requests that only change documentation or OpenSpec text skip CI and CodeQL checks', () => {
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: {
      PATH: process.env.PATH, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid', GIT_CONFIG_NOSYSTEM: '1', HOME: cwd,
    } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const root = mkdtempSync(join(tmpdir(), 'workflow-docs-only-'));
  try {
    const repo = join(root, 'repo');
    git(root, 'init', '-q', '-b', 'dev', repo);
    const write = (file: string, text: string) => {
      const path = join(repo, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    };
    for (const file of ['src/a.ts', 'docs/ui.md', 'docs/setup.md', 'openspec/specs/x/spec.md',
      'openspec/changes/archive/old/tasks.md', 'README.md', 'build/companion/SKILL.md']) write(file, 'base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');
    const cases: [string, (() => void), boolean][] = [
      ['docs page', () => write('docs/ui.md', 'changed\n'), false],
      ['new OpenSpec change and README', () => { write('openspec/changes/next/proposal.md', 'new\n'); write('README.md', 'changed\n'); }, false],
      ['docs image', () => write('docs/images/rail.png', 'png\n'), false],
      ['code', () => write('src/a.ts', 'changed\n'), true],
      ['docs and code', () => { write('docs/ui.md', 'again\n'); write('src/a.ts', 'again\n'); }, true],
      ['packaged setup guide', () => write('docs/setup.md', 'changed\n'), true],
      ['archived change read by tests', () => write('openspec/changes/archive/old/tasks.md', 'changed\n'), true],
      ['tracked runtime Markdown', () => write('build/companion/SKILL.md', 'changed\n'), true],
      ['code moved into docs', () => git(repo, 'mv', 'src/a.ts', 'docs/a.ts'), true],
    ];
    let index = 0;
    for (const [label, change, expected] of cases) {
      git(repo, 'checkout', '-q', '-B', `case-${index}`, base);
      change();
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', label);
      const head = git(repo, 'rev-parse', 'HEAD');
      for (const workflow of ['ci', 'codeql', 'secrets-scan']) {
        const { gate, script } = gateScript(workflow);
        const output = join(root, `output-${workflow}-${index}`);
        const result = spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', script], {
          cwd: repo, timeout: 5_000, encoding: 'utf8',
          env: { PATH: process.env.PATH, EVENT_NAME: 'pull_request', HEAD_REF: 'feature',
            HEAD_REPOSITORY: 'example/project', REPOSITORY: 'example/project',
            BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output },
        });
        assert.equal(result.status, 0, result.stderr);
        const value = readFileSync(output, 'utf8').match(/^run=(true|false)$/m)?.[1];
        // The secrets scan reads no file list and always scans.
        const want = workflow === 'secrets-scan' ? true : expected;
        assert.equal(value === 'true', want, `${workflow}: ${label}`);
        if (workflow !== 'secrets-scan') {
          assert.match(gate, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
          assert.match(gate, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
          assert.match(gate, /if: github\.event_name == 'pull_request'\n        uses: actions\/checkout@/);
        }
      }
      index++;
    }
    // A listing that fails (commits missing) keeps every check.
    const { script } = gateScript('ci');
    const output = join(root, 'output-missing');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', script], {
      cwd: repo, timeout: 5_000, encoding: 'utf8',
      env: { PATH: process.env.PATH, EVENT_NAME: 'pull_request', HEAD_REF: 'feature',
        HEAD_REPOSITORY: 'example/project', REPOSITORY: 'example/project',
        BASE_SHA: '0'.repeat(40), HEAD_SHA: '1'.repeat(40), GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, 'utf8'), /^run=true$/m);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only duplicate same-repository main/dev PR check jobs are skipped', () => {
  const repository = 'example/project';
  for (const [workflow, jobs] of [
    ['ci', ['portable', 'node-latest', 'windows-native']],
    ['codeql', ['analyze']],
    ['secrets-scan', ['gitleaks']],
  ] as const) {
    const source = readFileSync(new URL(`../../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
    assert.match(source, /push:\n    branches: \[main, dev\]/);
    // Pull requests run whatever branch they target, so stacked PRs are checked too.
    assert.match(source, /^  pull_request:\n  push:\n/m);
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
      const output = job === 'windows-native' ? 'windows' : 'run';
      const events = workflow === 'ci' && job !== 'windows-native'
        ? " && github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'" : '';
      assert.ok(block.includes(`    if: needs.gate.outputs.${output} == 'true'${events}\n`));
    }
    const root = mkdtempSync(join(tmpdir(), 'workflow-gate-'));
    try {
      let index = 0;
      for (const [eventName, headRef, headRepo, expected, baseRef = 'dev'] of [
        ['pull_request', 'dev', repository, true, 'main'],
        ['pull_request', 'main', repository, true, 'main'],
        ['pull_request', 'dev', repository, false, 'feature'],
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
          env: { PATH: process.env.PATH, EVENT_NAME: eventName, HEAD_REF: headRef, BASE_REF: baseRef,
            HEAD_REPOSITORY: headRepo, REPOSITORY: repository, GITHUB_OUTPUT: output },
        });
        assert.equal(result.status, 0, result.stderr);
        const value = readFileSync(output, 'utf8').match(/^run=(true|false)$/m)?.[1];
        assert.ok(value, 'Gate emits the run boolean output');
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

test('Windows selects fast PR/push checks and full release, weekly and manual journeys', () => {
  const { gate, script } = gateScript('ci');
  const source = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(source, /schedule:\n    - cron: '17 4 \* \* 2'\n  workflow_dispatch:/);
  for (const output of ['windows', 'windows_full']) {
    assert.ok(gate.includes(`${output}: ` + '${{ steps.decide.outputs.' + output + ' }}'));
  }
  assert.ok(gate.includes('REF: ${{ github.ref }}'));
  const windows = source.split('\n  windows-native:\n')[1].split('\n  publish:\n')[0];
  assert.ok(windows.includes("AP_WINDOWS_FULL: ${{ needs.gate.outputs.windows_full == 'true' && '1' || '0' }}"));
  assert.match(windows, /name: Fetch released Windows migration fixture\n        if: env.AP_WINDOWS_FULL == '1'\n        run: git fetch --no-tags origin tag v1\.1\.1/);
  assert.match(windows, /\$runs = @\('windows-platform', 'windows-service'\)/);
  assert.match(windows, /--test-concurrency=1 tests\/backend\/\$\(\$run\.File\)\.test\.ts/);
  // Each file runs under Start-Process -Wait, which waits for the whole process tree, inside its own thread job.
  assert.match(windows, /Start-ThreadJob[^\n]*-ScriptBlock \{/);
  assert.match(windows, /-WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput \$run\.Output -RedirectStandardError \$run\.Errors -ErrorAction Stop/);
  // The secondary logon service refuses a second simultaneous start once; only that refusal is retried.
  assert.match(windows, /\$_\.Exception\.Message -notmatch 'already running'\) \{ throw \}/);
  assert.match(windows, /\$attempt -ge 30/);
  assert.ok(!windows.includes('WaitForExit'), 'a bare process wait would not wait for what the process started');
  assert.match(windows, /\$null = \$runs\.Job \| Wait-Job/);
  assert.match(windows, /Receive-Job -Job \$run\.Job -ErrorAction Stop/);
  assert.match(windows, /Where-Object \{ \$_\.ExitCode -ne 0 \}/);

  const root = mkdtempSync(join(tmpdir(), 'workflow-windows-'));
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: {
      PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
    } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '-q', '-b', 'dev');
    writeFileSync(join(root, 'README.md'), 'base\n');
    git('add', '.'); git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    let index = 0;
    const decide = (event: string, ref: string, baseRef: string, head: string, headRef = 'feature', baseSha = base) => {
      const output = join(root, `output-${index++}`);
      const result = spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', script], {
        cwd: root, encoding: 'utf8', timeout: 5_000,
        env: { PATH: process.env.PATH, EVENT_NAME: event, REF: ref, BASE_REF: baseRef, HEAD_REF: headRef,
          HEAD_REPOSITORY: 'example/project', REPOSITORY: 'example/project',
          BASE_SHA: baseSha, HEAD_SHA: head, GITHUB_OUTPUT: output },
      });
      assert.equal(result.status, 0, result.stderr);
      return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
    };
    for (const [file, expected] of [
      ['ui/panel/main.ts', false], ['background/main.ts', false], ['tests/browser/setup.test.ts', false],
      ['docs/setup.md', false], ['openspec/changes/archive/old/tasks.md', false],
      ['service/main.ts', true], ['setup/lifecycle.ts', true], ['shared/store.ts', true],
      ['plugin/SKILL.md', true], ['scripts/build.ts', true], ['package.json', true], ['bun.lock', true],
      ['tsconfig.json', true], ['build/companion/SKILL.md', true], ['build/service/main.js', true],
      ['build/setup/main.js', true], ['tests/backend/windows-platform.test.ts', true],
      ['tests/fixtures/windows-service-observer.mjs', true], ['.github/workflows/ci.yml', true],
      ['unknown-config.json', true],
    ] as const) {
      git('checkout', '-q', '-B', `case-${index}`, base);
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'changed\n');
      git('add', file); git('commit', '-q', '-m', 'change');
      const head = git('rev-parse', 'HEAD');
      const result = decide('pull_request', '', 'dev', head);
      assert.equal(result.windows, String(expected), file);
      assert.equal(result.windows_full, 'false', file);
      // Promotion PRs always run full Windows, even when the existing docs gate skips Linux.
      const promotion = decide('pull_request', '', 'main', head);
      assert.equal(promotion.windows, 'true', `promotion: ${file}`);
      assert.equal(promotion.windows_full, 'true', `promotion: ${file}`);
    }
    for (const [event, ref, full] of [
      ['push', 'refs/heads/dev', false], ['push', 'refs/heads/main', true],
      ['schedule', 'refs/heads/dev', true], ['workflow_dispatch', 'refs/heads/dev', true],
    ] as const) {
      const result = decide(event, ref, '', base);
      assert.equal(result.windows, 'true', `${event}/${ref}`);
      assert.equal(result.windows_full, String(full), `${event}/${ref}`);
    }
    assert.equal(decide('pull_request', '', 'dev', base).windows, 'true', 'empty diff fails open');
    assert.equal(decide('pull_request', '', 'dev', base, 'feature', '0'.repeat(40)).windows, 'true',
      'failed diff fails open');
    assert.equal(decide('pull_request', '', 'dev', base, 'dev').windows, 'false', 'duplicate head still skips');
    // No-renames diff must retain the removed backend path.
    git('checkout', '-q', '-B', 'rename-base', base);
    mkdirSync(join(root, 'service'), { recursive: true });
    writeFileSync(join(root, 'service/moved.ts'), 'source\n');
    git('add', 'service/moved.ts'); git('commit', '-q', '-m', 'source');
    const renameBase = git('rev-parse', 'HEAD');
    mkdirSync(join(root, 'docs'), { recursive: true });
    git('mv', 'service/moved.ts', 'docs/moved.ts'); git('commit', '-q', '-m', 'move');
    assert.equal(decide('pull_request', '', 'dev', git('rev-parse', 'HEAD'), 'feature', renameBase).windows, 'true');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
