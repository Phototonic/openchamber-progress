import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireRuntimeVersion } from '../fixtures/runtime-version.ts';

test('native runtime floors accept only stable releases in the tested major line', () => {
  for (const version of ['24.19.0', '24.22.2', '24.99.0']) assert.equal(requireRuntimeVersion('node', `v${version}`), version);
  for (const version of ['24.18.9', '24.18.99', '23.99.0', '25.0.0']) assert.throws(() => requireRuntimeVersion('node', `v${version}`), /requires >=24\.19\.0 within major 24/);
  for (const version of ['2.2.2', '2.2.6', '2.99.0']) assert.equal(requireRuntimeVersion('opencode', `opencode v${version}`), version);
  for (const version of ['2.1.99', '2.2.1', '1.99.0', '3.0.0']) assert.throws(() => requireRuntimeVersion('opencode', `opencode v${version}`), /requires >=2\.2\.2 within major 2/);
  for (const runtime of ['node', 'opencode'] as const) {
    for (const version of ['', 'garbage', '24.19', 'v24.19.0-beta', 'opencode v2.2.2-beta', 'opencode v2.2.2 extra', 'opencode v02.2.2', 'v9007199254740992.19.0']) assert.throws(() => requireRuntimeVersion(runtime, version), /malformed version/);
  }
});
