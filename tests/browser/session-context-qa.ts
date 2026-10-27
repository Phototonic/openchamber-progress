// Current-bundle Chromium QA with deliberately synthetic SDK/service events.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const port = process.argv[2];
if (!port) throw new Error('usage: session-context-qa.ts <isolated CDP port>');
mkdirSync('evidence/session-progress', { recursive: true });
const cdp = (...args: string[]) => execFileSync(process.execPath, ['tests/browser/cdp.ts', port, ...args], { encoding: 'utf8', timeout: 20_000 });
const evaluate = (code: string) => JSON.parse(cdp('eval', code));
const guest = (s: string, code: string) => evaluate(`(()=>{const d=frame('${s}').contentDocument;${code}})()`);
const wait = (s: string, code: string) => assert.equal(evaluate(`(async()=>{const end=Date.now()+12000;while(Date.now()<end){const d=frame('${s}').contentDocument;if(${code})return true;await new Promise(r=>setTimeout(r,40));}return false})()`), true, `${s}: ${code}`);
const key = (value: string, n = 1) => cdp('key', value, String(n));
function click(s: string, selector: string) {
  const point = evaluate(`(()=>{const f=frame('${s}'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing control');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=f.getBoundingClientRect();return [r.x+Math.min(24,r.width/2)+o.x,r.y+r.height/2+o.y]})()`);
  cdp('click', ...point.map(String));
}
const button = (s: string, id: string) => click(s, `[data-testid="${id}"] button`);
function show(s: string, width = 360) { cdp('viewport', width > 500 ? '1200x850' : `${width + 32}x850`); evaluate(`qa.show('${s}',${width});true`); wait(s, `d.defaultView.innerWidth===${width}`); }
function shot(s: string, name: string, height = 350) {
  assert.equal(guest(s, 'return d.documentElement.scrollWidth<=d.documentElement.clientWidth'), true);
  const r = evaluate(`(()=>{const r=document.querySelector('section[data-surface="${s}"]').getBoundingClientRect();return [r.x-8,r.y-8,r.width+16]})()`);
  cdp('shot', `evidence/session-progress/${name}.png`, ...r.map(String), String(height));
}
const context = (id: string | null, directory = '/fixture/Alpha', fullOnly = false) => evaluate(`qa.context(${JSON.stringify(id)},${JSON.stringify(directory)},${fullOnly});true`);
function sideState(testid: string) { for (const s of ['panel', 'status']) wait(s, `d.querySelector('[data-testid="${testid}"]') && !d.querySelector('[data-testid="plan-P-A"]')`); }
function choose(s: string, id: string) {
  button(s, s === 'status' ? 'status-plan-selector' : 'plan-selector'); wait(s, `d.querySelector('[role="listbox"]')`);
  const index = guest(s, `return [...d.querySelectorAll('.oc-sdk-popup [role="option"]')].findIndex(n=>n.id.endsWith('/${id}'));`);
  assert.ok(index >= 0); key('Home'); if (index) key('ArrowDown', index); key('Enter');
  wait(s, `d.querySelector('[data-testid="plan-${id}"]')`);
}
const isPlanRequest = `q.path.startsWith('/v1/plan')||['/v1/document','/v1/history'].includes(q.path)`;

wait('panel', `d.querySelector('[data-testid="unscoped-state"]')`);
assert.deepEqual(JSON.parse(cdp('console', '1')).entries, []);
sideState('unscoped-state');
assert.equal(evaluate(`qa.requests.some(q=>q.surface!=='page'&&(${isPlanRequest}))`), false);
for (const s of ['panel', 'status']) assert.equal(guest(s, `return d.querySelector('[data-testid="progress-root"]').getAttribute('aria-busy')`), 'false');
show('panel'); shot('panel', 'sidebar-draft', 220);
wait('page', `d.querySelector('[data-testid="plan-row-P-A"]')`);

// Full ready alone must switch scope. The later directory/session duplicates do not
// broaden it or reset the board. B's pending list is loading, then authoritatively empty.
evaluate(`qa.hold={surface:'panel',path:'/v1/plans',session:'B'};true`); context('B', '/fixture/Alpha', true);
wait('panel', `qa.held.length && d.querySelector('[data-testid="state-loading"]')`);
evaluate('qa.release();true'); sideState('empty-state');
assert.equal(guest('panel', 'return d.body.textContent.includes("No plan reported for this session")'), true);
evaluate('qa.dark();true'); show('status', 280); shot('status', 'sidebar-empty-dark', 210);
show('panel'); shot('panel', 'sidebar-empty', 220);

// Hold rail preference restoration, then the A detail and document. A → draft → B
// drops their authority and any old confirmation/button references.
evaluate(`qa.holdStorage=true;qa.hold={surface:'panel',paths:['/v1/plan','/v1/document']};true`); context('A');
wait('panel', `d.querySelector('[data-testid="plan-P-A"]') && qa.held.some(x=>x.path==='/v1/plan')`);
click('panel', '[data-testid="document-P-A"] summary');
wait('panel', `qa.held.some(x=>x.path==='/v1/document')`);
context(null); sideState('unscoped-state'); context('B'); sideState('empty-state');
evaluate('qa.release();true'); sideState('empty-state');
assert.equal(evaluate(`qa.requests.some(q=>q.surface!=='page'&&q.context===null&&(${isPlanRequest}))`), false);
context('A'); wait('panel', `d.querySelector('[data-testid="plan-P-A"]')`);

// Open native SDK popup cannot postpone context paint. Keep a detached trigger to
// prove old DOM callbacks cannot select or mutate in B.
show('status', 280); button('status', 'status-plan-selector'); wait('status', `d.querySelector('[role="listbox"]')`);
context(null); sideState('unscoped-state'); wait('status', `!d.querySelector('[role="listbox"]')`);
context('A'); wait('status', `d.querySelector('[data-testid="status-plan-selector"]')`);
choose('status', 'P-second');
// Same-session metadata must not replace the root or dismiss the open SDK popup.
button('status', 'status-plan-selector'); wait('status', `d.querySelector('[role="listbox"]')`);
assert.equal(evaluate(`(async()=>{
  const w=frame('status').contentWindow,d=w.document,root=d.querySelector('[data-testid="progress-root"]'),popup=d.querySelector('[role="listbox"]');
  const applied=new Promise(resolve=>{const receive=e=>{if(e.data.type!=='session'||e.data.payload?.session?.title!=='Metadata update')return;w.removeEventListener('message',receive);w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve));};w.addEventListener('message',receive);});
  send('status',{type:'session',payload:{session:{id:'A',title:'Metadata update',busy:true}}});await applied;
  return root===d.querySelector('[data-testid="progress-root"]')&&popup===d.querySelector('[role="listbox"]')&&d.querySelector('.ap-status-title')?.textContent==='Completed example';
})()`), true);
key('Escape'); wait('status', `!d.querySelector('[role="listbox"]') && d.querySelector('.ap-status-title')?.textContent==='Completed example'`);
context('A', 'C:\\fixture\\Alpha'); wait('status', `d.querySelector('.ap-status-title')?.textContent==='Completed example'`);
assert.equal(evaluate(`qa.requests.filter(q=>q.surface!=='page'&&q.path==='/v1/plans').every(q=>q.query?.session&&!q.query.directory)`), true);

// Rail cleanup confirmation disappears on context switch; its detached button may
// still receive an event but cannot submit. No synthetic cleanup POST is expected.
show('panel'); choose('panel', 'P-second'); button('panel', 'cleanup-delete');
wait('panel', `d.querySelector('[data-testid="cleanup-confirm"]') && d.activeElement?.closest('[data-testid="cleanup-cancel"]')`);
guest('panel', `window.qaOldDelete=d.querySelector('[data-testid="cleanup-confirm-delete"] button');return true;`);
context('B'); sideState('empty-state');
guest('panel', `window.qaOldDelete.click();return true;`);
assert.equal(evaluate(`qa.requests.filter(q=>q.method==='POST').length`), 0);

// Real contributor inclusion is service-owned; this synthetic response proves the
// guest does not owner-filter it. A fork with no membership receives the empty list.
context('C'); wait('panel', `d.querySelector('[data-testid="plan-P-A"]') && d.querySelector('[data-testid="helping-note"]')`);
context('fork'); sideState('empty-state');
evaluate('qa.failB=true;true'); context('B');
wait('panel', `d.querySelector('[data-testid="stale-banner"]') && !d.querySelector('[data-testid="plan-P-A"]')`);
wait('status', `d.querySelector('[data-testid="state-busy"]') && !d.querySelector('[data-testid="empty-state"]')`);
context(null); sideState('unscoped-state');
evaluate('qa.failB=false;true'); context('A'); wait('panel', `d.querySelector('[data-testid="plan-selector"]')`);
show('panel'); choose('panel', 'P-A'); shot('panel', 'sidebar-selected', 620);

// Held A list cannot overwrite a fresh B. Store change with identical IDs still
// resets authority; board archive/session filter stays independent of host selection.
evaluate(`qa.hold={surface:'status',path:'/v1/plans',session:'A'};true`);
wait('status', `qa.held.some(x=>x.path==='/v1/plans')`);
context('B'); sideState('empty-state'); evaluate('qa.release();true'); sideState('empty-state');
show('page', 900); wait('page', `d.querySelector('[data-testid="plan-row-P-A"]')`);
button('page', 'cleanup-archived'); wait('page', `d.querySelector('[data-testid="plan-row-P-finished"]')`);
click('page', '[data-testid="detail-tabs"] [role="tab"]:nth-child(3)'); wait('page', `d.querySelector('[data-testid="revision-1"]')`);
button('page', 'filter-session'); wait('page', `d.querySelector('[role="listbox"]')`); key('Home'); key('ArrowDown'); key('Enter');
wait('page', `d.querySelector('[data-testid="plan-row-P-finished"]')`);
context(null); context('A'); context('B'); wait('page', `d.querySelector('[data-testid="revision-1"]') && d.querySelector('[data-testid="cleanup-restore"]')`);
const query = evaluate(`qa.requests.filter(q=>q.surface==='page'&&q.path==='/v1/plans').at(-1).query`);
assert.equal(query.session, 'A'); assert.equal(query.archived, 'only'); shot('page', 'board-history', 700);
button('page', 'cleanup-delete'); wait('page', `d.querySelector('[data-testid="cleanup-confirm"]')`);
evaluate(`qa.store='store-2';true`); wait('page', `!d.querySelector('[data-testid="cleanup-confirm"]')`);
assert.equal(evaluate(`qa.requests.filter(q=>q.method==='POST').length`), 0);
assert.deepEqual(JSON.parse(cdp('console', '1')).entries, []);
console.log(JSON.stringify({ passed: true, evidenceClass: 'synthetic SDK/service, real Chromium and current guests', noScopeRequests: 0, cleanupPosts: 0, boardIndependent: true, contributorPreserved: true, nativeHostProof: false }, null, 2));
