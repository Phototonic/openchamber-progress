import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGuestAssets } from './source-guests.ts';

test('temporary source guests use the real bundler without changing tracked outputs', { timeout: 180_000 }, () => {
  const surfaces = ['panel', 'status', 'page'] as const;
  const hashes = () => surfaces.map(s => createHash('sha256').update(readFileSync(new URL(`../../ui/${s}/main.js`, import.meta.url))).digest('hex'));
  const before = hashes();
  const assets = createGuestAssets({ source: true });
  try {
    assert.equal(assets.source, true);
    for (const surface of surfaces) {
      assert.ok(assets.read(`/ui/${surface}/main.js`)!.length > 0);
      assert.deepEqual(assets.read(`/ui/${surface}/index.html`), readFileSync(new URL(`../../ui/${surface}/index.html`, import.meta.url)));
    }
    assert.equal(assets.read('/ui/panel/../../package.json'), null);
    assert.equal(assets.read('/background/main.js'), null);
    assert.deepEqual(hashes(), before);
  } finally { assets.dispose(); }
  assets.dispose();
  assert.throws(() => assets.read('/ui/panel/main.js'), /disposed/);
  const built = createGuestAssets({ surfaces: ['panel'] });
  try {
    assert.equal(built.source, false);
    assert.deepEqual(built.read('/ui/panel/main.js'), readFileSync(new URL('../../ui/panel/main.js', import.meta.url)));
    assert.equal(built.read('/ui/page/main.js'), null);
  } finally { built.dispose(); }
});
