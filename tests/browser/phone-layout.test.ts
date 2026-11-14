import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDeviceHooks, PHONE_CSS, PHONE_TARGET_PX } from '../../ui/shared/phone-layout.ts';
import { PHONE_LAYOUT_HOOKS } from '../../ui/shared/components.ts';
import { CSS } from '../../ui/shared/style.ts';
import type { DeviceView } from '../../ui/shared/model.ts';

/** The DOM surface applyDeviceHooks uses, recording writes so redundant ones are visible. */
function element() {
  const attrs = new Map<string, string>(), vars = new Map<string, string>(), writes: string[] = [];
  return {
    writes, attrs, vars,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => { writes.push(`attr:${n}`); attrs.set(n, v); },
    removeAttribute: (n: string) => { if (attrs.delete(n)) writes.push(`-attr:${n}`); },
    style: {
      getPropertyValue: (n: string) => vars.get(n) ?? '',
      setProperty: (n: string, v: string) => { writes.push(`var:${n}`); vars.set(n, v); },
      removeProperty: (n: string) => { if (vars.delete(n)) writes.push(`-var:${n}`); return ''; },
    },
  };
}
const PHONE: DeviceView = { formFactor: 'phone', pointer: 'coarse', insets: { top: 47, right: 0, bottom: 34.5, left: 0 }, keyboard: 0 };

test('device hints become presentation hooks; absence leaves no fabricated phone identity', () => {
  const root = element();
  applyDeviceHooks(root as unknown as HTMLElement, undefined);
  assert.equal(root.attrs.size + root.vars.size, 0);
  applyDeviceHooks(root as unknown as HTMLElement, PHONE);
  assert.equal(root.attrs.get(PHONE_LAYOUT_HOOKS.formFactor), 'phone');
  assert.equal(root.attrs.get(PHONE_LAYOUT_HOOKS.pointer), 'coarse');
  assert.deepEqual(Object.fromEntries(root.vars), { '--ap-safe-top': '47px', '--ap-safe-right': '0px', '--ap-safe-bottom': '34.5px', '--ap-safe-left': '0px', '--ap-keyboard-height': '0px' });
  // Unchanged hints (the host re-sends ready) write nothing; a keyboard change writes one variable.
  root.writes.length = 0;
  applyDeviceHooks(root as unknown as HTMLElement, structuredClone(PHONE));
  assert.deepEqual(root.writes, []);
  applyDeviceHooks(root as unknown as HTMLElement, { ...PHONE, keyboard: 300 });
  assert.deepEqual(root.writes, ['var:--ap-keyboard-height']);
  applyDeviceHooks(root as unknown as HTMLElement, undefined);
  assert.equal(root.attrs.size + root.vars.size, 0);
});

test('malformed hints are dropped per hook instead of guessed', () => {
  const root = element();
  applyDeviceHooks(root as unknown as HTMLElement, PHONE);
  const odd = { formFactor: 'watch', pointer: 'coarse', insets: { top: -1, right: Number.NaN, bottom: 1e9, left: '4' }, keyboard: Infinity } as unknown as DeviceView;
  applyDeviceHooks(root as unknown as HTMLElement, odd);
  assert.deepEqual(Object.fromEntries(root.attrs), { [PHONE_LAYOUT_HOOKS.pointer]: 'coarse' });
  assert.equal(root.vars.size, 0);
  applyDeviceHooks(root as unknown as HTMLElement, { formFactor: 'tablet' } as unknown as DeviceView);
  assert.deepEqual(Object.fromEntries(root.attrs), { [PHONE_LAYOUT_HOOKS.formFactor]: 'tablet' });
});

test('phone CSS ships in the shared stylesheet, scoped away from Work Status and the map', () => {
  assert.ok(CSS.includes(PHONE_CSS));
  const coarse = PHONE_CSS.split('\n').filter((l) => l.includes(`[${PHONE_LAYOUT_HOOKS.pointer}`));
  assert.ok(coarse.length > 10);
  for (const rule of coarse) {
    for (const selector of rule.slice(0, rule.indexOf('{')).split(/,(?![^(]*\))/)) {
      assert.match(selector, /^html(:not\(\[data-device-pointer="fine"\]\)|\[data-device-pointer="coarse"\]):not\(\[data-oc-surface="status"\]\) /, selector);
      // Unqualified generic controls would reach the map's own toolbar: those carry the exclusion.
      if (/\) (\.oc-sdk-(btn|trigger|tab|input)|\.ap-link|textarea|input)\b/.test(selector)) assert.match(selector, /:not\(\.ap-map \*\)$/, selector);
    }
  }
  assert.ok(PHONE_CSS.includes(`min-height:${PHONE_TARGET_PX}px`));
  // Every inset/keyboard term falls back to env() or 0, so desktop without hints is unchanged.
  for (const hook of [PHONE_LAYOUT_HOOKS.safeLeft, PHONE_LAYOUT_HOOKS.safeRight, PHONE_LAYOUT_HOOKS.safeBottom]) assert.ok(PHONE_CSS.includes(`var(${hook},env(safe-area-inset-`), hook);
  assert.ok(PHONE_CSS.includes(`var(${PHONE_LAYOUT_HOOKS.keyboard},0px)`));
});
