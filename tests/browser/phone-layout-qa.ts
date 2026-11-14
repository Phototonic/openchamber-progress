// Phone-layout QA (QA-U phone) in an isolated headless Chromium: rail panel and full board at
// 390 x 844 with touch emulation, landscape, 200%/400% reflow and an ordinary desktop width, in
// light/dark and English/Russian, reduced motion. Real CDP taps, clicks and keys only.
// Usage: node --experimental-strip-types tests/browser/phone-layout-qa.ts --source --chromium <path> --artifacts <dir>
//   --source builds disposable guests from the current TypeScript (never overwrites tracked bundles);
//   without it the tracked bundles are served. Writes results.json, panel.png, board.png and more.
// Viewport/touch emulation and simulated ready.device hints are supporting evidence only: NOT
// physical-phone, native-host or relay certification.
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPhoneShell } from './phone-layout-shell.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';
import { progressInput } from './progress-qa.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: phone-layout-qa.ts [--source] --chromium <path> --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });
const source = process.argv.includes('--source');

type Result = { id: string; pass: boolean; facts?: unknown };
const results: Result[] = [];
const shots: string[] = [];
function check(id: string, pass: boolean, facts?: unknown) {
  results.push({ id, pass, ...(facts === undefined ? {} : { facts }) });
  if (!pass) throw new Error(`${id} failed${facts === undefined ? '' : `: ${JSON.stringify(facts).slice(0, 1200)}`}`);
}

const PHONE = { formFactor: 'phone', pointer: 'coarse', insets: { top: 47, right: 0, bottom: 34, left: 0 }, keyboard: 0 } as const;
const HOOKS = ['data-device-form-factor', 'data-device-pointer'];
const VARS = ['--ap-safe-top', '--ap-safe-right', '--ap-safe-bottom', '--ap-safe-left', '--ap-keyboard-height'];

const fx = await startPhoneShell({ source });
const browser = await launchChromium(chromiumPath(arg('--chromium')));
let failure: string | null = null;
let deviceHooks: 'host-ready' | 'simulated' | null = null;
try {
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(f: string, code: string) => evaluate<T>(`(()=>{const w=frame('${f}').contentWindow,d=w.document;${code}})()`);
  /** Observed state on animation frames, bounded; never a fixed sleep. */
  const wait = async (f: string, cond: string, what = cond, ms = 20_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{const w=frame('${f}').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>requestAnimationFrame(r));}return false})()`);
    if (!ok) {
      const seen = await guest(f, `const a=d.activeElement;return {active:a?.closest('[data-testid]')?.dataset.testid??a?.tagName,popup:!!d.querySelector('[role="listbox"],[role="menu"]'),y:Math.round(w.scrollY),text:d.body.innerText.slice(0,240)}`).catch(() => null);
      throw new Error(`timed out waiting (${f}): ${what} ${JSON.stringify(seen)}`);
    }
  };
  const frames2 = (f: string) => guest(f, 'return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(()=>r(true))))');
  type Mode = { width: number; height: number; touch: boolean; scale?: number };
  let mode: Mode = { width: 390, height: 844, touch: true };
  const viewport = async (m: Mode) => {
    mode = m;
    await c.send('Emulation.setDeviceMetricsOverride', { width: m.width, height: m.height, deviceScaleFactor: m.scale ?? (m.touch ? 3 : 1), mobile: m.touch });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: m.touch, ...(m.touch ? { maxTouchPoints: 5 } : {}) });
  };
  const show = async (f: string) => { await evaluate(`qa.show('${f}',${mode.width},${mode.height});true`); await wait(f, `w.innerWidth===${mode.width}&&w.innerHeight===${mode.height}`, `${f} at ${mode.width}x${mode.height}`); };
  /** Centre point of a guest element in page coordinates, scrolled into the frame's view. */
  const point = async (f: string, selector: string) => {
    const p = await guest<[number, number] | null>(f, `const n=d.querySelector(${js(selector)});if(!n)return null;n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+Math.min(r.width/2,22),o.y+r.y+Math.min(r.height/2,22)]`);
    if (!p) throw new Error(`missing ${selector} in ${f}`);
    await frames2(f);
    return p;
  };
  const tap = async (f: string, selector: string) => {
    const [x, y] = await point(f, selector);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const mouse = async (f: string, selector: string) => {
    const [x, y] = await point(f, selector);
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 });
  };
  const click = (f: string, selector: string) => (mode.touch ? tap(f, selector) : mouse(f, selector));
  const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, Home: 36, End: 35, ArrowDown: 40, ArrowUp: 38 };
  const key = async (k: string, times = 1, shift = false) => {
    for (let i = 0; i < times; i++) {
      const text = k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
      const base = { key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] ?? 0, modifiers: shift ? 8 : 0 };
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...text });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    }
  };
  const progressUi = progressInput({ guest, wait, click, key });
  const shot = async (name: string, full = false) => {
    let height = mode.height;
    const f = await evaluate<string>(`[...document.querySelectorAll('section[data-frame]')].find(n=>n.style.display==='block').dataset.frame`);
    if (full) { height = Math.min(await guest<number>(f, 'return d.documentElement.scrollHeight'), 5000); await evaluate(`frame('${f}').style.height='${height}px';true`); await frames2(f); }
    else await guest(f, 'w.scrollTo(0,0);return true');
    const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: { x: 0, y: 0, width: mode.width, height, scale: 1 } });
    if (full) { await evaluate(`frame('${f}').style.height='${mode.height}px';true`); await frames2(f); }
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  /** Horizontal overflow of the frame document and of any visible element (popups included). */
  const overflow = (f: string) => guest<{ ok: boolean; sw: number; cw: number; out: string[] }>(f, `const cw=d.documentElement.clientWidth,sw=d.documentElement.scrollWidth;const out=[...d.querySelectorAll('body *')].filter(n=>{if(n.closest('.ap-map-canvas,.ap-map-world,[data-testid="map-viewport"],.ap-sr'))return false;const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&(r.right>cw+0.5||r.left<-0.5)}).map(n=>n.dataset.testid||String(n.className).slice(0,40)||n.tagName).slice(0,10);return {ok:sw<=cw&&!out.length,sw,cw,out}`);
  /** Visible interactive targets smaller than 44 x 44 CSS px. The map is audited by its own lane. */
  const smallTargets = (f: string) => guest<string[]>(f, `const sel='button,summary,a[href],select,input:not([type=hidden]),textarea,[role=tab],[role=option],[role=menuitem],[tabindex="0"]';return [...d.querySelectorAll(sel)].filter(n=>{if(n.closest('.ap-map,[hidden],.ap-sr'))return false;const r=n.getBoundingClientRect();if(!r.width||!r.height)return false;const s=w.getComputedStyle(n);if(s.visibility==='hidden'||s.display==='none')return false;return r.width<43.5||r.height<43.5}).map(n=>{const r=n.getBoundingClientRect();return (n.dataset.testid||n.closest('[data-testid]')?.dataset.testid||'')+' '+n.tagName+' '+Math.round(r.width)+'x'+Math.round(r.height)})`);
  const hooks = (f: string) => guest<Record<string, string | null>>(f, `const h=d.documentElement,o={};for(const a of ${js(HOOKS)})o[a]=h.getAttribute(a);for(const v of ${js(VARS)})o[v]=h.style.getPropertyValue(v)||null;return o`);
  /** Delivers a host ready (optionally with device hints) and waits until the guest processed it. */
  const ready = async (device: unknown) => {
    await evaluate(`qa.setDevice(${device === undefined ? 'undefined' : js(device)});true`);
    for (const f of ['panel', 'page']) {
      await guest(f, `return new Promise(r=>{const id='qa-sentinel-'+Math.random();const on=e=>{if(e.data===id){w.removeEventListener('message',on);r(true)}};w.addEventListener('message',on);w.postMessage(id,'*')})`);
      await frames2(f);
    }
  };
  /** Presentation hooks for this run: the guest's own host-ready wiring when present, otherwise a
   * labelled simulation that writes exactly what applyDeviceHooks writes (unit-tested separately). */
  const device = async (d: typeof PHONE | Record<string, unknown> | undefined) => {
    await ready(d);
    if (deviceHooks === null) deviceHooks = (await hooks('panel'))['data-device-pointer'] === (d as any)?.pointer && d ? 'host-ready' : 'simulated';
    if (deviceHooks === 'simulated') for (const f of ['panel', 'page']) await guest(f, `const h=d.documentElement,v=${d === undefined ? 'null' : js(d)};
      const set=(a,x)=>x?h.setAttribute(a,x):h.removeAttribute(a);set('data-device-form-factor',v?.formFactor);set('data-device-pointer',v?.pointer);
      const px=x=>typeof x==='number'?x+'px':null,p=(n,x)=>x===null?h.style.removeProperty(n):h.style.setProperty(n,x);
      p('--ap-safe-top',px(v?.insets?.top));p('--ap-safe-right',px(v?.insets?.right));p('--ap-safe-bottom',px(v?.insets?.bottom));p('--ap-safe-left',px(v?.insets?.left));p('--ap-keyboard-height',px(v?.keyboard));return true`);
    for (const f of ['panel', 'page']) await frames2(f);
  };
  const listPanel = async () => {
    await wait('panel', `d.querySelector('[data-testid="plan-view-list"] button')`, 'rail plan view');
    if (!(await guest<boolean>('panel', `return !!d.querySelector('article[data-testid="plan-P-phone"] .ap-tasks[data-complete]')`))) await progressUi.list('panel');
    await wait('panel', `d.querySelector('article[data-testid="plan-P-phone"] .ap-tasks[data-complete]')`, 'rail list reading complete');
  };
  const boardDetail = async () => {
    await wait('page', `d.querySelector('[data-testid="plan-row-P-phone"]')`, 'board rows');
    if (!(await guest<boolean>('page', `return d.querySelector('[data-testid="plan-row-P-phone"]')?.getAttribute('aria-selected')==='true'||!!d.querySelector('[data-testid="plan-detail"] article[data-testid="plan-P-phone"]')`))) await click('page', '[data-testid="plan-row-P-phone"]');
    await wait('page', `d.querySelector('[data-testid="detail-tabs"] [data-id="progress"]')`, 'detail tabs');
    if (!(await guest<boolean>('page', `return !!d.querySelector('[data-testid="plan-detail"] .ap-tasks[data-complete]')`))) await click('page', '[data-testid="detail-tabs"] [data-id="progress"]');
    await wait('page', `d.querySelector('[data-testid="plan-detail"] article[data-testid="plan-P-phone"] .ap-tasks[data-complete]')`, 'board progress complete');
  };
  const layout = async (f: string, id: string, targets = true) => {
    const o = await overflow(f);
    check(`${id}:no-horizontal-overflow`, o.ok, o);
    if (targets) { const small = await smallTargets(f); check(`${id}:touch-targets-44`, small.length === 0, small); }
  };

  // ============================================================ 390 x 844 phone, light, English
  await viewport({ width: 390, height: 844, touch: true });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
  await evaluate(`new Promise(r=>{const t=()=>window.qa&&frame('panel')?.contentDocument?.querySelector('[data-testid="progress-root"]')&&frame('page')?.contentDocument?.querySelector('[data-testid="progress-root"]')?r(true):setTimeout(t,50);t()})`);
  await show('panel');
  check('env:coarse-pointer-emulated', await guest<boolean>('panel', `return w.matchMedia('(pointer: coarse)').matches&&w.matchMedia('(prefers-reduced-motion: reduce)').matches`));
  check('device:absent-no-fabricated-hooks', Object.values(await hooks('panel')).every((v) => v === null), await hooks('panel'));

  await listPanel();
  await layout('panel', 'panel-390');
  check('panel-390:rows-tall-enough', await guest<boolean>('panel', `return [...d.querySelectorAll('article[data-testid="plan-P-phone"] summary.ap-trow-line')].every(n=>n.getBoundingClientRect().height>=44)`));
  await shot('panel'); await shot('panel-full', true);

  // Task navigation by tap: open facts, follow a recorded prerequisite to its canonical row.
  await progressUi.expand('panel', 'task-d');
  check('panel-390:task-facts-open-by-tap', await guest<boolean>('panel', `return d.querySelector('details[data-testid="item-toggle-task-d"]').open`));
  const dep = await guest<string | null>('panel', `const b=[...d.querySelectorAll('details[data-testid="item-toggle-task-d"] button.ap-ready-link')].find(n=>/Адаптировать/.test(n.textContent));if(!b)return null;b.setAttribute('data-qa-dep','1');return b.textContent`);
  check('panel-390:prerequisite-link-present', !!dep, dep);
  await click('panel', 'button[data-qa-dep]');
  await wait('panel', `d.activeElement?.closest('li[data-testid="item-task-b"]')`, 'focus on the prerequisite row');
  const reveal = await guest<any>('panel', `const r=d.activeElement.getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:w.innerHeight}`);
  check('panel-390:reveal-focus-in-view', reveal.top >= 0 && reveal.top < reveal.h, reveal);

  // Plan picker (SDK select) by tap: options are 44 px and fit the phone width; choose, then return.
  await click('panel', '[data-testid="plan-selector"] button');
  await wait('panel', `d.querySelector('[role="listbox"] [role="option"]')`, 'plan picker open');
  const picker = await guest<any>('panel', `const p=d.querySelector('[role="listbox"]').getBoundingClientRect(),o=[...d.querySelectorAll('[role="listbox"] [role="option"]')].map(n=>n.getBoundingClientRect().height);return {left:p.left,right:p.right,top:p.top,bottom:p.bottom,w:w.innerWidth,h:w.innerHeight,options:o}`);
  check('panel-390:picker-inside-screen', picker.left >= 0 && picker.right <= picker.w && picker.top >= 0 && picker.bottom <= picker.h, picker);
  check('panel-390:picker-options-44', picker.options.every((h: number) => h >= 44), picker.options);
  await guest('panel', `[...d.querySelectorAll('[role="listbox"] [role="option"]')].find(n=>/Второй план/.test(n.textContent)).setAttribute('data-qa-pick','1');return true`);
  await click('panel', '[data-qa-pick]');
  await wait('panel', `d.querySelector('[data-testid="plan-P-second"] .ap-tasks[data-complete]')||d.querySelector('[data-testid="map-region"][data-state="ready"]')`, 'second plan reading shown');
  await frames2('panel');
  await click('panel', '[data-testid="plan-selector"] button');
  await wait('panel', `d.querySelector('[role="listbox"] [role="option"]')`, 'plan picker open again');
  await guest('panel', `[...d.querySelectorAll('[role="listbox"] [role="option"]')].find(n=>/Phone layout/.test(n.textContent)).setAttribute('data-qa-pick','2');return true`);
  await click('panel', '[data-qa-pick="2"]');
  await listPanel();

  // Sheet from ⋯ (Sessions): opens with its heading focused, closes with a visible labelled control.
  await progressUi.action('panel', 'sessions');
  await wait('panel', `d.querySelector('.ap-panel') && d.activeElement?.closest('.ap-panel')`, 'sessions sheet focused');
  const sheet = await guest<any>('panel', `const p=d.querySelector('.ap-panel'),b=[...p.querySelectorAll('.ap-panel-head button')];b.forEach(n=>n.setAttribute('data-qa-close','1'));return {close:b.map(n=>n.textContent||n.getAttribute('aria-label')),focus:d.activeElement.tagName}`);
  check('panel-390:sheet-close-visible', sheet.close.length === 1 && !!sheet.close[0], sheet);
  await layout('panel', 'panel-390-sheet');
  await click('panel', '[data-qa-close]');
  await wait('panel', `!d.querySelector('.ap-panel')`, 'sheet closed');
  const after = await guest<any>('panel', `const a=d.activeElement;return {tag:a?.tagName,testid:a?.closest('[data-testid]')?.dataset.testid??null,inRoot:!!a?.closest('[data-testid="progress-root"]')}`);
  check('panel-390:focus-after-sheet', after.inRoot && after.tag !== 'BODY', after);

  // List ↔ Map without hover: both are labelled taps; returning to List keeps the reading.
  await click('panel', '[data-testid="plan-view-map"] button');
  await wait('panel', `d.querySelector('[data-testid="map-region"]')`, 'map shown');
  await click('panel', '[data-testid="plan-view-list"] button');
  await listPanel();
  check('panel-390:list-after-map', await guest<boolean>('panel', `return d.querySelector('[data-testid="plan-view-list"] button').getAttribute('aria-pressed')==='true'||!!d.querySelector('article[data-testid="plan-P-phone"] .ap-tasks[data-complete]')`));

  // Board at 390: single column, plan list then detail, tabs and controls reachable by tap.
  await show('page');
  await boardDetail();
  await layout('page', 'board-390');
  check('board-390:single-column', await guest<boolean>('page', `const g=w.getComputedStyle(d.querySelector('.ap-board')).gridTemplateColumns.split(' ').length;return g===1`));
  await shot('board'); await shot('board-full', true);
  await click('page', '[data-testid="board-filters-trigger"]');
  await wait('page', `d.querySelector('[data-testid="board-filters"]:not([hidden])')`, 'filters sheet open');
  await layout('page', 'board-390-filters');
  await shot('board-filters');
  await click('page', '[data-testid="board-filters-close"] button');
  await wait('page', `d.querySelector('[data-testid="board-filters"]')?.closest('[hidden]')||!d.querySelector('[data-testid="board-filters"]:not([hidden])')`, 'filters closed');
  check('board-390:focus-after-filters', await guest<boolean>('page', `return !!d.activeElement?.closest('[data-testid="board-filters-trigger"]')`), await guest('page', `return d.activeElement?.outerHTML.slice(0,120)`));

  // ============================================================ device hints: safe areas and keyboard
  await device(PHONE);
  const h = await hooks('panel');
  check('device:hooks-applied', h['data-device-form-factor'] === 'phone' && h['data-device-pointer'] === 'coarse' && h['--ap-safe-bottom'] === '34px', { mode: deviceHooks, h });
  await device({ ...PHONE, keyboard: 300 });
  for (const f of ['panel', 'page']) {
    await show(f);
    if (f === 'panel') await listPanel(); else await boardDetail();
    const pad = await guest<any>(f, `const s=w.getComputedStyle(d.querySelector('[data-testid="progress-root"]')),hs=w.getComputedStyle(d.documentElement);return {bottom:parseFloat(s.paddingBottom),scroll:parseFloat(hs.scrollPaddingBottom)}`);
    check(`${f}-keyboard:padding-clears-keyboard`, pad.bottom >= 300 + 34 && pad.scroll === 334, pad);
    // The last essential control can be scrolled above the occluded band.
    const last = await guest<any>(f, `w.scrollTo(0,d.documentElement.scrollHeight);const n=d.querySelector('[data-testid="interface-language"] button,[data-testid="interface-language"]');const r=n.getBoundingClientRect();return {bottom:r.bottom,limit:w.innerHeight-334}`);
    check(`${f}-keyboard:last-control-above-keyboard`, last.bottom <= last.limit, last);
  }
  // Keyboard focus walk: the focused control is kept out of the occluded band by scroll padding.
  await show('page');
  await guest('page', `w.scrollTo(0,0);d.querySelector('[data-testid="search-query"] input,[data-testid="search-query"]').focus();return true`);
  for (let i = 0; i < 30; i++) {
    await key('Tab');
    const r = await guest<any>('page', `const a=d.activeElement;if(!a||a===d.body)return null;const r=a.getBoundingClientRect();return {bottom:r.bottom,top:r.top,limit:w.innerHeight-334,id:a.closest('[data-testid]')?.dataset.testid}`);
    if (r && r.top > 0 && r.bottom > r.limit + 1) check('page-keyboard:focus-not-under-keyboard', false, r);
  }
  check('page-keyboard:focus-not-under-keyboard', true);
  await device({ ...PHONE, keyboard: 0 });
  await show('panel'); await shot('panel-insets');

  // Landscape phone: one board column, notch inset respected, no overflow.
  await viewport({ width: 844, height: 390, touch: true });
  await device({ formFactor: 'phone', pointer: 'coarse', insets: { top: 0, right: 0, bottom: 21, left: 47 }, keyboard: 0 });
  await show('page'); await boardDetail();
  await layout('page', 'board-landscape');
  const land = await guest<any>('page', `const g=w.getComputedStyle(d.querySelector('.ap-board')).gridTemplateColumns.split(' ').length,root=w.getComputedStyle(d.querySelector('[data-testid="progress-root"]'));return {columns:g,left:parseFloat(root.paddingLeft),sticky:w.getComputedStyle(d.querySelector('.ap-plan-list')).position}`);
  check('board-landscape:phone-single-column-and-inset', land.columns === 1 && land.left >= 47 && land.sticky === 'static', land);
  await shot('board-landscape');
  await device(undefined);
  check('device:absent-again-clears-hooks', Object.values(await hooks('page')).every((v) => v === null), await hooks('page'));

  // ============================================================ dark + Russian (text expansion)
  await viewport({ width: 390, height: 844, touch: true });
  await evaluate(`qa.theme('dark');qa.setLocale('ru');true`);
  await show('panel');
  await wait('panel', `d.documentElement.dataset.ocTheme==='dark'&&d.querySelector('[data-testid="plan-view-list"]')?.textContent.includes('Спис')`, 'Russian dark rail');
  await listPanel();
  await layout('panel', 'panel-ru-dark');
  await shot('panel-ru-dark');
  await show('page'); await boardDetail();
  await wait('page', `d.querySelector('[data-testid="detail-tabs"]')?.textContent.match(/[А-Яа-я]/)`, 'Russian board');
  await layout('page', 'board-ru-dark');
  await shot('board-ru-dark'); await shot('board-ru-dark-full', true);

  // ============================================================ 200% / 400% reflow (no hints)
  for (const [w, label] of [[195, 'phone-200'], [320, 'desktop-400']] as const) {
    await viewport({ width: w, height: 640, touch: false, scale: 2 });
    for (const f of ['panel', 'page']) {
      await show(f);
      if (f === 'panel') await listPanel(); else await boardDetail();
      await layout(f, `${f}-${label}`, false);
    }
  }
  await shot('board-reflow-200');

  // ============================================================ desktop width: unchanged layout
  await evaluate(`qa.theme('light');qa.setLocale('en');true`);
  await viewport({ width: 1100, height: 850, touch: false });
  await show('page'); await boardDetail();
  const desk = await guest<any>('page', `const g=w.getComputedStyle(d.querySelector('.ap-board')).gridTemplateColumns.split(' ').length,row=d.querySelector('article[data-testid="plan-P-phone"] details[data-testid="item-toggle-extra-2"]>summary').getBoundingClientRect().height,chip=d.querySelector('.ap-state-chip').getBoundingClientRect().height,root=w.getComputedStyle(d.querySelector('[data-testid="progress-root"]'));return {coarse:w.matchMedia('(pointer: coarse)').matches,columns:g,row,chip,pad:[root.paddingTop,root.paddingRight,root.paddingBottom,root.paddingLeft]}`);
  check('desktop:two-column-fine-pointer-sizes', !desk.coarse && desk.columns === 2 && desk.row < 44 && desk.chip < 44 && desk.pad.join(' ') === '18px 22px 22px 22px', desk);
  await layout('page', 'board-desktop', false);
  await shot('board-desktop');
  await viewport({ width: 360, height: 800, touch: false });
  await show('panel'); await listPanel();
  const rail = await guest<any>('panel', `const root=w.getComputedStyle(d.querySelector('[data-testid="progress-root"]'));return {row:d.querySelector('article[data-testid="plan-P-phone"] details[data-testid="item-toggle-extra-2"]>summary').getBoundingClientRect().height,pad:[root.paddingTop,root.paddingRight,root.paddingBottom,root.paddingLeft]}`);
  check('desktop:rail-360-unchanged', rail.row < 44 && rail.pad.join(' ') === '14px 14px 16px 14px', rail);

  // ============================================================ request and host-message invariants
  // Hidden pause (labelled visibility seam): a hidden rail sends no reads while the board completes
  // two ordinary list polls; becoming visible resumes it. Then the steady cadence has no per-task reads.
  const mark = await evaluate<number>('qa.requests.length');
  await guest('panel', `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});d.dispatchEvent(new Event('visibilitychange'));return true`);
  const hiddenAt = await evaluate<number>('qa.requests.length');
  await evaluate(`new Promise((r,j)=>{const end=performance.now()+20000;const t=()=>qa.requests.slice(${hiddenAt}).filter(q=>q.frame==='page'&&q.path==='/v1/plans').length>=2?r(true):performance.now()>end?j(new Error('page polls')):setTimeout(t,100);t()})`);
  const hiddenReads = await evaluate<number>(`qa.requests.slice(${hiddenAt}).filter(q=>q.frame==='panel').length`);
  check('requests:hidden-rail-paused', hiddenReads === 0, { hiddenReads });
  await guest('panel', `delete d.visibilityState;d.dispatchEvent(new Event('visibilitychange'));return true`);
  await evaluate(`new Promise((r,j)=>{const end=performance.now()+20000;const t=()=>qa.requests.slice(${hiddenAt}).some(q=>q.frame==='panel'&&q.path==='/v1/plans')?r(true):performance.now()>end?j(new Error('resume')):setTimeout(t,100);t()})`);
  const steadyAt = await evaluate<number>('qa.requests.length');
  await evaluate(`new Promise((r,j)=>{const end=performance.now()+20000;const t=()=>qa.requests.slice(${steadyAt}).filter(q=>q.frame==='panel'&&q.path==='/v1/plans').length>=2?r(true):performance.now()>end?j(new Error('steady polls')):setTimeout(t,100);t()})`);
  const steady = await evaluate<any[]>(`qa.requests.slice(${steadyAt}).filter(q=>q.frame==='panel')`);
  const times = steady.filter((q) => q.path === '/v1/plans').map((q) => q.at);
  check('requests:steady-no-per-task-reads', steady.every((q) => ['/health', '/v1/plans'].includes(q.path)), steady.map((q) => q.path));
  check('requests:cadence-unchanged', times.length >= 2 && times.slice(1).every((t, i) => t - times[i] >= 2500), times.slice(1).map((t, i) => Math.round(t - times[i])));
  const all = await evaluate<any[]>('qa.requests');
  check('requests:no-writes', all.every((q) => q.method === 'GET'), all.filter((q) => q.method !== 'GET').map((q) => q.path));
  const surfaces = await evaluate<any[]>(`qa.messages.filter(m=>m.type==='open-surface').map(m=>m.payload)`);
  check('host:no-guessed-open-surface-payload', surfaces.every((p) => p && Object.keys(p).join() === 'surfaceId'), surfaces);
  check('runtime:no-console-errors', c.errors.length === 0, c.errors);
  void mark;
} catch (error) {
  failure = String((error as Error)?.stack ?? error).slice(0, 2000);
} finally {
  const summary = {
    passed: failure === null && results.every((r) => r.pass), failure,
    evidenceClass: 'synthetic SDK shell + real disposable service, real Chromium touch/viewport emulation',
    guests: source ? 'source-built temporary bundles' : 'tracked bundles', browser: browser.version,
    deviceHooks: deviceHooks ?? 'not-reached',
    deviceHooksNote: deviceHooks === 'simulated' ? 'Guest has no host-ready call site for applyDeviceHooks yet; hook attributes were written by the driver exactly as applyDeviceHooks writes them.' : undefined,
    physicalPhone: false, nativeHost: false,
    results, screenshots: shots,
  };
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(summary, null, 2));
  await browser.stop(); await fx.stop();
  console.log(JSON.stringify({ passed: summary.passed, failure, checks: results.length, deviceHooks: summary.deviceHooks }, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
