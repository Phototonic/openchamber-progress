// Indicator scenarios for subagent-activity-qa.ts, over its disposable SDK/service fixture.
// Real keyboard, pointer/touch and accessibility-tree evidence; not screen-reader speech certification.
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';

interface Harness {
  evaluate: <T = any>(code: string) => Promise<T>;
  guest: <T = any>(surface: string, code: string) => Promise<T>;
  wait: (surface: string, condition: string, label?: string, ms?: number) => Promise<void>;
  show: (surface: string, width?: number) => Promise<void>;
  click: (surface: string, selector: string) => Promise<void>;
  key: (key: string, shift?: boolean) => Promise<void>;
  send: (method: string, params?: object, sessionId?: string) => Promise<any>;
  shot: (surface: string, name: string, maxHeight?: number, section?: boolean) => Promise<void>;
  check: (label: string, ok: boolean, facts?: unknown) => void;
}
export async function verifyIncompleteCounts(h: Harness) {
  const { evaluate, guest, wait, show, click, key, send, shot, check } = h;
  const note = '[data-testid="incomplete-counts"]', toggle = '[data-testid="incomplete-counts-toggle"]';
  const dismiss = '[data-testid="incomplete-counts-dismiss"]', body = '[data-testid="incomplete-counts-body"]';
  const open = async (surface = 'panel') => {
    if (await guest(surface, `return d.querySelector('${toggle}')?.getAttribute('aria-expanded')==='false'`)) await click(surface, toggle);
    await wait(surface, `d.querySelector('${toggle}')?.getAttribute('aria-expanded')==='true'`);
  };
  const changed = async (code: string) => {
    const revision = await evaluate<number>(`${code};(()=>{const r=qa.bump();qa.context('A');return r})()`);
    await wait('panel', `Number(d.querySelector('[data-testid="subagent-activity"]')?.dataset.revision)>=${revision}`, 'current run snapshot');
  };
  const reasons = (surface: string, reason: string) => wait(surface, `d.querySelector('${note}')?.dataset.reasons.includes(${js(reason)})`);

  await changed(`qa.capture=true;qa.runs.A.recovery={state:'complete',reason:null,token:null};qa.clean();qa.partialPlans=false`);
  await reasons('panel', 'runs-not-loaded');
  // Load every record; totals that were already exact do not grow a plus merely for paging.
  await open();
  await guest('panel', `d.querySelector('[data-testid="incomplete-counts-more"]').addEventListener('click',()=>w.__countLoadClicked=true);return true`);
  await click('panel', '[data-testid="incomplete-counts-more"]');
  check('native Load more activation reaches its control', await guest('panel', `return w.__countLoadClicked===true`));
  await wait('panel', `!d.querySelector('${note}')`);
  check('completed Load more hands keyboard focus to More', await guest('panel', `return d.activeElement?.dataset.testid==='more-trigger'`));
  check('complete counts have no indicator', await guest('panel', `return d.querySelector('[data-kind="finished"]')?.textContent==='4 finished'`));

  await changed(`qa.partialPlans=true;qa.runs.A.recovery={state:'partial',reason:null,token:'example-next'};qa.lose()`);
  await reasons('panel', 'recording-gap');
  check('several reasons produce one neutral last indicator', await guest('panel', `const n=d.querySelector('${note}');return d.querySelectorAll('${note}').length===1&&n===d.querySelector('main').lastElementChild&&!n.querySelector('[data-tone="warning"],[data-icon="warning"]')&&!d.querySelector('[data-testid="subagent-coverage-cue"]')&&n.textContent.includes('Counts may be incomplete.')`));
  check('history gap qualifies completed counts', await guest('panel', `return d.querySelector('[data-kind="finished"]').textContent==='4+ finished'`));
  // The new run revision retires loaded history rows. Reload those children before
  // testing history-only qualification; otherwise current activity is genuinely incomplete.
  if (await guest('panel', `return !d.querySelector('[data-testid="observed-more"]').open`)) await click('panel', '[data-testid="observed-more"] > summary');
  await click('panel', '[data-testid="subagent-more"]');
  await wait('panel', `!d.querySelector('${note}')?.dataset.reasons.includes('runs-not-loaded')`);
  check('history gap leaves fully covered current activity exact', await guest('panel', `const parts=[...d.querySelectorAll('[data-kind="running"],[data-kind="waiting"]')];return parts.length>0&&parts.every(n=>!n.textContent.includes('+'))`));
  await guest('panel', `w.focus();d.querySelector('${toggle}').focus();return true`); await key('Enter');
  await wait('panel', `d.querySelector('${toggle}').getAttribute('aria-expanded')==='true'`);
  check('keyboard expansion keeps focus and names the recording gap', await guest('panel', `const t=d.querySelector('${toggle}');return d.activeElement===t&&!d.querySelector('${body}').hidden&&d.getElementById(t.getAttribute('aria-controls'))===d.querySelector('${body}')&&d.querySelector('${body}').textContent.includes('recording gap')`));
  const remote = await send('Runtime.evaluate', { expression: `frame('panel').contentDocument.querySelector('${toggle}')` });
  const described = await send('DOM.describeNode', { objectId: remote.result.objectId });
  const tree = await send('Accessibility.getPartialAXTree', { backendNodeId: described.node.backendNodeId, fetchRelatives: false });
  check('expandable control has its accessible name and state', tree.nodes.some((n: any) => n.role?.value === 'button' && n.name?.value === 'Counts may be incomplete.' && n.properties?.some((p: any) => p.name === 'expanded' && p.value.value === true)), tree.nodes.map((n: any) => ({ role: n.role?.value, name: n.name?.value, properties: n.properties })));
  await send('Runtime.releaseObject', { objectId: remote.result.objectId });
  const posts = () => evaluate<number>(`qa.requests.filter(q=>q.surface==='panel'&&q.path.endsWith('/reconcile')).length`);
  const before = await posts(); await evaluate(`qa.hold=true;true`); await click('panel', '[data-testid="incomplete-counts-more"]');
  await wait('panel', `d.querySelector('[data-testid="incomplete-counts-more"]')?.getAttribute('aria-disabled')==='true'`);
  check('Load more requests one bounded history pass', await posts() === before + 1);
  await evaluate(`qa.hold=false;qa.release();true`);
  await changed(`qa.runs.A.recovery={state:'failed',reason:'budget',token:'example-retry'}`);
  await wait('panel', `d.querySelector('[data-testid="incomplete-counts-retry"]')`);
  check('failed load is outside the dismissible note with retry', await guest('panel', `return !d.querySelector('[data-testid="incomplete-counts-load-error"]').closest('${note}')`));

  await reasons('panel', 'recording-gap'); await open();
  await evaluate(`qa.dismissError='busy';true`); await click('panel', dismiss);
  await wait('panel', `d.querySelector('[data-testid="incomplete-counts-dismiss-error"]')`);
  check('failed acknowledgement keeps the note and focus', await guest('panel', `return !!d.querySelector('${note}')&&d.activeElement?.dataset.testid==='incomplete-counts-dismiss'`));
  await evaluate(`qa.dismissError=null;qa.holdDismiss=true;true`); await click('panel', dismiss);
  await wait('panel', `d.querySelector('${dismiss}')?.getAttribute('aria-disabled')==='true'`);
  await evaluate(`qa.lose();qa.holdDismiss=false;qa.releaseDismiss();true`);
  await wait('panel', `d.querySelector('[data-testid="incomplete-counts-dismiss-error"]')?.textContent.includes('newer recording gap')`);
  check('conflicting acknowledgement never hides a newer gap', await evaluate(`qa.stores['store-1'].sequence>qa.stores['store-1'].dismissed`));
  // After the next read the changed detection is a fresh reason set.
  await wait('panel', `d.querySelector('${dismiss}')?.getAttribute('aria-disabled')!=='true'`);
  await open(); await guest('panel', `w.focus();d.querySelector('${dismiss}').focus();return true`); await key('Enter');
  await wait('panel', `!d.querySelector('${note}')`);
  check('dismissed indicator hands keyboard focus to More', await guest('panel', `return d.activeElement?.dataset.testid==='more-trigger'`));
  check('successful dismissal acknowledges store-wide but keeps plus counts', await evaluate(`qa.stores['store-1'].sequence===qa.stores['store-1'].dismissed`) && await guest('panel', `return d.querySelector('[data-kind="finished"]').textContent==='4+ finished'`));
  check('failed read remains visible after indicator dismissal', await guest('panel', `return !!d.querySelector('[data-testid="incomplete-counts-retry"]')`));
  // Reload only the guest frame: the fixture's device store survives.
  await evaluate(`frame('panel').src='/ui/panel/index.html?reload='+Date.now();true`);
  await wait('panel', `d.querySelector('[data-testid="subagent-count"]')?.textContent.includes('4+ finished')`);
  check('dismissal survives a guest reload', await guest('panel', `return !d.querySelector('${note}')`));
  await changed(`qa.lose()`); await reasons('panel', 'recording-gap');
  check('new detection returns the indicator', true);
  await open(); await evaluate(`qa.storageError=true;true`); await click('panel', dismiss);
  await wait('panel', `d.querySelector('[data-testid="incomplete-counts-dismiss-error"]')`);
  check('failed device write is not presented as saved', await guest('panel', `return !!d.querySelector('${note}')`));
  await evaluate(`qa.storageError=false;true`); await click('panel', dismiss); await wait('panel', `!d.querySelector('${note}')`);

  // Old, migrated and legacy gaps stay reasons (and counts stay lower bounds), without an ack.
  for (const variant of ['old', 'migrated', 'legacy']) {
    await changed(`qa.partialPlans=false;qa.runs.A.recovery={state:'complete',reason:null,token:null};${variant === 'old' ? 'qa.lose();qa.advance(86400000)' : `qa.${variant}()`}`);
    await reasons('panel', 'recording-gap'); await open();
    const beforeAck = await evaluate<number>(`qa.requests.filter(q=>q.path.endsWith('/dismiss-loss')).length`);
    await click('panel', dismiss); await wait('panel', `!d.querySelector('${note}')`);
    check(`${variant} gap dismisses on device without store acknowledgement`, await evaluate<number>(`qa.requests.filter(q=>q.path.endsWith('/dismiss-loss')).length`) === beforeAck);
  }

  await changed(`qa.clock=0;qa.clean();qa.partialPlans=true;qa.capture=false`);
  await reasons('panel', 'plans-not-loaded'); await open();
  check('recording off keeps one separate line', await guest('panel', `return d.querySelectorAll('[data-testid="capture-off"]').length===1&&!d.querySelector('[data-testid="needs-you-capture-off"],[data-testid="subagent-coverage"][data-notes="capture-off"]')`));
  await click('panel', dismiss); await wait('panel', `!d.querySelector('${note}')`);
  check('recording-off line is not dismissible', await guest('panel', `return !!d.querySelector('[data-testid="capture-off"]')`));

  // Changed copy in EN/RU/zh-CN, real clicks/taps at phone and desktop sizes, both themes.
  await changed(`qa.capture=true;qa.partialPlans=false;qa.lose()`);
  await show('page', 1100);
  await wait('page', `d.querySelector('[data-testid="plan-row-plan-alpha"][data-source="src-local"]')`, 'board plan choice');
  await click('page', '[data-testid="plan-row-plan-alpha"][data-source="src-local"]');
  await wait('page', `d.querySelector('[data-testid="subagent-activity"]')`, 'board local plan');
  for (const [language, label] of [['en', 'Counts may be incomplete.'], ['ru', 'Числа могут быть неполными.'], ['zh-CN', '计数可能不完整。']]) {
    await evaluate(`qa.locale=${js(language)};qa.context('A');true`);
    for (const surface of ['panel', 'page']) for (const width of [1100, 390]) {
      await show(surface, width);
      await wait(surface, `d.querySelector('${toggle}')?.textContent===${js(label)}`);
      await open(surface);
      check(`${surface} ${language}: no horizontal overflow`, await guest(surface, `return d.documentElement.scrollWidth<=d.documentElement.clientWidth`));
      check(`${surface} ${language} ${width}: no zero-plus counts`, await guest(surface, `return !/\\b0\\+/.test(d.querySelector('[data-testid="subagent-activity"]')?.textContent??'')`));
      await shot(surface, `indicator-${surface}-${language}-${width}`);
    }
  }
  await evaluate(`qa.dark();qa.lose();qa.context('A');true`);
  await show('page', 390); await reasons('page', 'recording-gap'); await open('page');
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const xy = await evaluate<number[]>(`(()=>{const f=frame('page'),n=f.contentDocument.querySelector('${toggle}');n.scrollIntoView({block:'center'});const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return [a.x+b.x+a.width/2,a.y+b.y+a.height/2]})()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xy[0], y: xy[1], id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait('page', `d.querySelector('${toggle}').getAttribute('aria-expanded')==='false'`);
  check('phone tap toggles indicator', true); await open('page'); await shot('page', 'indicator-phone-dark');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  await guest('page', `w.focus();d.querySelector('${toggle}').focus();return true`); await key('Tab', true); await key('Tab');
  check('forced colours retain a visible keyboard focus outline', await guest('page', `return d.activeElement?.dataset.testid==='incomplete-counts-toggle'&&w.getComputedStyle(d.activeElement).outlineStyle==='solid'`));
  await send('Emulation.setEmulatedMedia', { features: [] });
  await evaluate(`qa.locale='en';qa.clock=0;qa.capture=true;qa.partialPlans=false;qa.clean();qa.context('A');true`);

  // Diagnostics follow the current held data, even though panels suppress the indicator DOM.
  for (const surface of ['panel', 'page']) {
    await show(surface, 1100);
    await wait(surface, `d.querySelector('[data-testid="subagent-activity"]')`);
    await click(surface, '[data-testid="settings-trigger"]');
    await click(surface, '[data-testid="more-troubleshooting"]');
    await wait(surface, `d.querySelector('[data-testid="reporting-support-preview"]')`);
    await click(surface, '[data-testid="advanced-details"] summary');
    const total = await evaluate<number>(`qa.runs.A.history.push({...qa.runs.A.history[0],id:'review-${surface}',childSessionId:'review-${surface}'});qa.lose();qa.bump();qa.runs.A.history.length`);
    await wait(surface, `d.querySelector('[data-testid="incomplete-counts-details"]')?.textContent.includes('historical-sessions=${total}')&&d.querySelector('[data-testid="incomplete-counts-details"]')?.textContent.includes('recording-gap')`, 'live troubleshooting count facts');
    check(`${surface}: Advanced details refresh without painting an indicator`, await guest(surface, `return !d.querySelector('${note}')&&d.querySelector('[data-testid="advanced-details"]').open`));
    await guest(surface, `Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{w.reviewSupport=text}}});return true`);
    await click(surface, '[data-testid="reporting-support-copy"] button');
    await wait(surface, `d.defaultView.reviewSupport?.includes('historical-sessions=${total}')`);
    check(`${surface}: copied support uses the updated reason and totals`, await guest(surface, `return w.reviewSupport.includes('recording-gap')`));
    await click(surface, '[data-testid="surface-panel-back"] button');
  }
  await evaluate(`qa.clean();qa.context('A');true`);
}
