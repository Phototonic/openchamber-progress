import { progressInput, type ProgressDriver } from './progress-qa.ts';

interface Driver extends ProgressDriver {
  evaluate: <T = any>(code: string) => Promise<T>;
  check: (id: string, pass: boolean, ...facts: any[]) => void;
  show: (surfaces: string[], width: number) => Promise<void>;
  openBoard: (plan: string) => Promise<void>;
  stores: [string, string];
}

/** Reading-owned state must survive a benign repaint, but never A→B→A or authority changes. */
export async function progressRetirementQa(d: Driver) {
  const ui = progressInput(d);
  const state = (kind: string) => kind === 'info' ? '[data-info] [data-testid="info-trigger"][aria-expanded="true"]'
    : kind === 'copy' ? '[data-testid^="task-copy-preview-"]' : kind === 'task-view' ? '[data-testid="focus-controls"]' : `[data-testid="plan-panel-${kind}"]`;
  const select = async (surface: string, plan: string) => {
    if (surface === 'page') {
      // These source-qualified fixtures can be outside the loaded 500-plan list.
      await d.openBoard(plan);
    }
    else {
      await d.wait(surface, `d.querySelector('[data-testid="plan-selector"] button')?.getAttribute('aria-label')?.includes('of 2:')`, 'linked session picker ready');
      await d.click(surface, '[data-testid="plan-selector"] button');
      await d.wait(surface, `d.querySelector('[role="option"][id$="source-alpha/${plan}"]')`);
      await d.click(surface, `[role="option"][id$="source-alpha/${plan}"]`);
    }
    await ui.list(surface,{id:plan,source:'source-alpha'});
    await d.wait(surface, `d.querySelector('article[data-source="source-alpha"][data-testid="plan-${plan}"] .ap-tasks[data-complete]')`);
  };
  const switchStore = async (surface: string, index: number) => {
    const expected = d.stores[index];
    const mark = await d.evaluate<number>('qa.replies.length');
    await d.evaluate(`qa.store=${index};true`);
    await d.wait(surface, `parent.qa.replies.slice(${mark}).some(r=>r.frame==='${surface}'&&r.path==='/v1/plans'&&r.storeId===${JSON.stringify(expected)})`, 'new store list received');
    // A first page's reply precedes acceptance of the complete paged list. Do not
    // submit the next search against the previous authority still painted on screen.
    await d.wait(surface, `d.querySelector('[data-testid="details"]')?.textContent.includes(${JSON.stringify(expected)})`, 'new store accepted by the frame');
    if(surface==='page') await d.wait(surface, `!d.querySelector('[data-testid="search-results"]')&&d.querySelector('[data-testid="plan-list-heading"]')&&d.querySelector('[data-testid="progress-root"][aria-busy="false"]')`, 'new authority browsing paint ready');
    await d.guest(surface, `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  };
  for (const surface of ['page', 'panel']) {
    const session = surface === 'panel' ? 'retirement-reader' : 'M';
    await d.show([surface], surface === 'page' ? 1100 : 360);
    await d.evaluate(`qa.context('${session}');true`);
    if (surface === 'panel') await d.wait(surface, `d.querySelector('[data-testid="plan-selector"] button')?.getAttribute('aria-label')?.includes('of 2:')`, 'linked session list accepted');
    for (const kind of ['info', 'task-view', 'sessions', ...(surface === 'panel' ? ['document'] : []), 'copy']) {
      for (const boundary of ['plan', 'session', 'store']) {
        await select(surface, 'P-export');
        if (kind === 'info') await d.click(surface, '[data-info] [data-testid="info-trigger"]');
        else if (kind === 'copy') { await ui.expand(surface, 'T-csv'); await d.click(surface, '[data-testid="task-copy-T-csv"]'); }
        else await ui.action(surface, kind);
        const selector = state(kind);
        await d.wait(surface, `d.querySelector('${selector}')`, `${kind} open`);
        if (boundary === 'plan') {
          const mark = await d.evaluate<number>('qa.replies.length');
          await d.wait(surface, `parent.qa.replies.slice(${mark}).some(r=>r.frame==='${surface}'&&['/v1/plans','/v1/search-state'].includes(r.path)&&r.status===200)`, 'ordinary poll completes while open');
          d.check(`reading:${surface}:${kind}:poll-retained`, await d.guest(surface, `return !!d.querySelector('${selector}')`));
        }
        await d.evaluate(`qa.theme('dark');true`);
        await d.wait(surface, `getComputedStyle(d.body).backgroundColor!=='rgb(250, 250, 250)'&&d.querySelector('${selector}')`, 'open state survives benign repaint');
        d.check(`reading:${surface}:${kind}:${boundary}:same-reading-retained`, await d.guest(surface, `return !!d.querySelector('${selector}')`));
        if (boundary === 'plan') { await select(surface, 'P-title'); await select(surface, 'P-export'); }
        else if (boundary === 'session') {
          await d.evaluate(`qa.context(null);true`);
          if (surface === 'panel') await d.wait(surface, `d.querySelector('[data-testid="unscoped-state"]')`);
          // Board is host-session independent: its own reading and open state must remain.
          else d.check(`reading:${surface}:${kind}:host-session-independent`, await d.guest(surface, `return !!d.querySelector('${selector}')`));
          await d.evaluate(`qa.context('${session}');true`);
          if (surface === 'page') {
            // Retire the board reading by changing its explicit scope, not the unrelated host selection.
            await d.wait(surface, `d.querySelector('[data-testid="filter-session"] button')`, 'board scope available after host context repaint');
            await d.guest(surface, `w.focus();d.querySelector('[data-testid="filter-session"] button').focus();return true`);
            await d.key!('Enter');
            await d.wait(surface, `d.querySelector('[role="listbox"]')`);
            await d.key!('Home'); await d.key!('ArrowDown'); await d.key!('Enter');
            await d.wait(surface, `parent.qa.requests.filter(r=>r.frame==='page'&&['/v1/plans','/v1/search'].includes(r.path)).at(-1)?.query?.session`, 'explicit board scope read');
            await d.wait(surface, `d.querySelector('[data-testid="filter-session"] button')`, 'scoped board repaint complete');
            await d.guest(surface, `w.focus();d.querySelector('[data-testid="filter-session"] button').focus();return true`);
            await d.key!('Enter');
            await d.key!('Home'); await d.key!('Enter');
            await d.wait(surface, `!parent.qa.requests.filter(r=>r.frame==='page'&&['/v1/plans','/v1/search'].includes(r.path)).at(-1)?.query?.session`, 'board scope cleared');
          }
          await select(surface, 'P-export');
        } else {
          await switchStore(surface, 1);
          d.check(`reading:${surface}:${kind}:store:retired-in-new-authority`, await d.guest(surface, `return !d.querySelector('${selector}')`));
          await switchStore(surface, 0);
          await select(surface, 'P-export');
        }
        d.check(`reading:${surface}:${kind}:${boundary}:no-resurrection`, await d.guest(surface, `return !d.querySelector('${selector}')`));
        await d.evaluate(`qa.theme('light');true`);
      }
    }
    // A completed write belongs to the old preview, not an equal-ID replacement reading.
    await select(surface, 'P-export');
    await ui.expand(surface, 'T-csv');
    await d.guest(surface, `w.__taskClipboardDescriptor=Object.getOwnPropertyDescriptor(w.navigator,'clipboard');Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise(resolve=>{w.__finishOldTaskCopy=resolve})}});return true`);
    await d.click(surface, '[data-testid="task-copy-T-csv"]');
    await d.click(surface, '[data-testid="task-copy-confirm-T-csv"] button');
    await d.wait(surface, `typeof w.__finishOldTaskCopy==='function'`, 'old task-copy write held');
    if (surface === 'panel') {
      await d.evaluate(`qa.context(null);true`);
      await d.wait(surface, `d.querySelector('[data-testid="unscoped-state"]')`);
      await d.evaluate(`qa.context('${session}');true`);
    } else {
      await switchStore(surface, 1);
      d.check('reading:page:held-copy-preview-retired-on-store-change', await d.guest(surface, `return !d.querySelector('[data-testid="task-copy-preview-T-csv"]')`));
      await switchStore(surface, 0);
    }
    await select(surface, 'P-export');
    await ui.expand(surface, 'T-csv');
    await d.click(surface, '[data-testid="task-copy-T-csv"]');
    await d.wait(surface, `d.activeElement?.dataset.testid==='task-copy-text-T-csv'`, 'replacement task preview');
    await d.guest(surface, `w.__finishOldTaskCopy();return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    d.check(`reading:${surface}:retired-copy-completion-inert`, await d.guest(surface, `return d.activeElement?.dataset.testid==='task-copy-text-T-csv'&&d.querySelector('[data-testid="task-copy-status-T-csv"]').textContent.startsWith('Review before sharing:')`));
    await d.click(surface, '[data-testid="task-copy-close-T-csv"] button');
    await d.guest(surface, `if(w.__taskClipboardDescriptor)Object.defineProperty(w.navigator,'clipboard',w.__taskClipboardDescriptor);else delete w.navigator.clipboard;delete w.__finishOldTaskCopy;delete w.__taskClipboardDescriptor;return true`);
  }
  await d.evaluate(`qa.context(null);true`);
  await d.show(['page'], 1100);
  if(await d.guest('page',`return !!d.querySelector('[data-testid="search-clear"] button')`)) {
    await d.click('page','[data-testid="search-clear"] button');
    await d.wait('page',`!d.querySelector('[data-testid="search-results"]')`);
  }
}
