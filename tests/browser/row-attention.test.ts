import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { planInboxComplete, type InboxModel } from '../../ui/shared/inbox.ts';

// Run the production page's rowAttention against a stubbed frame.
const source = readFileSync(new URL('../../ui/page/main.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true);
const fn = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'rowAttention');
assert(fn);
const code = ts.transpileModule(fn.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const model = { availability: 'ready', needsYou: [], alsoBlocked: [], counts: { needsYou: 1, alsoBlocked: 0 }, complete: true } as unknown as InboxModel;
const plan = { key: 's/p', revision: 1 };
const part = { needsYou: [], alsoBlocked: [], hidden: [], counts: { needsYou: 1, alsoBlocked: 0 } };

function attention(failure: unknown) {
  const frame = { inbox: { model, device: undefined, storeId: '' }, failure, detail: () => undefined };
  const globals = createContext({ frame, rowInbox: new Map([['s/p', part]]), planInboxComplete });
  runInContext(code, globals);
  return JSON.parse(JSON.stringify((globals as unknown as { rowAttention: (p: unknown) => unknown }).rowAttention(plan)));
}

test('a board row count is exact only while the read is fresh', () => {
  assert.deepEqual(attention(null), { count: 1, complete: true });
  // After a failed refresh the retained count stays qualified, like the selected plan's inbox.
  assert.deepEqual(attention({ kind: 'unavailable' }), { count: 1, complete: false });
});
