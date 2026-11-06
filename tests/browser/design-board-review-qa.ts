import type { designRefactorQa } from './design-refactor-qa.ts';
import { boardInput } from './board-qa.ts';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';

export type BoardReviewCheck = 'menu' | 'finished' | 'cancelled' | 'keyboard-finished' | 'keyboard-cancelled';

/** Real-input reproductions of the two pre-PR findings; no guest controller calls. */
export async function designBoardReviewQa(q: Parameters<typeof designRefactorQa>[0], which: BoardReviewCheck) {
  const { guest, wait, show, click, check, evaluate, shot } = q;
  const input = boardInput(q);
  // At narrow width the detail/actions sit below the open Filters panel, so
  // real pointer input can reach the menu trigger rather than its overlay.
  await show(['page'], which === 'menu' ? 360 : 1100);
  await wait('page', `d.querySelector('[data-testid="cleanup-visible"] button')`, 'board mode control');
  await click('page', '[data-testid="cleanup-visible"] button');
  await wait('page', `d.querySelector('[data-testid="plan-list-heading"]')`, 'ordinary Current board');
  if (which === 'keyboard-finished' || which === 'keyboard-cancelled') {
    await keyboardRegroup(q, which === 'keyboard-finished' ? 'finished' : 'cancelled');
    return;
  }
  if (which === 'menu') {
    // Keep the selected Progress detail below the panel's overlay, just as when
    // browsing an expanded project. The click must actually hit Plan actions.
    await input.revealPlan('[data-testid="plan-row-P-release-closed-1"][data-source="source-design"]');
    await click('page', '[data-testid="plan-row-P-calm-no-edges"][data-source="source-design"]');
    await wait('page', `d.querySelector('[data-testid="plan-P-calm-no-edges"] .ap-tasks[data-complete]')`, 'Progress before Plan actions');
    await input.openFilters();
    await guest('page', `w.__reviewMenuRoot=d.getElementById('root').firstElementChild;return true`);
    await click('page', '[data-testid="plan-actions"] button');
    await guest('page', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    const menuState = await guest('page', `const n=d.querySelector('[data-testid="plan-actions"] button'),r=n.getBoundingClientRect(),hit=d.elementFromPoint(r.x+Math.min(16,r.width/2),r.y+Math.min(10,r.height/2));return {menu:!!d.querySelector('[role="menu"]'),hidden:d.querySelector('[data-testid="board-filters"]').hidden,sameRoot:d.getElementById('root').firstElementChild===w.__reviewMenuRoot,active:d.activeElement?.dataset.testid??d.activeElement?.getAttribute('role')??d.activeElement?.tagName,rect:[r.x,r.y,r.width,r.height],hit:hit?.closest('[data-testid]')?.dataset.testid}`);
    check('review:filters-to-plan-actions:menu-survives-dismissal', menuState.menu && menuState.hidden, [JSON.stringify(menuState)]);
    const option = await guest<number>('page', `return [...d.querySelectorAll('[role="menuitem"]')].findIndex(n=>n.id.endsWith('-task-view'))`);
    if (option < 0) throw Error('The surviving Plan actions menu has no Task view options item');
    await q.key('Home'); if (option) await q.key('ArrowDown', option); await q.key('Enter');
    await wait('page', `d.querySelector('[data-testid="focus-controls"]')`, 'newly opened menu remains usable');
    check('review:filters-to-plan-actions:menu-action-works', await guest('page', `return !d.querySelector('[role="menu"]')&&!!d.querySelector('[data-testid="focus-controls"]')`));
    // Capture only after using the menu: screenshot setup scrolls the root, and
    // the SDK correctly dismisses an open menu on an outside scroll.
    await shot('review-filters-menu-action-used', '[data-testid="progress-root"]', 0, 2000, 'page');
    await input.openFilters();
    check('review:filters-to-plan-actions:trigger-reopens-after-local-dismissal', await guest('page', `return !d.querySelector('[data-testid="board-filters"]').hidden`));
    await input.closeFilters();
    return;
  }
  if (!q.seedDesignRegroup || !q.finishDesignRegroup || !q.setCapture) throw Error('Recorded regroup fixture seams required');
  const plan = q.seedDesignRegroup(which);
  const selector = `[data-testid="plan-row-${plan}"][data-source="source-design"]`;
  await wait('page', `d.querySelector('${selector}')`, 'active regroup plan listed');
  const project = await guest<string>('page', `return d.querySelector('${selector}').closest('[data-project]').dataset.project`);
  const toggle = `[data-testid="board-finished-toggle"][data-project=${JSON.stringify(project)}]`;
  if (await guest('page', `return d.querySelector(${literal(toggle)})?.getAttribute('aria-expanded')==='true'`)) await click('page', toggle);
  await click('page', selector);
  await wait('page', `d.querySelector('[data-testid="plan-${plan}"] .ap-tasks[data-complete]')`, 'active selected plan complete');
  check(`review:${which}:pointer-leaves-row-focused`, await guest('page', `return d.activeElement===d.querySelector('${selector}')`));
  await guest('page', `w.__reviewSpeech=[];w.__reviewObserver?.disconnect();w.__reviewObserver=new MutationObserver(records=>{const n=d.querySelector('[data-testid="search-announcer"]');if(n&&records.some(r=>r.target===n||n.contains(r.target))&&n.textContent)w.__reviewSpeech.push(n.textContent)});w.__reviewObserver.observe(d.body,{childList:true,characterData:true,subtree:true});return true`);
  q.finishDesignRegroup(plan, which);
  await wait('page', `d.querySelector('${selector}')?.dataset.lifecycle==='${which === 'finished' ? 'completed' : 'cancelled'}'`, 'poll partitions the newly closed plan');
  check(`review:${which}:regroup-focus-to-own-finished-toggle`, await guest('page', `return d.activeElement===d.querySelector(${literal(toggle)})`), [await guest('page', `return 'Actual focus: '+(d.activeElement?.dataset.testid??d.activeElement?.tagName)`)]);
  check(`review:${which}:user-closed-fold-not-reopened`, await guest('page', `return d.querySelector(${literal(toggle)}).getAttribute('aria-expanded')==='false'&&!!d.querySelector('${selector}').closest('[hidden]')`));
  await wait('page', `w.__reviewSpeech.length>0`, 'one-shot regroup focus explanation');
  check(`review:${which}:toggle-announced-once`, await guest('page', `const n=d.querySelector('[data-testid="search-announcer"]');return w.__reviewSpeech.length===1&&/Finished/.test(w.__reviewSpeech[0])&&/focus moved/i.test(w.__reviewSpeech[0])&&n.getAttribute('aria-live')==='polite'&&n.getAttribute('role')==='status'`));
  const mark = await evaluate<number>('qa.replies.length');
  q.setCapture(false);
  await wait('page', `d.querySelector('[data-testid="capture-off"]')&&parent.qa.replies.slice(${mark}).filter(r=>r.frame==='page'&&r.path==='/v1/plans'&&r.status===200).length>=2`, 'a changed paint and two ordinary polls after regroup');
  check(`review:${which}:later-polls-keep-toggle-and-fold-closed`, await guest('page', `return d.activeElement===d.querySelector(${literal(toggle)})&&d.querySelector(${literal(toggle)}).getAttribute('aria-expanded')==='false'`));
  check(`review:${which}:later-polls-do-not-repeat-announcement`, await guest('page', `return w.__reviewSpeech.length===1`));
  await shot(`review-${which}-fold-focus`, '[data-testid="plan-list"]', 0, 1800, 'page');
  await guest('page', `w.__reviewObserver.disconnect();return true`);
  q.setCapture(true);
  await wait('page', `!d.querySelector('[data-testid="capture-off"]')`, 'capture restored');
}

/** Keyboard listbox focus differs from pointer row focus: keep the current list
 * usable, but never give it an active descendant from a different partition.
 */
async function keyboardRegroup(q: Parameters<typeof designRefactorQa>[0], outcome: 'finished' | 'cancelled') {
  const { guest, wait, click, check, key, shot } = q;
  if (!q.seedDesignKeyboardRegroup || !q.finishDesignRegroup) throw Error('Keyboard regroup fixture required');
  const { plan, source, foreignSource } = q.seedDesignKeyboardRegroup(outcome);
  const local = `[data-testid="plan-row-${plan}"][data-source="${source}"]`;
  const foreign = `[data-testid="plan-row-${plan}"][data-source="${foreignSource}"]`;
  const listsValid = `return [...d.querySelectorAll('[data-testid="plan-list"] [role="listbox"]')].every(box=>{const id=box.getAttribute('aria-activedescendant');return !id||!!box.querySelector('[role="option"][id="'+CSS.escape(id)+'"]')})`;
  await wait('page', `d.querySelector('${local}')&&d.querySelector('${foreign}')`, 'equal plan IDs from two sources listed');
  const project = await guest<string>('page', `return d.querySelector('${local}').closest('[data-project]').dataset.project`);
  const toggle = `[data-testid="board-finished-toggle"][data-project=${JSON.stringify(project)}]`;
  if (await guest('page', `return d.querySelector(${literal(toggle)})?.getAttribute('aria-expanded')==='true'`)) await click('page', toggle);
  await click('page', local);
  await wait('page', `d.querySelector('[data-testid="plan-${plan}"][data-source="${source}"] .ap-tasks[data-complete]')`, 'selected local plan loaded');
  await key('Tab', 1, 8); // real Shift+Tab from the -1 pointer-focused option to its listbox
  await wait('page', `d.activeElement===d.querySelector('${local}').closest('[role="listbox"]')`, 'keyboard focus owns the current listbox');
  const selectInList = async (selector: string) => {
    const index = await guest<number>('page', `const row=d.querySelector(${literal(selector)});return [...row.closest('[role="listbox"]').querySelectorAll('[role="option"]')].indexOf(row)`);
    if (index < 0) throw Error('Target is not an actual option of its owning listbox');
    await key('Home'); if (index) await key('ArrowDown', index); await key('Enter');
  };
  await selectInList(local);
  await wait('page', `d.activeElement?.getAttribute('role')==='listbox'&&d.querySelector('${local}').getAttribute('aria-selected')==='true'`, 'local plan selected by real keyboard input');
  check(`review:keyboard-${outcome}:selected-in-own-list`, await guest('page', `const b=d.activeElement,n=d.getElementById(b.getAttribute('aria-activedescendant'));return b.contains(n)&&n===d.querySelector('${local}')`));
  q.finishDesignRegroup(plan, outcome);
  await wait('page', `d.querySelector('${local}')?.dataset.lifecycle==='${outcome === 'finished' ? 'completed' : 'cancelled'}'`, 'poll moves local plan under Finished');
  const beforeEnter = await guest('page', `const box=d.querySelector('${foreign}').closest('[role="listbox"]'),id=box.getAttribute('aria-activedescendant');return {focused:d.activeElement===box,activeDescendant:id,valid:!id||box.contains(d.getElementById(id)),expanded:d.querySelector(${literal(toggle)}).getAttribute('aria-expanded')}`);
  check(`review:keyboard-${outcome}:poll-keeps-current-list-focus`, beforeEnter.focused, [JSON.stringify(beforeEnter)]);
  await key('Enter');
  await guest('page', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  check(`review:keyboard-${outcome}:enter-does-not-open-hidden-plan`, await guest('page', `return d.querySelector(${literal(toggle)}).getAttribute('aria-expanded')==='false'&&!!d.querySelector('${local}').closest('[hidden]')`), [JSON.stringify(beforeEnter)]);
  check(`review:keyboard-${outcome}:every-list-has-valid-descendant-or-none`, await guest('page', listsValid));
  check(`review:keyboard-${outcome}:equal-id-foreign-row-not-selected`, await guest('page', `return !d.querySelector('${foreign}').closest('[hidden]')&&d.querySelector('${foreign}').getAttribute('aria-selected')==='false'&&d.querySelector('${local}').getAttribute('aria-selected')==='true'`));
  await selectInList(foreign);
  await wait('page', `d.querySelector('[data-testid="plan-${plan}"][data-source="${foreignSource}"] .ap-tasks[data-complete]')`, 'explicit keyboard selection opens the other source only');
  check(`review:keyboard-${outcome}:foreign-keyboard-selection-works`, await guest('page', `return d.querySelector('${foreign}').getAttribute('aria-selected')==='true'&&d.querySelector('${local}').getAttribute('aria-selected')==='false'&&d.querySelector(${literal(toggle)}).getAttribute('aria-expanded')==='false'`));
  await click('page', toggle);
  await key('Tab'); // from Finished toggle into the now-visible Finished listbox
  await wait('page', `d.activeElement===d.querySelector('${local}').closest('[role="listbox"]')`, 'explicitly expanded Finished list owns keyboard focus');
  await selectInList(local);
  await wait('page', `d.querySelector('[data-testid="plan-${plan}"][data-source="${source}"] .ap-tasks[data-complete]')`, 'explicit Finished selection reads the chosen source');
  check(`review:keyboard-${outcome}:explicit-finished-selection-still-reveals`, await guest('page', `return d.querySelector('${local}').getAttribute('aria-selected')==='true'&&d.querySelector(${literal(toggle)}).getAttribute('aria-expanded')==='true'`));
  await click('page', toggle);
  await key('Tab', 1, 8); // return to the visible current list, not the closed Finished list
  await wait('page', `d.activeElement===d.querySelector('${foreign}').closest('[role="listbox"]')`, 'current list focus after deliberate fold collapse');
  await key('Enter');
  await guest('page', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  check(`review:keyboard-${outcome}:explicit-selection-does-not-leak-back-into-current`, await guest('page', `return d.querySelector(${literal(toggle)}).getAttribute('aria-expanded')==='false'`) && await guest('page', listsValid));
  await shot(`review-keyboard-${outcome}-current-list`, '[data-testid="plan-list"]', 0, 1800, 'page');
}
