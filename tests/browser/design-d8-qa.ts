// Focused production D8 assertions on the existing shell; real pointer input, labelled held replies.
import type { designRefactorQa } from './design-refactor-qa.ts';
type Driver = Parameters<typeof designRefactorQa>[0];
export async function designD8Qa(q: Driver) {
  const { evaluate, guest, wait, click, show, check } = q;
  const graphs = (s: string) => evaluate<number>(`qa.requests.filter(r=>r.frame==='${s}'&&r.path==='/v1/plan-graph').length`);
  const choose = async (s: string, plan: string) => {
    if (s === 'page') {
      await wait(s, `d.querySelector('[data-testid="plan-row-${plan}"][data-source="source-design"]')`);
      await click(s, `[data-testid="plan-row-${plan}"][data-source="source-design"]`);
    } else {
      await wait(s, `d.querySelector('[data-testid="plan-selector"] button')`);
      await click(s, '[data-testid="plan-selector"] button');
      await wait(s, `d.querySelector('[role="option"][id$="source-design/${plan}"]')`);
      await click(s, `[role="option"][id$="source-design/${plan}"]`);
    }
  };
  const reload = async (s: string) => {
    const seq = await evaluate<number>(`qa.reload('${s}')`);
    await wait(s, `qa.loaded['${s}']===${seq}`);
  };
  const list = (s: string) => s === 'page' ? '[data-testid="detail-tabs"] [data-id="progress"]' : '[data-testid="plan-view-list"] button';
  for (const s of ['page', 'panel']) {
    await show([s], s === 'page' ? 1100 : 360);
    for (const explicit of [false, true]) {
      const tag = `d8-${s}-${explicit}`;
      await evaluate(`qa.holds.push({frame:'${s}',path:'/v1/plan',plan:'P-calm',tag:'${tag}'});true`);
      await reload(s);
      const mark = await graphs(s);
      await guest(s, `w.__d8Paints=[];w.__d8Observer?.disconnect();w.__d8Observer=new MutationObserver(()=>{const a=d.querySelector('article[data-testid="plan-P-calm"][data-source="source-design"]');w.__d8Paints.push({list:!!a?.querySelector('.ap-tasks[data-complete]'),map:!!d.querySelector('[data-testid="map-region"]')})});w.__d8Observer.observe(d.getElementById('root'),{childList:true,subtree:true});return true`);
      await choose(s, 'P-calm');
      await wait(s, `parent.qa.held.some(h=>h.tag==='${tag}')&&d.querySelector('[data-testid="detail-loading"]')`, 'held complete-detail default');
      check(`d8:${s}:${explicit}:pending-honest`, await guest(s, `return !d.querySelector('.ap-tasks[data-complete],[data-testid="map-region"]')`));
      check(`d8:${s}:${explicit}:no-discovery-graph`, await graphs(s) === mark);
      if (explicit) await click(s, list(s)); // reactivation of provisional List/Progress
      await evaluate(`qa.release('${tag}');true`);
      if (explicit) {
        await wait(s, `d.querySelector('.ap-tasks[data-complete]')`);
        check(`d8:${s}:explicit-list-wins`, await guest(s, `return !d.querySelector('[data-testid="map-region"]')`) && await graphs(s) === mark);
      } else {
        await wait(s, `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);
        check(`d8:${s}:edge-map-default`, await guest(s, `return Number(d.querySelector('[data-testid="map-region"]').dataset.edges)>0`));
        check(`d8:${s}:no-populated-list-flash`, await guest(s, `return w.__d8Paints.every(p=>!p.list)`));
        check(`d8:${s}:automatic-entry-focus-quiet`, await guest(s, `return !d.querySelector('[data-testid="map-viewport"]')?.contains(d.activeElement)&&!d.querySelector('[data-testid="map-inspector"]')?.dataset.selected&&!d.querySelector('[data-testid="map-announcer"]')?.textContent`));
        if (s === 'panel') check('d8:rail:picker-focus-survives-default', await guest(s, `return !!d.activeElement.closest('[data-testid="plan-selector"]')`));
      }
      await guest(s, 'w.__d8Observer.disconnect();return true');
    }
    const noEdges = await graphs(s);
    await choose(s, 'P-calm-no-edges');
    await wait(s, `d.querySelector('[data-testid="plan-P-calm-no-edges"] .ap-tasks[data-complete]')`);
    check(`d8:${s}:no-edges-list-no-graph`, await graphs(s) === noEdges && await guest(s, `return !d.querySelector('[data-testid="map-region"]')`));
    await evaluate('qa.stripGraph=true;true');
    await reload(s);
    const old = await graphs(s);
    await choose(s, 'P-calm');
    await wait(s, `d.querySelector('[data-testid="plan-P-calm"] .ap-tasks[data-complete]')`);
    check(`d8:${s}:old-service-list-no-graph`, await graphs(s) === old && await guest(s, `return !d.querySelector('[data-testid="map-region"]')`));
    await evaluate('qa.stripGraph=false;true');
    // A supported new reading keeps its unresolved default, but never hides a real error.
    await evaluate(`qa.fail.push({frame:'${s}',path:'/v1/plan',status:503});true`);
    await reload(s);
    const failedMark = await graphs(s);
    await choose(s, 'P-calm');
    await wait(s, `d.querySelector('[data-testid="detail-loading"] button')`, 'initial detail failure offers Retry');
    check(`d8:${s}:failed-detail-is-not-endless-loading`, await guest(s, `const n=d.querySelector('[data-testid="detail-loading"]');return n.textContent.includes('Tasks could not be loaded')&&!n.querySelector('[role="progressbar"]')&&!d.querySelector('.ap-tasks[data-complete],[data-testid="map-region"]')`) && await graphs(s) === failedMark);
    await evaluate(`qa.fail=qa.fail.filter(x=>!(x.frame==='${s}'&&x.path==='/v1/plan'));true`);
    await click(s, '[data-testid="detail-loading"] button');
    await wait(s, `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`, 'retry resolves pending default to Map');
    check(`d8:${s}:retry-retains-default-decision`, await guest(s, `return Number(d.querySelector('[data-testid="map-region"]').dataset.edges)>0`));
  }
  // Capture starts a new reading with supported capabilities; no state leaks from the fault cases.
  await evaluate(`qa.reload('page');qa.reload('panel');true`);
}
