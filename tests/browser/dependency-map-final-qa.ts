// Final production checks use the existing CDP shell, never a replacement guest or controller API.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { startSearchShell } from './plan-task-search-shell.ts';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';
import { mapItems } from '../fixtures/dependency-map.ts';

type Fixture = Awaited<ReturnType<typeof startSearchShell>>;
export interface Driver {
  mode: 'final' | 'accessibility' | 'large' | 'owner'; artifacts: string; ownerSmoke?: boolean;
  c: { send: (method: string, params?: object) => Promise<any> };
  evaluate: <T = any>(code: string) => Promise<T>;
  guest: <T = any>(surface: string, code: string) => Promise<T>;
  wait: (surface: string, condition: string, label?: string, ms?: number) => Promise<number>;
  key: (key: string, times?: number, modifiers?: number) => Promise<void>;
  click: (surface: string, selector: string) => Promise<void>;
  show: (surfaces: string[], width: number) => Promise<void>;
  shot: (name: string, selector?: string, pad?: number, height?: number, surface?: string) => Promise<void>;
  frames2: () => Promise<any>; theme: (mode: 'light' | 'dark') => Promise<void>;
  check: (id: string, pass: boolean, facts?: string[], diagnostic?: unknown) => void;
  count: (path: string, surface?: string) => Promise<number>;
  fx: Fixture; restart: () => Promise<Fixture>; facts: Record<string, unknown>; perf: Record<string, unknown>;
  pageErrors: () => string[];
}
const hook = (id: string) => `[data-testid="${id}"]`;
const region = hook('map-region'), viewport = hook('map-viewport'), inspector = hook('map-inspector');
const stat = (xs: number[]) => ({ samples: xs, median: [...xs].sort((a,b)=>a-b)[1] });
export async function productionMapQa(d: Driver) {
  const { guest, evaluate, wait, key, click, frames2, check, c } = d;
  let fx = d.fx;
  const button = (s: string, id: string) => guest<string>(s, `const n=d.querySelector(${literal(hook(id))});return n?.matches('button')?${literal(hook(id))}:${literal(hook(id)+' button')}`);
  const activate = async (s: string, id: string) => { const selector = await button(s,id); await guest(s, `d.querySelector(${literal(selector)}).focus();return true`); await key('Enter'); await frames2(); };
  const selected = (s: string) => guest<string>(s, `return d.querySelector('${inspector}')?.dataset.selected??''`);
  const ready = (s: string, rev?: number) => wait(s, `d.querySelector('${region}')?.dataset.current==='true'${rev ? `&&d.querySelector('${region}').dataset.revision==='${rev}'` : ''}&&d.querySelector('${viewport}')`, 'production paired map');
  const expose = (s: string) => evaluate(`document.querySelector('section[data-frame=${s}]').style.display='block';qa.visibility('${s}',true);true`);
  const reload = async (s: string) => { const seq=await evaluate<number>(`qa.reload('${s}')`);await wait(s,`qa.loaded['${s}']===${seq}`,'guest navigation completed'); };
  const open = async (s: string) => {
    await expose(s);
    if (s === 'page') { await wait(s, `d.querySelector('[data-testid="detail-tabs"] [data-id="map"]')`, 'Map tab'); await click(s, '[data-testid="detail-tabs"] [data-id="map"]'); }
    else { await wait(s, `d.querySelector('${hook('plan-view-map')} button')`, 'Map switch'); await activate(s,'plan-view-map'); }
    await ready(s);
  };
  const list = async (s: string) => { await expose(s); return s === 'page' ? click(s, '[data-testid="detail-tabs"] [data-id="progress"]') : activate(s,'plan-view-list'); };
  const pickBoard = async (id = 'P-map', source = 'source-alpha') => {
    await expose('page');
    await wait('page', `d.querySelector('[data-testid="plan-row-${id}"][data-source="${source}"]')`, 'board plan');
    // Use the listbox's own active-option navigation. Directly focusing a -1 row is not the
    // listbox keyboard contract; it would leave the SDK's active option on the previous plan.
    const index=await guest<number>('page', `const row=d.querySelector('[data-testid="plan-row-${id}"][data-source="${source}"]'),box=row.closest('[role="listbox"]');box.focus();return [...box.querySelectorAll('[role="option"]')].indexOf(row)`);
    await key('Home');if(index)await key('ArrowDown',index);await key('Enter');
    await wait('page', `d.querySelector('[data-testid="plan-row-${id}"][data-source="${source}"]')?.getAttribute('aria-selected')==='true'`, 'board selection settled');
    await frames2();
  };
  const pickRail = async (label = 'Dependency map fixture') => {
    await wait('panel', `d.querySelector('${hook('plan-selector')} .oc-sdk-trigger')`, 'rail picker');
    await click('panel', `${hook('plan-selector')} .oc-sdk-trigger`);
    const options = await guest<string[]>('panel', `return [...d.querySelectorAll('.oc-sdk-option-label')].map(n=>n.textContent)`);
    const i = options.indexOf(label); if (i < 0) throw Error(`Missing rail choice ${label}`);
    await key('Home'); if (i) await key('ArrowDown',i); await key('Enter'); await frames2();
  };
  const boardChoice = async (id: string, index: number) => {
    await click('page',`${hook(id)} .oc-sdk-trigger`);await wait('page',`d.querySelector('.oc-sdk-popup [role=option]')`,'board scope options');
    await key('Home');if(index)await key('ArrowDown',index);await key('Enter');await frames2();
  };
  const select = async (s: string, id: string) => {
    // Focus a real native card, then send real Enter. No controller dispatch/debug hooks.
    await guest(s, `d.querySelector(${literal(hook('map-card-'+id))}).focus();return true`); await key('Enter');
    await wait(s, `d.querySelector('${inspector}')?.dataset.selected===${literal(id)}`, 'selected card'); await frames2();
  };
  const positions = (s: string) => guest<Record<string, string>>(s, `return Object.fromEntries([...d.querySelectorAll('[data-task]')].map(n=>[n.dataset.task,JSON.stringify([n.dataset.x,n.dataset.y])]))`);
  const screen = (s: string) => guest<Record<string, number[]>>(s, `return Object.fromEntries([...d.querySelectorAll('[data-task]')].map(n=>{const r=n.getBoundingClientRect();return[n.dataset.task,[r.x,r.y,r.width,r.height]]}))`);
  const inView = (s: string, id: string) => guest<boolean>(s, `const n=d.querySelector(${literal(hook('map-card-'+id))}),a=n?.getBoundingClientRect(),b=d.querySelector('${viewport}')?.getBoundingClientRect();return !!a&&!!b&&n.tabIndex===0&&a.left>=b.left+8&&a.top>=b.top+8&&a.right<=b.right-8&&a.bottom<=b.bottom-8`);
  const coords = (s: string) => guest(s, `const n=d.querySelector('${hook('map-world')}');return n?.getAttribute('style')`);
  const polls = async (s: string) => { const mark = await evaluate('qa.replies.length'); await wait(s, `qa.replies.slice(${mark}).filter(r=>r.frame==='${s}'&&r.path==='/v1/plans'&&r.status===200).length>=2`, 'two completed ordinary polls'); return mark; };
  const save = (name: string, value: unknown) => writeFileSync(join(d.artifacts,name), JSON.stringify(value,null,2)+'\n');
  const photo = (name: string, s: string) => d.shot(name, hook('progress-root'), 0, 1500, s);
  const setup = async () => {
    await d.show(['page','panel','status'], 600);
    await evaluate(`document.querySelector('section[data-frame=page]').style.width='1100px';for(const f of ['page','panel'])frame(f).style.height='850px';qa.context('M');true`);
    if(process.argv.includes('--orca-automated')){
      // Fixture preparation, before Orca starts. Native AT-SPI startup causes extra paints;
      // choose the synthetic plans atomically through their existing UI callbacks, not a
      // keyboard sequence that could span one of those initial root replacements.
      await wait('page',`d.querySelector('[data-testid="plan-row-P-map"][data-source="source-alpha"]')`);
      await guest('page',`d.querySelector('[data-testid="plan-row-P-map"][data-source="source-alpha"]').click();return true`);
      await wait('panel',`d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger')`);
      await guest('panel',`d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger').click();return true`);
      await wait('panel',`[...d.querySelectorAll('.oc-sdk-option-label')].some(n=>n.textContent==='Dependency map fixture')`);
      await guest('panel',`[...d.querySelectorAll('.oc-sdk-option-label')].find(n=>n.textContent==='Dependency map fixture').closest('[role="option"]').click();return true`);
    }else{await pickBoard(); await pickRail();}
    await wait('panel', `d.querySelector('article[data-source="source-alpha"][data-testid="plan-P-map"]')`, 'selected rail list');
  };
  const observeSpeech = async (s: string) => guest(s, `w.__announcer=d.querySelector('${hook('map-announcer')}');w.__speech=[];w.__speechObserver?.disconnect();w.__speechObserver=new MutationObserver(()=>{const t=w.__announcer.textContent;if(t)w.__speech.push(t)});w.__speechObserver.observe(w.__announcer,{childList:true,subtree:true,characterData:true});return true`);
  const speech = (s: string) => guest<string[]>(s,'return w.__speech');
  const overflow = (s: string) => guest<boolean>(s,'return d.documentElement.scrollWidth<=w.innerWidth+1');

  if (d.mode === 'owner') {
    await setup();
    await evaluate(`for(const [f,label] of [['page','Board — synthetic P-map'],['panel','Right rail — synthetic P-map']]){frame(f).title=label;document.querySelector('section[data-frame='+f+'] h1').textContent=label}document.querySelector('section[data-frame=status]').style.display='none';true`);
    await evaluate(`const box=document.createElement('aside');box.id='fixture-controls';box.innerHTML='<h2>Synthetic owner fixture — P-map</h2><p>Board (page) and right rail (panel). Result remains PENDING owner. Agent controls only:</p><button data-step="status">Status checkpoint</button> <button data-step="structure">Structural checkpoint</button> <button id="narrow">Rail 360 px</button>';box.addEventListener('click',e=>{const step=e.target.dataset.step;if(step)fetch('/fixture-step',{method:'POST',body:JSON.stringify({step})});if(e.target.id==='narrow')document.querySelector('section[data-frame=panel]').style.width='360px'});document.body.prepend(box);true`);
    d.facts.ownerResult = 'PENDING owner; fixture readiness is not a speech pass';
    save('setup.json',{ production:true, plan:'P-map', result:'PENDING owner', bundles:d.facts.bundles });
    console.log('Synthetic P-map board and rail ready. Owner result PENDING. Ctrl+C terminates and cleans up.');
    if (process.argv.includes('--orca-automated')) {
      await evaluate(`document.querySelector('#fixture-controls p').textContent='Board (page) and right rail (panel). Automated Orca speech-text verification; not human-listener acceptance.';true`);
      d.facts.ownerResult = 'Automated Orca speech-text verification, accepted without owner review by owner decision; see outcome.json';
      save('setup.json',{production:true,plan:'P-map',result:'Automated Orca run; see outcome.json',humanListenerAcceptance:false,bundles:d.facts.bundles});
      await (await import('./dependency-map-orca-steps.ts')).orcaAcceptance(d);
      return;
    }
    if (d.ownerSmoke) {
      for (const step of ['status','structure'])check(`owner:fixture-${step}-control`,await evaluate(`(async()=>{const r=await fetch('/fixture-step',{method:'POST',body:JSON.stringify({step:'${step}'})});return r.ok})()`));
    }
    if (!d.ownerSmoke) await new Promise<void>(resolve => { const stop = () => { process.off('SIGINT',stop); process.off('SIGTERM',stop); resolve(); }; process.on('SIGINT',stop); process.on('SIGTERM',stop); });
    check('owner:fixture-prepared-not-screen-reader-pass',true);
    return;
  }

  if (d.mode === 'large') {
    await c.send('Performance.enable');
    const cpu = async () => { const { metrics } = await c.send('Performance.getMetrics'); return Object.fromEntries(metrics.filter((m:any)=>['LayoutDuration','RecalcStyleDuration','ScriptDuration'].includes(m.name)).map((m:any)=>[m.name,m.value*1000])) as Record<string,number>; };
    const difference = (a:Record<string,number>, b:Record<string,number>) => Object.fromEntries(Object.keys(a).map(k=>[k,b[k]-a[k]]));
    const variants: Record<string, unknown> = {}; d.perf.variants = variants;
    for (const [index,[s,width]] of ([['page',1100],['panel',360],['panel',600]] as const).entries()) {
      if (index) fx = await d.restart();
      const name = `${s}-${width}`; mkdirSync(join(d.artifacts,name),{recursive:true});
      await d.show([s],width); await evaluate(`for(const f of ['page','panel','status']){qa.visibility(f,f==='${s}');frame(f).style.height='850px'};true`);
      const loadTimes: number[] = [], streams: unknown[] = [], cpuSamples: unknown[] = [];
      for (let i=0;i<4;i++) {
        const mark=await evaluate<number>('qa.replies.length'), cpuBefore=await cpu(), start=performance.now();
        await reload(s);
        if (s==='page') { await wait(s,`d.querySelector('[data-testid="plan-row-P-large-dependencies"]')`,'large board'); await click(s,'[data-testid="plan-row-P-large-dependencies"]'); }
        await open(s); await frames2();
        const elapsed=performance.now()-start;
        if(i){loadTimes.push(elapsed);cpuSamples.push({action:'load',...difference(cpuBefore,await cpu())});streams.push(await evaluate(`qa.replies.slice(${mark}).filter(r=>r.frame==='${s}')`));}
      }
      const load=stat(loadTimes); check(`${name}:load-budget`,load.median<=2000,undefined,load);
      const actions: Record<string,unknown>={};
      const action=async(label:string,before:()=>Promise<unknown>,run:()=>Promise<unknown>)=>{
        const times:number[]=[];for(let i=0;i<4;i++){await before();await frames2();const cpuBefore=await cpu(),start=performance.now();await run();await frames2();const elapsed=performance.now()-start;if(i){times.push(elapsed);cpuSamples.push({action:label,...difference(cpuBefore,await cpu())});}}
        const value=stat(times);actions[label]=value;check(`${name}:${label}-budget`,value.median<=500,undefined,value);
      };
      const group=async(value:string)=>{await guest(s,`const n=d.querySelector('${hook('map-group')}');n.value=${literal(value)};n.dispatchEvent(new Event('change',{bubbles:true}));return true`);await frames2();};
      await action('select-inspect',()=>select(s,'T-00-00'),()=>select(s,'T-01-00'));
      await action('unfinished',()=>activate(s,'map-status-all'),()=>activate(s,'map-status-unfinished'));
      await action('show-all',()=>activate(s,'map-status-unfinished'),()=>activate(s,'map-status-all'));
      await action('group-filter',()=>group('*'),()=>group('G-10'));
      await action('group-reset',()=>group('G-10'),()=>group('*'));
      await action('upstream',()=>select(s,'T-01-00'),()=>key('['));
      await action('downstream',()=>select(s,'T-00-00'),()=>key(']'));
      await action('fit-all',()=>activate(s,'map-focus-current'),()=>activate(s,'map-fit-all'));
      await action('neighbour',()=>select(s,'T-00-00'),()=>key('ArrowRight'));
      await action('pan',()=>activate(s,'map-fit-all'),()=>activate(s,'map-pan-right'));
      await action('zoom',()=>activate(s,'map-fit-all'),()=>activate(s,'map-zoom-in'));
      await select(s,'T-10-24');
      const dom=await guest(s,`return {cards:d.querySelectorAll('[data-task]').length,edges:d.querySelectorAll('path[data-from]').length,nodes:d.querySelectorAll('*').length}`);
      check(`${name}:full-plan`,dom.cards===980&&dom.edges===2000,undefined,dom);
      await photo(`${name}/map-ready`,s);
      const replay: unknown[]=[],coordinateMaps: unknown[]=[];
      for(const step of fx.largePlan!.steps.slice(1)){
        const before=await positions(s),beforeScreen=await screen(s),transform=await coords(s),start=performance.now();fx.largePlan!.advance(step.id);
        await ready(s,step.revision);await frames2();const elapsed=performance.now()-start,after=await positions(s),afterScreen=await screen(s);
        const moved=Object.keys(after).filter(id=>before[id]&&after[id]!==before[id]);
        const screenMoved=Object.keys(afterScreen).filter(id=>beforeScreen[id]&&JSON.stringify(afterScreen[id])!==JSON.stringify(beforeScreen[id]));
        check(`${name}:${step.id}:visible-budget`,elapsed<=8000,undefined,elapsed);
        if(['S1','S2','S3','S8'].includes(step.id))check(`${name}:${step.id}:zero-movement`,!moved.length&&!screenMoved.length&&transform===await coords(s),undefined,{moved,screenMoved});
        if(step.id==='S4')check(`${name}:S4:no-relocation`,!moved.length);
        if(['S1','S2','S3','S4','S8'].includes(step.id))coordinateMaps.push({step:step.id,before:{world:before,screen:beforeScreen,transform},after:{world:after,screen:afterScreen,transform:await coords(s)}});
        if(step.id==='S5'){check(`${name}:selected-fully-visible`,await inView(s,'T-10-24'));await photo(`${name}/map-after-structural`,s);await select(s,'T-19-48');}
        if(['S6','S7'].includes(step.id))check(`${name}:${step.id}:no-reused-selection`,await selected(s)!=='T-19-48');
        replay.push({step:step.id,visibleMs:elapsed,moved:moved.length,screenMoved:screenMoved.length});
      }
      const mark=await evaluate<number>('qa.replies.length'),stable=await positions(s);await polls(s);
      const idle=await evaluate<any[]>(`qa.replies.slice(${mark}).filter(r=>r.frame==='${s}')`);
      check(`${name}:unchanged-polls-no-detail-graph`,!idle.some(r=>['/v1/plan','/v1/plan-graph'].includes(r.path))&&JSON.stringify(stable)===JSON.stringify(await positions(s)));
      const peer=s==='page'?'panel':'page';
      await evaluate(`qa.holds.push({tag:'hidden-large',path:'/v1/plan',frame:'${s}',cursor:true});true`);await reload(s);
      await wait(s,`qa.held.some(h=>h.tag==='hidden-large')`,'held paged detail');
      await evaluate(`qa.visibility('${s}',false);qa.visibility('${peer}',true);true`);await frames2();
      const requestMark=await evaluate<number>('qa.requests.length');
      await guest(s,`w.__hiddenRoot=d.querySelector('#root').firstElementChild;return true`);
      await evaluate(`qa.release('hidden-large');true`);await polls(peer);
      check(`${name}:hidden-held-read-does-not-continue-or-paint`,await evaluate(`!qa.requests.slice(${requestMark}).some(r=>r.frame==='${s}')`)&&await guest(s,`return w.__hiddenRoot===d.querySelector('#root').firstElementChild`));
      await evaluate(`qa.visibility('${s}',true);qa.visibility('${peer}',false);true`);await open(s);await ready(s,9);
      await d.theme('dark');await photo(`${name}/map-dark-narrow`,s);await d.theme('light');
      const summary={production:true,...d.facts,surface:s,width,frameHeight:850,load,actions,streams,dom,replay,cpu:{label:'CDP browser layout/style/script CPU milliseconds for the isolated production guest; browser layout, not map-algorithm-only or compositor time',samples:cpuSamples}};
      variants[name]=summary;save(`${name}/performance.json`,summary);save(`${name}/coordinates.json`,coordinateMaps);save(`${name}/results.json`,{passed:true,production:true,replay});save(`${name}/requests.json`,await evaluate('qa.replies'));
    }
    check('large:no-guest-errors',d.pageErrors().length===0,undefined,d.pageErrors());return;
  }

  await setup();
  check('entry:board-progress-default',await guest('page',`return d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]').dataset.id==='progress'`));
  check('entry:map-fourth',await guest('page',`return [...d.querySelectorAll('[data-testid="detail-tabs"] [role=tab]')].map(n=>n.dataset.id).join(',')==='progress,document,history,map'`));
  check('entry:rail-list-default',await guest('panel',`return d.querySelector('${hook('plan-view-list')} button').getAttribute('aria-pressed')==='true'`));
  for(const s of ['page','panel','status'])check(`${s}:zero-graph-before-map`,await d.count('/v1/plan-graph',s)===0);
  // A source-qualified row is picked before entering Map; same IDs do not authorize pairing.
  await open('page');check('entry:board-does-not-activate-rail',await d.count('/v1/plan-graph','panel')===0);
  await open('panel');
  for(const s of ['page','panel']){
    check(`${s}:full-small-graph`,await guest(s,`const n=d.querySelector('${region}');return n.dataset.tasks==='9'&&n.dataset.edges==='8'`));
    check(`${s}:only-recorded-directed-task-arrows`,await guest(s,`return JSON.stringify([...d.querySelectorAll('path[data-from][data-to]')].map(n=>n.dataset.from+'>'+n.dataset.to).sort())===${literal(JSON.stringify(['A>B','A>C','B>D','C>D','A>E','B>E','A>F','S>W'].sort()))}&&[...d.querySelectorAll('path[data-from]')].every(n=>n.getAttribute('marker-end'))`));
    check(`${s}:blocked-and-skipped-stay-explicit`,await guest(s,`return d.querySelector('${hook('map-card-F')}').dataset.mark==='blocked'&&d.querySelector('${hook('map-card-W')}').textContent.includes('skipped')`));
    check(`${s}:literal-title`,await guest(s,`return d.querySelector('${hook('map-card-A')}').textContent.includes('<img')&&!d.querySelector('${region} img')`));
    check(`${s}:persistent-announcer-outside-root`,await guest(s,`return d.querySelectorAll('${hook('map-announcer')}').length===1&&!d.querySelector('#root').contains(d.querySelector('${hook('map-announcer')}'))`));
    await observeSpeech(s);
  }
  await select('page','D');await select('panel','B');await frames2();
  check('independent:selection',await selected('page')==='D'&&await selected('panel')==='B');
  for(const s of ['page','panel'])check(`${s}:one-explicit-selection-announcement`,(await speech(s)).length===1&&(await speech(s))[0].includes('direct prerequisite'));
  await photo('independent-maps','page');
  for(const s of ['page','panel']){
    const before=await speech(s);await polls(s);
    check(`${s}:zero-poll-announcements`,JSON.stringify(before)===JSON.stringify(await speech(s)));
    check(`${s}:announcer-identity-after-polls`,await guest(s,`return w.__announcer===d.querySelector('${hook('map-announcer')}')`));
  }
  check('status:no-map-dom',await guest('status',`return !d.querySelector('[data-testid^="map-"],[data-testid^="plan-view"],[data-map-style]')`));
  check('status:zero-graph',await d.count('/v1/plan-graph','status')===0);
  check('status:map-free-bundle',!/(map-announcer|map-host|plan-view-map|\/v1\/plan-graph|ap-map-viewport)/.test(readFileSync('ui/status/main.js','utf8')));
  await photo('work-status-no-map','status');
  await c.send('Accessibility.enable');
  const frameTree=await c.send('Page.getFrameTree');
  const statusFrame=frameTree.frameTree.childFrames.find((f:any)=>f.frame.url.includes('/ui/status/'));
  const statusAx=await c.send('Accessibility.getFullAXTree',{frameId:statusFrame.frame.id});
  check('status:AX-no-map',!statusAx.nodes.some((n:any)=>!n.ignored&&/^(Map|Plan view|Task map|View as list)$/.test(n.name?.value??'')));

  if(d.mode==='accessibility'){
    const ax=await c.send('Accessibility.getFullAXTree');save('ax-shell.json',{nodes:ax.nodes.map((n:any)=>({role:n.role?.value,name:n.name?.value,ignored:n.ignored,childIds:n.childIds,nodeId:n.nodeId}))});
    // getFullAXTree with each same-process child frame ID, not just the top shell tree.
    const tree=await c.send('Page.getFrameTree');
    const childFrames=tree.frameTree.childFrames??[];
    for(const [s,width] of [['page',1100],['panel',360],['panel',600]] as const){
      const name=`${s}-${width}`;mkdirSync(join(d.artifacts,name),{recursive:true});await d.show([s],width);await ready(s);
      const child=childFrames.find((f:any)=>f.frame.url.includes(`/ui/${s}/`));
      const full=await c.send('Accessibility.getFullAXTree',{frameId:child.frame.id});
      save(`${name}/ax.json`,{nodes:full.nodes.map((n:any)=>({role:n.role?.value,name:n.name?.value,ignored:n.ignored,properties:n.properties?.filter((p:any)=>['focusable','focused','pressed','live'].includes(p.name)),childIds:n.childIds,nodeId:n.nodeId}))});
      check(`${name}:AX-task-map-region`,full.nodes.some((n:any)=>!n.ignored&&n.role?.value==='region'&&n.name?.value==='Task map'));
      check(`${name}:AX-full-title-status-context`,full.nodes.some((n:any)=>!n.ignored&&n.role?.value==='button'&&n.name?.value?.includes('Build a deliberately long Unicode branch')&&n.name.value.includes('Reported working')));
      check(`${name}:AX-includes-offscreen-unfiltered-cards`,full.nodes.filter((n:any)=>!n.ignored&&n.role?.value==='button'&&n.name?.value?.includes('recorded prerequisite')).length===9);
      check(`${name}:canvas-one-tab-stop`,await guest(s,`return [...d.querySelector('${viewport}').querySelectorAll('button,[tabindex]')].filter(n=>n.tabIndex===0).length===1`));
      await select(s,'B');await key('ArrowRight');check(`${name}:arrow-neighbour`,await selected(s)!=='B');
      await key('Tab');check(`${name}:keyboard-exit`,await guest(s,`return !d.activeElement.closest('${viewport}')`));
      await activate(s,'map-status-unfinished');
      check(`${name}:filtered-cards-not-navigable`,await guest(s,`return !d.querySelector('${hook('map-card-A')}')&&!d.querySelector('${hook('map-card-S')}')`));
      const filteredAX=await c.send('Accessibility.getFullAXTree',{frameId:child.frame.id});
      check(`${name}:filtered-cards-absent-from-AX`,filteredAX.nodes.filter((n:any)=>!n.ignored&&n.role?.value==='button'&&n.name?.value?.includes('recorded prerequisite')).length===7);
      await activate(s,'map-status-all');
      const unfilteredPositions=await positions(s);
      await guest(s,`d.querySelector('${hook('map-group')}').focus();return true`);await key('End');await frames2();
      check(`${name}:native-group-filter-by-keyboard`,await guest(s,`return d.querySelector('${hook('map-group')}').value!=='*'&&d.querySelectorAll('[data-task]').length===1`));
      await key('Home');await frames2();check(`${name}:group-reset-keeps-full-layout`,JSON.stringify(unfilteredPositions)===JSON.stringify(await positions(s)));
      for(const theme of ['light','dark'] as const){
        await d.theme(theme);
        await select(s,'B'); // the canvas Tab stop is its selected/roving card, not an arbitrary -1 card
        const targets=[['toolbar','map-fit-all'],['card','map-card-B'],...(s==='panel'?[['switch','plan-view-map']]:[])];
        for(const [label,id]of targets){await guest(s,`d.activeElement?.blur();return true`);await d.shot(`${name}/focus-${label}-${theme}-off`,hook(id),12,850,s);await guest(s,`const n=d.querySelector('${hook(id)}');(n.matches('button')?n:n.querySelector('button')).focus();return true`);await key('Tab');await key('Tab',1,8);check(`${name}:${theme}:${label}:visible-focus`,await guest(s,`const n=d.activeElement,style=getComputedStyle(n);return !!n.closest('${hook(id)}')&&((style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0)||style.boxShadow!=='none')`));await d.shot(`${name}/focus-${label}-${theme}-on`,hook(id),12,850,s);}
        if(s==='page'){await guest(s,`d.activeElement?.blur();return true`);await d.shot(`${name}/focus-tab-${theme}-off`,'[data-id="map"][role="tab"]',12,850,s);await guest(s,`d.querySelector('[data-id="map"][role="tab"]').focus();return true`);await key('Tab');await key('Tab',1,8);await d.shot(`${name}/focus-tab-${theme}-on`,'[data-id="map"][role="tab"]',12,850,s);}
      }
      await d.theme('light');
      for(const factor of [2,4]){
        // CSS zoom on the embedding section is the verified equivalent: effective layout width is
        // divided while text/control pixels are multiplied. Unlike width-only emulation it scales
        // both layout and text, and unlike deviceScaleFactor it changes the CSS layout viewport.
        await evaluate(`(()=>{const n=document.querySelector('section[data-frame=${s}]');n.style.width='${width/factor}px';n.style.zoom='${factor}';frame('${s}').style.height='${850/factor}px';return true})()`);
        await wait(s,`w.innerWidth===${width/factor}`,'effective zoom layout');await frames2();
        const metrics=await guest(s,`const n=d.querySelector('${hook('map-fit-all')}'),r=n.getBoundingClientRect();return {cssWidth:w.innerWidth,cssHeight:w.innerHeight,font:getComputedStyle(n).fontSize,controlWidth:r.width}`);
        check(`${name}:zoom-${factor}:no-document-overflow`,await overflow(s));
        await activate(s,'map-fit-all');await activate(s,'map-zoom-in');await activate(s,'map-zoom-out');
        await select(s,'B');await activate(s,'map-list');await wait(s,`d.activeElement?.dataset?.testid==='item-B'`,'zoom list reveal');await open(s);
        await d.shot(`${name}/zoom-${factor*100}`,hook('map-fit-all'),12,850,s);await d.shot(`${name}/zoom-${factor*100}-inspector`,inspector,0,850,s);save(`${name}/zoom-${factor*100}.json`,{method:'equivalent CSS zoom of embedding section plus divided layout viewport; not graph zoom or deviceScaleFactor',factor,originalWidth:width,originalHeight:850,effective:metrics,physicalTextScale:factor});
        await evaluate(`(()=>{const n=document.querySelector('section[data-frame=${s}]');n.style.zoom='1';n.style.width='${width}px';frame('${s}').style.height='850px';return true})()`);await wait(s,`w.innerWidth===${width}`);await frames2();
      }
      if(s==='page'||width===360){
        // The zoom-reflow pass intentionally used Fit all in a 90 CSS-pixel viewport. Restore a
        // readable work framing before judging forced-color strokes, status shapes and focus.
        await activate(s,'map-focus-current');await select(s,'B');
        await c.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'},{name:'prefers-reduced-motion',value:'reduce'}]});await frames2();
        check(`${name}:forced-colors-active`,await guest(s,`return w.matchMedia('(forced-colors: active)').matches`));
        save(`${name}/forced-colors-styles.json`,await guest(s,`const edge=d.querySelector('path[data-from]'),card=d.querySelector('[data-task]');return {edge:getComputedStyle(edge).stroke,card:getComputedStyle(card).borderColor,marks:d.querySelectorAll('[data-mark]').length}`));
        check(`${name}:forced-colors-edges-and-noncolor-status`,await guest(s,`const edge=d.querySelector('path[data-from]'),card=d.querySelector('[data-task]');return getComputedStyle(edge).stroke!=='none'&&!!edge.getAttribute('marker-end')&&!!card.querySelector('[data-mark]')&&!!card.querySelector('.ap-map-card-word')`));
        await d.shot(`${name}/forced-colors`,viewport,0,850,s);
        await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        check(`${name}:reduced-motion-no-moving-animation`,await guest(s,`return w.matchMedia('(prefers-reduced-motion: reduce)').matches&&!d.getAnimations().some(a=>a.playState==='running')`));await d.shot(`${name}/reduced-motion`,viewport,0,850,s);
      }
      if(s==='panel'){await select(s,'B');await activate(s,'map-list');await wait(s,`d.activeElement?.dataset?.testid==='item-B'`);await open(s);await d.shot(`${name}/list-map-focus`,viewport,0,850,s);await d.shot(`${name}/stacked-inspector`,inspector,0,850,s);}
      save(`${name}/results.json`,{production:true,passed:true,width});
    }
    await observeSpeech('page');await observeSpeech('panel');await select('panel','I');
    await guest('panel','w.__speech=[];return true');
    fx.reportMap('P-map',{op:'revise',items:mapItems.filter(i=>i.id!=='I')});await ready('panel',2);await frames2();
    check('accessibility:removed-focus-one-fallback',await selected('panel')!=='I'&&(await speech('panel')).length===1);
    check('accessibility:peer-refresh-does-not-speak',!(await speech('page')).length);
    const fallbackSpeech=await speech('panel');await polls('panel');check('accessibility:fallback-not-repeated-by-polls',JSON.stringify(fallbackSpeech)===JSON.stringify(await speech('panel')));
    await activate('panel','map-list');const listSpeech=await speech('panel');await polls('panel');check('accessibility:list-suppresses-map-announcements',JSON.stringify(listSpeech)===JSON.stringify(await speech('panel')));
    check('accessibility:no-guest-errors',d.pageErrors().length===0,undefined,d.pageErrors());return;
  }

  await photo('board-map','page');
  for(const width of [600,360,600,360]){
    await d.show(['panel'],width);await ready('panel');await select('panel','B');
    check(`rail:${width}:selected-visible`,await inView('panel','B'));
    check(`rail:${width}:no-page-overflow`,await overflow('panel'));
    await photo(width===600?'rail-map-wide':'rail-map-narrow','panel');
  }
  await photo('rail-resize','panel');
  await activate('panel','map-list');await wait('panel',`d.activeElement?.dataset?.testid==='item-B'`,'canonical row focus');
  await open('panel');check('rail:list-map-target',await selected('panel')==='B');
  await select('panel','C');await activate('panel','map-list');await wait('panel',`d.activeElement?.dataset?.testid==='item-C'`,'new selected row');
  await d.shot('rail-list-handoff',hook('item-C'),12,850,'panel');await open('panel');check('rail:no-consumed-target-replay',await selected('panel')==='C');
  const boardSelection=await selected('page');
  await evaluate(`qa.context('other');true`);await wait('panel',`!d.querySelector('${region}')`,'rail reset other');
  await evaluate(`qa.context('M');true`);await wait('panel',`d.querySelector('${hook('plan-view-list')} button')?.getAttribute('aria-pressed')==='true'`,'rail reset back');
  const restored=await guest('panel',`const n=d.querySelector('article[data-reading]');return {plan:n?.dataset.testid,source:n?.dataset.source}`);
  d.facts.railPreferenceRepro={sequence:'Pick source-alpha/P-map; M → other → M; synthetic storage reports no saved value',restored,classification:'pre-existing stored List plan choice; Map reads the currently selected source-qualified key, not a stale source picture'};
  check('board:host-session-keeps-selection',await selected('page')===boardSelection);
  await pickRail();await open('panel');check('rail:map-matches-explicit-source',await guest('panel',`return d.querySelector('${hook('map-title')}').textContent==='Dependency map fixture'`));
  await photo('identity-switch','panel');
  await evaluate(`qa.context(null);true`);await wait('panel',`!d.querySelector('${hook('plan-view')}')&&!d.querySelector('${region}')`,'null session no entry');await evaluate(`qa.context('M');true`);await pickRail();
  // A delayed stored choice cannot undo a newer picker action or restore old map/task state.
  await evaluate(`qa.context('other');true`);await wait('panel',`!d.querySelector('${hook('plan-view')}')`);
  await evaluate(`qa.holdPreference=true;qa.context('M');true`);await wait('panel',`qa.held.some(h=>h.tag==='preference')`,'held stored choice');
  await pickRail('No recorded prerequisites');await evaluate(`qa.release('preference');true`);await frames2();await open('panel');
  check('rail:late-preference-cannot-override-choice',await guest('panel',`return d.querySelector('${hook('map-title')}').textContent==='No recorded prerequisites'`));
  await expose('page');
  for(const id of ['filter-project','filter-worktree','filter-session']){
    await boardChoice(id,1);await ready('page');check(`board:${id}:matched-map-after-scope-change`,await guest('page',`return d.querySelector('${region}').dataset.current==='true'`));
    await boardChoice(id,0);await ready('page');
  }
  await click('page','#ap-search-q');await c.send('Input.insertText',{text:'Dependency map fixture'});await key('Enter');
  await wait('page',`d.querySelector('${hook('search-plan-source-alpha/P-map')}')`,'search-selected map plan');await click('page',hook('search-plan-source-alpha/P-map'));await open('page');
  check('board:search-selection-map-paired',await guest('page',`return d.querySelector('${hook('map-title')}').textContent==='Dependency map fixture'`));
  await activate('page','search-clear');await wait('page',`d.querySelector('${hook('plan-list')}')`,'ordinary browsing restored');
  // Same-ID foreign plan is honestly foreign, never the previous source's snapshot/assignment.
  await list('page');await pickBoard('P-map','source-beta');await open('page');
  check('identity:foreign-title-not-stale-picture',await guest('page',`return d.querySelector('${hook('map-title')}').textContent==='Independent source counterpart'&&!d.querySelector('[data-testid^="map-card-live-"]')`));
  await list('page');await pickBoard();await open('page');
  await select('page','B');await key(']');await frames2();check('keyboard:direct-dependent',await selected('page')==='D');await photo('downstream-highlight','page');
  await key('[');await frames2();check('keyboard:direct-prerequisite',await selected('page')==='B');await photo('upstream-highlight','page');
  await guest('page',`d.querySelector('${viewport}').scrollIntoView({block:'center'});return true`);
  const pointer=await evaluate<number[]>(`(()=>{const fr=frame('page').getBoundingClientRect(),r=frame('page').contentDocument.querySelector('${viewport}').getBoundingClientRect();return[fr.x+r.right-5,fr.y+r.bottom-5]})()`);
  await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer[0],y:pointer[1]});await c.send('Input.dispatchMouseEvent',{type:'mousePressed',x:pointer[0],y:pointer[1],button:'left',buttons:1,clickCount:1});
  await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer[0]-20,y:pointer[1]-10,button:'left',buttons:1});await frames2();
  const original=await positions('page'),panBefore=await coords('page');fx.reportMap('P-map',{op:'change',changes:[{id:'C',status:'working'}]});await ready('page',2);
  check('pointer:captured-pan-survives-status-refresh',await guest('page',`return d.querySelector('${viewport}').hasPointerCapture(1)`));
  await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer[0]-40,y:pointer[1]-20,button:'left',buttons:1});await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pointer[0]-40,y:pointer[1]-20,button:'left',buttons:0,clickCount:1});await frames2();
  check('pointer:pan-continues-after-repaint',panBefore!==await coords('page'));await photo('pan-zoom','page');
  check('refresh:status-only-no-movement',JSON.stringify(original)===JSON.stringify(await positions('page')));
  // Finish/reopen changes readiness guidance, not topology.
  fx.reportMap('P-map',{op:'change',changes:['B','C','D','E','F','W','I'].map(id=>({id,status:'done'}))});
  fx.reportMap('P-map',{op:'finish',outcome:'finished'});await ready('page',4);
  check('lifecycle:finished-no-ready',await guest('page',`return !d.querySelector('.ap-map-stat[data-kind="ready"]')`));
  fx.reportMap('P-map',{op:'revise',reopen:true,items:mapItems.map(i=>i.kind==='task'?{...i,status:i.id==='C'?'pending':i.id==='S'?'skipped':'done'}:i)});await ready('page',5);
  check('lifecycle:reopened-guidance-and-stable-geometry',await guest('page',`return !!d.querySelector('.ap-map-stat[data-kind="ready"]')`)&&JSON.stringify(original)===JSON.stringify(await positions('page')));
  await fx.setCapture(false);await polls('page');check('capture:off-explicit',await guest('page',`return !!d.querySelector('${hook('capture-off')}')`));await fx.setCapture(true);await polls('page');
  // Held graph across leaving Map cannot revive cards or steal focus.
  await list('page');await pickBoard('P-map-none');
  await evaluate(`qa.holds.push({tag:'final-graph',path:'/v1/plan-graph',frame:'page'});true`);
  await click('page','[data-testid="detail-tabs"] [data-id="map"]');await wait('page',`qa.held.some(h=>h.tag==='final-graph')`,'held graph');
  await list('page');await evaluate(`qa.release('final-graph');true`);await polls('page');
  check('retire:leaving-map-no-late-picture',await guest('page',`return !d.querySelector('${region}')`));
  await open('page');check('no-edges:honest-statement',await guest('page',`return d.querySelector('${region}').textContent.includes('No prerequisites recorded for this plan')`));
  await list('page');await pickBoard('P-map-paged');await wait('page',`d.querySelector('${hook('item-T0')}')`,'canonical paged task');await click('page',hook('item-T0'));
  await evaluate(`qa.holds.push({tag:'focus-graph',path:'/v1/plan-graph',frame:'page'});true`);
  await click('page','[data-testid="detail-tabs"] [data-id="map"]');await wait('page',`qa.held.some(h=>h.tag==='focus-graph')`,'held initial graph with task target');
  await click('page','#ap-search-q');await evaluate(`qa.release('focus-graph');true`);await ready('page');await frames2();
  check('focus:held-initial-graph-does-not-steal-after-reader-moves',await guest('page',`return d.activeElement?.id==='ap-search-q'`));
  await list('page');await pickBoard('P-map-groups');await open('page');check('group:metadata-not-task-edges',await guest('page',`return d.querySelector('${region}').dataset.tasks==='1'&&d.querySelector('${region}').dataset.edges==='0'`));
  await list('page');await pickBoard('P-map-finished');await open('page');
  check('finished:no-ready-guidance',await guest('page',`return !d.querySelector('.ap-map-stat[data-kind="ready"]')`));
  await fx.cleanupElsewhere('archive','P-map-finished');
  // Current view must retire a cleanup identity; board archive browsing remains board-only.
  await polls('page');check('archive:current-reading-retired',await guest('page',`return !d.querySelector('${hook('map-title')}')?.textContent.includes('Finished plan')`));
  await activate('page','cleanup-archived');await pickBoard('P-map-finished');await open('page');
  check('archive:map-inspectable-in-archived-scope',await guest('page',`return d.querySelector('${hook('cleanup-archived')} button').getAttribute('aria-pressed')==='true'&&d.querySelector('${hook('map-title')}').textContent==='Finished plan'`));await photo('archived-map','page');
  await fx.cleanupElsewhere('restore','P-map-finished');await polls('page');await activate('page','cleanup-visible');await pickBoard('P-map-finished');await open('page');
  const activity=fx.enableMapAttribution();
  await list('page');await pickBoard();await list('panel');await pickRail();
  for(const s of ['page','panel']){
    await open(s);await wait(s,`d.querySelector('${hook('map-card-live-B')}')`,'verified assigned session activity');
    check(`attribution:${s}:verified-only`,await guest(s,`return d.querySelector('${hook('map-card-who-B')}').textContent==='Assigned to Session map-child'&&d.querySelectorAll('[data-testid^="map-card-live-"]').length===1&&d.querySelector('${hook('map-card-C')}').dataset.attribution==='recorded'`));
    await select(s,'B');check(`attribution:${s}:report-separate`,await guest(s,`const r=d.querySelector('${hook('map-attribution-reports')}');return !!r&&r.textContent.includes('Session M')&&r.textContent.includes('Session map-child')`));
    await photo(s==='page'?'verified-running':'rail-verified-running',s);
  }
  const attributedPositions=await positions('page');activity.terminal();await polls('page');
  await wait('page',`!d.querySelector('${hook('map-card-live-B')}')`,'terminal activity withdrawn');
  check('attribution:terminal-no-movement',JSON.stringify(attributedPositions)===JSON.stringify(await positions('page')));await photo('terminal-run','page');
  await list('page');await pickBoard('P-map-none');
  await evaluate(`qa.holds.push({tag:'account-graph',path:'/v1/plan-graph',frame:'page'});true`);
  await click('page','[data-testid="detail-tabs"] [data-id="map"]');await wait('page',`qa.held.some(h=>h.tag==='account-graph')`,'held graph before account switch');
  await evaluate(`qa.account='account-next';qa.ready();true`);await wait('page',`!d.querySelector('${region}')`,'account retires map');
  await evaluate(`qa.release('account-graph');true`);await polls('page');
  check('identity:account-held-reply-cannot-paint',await guest('page',`return !d.querySelector('${region}')&&!d.activeElement?.dataset?.task`));
  await pickBoard();await open('page');
  await evaluate(`qa.store=1;true`);await polls('page');await wait('page',`!d.querySelector('${region}')`,'store retires reading');
  check('identity:store-resets-to-progress',await guest('page',`return d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id==='progress'`));
  await evaluate(`qa.store=0;true`);await polls('page');
  await evaluate(`qa.stripGraph=true;true`);await reload('page');await reload('panel');
  await pickBoard();await pickRail();
  for(const s of ['page','panel']){
    const mark=await d.count('/v1/plan-graph',s);
    if(s==='page')await click(s,'[data-testid="detail-tabs"] [data-id="map"]');else await activate(s,'plan-view-map');
    await wait(s,`d.querySelector('${region}')?.dataset.state==='unavailable'`,'old-service unavailable');
    check(`${s}:old-service-zero-graph`,await d.count('/v1/plan-graph',s)===mark);
    await photo(`${s}-unavailable`,s);await activate(s,'map-list');await wait(s,`d.querySelector('article[data-reading]')`,'ordinary list alternative');
  }
  await photo('list-alternative','page');
  // A same-task focus key is insufficient: native accessibility sees a new focus if
  // the actual button is detached/replaced. Observe the node and its events directly.
  await evaluate(`qa.stripGraph=false;true`);await reload('page');await reload('panel');
  await pickBoard();await pickRail();
  for(const s of ['page','panel']){
    await open(s);await select(s,'B');await frames2();
    const revision=await guest<number>(s,`return Number(d.querySelector('${region}').dataset.revision)`);
    await guest(s,`w.__focusedMapCard=d.activeElement;w.__mapFocusEvents=[];for(const type of ['blur','focus'])w.__focusedMapCard.addEventListener(type,()=>w.__mapFocusEvents.push(type));return true`);
    fx.reportMap('P-map',{op:'change',changes:[{id:'I',status:s==='page'?'working':'pending'}]});
    await ready(s,revision+1);await polls(s);await frames2();
    const continuity=await guest(s,`return {same:w.__focusedMapCard===d.activeElement,connected:w.__focusedMapCard.isConnected,events:w.__mapFocusEvents.slice()}`);
    check(`${s}:status-refresh-preserves-focused-node`,continuity.same&&continuity.connected&&!continuity.events.length,undefined,continuity);
  }
  // Reading-local geometry must not retain bare-ID slots from another plan.
  // A → B → C, followed by unrelated C → A, makes inherited columns observable.
  fx.reportMap('P-map',{op:'revise',items:[
    {id:'A',title:'Chain root A',kind:'task',status:'pending'},
    {id:'B',title:'Chain middle B',kind:'task',status:'pending',dependencies:['A']},
    {id:'C',title:'Chain tail C',kind:'task',status:'pending',dependencies:['B']},
  ]});
  fx.reportMap('P-map-none',{op:'revise',items:[
    {id:'C',title:'Unrelated root C',kind:'task',status:'pending'},
    {id:'A',title:'Unrelated dependent A',kind:'task',status:'pending',dependencies:['C']},
  ]});
  for(const s of ['page','panel']){
    if(s==='page')await pickBoard();else await pickRail();
    await open(s);
    await wait(s,`d.querySelector('[data-testid="map-card-C"] .ap-map-card-title')?.textContent==='Chain tail C'`,'accepted chain reading');await ready(s);
    await wait(s,`d.querySelector('[data-testid="map-card-C"]').dataset.x==='580'`,'chain tail in third column');
    await select(s,'A');await select(s,'C');
    await wait(s,`d.querySelector('[data-testid="map-announcer"]').textContent.includes('Chain tail C')`,'ordinary delivered selection');
    await observeSpeech(s);
    if(s==='page'){
      // Queue one more selection and change plan in the same turn: no timer may
      // deliver the retired selection into the next reading's persistent node.
      await guest(s,`const row=d.querySelector('[data-testid="plan-row-P-map-none"][data-source="source-alpha"]');d.querySelector('[data-testid="map-card-A"]').click();row.click();return true`);
    }else await pickRail('No recorded prerequisites');
    await wait(s,`d.querySelector('[data-testid="map-title"]')?.textContent==='No recorded prerequisites'`,'unrelated plan');
    await wait(s,`d.querySelector('[data-testid="map-card-C"] .ap-map-card-title')?.textContent==='Unrelated root C'`,'accepted unrelated reading');await ready(s);await frames2();await polls(s);
    const fresh=await guest(s,`return {c:Number(d.querySelector('[data-testid="map-card-C"]').dataset.x),a:Number(d.querySelector('[data-testid="map-card-A"]').dataset.x),announcement:d.querySelector('[data-testid="map-announcer"]').textContent}`);
    check(`${s}:reading-change-clears-geometry`,fresh.c===0&&fresh.a>fresh.c,undefined,fresh);
    check(`${s}:reading-change-retires-delivered-and-pending-speech`,await guest(s,`return w.__announcer===d.querySelector('[data-testid="map-announcer"]')&&w.__announcer.textContent===''&&w.__speech.length===0`),undefined,await speech(s));
    await select(s,'A');await wait(s,`d.querySelector('[data-testid="map-announcer"]').textContent.includes('Unrelated dependent A')`,'delivered before leaving Map');
    await observeSpeech(s);
    await guest(s,`d.querySelector('[data-testid="map-card-C"]').click();d.querySelector('[data-testid="map-list"] button').click();return true`);
    await wait(s,`!d.querySelector('[data-testid="map-region"]')&&d.querySelector('article[data-reading]')`,'ordinary list after retirement');
    await frames2();await polls(s);
    check(`${s}:view-retirement-clears-speech-keeps-node`,await guest(s,`return w.__announcer===d.querySelector('[data-testid="map-announcer"]')&&w.__announcer.textContent===''&&w.__speech.length===0`),undefined,await speech(s));
  }
  // A settled foreign-source picture has no eligible run visit to manufacture a
  // repaint on return. Unchanged refreshes alone must resume and re-pin the map.
  const resumes:Record<string,unknown>[]=[];
  for(const s of ['page','panel']){
    if(s==='page')await pickBoard('P-map','source-beta');else await pickRail('Independent source counterpart');
    await open(s);await select(s,'B');await polls(s);await ready(s);
    const revision=await guest<string>(s,`return d.querySelector('${region}').dataset.revision`),graphBefore=await d.count('/v1/plan-graph',s);
    await evaluate(`qa.visibility('${s}',false);true`);await frames2();
    await evaluate(`qa.visibility('${s}',true);true`);await polls(s);await frames2();
    const repins=(await d.count('/v1/plan-graph',s))-graphBefore;
    await guest(s,`d.querySelector('[data-testid="map-card-C"]').focus();return true`);await key('Enter');await frames2();
    const selection=await selected(s);
    await key(']');await frames2();const navigation=await selected(s);
    const panBefore=await coords(s);await activate(s,'map-pan-right');const toolbar=(await coords(s))!==panBefore;
    await polls(s);
    resumes.push({surface:s,selection,navigation,toolbar,repins,extraPins:(await d.count('/v1/plan-graph',s))-graphBefore-repins,sameRevision:revision===await guest(s,`return d.querySelector('${region}').dataset.revision`)});
  }
  d.facts.visibilityResume=resumes;
  for(const r of resumes)check(`${r.surface}:settled-map-resumes-after-hide`,r.selection==='C'&&r.navigation==='D'&&r.toolbar===true&&r.repins===1&&r.extraPins===0&&r.sameRevision===true,undefined,r);
  check('final:no-stored-map-preference',await evaluate(`!qa.storage.some(r=>r.op==='set'&&/map/i.test(r.key??''))`));
  check('final:no-guest-errors',d.pageErrors().length===0,undefined,d.pageErrors());
  save('frame-requests.json',await evaluate(`qa.replies.map(({frame,traffic,path,status,bytes,ms,revision})=>({frame,traffic,path,status,bytes,ms,revision}))`));
}
