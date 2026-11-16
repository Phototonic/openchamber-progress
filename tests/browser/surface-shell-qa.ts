// Synthetic SDK shell and isolated real-service map, not native-host/physical-phone certification.
// Usage: node --experimental-strip-types tests/browser/surface-shell-qa.ts --source --chromium <path> --artifacts <dir>
// Real CDP pointer and keyboard input; no click/focus dispatch from page JavaScript.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { shellCopy } from '../../ui/shared/components.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { startPhoneShell } from './phone-layout-shell.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw Error('Pass --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });
const results: { id: string; pass: boolean; facts?: unknown }[] = [], screenshots: string[] = [];
const check = (id: string, pass: boolean, facts?: unknown) => { results.push({ id, pass, facts }); if (!pass) throw Error(id + ': ' + JSON.stringify(facts)); };
let fixture: Awaited<ReturnType<typeof startLanguageFixture>> | undefined;
let maps: Awaited<ReturnType<typeof startPhoneShell>> | undefined;
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
let failure: string | null = null;
try {
  fixture = await startLanguageFixture({ source: process.argv.includes('--source') });
  browser = await launchChromium(chromiumPath(arg('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(surface: string, code: string) => evaluate<T>(`(()=>{const w=frame(${js(surface)}).contentWindow,d=w.document;${code}})()`);
  const wait = async (surface: string, condition: string) => {
    const ok = await evaluate(`(async()=>{const end=performance.now()+10000;while(performance.now()<end){try{const w=frame(${js(surface)}).contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`);
    if (!ok) throw Error(`Timed out (${surface}): ${condition}; ` + await guest(surface, 'return d.body.innerText.slice(0,600)'));
  };
  let width = 390;
  const viewport = async (w: number) => {
    width = w;
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w === 390 });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: w === 390 });
  };
  const key = async (key: string, shift = false) => {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, Home: 36, End: 35, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37 };
    const base = { key, code: key, windowsVirtualKeyCode: codes[key] ?? 0, modifiers: shift ? 8 : 0 };
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key.length === 1 ? { text: key } : key === 'Enter' ? { text: '\r' } : {}) });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const click = async (surface: string, selector: string) => {
    await guest(surface, `d.querySelector(${js(selector)})?.scrollIntoView({block:'center'});return true`);
    await guest(surface, 'return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))');
    const point = await guest<[number, number]>(surface, `const n=d.querySelector(${js(selector)});if(!n)throw Error('Missing control');const r=n.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    const [x, y] = point;
    if (width === 390) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const shot = async (name: string) => {
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 844, scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64')); screenshots.push(`${name}.png`);
  };
  const back = async (surface: string) => {
    await click(surface, '[data-testid="surface-panel-back"] button');
    await wait(surface, `!d.querySelector('[data-testid="surface-panel-heading"]') && d.activeElement?.dataset.testid==='more-trigger'`);
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fixture.port}/` });
  await wait('panel', `!!d.querySelector('[data-testid="more-trigger"]')`);
  // Only fixture chrome changes here, never guest styles or control state.
  await evaluate(`document.querySelector('#outside').hidden=true;document.querySelectorAll('section').forEach(n=>n.style.margin='0');qa.context(${js(fixture.session)});true`);
  for (const size of [390, 1280]) for (const locale of ['en', 'ru', 'zh-CN'] as const) for (const theme of ['light', 'dark']) for (const surface of ['panel', 'page']) {
    await viewport(size);
    const id = `${surface}-${size}-${locale}-${theme}`, t = shellCopy(locale);
    // Deliver themes through the actual host-ready path.
    await evaluate(`qa.show(${js(surface)},${size});qa.seed(undefined);qa.ready(${js(surface)},{locale:${js(locale)},device:{formFactor:${js(size === 390 ? 'phone' : 'desktop')},pointer:${js(size === 390 ? 'coarse' : 'fine')},insets:{top:0,right:0,bottom:0,left:0},keyboard:0}});true`);
    const hostTheme = { mode: theme, tokens: theme === 'dark' ? { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', border: '#414650', hover: '#343944', focus: '#90b8ff', primary: '#83aff7', font: 'system-ui, sans-serif' } : { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', border: '#dedfe3', hover: '#f0f1f3', focus: '#376bc4', primary: '#316ac3', font: 'system-ui, sans-serif' } };
    await evaluate(`(()=>{const payload={...qa.ctx,surface:${js(surface)},settings:{},item:null,theme:${js(hostTheme)}};frame(${js(surface)}).contentWindow.postMessage({channel:'openchamber.sdk',v:1,type:'ready',payload},location.origin);return true})()`);
    await wait(surface, `d.documentElement.lang===${js(locale)} && !!d.querySelector('[data-testid="surface-header"]')`);
    await guest(surface, 'w.scrollTo(0,0);return true');
    await shot(`${id}-view`);
    await click(surface, '[data-testid="more-trigger"]');
    await wait(surface, `d.querySelector('[data-testid="more-trigger"]').getAttribute('aria-expanded')==='true'`);
    check(`${id}-one-menu`, await guest(surface, `return d.querySelectorAll('[data-testid="more-trigger"]').length===1 && d.querySelectorAll('[role="menu"]:not([hidden])').length===1`));
    await key('End');
    check(`${id}-end`, await guest(surface, `return d.activeElement?.dataset.menuId==='troubleshooting'`));
    await key('Home');
    for (const letter of t.sessions) await key(letter);
    check(`${id}-typeahead`, await guest(surface, `return d.activeElement?.dataset.menuId==='sessions'`));
    const tree = await c.send('Page.getFrameTree');
    const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.includes(`/ui/${surface}/`)).frame.id;
    const ax = await c.send('Accessibility.getFullAXTree', { frameId });
    check(`${id}-accessible-menu`, ax.nodes.some((n: any) => n.role?.value === 'menu' && n.name?.value === t.more) && ax.nodes.some((n: any) => n.role?.value === 'menuitem' && n.name?.value === t.troubleshooting));
    if (size === 390) check(`${id}-targets`, await guest(surface, `return [...d.querySelectorAll('[role="menuitem"]')].every(n=>n.getBoundingClientRect().height>=44)`));
    await shot(`${id}-more`);
    await key('Escape');
    check(`${id}-escape-focus`, await guest(surface, `return d.activeElement?.dataset.testid==='more-trigger'`));
    await key('ArrowDown');
    await key('End'); await key('Enter');
    await wait(surface, `!!d.querySelector('[data-testid="surface-panel-troubleshooting"]')`);
    check(`${id}-panel-focus`, await guest(surface, `return d.activeElement?.dataset.testid==='surface-panel-heading'`));
    check(`${id}-advanced-folded`, await guest(surface, `return !d.querySelector('[data-testid="advanced-details"]').open`));
    await wait(surface, `d.querySelector('[data-testid="reporting-support-copy"] button')?.disabled===false`);
    await click(surface, '[data-testid="reporting-support-copy"] button');
    await wait(surface, `/Copied|Скопировано|已复制|Copy unavailable|Копирование недоступно|无法复制/.test(d.querySelector('[data-testid="reporting-health"] [role="status"]')?.textContent??'')`);
    check(`${id}-support-summary-private`, await guest(surface, `const s=d.querySelector('[data-testid="reporting-support-preview"]').value;return s.startsWith('Agent progress reporting observations\\n')&&!s.includes('Alpha implementation')&&!s.includes('/fixture')`));
    await click(surface, '[data-testid="advanced-details"]>summary');
    check(`${id}-facts`, await guest(surface, `return !!d.querySelector('[data-testid="advanced-details"] .ap-facts')`));
    await shot(`${id}-troubleshooting`);
    await back(surface);
    await key('Tab');
    check(`${id}-tab-map`, await guest(surface, `return d.activeElement?.closest('[data-testid]')?.dataset.testid==='plan-view-map'`));
    await key('Tab');
    check(`${id}-tab-list`, await guest(surface, `return d.activeElement?.closest('[data-testid]')?.dataset.testid==='plan-view-list'`));
    for (const kind of ['document', 'sessions', 'setup', ...(surface === 'page' ? ['history'] : [])]) {
      await click(surface, '[data-testid="more-trigger"]');
      await click(surface, `[data-menu-id="${kind}"]`);
      await wait(surface, `!!d.querySelector('[data-testid="surface-panel-${kind}"]')`);
      await back(surface);
    }
    // Language is a radio submenu, not a second selector on the default surface.
    await click(surface, '[data-testid="more-trigger"]');
    await click(surface, '[data-menu-id="language"]');
    await wait(surface, `d.querySelectorAll('[role="menuitemradio"]').length===4`);
    await click(surface, '[data-menu-id="language-ru"]');
    await wait(surface, `d.documentElement.lang==='ru'`);
    await click(surface, '[data-testid="more-trigger"]'); await click(surface, '[data-menu-id="language"]');
    await click(surface, '[data-menu-id="language-auto"]');
    await wait(surface, `d.documentElement.lang===${js(locale)}`);
    check(`${id}-no-overflow`, await guest(surface, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth'));
  }
  for (const mode of ['empty', 'setup', 'failure']) for (const locale of ['en', 'ru', 'zh-CN']) for (const surface of ['panel', 'page']) {
    const url = await evaluate<string>(`qa.mode=${js(mode)};qa.seed(undefined);qa.ctx.locale=${js(locale)};qa.show(${js(surface)},390);qa.reload(${js(surface)});frame(${js(surface)}).src`);
    await viewport(390);
    const state = mode === 'empty' ? 'empty-state' : mode === 'setup' ? 'setup-needed' : 'state-busy';
    await wait(surface, `w.location.href===${js(url)} && !!d.querySelector('[data-testid="${state}"]') && !!d.querySelector('[data-testid="more-trigger"]')`);
    await click(surface, '[data-testid="more-trigger"]');
    for (const id of ['language', 'setup', 'troubleshooting']) check(`${surface}-${mode}-${id}`, await guest(surface, `return !!d.querySelector('[data-menu-id="${id}"]')`));
    await shot(`${surface}-${mode}-${locale}-more`);
    await key('Escape');
  }
  // Older host: explicit disabled language choices, no storage fallback.
  const unsupportedUrl = await evaluate<string>(`qa.mode='empty';qa.ready('panel',{features:{deviceStorage:false}});qa.reload('panel');frame('panel').src`);
  await wait('panel', `w.location.href===${js(unsupportedUrl)} && !!d.querySelector('[data-testid="empty-state"]') && !!d.querySelector('[data-testid="more-trigger"]')`);
  await evaluate(`qa.show('panel',390);true`);
  await click('panel', '[data-testid="more-trigger"]'); await click('panel', '[data-menu-id="language"]');
  check('unsupported-language', await guest('panel', `return [...d.querySelectorAll('[role="menuitemradio"]')].every(n=>n.disabled)`));
  check('no-guest-errors', browser.page.errors.length === 0, browser.page.errors);
  // Map order uses the real service fixture; no R/N/M behaviour is substituted here.
  maps = await startPhoneShell({ source: process.argv.includes('--source') });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${maps.port}/` });
  for (const surface of ['panel', 'page']) for (const size of [390, 1280]) {
    await viewport(size);
    await evaluate(`qa.show(${js(surface)},${size},844);true`);
    await wait(surface, `!!d.querySelector('[data-testid="map-world"]')`);
    check(`${surface}-${size}-map-order`, await guest(surface, `const h=d.querySelector('[data-testid="surface-header"]'),m=d.querySelector('[data-testid="map-region"]'),n=d.querySelector('[data-testid="needs-you-inbox"]');return !!h && !!m && !!(h.compareDocumentPosition(m)&4) && (!n || !!(m.compareDocumentPosition(n)&4))`));
    await guest(surface, 'w.scrollTo(0,0);return true'); await shot(`${surface}-${size}-map`);
  }
  for (const surface of ['panel', 'page']) {
    await viewport(390);
    await evaluate(`qa.show(${js(surface)},390,844);true`);
    await click(surface, '.ap-inbox-open');
    await wait(surface, `!!d.querySelector('[data-testid="needs-you-reading"]') && !!d.querySelector('.ap-tasks[data-complete]')`);
    check(`${surface}-inbox-one-menu`, await guest(surface, `return d.querySelectorAll('[data-testid="more-trigger"]').length===1`));
    await viewport(280);
    await evaluate(`qa.show(${js(surface)},280,844);frame(${js(surface)}).src='/ui/${surface}/index.html?narrow=1';true`);
    await wait(surface, `w.location.search==='?narrow=1' && !!d.querySelector('.ap-tasks[data-complete]') && d.querySelector('[data-testid="plan-view-list"] button')?.getAttribute('aria-pressed')==='true'`);
    check(`${surface}-narrow-list-default`, true);
    await click(surface, '[data-testid="plan-view-map"] button');
    await wait(surface, `!!d.querySelector('[data-testid="map-world"]')`);
    check(`${surface}-narrow-map-selectable`, true);
  }
  check('no-final-guest-errors', browser.page.errors.length === 0, browser.page.errors);
} catch (error) { failure = String(error); }
finally {
  await browser?.stop(); await fixture?.stop(); await maps?.stop();
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ pass: !failure, failure, results, screenshots, limits: 'Synthetic host and emulated phone only; no native host or physical phone tested.' }, null, 2));
}
if (failure) { console.error(failure); process.exitCode = 1; }
