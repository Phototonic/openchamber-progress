import type { designRefactorQa } from './design-refactor-qa.ts';
import { boardInput, BOARD_FILTERS_TRIGGER } from './board-qa.ts';
import { javascriptLiteral } from '../../shared/javascript-literal.ts';

/** Small real-browser regression for repeated project focus and live dropdowns. */
export async function designBoardLifetimeQa(q: Parameters<typeof designRefactorQa>[0]) {
  const { guest, wait, show, click, check, key, setCapture } = q;
  if (!setCapture) throw Error('Board lifetime QA requires the production fixture capture seam');
  await show(['page'], 1100);
  await wait('page', `d.querySelectorAll('[data-testid="board-finished-toggle"]').length===2`, 'two F12 project folds');
  const project = await guest<string>('page', `return d.querySelectorAll('[data-testid="board-finished-toggle"]')[1].dataset.project`);
  const toggle = `[data-testid="board-finished-toggle"][data-project=${JSON.stringify(project)}]`;
  await click('page', toggle);
  await wait('page', `d.activeElement?.dataset.project===${javascriptLiteral(project)}`, 'explicit fold focus');
  setCapture(false);
  await wait('page', `d.querySelector('[data-testid="capture-off"]')`, 'data-changing poll while the second project toggle owns focus');
  check('board:fold-poll-keeps-project-focus', await guest('page', `return d.activeElement?.dataset.testid==='board-finished-toggle'&&d.activeElement.dataset.project===${javascriptLiteral(project)}`));
  setCapture(true);
  await wait('page', `!d.querySelector('[data-testid="capture-off"]')`, 'capture restored');
  const input = boardInput(q);
  await input.openFilters();
  await click('page', '[data-testid="filter-project"] .oc-sdk-trigger');
  await wait('page', `d.querySelector('[data-testid="filter-project"] [role="listbox"]')`, 'project dropdown open');
  await guest('page', `w.__heldSelect=d.querySelector('[data-testid="filter-project"]');w.__heldDropdown=d.activeElement;return true`);
  setCapture(false);
  await wait('page', `d.querySelector('[data-testid="capture-off"]')`, 'capture-off paints without freezing the dropdown');
  check('board:dropdown-poll-stays-open', await guest('page', `return d.querySelector('[data-testid="filter-project"]')===w.__heldSelect&&!!w.__heldSelect.querySelector('[role="listbox"]')&&d.activeElement===w.__heldDropdown`));
  await key('Escape');
  check('board:dropdown-escape-returns-to-own-trigger', await guest('page', `return d.activeElement===d.querySelector('[data-testid="filter-project"] .oc-sdk-trigger')`));
  await input.closeFilters();
  check('board:filters-close-returns-to-trigger', await guest('page', `return d.activeElement===d.querySelector('${BOARD_FILTERS_TRIGGER}')`));
  setCapture(true);
  await wait('page', `!d.querySelector('[data-testid="capture-off"]')`, 'fixture restored');
  await input.openFilters();
  await click('page', '[data-testid="plan-row-P-calm-no-edges"][data-source="source-design"]');
  await wait('page', `d.querySelector('[data-testid="plan-P-calm-no-edges"] .ap-tasks[data-complete]')`, 'outside plan click is delivered while dismissing Filters');
  check('board:outside-dismiss-does-not-swallow-plan-selection', await guest('page', `return d.querySelector('[data-testid="board-filters"]').hidden`));
}
