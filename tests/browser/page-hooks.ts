// Runs the production startView hooks of the board page with supplied globals.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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
