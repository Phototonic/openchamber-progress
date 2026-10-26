// CP-Q1 rendered regression. Run against tests/browser/status-picker-fixture.ts
// in an isolated Chromium profile; all input goes through the existing CDP harness.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = process.argv[2];
if (!port) throw new Error('usage: status-picker-qa.ts <isolated CDP port>');
mkdirSync('evidence/cleanup', { recursive: true });
const cdp = (...args: string[]) => execFileSync(process.execPath, ['tests/browser/cdp.ts', port, ...args], { encoding: 'utf8', timeout: 15_000 });
const evaluate = (code: string) => JSON.parse(cdp('eval', code));
const guest = (code: string) => evaluate(`(()=>{const d=document.querySelector('iframe').contentDocument;${code}})()`);
const wait = (condition: string) => assert.equal(evaluate(`(async()=>{const end=Date.now()+8000;while(Date.now()<end){const d=document.querySelector('iframe').contentDocument;if(${condition})return true;await new Promise(r=>setTimeout(r,50));}return false})()`), true, condition);
const trigger = '[data-testid="status-plan-selector"] .oc-sdk-trigger';
const title = 'Fourth plan — vérifier 日本語 · a long selected title remains readable in the menu';
const key = (name: string, count = 1) => cdp('key', name, String(count));
const snapshot = () => guest(`return {title:d.querySelector('.ap-status-title')?.textContent,value:d.querySelector('.oc-sdk-trigger-value')?.textContent,focus:d.activeElement?.className,expanded:d.querySelector('${trigger}')?.getAttribute('aria-expanded')};`);
function open() {
  // Fresh bounds every time: this fixture's iframe is same-origin, not an OOP target.
  const point = evaluate(`(()=>{const f=document.querySelector('iframe'),n=f.contentDocument.querySelector('${trigger}'),r=n.getBoundingClientRect(),o=f.getBoundingClientRect();return [r.x+r.width/2+o.x,r.y+r.height/2+o.y]})()`);
  cdp('click', ...point.map(String));
  wait(`d.querySelector('[role="listbox"]') && d.activeElement?.getAttribute('role')==='listbox'`);
}
function choose(index: number, expected: string) {
  open(); key('Home'); if (index) key('ArrowDown', index); key('Enter');
  wait(`d.querySelector('.ap-status-title')?.textContent===${JSON.stringify(expected)} && !d.querySelector('[role="listbox"]')`);
  assert.match(snapshot().focus, /oc-sdk-trigger/);
  const counts = guest(`return {...d.querySelector('.ap-status-plan [data-testid="counts"]').dataset};`);
  assert.equal(counts.done, expected === 'Finished plan' ? '3' : '1');
  assert.equal(counts.total, '3');
}
function measure(width: number) {
  const result = guest(`const wrap=d.querySelector('[data-testid="status-plan-selector"]'),label=wrap.querySelector('.oc-sdk-field-label'),button=wrap.querySelector('button');const l=label.getBoundingClientRect(),b=button.getBoundingClientRect(),r=wrap.getBoundingClientRect();return {width:d.documentElement.clientWidth,scroll:d.documentElement.scrollWidth,labelRight:l.right,buttonLeft:b.left,rowCenterDelta:Math.abs((l.top+l.height/2)-(b.top+b.height/2)),rightDelta:Math.abs(r.right-b.right),height:b.height,buttonWidth:b.width,name:d.getElementById(button.getAttribute('aria-labelledby'))?.textContent,title:button.title};`);
  assert.equal(result.width, width);
  assert.ok(result.scroll <= width, 'no horizontal overflow');
  assert.ok(result.labelRight < result.buttonLeft, 'label and control do not overlap');
  assert.ok(result.rowCenterDelta < 1 && result.rightDelta < 1, 'one row, right aligned');
  assert.ok(result.height >= 24 && result.height < 28, 'compact usable target');
  assert.equal(result.name, 'Featured plan');
  return result;
}
function popupFit() {
  const result = guest(`const p=d.querySelector('.oc-sdk-popup'),r=p.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:d.documentElement.clientWidth,height:d.documentElement.clientHeight,overflow:p.scrollWidth>p.clientWidth};`);
  assert.ok(result.left >= 0 && result.right <= result.width && result.bottom <= result.height, 'popup fits guest');
  assert.equal(result.overflow, false);
}
function shot(name: string, width: number) {
  const height = evaluate(`Math.ceil(document.querySelector('iframe').getBoundingClientRect().height)+64`);
  cdp('shot', `evidence/cleanup/status-picker-${name}.png`, '0', '0', String(width + 32), String(height));
}

wait(`d.querySelector('${trigger}')`);
const initialConsole = JSON.parse(cdp('console', '1'));
assert.deepEqual(initialConsole.entries, []);
// M and U use the prior fixture's session-a/session-b IDs. All five M plans share
// one directory here; scope semantics are unchanged. Fifth plan is explicitly finished.
evaluate(`qa.expanded=true;for(const p of data.extras){p.sessionId='session-a';p.directory=data.projects[0].directory;}data.extras[1].title=${JSON.stringify(title)};qa.report();true`);
wait(`d.querySelector('[data-testid="more-plans"]')?.textContent.includes('2 more')`);

const measurements = [];
for (const width of [280, 360, 480]) {
  cdp('viewport', width === 480 ? '1000x700' : `${width + 32}x760`);
  evaluate(`document.querySelector('section').style.cssText='width:${width}px;margin:16px';true`);
  wait(`d.documentElement.clientWidth===${width}`);
  choose(0, 'Execution plan');
  measurements.push({ state: 'automatic', ...measure(width) });
  // Full-list fourth plan (Automatic occupies index zero).
  choose(4, title);
  assert.equal(measure(width).title, title);
  const before = evaluate('qa.listReads');
  evaluate('qa.report();true');
  wait(`qa.listReads>${before} && d.querySelector('.ap-status-title')?.textContent===${JSON.stringify(title)}`);
  assert.ok(evaluate(`qa.detailRequests.includes('extra-1')`));
  measurements.push({ state: 'long-title', ...measure(width) });
  // Keyboard-only open and Escape restore visible trigger focus without a selection.
  key('ArrowDown'); wait(`d.querySelector('[role="listbox"]')`); popupFit();
  const fullOption = guest(`return [...d.querySelectorAll('[role="option"]')].some(n=>n.textContent.includes(${JSON.stringify(title)}));`);
  assert.equal(fullOption, true);
  if (width === 280) shot('open', width);
  key('Escape'); wait(`!d.querySelector('[role="listbox"]') && d.activeElement?.matches('${trigger}')`);
  const focus = guest(`return {visible:d.activeElement.matches(':focus-visible'),outline:getComputedStyle(d.activeElement).outlineStyle};`);
  assert.equal(focus.visible, true); assert.equal(focus.outline, 'solid');
  if (width === 360) shot('light', width);
  choose(5, 'Finished plan');
  assert.equal(guest(`return d.querySelector('.ap-status-plan')?.textContent.includes('Finished');`), true);
  const finishedReads = evaluate('qa.listReads');
  evaluate('qa.report();true');
  wait(`qa.listReads>${finishedReads} && d.querySelector('.ap-status-title')?.textContent==='Finished plan'`);
}

// Context-local choice restoration and single-plan/unscoped absence of a picker.
evaluate(`qa.context('session-b');true`);
wait(`d.querySelector('.ap-status-title')?.textContent==='Other session plan' && !d.querySelector('${trigger}')`);
evaluate(`qa.context('session-a');true`);
wait(`d.querySelector('.ap-status-title')?.textContent==='Finished plan'`);
evaluate('qa.context(null);true');
wait(`d.querySelector('.ap-status-title')?.textContent==='Execution plan'`);
choose(4, title);
evaluate(`qa.context('session-a');true`);
wait(`d.querySelector('.ap-status-title')?.textContent==='Finished plan'`);
evaluate('qa.context(null);true');
wait(`d.querySelector('.ap-status-title')?.textContent===${JSON.stringify(title)}`);
evaluate(`send({type:'directory',payload:{directory:null}});true`);
wait(`d.querySelector('[data-testid="unscoped-state"]') && !d.querySelector('${trigger}')`);
evaluate(`send({type:'directory',payload:{directory:data.projects[0].directory}});true`);
wait(`d.querySelector('.ap-status-title')?.textContent===${JSON.stringify(title)}`);

// Same guest/theme bridge, neutral dark tokens. Ready restores M (with its own choice).
evaluate(`theme.mode='dark';Object.assign(theme.tokens,{background:'#191b20',elevated:'#24272e',foreground:'#e6e8ee',muted:'#a4a9b4',subtle:'#9298a4',border:'#414650',hover:'#343944',selection:'#293d60',focus:'#90b8ff',primary:'#83aff7',mutedSurface:'#24272e',elevatedForeground:'#e6e8ee',active:'#3b4350',selectionForeground:'#e0ebff',primaryText:'#a6c7ff',successText:'#86dca3',warningText:'#e8c372',errorText:'#ff9e9e',infoText:'#a6c7ff',success:'#6fc58c',warning:'#d9b367',error:'#ee8989',info:'#83aff7'});document.documentElement.style.background=theme.tokens.background;document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;ready();true`);
wait(`d.documentElement.dataset.ocTheme==='dark' && d.querySelector('${trigger}')`);
cdp('viewport', '392x760');
evaluate(`document.querySelector('section').style.cssText='width:360px;margin:16px';true`);
wait(`d.documentElement.clientWidth===360`);
choose(4, title); key('ArrowDown'); popupFit(); shot('dark-open', 360); key('Escape');
wait(`!d.querySelector('[role="listbox"]')`);
measure(360); shot('dark', 360);
const finalConsole = JSON.parse(cdp('console', '1'));
assert.deepEqual(finalConsole.entries, []);
console.log(JSON.stringify({ passed: true, measurements, contexts: 'M/U/directory/unscoped', console: { initial: initialConsole.entries, final: finalConsole.entries }, selected: snapshot() }, null, 2));
