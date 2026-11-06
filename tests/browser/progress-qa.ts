// Shared real-input routes for the one canonical Progress list. No legacy DOM aliases.
export interface ProgressDriver {
  guest: <T = any>(surface: string, code: string) => Promise<T>;
  wait: (surface: string, condition: string, label?: string, ms?: number) => Promise<unknown>;
  click: (surface: string, selector: string) => Promise<void>;
  key?: (key: string, times?: number) => Promise<void>;
}
export const taskRow = (id: string) => `li[data-testid="item-${id}"]`;
export const taskToggle = (id: string) => `details[data-testid="item-toggle-${id}"]`;
export const actionItem = (id: string) => `[role="menuitem"][id$="-${id}"]`;

export function progressInput(d: ProgressDriver) {
  const menu = async (surface: string, id: string, keyboard = false) => {
    if (['task-view','order','expand-all','collapse-all','sessions','document'].includes(id)) await d.wait(surface, `d.querySelector('.ap-tasks[data-complete]')`, 'Complete reading before task actions');
    await d.wait(surface, `d.querySelector('[data-testid="plan-actions"] button')`, 'Plan actions available');
    if (keyboard) {
      if (!d.key) throw Error('Keyboard menu route requires native key input');
      // Programmatic focus may scroll the frame. Let its scroll event finish before
      // opening the SDK popup, which correctly dismisses on an outside scroll.
      await d.guest(surface, `w.focus();d.querySelector('[data-testid="plan-actions"] button').focus();return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
      await d.key('Enter');
    } else await d.click(surface, '[data-testid="plan-actions"] button');
    await d.wait(surface, `d.querySelector('${actionItem(id)}')`, `Plan actions: ${id}`);
    if (keyboard) {
      const index = await d.guest<number>(surface, `return [...d.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')].findIndex(n=>n.matches('${actionItem(id)}'))`);
      if (index < 0) throw Error(`Missing menu action ${id}`);
      await d.key!('Home'); await d.key!('ArrowDown', index);
    }
  };
  const action = async (surface: string, id: string, keyboard = false) => {
    await menu(surface, id, keyboard);
    if (keyboard) await d.key!('Enter'); else await d.click(surface, actionItem(id));
    await d.wait(surface, `!d.querySelector('[role="menu"]')`, 'Plan actions dismissed');
  };
  const list = async (surface: string, identity?: { id: string; source: string }) => {
    if (identity) {
      const { id, source } = identity;
      await d.wait(surface, `d.querySelector('article[data-testid="plan-${id}"][data-source="${source}"]')||(JSON.parse(d.querySelector('[data-map-identity]')?.dataset.mapIdentity??'[]')[5]==='${source}'&&JSON.parse(d.querySelector('[data-map-identity]')?.dataset.mapIdentity??'[]')[6]==='${id}')`, 'Selected reading before choosing List');
    }
    await d.wait(surface, `d.querySelector('[data-testid="plan-view-list"] button,[data-testid="detail-tabs"] [data-id="progress"]')`, 'List entry');
    await d.click(surface, surface === 'page' ? '[data-testid="detail-tabs"] [data-id="progress"]' : '[data-testid="plan-view-list"] button');
  };
  const controls = async (surface: string) => {
    if (!(await d.guest<boolean>(surface, `return !!d.querySelector('[data-testid="focus-controls"]')`))) await action(surface, 'task-view');
    await d.wait(surface, `d.querySelector('[data-testid="focus-controls"]')`, 'Task view options');
  };
  const planOrder = async (surface: string) => {
    await controls(surface);
    await d.click(surface, '[data-testid="focus-order-plan"] button');
    await d.wait(surface, `d.querySelector('ul.ap-items')?.dataset.order==='plan'`, 'Plan order');
  };
  const expand = async (surface: string, id: string) => {
    const selector = taskToggle(id);
    // Reveal containing Done/Skipped folds before the row's own disclosure.
    const folds = await d.guest<string[]>(surface, `let n=d.querySelector('${selector}');const selectors=[];for(let p=n?.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open){if(p.dataset.testid)selectors.unshift('[data-testid="'+p.dataset.testid+'"]');else if(p.parentElement.dataset.testid)selectors.unshift('[data-testid="'+p.parentElement.dataset.testid+'"] > details');else throw Error('Unnamed enclosing disclosure')}return selectors`);
    for (const fold of folds) {
      await d.click(surface, `${fold} > summary`);
      await d.wait(surface, `d.querySelector('${fold}')?.open&&(!d.querySelector('${fold}').classList.contains('ap-trow')||d.querySelector('${fold} > .ap-trow-body')?.childElementCount>0)`, 'Containing disclosure expanded');
    }
    if (!(await d.guest<boolean>(surface, `return d.querySelector('${selector}')?.open===true`))) await d.click(surface, `${selector} > summary`);
    try { await d.wait(surface, `d.querySelector('${selector}')?.open&&d.querySelector('${selector} > .ap-trow-body')?.childElementCount>0`, `Expanded task ${id}`); }
    catch (error) {
      const state = await d.guest(surface, `const n=d.querySelector('${selector}'),s=n?.querySelector(':scope > summary'),r=s?.getBoundingClientRect(),f=w.frameElement.getBoundingClientRect();return {open:n?.open,facts:n?.querySelector('.ap-trow-body')?.childElementCount,summary:r?{top:r.top,bottom:r.bottom}:null,frame:{top:f.top,bottom:f.bottom},viewport:[w.innerHeight,w.parent.innerHeight],active:d.activeElement?.tagName}`);
      throw Error(String(error)+' '+JSON.stringify(state));
    }
  };
  const expandAll = async (surface: string) => {
    await action(surface, 'expand-all');
    await d.wait(surface, `[...d.querySelectorAll('details[data-testid^="item-toggle-"]')].every(n=>n.open&&n.querySelector(':scope > .ap-trow-body')?.childElementCount>0)`, 'All task facts built');
  };
  const records = async (surface: string) => {
    if (await d.guest<boolean>(surface, `return !!d.querySelector('[data-testid="observed-more"]:not([open])')`)) await d.click(surface, '[data-testid="observed-more"] > summary');
    const hooks = await d.guest<string[]>(surface, `return [...d.querySelectorAll('[data-testid="subagent-activity"] details[data-testid]:not([open])')].map(n=>n.dataset.testid).filter(id=>id!=='observed-more')`);
    for (const hook of hooks) await d.click(surface, `[data-testid="${hook}"] > summary`);
  };
  return { menu, action, list, controls, planOrder, expand, expandAll, records };
}
