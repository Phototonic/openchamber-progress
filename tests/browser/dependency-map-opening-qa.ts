// Rendered opening/threshold evidence over production source guests and a disposable real service.
// Usage: dependency-map-opening-qa.ts --measure-only --chromium <binary> --artifacts <directory>
// Threshold measurement runs before behaviour changes; no live profile or native-host claim.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { ARROW_SMALL, arrowMid, seedArrowPlan } from '../fixtures/dependency-map-arrows.ts';
import { generateLargePlan } from '../fixtures/large-plan.ts';
import { startSearchShell } from './plan-task-search-shell.ts';
import { createGuestAssets } from './source-guests.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
const measureOnly = process.argv.includes('--measure-only');
if (!artifacts) throw Error('Pass --artifacts');
mkdirSync(artifacts, { recursive: true });
const assets = createGuestAssets({ source: true });
const scratch = mkdtempSync('/tmp/opencode/map-opening-');
for (const surface of ['page', 'panel', 'status']) {
  mkdirSync(join(scratch, 'ui', surface), { recursive: true });
  for (const file of ['index.html', 'main.js']) writeFileSync(join(scratch, 'ui', surface, file), assets.read(`/ui/${surface}/${file}`)!);
}
let fx: Awaited<ReturnType<typeof startSearchShell>> | undefined;
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
const measurements: unknown[] = [];
const checks: { id: string; pass: boolean; facts?: unknown }[] = [];
const check = (id: string, pass: boolean, facts?: unknown) => { checks.push({ id, pass, facts }); if (!pass) throw Error(`${id}: ${JSON.stringify(facts)}`); };
try {
  fx = await startSearchShell(false, false, 'dependency-map-final', false, true, { guestRoot: scratch });
  for (const [id, items] of [['small', ARROW_SMALL], ['100', arrowMid()], ['980', generateLargePlan()]] as const)
    seedArrowPlan(fx.reportMap, `P-opening-${id}`, `Opening ${id}`, [...items]);
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
    if (!await evaluate(`(async()=>{const end=performance.now()+20000;while(performance.now()<end){try{const w=frame(${js(surface)}).contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`))
      throw Error(`Timeout ${surface}: ${condition}; ` + await guest(surface, 'return d.body.innerText.slice(0,500)'));
  };
  const pickRailPlan = async (title: string) => {
    await wait('panel', `d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger')`);
    // Viewport changes deliver resize before the next rendering opportunity. The SDK
    // intentionally closes on resize, so acknowledge that delivery before opening.
    await guest('panel', `return new Promise(resolve=>w.requestAnimationFrame(()=>resolve(true)))`);
    await guest('panel', `d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger').click();return true`);
    await wait('panel', `[...d.querySelectorAll('.oc-sdk-option-label')].some(n=>n.textContent===${js(title)})`);
    await guest('panel', `[...d.querySelectorAll('.oc-sdk-option-label')].find(n=>n.textContent===${js(title)}).closest('[role="option"]').click();return true`);
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
  await wait('page', '!!d.body');
  // Fixture chrome only: mobile screenshots must use a 1:1 CSS-pixel viewport, not the browser's
  // legacy 980px mobile layout scaled down around the 390px guest.
  await evaluate(`(()=>{const n=document.createElement('meta');n.name='viewport';n.content='width=device-width,initial-scale=1';document.head.append(n);document.querySelectorAll('section').forEach(n=>n.style.margin='0');return true})()`);
  const reviewRegressions = async () => {
    // Keep these plans and durable picker preference out of the existing opening/language matrix.
    fx!.reportMap('P-opening-scroll', {op:'start',title:'Opening scroll',items:[
      {id:'F',title:'Long blocker',kind:'task',status:'blocked',blocker:{reason:'Recorded blocker.\n'.repeat(25),nextAction:'Choose the next step'}},
      {id:'N',title:'Another task',kind:'task',status:'pending'},
    ]});
    fx!.reportMap('P-opening-packed', {op:'start',title:'Opening packed',items:Array.from({length:4},(_,n)=>({id:`Packed-${n}`,title:`Pending task ${n}`,kind:'task',status:'pending'}))});
    const regressions: {id:string;pass:boolean;facts:unknown}[] = [];
    // Fresh rail entry: provisional one-column geometry must not frame the final two-row grid.
    await c.send('Emulation.setDeviceMetricsOverride',{width:900,height:1000,deviceScaleFactor:1,mobile:false});
    const packedReload = await evaluate<number>(`qa.show(['panel'],574);frame('panel').style.height='950px';qa.railPreferences={'rail-plan:M':'source-alpha/P-opening-packed'};const sequence=qa.reload('panel');qa.context('M');sequence`);
    await wait('panel', `qa.loaded.panel===${packedReload}`);
    await wait('panel', `d.querySelector('[data-testid="plan-selector"]')?.textContent.includes('Opening packed')&&d.querySelector('[data-testid="plan-view-map"] button')`);
    await guest('panel', `d.querySelector('[data-testid="plan-view-map"] button').click();return true`);
    await wait('panel', `d.querySelector('[data-testid="map-title"]')?.textContent==='Opening packed'&&d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'&&d.querySelector('[data-testid="map-viewport"]')?.clientWidth>0`);
    await guest('panel', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    const packed = await guest('panel', `const n=d.querySelector('[data-testid="map-viewport"]'),v=n.getBoundingClientRect(),m=new w.DOMMatrix(w.getComputedStyle(d.querySelector('[data-testid="map-world"]')).transform);return {width:n.clientWidth,height:v.height,zoom:m.a,cards:[...d.querySelectorAll('.ap-map-card')].map(n=>{const r=n.getBoundingClientRect();return {top:r.top-v.top,bottom:r.bottom-v.top,left:r.left-v.left,right:r.right-v.left}})}`);
    regressions.push({id:'opening:four-pending-538px-final-height',pass:packed.cards.length===4&&packed.width===538&&packed.height>=210&&packed.height<=214&&packed.cards.every((r:any)=>r.top>=0&&r.bottom<=packed.height&&r.left>=0&&r.right<=540),facts:packed});
    for (const [surface,width] of [['panel',574],['page',700]] as const) {
      await evaluate(`qa.show([${js(surface)}],${width});frame(${js(surface)}).style.height='950px';true`);
      if (surface==='panel') await pickRailPlan('Opening scroll');
      else {
        await wait(surface, `d.querySelector('[data-testid="plan-row-P-opening-scroll"]')`);
        await guest(surface, `d.querySelector('[data-testid="plan-row-P-opening-scroll"]').click();return true`);
      }
      await wait(surface, `d.querySelector('[data-testid="surface-header"]')?.textContent.includes('Opening scroll')&&d.querySelector('[data-testid="plan-view-map"] button')`);
      await guest(surface, `d.querySelector('[data-testid="plan-view-map"] button').click();return true`);
      await wait(surface, `d.querySelector('[data-testid="map-title"]')?.textContent==='Opening scroll'&&d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);
      await guest(surface, `d.querySelector('[data-testid="map-card-F"]').click();return true`);
      await wait(surface, `d.querySelector('[data-testid="map-inspector"]')?.dataset.selected==='F'&&d.querySelector('[data-testid="map-inspector"]').scrollHeight>d.querySelector('[data-testid="map-inspector"]').clientHeight`);
      const before = await guest(surface, `const n=d.querySelector('[data-testid="map-inspector"]');n.scrollTop=120;w.__scrollInspector=n;return {top:n.scrollTop,key:n.dataset.scrollKey,placement:n.dataset.placement}`);
      fx!.reportMap('P-opening-scroll',{op:'change',changes:[{id:'N',status:surface==='panel'?'working':'pending'}]});
      await wait(surface, `d.querySelector('[data-testid="map-region"]')?.dataset.revision==='${surface==='panel'?2:3}'&&d.querySelector('[data-testid="map-region"]').dataset.current==='true'&&d.querySelector('[data-testid="map-inspector"]')!==w.__scrollInspector`);
      const after = await guest(surface, `const n=d.querySelector('[data-testid="map-inspector"]');return {top:n.scrollTop,key:n.dataset.scrollKey,placement:n.dataset.placement}`);
      await guest(surface, `d.querySelector('[data-testid="map-card-N"]').click();return true`);
      await wait(surface, `d.querySelector('[data-testid="map-inspector"]')?.dataset.selected==='N'`);
      const changed = await guest(surface, `const n=d.querySelector('[data-testid="map-inspector"]');return {top:n.scrollTop,key:n.dataset.scrollKey}`);
      regressions.push({id:`inspector:${surface}:stacked-scroll-survives-background-paint`,pass:before.top>0&&before.placement!=='over'&&after.top===before.top&&!!before.key&&after.key===before.key&&changed.top===0&&changed.key!==before.key,facts:{before,after,changed}});
    }
    writeFileSync(join(artifacts,'review-regressions.json'),JSON.stringify(regressions,null,2));
    for (const regression of regressions) checks.push(regression);
    const failed = regressions.filter(r=>!r.pass);
    if (failed.length) throw Error(`Review regressions failed: ${JSON.stringify(failed)}`);
  };
  if (!measureOnly) {
    await evaluate(`qa.show(['panel'],390);frame('panel').style.height='950px';qa.context('M');true`);
    await wait('panel', `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);
    await evaluate(`qa.holds.push({tag:'picker-background-graph',path:'/v1/plan-graph',frame:'panel'});true`);
    await pickRailPlan('Opening 100');
    await wait('panel', `qa.held.some(h=>h.tag==='picker-background-graph')`);
    await guest('panel', `d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger').click();w.__picker=d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger');w.__pickerPopup=d.querySelector('.oc-sdk-popup');w.__graphDelivered=false;const receive=e=>{try{const b=JSON.parse(e.data?.payload?.body);if(typeof b.itemCount==='number'&&typeof b.revision==='number'){w.removeEventListener('message',receive);w.requestAnimationFrame(()=>w.requestAnimationFrame(()=>w.__graphDelivered=true))}}catch{}};w.addEventListener('message',receive);return true`);
    await wait('panel', `w.__picker?.getAttribute('aria-expanded')==='true'&&w.__pickerPopup`);
    await evaluate(`qa.release('picker-background-graph');true`);
    await wait('panel', `w.__graphDelivered`);
    const picker = await guest('panel', `return {connected:w.__picker.isConnected,popup:w.__pickerPopup.isConnected,expanded:w.__picker.getAttribute('aria-expanded'),haspopup:w.__picker.getAttribute('aria-haspopup'),role:w.__picker.getAttribute('role')}`);
    check('picker:survives-background-graph', picker.connected&&picker.popup&&picker.expanded==='true', picker);
    await guest('panel', `[...d.querySelectorAll('.oc-sdk-option-label')].find(n=>n.textContent==='Opening small').closest('[role="option"]').click();return true`);
    await wait('panel', `d.querySelector('[data-testid="map-title"]')?.textContent==='Opening small'&&d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);
    check('picker:choice-after-background-graph', true);
    // A real automatic inbox continuation/recheck completes while an independent picker is open.
    await evaluate(`qa.holds.push({tag:'picker-background-inbox',path:'/v1/needs-you',frame:'panel',cursor:true});true`);
    await wait('panel', `qa.held.some(h=>h.tag==='picker-background-inbox')`);
    await guest('panel', `d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger').click();w.__inboxPicker=d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger');w.__inboxPopup=d.querySelector('.oc-sdk-popup');w.__inboxDelivered=false;const receive=e=>{try{const b=JSON.parse(e.data?.payload?.body);if(Array.isArray(b.rows)&&b.coverage){w.removeEventListener('message',receive);w.requestAnimationFrame(()=>w.requestAnimationFrame(()=>w.__inboxDelivered=true))}}catch{}};w.addEventListener('message',receive);return true`);
    await wait('panel', `w.__inboxPicker?.getAttribute('aria-expanded')==='true'&&w.__inboxPopup`);
    await evaluate(`qa.release('picker-background-inbox');true`);
    await wait('panel', `w.__inboxDelivered`);
    const inboxPicker = await guest('panel', `return {connected:w.__inboxPicker.isConnected,popup:w.__inboxPopup.isConnected,expanded:w.__inboxPicker.getAttribute('aria-expanded')}`);
    check('picker:survives-background-inbox', inboxPicker.connected&&inboxPicker.popup&&inboxPicker.expanded==='true', inboxPicker);
    await guest('panel', `[...d.querySelectorAll('.oc-sdk-option-label')].find(n=>n.textContent==='Opening 100').closest('[role="option"]').click();return true`);
    await wait('panel', `d.querySelector('[data-testid="map-title"]')?.textContent==='Opening 100'&&d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);
    check('picker:choice-after-background-inbox', true);
  }
  for (const [surface, width] of [['panel', 360], ['panel', 390], ['panel', 600], ['page', 1280], ['page', 1920]] as const) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate(`qa.show([${js(surface)}],${width});frame(${js(surface)}).style.height='950px';qa.context('M');true`);
    for (const id of ['small', '100', '980']) {
      const plan = `P-opening-${id}`;
      if (surface === 'page') {
        await wait(surface, `d.querySelector('[data-testid="plan-row-${plan}"]')`);
        await guest(surface, `d.querySelector('[data-testid="plan-row-${plan}"]').click();return true`);
      } else {
        await pickRailPlan(`Opening ${id}`);
      }
      await wait(surface, `JSON.parse(d.querySelector('[data-map-identity]')?.dataset.mapIdentity??'[]')[6]===${js(plan)}&&d.querySelectorAll('.ap-map-card').length===${id === 'small' ? 14 : Number(id)}`);
      const opening = await guest(surface, `const v=d.querySelector('.ap-map-viewport'),m=new w.DOMMatrix(w.getComputedStyle(d.querySelector('.ap-map-world')).transform);return {zoom:m.a,selected:d.querySelector('[data-testid="map-inspector"]')?.dataset.selected,height:v.clientHeight}`);
      if (!measureOnly) {
        const png = await c.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(artifacts, `opening-${surface}-${width}-${id}.png`), Buffer.from(png.data, 'base64'));
        check(`${surface}-${width}-${id}:no-opening-selection`, opening.selected === '');
        check(`${surface}-${width}-${id}:frame-cap`, opening.height <= (surface === 'panel' ? 300 : 950 * .64));
      }
      await guest(surface, `d.querySelector('[data-testid="map-fit-all"]').click();return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
      measurements.push(await guest(surface, `const v=d.querySelector('.ap-map-viewport'),world=d.querySelector('.ap-map-world'),title=d.querySelector('.ap-map-card-title'),m=new w.DOMMatrix(w.getComputedStyle(world).transform),font=parseFloat(w.getComputedStyle(title).fontSize);return {surface:${js(surface)},width:${width},plan:${js(id)},canvas:{width:v.clientWidth,height:v.clientHeight},fitAllScale:m.a,titleCssPx:font,renderedTitlePx:font*m.a,thresholdTitlePx:font*.7,readableTitlePx:font*.8,branch:m.a>=.7?'all':'current'}`));
      if (!measureOnly) {
        const fit = (measurements.at(-1) as { fitAllScale: number }).fitAllScale;
        check(`${surface}-${width}-${id}:opening-branch`, Math.abs(opening.zoom - (fit >= .7 ? fit : .8)) < .00001, { opening: opening.zoom, fit });
        check(`${surface}-${width}-${id}:fit-all-visible`, await guest(surface, `const v=d.querySelector('.ap-map-viewport').getBoundingClientRect();return [...d.querySelectorAll('.ap-map-card')].every(n=>{const r=n.getBoundingClientRect();return r.left>=v.left&&r.top>=v.top&&r.right<=v.right&&r.bottom<=v.bottom})`));
      }
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(artifacts, `threshold-${surface}-${width}-${id}.png`), Buffer.from(shot.data, 'base64'));
      if (measureOnly && id === 'small') {
        // Labelled measurement-only calibration, not an opening/interaction assertion: display the
        // shipped cards at exactly the candidate threshold so their actual glyphs can be inspected.
        await guest(surface, `d.querySelector('.ap-map-world').style.transform='translate(0px,0px) scale(.7)';d.querySelector('.ap-map-viewport').scrollIntoView({block:'center'});return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
        const calibration = await c.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(artifacts, `calibration-70-${surface}-${width}.png`), Buffer.from(calibration.data, 'base64'));
      }
    }
  }
  if (!measureOnly) {
    fx.enableMapAttribution().blocker();
    fx.reportMap('P-map', { op: 'change', changes: [{ id: 'F', status: 'blocked', blocker: { category: 'decision', reason: 'Choose the release format', nextAction: 'Select JSON or CSV' } }] });
    const key = async (key: string) => { for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: ({ Enter: 13, Escape: 27, Tab: 9 } as Record<string, number>)[key] ?? 0, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) }); };
    const activate = async (surface: string, selector: string) => { await guest(surface, `d.querySelector(${js(selector)}).focus();return true`); await key('Enter'); await guest(surface, `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`); };
    for (const [surface, width] of [['panel',390],['page',390],['page',1280]] as const) for (const locale of ['en','ru','zh-CN']) for (const theme of ['light','dark']) {
      await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width === 390 });
      await c.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390 });
      await evaluate(`qa.show([${js(surface)}],${width});qa.locale=${js(locale)};qa.theme(${js(theme)});frame(${js(surface)}).style.height='844px';true`);
      if (surface === 'page') {
        await wait(surface, `d.querySelector('[data-testid="plan-row-P-map"][data-source="source-alpha"]')`);
        await guest(surface, `d.querySelector('[data-testid="plan-row-P-map"][data-source="source-alpha"]').click();return true`);
      } else {
        await pickRailPlan('Dependency map fixture');
      }
      await wait(surface, `d.documentElement.lang===${js(locale)}&&d.querySelector('[data-testid="map-card-F"]')?.textContent.includes(${js({en:'Needs you',ru:'Нужно ваше участие','zh-CN':'需要你处理'}[locale])})`);
      const name = `${surface}-${width}-${locale}-${theme}`;
      check(`${name}:main-vs-child-blocker`, await guest(surface, `const a=d.querySelector('[data-testid="map-card-F"]'),b=d.querySelector('[data-testid="map-card-B"]');return a.getAttribute('aria-label').includes(${js({en:'Needs you',ru:'Нужно ваше участие','zh-CN':'需要你处理'}[locale])})&&b.textContent.includes(${js({en:'Blocked',ru:'Заблокирована','zh-CN':'受阻'}[locale])})&&!b.textContent.includes(${js({en:'Needs you',ru:'Нужно ваше участие','zh-CN':'需要你处理'}[locale])})`));
      await activate(surface, '[data-testid="map-card-B"]');
      await wait(surface, `d.querySelector('[data-testid="map-inspector"]')?.dataset.selected==='B'`);
      check(`${name}:literal-child-blocker-details`, await guest(surface, `const n=d.querySelector('[data-testid="map-inspector"]');return n.textContent.includes('<b>Ask the main session</b>')&&n.textContent.includes('Choose a format')&&!n.querySelector('b')`));
      await key('Escape');
      await wait(surface, `d.querySelector('[data-testid="map-inspector"]')?.dataset.selected===''`);
      const toolbar = await guest(surface, `const n=[...d.querySelectorAll('[data-testid="map-toolbar"] :is(.oc-sdk-btn,.ap-map-tool,summary)')].filter(x=>x.getClientRects().length);return {boxes:n.map(x=>({id:x.dataset.testid??x.closest('[data-testid]')?.dataset.testid,y:x.getBoundingClientRect().y,width:x.getBoundingClientRect().width})),overflow:d.documentElement.scrollWidth>w.innerWidth}`);
      check(`${name}:one-toolbar-row`, toolbar.boxes.every((x:any)=>Math.abs(x.y-toolbar.boxes[0].y)<6)&&!toolbar.overflow, toolbar);
      check(`${name}:no-redundant-rows`, await guest(surface, `return !d.querySelector('.ap-map-card-foot')&&!d.querySelector('[data-testid="map-summary"]')&&!d.querySelector('[data-testid="map-focus-current"]')&&!d.querySelector('[data-testid="map-pan-right"]')`));
      await activate(surface, '[data-testid="map-help-trigger"]');
      await wait(surface, `d.querySelector('[data-testid="map-help"]').open`);
      const tree = await c.send('Page.getFrameTree');
      const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.includes(`/ui/${surface}/`)).frame.id;
      const ax = await c.send('Accessibility.getFullAXTree', { frameId });
      check(`${name}:accessible-help`, ax.nodes.some((n:any) => !n.ignored && n.name?.value === {en:'Help and filters',ru:'Справка и фильтры','zh-CN':'帮助和筛选'}[locale]));
      await key('Tab');
      check(`${name}:filters-in-tab-order`, await guest(surface, `return d.activeElement?.closest('[data-testid="map-status"]')!==null`));
      await key('Escape');
      check(`${name}:escape-returns-trigger`, await guest(surface, `return !d.querySelector('[data-testid="map-help"]').open&&d.activeElement?.dataset.testid==='map-help-trigger'`));
      await activate(surface, '[data-testid="map-help-trigger"]');
      await activate(surface, '[data-testid="map-status-unfinished"] button');
      await wait(surface, `d.querySelector('[data-testid="map-help-trigger"]')?.hasAttribute('data-filtered')`);
      await activate(surface, '[data-testid="map-filter-clear"] button');
      check(`${name}:clear-removes-filter`, await guest(surface, `return !d.querySelector('[data-testid="map-help-trigger"]').hasAttribute('data-filtered')&&!d.querySelector('[data-testid="map-filter-line"]')`));
      await guest(surface, `w.__zoomMessages=[];w.__zoomObserver?.disconnect();const n=d.querySelector('[data-testid="map-announcer"]');w.__zoomObserver=new MutationObserver(()=>{if(n.textContent.includes('%'))w.__zoomMessages.push(n.textContent)});w.__zoomObserver.observe(n,{subtree:true,childList:true,characterData:true});return true`);
      await activate(surface, '[data-testid="map-zoom-in"]');
      await wait(surface, `!d.querySelector('[data-testid="map-zoom-level"]').hidden&&w.__zoomMessages.length>0`);
      check(`${name}:zoom-announced-once`, await guest(surface, `return w.__zoomMessages.length===1`));
      await wait(surface, `d.querySelector('[data-testid="map-zoom-level"]').hidden`);
      await guest(surface, `w.scrollTo(0,0);return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
      const png = await c.send('Page.captureScreenshot', { format:'png' });
      writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data,'base64'));
    }
    await activate('page', '[data-testid="map-card-B"]');
    fx.reportMap('P-map', { op: 'revise', items: [] });
    await wait('page', `d.querySelector('[data-testid="map-region"]')?.dataset.tasks==='0'&&d.activeElement?.dataset.testid==='map-viewport'`);
    check('last-focused-card-removed:empty-target-reachable', await guest('page', `return d.activeElement?.tabIndex===0&&d.activeElement.hasAttribute('data-map-empty-target')&&d.querySelector('[data-testid="map-viewport"]').clientHeight>=100`));
    await reviewRegressions();
  }
  writeFileSync(join(artifacts, measureOnly ? 'threshold.json' : 'opening.json'), JSON.stringify({ evidence: 'Source guests, real disposable service, Chromium; not native host or physical phone', threshold: 0.7, readable: 0.8, titleAtThreshold: 8.75, decision: measureOnly ? 'Pending visual review of the threshold captures before implementation.' : 'Retain measured 70% threshold, 80% readable zoom; coarse pointers 100%.', measurements, checks, passed: true }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, measurements: measurements.length }));
} finally {
  await browser?.stop(); await fx?.stop(); assets.dispose(); rmSync(scratch, { recursive: true, force: true });
}
