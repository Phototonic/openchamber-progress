// Synthetic SDK shell and isolated real-service map, not native-host/physical-phone certification.
// Usage: node --experimental-strip-types tests/browser/surface-shell-qa.ts --source --chromium <path> --artifacts <dir>
// Focused: add --linked-work-only for the header's host-linked work chips (board and rail) alone.
// Real CDP pointer and keyboard input; no click/focus dispatch from page JavaScript.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { failureCopy, shellCopy } from '../../ui/shared/components.ts';
import { managedCopy } from '../../ui/shared/managed-copy.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { S } from './fixtures.ts';
import { startPhoneShell } from './phone-layout-shell.ts';
import { startDigestShell } from './change-digests-shell.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw Error('Pass --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });
const results: { id: string; pass: boolean; facts?: unknown }[] = [], screenshots: string[] = [];
const check = (id: string, pass: boolean, facts?: unknown) => { results.push({ id, pass, facts }); if (!pass) throw Error(id + ': ' + JSON.stringify(facts)); };
let fixture: Awaited<ReturnType<typeof startLanguageFixture>> | undefined;
let maps: Awaited<ReturnType<typeof startPhoneShell>> | undefined;
let digest: Awaited<ReturnType<typeof startDigestShell>> | undefined;
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
  let width = 390, touch = true;
  const viewport = async (w: number, height = 844, phone = w === 390) => {
    width = w; touch = phone;
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height, deviceScaleFactor: 1, mobile: phone });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: phone });
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
    if (touch) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const shot = async (name: string, height = 844) => {
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64')); screenshots.push(`${name}.png`);
  };
  const back = async (surface: string, opener = 'settings-trigger') => {
    await click(surface, '[data-testid="surface-panel-back"] button');
    await wait(surface, `!d.querySelector('[data-testid="surface-panel-heading"]') && d.activeElement?.dataset.testid===${js(opener)}`);
  };
  // Host-linked work: real guest entries over the synthetic workspace bridge. The recording host
  // never visits a destination; it only records (or refuses) each open-url request.
  const linkedWork = async () => {
    type Link = { title: string; kind: 'issue' | 'change'; url: string; linkedAt: number };
    const owner: Link[] = [{ title: 'PR #95', kind: 'change', url: 'https://example.invalid/review/95', linkedAt: 2 }, { title: 'Issue #12', kind: 'issue', url: 'https://example.invalid/tracker/12', linkedAt: 1 }];
    const child: Link[] = [{ title: 'Child-only change', kind: 'change', url: 'https://example.invalid/review/child', linkedAt: 3 }];
    const sessions = (ownerLinks: Link[]) => [[S.M, null, ownerLinks], [S.C1, S.M, child]].map(([id, parentId, links]) => ({
      id, title: id === S.M ? 'Example main session' : 'Example child session', projectId: 'alpha', directory: '/fixture/Alpha', parentId,
      createdAt: 1, updatedAt: 2, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [], ...((links as Link[]).length ? { links } : {}),
    }));
    const setLinks = (links: Link[]) => evaluate(`qa.linkSessions=${js(sessions(links))};true`);
    const push = (surface: string) => evaluate<number>(`qa.pushWorkspace(${js(surface)})`);
    const chips = '[data-testid="surface-header"] [data-testid="linked-work-link"]';
    const chipCount = (n: number) => `d.querySelectorAll(${js(chips)}).length===${n}`;
    const capture = async (name: string, w: number, height = 640) => {
      const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height, scale: 1 } });
      writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64')); screenshots.push(`${name}.png`);
    };
    const settle = (surface: string) => guest(surface, 'w.scrollTo(0,0);return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))');
    const axNames = async (surface: string) => {
      const tree = await c.send('Page.getFrameTree');
      const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.includes(`/ui/${surface}/`)).frame.id;
      return (await c.send('Accessibility.getFullAXTree', { frameId })).nodes.filter((n: any) => ['button', 'group'].includes(n.role?.value)).map((n: any) => `${n.role.value}:${n.name?.value ?? ''}`) as string[];
    };
    const space = async () => {
      for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, ...(type === 'keyDown' ? { text: ' ' } : {}) });
    };
    const tabTo = async (surface: string, condition: string) => {
      for (let i = 0; i < 60 && !await guest(surface, `return ${condition}`); i++) await key('Tab');
      return guest<boolean>(surface, `return ${condition}`);
    };
    const opens = () => evaluate<{ surface: string; url: string }[]>('qa.opens');
    const noOverflow = (surface: string) => guest<boolean>(surface, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth');

    await c.send('Page.navigate', { url: `http://127.0.0.1:${fixture!.port}/` });
    await wait('panel', `!!d.querySelector('[data-testid="settings-trigger"]')`);
    await setLinks(owner);
    const projects = { kind: 'projects', state: 'ready', projects: [{ id: 'alpha', name: 'Alpha', directory: '/fixture/Alpha' }] };
    await evaluate(`document.querySelector('#outside').hidden=true;document.querySelectorAll('section').forEach(n=>n.style.margin='0');
      qa.workspace=q=>q.kind==='projects'?${js(projects)}:{kind:q.kind,state:'ready',projectId:q.projectId,worktrees:[],coverage:[{directory:'/fixture/Alpha',state:'ready'}],sessions:q.kind==='sessions'&&q.projectId==='alpha'?structuredClone(qa.linkSessions):[]};
      qa.context(${js(S.M)});qa.reload('panel');qa.reload('page');true`);
    const views = [['page', 'board', 1280], ['panel', 'rail', 390]] as const;
    // Light first (the fixture's dark switch is one-way), then the dark matrix with the interactions.
    for (const [surface, name, size] of views) {
      await viewport(size, 844, false);
      await evaluate(`qa.show(${js(surface)},${size});true`);
      await wait(surface, `${chipCount(2)} && !!d.querySelector('.ap-tasks[data-complete]')`);
      await settle(surface);
      await capture(`${name}-with-links-light`, size);
    }
    await evaluate(`qa.dark();document.body.style.background='#191b20';true`);
    for (const [surface, name, size] of views) {
      await viewport(size, 844, false);
      await evaluate(`qa.show(${js(surface)},${size});true`);
      await wait(surface, `${chipCount(2)} && getComputedStyle(d.body).backgroundColor==='rgb(25, 27, 32)' && !!d.querySelector('.ap-tasks[data-complete]')`);
      const header = await guest<{ titles: string[]; kinds: string[]; text: string; label: boolean; total: number }>(surface, `const h=d.querySelector('[data-testid="surface-header"]'),b=[...h.querySelectorAll('[data-testid="linked-work-link"]')];return {
        titles:b.map(n=>n.querySelector('.ap-work-link-title').textContent),kinds:b.map(n=>n.dataset.kind),text:h.textContent,
        label:h.querySelector('.ap-work-links-label').checkVisibility(),total:d.querySelectorAll('[data-testid="linked-work-link"]').length}`);
      check(`${name}-owner-links-only`, header.titles.join('|') === 'PR #95|Issue #12' && header.kinds.join('|') === 'change|issue' && !header.text.includes('Child-only') && header.total === 2 && header.label, header);
      check(`${name}-no-open-on-render`, (await opens()).length === 0, await opens());
      const names = await axNames(surface);
      check(`${name}-accessible-names`, ['group:Linked in OpenChamber', 'button:Host-linked change: PR #95', 'button:Host-linked issue: Issue #12'].every(n => names.includes(n)), names.filter(n => /Linked|Host-linked/.test(n)));
      check(`${name}-with-links-no-overflow`, await noOverflow(surface));
      await settle(surface);
      await capture(`${name}-with-links`, size);
      const location = await guest<string>(surface, 'return w.location.href');
      const toasts = await evaluate<number>('qa.toasts.length');
      await click(surface, chips);
      await evaluate('new Promise(r=>setTimeout(r,150))');
      check(`${name}-pointer-opens-once`, JSON.stringify(await opens()) === JSON.stringify([{ surface, url: owner[0]!.url }]), await opens());
      const second = `d.activeElement?.dataset.testid==='linked-work-link' && d.activeElement.dataset.kind==='issue'`;
      check(`${name}-keyboard-reaches-chip`, await tabTo(surface, second));
      const ring = await guest<{ style: string; width: string }>(surface, 'const s=w.getComputedStyle(d.activeElement);return {style:s.outlineStyle,width:s.outlineWidth}');
      check(`${name}-focus-visible`, ring.style === 'solid' && ring.width === '2px', ring);
      await key('Enter');
      await evaluate('new Promise(r=>setTimeout(r,150))');
      await space();
      await evaluate('new Promise(r=>setTimeout(r,150))');
      const keyed = (await opens()).slice(1);
      check(`${name}-keyboard-opens-once-per-activation`, keyed.length === 2 && keyed.every(o => o.surface === surface && o.url === owner[1]!.url), keyed);
      check(`${name}-no-toast-on-success`, await evaluate<number>('qa.toasts.length') === toasts);
      await evaluate('qa.refuseOpens=1;true');
      await click(surface, chips);
      await evaluate(`(async()=>{const end=performance.now()+5000;while(qa.toasts.length===${toasts}&&performance.now()<end)await new Promise(requestAnimationFrame);return true})()`);
      await evaluate('new Promise(r=>setTimeout(r,150))');
      const refusal = await evaluate<{ opens: number; toasts: any[]; refuse: number }>(`({opens:qa.opens.length,toasts:qa.toasts.slice(${toasts}),refuse:qa.refuseOpens})`);
      check(`${name}-refusal-feedback-no-fallback`, refusal.opens === 4 && refusal.refuse === 0 && refusal.toasts.length === 1 && refusal.toasts[0].kind === 'error' && refusal.toasts[0].message === 'Could not open this link.' &&
        await guest(surface, `return w.location.href===${js(location)} && ${chipCount(2)} && !!d.querySelector('[data-testid="plan-title"]')`), refusal);
      // A link-only host update, with no progress revision, request or resubscription.
      const before = await evaluate<{ requests: number; subscribes: number }>(`({requests:qa.requests.length,subscribes:qa.messages.filter(m=>m.type==='workspace-subscribe').length})`);
      await setLinks([]);
      check(`${name}-pushed-without-reload`, await push(surface) > 0);
      await wait(surface, chipCount(0));
      const after = await guest<any>(surface, `return {group:!!d.querySelector('[data-testid="linked-work"]'),title:d.querySelector('[data-testid="plan-title"]')?.textContent,
        progress:!!d.querySelector('[data-testid="progress-legend"]'),more:!!d.querySelector('[data-testid="more-trigger"]'),requests:parent.qa.requests.length,subscribes:parent.qa.messages.filter(m=>m.type==='workspace-subscribe').length}`);
      check(`${name}-link-removal-keeps-header`, !after.group && after.title === 'Alpha implementation' && after.progress && after.more && after.requests === before.requests && after.subscribes === before.subscribes, { before, after });
      check(`${name}-without-links-no-overflow`, await noOverflow(surface));
      await settle(surface);
      await capture(`${name}-without-links`, size);
      await setLinks(owner); await push(surface);
      await wait(surface, chipCount(2));
      await evaluate('qa.opens=[];true');
    }
    // A long title and more links than shown, at 320 CSS px (1280 px at 400% zoom) on a phone rail.
    const long = `Very long linked change title ${'that keeps going and going '.repeat(7)}end`.slice(0, 200);
    const many: Link[] = [{ title: long, kind: 'change', url: 'https://example.invalid/review/long', linkedAt: 9 }, ...Array.from({ length: 5 }, (_, i) => ({ title: `Issue #${20 + i}`, kind: 'issue' as const, url: `https://example.invalid/tracker/${20 + i}`, linkedAt: i }))];
    await setLinks(many); await push('panel');
    await viewport(320, 844, true);
    await evaluate(`qa.show('panel',320);true`);
    await wait('panel', `${chipCount(5)} && !!d.querySelector('[data-testid="linked-work-more"]')`);
    const narrow = await guest<any>('panel', `const b=d.querySelector(${js(chips)}),t=b.querySelector('.ap-work-link-title'),r=b.getBoundingClientRect();return {
      ellipsis:t.scrollWidth>t.clientWidth,inside:r.right<=d.documentElement.clientWidth,tall:[...d.querySelectorAll(${js(chips)})].every(n=>n.getBoundingClientRect().height>=44),
      more:d.querySelector('[data-testid="linked-work-more"]').textContent,title:b.title}`);
    check('rail-320-long-title-truncates-and-fits', narrow.ellipsis && narrow.inside && narrow.tall && narrow.more === 'and more' && narrow.title === long && await noOverflow('panel'), narrow);
    check('rail-320-full-title-spoken', (await axNames('panel')).includes(`button:Host-linked change: ${long}`));
    await settle('panel');
    await capture('rail-320-long-title', 320, 700);
    await setLinks(owner); await push('panel');
    // Localized label, names and refusal feedback.
    await viewport(1280, 844, false);
    await evaluate(`qa.show('page',1280);true`);
    for (const [locale, label, name, failed] of [['ru', 'Связано в OpenChamber', 'Изменение, связанное в хосте: PR #95', 'Не удалось открыть ссылку.'], ['zh-CN', 'OpenChamber 中的关联', '宿主关联的变更: PR #95', '无法打开此链接。']] as const) {
      await evaluate(`qa.ready('page',{locale:${js(locale)}});true`);
      await wait('page', `d.documentElement.lang===${js(locale)} && ${chipCount(2)}`);
      const names = await axNames('page');
      const toasts = await evaluate<number>('qa.toasts.length');
      await evaluate('qa.refuseOpens=1;true');
      await click('page', chips);
      await evaluate(`(async()=>{const end=performance.now()+5000;while(qa.toasts.length===${toasts}&&performance.now()<end)await new Promise(requestAnimationFrame);return true})()`);
      const toast = await evaluate<any>(`qa.toasts[${toasts}]`);
      check(`board-${locale}-localized`, names.includes(`group:${label}`) && names.includes(`button:${name}`) && toast?.message === failed && await noOverflow('page'), { names: names.filter(n => n.includes('PR #95') || n.startsWith('group:')), toast });
    }
    await evaluate(`qa.ready('page',{locale:'en'});true`);
    // Forced colours: system-colour outline on each chip.
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    const forced = await guest<any>('page', `const s=w.getComputedStyle(d.querySelector(${js(chips)}));return {style:s.borderTopStyle,width:s.borderTopWidth,color:s.borderTopColor}`);
    check('board-forced-colors-outline', forced.style === 'solid' && forced.width === '1px' && forced.color !== 'rgba(0, 0, 0, 0)', forced);
    await c.send('Emulation.setEmulatedMedia', { features: [] });
    check('linked-work-no-guest-errors', browser!.page.errors.length === 0, browser!.page.errors);
  };
  const linkedOnly = process.argv.includes('--linked-work-only');
  if (linkedOnly) await linkedWork();
  // Focused iteration mode; the ordinary invocation still runs the full shell matrix.
  if (!process.argv.includes('--review-only') && !linkedOnly) {
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fixture.port}/` });
  await wait('panel', `!!d.querySelector('[data-testid="settings-trigger"]')`);
  // Only fixture chrome changes here, never guest styles or control state.
  await evaluate(`document.querySelector('#outside').hidden=true;document.querySelectorAll('section').forEach(n=>n.style.margin='0');qa.context(${js(fixture.session)});true`);
  const settings = '[data-testid="settings-trigger"]';
  const popup = '[data-testid="settings-popup"]:not([hidden])';
  const active = (id: string) => `d.activeElement?.dataset.menuId===${js(id)} && d.activeElement.tabIndex===0`;
  const appearing = (selector: string) => `!!d.querySelector(${js(selector)})`;
  const warning = appearing('[data-testid="capture-off"]');
  for (const surface of ['panel', 'page']) {
    const size = surface === 'panel' ? 390 : 1280;
    await viewport(size);
    await evaluate(`qa.show(${js(surface)},${size});true`);
    await wait(surface, `${appearing('[data-testid="surface-header"]')} && !${warning} && w.__qaClock.pending.size>0`);
    await click(surface, settings);
    await key('End');
    await wait(surface, active('troubleshooting'));
    await guest(surface, `w.qaMoreRow=d.activeElement;return true`);
    await evaluate(`qa.mode='recording-off';qa.tick(${js(surface)});true`);
    await wait(surface, warning); // Prove the warning painted without waiting for More to close.
    check(`${surface}-more-keeps-focus-through-warning`, await guest(surface, `return ${appearing(popup)} && ${active('troubleshooting')} && d.activeElement===w.qaMoreRow`));
    await shot(`${surface}-more-after-warning`);
    await click(surface, '[data-menu-id="language"]');
    await key('End');
    await wait(surface, active('language-zh-CN'));
    await guest(surface, `w.qaMoreRow=d.activeElement;return true`);
    await wait(surface, `w.__qaClock.pending.size>0`);
    await evaluate(`qa.mode='plan';qa.tick(${js(surface)});true`);
    await wait(surface, `!${warning}`);
    check(`${surface}-language-keeps-focus-through-repaint`, await guest(surface, `return ${appearing(popup)} && ${active('language-zh-CN')} && d.activeElement===w.qaMoreRow`));
    await evaluate(`qa.ready(${js(surface)},{features:{deviceStorage:false}});true`);
    await wait(surface, `d.querySelector('[data-menu-id="language-zh-CN"]')?.disabled===true`);
    const availability = await guest(surface, `return {open:${appearing(popup)},active:d.activeElement?.dataset.menuId,hasFocus:d.hasFocus(),radioDisabled:[...d.querySelectorAll('[role="menuitemradio"]')].every(n=>n.disabled && n.tabIndex===-1)}`);
    check(`${surface}-language-updates-availability`, availability.open && availability.active === 'language-back' && availability.radioDisabled, availability);
    await key('Escape');
    check(`${surface}-repainted-menu-escape`, await guest(surface, `return !${appearing(popup)} && d.activeElement===d.querySelector(${js(settings)})`));
    await evaluate(`qa.ready(${js(surface)},{features:{deviceStorage:true}});true`);
    await click(surface, settings);
    await click(surface, '[data-testid="plan-title"]');
    check(`${surface}-repainted-menu-outside-press`, await guest(surface, `return !${appearing(popup)}`));
    await click(surface, settings);
    await key('Tab');
    check(`${surface}-repainted-menu-focus-departure`, await guest(surface, `return !${appearing(popup)}`));
    await click(surface, settings);
    await click(surface, '[data-menu-id="setup"]');
    await wait(surface, `${appearing('[data-testid="surface-panel-setup"]')} && !${appearing(popup)}`);
    await back(surface);
  }
  for (const size of [390, 1280]) for (const locale of ['en', 'ru', 'zh-CN'] as const) for (const theme of ['light', 'dark']) for (const surface of ['panel', 'page']) {
    await viewport(size);
    const id = `${surface}-${size}-${locale}-${theme}`, t = shellCopy(locale);
    // Deliver themes through the actual host-ready path.
    await evaluate(`qa.show(${js(surface)},${size});qa.seed(undefined);qa.ready(${js(surface)},{locale:${js(locale)},device:{formFactor:${js(size === 390 ? 'phone' : 'desktop')},pointer:${js(size === 390 ? 'coarse' : 'fine')},insets:{top:0,right:0,bottom:0,left:0},keyboard:0}});true`);
    const hostTheme = { mode: theme, tokens: theme === 'dark' ? { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', border: '#414650', hover: '#343944', focus: '#90b8ff', primary: '#83aff7', font: 'system-ui, sans-serif' } : { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', border: '#dedfe3', hover: '#f0f1f3', focus: '#376bc4', primary: '#316ac3', font: 'system-ui, sans-serif' } };
    await evaluate(`(()=>{const payload={...qa.ctx,surface:${js(surface)},settings:{},item:null,theme:${js(hostTheme)}};frame(${js(surface)}).contentWindow.postMessage({channel:'openchamber.sdk',v:1,type:'ready',payload},location.origin);return true})()`);
    await wait(surface, `d.documentElement.lang===${js(locale)} && !!d.querySelector('[data-testid="surface-header"]')`);
    // Match the pinned baseline's List at the top. Navigation assertions below must not
    // leave the next locale/theme capture in History.
    if (!await guest(surface, `return d.querySelector('[data-testid="plan-view-list"] button')?.getAttribute('aria-pressed')==='true'`)) {
      await click(surface, '[data-testid="plan-view-list"] button');
    }
    await wait(surface, `!!d.querySelector('.ap-tasks[data-complete]')`);
    await guest(surface, 'w.scrollTo(0,0);return true');
    await shot(`${id}-view`);
    if (size === 390 && locale === 'en' && theme === 'light') {
      await guest(surface, `w.layoutCopies=0;Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{w.layoutCopies++}}});return true`);
      for (const mode of ['progress', 'handoff']) {
        const opener = `[data-testid="summary-open-${mode}"] button`;
        await click(surface, opener);
        await wait(surface, `!!d.querySelector('[data-testid="summary-text"]')?.value`);
        await click(surface, '[data-testid="summary-close"]');
        await wait(surface, `!d.querySelector('[data-testid="summary-preview"]')&&d.activeElement===d.querySelector(${js(opener)})`);
        check(`${surface}-summary-${mode}-opens-and-closes-without-copy`, await guest(surface, 'return w.layoutCopies===0'));
      }
    }
    await click(surface, '[data-testid="more-trigger"]');
    await wait(surface, `d.querySelector('[data-testid="more-trigger"]').getAttribute('aria-expanded')==='true'`);
    check(`${id}-one-menu`, await guest(surface, `return d.querySelectorAll('[data-testid="more-trigger"]').length===1 && d.querySelectorAll('[role="menu"]:not([hidden])').length===1`));
    await key('End');
    check(`${id}-end`, await guest(surface, `return d.activeElement?.dataset.menuId==='sessions'`));
    await key('Home');
    for (const letter of t.sessions) await key(letter);
    check(`${id}-typeahead`, await guest(surface, `return d.activeElement?.dataset.menuId==='sessions'`));
    const tree = await c.send('Page.getFrameTree');
    const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.includes(`/ui/${surface}/`)).frame.id;
    const ax = await c.send('Accessibility.getFullAXTree', { frameId });
    const names = ax.nodes.filter((n: any) => ['menu', 'menuitem', 'button'].includes(n.role?.value)).map((n: any) => [n.role.value, n.name?.value]);
    check(`${id}-accessible-menu`, names.some(([r, n]: string[]) => r === 'menu' && n === t.more) && names.some(([r, n]: string[]) => r === 'menuitem' && n?.startsWith(t.sessions)) && names.some(([r, n]: string[]) => r === 'button' && n === t.settings), names);
    if (size === 390) check(`${id}-targets`, await guest(surface, `return [...d.querySelectorAll('[role="menu"]:not([hidden]) [role="menuitem"]')].every(n=>n.getBoundingClientRect().height>=44)`));
    await shot(`${id}-more`);
    await key('Escape');
    check(`${id}-escape-focus`, await guest(surface, `return d.activeElement?.dataset.testid==='more-trigger'`));
    await click(surface, settings); await key('Escape');
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
    await click(surface, '[data-testid="plan-view-map"] button');
    check(`${id}-tab-map`, await guest(surface, `return d.activeElement?.closest('[data-testid]')?.dataset.testid==='plan-view-map'`));
    await key('Tab');
    check(`${id}-tab-list`, await guest(surface, `return d.activeElement?.closest('[data-testid]')?.dataset.testid==='plan-view-list'`));
    await key('Tab');
    check(`${id}-tab-document`, await guest(surface, `return d.activeElement?.closest('[data-testid]')?.dataset.testid==='plan-view-document'`));
    await key('Enter');
    await wait(surface, `!!d.querySelector('[data-testid="document-view"]')`);
    await key('Escape');
    await wait(surface, `d.activeElement?.closest('[data-testid]')?.dataset.testid==='plan-view-document'`);
    await key('Tab'); await key('Enter');
    await wait(surface, `!!d.querySelector('[data-testid="history-P-alpha"]') || (!!d.querySelector('[data-testid^="history-"] h3') && d.querySelector('[data-testid="plan-view-history"] button').getAttribute('aria-pressed')==='true')`);
    check(`${id}-history-revisions`, await guest(surface, `return d.querySelectorAll('[data-testid="surface-header"]').length===1 && !d.querySelector('[data-testid="surface-panel-heading"]')`));
    for (const kind of ['sessions', 'setup']) {
      await click(surface, kind === 'sessions' ? '[data-testid="more-trigger"]' : settings);
      await click(surface, `[data-menu-id="${kind}"]`);
      await wait(surface, `!!d.querySelector('[data-testid="surface-panel-${kind}"]')`);
      await back(surface, kind === 'sessions' ? 'more-trigger' : 'settings-trigger');
    }
    // Language is a radio submenu, not a second selector on the default surface.
    await click(surface, settings);
    await click(surface, '[data-menu-id="language"]');
    await wait(surface, `d.querySelectorAll('[role="menuitemradio"]').length===4`);
    await click(surface, '[data-menu-id="language-ru"]');
    await wait(surface, `d.documentElement.lang==='ru'`);
    await click(surface, settings); await click(surface, '[data-menu-id="language"]');
    await click(surface, '[data-menu-id="language-auto"]');
    await wait(surface, `d.documentElement.lang===${js(locale)}`);
    check(`${id}-no-overflow`, await guest(surface, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth'));
  }
  for (const mode of ['empty', 'setup', 'failure', 'port-busy']) for (const locale of ['en', 'ru', 'zh-CN'] as const) for (const surface of ['panel', 'page']) {
    const size = mode === 'port-busy' && surface === 'page' ? 1180 : 390;
    const captureBusy = mode === 'port-busy' && surface === 'panel' && locale === 'en';
    await viewport(size);
    if (captureBusy) await evaluate(`qa.dark();document.body.style.background='#191b20';true`);
    const url = await evaluate<string>(`qa.mode=${js(mode)};qa.seed(undefined);qa.ctx.locale=${js(locale)};qa.show(${js(surface)},${size});qa.reload(${js(surface)});frame(${js(surface)}).src`);
    const state = mode === 'empty' ? 'empty-state' : mode === 'setup' ? 'setup-needed' : 'state-busy';
    await wait(surface, `w.location.href===${js(url)} && d.documentElement.lang===${js(locale)} && !!d.querySelector('[data-testid="${state}"]') && !!d.querySelector(${js(settings)})`);
    if (mode === 'port-busy') {
      const { title, body } = failureCopy('busy', locale);
      check(`${surface}-${mode}-${locale}-busy-copy`, await guest(surface, `const t=d.querySelector('[data-testid="state-busy"]').textContent;return t.includes(${js(title)})&&t.includes(${js(body)})&&!d.querySelector('[data-testid="state-unavailable"]')`));
      if (captureBusy) await shot('23-busy-refusal-390');
    }
    check(`${surface}-${mode}-${locale}-no-document-button`, await guest(surface, `return !d.querySelector('[data-testid="plan-view-document"]')`));
    await click(surface, settings);
    for (const id of ['language', 'setup', 'troubleshooting']) check(`${surface}-${mode}-${id}`, await guest(surface, `return !!d.querySelector('[data-menu-id="${id}"]')`));
    await shot(`${surface}-${mode}-${locale}-more`);
    await key('Escape');
    if (captureBusy) {
      await evaluate(`qa.mode='plan';qa.tick('panel')`);
      await wait(surface, `!d.querySelector('[data-testid="state-busy"]') && !!d.querySelector('[data-testid="plan-title"]')`);
      check('panel-port-busy-recovers-on-poll', true);
    }
  }
  // A responding refusal sends the user to Setup, which is an observation only.
  await evaluate(`qa.dark();document.body.style.background='#191b20';true`);
  for (const surface of ['panel','page']) for (const [size, locale] of [[1180, 'en'], [390, 'en'], [390, 'ru'], [390, 'zh-CN']] as const) {
    const t = shellCopy(locale), words = managedCopy(locale), id = `${surface}-setup-refused-${size}-${locale}`;
    await viewport(size);
    const mark = await evaluate<number>('qa.requests.length');
    const url = await evaluate<string>(`(()=>{const s=${js(surface)};qa.mode='setup-refused';qa.seed(undefined);Object.assign(qa.ctx,{locale:${js(locale)},device:{formFactor:${js(size === 390 ? 'phone' : 'desktop')},pointer:${js(size === 390 ? 'coarse' : 'fine')},insets:{top:0,right:0,bottom:0,left:0},keyboard:0}});qa.show(s,${size});qa.reload(s);return frame(s).src})()`);
    await wait(surface, `w.location.href===${js(url)} && d.documentElement.lang===${js(locale)} && !!d.querySelector('[data-testid="state-setup-refused"]')`);
    const refusal = await guest<string>(surface, `return d.querySelector('[data-testid="state-setup-refused"]').textContent`);
    check(`${id}-guidance`, refusal.includes(t.setup) && (locale === 'zh-CN' ? refusal.includes('齿轮') : refusal.includes(t.settings)), refusal);
    check(`${id}-not-outage-or-empty`, await guest(surface, `return !d.querySelector('[data-testid="state-unavailable"],[data-testid="setup-needed"],[data-testid="empty-state"]')`));
    check(`${id}-admission-only`, await evaluate(`qa.requests.slice(${mark}).filter(q=>q.surface===${js(surface)}).map(q=>q.path).join(',')==='/health,/v1/setup,/health'`));
    const opening = await evaluate<number>('qa.requests.length');
    await click(surface, settings);
    await click(surface, '[data-menu-id="setup"]');
    await wait(surface, `!!d.querySelector('[data-testid="surface-panel-setup"] [data-testid="setup-details"]') &&
      parent.qa.responses.some(r=>r.request>=${opening} && r.surface===${js(surface)} && r.path==='/v1/setup' && r.status===200)`);
    const summary = '[data-testid="setup-details-summary"]';
    const lead = await guest(surface, `const h=d.querySelector('[data-testid="setup-status-heading"]'),details=d.querySelector('[data-testid="setup-details"]');return {
      title:h.textContent, action:h.nextElementSibling.textContent, before:!!(h.compareDocumentPosition(details)&4),
      closed:!details.open, loadHidden:!details.querySelector('[data-testid="managed-load-observation"]').checkVisibility()
    }`);
    check(`${id}-status-and-action-first`, lead.title === words.unverified && lead.action === words.conflict && lead.before && lead.closed && lead.loadHidden, lead);
    const name = `${surface === 'panel' ? '21-setup-refusal-rail-open' : '22-setup-refusal-board-open'}-${size === 390 ? '390' : 'desktop'}`;
    await guest(surface, 'w.scrollTo(0,0);return true');
    if (locale === 'en' || (locale === 'ru' && surface === 'panel')) await shot(`${name}${locale === 'ru' ? '-ru' : ''}-fixed`);
    await key('Tab'); // first stop after the focused Setup panel heading is Back or Details
    if (!await guest(surface, `return d.activeElement===d.querySelector(${js(summary)})`)) await key('Tab');
    check(`${id}-summary-reached-by-tab`, await guest(surface, `return d.activeElement===d.querySelector(${js(summary)})`));
    await key('Enter');
    await wait(surface, `d.querySelector('[data-testid="setup-details"]').open`);
    const contents = await guest<string>(surface, `return d.querySelector('[data-testid="setup-details"]').innerText`);
    check(`${id}-details-retain-standing-facts`, [words.configured,words.unknown,words.observation,words.privilege,words.lifecycle,words.reach].every(fact => contents.includes(fact)));
    const tree = await c.send('Page.getFrameTree');
    const frameId = tree.frameTree.childFrames.find((f: any) => f.frame.url.includes(`/ui/${surface}/`)).frame.id;
    const ax = await c.send('Accessibility.getFullAXTree', { frameId });
    check(`${id}-accessible-details`, ax.nodes.some((n: any) => n.role?.value === 'DisclosureTriangle' && n.name?.value === words.details && n.properties?.some((p: any) => p.name === 'expanded' && p.value.value === true)));
    check(`${id}-expanded-no-overflow`, await guest(surface, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth'));
    if (locale === 'en') {
      const height = Math.max(844, 20 + await guest<number>(surface, `return Math.ceil(d.querySelector('[data-testid="surface-panel-setup"]').getBoundingClientRect().bottom+w.scrollY)`));
      await viewport(size, height);
      await guest(surface, `w.frameElement.style.height='${height}px';w.scrollTo(0,0);return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
      await shot(`${name}-details-fixed`, height);
    }
    await key('Enter');
    await wait(surface, `!d.querySelector('[data-testid="setup-details"]').open`);
    check(`${id}-opening-is-read-only`, await evaluate(`qa.requests.slice(${opening}).some(q=>q.surface===${js(surface)} && q.method==='GET' && q.path==='/v1/setup') &&
      qa.requests.slice(${opening}).filter(q=>q.surface===${js(surface)}).every(q=>q.method==='GET')`));
  }
  check('setup-refusal-server-observed-no-mutations', fixture.requests.length > 0 && fixture.requests.every(q => q.method === 'GET' && ['/health', '/v1/setup'].includes(q.path)), fixture.requests);
  // Older host: explicit disabled language choices, no storage fallback.
  const unsupportedUrl = await evaluate<string>(`qa.mode='empty';qa.ready('panel',{features:{deviceStorage:false}});qa.reload('panel');frame('panel').src`);
  await wait('panel', `w.location.href===${js(unsupportedUrl)} && !!d.querySelector('[data-testid="empty-state"]') && !!d.querySelector(${js(settings)})`);
  await evaluate(`qa.show('panel',390);true`);
  await click('panel', settings); await click('panel', '[data-menu-id="language"]');
  check('unsupported-language', await guest('panel', `return [...d.querySelectorAll('[role="menuitemradio"]')].every(n=>n.disabled)`));
  check('no-guest-errors', browser.page.errors.length === 0, browser.page.errors);
  }
  if (!linkedOnly) {
  // Map order uses the real service fixture; no R/N/M behaviour is substituted here.
  maps = await startPhoneShell({ source: process.argv.includes('--source') });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${maps.port}/` });
  for (const surface of ['panel', 'page']) for (const size of [390, 1280]) {
    await viewport(size);
    await evaluate(`qa.show(${js(surface)},${size},844);true`);
    await wait(surface, `!!d.querySelector('[data-testid="map-world"]')`);
    check(`${surface}-${size}-map-order`, await guest(surface, `const h=d.querySelector('[data-testid="surface-header"]'),m=d.querySelector('[data-testid="map-region"]'),n=d.querySelector('[data-testid="needs-you-inbox"]');return !!h && !!m && !!(h.compareDocumentPosition(m)&4) && (!n || !!(${surface === 'page' ? 'n.compareDocumentPosition(m)' : 'm.compareDocumentPosition(n)'}&4))`));
    await guest(surface, 'w.scrollTo(0,0);return true'); await shot(`${surface}-${size}-map`);
  }
  // Settled automatic Map choices survive a resize; only a new narrow reading defaults to List.
  for (const surface of ['panel', 'page']) {
    await viewport(280);
    await evaluate(`qa.show(${js(surface)},280,844);qa.ready(${js(surface)});true`);
    await guest(surface, 'return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))');
    check(`${surface}-settled-map-survives-resize`, await guest(surface, `return !!d.querySelector('[data-testid="map-world"]') && d.querySelector('[data-testid="plan-view-map"] button')?.getAttribute('aria-pressed')==='true'`));
    await shot(`${surface}-resized-map`);
  }
  // Both plans are cached Map readings. A panel on B must not pause A's first Map paint.
  await viewport(390);
  await evaluate(`qa.show('panel',390,844);true`);
  await click('panel', '[data-testid="plan-selector"] button');
  await click('panel', '[role="option"][id$="/P-second"]');
  await wait('panel', `!!d.querySelector('[data-testid="map-world"]') && d.querySelector('[data-testid="plan-title"]')?.textContent.includes('Второй план')`);
  await click('panel', '[data-testid="plan-view-document"] button');
  await wait('panel', `!!d.querySelector('[data-testid="document-view"]')`);
  await click('panel', '[data-testid="plan-selector"] button');
  await click('panel', '[role="option"][id$="/P-phone"]');
  await wait('panel', `d.querySelector('[data-testid="plan-title"]')?.textContent.includes('Phone layout') && d.querySelector('[data-testid="plan-view-map"] button')?.getAttribute('aria-pressed')==='true'`);
  const switched = await guest('panel', `return {world:!!d.querySelector('[data-testid="map-world"]'),list:!!d.querySelector('.ap-tasks[data-complete]'),panel:!!d.querySelector('[data-testid="document-view"]'),map:d.querySelector('[data-testid="map-region"]')?.dataset.state??null}`);
  check('rail-cached-map-first-paint', switched.map !== null && !switched.list && !switched.panel, switched);
  await wait('panel', `!!d.querySelector('[data-testid="map-world"]') && d.querySelector('[data-testid="map-region"]')?.dataset.state==='ready'`);
  check('rail-cached-map-after-another-plan-panel', await guest('panel', `return !d.querySelector('.ap-tasks[data-complete]') && !d.querySelector('[data-testid="document-view"]')`));
  await shot('panel-cached-map-after-panel');
  for (const surface of ['panel', 'page']) {
    await viewport(390);
    await evaluate(`qa.show(${js(surface)},390,844);true`);
    if (await guest(surface, `return d.querySelector('[data-testid="needs-you-toggle"]')?.getAttribute('aria-expanded')==='false'`)) await click(surface, '[data-testid="needs-you-toggle"]');
    if (!await guest(surface, `return !!d.querySelector('.ap-inbox-open')`)) await click(surface, '[data-testid="needs-you-other-plans"] button');
    await click(surface, '.ap-inbox-open');
    await wait(surface, `!!d.querySelector('.ap-inbox-facts:not([hidden])') && !d.querySelector('[data-testid="needs-you-reading"]')`);
    check(`${surface}-inbox-one-menu`, await guest(surface, `return d.querySelectorAll('[data-testid="more-trigger"]').length===1`));
    await viewport(280);
    await evaluate(`qa.show(${js(surface)},280,844);frame(${js(surface)}).src='/ui/${surface}/index.html?narrow=1';true`);
    await wait(surface, `w.location.search==='?narrow=1' && !!d.querySelector('.ap-tasks[data-complete]') && d.querySelector('[data-testid="plan-view-list"] button')?.getAttribute('aria-pressed')==='true'`);
    check(`${surface}-narrow-list-default`, true);
    await click(surface, '[data-testid="plan-view-map"] button');
    await wait(surface, `!!d.querySelector('[data-testid="map-world"]')`);
    check(`${surface}-narrow-map-selectable`, true);
  }
  // The source-wide inbox is not owned by a selected browse/search plan.
  await viewport(390);
  await evaluate(`qa.show('page',390,844);true`);
  const submitSearch = async (text: string) => {
    await click('page', '#ap-search-q');
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await c.send('Input.insertText', { text }); await key('Enter');
  };
  await submitSearch('fixture-no-matching-result');
  await wait('page', `!!d.querySelector('[data-testid="search-empty"]') && !!d.querySelector('[data-testid="search-pick"]')`);
  check('board-empty-search-keeps-inbox', await guest('page', `return d.querySelector('[data-testid="needs-you-toggle"]')?.closest('.ap-board-bar') && !d.querySelector('[data-testid="plan-detail"] [data-testid="needs-you-inbox"]')`));
  await shot('page-empty-search-inbox');
  if (await guest('page', `return d.querySelector('[data-testid="needs-you-toggle"]').getAttribute('aria-expanded')==='false'`)) await click('page', '[data-testid="needs-you-toggle"]');
  await wait('page', `!!d.querySelector('.ap-inbox-open') && !!d.querySelector('[data-testid="search-pick"]')`);
  await click('page', '.ap-inbox-open');
  await wait('page', `!!d.querySelector('.ap-inbox-facts:not([hidden])') && !!d.querySelector('[data-testid="search-pick"]')`);
  await submitSearch('phone');
  await wait('page', `!!d.querySelector('[data-testid^="search-plan-"][data-testid$="/P-phone"]')`);
  await click('page', '[data-testid^="search-plan-"][data-testid$="/P-phone"]');
  await wait('page', `!!d.querySelector('[data-testid="surface-header"]') && !d.querySelector('[data-testid="search-pick"]')`);
  check('board-search-omits-browse-picker', await guest('page', `return !d.querySelector('[data-testid="plan-selector"]')`));
  await shot('page-search-plan-no-picker');
  await click('page', '[data-testid="search-clear"] button');
  await wait('page', `!d.querySelector('[data-testid="search-results"]')`);
  await click('page', '[data-testid="board-filters-trigger"]');
  await click('page', '[data-testid="cleanup-archived"] button');
  await wait('page', `!!d.querySelector('[data-testid="empty-state"]')`);
  check('board-empty-archived-keeps-inbox', await guest('page', `return d.querySelector('[data-testid="needs-you-toggle"]')?.closest('.ap-board-bar') && !d.querySelector('[data-testid="plan-detail"] [data-testid="needs-you-inbox"]')`));
  await shot('page-empty-archived-inbox');
  digest = await startDigestShell(false, true);
  await viewport(1280);
  await c.send('Page.navigate', { url: `http://127.0.0.1:${digest.port}/` });
  await evaluate(`(async()=>{while(!window.qa)await new Promise(requestAnimationFrame);qa.show(['page'],1280);for(const s of document.querySelectorAll('section[data-frame]')){s.style.margin='0';s.querySelector('h1').hidden=true;s.querySelector('iframe').style.height='844px'}return true})()`);
  await wait('page', `!!d.querySelector('[data-testid="plan-row-P-digest"]')`);
  const hub = '[data-testid="needs-you-toggle"]';
  const checkCount = (text: string) => `d.querySelector('[data-testid="needs-you-count"]')?.textContent===${js(text)}`;
  await wait('page', checkCount('2'));
  check('board-first-use-inbox-closed', await guest('page', `return d.querySelector(${js(hub)}).getAttribute('aria-expanded')==='false'`));
  await click('page', '#ap-search-q');
  await key('Tab');
  check('library-tab-from-search-to-quiet', await guest('page', `return d.activeElement?.dataset.testid==='quiet-plan-filter'`));
  await key('Tab');
  check('library-tab-from-quiet-to-filters', await guest('page', `return d.activeElement?.dataset.testid==='board-filters-trigger'`));
  await key('Enter');
  await wait('page', `!d.querySelector('[data-testid="board-filters"]').hidden`);
  await click('page', '[data-testid="filter-project"] button');
  await wait('page', `Array.from(d.querySelectorAll('[role="option"]')).some(n=>n.id.includes('/fixture/Alpha')&&n.getClientRects().length>0)`);
  const opts = await guest<{ id: string; label: string }[]>('page', `return [...d.querySelectorAll('[role="option"]')].filter(n=>n.getClientRects().length>0).map(n=>({id:n.id,label:n.textContent}))`);
  const alpha = opts.find(n => n.id.includes('/fixture/Alpha'));
  check('board-filters-location-option', !!alpha, opts);
  await click('page', `[id=${js(alpha!.id)}]`);
  await wait('page', `!d.querySelector('[data-testid="plan-row-P-layout-away"]')`);
  await click('page', '[data-testid="board-filters-close"] button');
  await click('page', '[data-testid="plan-row-P-layout-home"]');
  await click('page', hub);
  await wait('page', `d.querySelector('[data-testid="needs-you-scope-all"] button')?.getAttribute('aria-pressed')==='true'`);
  check('board-global-count-and-list-ignore-location', await guest('page', `return ${checkCount('2')} && d.querySelectorAll('[data-testid="needs-you-row"]').length===2`));
  const pageId = (await c.send('Page.getFrameTree')).frameTree.childFrames.find((f: any) => f.frame.url.includes('/ui/page/')).frame.id;
  const hubNames = (await c.send('Accessibility.getFullAXTree', { frameId: pageId })).nodes.filter((n: any) => n.role?.value === 'button').map((n: any) => n.name?.value);
  check('board-inbox-trigger-names-count', hubNames.some((name: string) => /\bNeeds you\b.*2/.test(name)), hubNames.filter((name: string) => /Needs you/.test(name)));
  await click('page', '[data-testid="needs-you-scope-current"] button');
  await wait('page', `d.querySelectorAll('[data-testid="needs-you-row"]').length===1`);
  check('board-this-plan-filters-list-only', await guest('page', `return ${checkCount('2')} && d.querySelector('[data-testid="needs-you-row"]').dataset.plan==='P-layout-home'`));
  const hide = async () => {
    await click('page', '.ap-inbox-open');
    await click('page', '[data-testid="needs-you-hide"] button');
  };
  await hide(); await wait('page', checkCount('1'));
  await click('page', '[data-testid="needs-you-undo-hide"] button'); await wait('page', checkCount('2'));
  // Use a labelled fixture coverage gap; counts must still derive from actual recorded rows.
  await evaluate(`qa.partialInbox=true;frame('page').contentWindow.dispatchEvent(new Event('focus'));true`);
  await wait('page', checkCount('2+'));
  check('board-partial-count-positive', true);
  await hide(); await wait('page', checkCount('1+'));
  await click('page', '[data-testid="needs-you-scope-all"] button');
  await hide();
  await wait('page', `!d.querySelector('[data-testid="needs-you-count"]') && !!d.querySelector('[data-testid="needs-you-hidden-count"] button')`);
  await click('page', '[data-testid="needs-you-hidden-count"] button');
  check('board-all-hidden-recovery-no-incomplete-zero', await guest('page', `return !d.querySelector('[data-testid="needs-you-count"]') && d.querySelectorAll('[data-testid="needs-you-unhide"] button').length===2`));
  await click('page', '[data-testid="needs-you-unhide"] button'); await wait('page', checkCount('1+'));
  await click('page', hub);
  await click('page', '[data-testid="search-clear"] button');
  await wait('page', `d.querySelectorAll('[data-testid="board-project"]').length>1`);
  await click('page', '[data-testid="selection-mode"] button');
  await wait('page', `!!d.querySelector('button[data-testid^="plan-row-"]')`);
  await click('page', '[data-testid="tidy-open"] button');
  await wait('page', `!!d.querySelector('[data-testid="tidy-confirm"]')&&d.activeElement?.closest('[data-testid="tidy-cancel"]')`);
  const tidy = await guest<{ singleLibraryOpener: boolean; count: string }>('page', `return {singleLibraryOpener:d.querySelectorAll('[data-testid="tidy-open"]').length===1&&!d.querySelector('[data-testid="tidy-open"]').closest('[data-testid="board-project"]'),count:d.querySelector('#tidy-heading').textContent}`);
  check('tidy-one-library-opener-with-two-projects', tidy.singleLibraryOpener && tidy.count.includes(`${digest.layoutClosedCount()} closed plans`), tidy);
  await key('Escape');
  await wait('page', `d.activeElement?.closest('[data-testid="tidy-open"]')&&!d.querySelector('[data-testid="tidy-confirm"]')`);
  check('tidy-cancel-read-only', await evaluate(`qa.requests.every(q=>q.method==='GET')`));
  await click('page', '[data-testid="selection-mode"] button');
  const historyButton = '[data-testid="plan-view-history"] button';
  const refresh = '[data-testid="digest-refresh"] button,button[data-testid="digest-refresh"]';
  await evaluate(`qa.holds.push({frame:'page',path:'/v1/plan',plan:'P-digest',tag:'layout-detail'})`);
  await click('page', '[data-testid="plan-row-P-digest"]');
  await wait('page', `qa.held.some(h=>h.tag==='layout-detail') && !!d.querySelector(${js(historyButton)})`);
  await click('page', '[data-testid="plan-view-document"] button');
  await wait('page', `d.activeElement?.dataset.testid==='document-heading'`);
  await key('Escape'); await key('Tab'); await key('Enter');
  await wait('page', `!!d.querySelector(${js(refresh)})&&d.querySelector(${js(historyButton)}).getAttribute('aria-pressed')==='true'`);
  const point = () => guest<{ top: number; x: number; y: number }>('page', `const n=d.querySelector(${js(refresh)}),r=n.getBoundingClientRect();return {top:r.top,x:r.x+r.width/2,y:r.y+r.height/2}`);
  const before = await point();
  await shot('page-history-held-detail');
  await evaluate(`qa.release('layout-detail')`);
  await wait('page', `d.querySelector('[data-testid="progress-legend"]')?.textContent.includes('not started')`);
  const after = await point();
  check('refresh-stays-put-on-held-detail-release', Math.abs(before.top - after.top) <= 1 && await guest('page', `return d.querySelector(${js(refresh)}).contains(d.elementFromPoint(${before.x},${before.y}))`), { before, after });
  await shot('page-history-released-detail');
  const countDigest = () => evaluate<number>(`qa.requests.filter(q=>q.frame==='page'&&q.path==='/v1/change-digest').length`);
  const beforeClick = await countDigest();
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: before.x, y: before.y, button: 'left', clickCount: 1 });
  await wait('page', `qa.requests.filter(q=>q.frame==='page'&&q.path==='/v1/change-digest').length>${beforeClick}`);
  await wait('page', `!!d.querySelector('[data-testid="history-P-digest"] [data-testid^="revision-"]')`);
  await viewport(390);
  await evaluate(`qa.show(['panel'],390)`);
  await wait('panel', `!!d.querySelector('[data-testid="plan-selector"] button')`);
  await click('panel', '[data-testid="plan-selector"] button');
  await click('panel', '[role="option"][id$="/P-digest"]');
  await click('panel', '[data-testid="plan-view-document"] button');
  await wait('panel', `d.activeElement?.dataset.testid==='document-heading'`);
  await key('Escape'); await key('Tab'); await key('Enter');
  await wait('panel', `!!d.querySelector('[data-testid="history-P-digest"] [data-testid^="revision-"]')`);
  check('rail-history-selected-revisions-no-digest-or-checkpoint', await evaluate(`qa.requests.some(q=>q.frame==='panel'&&q.path==='/v1/history'&&q.query.plan==='P-digest')&&!qa.requests.some(q=>q.frame==='panel'&&q.path==='/v1/change-digest')&&!qa.storageLog.some(q=>q.frame==='panel'&&(q.op==='keys'||q.key?.startsWith('rv1.'))) && !qa.storageLog.some(q=>q.op==='set'&&q.key?.startsWith('rv1.'))`));
  await shot('panel-390-history-revisions');
  }
  check('no-final-guest-errors', browser.page.errors.length === 0, browser.page.errors);
} catch (error) { failure = String(error); }
finally {
  await browser?.stop(); await fixture?.stop(); await maps?.stop(); await digest?.stop();
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ pass: !failure, failure, results, screenshots, limits: 'Synthetic host and emulated phone only; no native host or physical phone tested.' }, null, 2));
}
if (failure) { console.error(failure); process.exitCode = 1; }
