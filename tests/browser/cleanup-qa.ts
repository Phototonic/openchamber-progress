// Real Chromium actions through the existing CDP harness; requires cleanup-fixture.ts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const port = process.argv[2];
if (!port) throw new Error('usage: cleanup-qa.ts <isolated CDP port>');
mkdirSync('evidence/cleanup', { recursive: true });
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
  const point = evaluate(`(()=>{const f=document.querySelector('iframe[data-surface="${surface}"]'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing control');n.scrollIntoView({block:'center'});f.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect(),o=f.getBoundingClientRect();return [r.x+Math.min(r.width/2,30)+o.x,r.y+r.height/2+o.y]})()`);
  cdp('click', ...point.map(String));
}
const button = (surface: string, id: string) => click(surface, `[data-testid="${id}"] button`);
function selected(surface: string, id: string) { wait(surface, `d.querySelector('${surface === 'page' ? '[data-testid="plan-detail"] ' : ''}[data-testid="plan-${id}"][data-source="source-fixture"]')`); }
function choosePage(id: string) {
  click('page', `[data-testid="plan-row-${id}"][data-source="source-fixture"]`); selected('page', id);
}
function choosePicker(surface: string, id: string) {
  button(surface, surface === 'status' ? 'status-plan-selector' : 'plan-selector');
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
  if (selector) guest(surface, `d.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'});return true;`);
  const rect = evaluate(`(()=>{const r=document.querySelector('section[data-surface="${surface}"]').getBoundingClientRect();return [Math.max(0,r.x-8),Math.max(0,r.y-8),r.width+16,Math.min(r.height+16,innerHeight-r.y)]})()`);
  cdp('shot', `evidence/cleanup/cleanup-${name}.png`, ...rect.map(String));
}
function noOverflow(surface: string) { assert.equal(guest(surface, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth;'), true); }
function tab(surface: string, text: string) {
  const index = guest(surface, `return [...d.querySelectorAll('[data-testid="detail-tabs"] [role="tab"]')].findIndex(n=>n.textContent===${JSON.stringify(text)});`);
  assert.ok(index >= 0); click(surface, `[data-testid="detail-tabs"] [role="tab"]:nth-child(${index + 1})`);
}

// Each explicit run starts fresh disposable stores, not a retry of a destructive action.
evaluate(`for(const f of document.querySelectorAll('iframe'))f.contentWindow.dispatchEvent(new Event('pagehide'));true`);
assert.equal((await fixture('/reset', 'POST')).ok, true);
evaluate('location.reload();true');
wait('page', `d.querySelector('[data-testid="plan-row-P-done"]')`);
assert.deepEqual(JSON.parse(cdp('console', '1')).entries, []);
const before = await state(); const secondBefore = await state('P-done', 1);
for (const id of ['P-active', 'P-cancelled', 'P-failed']) {
  choosePage(id); assert.equal(guest('page', `return !!d.querySelector('[data-testid="cleanup-archive"],[data-testid="cleanup-delete"]');`), false);
}
// Remember the same manual key in status session and directory scopes.
show('status', 280); choosePicker('status', 'P-done');
evaluate(`qa.context(null);true`); wait('status', `d.querySelector('[data-testid="status-plan-selector"]')`); choosePicker('status', 'P-done');
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
wait('status', `d.querySelector('.ap-status-title') && !d.querySelector('[data-testid="plan-P-done"][data-source="source-fixture"]')`);
evaluate(`qa.context('M');true`);
button('page', 'cleanup-archived');
wait('page', `d.querySelector('[data-testid="cleanup-restore"]')`);
selected('page', 'P-done'); tab('page', 'Document'); wait('page', `d.querySelector('[data-testid="document-text"]')?.textContent.includes('Recorded finish')`);
tab('page', 'History'); wait('page', `d.querySelector('[data-testid="revision-2"]')`);
shot('archived', 'page', '[data-testid="plan-detail"]');
button('page', 'cleanup-restore'); wait('page', `d.querySelector('[data-testid="empty-state"]')?.textContent.includes('No archived plans')`);
const restored = await state(); assert.equal(restored.cleanup.state, 'visible'); assert.equal(restored.lifecycle, 'finished');
assert.deepEqual(restored.history, before.history); assert.equal(restored.document, before.document);
button('page', 'cleanup-visible'); wait('page', `d.querySelector('[data-testid="plan-row-P-done"][data-source="source-fixture"]')`); choosePage('P-done');
shot('restored', 'page', '[data-testid="plan-detail"]');

// Context/store rebinding invalidates open confirmations. Neither sends a mutation.
let count = posts(); button('page', 'cleanup-delete');
evaluate(`qa.context('U');true`); wait('page', `!d.querySelector('[data-testid="cleanup-confirm"]')`); assert.equal(posts(), count);
evaluate(`qa.context('M');true`); choosePage('P-done'); button('page', 'cleanup-delete');
evaluate('qa.store=1;true'); wait('page', `!d.querySelector('[data-testid="cleanup-confirm"]')`); assert.equal(posts(), count);
assert.deepEqual(await state('P-done', 1), secondBefore);
evaluate('qa.store=0;true'); wait('page', `qa.responses.filter(r=>r.surface==='page'&&r.path==='/v1/plans').length>2 && !d.querySelector('[data-testid="cleanup-confirm"]')`);
// Wait on actual returned store identity via the diagnostics, not a timer.
const store0 = evaluate(`qa.requests.find(q=>q.method==='POST').body.storeId`);
wait('page', `d.body.textContent.includes(${JSON.stringify(store0)})`);
choosePage('P-other');

// Genuine 409 from another real writer, with one deliberately delayed pre-change list.
evaluate(`qa.hold={surface:'page',path:'/v1/plans'};true`);
wait('page', `qa.held.length>0`);
assert.equal((await fixture('/conflict', 'POST')).ok, true);
button('page', 'cleanup-archive'); wait('page', `d.querySelector('[data-testid="cleanup-error"]')`);
assert.equal(evaluate(`qa.responses.some(r=>r.surface==='page'&&r.status===409)`), true);
evaluate('qa.release();true'); wait('page', `d.querySelector('[data-testid="plan-row-P-other"]')`);
choosePage('P-other'); show('page', 360); noOverflow('page');
shot('error', 'page', '[data-testid="cleanup-error"]');

// Explicit SDK/HTTP boundary fault seams, not backend busy/network claims.
for (const mode of ['busy', 'network']) {
  evaluate(`qa.fail='${mode}';true`); count = posts(); button('page', 'cleanup-archive');
  wait('page', `d.querySelector('[data-testid="cleanup-error"]')`);
  wait('page', `d.querySelector('[data-testid="plan-row-P-other"]')`);
  assert.equal(posts(), count + 1); assert.equal((await state('P-other')).cleanup.state, 'visible');
  assert.equal(evaluate(`qa.requests.filter(q=>q.method==='POST').at(-1).body.cleanupRev`), 2, 'late pre-conflict list cannot restore an old generation');
  choosePage('P-other');
}

// Failed archive lookup is an error, not an authoritative empty archive.
evaluate('qa.failRead=true;true'); button('page', 'cleanup-archived');
wait('page', `d.querySelector('[data-testid="state-busy"]') && !d.querySelector('[data-testid="empty-state"]')`);
button('page', 'cleanup-visible'); wait('page', `d.querySelector('[data-testid="plan-row-P-other"]')`); choosePage('P-other');

// Older service: capability stripped only; no archive query or action is offered.
evaluate('qa.old=true;true'); wait('page', `d.querySelector('[data-testid="cleanup-unavailable"]')`);
assert.equal(guest('page', `return d.querySelector('[data-testid="cleanup-archived"] button').disabled`), true);
assert.equal(guest('page', `return !!d.querySelector('[data-testid="cleanup-archive"],[data-testid="cleanup-delete"]')`), false);
evaluate('qa.old=false;true'); wait('page', `!d.querySelector('[data-testid="cleanup-unavailable"]')`);

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
show('page'); evaluate('qa.store=1;true');
wait('page', `!d.body.textContent.includes(${JSON.stringify(store0)}) && d.querySelector('[data-testid="plan-row-P-done"]')`);
evaluate('qa.store=0;true'); wait('page', `d.body.textContent.includes(${JSON.stringify(store0)})`);
evaluate(`qa.hold={surface:'page',paths:['/v1/plan','/v1/document','/v1/history']};true`);
choosePage('P-done'); wait('page', `qa.held.length>=1`);
tab('page', 'Document'); wait('page', `qa.held.length>=2`);
tab('page', 'History'); wait('page', `qa.held.length>=3`);
show('panel', 360); choosePicker('panel', 'P-done'); button('panel', 'cleanup-delete');
count = posts();
evaluate(`qa.hold={surface:'panel',path:'/v1/plan/delete'};true`);
button('panel', 'cleanup-confirm-delete');
wait('panel', `d.querySelector('[data-testid="cleanup-confirm-delete"] button')?.disabled`);
button('panel', 'cleanup-confirm-delete'); // disabled duplicate input sends nothing
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
wait('page', `d.querySelector('[data-testid="plan-row-P-only"]')`); choosePage('P-only'); button('page', 'cleanup-archive');
wait('page', `!d.querySelector('[data-testid="plan-row-P-only"]') && d.querySelector('[data-testid="cleanup-archived"]')`);
button('page', 'cleanup-archived'); wait('page', `d.querySelector('[data-testid="plan-row-P-only"]')`);
show('page', 360); noOverflow('page'); shot('archived-narrow', 'page', '[data-testid="plan-detail"]');

assert.deepEqual(evaluate('qa.errors'), []);
assert.deepEqual(JSON.parse(cdp('console', '1')).entries, []);
console.log(JSON.stringify({ passed: true, realService: true, archiveRestorePreserved: true, deleteSelectedPayloadOnly: true, sourceUnchanged: deleted.sourceUnchanged, secondStoreUnchanged: true, cancelSentNothing: true, duplicateBlocked: true, keyboardFocus: true, contextAndStoreConfirmationInvalidation: true, failureSeams: ['real409', 'synthetic503', 'syntheticNetwork', 'oldCapability', 'heldList', 'heldDetail', 'heldDocument', 'heldHistory', 'heldDeleteReply'], posts: posts() }, null, 2));
