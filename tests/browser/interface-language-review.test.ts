import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('reading QA creates its temporary-profile parent on a fresh machine', () => {
  const source = readFileSync(new URL('./interface-language-reading-qa.ts', import.meta.url), 'utf8');
  const prefix = source.slice(0, source.indexOf('const results:'));
  const directories = new Set<string>();
  let created = false;
  const code = ts.transpileModule(prefix, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    exports: {}, process: { argv: ['node', 'qa.ts', '--artifacts', '/artifacts'], env: {} },
    require: (name: string) => name === 'node:fs' ? {
      mkdirSync: (path: string) => directories.add(path),
      existsSync: (path: string) => path === '/usr/bin/chromium',
      mkdtempSync: (prefix: string) => {
        assert.ok(directories.has(dirname(prefix)), 'profile parent must exist before mkdtemp');
        created = true; return prefix + 'synthetic';
      },
    } : name === 'node:os' ? { homedir: () => '/synthetic-home' }
      : name === 'node:path' ? { resolve, dirname, join: (...parts: string[]) => parts.join('/'), isAbsolute: (p: string) => p.startsWith('/') } : {},
  });
  assert.equal(created, true);
});

test('archived interface-language documents retain working relative links', () => {
  const root = new URL('../../openspec/changes/archive/2026-11-12-add-interface-language-selection/', import.meta.url);
  let checked = 0;
  for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
    const url = new URL(file, root);
    for (const [, link] of readFileSync(url, 'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^[a-z]+:\/\//.test(link)) continue;
      const target = new URL(link.split('#')[0], url);
      assert.ok(existsSync(target), `${file}: ${link}`);
      checked++;
    }
  }
  assert.ok(checked >= 9);
});
