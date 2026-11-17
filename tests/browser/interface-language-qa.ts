// Current built guests in a disposable SDK host and Chromium profile; no live profile or model.
// Build first. Usage: interface-language-qa.ts --chromium <binary> --artifacts <directory>
// The language control lives in More, not the retired footer. Default-state copy is checked
// through rendered text AND Chromium's accessibility tree in all three languages.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { LANGUAGE_KEY, USER_TASK_TITLE, startLanguageFixture } from './interface-language-fixture.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';
import { internalCopy } from './interface-copy.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const destination = arg('--artifacts');
if (!destination) throw new Error('Pass --artifacts <directory>');
const artifacts = resolve(destination);
mkdirSync(artifacts, { recursive: true });
const results: { id: string; pass: boolean; facts?: unknown }[] = [];
const check = (id: string, pass: boolean, facts?: unknown) => {
  results.push({ id, pass, ...(facts === undefined ? {} : { facts }) });
  if (!pass) throw new Error(id);
};
let fx: Awaited<ReturnType<typeof startLanguageFixture>> | undefined;
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
let failure: string | null = null;
try {
  fx = await startLanguageFixture();
  browser = await launchChromium(chromiumPath(arg('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Accessibility.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('QA expression failed: ' + r.exceptionDetails.text);
    return r.result.value;
  };
  const guest = <T = any>(surface: string, code: string) => evaluate<T>(`(()=>{const w=frame(${js(surface)}).contentWindow,d=w.document;${code}})()`);
  const wait = async (condition: string, label: string) => {
    check(label, await evaluate(`(async()=>{const end=performance.now()+10000;while(performance.now()<end){try{if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`));
  };
  const inFrame = (s: string, condition: string) => `(()=>{const d=frame(${js(s)}).contentDocument;return ${condition}})()`;
  const settle = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const show = async (s: string, width: number) => { await evaluate(`qa.show(${js(s)},${width})`); await settle(); };
  const click = async (s: string, selector: string) => {
    await guest(s, `d.querySelector(${js(selector)})?.scrollIntoView({block:'center'});`);
    await settle();
    const p = await guest<number[] | null>(s, `const n=d.querySelector(${js(selector)});if(!n)return null;const r=n.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    if (!p) throw new Error('Missing control ' + selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 });
  };
  const key = async (key: string) => {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, Home: 36, ArrowDown: 40 };
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key], ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await settle();
  };
  const openMore = async (s: string) => {
    await click(s, '[data-testid="more-trigger"]');
    await wait(inFrame(s, `d.querySelector('[data-testid="more-trigger"]')?.getAttribute('aria-expanded')==='true'`), `${s}:More opens`);
  };
  const select = async (s: string, language: string) => {
    await show(s, 390); await openMore(s);
    await click(s, '[data-testid="more-language"]');
    await wait(inFrame(s, `!!d.querySelector('[role="menuitemradio"]')`), 'language choices open');
    await guest(s, `d.querySelector('[role="menuitemradio"]').focus();`);
    await key('Home');
    for (let i = 0; i <= ['auto', 'en', 'ru', 'zh-CN'].indexOf(language); i++) await key('ArrowDown');
    check(`${s}:keyboard focuses ${language}`, await guest(s, `return d.activeElement?.dataset.testid===${js('more-language-' + language)}`), await guest(s, `return {active:d.activeElement?.dataset.testid,expanded:d.querySelector('[data-testid="more-trigger"]')?.getAttribute('aria-expanded')}`));
    await key('Enter');
  };
  const choose = async (s: string, language: string) => {
    await select(s, language);
    await wait(`qa.maps.get(qa.space)?.get(${js(LANGUAGE_KEY)})?.preference===${js(language)}`, 'language saved');
    await key('Escape');
    for (const f of ['panel', 'page', 'status']) {
      await evaluate(`qa.focus(${js(f)})`);
      await wait(inFrame(f, `d.documentElement.lang===${js(language)}`), `${f}:language=${language}`);
    }
  };
  const shot = async (s: string, name: string) => {
    const r = await c.send('DOM.getDocument', { depth: 1 });
    const n = await c.send('DOM.querySelector', { nodeId: r.root.nodeId, selector: `iframe[data-surface="${s}"]` });
    const b = await c.send('DOM.getBoxModel', { nodeId: n.nodeId });
    const q = b.model.content;
    const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: q[0], y: q[1], width: q[2] - q[0], height: q[5] - q[1], scale: 1 } });
    writeFileSync(join(artifacts, name + '.png'), Buffer.from(png.data, 'base64'));
  };
  const scan = async (s: string, label: string) => {
    const visible = await guest<string>(s, `return d.body.innerText`);
    const tree = await c.send('Page.getFrameTree');
    const f = tree.frameTree.childFrames.find((n: any) => n.frame.url.includes(`/ui/${s}/`));
    const ax = await c.send('Accessibility.getFullAXTree', { frameId: f.frame.id });
    // InlineTextBox nodes are layout fragments of StaticText, not separate accessible names;
    // inspecting both would split an agent's literal title at arbitrary wrapping boundaries.
    const names = ax.nodes.filter((n: any) => !n.ignored && n.role?.value !== 'InlineTextBox').flatMap((n: any) => [n.name?.value, n.description?.value]).filter(Boolean).join('\n');
    const bad = internalCopy(visible + '\n' + names, [USER_TASK_TITLE]);
    results.push({ id: `${s}:${label}:plain visible text and accessible names`, pass: bad.length === 0, facts: bad });
    check(`${s}:${label}:no overflow`, await guest(s, `return d.documentElement.scrollWidth<=d.documentElement.clientWidth+1`));
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
  await wait(`window.qa&&['panel','page','status'].every(s=>frame(s).contentDocument?.querySelector('[data-testid="progress-root"]'))`, 'built guests mounted');
  await evaluate('qa.dark()');
  // Default states include no session, no plan, a failed read, Setup and a populated plan.
  for (const language of ['en', 'ru', 'zh-CN']) {
    await choose('page', language);
    for (const mode of ['no-session', 'empty', 'failure', 'setup', 'recording-off', 'plan']) {
      await evaluate(`qa.mode=${js(mode === 'no-session' ? 'empty' : mode)};qa.context(${mode === 'no-session' ? 'null' : js(fx.session)});['panel','page','status'].forEach(s=>qa.reload(s))`);
      for (const s of ['panel', 'page', 'status']) {
        await show(s, s === 'status' ? 280 : 390);
        await wait(inFrame(s, `d.documentElement.lang===${js(language)}&&!!d.querySelector('[data-testid="progress-root"]')`), `${s}:${mode}:ready`);
        const hook = mode === 'failure' ? 'failure-state' : mode === 'setup' ? 'setup-needed' : mode === 'plan' || mode === 'recording-off' ? (s === 'status' ? 'status-plan-title' : 'surface-header') : mode === 'no-session' && s !== 'page' ? 'unscoped-state' : 'empty-state';
        const target = mode === 'failure' ? '[role="alert"][data-testid^="state-"]' : `[data-testid="${hook}"]`;
        await wait(inFrame(s, `!!d.querySelector(${js(target)})`), `${s}:${mode}:settled`);
        await scan(s, `${language}:${mode}`);
        if (mode === 'recording-off') check(`${s}:${language}:recording-off appears once`, await guest(s, `return d.querySelectorAll('[data-testid="capture-off"]').length===1&&!d.querySelector('[data-testid="needs-you-capture-off"],[data-testid="subagent-coverage"][data-notes="capture-off"]')`));
        if (mode === 'plan' && s !== 'status') check(`${s}:${language}:agent title stays literal`, await guest(s, `return d.body.textContent.includes(${js(USER_TASK_TITLE)})&&!w.__qaInjected`));
        if (mode === 'plan') await shot(s, `${s}-${language}-${s === 'status' ? 280 : 390}`);
        if (mode === 'setup' && s !== 'status') {
          await openMore(s); await click(s, '[data-testid="more-setup"]');
          await wait(inFrame(s, `!!d.querySelector('[data-testid="setup-storeRoot"] input')`), `${s}:fresh Setup form`);
          await scan(s, `${language}:fresh Setup form`);
          await shot(s, `${s}-setup-${language}-390`);
          await guest(s, `d.querySelector('[data-testid="setup-changes"] > summary').focus();`);
          await key('Enter');
          check(`${s}:${language}:Setup disclosure opens with keyboard`, await guest(s, `return d.querySelector('[data-testid="setup-changes"]').open`));
          const tree = await c.send('Page.getFrameTree');
          const setupFrame = tree.frameTree.childFrames.find((n: any) => n.frame.url.includes(`/ui/${s}/`));
          const setupAx = await c.send('Accessibility.getFullAXTree', { frameId: setupFrame.frame.id });
          check(`${s}:${language}:Setup disclosure has an accessible expanded name`, setupAx.nodes.some((n: any) => n.role?.value === 'DisclosureTriangle' && n.name?.value && n.properties?.some((p: any) => p.name === 'expanded' && p.value.value === true)));
          check(`${s}:${language}:recording stays outside disclosure`, await guest(s, `return !d.querySelector('[data-testid="managed-capture-control"]').closest('[data-testid="setup-changes"]')`));
          await key('Enter');
          await click(s, '[data-testid="surface-panel-back"] button');
        }
      }
    }
    for (const width of [190, 280, 390]) {
      await show('status', width);
      await scan('status', `${language}:plan:${width}`);
    }
    for (const s of ['panel', 'page']) {
      await show(s, 390); await openMore(s);
      await click(s, '[data-testid="more-troubleshooting"]');
      await wait(inFrame(s, `!!d.querySelector('[data-testid="advanced-details"]')`), 'Troubleshooting panel');
      await scan(s, `${language}:Troubleshooting collapsed`);
      await click(s, '[data-testid="advanced-details"] > summary');
      const fonts = await guest<string[]>(s, `return [...d.querySelectorAll('.ap-facts dd')].map(n=>w.getComputedStyle(n).fontFamily)`);
      const bodyFont = await guest<string>(s, `return w.getComputedStyle(d.body).fontFamily`);
      check(`${s}:${language}:Advanced values use UI font at 390px`, fonts.length > 0 && fonts.every(font => font === bodyFont), { fonts, bodyFont });
      await shot(s, `${s}-advanced-${language}-390`);
      await click(s, '[data-testid="surface-panel-back"] button');
      check(`${s}:Back returns focus to More`, await guest(s, `return d.activeElement===d.querySelector('[data-testid="more-trigger"]')`));
    }
  }
  // Retain language-storage failure/race evidence from the former footer driver,
  // now through the shipped More submenu. A pending save is never a false choice.
  await choose('page', 'en');
  await show('panel', 390); await openMore('panel');
  await click('panel', '[data-testid="more-summary-progress"]');
  await wait(inFrame('panel', `!!d.querySelector('[data-testid="summary-text"]')`), 'progress preview opened from More');
  const englishPreview = await guest<string>('panel', `return d.querySelector('[data-testid="summary-text"]').value`);
  await choose('page', 'ru');
  const russianPreview = await guest<string>('panel', `return d.querySelector('[data-testid="summary-text"]').value`);
  // The Markdown serializer escapes markup in task titles; its representation has separate
  // tests. Here the retained plan title must remain literal while surrounding labels change.
  check('retained preview translates without changing plan title', englishPreview !== russianPreview && englishPreview.includes('Alpha implementation') && russianPreview.includes('Alpha implementation'));
  await show('panel', 390); await click('panel', '[data-testid="summary-close"]');
  await choose('page', 'en');
  await evaluate(`qa.holds=[{tag:'language-save',kind:'storage',surface:'page',op:'set',key:${js(LANGUAGE_KEY)}}]`);
  await select('page', 'ru');
  await wait(`qa.held.some(h=>h.tag==='language-save')`, 'pending language write held');
  check('pending write keeps English', await guest('page', `return d.documentElement.lang==='en'`));
  await evaluate(`qa.release('language-save')`);
  await wait(inFrame('page', `d.documentElement.lang==='ru'`), 'successful language write updates UI');
  await choose('page', 'en');
  await evaluate(`qa.holds=[{tag:'old-language',kind:'storage',surface:'page',op:'get',key:${js(LANGUAGE_KEY)}}];qa.focus('page')`);
  await wait(`qa.held.some(h=>h.tag==='old-language')`, 'old language read held');
  await choose('page', 'ru');
  await evaluate(`qa.release('old-language')`);
  await settle();
  check('late read cannot undo a confirmed choice', await guest('page', `return d.documentElement.lang==='ru'`));
  await evaluate(`qa.faults=[{kind:'storage',surface:'page',op:'set',key:${js(LANGUAGE_KEY)},code:'HOST_REJECTED'}]`);
  await select('page', 'en');
  await settle();
  check('failed write keeps confirmed language', await guest('page', `return d.documentElement.lang==='ru'`));
  await openMore('page'); await click('page', '[data-testid="more-language"]');
  await wait(inFrame('page', `!!d.querySelector('[data-testid="more-popup"] [role="status"]')?.textContent`), 'failed write has accessible feedback');
  await key('Escape'); await evaluate('qa.faults=[]');
  const storageCount = await evaluate<number>('qa.storageLog.length');
  await evaluate(`qa.ready(null,{features:{},locale:'zh-CN'})`);
  for (const s of ['panel', 'page']) {
    await show(s, 390); await openMore(s); await click(s, '[data-testid="more-language"]');
    check(`${s}:unsupported choices disabled`, await guest(s, `return [...d.querySelectorAll('[role="menuitemradio"]')].every(n=>n.disabled)`));
    await scan(s, 'unsupported language storage');
    await key('Escape');
  }
  check('unsupported host makes no storage request', storageCount === await evaluate<number>('qa.storageLog.length'));
  check('no progress mutations', await evaluate(`qa.requests.every(q=>q.method==='GET')`));
  check('no runtime errors', c.errors.length === 0, c.errors);
} catch (error) {
  failure = error instanceof Error ? error.message : 'QA failed';
  if (browser) {
    const png = await browser.page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(artifacts, 'failure.png'), Buffer.from(png.data, 'base64'));
  }
} finally {
  await browser?.stop(); await fx?.stop();
  if (!failure && results.some(r => !r.pass)) failure = 'Some rendered copy checks failed';
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ passed: !failure, failure, results, nativeHostProof: false }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: !failure, failure, assertions: results.length }));
  if (failure) process.exitCode = 1;
}
