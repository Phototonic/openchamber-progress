// Real Chromium actions through the existing CDP harness; launch cleanup-fixture.ts
// with --source for source guests. --selection-only and --individual-only isolate
// the search/bulk and per-plan journeys; default exercises both.
import { javascriptLiteral } from '../../shared/javascript-literal.ts';
import type nodeAssert from 'node:assert/strict';
import { countedAssertions } from './counted-assert.ts';
const assertions = countedAssertions();
const assert: typeof nodeAssert = assertions.assert;
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const port = process.argv[2];
if (!port) throw new Error('usage: cleanup-qa.ts <isolated CDP port>');
const artifacts = process.argv.includes('--artifacts') ? process.argv[process.argv.indexOf('--artifacts') + 1] : 'evidence/cleanup';
if (!artifacts) throw Error('--artifacts requires a directory');
mkdirSync(artifacts, { recursive: true });
process.on('uncaughtExceptionMonitor', () => writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ passed: false, failure: 'Driver assertion or browser command failed; inspect private runner output.' }, null, 2) + '\n'));
const cdp = (...args: string[]) => execFileSync(process.execPath, ['tests/browser/cdp.ts', port, ...args], { encoding: 'utf8', timeout: 20_000 });
const evaluate = (code: string) => JSON.parse(cdp('eval', code));
const guest = (surface: string, code: string) => evaluate(`(()=>{const d=document.querySelector('iframe[data-surface="${surface}"]').contentDocument;${code}})()`);
const wait = (surface: string, condition: string) => assert.equal(evaluate(`(async()=>{const end=Date.now()+12000;while(Date.now()<end){const d=document.querySelector('iframe[data-surface="${surface}"]').contentDocument;if(${condition})return true;await new Promise(r=>setTimeout(r,40));}return false})()`), true, `${surface}: ${condition}`);
const key = (name: string, count = 1) => cdp('key', name, String(count));
function show(surface: string, width = 900) {
  cdp('viewport', width < 500 ? `${width + 32}x850` : '1200x850');
  evaluate(`qa.show('${surface}');document.querySelector('section[data-surface="${surface}"]').style.width='${width}px';true`);
  wait(surface, `d.defaultView.innerWidth===${width}`);
}
function click(surface: string, selector: string) {
  const point = evaluate(`(async()=>{const f=document.querySelector('iframe[data-surface="${surface}"]'),d=f.contentDocument,s=${javascriptLiteral(selector)};d.querySelector(s)?.scrollIntoView({block:'nearest'});f.scrollIntoView({block:'nearest'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const n=d.querySelector(s);if(!n)throw Error('Missing control: '+s);const a=n.getBoundingClientRect(),o=f.getBoundingClientRect(),x=a.x+Math.min(a.width/2,30),y=a.y+a.height/2;if(!n.contains(d.elementFromPoint(x,y)))throw Error('Control is not reachable: '+s);return [x+o.x,y+o.y]})()`);
  cdp('click', ...point.map(String));
}
function button(surface: string, id: string) {
  if (surface === 'page' && ['filter-project', 'filter-worktree', 'filter-session', 'cleanup-visible', 'cleanup-archived'].includes(id)) {
    if (!guest('page', `return !!d.querySelector('[data-testid="${id}"] button')?.getClientRects().length`)) {
      click('page', '[data-testid="board-filters-trigger"]');
      wait('page', `d.querySelector('[data-testid="${id}"] button')?.getClientRects().length>0`);
    }
  }
  if (['cleanup-archive', 'cleanup-restore', 'cleanup-delete'].includes(id)) {
    click(surface, `[data-testid="${id}"] button`);
    if (id === 'cleanup-delete') {
      wait(surface, `d.querySelector('[data-testid="cleanup-confirm"]')`);
      assert.equal(guest(surface, `return !!d.querySelector('[data-testid="cleanup-confirm"]')?.closest('[role="menu"]')`), false);
    }
  } else click(surface, `[data-testid="${id}"] button`);
}
function selected(surface: string, id: string) { wait(surface, `d.querySelector('${surface === 'page' ? '[data-testid="plan-detail"] ' : ''}[data-testid="plan-${id}"][data-source="source-fixture"]')`); }
function choosePage(id: string) {
  revealPagePlan(id);
  click('page', `[data-testid="plan-row-${id}"][data-source="source-fixture"]`); selected('page', id);
}
function revealPagePlan(id: string) {
  const selector = `[data-testid="plan-row-${id}"][data-source="source-fixture"]`;
  const visible = `!!d.querySelector(${javascriptLiteral(selector)})?.getClientRects().length`;
  wait('page', `${visible} || d.querySelector('[data-testid="board-finished-toggle"]')`);
  if (guest('page', `return ${visible}`)) return;
  const projects = guest('page', `return [...d.querySelectorAll('[data-testid="board-finished-toggle"][aria-expanded="false"]')].map(n=>n.dataset.project)`);
  for (const project of projects) {
    const toggle = `[data-testid="board-finished-toggle"][data-project=${JSON.stringify(project)}]`;
    click('page', toggle);
    wait('page', `d.querySelector(${javascriptLiteral(toggle)})?.getAttribute('aria-expanded')==='true'`);
    if (guest('page', `return ${visible}`)) return;
  }
  wait('page', visible);
}
function choosePicker(surface: string, id: string) {
  const picker = `[data-testid="${surface === 'status' ? 'status-plan-selector' : 'plan-selector'}"] button`;
  wait(surface, `d.querySelector('${picker}')`);
  guest(surface, `const b=d.querySelector('${picker}');d.defaultView.focus();b.scrollIntoView({block:'nearest'});b.focus();return new Promise(r=>d.defaultView.requestAnimationFrame(()=>d.defaultView.requestAnimationFrame(()=>r(true))));`);
  key('Enter');
  wait(surface, `d.querySelector('[role="listbox"]')`);
  const index = guest(surface, `return [...d.querySelectorAll('.oc-sdk-popup [role="option"]')].findIndex(n=>n.id.endsWith('-source-fixture/${id}'));`);
  assert.ok(index >= 0); key('Home'); if (index) key('ArrowDown', index); key('Enter'); selected(surface, id);
}
const posts = () => evaluate(`qa.requests.filter(q=>q.method==='POST').length`);
// CDP subprocesses block this runner's event loop between fetches; do not reuse an
// idle socket whose close event cannot be processed during those synchronous calls.
const fixture = (path: string, method = 'GET') => fetch(`http://127.0.0.1:47851${path}`, { method, headers: { connection: 'close' } });
const state = async (plan = 'P-done', store = 0) => (await fixture(`/state?plan=${plan}&store=${store}`)).json();
function shot(name: string, surface: string, selector?: string) {
  if (selector) guest(surface, `d.querySelector(${javascriptLiteral(selector)})?.scrollIntoView({block:'center'});return true;`);
  const rect = evaluate(`(()=>{const r=document.querySelector('section[data-surface="${surface}"]').getBoundingClientRect();return [Math.max(0,r.x-8),Math.max(0,r.y-8),r.width+16,Math.min(r.height+16,innerHeight-r.y)]})()`);
  cdp('shot', join(artifacts, `cleanup-${name}.png`), ...rect.map(String));
}
function noOverflow(surface: string) { assert.equal(guest(surface, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth;'), true); }
function tabBack(surface: string) {
  if (guest(surface, `return !!d.querySelector('[data-testid="surface-panel-back"]')`)) {
    button(surface, 'surface-panel-back');
    wait(surface, `!d.querySelector('[data-testid="surface-panel-back"]')`);
  }
}
function tab(surface: string, text: string) {
  tabBack(surface);
  button(surface, `plan-view-${text}`);
}

// Each explicit run starts fresh disposable stores, not a retry of a destructive action.
evaluate(`for(const f of document.querySelectorAll('iframe'))f.contentWindow.dispatchEvent(new Event('pagehide'));true`);
assert.equal((await fixture('/reset', 'POST')).ok, true);
evaluate('location.reload();true');
revealPagePlan('P-done');
assert.deepEqual(JSON.parse(cdp('console', '1')).entries, []);
const selectionOnly = process.argv.includes('--selection-only');
const individualOnly = process.argv.includes('--individual-only');
if (selectionOnly && individualOnly) throw Error('Choose at most one cleanup journey');
if (!selectionOnly) await individualCleanup();
if (!individualOnly) await searchSelection();
assert.deepEqual(evaluate('qa.errors'), []);
assert.deepEqual(JSON.parse(cdp('console', '1')).entries, []);
const result = { passed: true, realService: true, individualCleanup: !selectionOnly, crossPageSelection: !individualOnly, mixedResultAndReceiptOnlyUndo: !individualOnly, posts: posts(), assertions: assertions.count() };
writeFileSync(join(artifacts, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

async function individualCleanup() {
const before = await state(); const secondBefore = await state('P-done', 1);
for (const id of ['P-active']) {
  choosePage(id);
  assert.equal(guest('page', `return !!d.querySelector('[data-testid="cleanup-archive"],[data-testid="cleanup-delete"]');`), false);
}
evaluate('qa.dark();true');
for (const id of ['P-cancelled', 'P-failed']) {
  for (const width of [900, 390]) {
    if (width === 900) { show('page', width); choosePage(id); }
    else { show('page', width); selected('page', id); }
    wait('page', `d.querySelector('[data-testid="cleanup-archive"] button:not(:disabled)')`);
    assert.equal(guest('page', `return !!d.querySelector('[data-testid="cleanup-delete"] button:not(:disabled)')`), true);
    noOverflow('page'); shot(`${id}-${width}-dark-actions`, 'page');
    button('page', 'cleanup-delete');
    wait('page', `d.activeElement?.closest('[data-testid="cleanup-cancel"]')`);
    noOverflow('page'); shot(`${id}-${width}-dark-confirm`, 'page', '[data-testid="cleanup-confirm"]');
    button('page', 'cleanup-cancel');
  }
  show('page');
  button('page', 'cleanup-archive');
  wait('page', `!d.querySelector('[data-testid="plan-row-${id}"]')`);
  button('page', 'cleanup-archived');
  wait('page', `d.querySelector('[data-testid="cleanup-archived"] button')?.getAttribute('aria-pressed')==='true'`);
  choosePage(id);
  button('page', 'cleanup-restore');
  wait('page', `!d.querySelector('[data-testid="plan-row-${id}"]')`);
  const restoredPlan = await state(id);
  assert.equal(restoredPlan.cleanup.state, 'visible');
  assert.equal(restoredPlan.lifecycle, id === 'P-cancelled' ? 'cancelled' : 'failed');
  button('page', 'cleanup-visible');
}
// Session-local manual choice survives a temporary no-session state. Directory
// context alone must not display plans or create a second featured-choice scope.
show('status', 280); choosePicker('status', 'P-done');
evaluate(`qa.context(null);true`); wait('status', `d.querySelector('[data-testid="unscoped-state"]')&&!d.querySelector('[data-testid="status-plan-selector"]')`);
evaluate(`qa.context('M');true`); selected('status', 'P-done');
show('panel', 360); choosePicker('panel', 'P-done');
show('page'); choosePage('P-done');
const originalPosts = posts();
button('page', 'cleanup-delete');
wait('page', `d.querySelector('[data-testid="cleanup-confirm"]') && d.activeElement?.closest('[data-testid="cleanup-cancel"]')`);
key('Enter'); // Cancel is the initial/default keyboard action.
wait('page', `!d.querySelector('[data-testid="cleanup-confirm"]') && d.activeElement?.closest('[data-testid="cleanup-delete"]')`);
assert.equal(posts(), originalPosts); assert.deepEqual(await state(), before);

// Archive against real built service. Other open surfaces converge on normal polls.
button('page', 'cleanup-archive');
wait('page', `d.querySelector('[data-testid="cleanup-notice"]') && !d.querySelector('[data-testid="plan-row-P-done"][data-source="source-fixture"]')`);
wait('panel', `!d.querySelector('[data-testid="plan-P-done"][data-source="source-fixture"]')`);
wait('status', `!d.querySelector('[data-testid="plan-P-done"][data-source="source-fixture"]')`);
const archived = await state(); assert.equal(archived.cleanup.state, 'archived');
assert.deepEqual(archived.counts, before.counts); assert.deepEqual(archived.history, before.history); assert.equal(archived.document, before.document); assert.equal(archived.sourceUnchanged, true);
evaluate(`qa.context(null);true`);
wait('status', `d.querySelector('[data-testid="unscoped-state"]') && !d.querySelector('[data-testid="plan-P-done"][data-source="source-fixture"]')`);
evaluate(`qa.context('M');true`);
button('page', 'cleanup-archived');
wait('page', `d.querySelector('[data-testid="plan-row-P-done"][data-source="source-fixture"]')`);
choosePage('P-done');
wait('page', `d.querySelector('[data-testid="cleanup-restore"] button:not(:disabled)')`);
assert.equal(guest('page', `return !!d.querySelector('[data-testid="cleanup-delete"] button:not(:disabled)')`),true);
selected('page', 'P-done'); tab('page', 'document'); wait('page', `d.querySelector('[data-testid="document-text"]')?.textContent.includes('Recorded finish')`);
tab('page', 'history'); wait('page', `d.querySelector('[data-testid="revision-2"]')`);
shot('archived', 'page', '[data-testid="plan-detail"]');
tabBack('page');
button('page', 'cleanup-restore'); wait('page', `d.querySelector('[data-testid="empty-state"]')?.textContent.includes('No archived plans')`);
const restored = await state(); assert.equal(restored.cleanup.state, 'visible'); assert.equal(restored.lifecycle, 'finished');
assert.deepEqual(restored.history, before.history); assert.equal(restored.document, before.document);
button('page', 'cleanup-visible'); choosePage('P-done');
shot('restored', 'page', '[data-testid="plan-detail"]');

// Context/store rebinding invalidates open confirmations. Neither sends a mutation.
let count = posts(); button('page', 'cleanup-delete');
evaluate(`qa.context('U');true`); wait('page', `!d.querySelector('[data-testid="cleanup-confirm"]')`); assert.equal(posts(), count);
evaluate(`qa.context('M');true`); choosePage('P-done'); button('page', 'cleanup-delete');
evaluate('qa.store=1;true'); wait('page', `!d.querySelector('[data-testid="cleanup-confirm"]')`); assert.equal(posts(), count);
assert.deepEqual(await state('P-done', 1), secondBefore);
// Observe a new real list response for the requested store, not internal
// diagnostics that no longer appear in the ordinary reading.
const store0 = evaluate(`qa.requests.find(q=>q.method==='POST').body.storeId`);
function switchStore(store: number) {
  const start = evaluate('qa.responses.length');
  evaluate(`qa.store=${store};true`);
  wait('page', `qa.responses.slice(${start}).some(r=>r.surface==='page'&&r.path==='/v1/plans'&&r.storeId&&((r.storeId===${javascriptLiteral(store0)})===${store === 0})) && d.querySelector('[data-testid="plan-list-heading"]')`);
}
switchStore(0);
choosePage('P-other');

// Genuine 409 from another real writer, with one deliberately delayed pre-change list.
evaluate(`qa.hold={surface:'page',path:'/v1/plans'};true`);
wait('page', `qa.held.length>0`);
assert.equal((await fixture('/conflict', 'POST')).ok, true);
button('page', 'cleanup-archive'); wait('page', `d.querySelector('[data-testid="cleanup-error"]')`);
assert.equal(evaluate(`qa.responses.some(r=>r.surface==='page'&&r.status===409)`), true);
evaluate('qa.release();true'); revealPagePlan('P-other');
choosePage('P-other'); show('page', 360); noOverflow('page');
shot('error', 'page', '[data-testid="cleanup-error"]');
show('page');

// Explicit SDK/HTTP boundary fault seams, not backend busy/network claims.
for (const mode of ['busy', 'network']) {
  evaluate(`qa.fail='${mode}';true`); count = posts(); button('page', 'cleanup-archive');
  wait('page', `d.querySelector('[data-testid="cleanup-error"]')`);
  revealPagePlan('P-other');
  assert.equal(posts(), count + 1); assert.equal((await state('P-other')).cleanup.state, 'visible');
  assert.equal(evaluate(`qa.requests.filter(q=>q.method==='POST').at(-1).body.cleanupRev`), 2, 'late pre-conflict list cannot restore an old generation');
  choosePage('P-other');
}

// Failed archive lookup is an error, not an authoritative empty archive.
evaluate('qa.failRead=true;true'); button('page', 'cleanup-archived');
wait('page', `d.querySelector('[data-testid="state-busy"]') && !d.querySelector('[data-testid="empty-state"]')`);
button('page', 'cleanup-visible'); choosePage('P-other');

// Older service: capability stripped only; no archive query or action is offered.
evaluate('qa.old=true;true');
click('page', '[data-testid="board-filters-trigger"]');
wait('page', `d.querySelector('[data-testid="cleanup-archived"] button')?.disabled===true`);
assert.equal(guest('page', `return d.querySelector('[data-testid="cleanup-archived"] button').disabled`), true);
assert.equal(guest('page', `return !!d.querySelector('[data-testid="cleanup-archive"],[data-testid="cleanup-delete"]')`), false);
evaluate('qa.old=false;true'); wait('page', `d.querySelector('[data-testid="cleanup-archived"] button')?.disabled===false`);

// Capture narrow light + dark confirmation; retained picker remains usable in rail.
show('panel', 360); choosePicker('panel', 'P-done'); button('panel', 'cleanup-delete');
wait('panel', `d.activeElement?.closest('[data-testid="cleanup-cancel"]')`); noOverflow('panel');
shot('delete-confirm', 'panel', '[data-testid="cleanup-confirm"]');
key('Escape'); wait('panel', `!d.querySelector('[data-testid="cleanup-confirm"]')`);
evaluate('qa.dark();true'); button('panel', 'cleanup-delete');
wait('panel', `d.querySelector('[data-testid="cleanup-confirm"]')`); shot('delete-confirm-dark', 'panel', '[data-testid="cleanup-confirm"]');
button('panel', 'cleanup-cancel');

// Cold part caches, then hold old detail, document and history replies. Delete from
// another surface and release only after the page's fresh list has removed the key.
show('page'); switchStore(1);
revealPagePlan('P-done');
switchStore(0);
evaluate(`qa.hold={surface:'page',paths:['/v1/plan','/v1/document','/v1/history']};true`);
choosePage('P-done'); wait('page', `qa.held.length>=1`);
tab('page', 'document'); wait('page', `qa.held.length>=2`);
tab('page', 'history'); wait('page', `qa.held.length>=3`);
show('panel', 360); choosePicker('panel', 'P-done'); button('panel', 'cleanup-delete');
count = posts();
evaluate(`qa.hold={surface:'panel',path:'/v1/plan/delete'};true`);
button('panel', 'cleanup-confirm-delete');
wait('panel', `d.querySelector('[data-testid="cleanup-confirm-delete"] button')?.disabled`);
// The ordinary list poll can already have retired the disabled confirmation:
// the service applied the delete even while its reply is held.
const duplicate = guest('panel', `const b=d.querySelector('[data-testid="cleanup-confirm-delete"] button');if(!b)return null;const r=b.getBoundingClientRect(),o=d.defaultView.frameElement.getBoundingClientRect();return [r.x+r.width/2+o.x,r.y+r.height/2+o.y]`) as [number, number] | null;
if (duplicate) cdp('click', ...duplicate.map(String));
assert.equal(posts(), count + 1);
wait('page', `!d.querySelector('[data-testid="plan-row-P-done"][data-source="source-fixture"]')`);
evaluate('qa.release();true');
wait('panel', `d.querySelector('[data-testid="cleanup-notice"]') && !d.querySelector('[data-testid="plan-P-done"][data-source="source-fixture"]')`);
wait('page', `!d.querySelector('[data-testid="plan-P-done"][data-source="source-fixture"]')`);
const deleted = await state(); assert.equal(deleted.exists, false); assert.ok(Object.values(deleted.counts).every(n=>n===0));
assert.equal(deleted.sourceUnchanged && deleted.otherSourceExists && deleted.activeExists && deleted.otherExists, true);
assert.deepEqual(await state('P-done', 1), secondBefore);

// Finished-only session becomes empty after Archive, but Archived plans is discoverable.
show('page'); button('page', 'cleanup-visible');
button('page', 'filter-session'); wait('page', `d.querySelector('[role="listbox"]')`);
const fi = guest('page', `return [...d.querySelectorAll('.oc-sdk-popup [role="option"]')].findIndex(n=>n.textContent.includes('Session F'));`);
assert.ok(fi >= 0); key('Home'); key('ArrowDown', fi); key('Enter');
wait('page', `d.querySelector('[data-testid="filter-session"] button')?.textContent.includes('Session F') && !d.querySelector('.oc-sdk-popup [role="listbox"]')`);
button('page', 'board-filters-close');
choosePage('P-only'); button('page', 'cleanup-archive');
wait('page', `!d.querySelector('[data-testid="plan-row-P-only"]') && d.querySelector('[data-testid="cleanup-archived"]')`);
button('page', 'cleanup-archived'); wait('page', `d.querySelector('[data-testid="plan-row-P-only"]')`);
show('page', 360); noOverflow('page'); shot('archived-narrow', 'page', '[data-testid="plan-detail"]');
}

async function searchSelection() {
// Explicit search picks span presentation pages. A real external archive of an
// off-page pick must retire only that pick, not the rest of the selection.
show('page'); button('page', 'cleanup-visible');
wait('page', `d.querySelector('#ap-search-q')`);
click('page', '#ap-search-q'); cdp('type', 'P-page-'); key('Enter');
wait('page', `d.querySelector('[data-testid="search-more"] button')`);
button('page', 'selection-mode');
const hit = (plan: string) => `[data-testid="search-plan-source-fixture/${plan}"]`;
const displayedPicks = (): string[] => guest('page', `return [...d.querySelectorAll('button[data-testid^="search-plan-source-fixture/P-page-"][aria-pressed="false"]')].map(n=>n.dataset.plan)`);
const expectCount = (n: number) => wait('page', `d.querySelector('[data-testid="selection-count"]')?.textContent==='${n} selected'`);
const [departed, confirmed, refused] = displayedPicks();
assert.ok(departed && confirmed && refused);
for (const plan of [departed, confirmed, refused]) click('page', hit(plan));
expectCount(3);
button('page', 'search-more');
wait('page', `d.querySelector('[data-testid="search-prev"] button') && !d.querySelector('[data-testid="search-loading"]')`);
const [lost] = displayedPicks();
assert.ok(lost && ![departed, confirmed, refused].includes(lost));
click('page', hit(lost)); expectCount(4);
assert.equal((await fixture(`/archive-elsewhere?plan=${departed}`, 'POST')).ok, true);
button('page', 'search-prev');
expectCount(3);
wait('page', `!d.querySelector(${javascriptLiteral(hit(departed))}) && d.querySelector(${javascriptLiteral(hit(confirmed))})?.getAttribute('aria-pressed')==='true'`);
button('page', 'search-next');
wait('page', `d.querySelector(${javascriptLiteral(hit(lost))})?.getAttribute('aria-pressed')==='true'`);

// One real refusal after confirmation, one real mutation whose reply is lost,
// and one receipt. The live result line must distinguish all three outcomes.
button('page', 'selection-archive');
wait('page', `d.querySelector('[data-testid="tidy-confirm-archive"] button') && d.querySelector('#tidy-heading')?.textContent.includes('3 selected plans')`);
assert.equal((await fixture(`/archive-elsewhere?plan=${refused}`, 'POST')).ok, true);
evaluate(`qa.loseArchiveReply=${javascriptLiteral(lost)};true`);
const archivePosts = () => evaluate(`qa.requests.filter(q=>q.path==='/v1/plan/archive' && q.method==='POST').map(q=>q.body.plan)`) as string[];
const archiveStart = archivePosts().length;
guest('page', `const result=d.querySelector('[data-testid="tidy-result"]');d.defaultView.parent.qa.selectionResults=[];new MutationObserver(()=>d.defaultView.parent.qa.selectionResults.push(result.textContent)).observe(result,{childList:true,characterData:true,subtree:true});return true`);
button('page', 'tidy-confirm-archive');
try {
  wait('page', `d.querySelector('[data-testid="tidy-result"]')?.textContent.includes('plans archived')`);
} catch (error) {
  console.error({ announcements: evaluate('qa.selectionResults'), requested: archivePosts().slice(archiveStart), statuses: evaluate(`qa.responses.filter(r=>r.path==='/v1/plan/archive').slice(-3).map(r=>r.status)`), stillConfirming: guest('page', `return !!d.querySelector('[data-testid="tidy-confirm-archive"]')`) });
  throw error;
}
assert.equal(guest('page', `return d.querySelector('[data-testid="tidy-result"]')?.textContent`), '1 of 3 plans archived; 1 skipped; 1 could not be confirmed and may have been archived.');
assert.deepEqual(archivePosts().slice(archiveStart).sort(), [confirmed, refused, lost].sort());
shot('selection-mixed-result', 'page', '[data-testid="tidy-result"]');
button('page', 'tidy-undo');
wait('page', `d.querySelector('[data-testid="tidy-result"]')?.textContent.includes('restored')`);
assert.equal((await state(confirmed)).cleanup.state, 'visible');
for (const plan of [departed, refused, lost]) assert.equal((await state(plan)).cleanup.state, 'archived');
}
