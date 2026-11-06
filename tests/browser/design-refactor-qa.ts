import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { primitiveQa } from './design-primitives-qa.ts';
import { designD8Qa } from './design-d8-qa.ts';
import { designBoardLifetimeQa } from './design-board-lifetime-qa.ts';
import { designBoardQa } from './design-board-qa.ts';
import { designBoardReviewQa, type BoardReviewCheck } from './design-board-review-qa.ts';

/** Uses the existing driver's isolated browser, real input and cleanup ownership. */
export async function designRefactorQa(q: {
  artifacts: string; root: string; label: string; slice: string;
  setCapture?: (enabled: boolean) => void;
  cleanupElsewhere?: (action: 'archive' | 'restore' | 'delete', plan: string) => Promise<void>;
  seedDesignFailed?: () => void;
  seedDesignRegroup?: (outcome: 'finished' | 'cancelled') => string;
  seedDesignKeyboardRegroup?: (outcome: 'finished' | 'cancelled') => { plan: string; source: string; foreignSource: string };
  finishDesignRegroup?: (plan: string, outcome: 'finished' | 'cancelled') => void;
  reviewCheck?: BoardReviewCheck;
  lifetimeOnly?: boolean;
  guest: <T = any>(f: string, code: string) => Promise<T>;
  evaluate: <T = any>(code: string) => Promise<T>;
  wait: (f: string, condition: string, what?: string) => Promise<unknown>;
  show: (surfaces: string[], width: number) => Promise<void>;
  click: (f: string, selector: string) => Promise<void>;
  theme: (mode: 'light' | 'dark') => Promise<void>;
  shot: (name: string, selector?: string, pad?: number, height?: number, surface?: string) => Promise<void>;
  check: (id: string, pass: boolean, facts?: string[]) => void;
  key: (key: string, times?: number, modifiers?: number) => Promise<void>;
  c: { send: (method: string, params?: object) => Promise<any> };
}) {
  const { guest, evaluate, wait, show, click, theme, shot, check } = q;
  const inventory: object[] = [], density: object[] = [];
  if (q.reviewCheck) { await designBoardReviewQa(q, q.reviewCheck); return; }
  if (q.lifetimeOnly) { await designBoardLifetimeQa(q); return; }
  if (q.label === 'after' && q.slice === 'rail') await designD8Qa(q);
  await show(['page'], 1100);
  await wait('page', `d.querySelector('[data-testid="plan-row-P-calm"][data-source="source-design"]')`);
  await click('page', '[data-testid="plan-row-P-calm"][data-source="source-design"]');
  for (const surface of ['page', 'panel']) {
    const width = surface === 'page' ? 1100 : 360;
    await show([surface], width);
    if (surface === 'panel') {
      await wait(surface, `d.querySelector('[data-testid="plan-selector"] button')`);
      await click(surface, '[data-testid="plan-selector"] button');
      await wait(surface, `d.querySelector('[role="option"][id$="source-design/P-calm"]')`);
      await click(surface, '[role="option"][id$="source-design/P-calm"]');
    }
    if ((q.label === 'after' && q.slice === 'rail') || q.slice === 'board') {
      await wait(surface, `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`, 'automatic edge-bearing Map');
      check(`d8:${surface}:initial-map`, await guest(surface, `return Number(d.querySelector('[data-testid="map-region"]').dataset.edges)>0`));
      await shot(`F8-${surface}-${width}-initial-map`, '[data-testid="progress-root"]', 0, 2500, surface);
      await click(surface, surface === 'page' ? '[data-testid="detail-tabs"] [data-id="progress"]' : '[data-testid="plan-view-list"] button');
    }
    await wait(surface, `d.querySelector('[data-testid="plan-P-calm"][data-source="source-design"]') && d.querySelector('.ap-tasks[data-complete]')`, 'complete F8 progress');
    await wait(surface, `d.querySelector('[data-testid="subagent-activity"]')&&!/Loading older history/.test(d.querySelector('[data-testid="subagent-activity"]').textContent)`, 'settled F8 roster history');
    check(`design:${surface}:eight-canonical-tasks`, await guest(surface, `return d.querySelectorAll('[data-testid="plan-P-calm"] li[data-testid^="item-"]').length===8`));
    for (const mode of ['light', 'dark'] as const) {
      await theme(mode);
      for (const view of ['list', 'map']) {
        if (view === 'map') {
          await click(surface, surface === 'page' ? '[data-testid="detail-tabs"] [data-id="map"]' : '[data-testid="plan-view-map"] button');
          await wait(surface, `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`, 'current F8 Map');
        } else if (mode === 'dark') {
          await click(surface, surface === 'page' ? '[data-testid="detail-tabs"] [data-id="progress"]' : '[data-testid="plan-view-list"] button');
          await wait(surface, `d.querySelector('.ap-tasks[data-complete]')`);
        }
        const selector = surface === 'page' ? '[data-testid="plan-detail"]' : '[data-testid="progress-root"]';
        const name = `F8-${surface}-${width}-${mode}-${view}`;
        // A full-region clip cannot recover content clipped by its iframe viewport. Expand only
        // that synthetic viewport before capture; never present blank/clipped tails as evidence.
        await evaluate(`(()=>{const f=frame('${surface}'),d=f.contentDocument;f.style.height=Math.max(1500,Math.ceil(d.documentElement.scrollHeight))+'px';return true})()`);
        const metrics = await guest(surface, `const root=d.querySelector('${selector}');const visible=n=>{if(n.closest('[hidden],.ap-sr,.sr-only,[aria-hidden="true"]'))return false;for(let p=n;p&&root.contains(p);p=p.parentElement){if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope > summary')?.contains(n))return false;const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')return false}return n.getClientRects().length>0};const walker=d.createTreeWalker(root,NodeFilter.SHOW_TEXT);const lines=new Set();let n;while(n=walker.nextNode()){if(!n.textContent.trim()||!visible(n.parentElement))continue;const range=d.createRange();range.selectNodeContents(n);for(const r of range.getClientRects())if(r.width&&r.height)lines.add(Math.round(r.top)+':'+Math.round(r.bottom))}return {textLines:lines.size,controls:[...root.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex="0"]')].filter(visible).length,chrome:[...d.querySelectorAll('[data-testid="plan-selector"] button,[data-testid="plan-actions"] button,[data-testid="plan-view-list"] button,[data-testid="plan-view-map"] button,[data-testid="progress-chips"] button')].filter(visible).length,height:root.getBoundingClientRect().height,overflow:d.documentElement.scrollWidth>w.innerWidth+1}`);
        check(`design:${name}:no-horizontal-overflow`, !metrics.overflow);
        density.push({ fixture: 'F8', surface, width, theme: mode, view, ...metrics });
        if (q.label === 'after' && q.slice === 'rail' && view === 'list') {
          const baselineFile = join(q.artifacts, '..', 'before', 'density.json');
          if (!existsSync(baselineFile)) throw Error('S2 density requires corrected before metrics from the same capture mode');
          const before = JSON.parse(readFileSync(baselineFile, 'utf8')).measurements.find((m: any) => m.surface === surface && m.width === width && m.theme === mode && m.view === 'list');
          check(`density:${surface}:${mode}:thirty-percent-fewer-lines`, !!before && metrics.textLines <= before.textLines * 0.7);
          if (surface === 'panel') check(`density:${surface}:${mode}:chrome-budget`, metrics.chrome <= 10);
        }
        await shot(name, selector, 0, Math.ceil(metrics.height) + 1, surface);
        inventory.push({ file: `${name}.png`, fixture: 'F8', surface, width, theme: mode, view, state: 'fresh complete, disclosures closed', selection: view === 'list' && mode === 'light' && q.slice !== 'board' && !(q.label === 'after' && q.slice === 'rail') ? 'baseline automatic' : 'explicit', height: metrics.height });
      }
    }
  }
  if (q.slice === 'board') {
    if (q.label === 'after') {
      if (!existsSync(join(q.artifacts, '..', 'before', 'density.json'))) throw Error('Board acceptance requires the sibling corrected before capture');
      await designBoardLifetimeQa(q);
    }
    const board = await designBoardQa(q);
    density.push(...board.density); inventory.push(...board.screenshots);
    if (q.label === 'after') for (const which of ['menu', 'finished', 'cancelled', 'keyboard-finished', 'keyboard-cancelled'] as const) await designBoardReviewQa(q, which);
  }
  const hashes = Object.fromEntries(['panel', 'page', 'status'].map(f => [`ui/${f}/main.js`, createHash('sha256').update(readFileSync(join(q.root, `ui/${f}/main.js`))).digest('hex')]));
  writeFileSync(join(q.artifacts, 'density.json'), JSON.stringify({ label: q.label, slice: q.slice, measurements: density, note: 'Whole-region rendered line-box union and visible controls; baseline measurement only, not target acceptance.' }, null, 2) + '\n');
  writeFileSync(join(q.artifacts, 'screenshots.json'), JSON.stringify({ label: q.label, hashes, screenshots: inventory }, null, 2) + '\n');
  check('design:no-proxy-errors', (await evaluate<string[]>('qa.errors')).length === 0);
  if (q.label === 'after') { await show(['page'], 1100); await primitiveQa(q); }
}
