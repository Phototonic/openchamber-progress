import type { designRefactorQa } from './design-refactor-qa.ts';
import { boardInput } from './board-qa.ts';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';

export type BoardReviewCheck = 'menu' | 'finished' | 'cancelled';

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
