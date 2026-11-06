import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function harness() {
  const controls = new Map<any, any>();
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/live-select.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, HTMLSelectElement: class {}, require: () => ({
    mountSelect(root: any, props: any) {
      const control = { props, disposed: false, update(next: any) { this.props = { ...this.props, ...next }; }, dispose() { this.disposed = true; } };
      controls.set(root, control); return control;
    },
  }) });
  const holder = (open = true) => ({ dataset: { testid: 'filter-project' }, isConnected: true, open,
    parentElement: null as any, querySelector() { return this.open ? {} : null; }, remove() { this.isConnected = false; },
  });
  const tree = (key: string, node: ReturnType<typeof holder>, hidden = false) => {
    const parent = { moved: false, moveBefore(old: any) { this.moved = true; old.parentElement = this; } }; node.parentElement = parent;
    const owner = { dataset: { livePopup: key }, querySelector: () => ({ hidden }), querySelectorAll: () => [node], contains: () => false };
    return { root: { querySelector: () => owner, ownerDocument: { activeElement: null } }, parent };
  };
  return { ...exports, controls, holder, tree };
}

test('live select rejects detached and synchronously retired callbacks', () => {
  const h = harness(), root = h.holder(); let current = true, changes = 0;
  h.mountLiveSelect(root, { value: 'all', options: [], onChange: () => changes++ }, () => current);
  const pick = h.controls.get(root).props.onChange;
  pick('project'); assert.equal(changes, 1);
  current = false; pick('retired'); assert.equal(changes, 1, 'retirement does not wait for disconnection or another paint');
  current = true; root.isConnected = false; pick('detached'); assert.equal(changes, 1);
});

test('preserving an open select refreshes its props and callback, not the surrounding tree', () => {
  const h = harness(), old = h.holder(), fresh = h.holder(); const changes: string[] = [];
  h.mountLiveSelect(old, { value: 'all', options: [], onChange: () => changes.push('old') });
  h.mountLiveSelect(fresh, { value: 'project', options: [{ id: 'project', label: 'Current project' }], onChange: () => changes.push('fresh') });
  const before = h.tree('same-account-store-mode', old), after = h.tree('same-account-store-mode', fresh);
  h.preserveLiveSelects(before.root, after.root);
  assert.equal(after.parent.moved, true);
  assert.equal(fresh.isConnected, false);
  assert.equal(h.controls.get(fresh).disposed, true);
  assert.equal(h.controls.get(old).props.value, 'project');
  h.controls.get(old).props.onChange('project');
  assert.deepEqual(changes, ['fresh']);
});

test('authority/mode change and a closed panel never retain an old dropdown', () => {
  for (const boundary of ['identity', 'closed'] as const) {
    const h = harness(), old = h.holder(), fresh = h.holder();
    h.mountLiveSelect(old, { value: 'all', options: [], onChange() {} });
    h.mountLiveSelect(fresh, { value: 'all', options: [], onChange() {} });
    const before = h.tree('old', old), after = h.tree(boundary === 'identity' ? 'new' : 'old', fresh, boundary === 'closed');
    h.preserveLiveSelects(before.root, after.root);
    assert.equal(after.parent.moved, false);
    assert.equal(fresh.isConnected, true);
  }
});
