import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  // The primitive seam models its two global listeners retaining the content.
  // Use the actual components wrapper/state and paint ownership, not a parallel implementation.
  const listeners = new Map<object, object>();
  const handles: { root: { dataset: Record<string, string> }; content: object; open: boolean; focus: () => void; blur: () => void; dispose: () => void }[] = [];
  const exports: Record<string, any> = {};
  const js = ts.transpileModule(readFileSync(new URL('../../ui/shared/components.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText + '\nexports.trackedInfoCount = () => [...infoHandles.values()].reduce((n, handles) => n + handles.size, 0);';
  runInNewContext(js, { exports, require: (name: string) => name === './primitives.ts' ? {
    infoDisclosure: (options: { open: boolean; onToggle: (open: boolean) => void }) => {
      const docListener = {}, windowListener = {}, content = {};
      const h = {
        root: { dataset: {} }, content, open: false,
        focus() { h.open = true; listeners.set(docListener, content); listeners.set(windowListener, content); options.onToggle(true); },
        blur() { h.open = false; options.onToggle(false); },
        dispose() { h.open = false; listeners.delete(docListener); listeners.delete(windowListener); },
      };
      if (options.open) { h.open = true; listeners.set(docListener, content); listeners.set(windowListener, content); }
      handles.push(h); return h;
    },
  } : {} });
  return { exports, handles, listeners };
}

test('info: keyboard-open explanation retires listeners and content across data paints, preserves its key, and clears on reading retirement', () => {
  const { exports, handles, listeners } = fixture();
  const paint = (data: number) => {
    const root = { data }; // a distinct painted root per data update
    exports.beginInfoPaint?.(root);
    exports.info('counts', 'About counts', `Reported count ${data}`);
    exports.commitInfoPaint?.(root);
    return handles.at(-1)!;
  };
  const first = paint(0);
  first.focus(); // keyboard focus opens the production wrapper's key
  for (let n = 1; n <= 5; n++) {
    const current = paint(n);
    if (n === 1) first.blur(); // a queued blur from removal is not a current user close
    assert.equal(current.open, true, 'same-key repaint restores the explanation without another activation');
    assert.equal(listeners.size, 2, 'only the current document/window listeners survive');
    for (const retired of handles.slice(0, -1)) {
      assert.equal(retired.open, false);
      assert.ok(![...listeners.values()].includes(retired.content), 'no global listener retains removed content');
    }
  }
  exports.info('lazy', 'About task facts', 'Created by a disclosure toggle after paint commit');
  const lazy = handles.at(-1)!;
  lazy.focus();
  assert.equal(listeners.size, 4);
  paint(6);
  assert.equal(lazy.open, false, 'late-created task facts still belong to the replaced paint');
  assert.equal(listeners.size, 2);
  exports.retireReadingUi();
  assert.equal(listeners.size, 0, 'reading retirement returns to the closed baseline');
  assert.ok(handles.every(h => !h.open));
  assert.equal(paint(7).open, false, 'a retired reading cannot restore its open key');
  exports.retireReadingUi();
});

test('info: lazy row removal unregisters closed and open handles without a full repaint', () => {
  const { exports, handles, listeners } = fixture();
  const children = new Set<object>();
  const body = { contains: (node: object) => children.has(node) };
  exports.beginInfoPaint({});
  for (let n = 0; n < 6; n++) {
    exports.info('task|needs', 'About prerequisites', 'Recorded prerequisites');
    children.add(handles.at(-1)!.root);
    exports.info('task|unlocks', 'About unlocks', 'Recorded dependants');
    children.add(handles.at(-1)!.root);
    assert.equal(exports.trackedInfoCount(), 2, 'only one row worth of handles');
    // The first cycles never open an explanation: closed handles must be released too.
    if (n >= 3) handles.at(-1)!.focus();
    exports.disposeInfoWithin?.(body);
    children.clear();
    assert.equal(exports.trackedInfoCount(), 0, 'collapsing unregisters the removed subtree before the next paint');
    assert.equal(listeners.size, 0, 'a removed open explanation leaves no global listeners');
    assert.ok(handles.every(h => !h.open));
  }
  exports.retireReadingUi();
});
