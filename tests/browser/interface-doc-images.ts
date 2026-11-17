// Dark documentation captures from freshly built guests, a synthetic plan and disposable service.
// Build first; no live profile, host or model. Outputs are reviewed before copying into docs/images.
// Usage: interface-doc-images.ts --chromium <binary> --artifacts <directory>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPhoneShell } from './phone-layout-shell.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { internalCopy } from './interface-copy.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('Pass --artifacts <directory>');
mkdirSync(artifacts, { recursive: true });
let shell: Awaited<ReturnType<typeof startPhoneShell>> | undefined;
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
try {
  shell = await startPhoneShell({ documentation: true });
  browser = await launchChromium(chromiumPath(arg('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('Documentation expression failed');
    return r.result.value;
  };
  const guest = <T = any>(surface: string, code: string) => evaluate<T>(`(()=>{const w=frame(${js(surface)}).contentWindow,d=w.document;${code}})()`);
  const wait = async (surface: string, condition: string) => {
    if (!await guest(surface, `return (async()=>{const end=performance.now()+15000;while(performance.now()<end){if(${condition})return true;await new Promise(r=>requestAnimationFrame(r))}return false})()`)) {
      const observed = await guest(surface, `return {condition:${js(condition)},hasFocus:d.hasFocus(),active:d.activeElement?.dataset,articles:[...d.querySelectorAll('article.ap-plan')].map(n=>n.dataset),toggles:[...d.querySelectorAll('[data-testid^="item-toggle-"]')].map(n=>({id:n.dataset.testid,open:n.open})),text:d.body.innerText,requests:parent.qa.requests.slice(-20)}`);
      writeFileSync(join(artifacts, 'state-failure.json'), JSON.stringify(observed, null, 2));
      const png = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(artifacts, 'state-failure.png'), Buffer.from(png.data, 'base64'));
      throw new Error('Documentation state did not settle: ' + condition);
    }
  };
  const show = async (surface: string, width: number, height: number) => {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`qa.show(${js(surface)},${width},${height})`);
    await wait(surface, `w.innerWidth===${width}&&w.innerHeight===${height}`);
  };
  const shot = async (surface: string, file: string) => {
    await guest(surface, 'w.scrollTo(0,0);return d.fonts.ready');
    const rect = await guest<{ x: number; y: number; width: number; height: number }>(surface, 'const r=w.frameElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}');
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: true });
    writeFileSync(join(artifacts!, file + '.png'), Buffer.from(png.data, 'base64'));
  };
  const click = async (surface: string, selector: string) => {
    await guest(surface, `d.querySelector(${js(selector)}).scrollIntoView({block:'center'});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const p = await guest<number[]>(surface, `const r=d.querySelector(${js(selector)}).getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 });
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${shell.port}/` });
  if (!await evaluate(`(async()=>{const end=performance.now()+10000;while(performance.now()<end){if(window.qa)return true;await new Promise(r=>setTimeout(r,25))}return false})()`)) throw new Error('Documentation shell did not load');
  await show('panel', 390, 844);
  await wait('panel', `!!d.querySelector('[data-testid="surface-header"]')`);
  await evaluate(`qa.theme('dark')`);
  for (const language of ['ru', 'zh-CN', 'en']) {
    await evaluate(`qa.setLocale(${js(language)})`);
    for (const surface of ['panel', 'page']) {
      await show(surface, surface === 'panel' ? 390 : 1280, surface === 'panel' ? 844 : 900);
      await wait(surface, `d.documentElement.lang===${js(language)}&&!!d.querySelector('[data-testid="map-card-task-b"]')`);
      const text = await guest<string>(surface, 'return d.body.innerText');
      const tree = await c.send('Page.getFrameTree');
      const frame = tree.frameTree.childFrames.find((n: any) => n.frame.url.includes(`/ui/${surface}/`));
      const ax = await c.send('Accessibility.getFullAXTree', { frameId: frame.frame.id });
      const names = ax.nodes.filter((n: any) => !n.ignored).flatMap((n: any) => [n.name?.value, n.description?.value]).filter(Boolean).join('\n');
      const bad = internalCopy(text + '\n' + names);
      if (bad.length) {
        writeFileSync(join(artifacts, 'copy-failure.json'), JSON.stringify({ surface, language, bad, text, names }, null, 2));
        const all = text + '\n' + ax.nodes.flatMap((n: any) => [n.name?.value, n.description?.value]).filter(Boolean).join('\n');
        const at = all.toLocaleLowerCase().indexOf(bad[0].toLocaleLowerCase());
        throw new Error(`${surface}:${language}: internal map copy ${bad.join(', ')}: ${all.slice(Math.max(0, at - 100), at + 200)}`);
      }
      if (!await guest(surface, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth+1')) throw new Error('Documentation map overflow');
    }
  }
  await show('panel', 390, 844);
  await wait('panel', `!!d.querySelector('[data-testid="map-card-task-b"]')`);
  await shot('panel', 'rail');
  await show('page', 1280, 900);
  await wait('page', `!!d.querySelector('[data-testid="map-card-task-b"]')`);
  await shot('page', 'board');
  // Capture the actual live arrow animation, not reconstructed image frames.
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 100)); // recording cadence, not a readiness wait
    await shot('page', `map-${String(i).padStart(2, '0')}`);
  }
  await click('page', '[data-testid="search-query"] input');
  await c.send('Input.insertText', { text: 'pages' });
  await guest('page', `w.__searchAnnouncements=[];new w.MutationObserver(records=>{const n=d.querySelector('[data-testid="search-announcer"]');if(n?.textContent&&records.some(r=>r.target===n||n.contains(r.target)))w.__searchAnnouncements.push(n.textContent)}).observe(d.body,{subtree:true,childList:true,characterData:true});return true`);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait('page', `!!d.querySelector('[data-testid="search-results"]')`);
  await wait('page', `!!d.querySelector('button.ap-hit-task[data-testid^="search-task-"]')`);
  for (const [language, expected] of [
    ['en', 'Found 1 plan, 1 matching task.'],
    ['ru', 'Найдено планов: 1, подходящих задач: 1.'],
    ['zh-CN', '找到 1 个计划和 1 个匹配任务。'],
  ]) {
    await evaluate(`qa.setLocale(${js(language)})`);
    await wait('page', `d.querySelector('[data-testid="search-counts"]')?.textContent===${js(expected)}&&d.querySelector('[data-testid="search-announcer"]')?.textContent===${js(expected)}`);
    // The persistent live region is outside the rendered root; innerText includes clipped
    // screen-reader-only text, so count visual occurrences inside the root separately.
    const state = await guest('page', `return {visible:d.querySelector('[data-testid="progress-root"]').innerText,count:d.querySelector('[data-testid="search-counts"]').textContent,status:d.querySelector('[data-testid="search-status"]').textContent,qualification:d.querySelector('[data-testid="search-coverage"]').textContent,paging:!!d.querySelector('[data-testid="search-prev"],[data-testid="search-next"]'),announcements:w.__searchAnnouncements.filter(t=>t===${js(expected)}).length}`);
    if (state.visible.split(expected).length !== 2 || state.status || state.qualification || state.paging || state.announcements !== 1) throw new Error('Search should state its result once: ' + JSON.stringify(state));
    const bad = internalCopy(state.visible);
    if (bad.length) throw new Error(`${language}: internal Search copy ${bad.join(', ')}`);
  }
  await evaluate(`qa.setLocale('en')`);
  await wait('page', `d.documentElement.lang==='en'&&d.querySelector('[data-testid="search-counts"]')?.textContent==='Found 1 plan, 1 matching task.'`);
  await click('page', 'button.ap-hit-task[data-testid^="search-task-"]');
  // Search's established reveal opens ancestor folds and focuses the canonical List row;
  // it deliberately does not expand the task's own details (components.ts revealTask).
  await wait('page', `d.activeElement?.dataset.testid==='item-task-b'`);
  await shot('page', 'board-search');
  await evaluate(`qa.session=null;qa.ready()`);
  await show('panel', 390, 500);
  await wait('panel', `!!d.querySelector('[data-testid="unscoped-state"]')`);
  await shot('panel', 'no-session');
  if (c.errors.length) throw new Error('Documentation guest runtime error');
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ passed: true, dark: true, guests: 'built', synthetic: true, nativeHostProof: false }) + '\n');
} finally {
  await browser?.stop(); await shell?.stop();
}
