// Production final-QA section for dependency-map arrow state and motion (docs/ui.md, Dependency map ›
// Arrows). Real guests in the synthetic shell, real keyboard/pointer input and labelled fixture seams
// (capture, failed list read, held graph, visibility). Called from dependency-map-final-qa.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';
import type { Driver } from './dependency-map-final-qa.ts';
import { ARROW_SMALL, ARROW_SMALL_CUES, arrowEdges, arrowFlows, arrowMid, seedArrowPlan } from '../fixtures/dependency-map-arrows.ts';

export interface ArrowQaHelpers {
  pickBoard: (id?: string, source?: string) => Promise<void>;
  pickRail: (label?: string) => Promise<void>;
  open: (s: string) => Promise<void>;
  list: (s: string) => Promise<unknown>;
  select: (s: string, id: string) => Promise<void>;
  activate: (s: string, id: string) => Promise<void>;
  polls: (s: string) => Promise<number>;
  observeSpeech: (s: string) => Promise<unknown>;
  speech: (s: string) => Promise<string[]>;
  coords: (s: string) => Promise<unknown>;
  overflow: (s: string) => Promise<boolean>;
}

const REGION = '[data-testid="map-region"]';
const SMALL = 'Arrow state small plan', MID = 'Arrow reference plan';

export async function arrowMotionQa(d: Driver, h: ArrowQaHelpers) {
  const { guest, evaluate, wait, key, frames2, check, c } = d;
  const fx = d.fx as Driver['fx'] & { reportMap: (plan: string, request: Record<string, unknown>) => void; setCapture: (on: boolean) => void };
  const report = (plan: string, request: Record<string, unknown>) => fx.reportMap(plan, request);
  const facts: Record<string, unknown> = {}; d.facts.arrowMotion = facts;
  const frames = join(d.artifacts, 'motion-flow-frames'); mkdirSync(frames, { recursive: true });
  const media = async (o: { reduce?: boolean; forced?: boolean } = {}) => { await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: o.reduce ? 'reduce' : 'no-preference' }, { name: 'forced-colors', value: o.forced ? 'active' : 'none' }] }); await frames2(); };

  // Seed through the production write path (labelled fixture seam: another client's reports).
  seedArrowPlan(report, 'P-arrows', SMALL, ARROW_SMALL);
  seedArrowPlan(report, 'P-arrows-mid', MID, arrowMid());
  seedArrowPlan(report, 'P-arrows-f24', 'Arrow flows at limit', arrowFlows(24));
  seedArrowPlan(report, 'P-arrows-f25', 'Arrow flows over limit', arrowFlows(25));
  seedArrowPlan(report, 'P-arrows-e300', 'Arrow count at limit', arrowEdges(300));
  seedArrowPlan(report, 'P-arrows-e301', 'Arrow count over limit', arrowEdges(301));
  seedArrowPlan(report, 'P-arrows-closed', 'Arrow state cancelled plan', ARROW_SMALL);
  report('P-arrows-closed', { op: 'finish', outcome: 'cancelled' });
  await media();

  /** Facts of the painted map: gate, fallback reason, counts, cues and running animations. */
  const state = (s: string) => guest<any>(s, `const r=d.querySelector('${REGION}');if(!r)return null;const anims=r.getAnimations({subtree:true});return {
    state:r.dataset.state,current:r.dataset.current,motion:r.dataset.motion??null,fallback:r.dataset.motionFallback??null,flows:Number(r.dataset.flows??0),edges:Number(r.dataset.edges),
    paths:r.querySelectorAll('path[data-from][data-to]').length,cues:Object.fromEntries([...r.querySelectorAll('path[data-from][data-to]')].map(p=>[p.dataset.from+'>'+p.dataset.to,p.dataset.arrow??''])),
    beads:[...r.querySelectorAll('.ap-map-bead')].map(b=>b.dataset.flowFrom+'>'+b.dataset.flowTo).sort(),moving:[...r.querySelectorAll('.ap-map-flows .ap-map-bead')].map(b=>b.dataset.flowFrom+'>'+b.dataset.flowTo).sort(),
    running:anims.filter(a=>a.playState==='running').length,animations:anims.length,names:[...new Set(anims.map(a=>a.animationName))],
    phase:anims.every(a=>a.startTime===0&&a.effect.getTiming().duration===2400&&a.effect.getTiming().easing==='linear'&&a.effect.getTiming().iterations===Infinity),
    targets:anims.every(a=>a.effect.target?.matches?.('.ap-map-flows .ap-map-bead')),
    zoom:parseFloat(d.querySelector('[data-testid="map-zoom-level"]')?.textContent??'0')}`);
  const names = (s: string) => guest<string>(s, `return JSON.stringify([...d.querySelectorAll('${REGION} .ap-map-card')].map(n=>n.getAttribute('aria-label')))`);
  const wait4 = (s: string, cond: string, what: string) => wait(s, `(()=>{const r=d.querySelector('${REGION}');return !!r&&(${cond})})()`, what);
  const moving = (s: string, n?: number) => wait4(s, `r.dataset.motion==='on'&&r.getAnimations({subtree:true}).length${n === undefined ? '>0' : `===${n}`}`, `arrow motion${n === undefined ? '' : ` (${n})`}`);
  // Zero map animations. (Reduced motion keeps the region's gate attribute, like the list's: the
  // global stylesheet rule removes the animation itself.)
  const still = (s: string) => wait4(s, `r.getAnimations({subtree:true}).length===0`, 'no arrow motion');
  const wide = async (on: boolean) => {
    await evaluate(on ? `Object.assign(document.querySelector('section[data-frame=page]').style,{width:'1920px',flex:'none'});frame('page').style.height='1080px';true` : `Object.assign(document.querySelector('section[data-frame=page]').style,{width:'1100px',flex:''});frame('page').style.height='850px';true`);
    await wait('page', `w.innerWidth===${on ? 1920 : 1100}`, 'board width'); await frames2();
  };
  const sequence = async (prefix: string, s: string) => {
    // One 2.4 s cycle in 12 deterministic frames (animations paused at each time), then resume on phase.
    for (let i = 0; i < 12; i++) {
      await guest(s, `for(const a of d.querySelector('${REGION}').getAnimations({subtree:true})){a.pause();a.currentTime=${200 * i}}return true`); await frames2();
      await d.shot(`motion-flow-frames/${prefix}-${String(i).padStart(2, '0')}`, '[data-testid="map-viewport"]', 0, 1100, s);
    }
    await guest(s, `for(const a of d.querySelector('${REGION}').getAnimations({subtree:true})){a.play();a.startTime=0}return true`);
  };

  // ── Board: state table, beads/bar, permitted motion on the shared phase
  await h.list('page'); await h.pickBoard('P-arrows'); await h.open('page'); await moving('page');
  let st = await state('page');
  facts.small = st;
  const sorted = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  check('arrows:board:state-table', sorted(st.cues) === sorted(ARROW_SMALL_CUES), undefined, st.cues);
  check('arrows:board:canonical-edges-not-doubled', st.paths === st.edges && st.edges === 16 && JSON.stringify(st.beads) === JSON.stringify(['T4>K', 'T4>T10', 'T4>T8']), undefined, st);
  check('arrows:board:flow-runs-on-shared-phase', st.motion === 'on' && st.flows === 3 && st.running === 3 && st.phase && st.targets && JSON.stringify(st.names) === '["ap-map-flow"]', undefined, st);
  const offsets = await guest<string[]>('page', `const b=d.querySelector('.ap-map-flows .ap-map-bead');const a=getComputedStyle(b).strokeDashoffset;return new Promise(r=>setTimeout(()=>r([a,getComputedStyle(b).strokeDashoffset]),300))`);
  check('arrows:board:dash-offset-changes', offsets[0] !== offsets[1], undefined, offsets);
  check('arrows:board:blocked-static-with-stop-bar', await guest('page', `const ps=[...d.querySelectorAll('path[data-arrow="blocked"]')];return ps.length===2&&ps.every(p=>p.getAnimations().length===0&&d.querySelector(p.getAttribute('marker-end').slice(4,-1)+' .ap-map-stopbar'))&&!d.querySelector('path[data-arrow="working"] ~ .ap-map-stopbar')`));
  check('arrows:board:decorative-and-non-intercepting', await guest('page', `const layers=[...d.querySelectorAll('${REGION} svg.ap-map-edges')];return layers.length===2&&layers.every(s=>s.getAttribute('aria-hidden')==='true'&&s.getAttribute('focusable')==='false'&&getComputedStyle(s).pointerEvents==='none')&&[...d.querySelectorAll('.ap-map-bead')].every(b=>getComputedStyle(b).pointerEvents==='none'&&!b.hasAttribute('data-from'))`));
  check('arrows:board:help-arrow-key', await guest('page', `const t=d.querySelector('[data-testid="map-arrow-key"]')?.textContent??'';return /Blue beads/.test(t)&&/not progress/.test(t)&&!/\\brunning\\b/i.test(t)&&/bar before the arrowhead/.test(t)&&/Dashed/.test(t)&&/Faint/.test(t)&&!!d.querySelector('[data-testid="map-arrow-key"]').closest('[data-testid="map-help"]')`));
  // Waiting inspector line (T8) and the skipped warning alongside it (K).
  await h.select('page', 'T8');
  check('arrows:inspector:waiting-counts', await guest('page', `return [...d.querySelectorAll('[data-testid="map-inspector"] .ap-note')].some(n=>n.textContent==='Waiting on 3 unfinished recorded prerequisites: 1 reported working, 1 explicitly blocked.')`));
  // Selection: chain beads may move, chain bar stays, off-chain beads are stationary and fade.
  st = await state('page'); facts.selected = st;
  check('arrows:selection:chain-moves-off-chain-still', st.motion === 'on' && JSON.stringify(st.moving) === '["T4>T8"]' && st.running === 1 && st.phase && await guest('page', `const off=[...d.querySelectorAll('.ap-map-edges:not(.ap-map-flows) .ap-map-bead')];return off.length===2&&off.every(b=>!b.dataset.chain&&getComputedStyle(b).opacity==='0.3'&&b.getAnimations().length===0)&&d.querySelector('path[data-from="T5"][data-to="T8"]').dataset.path==='upstream'&&d.querySelector('path[data-from="T5"][data-to="T8"]').getAttribute('marker-end').includes('blocked-path')`), undefined, st);
  await h.select('page', 'K');
  check('arrows:inspector:skipped-warning-kept', await guest('page', `return [...d.querySelectorAll('[data-testid="map-inspector"] .ap-note')].some(n=>n.textContent.startsWith('Waiting: a recorded prerequisite was skipped (Optional benchmark)')&&n.textContent.endsWith('Its unfinished recorded prerequisites include 1 reported working.'))`));
  const beforeClear = await h.coords('page');
  await guest('page', `d.querySelector('[data-testid="map-card-K"]').focus();return true`); await key('Escape'); await frames2();
  await moving('page', 3); st = await state('page');
  check('arrows:selection:clear-restores-motion-same-geometry', st.phase && st.running === 3 && JSON.stringify(beforeClear) === JSON.stringify(await h.coords('page')), undefined, st);
  // Repaint (status refresh): a new bead node, still on the document phase; no restart.
  await guest('page', `w.__bead=d.querySelector('.ap-map-flows .ap-map-bead');return true`);
  const rev = Number(await guest('page', `return d.querySelector('${REGION}').dataset.revision`));
  report('P-arrows', { op: 'change', changes: [{ id: 'T11', status: 'skipped' }] });
  await wait4('page', `r.dataset.revision==='${rev + 1}'&&r.dataset.current==='true'&&r.dataset.motion==='on'`, 'status refresh repaint'); st = await state('page');
  check('arrows:repaint-keeps-shared-phase', st.phase && st.running === 3 && await guest('page', `return w.__bead!==d.querySelector('.ap-map-flows .ap-map-bead')`), undefined, st);
  // Motion is silent and leaves names alone.
  await h.observeSpeech('page'); const namesMoving = await names('page');
  await media({ reduce: true }); await still('page'); st = await state('page');
  check('arrows:reduced-motion-stationary-cues', st.animations === 0 && st.beads.length === 3 && Object.values(st.cues).filter(v => v === 'blocked').length === 2 && await guest('page', `return [...d.querySelectorAll('${REGION} *')].every(n=>getComputedStyle(n).animationName==='none'&&getComputedStyle(n).transitionDuration.split(',').every(t=>parseFloat(t)===0))`), undefined, st);
  check('arrows:motion-changes-names-and-speech-unchanged', namesMoving === await names('page') && !(await h.speech('page')).length);
  await media(); await moving('page', 3);

  // ── Captures: board 1920 dark, 1100 light selected, frame sequence
  await wide(true); await d.theme('dark'); await h.activate('page', 'map-fit-all'); await moving('page', 3);
  await d.shot('motion-board1920-dark', REGION, 6, 1100, 'page');
  await sequence('board1920-dark', 'page');
  await wide(false); await d.theme('light'); await h.select('page', 'T8'); await d.shot('motion-board1100-light-selected', REGION, 6, 1500, 'page');
  // Reduced motion and forced colours (with reduced motion), selected chain kept in system colours.
  await guest('page', `d.querySelector('[data-testid="map-card-T8"]').focus();return true`); await key('Escape'); await frames2();
  await wide(true); await h.activate('page', 'map-fit-all');
  await media({ reduce: true }); await d.shot('motion-reduced', '[data-testid="map-viewport"]', 0, 1100, 'page');
  await media({ reduce: true, forced: true }); await h.select('page', 'T8');
  const forced = await guest<any>('page', `const css=n=>getComputedStyle(n);const bead=d.querySelector('.ap-map-bead[data-chain]'),off=d.querySelector('.ap-map-bead:not([data-chain])'),blocked=d.querySelector('path[data-arrow="blocked"]:not([data-path])'),chainBlocked=d.querySelector('path[data-arrow="blocked"][data-path]'),skipped=d.querySelector('path[data-skipped]'),plain=d.querySelector('path[data-from="T4"][data-to="T9"]:not([data-path])');return {forced:w.matchMedia('(forced-colors: active)').matches,bead:[css(bead).stroke,css(bead).strokeLinecap,css(bead).strokeDasharray],off:css(off).stroke,blocked:[css(blocked).stroke,css(blocked).strokeWidth],chainBlocked:[css(chainBlocked).stroke,css(chainBlocked).strokeWidth],skipped:css(skipped).strokeDasharray,plain:css(plain).strokeWidth,bar:!!d.querySelector(chainBlocked.getAttribute('marker-end').slice(4,-1)+' .ap-map-stopbar'),animations:d.querySelector('${REGION}').getAnimations({subtree:true}).length}`);
  facts.forced = forced;
  check('arrows:forced-colours-shapes', forced.forced && forced.bead[1] === 'round' && /^0(px)?,? 10(px)?$/.test(forced.bead[2].replace(/\s+/g, ' ').replace(', ', ' ')) && forced.bead[0] !== forced.off && parseFloat(forced.blocked[1]) > parseFloat(forced.plain) && forced.chainBlocked[0] === forced.bead[0] && forced.bar && forced.skipped !== 'none' && forced.animations === 0, undefined, forced);
  await d.shot('motion-forced-selected', '[data-testid="map-viewport"]', 0, 1100, 'page');
  await media(); await guest('page', `d.querySelector('[data-testid="map-card-T8"]').focus();return true`); await key('Escape'); await frames2();
  await wide(false); await h.activate('page', 'map-focus-current'); await moving('page', 3);
  // 200%/400% reflow (CSS zoom of the embedding section, as the accessibility mode does).
  for (const factor of [2, 4]) {
    await evaluate(`(()=>{const n=document.querySelector('section[data-frame=page]');n.style.width='${1100 / factor}px';n.style.zoom='${factor}';frame('page').style.height='${850 / factor}px';return true})()`);
    await wait('page', `w.innerWidth===${1100 / factor}`, 'reflow width'); await frames2();
    check(`arrows:reflow-${factor * 100}:no-document-overflow`, await h.overflow('page'));
    if (factor === 2) await d.shot('motion-reflow', REGION, 6, 1500, 'page');
    await evaluate(`(()=>{const n=document.querySelector('section[data-frame=page]');n.style.zoom='1';n.style.width='1100px';frame('page').style.height='850px';return true})()`); await wait('page', 'w.innerWidth===1100'); await frames2();
  }

  // ── Freshness gates
  await fx.setCapture(false); await h.polls('page');
  await wait4('page', `r.dataset.current==='true'&&r.dataset.motion!=='on'&&r.getAnimations({subtree:true}).length===0`, 'capture off stops motion'); st = await state('page');
  check('arrows:capture-off-static-cues', st.current === 'true' && st.beads.length === 3 && Object.values(st.cues).filter(v => v).length === 5 && st.animations === 0 && await guest('page', `return !!d.querySelector('[data-testid="capture-off"]')`), undefined, st);
  await fx.setCapture(true); await h.polls('page'); await moving('page', 3); st = await state('page');
  check('arrows:capture-on-resumes-on-phase', st.phase && st.running === 3, undefined, st);
  await evaluate(`qa.fail.push({path:'/v1/plans',frame:'page',status:503});true`);
  await wait4('page', `r.dataset.state==='error'`, 'failed read'); st = await state('page');
  check('arrows:failed-read-removes-cues', st.current === 'false' && !st.beads.length && !Object.values(st.cues).some(v => v) && st.animations === 0 && await guest('page', `return d.querySelector('[data-testid="map-state"]').dataset.tone==='warning'&&d.querySelector('[data-testid="map-card-T5"]').dataset.mark==='blocked'`), undefined, st);
  await evaluate(`qa.fail=[];true`); await moving('page', 3);
  await evaluate(`qa.holds.push({tag:'arrow-graph',path:'/v1/plan-graph',frame:'page'});true`);
  report('P-arrows', { op: 'change', changes: [{ id: 'T9', status: 'done' }] });
  await wait('page', `qa.held.some(h=>h.tag==='arrow-graph')`, 'held newer graph');
  await wait4('page', `r.dataset.state==='updating'`, 'superseded picture'); st = await state('page');
  check('arrows:superseded-picture-removes-cues', st.current === 'false' && !st.beads.length && !Object.values(st.cues).some(v => v) && st.animations === 0, undefined, st);
  await evaluate(`qa.release('arrow-graph');true`); await moving('page', 3);
  // Hidden: revoked in place; on show, held revalidation cannot let the old DOM restart flow.
  await evaluate(`qa.visibility('page',false);true`); await frames2();
  check('arrows:hidden-revokes-motion', await guest('page', `const r=d.querySelector('${REGION}');return d.documentElement.hasAttribute('data-ap-hidden')&&r.dataset.motion!=='on'&&r.getAnimations({subtree:true}).length===0`));
  await evaluate(`qa.holds.push({tag:'arrow-show',path:'/v1/plan-graph',frame:'page'});qa.visibility('page',true);true`);
  await wait('page', `qa.held.some(h=>h.tag==='arrow-show')`, 'held revalidation after show'); await frames2();
  check('arrows:shown-without-revalidation-stays-still', await guest('page', `const r=d.querySelector('${REGION}');return !d.documentElement.hasAttribute('data-ap-hidden')&&r.dataset.motion!=='on'&&r.getAnimations({subtree:true}).length===0`));
  await evaluate(`qa.release('arrow-show');true`); await moving('page', 3); st = await state('page');
  check('arrows:revalidated-show-resumes-on-phase', st.phase && st.running === 3, undefined, st);
  await h.list('page'); check('arrows:left-map-no-animation', await guest('page', `return !d.querySelector('${REGION}')&&!d.getAnimations().some(a=>a.animationName==='ap-map-flow')`));
  await h.open('page'); await moving('page', 3);

  // ── Closed plan: existing static styles only
  await h.list('page'); await h.pickBoard('P-arrows-closed'); await h.open('page'); st = await state('page');
  check('arrows:closed-plan-existing-styles', !st.beads.length && !Object.values(st.cues).some(v => v) && st.animations === 0 && await guest('page', `return d.querySelector('[data-testid="map-card-T4"]').dataset.status==='working'`), undefined, st);

  // ── Cost bounds (shipped limits, docs/ui.md): at → moves, over → every bead stationary, zero animations
  const plan = async (id: string) => { await h.list('page'); await h.pickBoard(id); await h.open('page'); await frames2(); return state('page'); };
  const group = async (value: string) => { await guest('page', `const n=d.querySelector('[data-testid="map-group"]');n.value=${literal(value)};n.dispatchEvent(new Event('change',{bubbles:true}));return true`); await frames2(); };
  st = await plan('P-arrows-f24'); facts.flowsAt = st;
  check('arrows:bound:flows-at-limit-moves', st.motion === 'on' && st.flows === 24 && st.running === 24 && st.phase, undefined, st);
  st = await plan('P-arrows-f25'); facts.flowsOver = st;
  check('arrows:bound:flows-over-limit-all-still', st.motion === null && st.fallback === 'flows' && st.flows === 25 && st.beads.length === 25 && st.animations === 0, undefined, st);
  await group('GA'); st = await state('page');
  check('arrows:bound:filter-back-within-flows-resumes', st.motion === 'on' && st.flows === 13 && st.running === 13 && st.phase, undefined, st);
  await group('*'); await h.select('page', 'P0'); st = await state('page');
  check('arrows:bound:selection-chain-within-flows-resumes', st.motion === 'on' && st.flows === 1 && st.running === 1, undefined, st);
  await guest('page', `d.querySelector('[data-testid="map-card-P0"]').focus();return true`); await key('Escape'); await frames2(); await still('page');
  st = await plan('P-arrows-e300'); facts.arrowsAt = st;
  check('arrows:bound:arrows-at-limit-moves', st.motion === 'on' && st.edges === 300 && st.running === 1, undefined, st);
  st = await plan('P-arrows-e301'); facts.arrowsOver = st;
  check('arrows:bound:arrows-over-limit-still', st.motion === null && st.fallback === 'arrows' && st.edges === 301 && st.beads.length === 1 && st.animations === 0, undefined, st);
  await group('GW'); st = await state('page');
  check('arrows:bound:filter-cannot-bypass-arrow-ceiling', st.fallback === 'arrows' && st.animations === 0 && st.paths === 1, undefined, st);
  await group('*');
  // Zoom: below the minimum stops everything; back above resumes on the phase without new reads.
  await plan('P-arrows'); await moving('page', 3);
  const reads = () => evaluate<number>(`qa.requests.filter(r=>r.frame==='page'&&['/v1/plan','/v1/plan-graph'].includes(r.path)).length`);
  const before = await reads(); const zooms: number[] = [];
  for (let i = 0; i < 8 && (await state('page')).zoom >= 50; i++) { await h.activate('page', 'map-zoom-out'); zooms.push((await state('page')).zoom); }
  st = await state('page'); facts.zoomOut = { zooms, st };
  check('arrows:bound:zoom-below-minimum-still', st.zoom < 50 && st.fallback === 'zoom' && st.motion === null && st.animations === 0 && st.beads.length === 3, undefined, { zooms, st });
  await h.activate('page', 'map-zoom-in'); await moving('page', 3); st = await state('page');
  check('arrows:bound:zoom-back-resumes-without-reads', st.zoom >= 50 && st.phase && await reads() === before, undefined, { st, reads: [before, await reads()] });
  // Reference mid-size plan (100 tasks, 180 arrows, 12 flows) animates at a readable zoom.
  st = await plan('P-arrows-mid'); facts.midBoard = st;
  check('arrows:reference-mid-board-moves', st.motion === 'on' && st.edges === 180 && st.flows === 12 && st.running === 12 && st.zoom >= 50, undefined, st);
  if (st.zoom > 75) { for (let i = 0; i < 3 && (await state('page')).zoom > 75; i++) await h.activate('page', 'map-zoom-out'); st = await state('page'); facts.midBoardZoomed = st; check('arrows:reference-mid-board-moves-near-75', st.motion === 'on' && st.running === 12 && st.zoom >= 50, undefined, st); }

  // ── Rail: the same renderer and gates in its own frame
  await d.show(['panel'], 360); await evaluate(`qa.visibility('panel',true);frame('panel').style.height='850px';true`);
  await h.list('panel'); await h.pickRail(SMALL); await h.open('panel'); await moving('panel', 3); st = await state('panel'); facts.rail = st;
  check('arrows:rail:same-state-and-motion', JSON.stringify(st.beads) === JSON.stringify(['T4>K', 'T4>T10', 'T4>T8']) && st.running === 3 && st.phase, undefined, st);
  await d.theme('dark'); await d.shot('motion-rail360-dark', REGION, 6, 1500, 'panel');
  await sequence('rail360-dark', 'panel');
  await d.show(['panel'], 600); await d.theme('light'); await h.select('panel', 'T8'); await d.shot('motion-rail600-light-selected', REGION, 6, 1700, 'panel');
  await guest('panel', `d.querySelector('[data-testid="map-card-T8"]').focus();return true`); await key('Escape'); await frames2();
  await h.list('panel'); await h.pickRail(MID); await h.open('panel'); st = await state('panel'); facts.midRail = st;
  check('arrows:reference-mid-rail-moves', st.motion === 'on' && st.flows === 12 && st.running === 12 && st.zoom >= 50, undefined, st);
  await h.list('panel'); await d.show(['page', 'panel', 'status'], 600);
  await evaluate(`document.querySelector('section[data-frame=page]').style.width='1100px';for(const f of ['page','panel'])frame(f).style.height='850px';true`);
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}
