import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { designRefactorQa } from './design-refactor-qa.ts';

/** Whole guest-region Status measurements, never the host's Project section. */
export async function designStatusQa(q: Parameters<typeof designRefactorQa>[0]) {
  const { guest, evaluate, wait, show, click, check, shot } = q;
  const reloadStatus = async () => {
    const generation = await evaluate<number>(`qa.reload('status')`);
    // Old hooks remain visible until navigation commits; do not click that retired document.
    await wait('status', `d.readyState==='complete'&&d.defaultView.parent.qa.loaded.status===${generation}`, 'new Status document loaded');
  };
  await show(['status'], 360);
  await wait('status', `d.querySelector('[data-testid="status-plan-selector"] button')`, 'Status scoped plans available');
  await click('status', '[data-testid="status-plan-selector"] button');
  await wait('status', `d.querySelector('[role="option"][id$="source-design/P-calm"]')`, 'F8 featured choice');
  await click('status', '[role="option"][id$="source-design/P-calm"]');
  await wait('status', `d.querySelector('[data-testid="plan-P-calm"][data-source="source-design"] [data-testid="counts"]')?.dataset.done==='3'&&d.querySelector('[data-testid="current-work"]')?.textContent.includes('Build release candidate')`, 'complete selected F8 detail');
  await wait('status', `d.querySelector('[data-testid="subagent-activity"]')&&!/Loading older history/.test(d.querySelector('[data-testid="subagent-activity"]').textContent)`, 'settled Status roster');
  const density: object[] = [], screenshots: object[] = [];
  for (const width of [280, 360, 480, 190]) {
    await show(['status'], width);
    for (const theme of ['light', 'dark'] as const) {
      await q.theme(theme);
      await evaluate(`(()=>{const f=frame('status');f.style.height=Math.max(1500,Math.ceil(f.contentDocument.documentElement.scrollHeight))+'px';return true})()`);
      const metrics = await guest('status', `const root=d.querySelector('[data-testid="progress-root"]');const visible=n=>{if(n.closest('[hidden],.ap-sr,.sr-only,[aria-hidden="true"]'))return false;for(let p=n;p&&root.contains(p);p=p.parentElement){if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope > summary')?.contains(n))return false;const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden')return false}return n.getClientRects().length>0};const lines=new Set(),walker=d.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(!n.textContent.trim()||!visible(n.parentElement))continue;const r=d.createRange();r.selectNodeContents(n);for(const b of r.getClientRects())if(b.width&&b.height)lines.add(Math.round(b.top)+':'+Math.round(b.bottom))}return {textLines:lines.size,controls:[...root.querySelectorAll('button,input,select,summary,a[href],[tabindex="0"]')].filter(visible).length,height:root.getBoundingClientRect().height,overflow:d.documentElement.scrollWidth>w.innerWidth+1}`);
      density.push({ fixture: 'F8', surface: 'status', width, theme, view: 'status', ...metrics });
      check(`status:${width}:${theme}:whole-plan-counts`, await guest('status', `const n=d.querySelector('[data-testid="plan-P-calm"][data-source="source-design"] [data-testid="counts"]');return n?.dataset.done==='3'&&n.dataset.total==='8'`));
      if (q.label === 'after') {
        check(`status:${width}:${theme}:no-horizontal-overflow`, !metrics.overflow);
        if (width === 280) {
          const file = join(q.artifacts, '..', 'before', 'density.json');
          if (!existsSync(file)) throw Error('Status density requires sibling before measurements');
          const baseline = JSON.parse(readFileSync(file, 'utf8')).measurements.find((m: any) => m.surface === 'status' && m.width === width && m.theme === theme);
          check(`status:${width}:${theme}:twenty-five-percent-fewer-lines`, !!baseline && metrics.textLines <= baseline.textLines * .75);
        }
      }
      const name = `F8-status-${width}-${theme}`;
      await shot(name, '[data-testid="progress-root"]', 0, Math.ceil(metrics.height) + 1, 'status');
      screenshots.push({ file: `${name}.png`, fixture: 'F8', surface: 'status', width, theme, state: 'fresh complete; disclosures closed; explicit F8 featured choice', height: metrics.height });
    }
  }
  if (q.label === 'after') {
    await show(['status'], 280); await q.theme('light');
    const capture = async (name: string, state: string) => {
      const height = await guest<number>('status', `return Math.ceil(d.querySelector('[data-testid="progress-root"]').getBoundingClientRect().height)`);
      await shot(name, '[data-testid="progress-root"]', 0, height + 1, 'status');
      screenshots.push({ file: `${name}.png`, surface: 'status', width: 280, theme: 'light', state, height });
    };
    check('status:focus-blocked-then-working', await guest('status', `return JSON.stringify([...d.querySelectorAll('[data-testid="current-work"] > li')].map(n=>[n.dataset.testid,n.dataset.status]))===JSON.stringify([['status-focus-B1','blocked'],['status-focus-W1','working']])`));
    check('status:qualified-whole-counts', await guest('status', `const n=d.querySelector('[data-testid="counts"]');return n.textContent.startsWith('3/8')&&n.dataset.remaining==='5'&&n.dataset.skipped==='0'`));
    const boundary = await evaluate<{ x: number; y: number; width: number; height: number }>(`(()=>{const f=frame('status'),section=f.parentElement,p=document.createElement('div');p.dataset.testid='synthetic-host-project';p.textContent='Project · synthetic host context';p.style.cssText='padding:12px 0';section.prepend(p);f.style.height=Math.ceil(f.contentDocument.querySelector('[data-testid="progress-root"]').getBoundingClientRect().height)+'px';const r=section.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    check('status:host-project-stays-outside-guest', await guest('status', `return !d.querySelector('[data-testid="synthetic-host-project"]')`));
    const hostShot = await q.c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...boundary, scale: 1 } });
    writeFileSync(join(q.artifacts, 'F8-status-synthetic-host-boundary.png'), Buffer.from(hostShot.data, 'base64'));
    screenshots.push({ file: 'F8-status-synthetic-host-boundary.png', surface: 'status + synthetic host', width: 280, theme: 'light', state: 'explicitly synthetic host Project context outside production guest' });
    await click('status', '[data-testid="more-plans"]');
    await wait('status', `d.querySelector('[role="listbox"]')`, 'other plans reached through +N');
    check('status:more-plans-opens-all-scoped-options', await guest('status', `return d.querySelectorAll('[role="option"]').length===4&&[...d.querySelectorAll('[role="option"]')].some(n=>n.textContent.includes('Automatic'))`));
    await capture('F8-status-picker-open', 'all scoped plans and Automatic reached through +N');
    await q.key('Escape');
    if (!q.setCapture) throw Error('Status capture-state fixture required');
    q.setCapture(false);
    await wait('status', `d.querySelector('[data-testid="capture-off"]')`, 'capture off warning beside counts');
    check('status:capture-off-keeps-last-reported-counts', await guest('status', `return d.querySelector('[data-testid="capture-off"]').textContent.includes('last reported counts')&&d.querySelector('[data-testid="counts"]').dataset.total==='8'`));
    await capture('F8-status-capture-off', 'capture off; last reported counts');
    q.setCapture(true);
    await wait('status', `!d.querySelector('[data-testid="capture-off"]')`, 'capture restored');
    await evaluate(`qa.fail.push({path:'/v1/plans',frame:'status',status:503,code:'unavailable'});true`);
    await wait('status', `d.querySelector('[data-testid="stale-banner"]')`, 'retained counts qualified after failed refresh');
    check('status:stale-keeps-qualified-counts', await guest('status', `return d.querySelector('[data-testid="stale-banner"]').textContent.includes('Counts may be out of date')&&d.querySelector('[data-testid="counts"]').dataset.total==='8'`));
    await capture('F8-status-stale', 'failed refresh; retained qualified counts');
    await evaluate(`qa.fail=[];true`);
    await wait('status', `!d.querySelector('[data-testid="stale-banner"]')`, 'freshness restored');
    await evaluate(`qa.fail.push({path:'/v1/plan',frame:'status',status:503,code:'unavailable'});true`);
    await reloadStatus();
    await wait('status', `d.querySelector('[data-testid="status-detail-unavailable"]')`, 'detail read unavailable');
    check('status:unavailable-does-not-fabricate-focus-or-guidance', await guest('status', `return !d.querySelector('[data-testid="current-work"]')&&!d.querySelector('[data-testid="state-chip"][data-state="ready"],[data-testid="state-chip"][data-state="waiting"]')&&d.querySelector('[data-testid="counts"]').dataset.total==='8'`));
    await capture('F8-status-unavailable', 'detail unavailable; summary totals retained');
    await evaluate(`qa.fail=[];true`);
    await reloadStatus();
    await wait('status', `d.querySelector('[data-testid="current-work"]')`, 'detail restored');
    if (!q.seedDesignRegroup || !q.finishDesignRegroup) throw Error('Status finished-plan fixture required');
    const finished = q.seedDesignRegroup('finished'); q.finishDesignRegroup(finished, 'finished');
    // The normal poll must first admit the new scoped choice.
    await wait('status', `d.querySelector('[data-testid="more-plans"]')?.textContent==='+3 more plans'`, 'finished plan admitted to scoped picker');
    await click('status', '[data-testid="more-plans"]');
    await wait('status', `d.querySelector('[role="option"][id$="source-design/${finished}"]')`, 'finished option reachable');
    const replyStart = await evaluate<number>(`qa.replies.length`);
    await evaluate(`qa.fail.push({path:'/v1/plan',frame:'status',status:503,code:'unavailable'});true`);
    await click('status', `[role="option"][id$="source-design/${finished}"]`);
    await wait('status', `d.querySelector('[data-testid="plan-${finished}"][data-lifecycle="completed"] [data-testid="counts"]')?.dataset.done==='1'`, 'finished manual choice');
    await wait('status', `d.defaultView.parent.qa.replies.slice(${replyStart}).some(r=>r.frame==='status'&&r.path==='/v1/plan'&&r.status===503)&&!d.querySelector('[data-testid="progress-root"][aria-busy="true"]')`, 'closed-plan selected detail read failed');
    // Let the accepted error response paint before inspecting the warning's new home.
    await guest('status', `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    check('status:closed-detail-failure-visible-with-valid-summary', await guest('status', `return !!d.querySelector('[data-testid="status-detail-unavailable"]')&&d.querySelector('[data-testid="counts"]').dataset.done==='1'&&d.querySelector('[data-testid="counts"]').dataset.total==='1'&&!d.querySelector('[data-testid="current-work"]')`));
    await capture('status-finished-detail-unavailable', 'finished selection; failed detail read visible beside valid summary');
    await evaluate(`qa.fail=[];true`);
    await reloadStatus();
    await wait('status', `d.querySelector('[data-testid="more-plans"]')?.textContent==='+3 more plans'`, 'fresh complete scoped picker after failure');
    await click('status', '[data-testid="more-plans"]');
    await wait('status', `d.querySelector('[role="option"][id$="source-design/${finished}"]')`, 'finished option after read recovery');
    await click('status', `[role="option"][id$="source-design/${finished}"]`);
    await wait('status', `d.querySelector('[data-testid="plan-${finished}"] [data-testid="counts"]')?.dataset.done==='1'&&!d.querySelector('[data-testid="status-detail-unavailable"]')`, 'finished detail recovery');
    check('status:finished-has-reported-counts-not-readiness', await guest('status', `return d.querySelector('[data-testid="counts"]').dataset.total==='1'&&!d.querySelector('[data-testid="state-chip"][data-state="ready"],[data-testid="state-chip"][data-state="waiting"]')`));
    await capture('status-finished-choice', 'explicit finished choice; no readiness guidance');
    await evaluate(`qa.context(null);true`);
    await wait('status', `d.querySelector('[data-testid="unscoped-state"]')`, 'no selected host session');
    check('status:no-session-has-no-roster-or-picker', await guest('status', `return !d.querySelector('[data-testid="subagent-activity"],[data-testid="status-plan-selector"]')`));
    await capture('status-no-session', 'no session; no roster');
  }
  check('status:no-map-or-search-ui', await guest('status', `return !d.querySelector('[data-testid="map-region"],[data-testid="map-announcer"],[data-testid="search-form"]')`));
  check('status:no-map-or-search-traffic', await evaluate<boolean>(`!qa.requests.some(r=>r.frame==='status'&&['/v1/plan-graph','/v1/search','/v1/search-state'].includes(r.path))`));
  check('status:no-proxy-errors', (await evaluate<string[]>('qa.errors')).length === 0);
  const hashes = Object.fromEntries(['panel', 'page', 'status'].map(s => [`ui/${s}/main.js`, createHash('sha256').update(readFileSync(join(q.root, `ui/${s}/main.js`))).digest('hex')]));
  writeFileSync(join(q.artifacts, 'density.json'), JSON.stringify({ label: q.label, slice: 'status', measurements: density, note: 'Whole guest line-box union, not viewport clipping; host Project chrome excluded. Before records measurements without new-target assertions.' }, null, 2) + '\n');
  writeFileSync(join(q.artifacts, 'screenshots.json'), JSON.stringify({ label: q.label, hashes, screenshots }, null, 2) + '\n');
}
