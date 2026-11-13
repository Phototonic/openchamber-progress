/** Unmodified test-only projection from the supplied pre-retirement base.
 * Evaluate whole source bytes, never a rewritten parser or today's compatibility code.
 * Only relative dependencies outside the four retired owners use current helpers.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';

export const PRE_RETIREMENT_BASE = '676eea96c8d47e933e58d26fe9ad64d0130f225e';
const owners = new Set(['adapter.ts', 'source.ts', 'official.ts', 'config.ts']);
const cache = new Map<string, any>();
export function oldUpdateModule(name: string): any {
  if (!owners.has(name)) throw Error('Unknown compatibility fixture owner');
  if (cache.has(name)) return cache.get(name);
  const bytes = execFileSync('git', ['show', `${PRE_RETIREMENT_BASE}:ui/shared/${name}`], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 5000,
  });
  const js = ts.transpileModule(bytes, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  cache.set(name, exports);
  const require = createRequire(new URL(`../../ui/shared/${name}`, import.meta.url));
  runInThisContext(`(function(exports, require) {\n${js}\n})`)(exports, (id: string) =>
    id.startsWith('./') && owners.has(id.slice(2)) ? oldUpdateModule(id.slice(2)) : require(id));
  return exports;
}
