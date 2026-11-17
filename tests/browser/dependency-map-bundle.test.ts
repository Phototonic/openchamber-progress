import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { STATUS_MAP_RUNTIME } from './dependency-map-final-qa.ts';

test('Status bundle guard permits shared shell CSS but catches each map JavaScript owner', () => {
  assert.equal(STATUS_MAP_RUNTIME.test('.ap-map-host .ap-map-summary{display:none}'), false);
  for (const module of ['view', 'interaction', 'layout']) {
    const source = readFileSync(new URL(`../../ui/shared/dependency-map-${module}.ts`, import.meta.url), 'utf8');
    assert.equal(STATUS_MAP_RUNTIME.test(source), true, module);
  }
  assert.equal(STATUS_MAP_RUNTIME.test(readFileSync(new URL('../../ui/status/main.js', import.meta.url), 'utf8')), false);
});

test('Status guard also rejects each owner after the production bundler minifies its names', () => {
  const base = process.platform === 'win32' ? tmpdir() : '/tmp/opencode';
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, 'map-bundle-'));
  try {
    const home = join(scratch, 'home'); mkdirSync(home);
    for (const [module, symbol] of [['view', 'createDependencyMapView'], ['interaction', 'DependencyMapInteraction'], ['layout', 'DependencyMapLayout']]) {
      const entry = join(scratch, `${module}.ts`), output = join(scratch, `${module}.js`);
      const path = fileURLToPath(new URL(`../../ui/shared/dependency-map-${module}.ts`, import.meta.url));
      writeFileSync(entry, `import { ${symbol} } from ${JSON.stringify(path)};\n(globalThis as any).mapGuard = ${symbol};\n`);
      const run = spawnSync('bun', ['run', 'bundle:guest', entry, output], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { PATH: process.env.PATH, HOME: home, TMPDIR: scratch },
        encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
      });
      assert.equal(run.status, 0, `${module}: ${run.error?.message ?? run.stderr}`);
      assert.equal(STATUS_MAP_RUNTIME.test(readFileSync(output, 'utf8')), true, module);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
