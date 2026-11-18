// Synthetic-host rail controls regression; never a native-host or physical-phone claim.
// Usage: node --experimental-strip-types tests/browser/dependency-map-controls-qa.ts
//   --chromium <binary> --artifacts <directory> [--capture-before]
// --capture-before records the old UI without treating it as passing the new contract.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { seedArrowPlan } from '../fixtures/dependency-map-arrows.ts';
import { startSearchShell } from './plan-task-search-shell.ts';
import { createGuestAssets } from './source-guests.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts'), before = process.argv.includes('--capture-before');
if (!artifacts) throw Error('Pass --artifacts');
mkdirSync(artifacts, { recursive: true });
const assets = createGuestAssets({ source: true }), scratch = mkdtempSync('/tmp/opencode/map-controls-');
for (const surface of ['page', 'panel', 'status']) {
  mkdirSync(join(scratch, 'ui', surface), { recursive: true });
  for (const file of ['index.html', 'main.js']) writeFileSync(join(scratch, 'ui', surface, file), assets.read(`/ui/${surface}/${file}`)!);
}
let fx: Awaited<ReturnType<typeof startSearchShell>> | undefined;
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
const checks: { id: string; pass: boolean; facts?: unknown }[] = [];
const check = (id: string, pass: boolean, facts?: unknown) => { checks.push({ id, pass, facts }); if (!pass && !before) throw Error(`${id}: ${JSON.stringify(facts)}`); };
try {
  fx = await startSearchShell(false, false, 'dependency-map-final', false, true, { guestRoot: scratch });
  for (const rows of [2, 4, 100]) seedArrowPlan(fx.reportMap, `P-controls-${rows}`, `Map controls ${rows}`, Array.from({ length: rows }, (_, n) => ({ id: `T${n}`, title: `Task ${n}`, kind: 'task', status: n === 0 ? 'working' : 'pending' })));
  browser = await launchChromium(chromiumPath(arg('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(code: string) => evaluate<T>(`(()=>{const w=frame('panel').contentWindow,d=w.document;${code}})()`);
  const wait = async (condition: string) => {
    if (!await evaluate(`(async()=>{const end=performance.now()+20000;while(performance.now()<end){try{const w=frame('panel').contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`)) throw Error(`Timeout: ${condition}; ` + await guest(`return JSON.stringify({text:d.body.innerText.slice(0,1200),loaded:qa.loaded,preferences:qa.railPreferences,storage:qa.storage.slice(-8),errors:qa.errors})`));
  };
  const settle = () => guest(`return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  const key = async (key: string) => { for (const type of ['keyDown','keyUp']) await c.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: ({Enter:13,Escape:27,Tab:9} as Record<string,number>)[key] ?? 0, ...(type === 'keyDown' && key === 'Enter' ? {text:'\r'} : {}) }); };
  const activate = async (id: string) => { await guest(`d.querySelector('[data-testid="${id}"]').focus();return true`); await key('Enter'); await settle(); };
  const shot = async (name: string) => { const png = await c.send('Page.captureScreenshot', { format:'png' }); writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data,'base64')); };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
  await wait('!!d.body');
  await evaluate(`const n=document.createElement('meta');n.name='viewport';n.content='width=device-width,initial-scale=1';document.head.append(n);document.querySelectorAll('section').forEach(n=>n.style.margin='0');true`);
  for (const [width,height,coarse,rows] of [[390,900,false,2],[390,900,false,4],[600,900,false,100],[390,500,false,100],[390,844,true,100]] as const) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:coarse });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled:coarse });
    for (const locale of ['en','ru','zh-CN']) {
      const sequence = await evaluate<number>(`(()=>{qa.show(['panel'],${width});frame('panel').style.height='${height}px';qa.locale=${js(locale)};qa.railPreferences={'rail-plan:M':'source-alpha/P-controls-${rows}'};const s=qa.reload('panel');qa.context('M');return s})()`);
      await wait(`qa.loaded.panel===${sequence}&&d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger')`);
      await evaluate(`(()=>{const w=frame('panel').contentWindow,post=w.postMessage;w.postMessage=function(m,o){if(m?.type==='ready')m={...m,payload:{...m.payload,device:{pointer:${js(coarse?'coarse':'fine')}}}};return post.call(w,m,o)};qa.ready('panel');return true})()`);
      await settle();
      await guest(`d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger').click();return true`);
      await wait(`[...d.querySelectorAll('.oc-sdk-option-label')].some(n=>n.textContent==='Map controls ${rows}')`);
      await guest(`[...d.querySelectorAll('.oc-sdk-option-label')].find(n=>n.textContent==='Map controls ${rows}').closest('[role="option"]').click();return true`);
      await guest(`d.querySelector('[data-testid="plan-view-map"] button').click();return true`);
      await wait(`d.querySelectorAll('.ap-map-card').length===${rows}&&d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);
      await settle();
      const name = `${width}-${height}-${coarse?'coarse':'fine'}-${rows}-${locale}`;
      const frame = await guest(`const v=d.querySelector('[data-testid="map-viewport"]');return {height:v.getBoundingClientRect().height,coarse:d.querySelector('[data-testid="map-region"]').dataset.pointer==='coarse'}`);
      const expected = coarse ? 300 : rows === 2 || height === 500 ? 320 : rows === 4 ? 412 : 540;
      check(`${name}:frame`, frame.height===expected&&frame.coarse===coarse, { ...frame, expected });
      await guest(`d.querySelector('[data-testid="map-toolbar"]').scrollIntoView({block:'start'});return true`); await settle();
      await shot(`${name}-rail`);
      const tools = await guest(`return [...d.querySelectorAll('[data-testid="map-toolbar"] :is(.oc-sdk-btn,.ap-map-tool,summary)')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return {y:r.y,width:r.width,height:r.height}})`);
      check(`${name}:one-row-targets`, tools.every((n:any)=>Math.abs(n.y-tools[0].y)<6&&(!coarse||n.width>=44&&n.height>=44)), tools);
      const current = await guest(`return d.querySelector('[data-testid="map-focus-current"]')?.getAttribute('aria-label')`);
      check(`${name}:translated-current`, current==={en:'Focus current work',ru:'Показать текущую работу','zh-CN':'聚焦当前工作'}[locale as 'en'], current);
      if (current) {
        await activate('map-card-T0');
        await activate('map-fit-all');
        await guest(`w.__moves=[];const n=d.querySelector('[data-testid="map-announcer"]');w.__observer=new MutationObserver(()=>{if(n.textContent)w.__moves.push(n.textContent)});w.__observer.observe(n,{subtree:true,childList:true,characterData:true});w.__selection=d.querySelector('[data-testid="map-inspector"]').dataset.selected;return true`);
        await activate('map-focus-current');
        await wait('w.__moves.length>0');
        check(`${name}:current-preserves-reading`, await guest(`return w.__moves.length===1&&d.activeElement?.dataset.testid==='map-focus-current'&&d.querySelector('[data-testid="map-inspector"]').dataset.selected===w.__selection&&!d.querySelector('[data-testid="map-filter-line"]')`));
      }
      await activate('map-help-trigger');
      await wait(`d.querySelector('[data-testid="map-help"]').open`);
      const help = await guest(`const n=d.querySelector('.ap-map-help-body');return {height:n.clientHeight,scroll:n.scrollHeight,text:n.textContent}`);
      check(`${name}:help-no-scroll`, help.scroll<=help.height, help);
      await shot(`${name}-help`);
      await key('Tab');
      check(`${name}:filters-tab`, await guest(`return !!d.activeElement?.closest('[data-testid="map-status"]')`));
      await key('Escape');
      check(`${name}:help-escape`, await guest(`return !d.querySelector('[data-testid="map-help"]').open&&d.activeElement?.dataset.testid==='map-help-trigger'`));
    }
  }
  check('console', browser.page.errors.length===0, browser.page.errors);
  writeFileSync(join(artifacts,'controls.json'), JSON.stringify({ evidence:'Synthetic host, source guests, disposable service; not physical phone or native host', before, checks },null,2));
  console.log(JSON.stringify({ before, checks:checks.length, failed:checks.filter(c=>!c.pass).length }));
} finally {
  await browser?.stop(); await fx?.stop(); assets.dispose(); rmSync(scratch,{recursive:true,force:true});
}
