import type { designRefactorQa } from './design-refactor-qa.ts';
import { boardInput } from './board-qa.ts';

type Driver = Parameters<typeof designRefactorQa>[0];
const row = (id: string) => `[data-testid="plan-row-${id}"][data-source="source-design"]`;
const hit = '[data-testid="search-plan-source-design/P-calm"]';
const visible = (s: string) => `(()=>{const n=d.querySelector('${s}');return !!n&&!n.closest('[hidden]')&&n.getClientRects().length>0})()`;

/** Board-specific contracts use the same production guest and twelve recorded plans
 * on both sides of the capture. Extra failed/archive cases run after quiet captures.
 */
export async function designBoardQa(q: Driver) {
  const { evaluate, guest, wait, show, click, key, check, shot } = q;
  const after = q.label === 'after';
  const input = boardInput(q);
  const screenshots: object[] = [];
  const density: object[] = [];
  const reload = async () => {
    const seq = await evaluate<number>(`qa.reload('page')`);
    await wait('page', `qa.loaded.page===${seq}&&d.querySelector('[data-testid="plan-list-heading"]')`, 'fresh board reading');
  };
  const capture = async (name: string, selector: string, state: string, width: number) => {
    await evaluate(`(()=>{const f=frame('page');f.style.height=Math.max(1500,Math.ceil(f.contentDocument.documentElement.scrollHeight))+'px';return true})()`);
    await shot(name, selector, 0, 5000, 'page');
    screenshots.push({ file: `${name}.png`, fixture: 'F12/F8', surface: 'page', width, theme: 'light', state });
  };
  await q.theme('light');
  await show(['page'], 1100); await reload();
  await click('page', row('P-calm'));
  await wait('page', `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`, 'quiet F12 with selected F8 automatic Map');
  for (const width of [1100, 360]) {
    await show(['page'], width);
    const metrics = await guest('page', `const roots=${after ? "[d.querySelector('.ap-board-bar')]" : "[d.querySelector('[data-testid=cleanup-modes]'),d.querySelector('[data-testid=search]'),d.querySelector('[data-testid=filters]')]"};const nodes=[...new Set(roots.flatMap(r=>r?[...r.querySelectorAll('button,input,select,summary,[tabindex="0"]')]:[]))].filter(n=>!n.closest('[hidden]')&&n.getClientRects().length);return {controls:nodes.length,overflow:d.documentElement.scrollWidth>w.innerWidth+1}`);
    density.push({ surface: 'board-header', fixture: 'F12', width, theme: 'light', ...metrics });
    check(`board:${width}:quiet-no-horizontal-overflow`, !metrics.overflow);
    if (after) {
      check(`board:${width}:four-quiet-controls`, metrics.controls === 4);
      check(`board:${width}:three-current-two-finished`, await guest('page', `const shown=s=>[...d.querySelectorAll(s)].filter(n=>!n.closest('[hidden]')&&n.getClientRects().length);return shown('[data-testid^="plan-row-"]').length===3&&shown('[data-testid="board-finished-toggle"]').length===2&&shown('[data-testid="board-finished"] [role="option"]').length===0`));
    }
    await capture(`F12-page-${width}-quiet-map`, '[data-testid="progress-root"]', 'twelve plans, untouched Map default, Finished closed', width);
  }
  if (after) {
    await show(['page'], 1100);
    await guest('page', `d.querySelector('[data-testid="plan-list-heading"]').focus();return true`);
    const order: string[] = [];
    for (let n = 0; n < 4; n++) { await key('Tab'); order.push(await guest('page', `return d.activeElement?.getAttribute('role')==='listbox'?'listbox':d.activeElement?.dataset.testid??''`)); }
    check('board:F12:closed-fold-tab-order', JSON.stringify(order) === JSON.stringify(['listbox', 'board-finished-toggle', 'listbox', 'board-finished-toggle']));
    const projects = await guest<string[]>('page', `return [...d.querySelectorAll('[data-testid="board-finished-toggle"]')].map(n=>n.dataset.project)`);
    for (const project of projects) await click('page', `[data-testid="board-finished-toggle"][data-project=${JSON.stringify(project)}]`);
    check('board:F12:all-nine-closed-rows-reachable', await guest('page', `const rows=[...d.querySelectorAll('[data-testid="board-finished"] [role="option"]')];return rows.length===9&&rows.every(n=>!n.closest('[hidden]')&&['completed','cancelled'].includes(n.dataset.lifecycle))&&rows.filter(n=>n.dataset.lifecycle==='cancelled').length===1`));
    await capture('F12-page-1100-finished-open', '[data-testid="plan-list"]', 'both Finished disclosures open; cancelled lifecycle retained', 1100);
    await input.openFilters();
    for (const width of [1100, 360, 275]) {
      await show(['page'], width);
      check(`board:filters:${width}:no-overflow`, await guest('page', `return d.documentElement.scrollWidth<=w.innerWidth+1`));
      check(`board:filters:${width}:help-and-scope-reachable`, await guest('page', `return [...d.querySelectorAll('[data-testid="search-help"],[data-testid="search-scope"],[data-testid="search-submit"]')].length===3&&[...d.querySelectorAll('[data-testid="search-help"],[data-testid="search-scope"],[data-testid="search-submit"]')].every(n=>!n.closest('[hidden]')&&n.getClientRects().length)`));
      await capture(`F12-page-${width}-filters-open`, '[data-testid="progress-root"]', 'Filters open with help, scope and explicit Search', width);
    }
    await input.closeFilters();
  }
  for (const width of [1100, 360]) {
    await show(['page'], width);
    await click('page', row('P-calm-no-edges'));
    await wait('page', `d.querySelector('[data-testid="plan-P-calm-no-edges"] .ap-tasks[data-complete]')`, 'new no-edge reading opens Progress');
    check(`d8:board:${width}:no-edge-progress`, await guest('page', `return d.querySelector('[data-testid="detail-tabs"] [data-id="progress"]')?.getAttribute('aria-selected')==='true'&&!d.querySelector('[data-testid="map-region"]')`));
    await capture(`F8N-page-${width}-initial-progress`, '[data-testid="progress-root"]', 'no-edge plan opens Progress; narrow tabs retained', width);
  }
  if (!after) return { density, screenshots };
  await show(['page'], 1100);
  await click('page', '#ap-search-q');
  await q.c.send('Input.insertText', { text: 'release' }); await key('Enter');
  await wait('page', `d.querySelectorAll('[data-testid="search-results"] .ap-hit-plan').length===12&&!d.querySelector('[data-testid="search-loading"]')`, 'search includes all twelve plans');
  check('board:F12:search-bypasses-finished-folds', await guest('page', `return d.querySelectorAll('[data-testid="search-results"] .ap-hit-plan').length===12&&!d.querySelector('[data-testid="board-finished"]')`));
  await click('page', hit);
  await wait('page', `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`, 'plan hit resolves new reading to automatic Map');
  check('d8:board:plan-hit-map', await guest('page', `return Number(d.querySelector('[data-testid="map-region"]').dataset.edges)>0`));
  await click('page', '[data-testid="search-task-source-design/P-calm/D1"]');
  await wait('page', `d.activeElement?.dataset.testid==='item-D1'&&d.querySelector('.ap-tasks[data-complete]')`, 'task hit explicitly opens Progress and reveals once');
  check('d8:board:task-hit-progress', await guest('page', `return !d.querySelector('[data-testid="map-region"]')&&d.querySelector('[data-testid="detail-tabs"] [data-id="progress"]')?.getAttribute('aria-selected')==='true'`));
  await capture('F12-page-1100-search-task-progress', '[data-testid="progress-root"]', 'mixed search, task hit explicitly revealed in Progress', 1100);
  await click('page', '#ap-search-q');
  const mark = await evaluate<number>('qa.replies.length');
  await wait('page', `parent.qa.replies.slice(${mark}).some(r=>r.frame==='page'&&r.path==='/v1/search-state')`, 'freshness poll after reveal');
  check('d8:board:task-reveal-consumed-once', await guest('page', `return d.activeElement?.id==='ap-search-q'&&!d.querySelector('[data-testid="map-region"]')`));
  await click('page', '[data-testid="search-clear"] button');
  await wait('page', `d.querySelector('[data-testid="plan-list-heading"]')`, 'ordinary browsing restored');
  if (!q.seedDesignFailed || !q.cleanupElsewhere) throw Error('Board boundary fixture seams required');
  q.seedDesignFailed();
  await wait('page', visible(row('P-release-failed')), 'failed plan remains outside Finished');
  check('board:failed-stays-prominent', await guest('page', `const n=d.querySelector('${row('P-release-failed')}');return n.dataset.lifecycle==='failed'&&!n.closest('[data-testid="board-finished"]')`));
  await q.cleanupElsewhere('archive', 'P-calm');
  await click('page', '[data-testid="cleanup-archived"] button');
  await wait('page', visible(row('P-calm')), 'archived edge-bearing plan listed directly');
  await click('page', row('P-calm'));
  await wait('page', `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`, 'archived complete edge-bearing plan defaults to Map');
  check('d8:board:archived-map-no-fold', await guest('page', `return !d.querySelector('[data-testid="board-finished-toggle"]')&&d.querySelector('[data-testid="detail-tabs"] [data-id="map"]')?.getAttribute('aria-selected')==='true'`));
  await capture('F8-page-1100-archived-map', '[data-testid="progress-root"]', 'archived finished plan retains recorded edges and automatic Map', 1100);
  return { density, screenshots };
}
