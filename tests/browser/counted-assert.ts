import nodeAssert from 'node:assert/strict';

/** Count executed assertions in legacy imperative QA drivers without changing their semantics. */
export function countedAssertions() {
  let count = 0;
  const assert = new Proxy(nodeAssert, {
    apply(target, self, args) { count++; return Reflect.apply(target, self, args); },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (...args: unknown[]) => { count++; return Reflect.apply(value, target, args); } : value;
    },
  });
  return { assert, count: () => count };
}
