// Runs the production startView hooks of the board page with supplied globals.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import ts from 'typescript';
import { admitsQuiet } from '../../ui/shared/quiet-plans.ts';

const file = ts.createSourceFile('page.ts', readFileSync(new URL('../../ui/page/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
export function pageHook(name: string, globals: Record<string, unknown>) {
  let expression = '';
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'startView' && ts.isObjectLiteralExpression(node.arguments[0])) {
      const property = node.arguments[0].properties.find(p => (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name.getText(file) === name);
      if (property && ts.isPropertyAssignment(property)) expression = property.initializer.getText(file);
      // A method shorthand (paint(root, vc) { ... }) is evaluated as a function value.
      else if (property && ts.isMethodDeclaration(property)) expression = `function ${property.getText(file)}`;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(expression, name);
  return runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}

/** Defines a module-level page function in the globals' context, so hooks and the function share page state. */
export function pageFunction(name: string, globals: Record<string, unknown>) {
  const node = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  createContext(globals);
  runInContext(ts.transpileModule(node.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}

/** Supply the same filter to extracted page hooks as the production module uses. */
export function pageQuietFilter(globals: Record<string, unknown>) {
  globals.admitsQuiet = admitsQuiet;
  globals.search ??= { quietRefreshRequired: false };
  pageFunction('quietKeys', globals);
  pageFunction('bulkCleanupAvailable', globals);
}
