/** Focused primitive/component behavior in a real browser with production guest CSS. */
export async function primitiveQa(q: {
  guest: <T = any>(surface: string, code: string) => Promise<T>;
  evaluate: <T = any>(code: string) => Promise<T>;
  wait: (surface: string, condition: string, what?: string) => Promise<unknown>;
  click: (surface: string, selector: string) => Promise<void>;
  key: (key: string, times?: number, modifiers?: number) => Promise<void>;
  check: (id: string, pass: boolean) => void;
  c: { send: (method: string, params?: object) => Promise<any> };
  show: (surfaces: string[], width: number) => Promise<void>;
  shot: (name: string, selector?: string, pad?: number, height?: number, surface?: string) => Promise<void>;
}) {
  const { guest, evaluate, wait, click, key, check, c } = q;
  const g = <T = any>(code: string) => guest<T>('page', code);
  const info = '[data-testid="info-trigger"]';
  const open = `d.querySelector('${info}').getAttribute('aria-expanded')==='true'`;
  const closed = `d.querySelector('${info}').getAttribute('aria-expanded')==='false'&&d.querySelector('[data-testid="info-content"]').hidden`;
  await evaluate(`qa.primitiveTokens=Object.fromEntries([...getComputedStyle(frame('page').contentDocument.documentElement)].filter(k=>k.startsWith('--oc-')).map(k=>[k,getComputedStyle(frame('page').contentDocument.documentElement).getPropertyValue(k)]));frame('page').src='/primitives.html';true`);
  await wait('page', '!!w.primitiveFixture', 'supplement mounted');
  await g(`for(const [k,v] of Object.entries(parent.qa.primitiveTokens))d.documentElement.style.setProperty(k,v);return true`);
  const ax = async () => {
    const tree = await c.send('Page.getFrameTree');
    const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.endsWith('/primitives.html')).frame.id;
    return (await c.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  check('primitive:zero-chip-null', await g('return w.primitiveFixture.zeroChip'));
  check('primitive:zero-bar-null', await g('return w.primitiveFixture.zeroBar'));
  check('primitive:info-describedby', await g(`const b=d.querySelector('${info}');return b.getAttribute('aria-describedby')===d.querySelector('[data-testid="info-content"]').id&&b.getAttribute('aria-controls')===b.getAttribute('aria-describedby')`));
  check('primitive:info-closed-AX', !(await ax()).some((n: any) => !n.ignored && n.role?.value === 'link' && n.name?.value === 'Read fixture explanation'));
  await click('page', info); await wait('page', open);
  check('primitive:info-click-keeps-trigger-focus', await g(`return d.activeElement===d.querySelector('${info}')`));
  check('primitive:info-open-AX', (await ax()).some((n: any) => !n.ignored && n.role?.value === 'link' && n.name?.value === 'Read fixture explanation'));
  await key('Tab');
  check('primitive:info-tab-content', await g(`return d.activeElement.textContent==='Read fixture explanation'`));
  await key('Escape'); await wait('page', closed);
  check('primitive:info-escape-focus-no-reopen', await g(`return d.activeElement===d.querySelector('${info}')`));
  await click('page', '#outside'); await key('Tab'); await wait('page', open);
  check('primitive:info-focus-opens', await g(`return d.activeElement===d.querySelector('${info}')`));
  check('primitive:info-visible-keyboard-focus', await g(`return getComputedStyle(d.querySelector('${info}')).outlineStyle!=='none'`));
  await click('page', '#outside'); await wait('page', closed);
  check('primitive:info-outside-dismisses', true);
  // Keyboard entry demonstrates information is available without hover or a pointer.
  await key('Tab'); await wait('page', open); await key('Escape');
  await key('Tab'); await key(' ');
  check('primitive:chip-space-toggle-once', await g(`return w.primitiveFixture.toggles===1&&d.activeElement.getAttribute('aria-pressed')==='true'`));
  await key('Enter');
  check('primitive:chip-enter-toggle-once', await g(`return w.primitiveFixture.toggles===2&&d.activeElement.getAttribute('aria-pressed')==='false'`));
  check('primitive:chip-informational-not-interactive', await g(`const n=[...d.querySelectorAll('[data-testid="state-chip"]')].find(n=>n.dataset.state==='done');return n.tagName==='SPAN'&&!n.hasAttribute('tabindex')&&!n.hasAttribute('aria-pressed')`));
  check('primitive:chip-AX-name-state', (await ax()).some((n: any) => !n.ignored && n.role?.value === 'button' && n.name?.value === '1 Needs you' && n.properties?.some((p: any) => p.name === 'pressed' && p.value.value === 'false')));
  check('primitive:marks-named', await g(`return [...d.querySelectorAll('#marks [data-testid="status-mark"]')].every(n=>n.getAttribute('role')==='img'&&n.getAttribute('aria-label')&&(n.dataset.status!=='working'||n.getAttribute('aria-label')==='Reported working'))`));
  check('primitive:decorative-mark-icon', await g(`return d.querySelector('.decorative').getAttribute('aria-hidden')==='true'&&d.querySelector('[data-icon="close"]').getAttribute('aria-hidden')==='true'&&[...d.querySelectorAll('svg')].every(n=>n.getAttribute('aria-hidden')==='true'&&n.getAttribute('focusable')==='false')`));
  check('primitive:bar-labelled-segments-hidden', await g(`const b=d.querySelector('[data-testid="progress-bar"]');return b.getAttribute('role')==='img'&&b.getAttribute('aria-label').includes('3 of 8')&&[...b.children].every(n=>n.getAttribute('aria-hidden')==='true'&&n.dataset.status&&!n.style.width.includes('NaN'))`));
  await click('page', '[data-testid="plan-actions"] button');
  await wait('page', `d.querySelector('[role="menu"]')`);
  await key('Home'); await key('ArrowDown'); await key('ArrowUp'); await key('ArrowDown'); await key('Enter');
  check('primitive:menu-arrow-enter-select', await g(`return w.primitiveFixture.selected==='document'`));
  check('primitive:menu-select-focus-return', await g(`return !!d.activeElement.closest('[data-testid="plan-actions"]')&&!d.querySelector('[role="menu"]')`));
  await key('Enter'); await wait('page', `d.querySelector('[role="menu"]')`); await key('Escape');
  check('primitive:menu-escape-focus-return', await g(`return !!d.activeElement.closest('[data-testid="plan-actions"]')&&!d.querySelector('[role="menu"]')`));
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  check('primitive:forced-colors-distinct-visible-marks', await g(`const m=[...d.querySelectorAll('#marks .ap-mark')];return matchMedia('(forced-colors: active)').matches&&m.every(n=>n.getBoundingClientRect().width>0&&getComputedStyle(n).visibility==='visible')&&new Set(m.map(n=>n.querySelector('svg').innerHTML)).size===7`));
  check('primitive:forced-colors-foreground-cut-contrast', await g(`const mark=d.querySelector('#marks [data-status="done"]');return getComputedStyle(mark).color!==getComputedStyle(mark.querySelector('.ap-mark-cut')).stroke`));
  await q.shot('primitives-forced-colors', '#root', 0, 1500, 'page');
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const width of [360, 280, 550, 275]) {
    await q.show(['page'], width);
    await click('page', '#outside'); await key('Tab'); await wait('page', open);
    check(`primitive:reflow-${width}:no-overflow`, await g(`return d.documentElement.scrollWidth<=w.innerWidth+1`));
    await key('Tab'); await key('Escape');
    check(`primitive:reflow-${width}:escape-return`, await g(`return d.activeElement===d.querySelector('${info}')`));
  }
  await q.shot('primitives-reflow-275', '#root', 0, 1500, 'page');
  await q.show(['page'], 1100);
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  check('primitive:normal-motion-bar-static', await g(`return [...d.querySelectorAll('[data-testid="progress-bar"] i')].every(n=>getComputedStyle(n).transitionDuration==='0s'&&getComputedStyle(n).animationName==='none')`));
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // Restored-open disclosure (built with open:true before its root is attached, as a repaint does),
  // at the right edge of a narrow frame: once attached it is positioned inside the frame; a remount
  // does the same; retiring it leaves no document listener and moves no focus.
  const listeners = () => g<number>('return w.primitiveFixture.listeners');
  const edgePlaced = `(()=>{const c=d.querySelectorAll('[data-edge] [data-testid="info-content"]');if(c.length!==1||c[0].hidden)return false;const r=c[0].getBoundingClientRect(),vw=d.documentElement.clientWidth;return c[0].style.getPropertyValue('--ap-info-shift')!==''&&r.left>=0&&r.right<=vw-8+1&&d.documentElement.scrollWidth<=w.innerWidth+1})()`;
  const baseline = await listeners();
  await q.show(['page'], 280);
  await g('w.__edgeFocus=d.activeElement;w.primitiveFixture.restoreEdge();return true');
  await wait('page', edgePlaced, 'restored-open right-edge disclosure positioned inside the frame');
  check('primitive:info-restored-open-positioned', await g(`return ${edgePlaced}&&d.querySelector('[data-edge] [data-testid="info-trigger"]').getAttribute('aria-expanded')==='true'`));
  await g('w.primitiveFixture.restoreEdge();return true');
  await wait('page', edgePlaced, 'remounted restored-open disclosure positioned inside the frame');
  check('primitive:info-remount-positioned', await g(`return ${edgePlaced}`));
  check('primitive:info-restored-open-no-focus-theft', await g('return d.activeElement===w.__edgeFocus'));
  // The frame narrows while the explanation stays open: it is re-placed inside the new frame.
  await g('w.primitiveFixture.clearEdge();return true');
  await q.show(['page'], 1100);
  await g('w.primitiveFixture.restoreEdge();return true');
  await wait('page', edgePlaced, 'wide open edge disclosure placed');
  // Narrow enough that the content's own width shrinks too, so the wide frame's shift no longer fits.
  await q.show(['page'], 200);
  await wait('page', edgePlaced, 'open disclosure re-placed after the frame narrowed');
  check('primitive:info-open-replaced-on-resize', await g(`return ${edgePlaced}`));
  await g('w.primitiveFixture.clearEdge();return true');
  check('primitive:info-restored-retired-no-listener', (await listeners()) === baseline);
  await q.show(['page'], 1100);
  // Menu retired while OPEN (a repaint replacing it): no orphan popup, no leaked listener, no
  // focus moved to the replacement; the replacement still works.
  const menuBase = await listeners();
  await click('page', '[data-testid="plan-actions"] button');
  await wait('page', `d.querySelector('[role="menu"]')`);
  check('primitive:menu-open-listeners-observed', (await listeners()) > menuBase);
  await g('w.primitiveFixture.remountMenu();return true');
  check('primitive:menu-retired-open-no-orphan', await g(`return !d.querySelector('[role="menu"],.oc-sdk-popup')&&d.querySelectorAll('[data-testid="plan-actions"]').length===1`));
  check('primitive:menu-retired-open-no-listener', (await listeners()) === menuBase);
  check('primitive:menu-retired-open-no-focus-theft', await g(`const t=d.querySelector('[data-testid="plan-actions"] button');return !d.activeElement?.closest?.('[data-testid="plan-actions"]')&&t.getAttribute('aria-expanded')!=='true'`));
  await click('page', '[data-testid="plan-actions"] button');
  await wait('page', `d.querySelector('[role="menu"]')`); await key('Escape');
  check('primitive:menu-remounted-works', await g(`return !d.querySelector('[role="menu"]')&&!!d.activeElement.closest('[data-testid="plan-actions"]')&&w.primitiveFixture.listeners===${menuBase}`));
  await click('page', info); await wait('page', open);
  await g('w.primitiveFixture.dispose();return true'); await wait('page', closed);
  await click('page', '#outside'); await key('Tab');
  check('primitive:disposed-info-stays-closed', await g(`return ${closed}`));
  await g('w.primitiveFixture.retire();return true');
  check('primitive:retirement-no-orphan-popup', await g(`return !d.querySelector('[data-testid="info-content"],[role="menu"]')`));
  const paintBaseline = await listeners();
  await g(`w.primitiveFixture.repaintInfo();d.querySelector('#painted-info [data-testid="info-trigger"]').focus();return true`);
  await key('Tab'); await key('Tab', 1, 8);
  await wait('page', `d.querySelector('#painted-info [aria-expanded="true"]')`, 'keyboard-open painted explanation');
  for (let n = 0; n < 5; n++) await g('w.primitiveFixture.repaintInfo();return true');
  check('primitive:painted-info-open-state-restored', await g(`return !!d.querySelector('#painted-info [aria-expanded="true"]')`));
  check('primitive:painted-info-listeners-bounded', (await listeners()) === paintBaseline + 2);
  await g('return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))');
  await c.send('HeapProfiler.collectGarbage');
  check('primitive:painted-info-removed-content-collected', await g('return w.primitiveFixture.retainedContent===0'));
  await g('w.primitiveFixture.retirePaintedInfo();w.dispatchEvent(new w.Event("resize"));return true');
  check('primitive:painted-info-retired-listeners-baseline', (await listeners()) === paintBaseline);
  await g('w.primitiveFixture.mountLazyRows();return true');
  const row = '[data-testid="item-toggle-A"]';
  const rowBaseline = await listeners();
  for (let n = 0; n < 6; n++) {
    await g(`d.querySelector('${row} > summary').focus();return true`); await key('Enter');
    await wait('page', `d.querySelectorAll('${row} [data-testid="info-content"]').length===2`, 'one current row worth of lazy explanations');
    if (n === 3) {
      await key('Tab');
      await wait('page', `d.querySelector('${row} [data-testid="info-trigger"][aria-expanded="true"]')`, 'keyboard-open explanation in lazy facts');
      check('primitive:lazy-info-adds-only-current-listeners', (await listeners()) === rowBaseline + 2);
    }
    await g(`d.querySelector('${row}').open=false;return true`);
    await wait('page', `!d.querySelector('${row} [data-testid="info-content"]')`, 'collapsed facts removed in place');
    check(`primitive:lazy-collapse-${n}:listeners-baseline`, (await listeners()) === rowBaseline);
  }
  await g(`d.querySelector('${row} > summary').focus();return true`); await key('Enter');
  await wait('page', `d.querySelector('${row} [data-testid="info-trigger"]')`, 'fresh facts recreated');
  check('primitive:lazy-reopen-has-only-current-explanations', await g(`return d.querySelectorAll('${row} [data-testid="info-content"]').length===2`));
  await key('Tab');
  await wait('page', `d.querySelector('${row} [data-testid="info-trigger"][aria-expanded="true"]')`, 'recreated explanation opens on keyboard focus');
  await key('Escape');
  check('primitive:lazy-recreated-info-escape-closes', await g(`return d.activeElement.matches('${row} [data-testid="info-trigger"]')&&d.activeElement.getAttribute('aria-expanded')==='false'`) && (await listeners()) === rowBaseline);
  await g('w.primitiveFixture.retirePaintedInfo();return true');
}
