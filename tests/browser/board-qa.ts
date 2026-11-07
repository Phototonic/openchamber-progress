// Shared real-input reachability for the board's on-demand controls. This does not
// change filter values, select a plan, or invoke guest event handlers directly.
import { javascriptLiteral } from '../../shared/javascript-literal.ts';

export const BOARD_FILTERS_TRIGGER = '[data-testid="board-filters-trigger"]';
export const BOARD_FILTERS = '[data-testid="board-filters"]';
export const BOARD_FILTERS_CLOSE = '[data-testid="board-filters-close"] button';

export function boardInput(q: {
  guest: <T = any>(surface: string, code: string) => Promise<T>;
  wait: (surface: string, condition: string, what?: string) => Promise<unknown>;
  click: (surface: string, selector: string) => Promise<void>;
}) {
  const { guest, wait, click } = q;
  const visible = (selector: string) => `(()=>{const n=d.querySelector(${javascriptLiteral(selector)});return !!n&&!n.closest('[hidden]')&&n.getClientRects().length>0})()`;
  async function openFilters() {
    await wait('page', visible(BOARD_FILTERS_TRIGGER), 'Filters trigger after any scoped-list loading paint');
    if (!await guest<boolean>('page', `return ${visible(BOARD_FILTERS)}`)) {
      await click('page', BOARD_FILTERS_TRIGGER);
      await wait('page', visible(BOARD_FILTERS), 'Filters open through its trigger');
    }
  }
  async function closeFilters() {
    if (await guest<boolean>('page', `return ${visible(BOARD_FILTERS)}`)) {
      await click('page', BOARD_FILTERS_CLOSE);
      await wait('page', `!${visible(BOARD_FILTERS)}`, 'Filters closed through Close');
    }
  }
  /** Opens only the needed project's Finished fold when the row is already in
   * the DOM; otherwise walks the closed project folds until the target appears.
   * Membership/assertions remain the caller's responsibility.
   */
  async function revealPlan(selector: string) {
    await wait('page', `d.querySelector(${javascriptLiteral(selector)})||d.querySelector('[data-testid="board-finished-toggle"]')`, 'plan rows or Finished controls loaded');
    if (await guest<boolean>('page', `return ${visible(selector)}`)) return;
    const projects = await guest<string[]>('page', `const row=d.querySelector(${javascriptLiteral(selector)}),fold=row?.closest('[data-testid="board-finished"]');return fold?[fold.dataset.project]:[...d.querySelectorAll('[data-testid="board-finished-toggle"][aria-expanded="false"]')].map(n=>n.dataset.project)`);
    for (const project of projects) {
      const toggle = `[data-testid="board-finished-toggle"][data-project=${JSON.stringify(project)}]`;
      await click('page', toggle);
      await wait('page', `d.querySelector(${javascriptLiteral(toggle)})?.getAttribute('aria-expanded')==='true'`, 'Finished open through its control');
      if (await guest<boolean>('page', `return ${visible(selector)}`)) return;
    }
    await wait('page', visible(selector), 'target plan reachable after Finished expansion');
  }
  return { openFilters, closeFilters, revealPlan };
}
