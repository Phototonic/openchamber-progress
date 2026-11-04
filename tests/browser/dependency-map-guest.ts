// Test-only entry; bundled only into a disposable preview, never a production guest.
import { startView, type ViewContext } from '../../ui/shared/app.ts';
import { contextListScope, contextScope } from '../../ui/shared/scope.ts';
import { DependencyMap, mapReadingKey, type MapClaim, type MapPicture } from '../../ui/shared/dependency-map.ts';
import { DependencyMapLayout } from '../../ui/shared/dependency-map-layout.ts';
import { createDependencyMapView, planViewSwitch, type MapInteractionBinding } from '../../ui/shared/dependency-map-view.ts';
import { DependencyMapInteraction, type MapInteractionCommand, type MapInteractionEvent } from '../../ui/shared/dependency-map-interaction.ts';
import { planDetail, revealCurrentTask } from '../../ui/shared/components.ts';
type Ui = { plan: string; selected: string | null; group: string | null; presentation: 'list' | 'map' };
const flags = globalThis as typeof globalThis & { __mapInteraction?: boolean; __mapLarge?: boolean; mapPreview?: unknown };
const interactive = !!flags.__mapInteraction;
const rail = location.pathname.includes('/panel/');
const view = createDependencyMapView(), geometry = new DependencyMapLayout();
let latest: ViewContext<Ui> | null = null;
// Frame-local presentation measurement, retained across controller root replacement.
// Until the canvas is measured, use a conservative single-card row, not the frame width.
let canvasWidth = 0;
let canvasHeight = 400, painting = false, listReveal: string | null = null;
let lastLayout: ReturnType<DependencyMapLayout['compute']> | null = null;
let lastGraph: MapPicture['graph'] | null = null, packedWidth = 0;
const cpu = { layout: [] as number[], render: [] as number[], layouts: 0 };
const commands: { type: string; text?: string }[] = [];
// Frame command sink: the shared view applies viewport/focus/capture/announcement; selection,
// filters and the list reveal are this frame's reading state.
const interaction = new DependencyMapInteraction(command => {
  commands.push({ type: command.type, ...(command.type === 'announce' ? { text: command.text } : {}) });
  if (commands.length > 200) commands.shift();
  view.command(command);
  if (command.type === 'selection' && !painting) latest?.setUi({ selected: command.id });
  if (command.type === 'filters') { latest?.reading?.set({ status: command.status }); if (!painting) latest?.setUi({ group: command.group }); }
  if (command.type === 'list') { listReveal = command.id; latest?.setUi({ presentation: 'list' }); }
});
const binding: MapInteractionBinding = { state: () => interaction.value, dispatch: event => interaction.dispatch(event), focusOwner: owns => interaction.focusOwner(owns) };
if (interactive) flags.mapPreview = {
  get state() { return interaction.value; }, get commands() { return commands; }, get cpu() { return cpu; },
  get coordinates() { return lastLayout ? Object.fromEntries(lastLayout.positions) : {}; },
  dispatch(event: MapInteractionEvent) { return interaction.dispatch(event); },
  listTarget(id: string) { interaction.listTarget(id); }, focusOwner(owns: boolean) { interaction.focusOwner(owns); },
  // Test-only: deliver a command straight to the shared view (e.g. a focus action whose target is absent) and repaint.
  viewCommand(command: MapInteractionCommand) { view.command(command); }, repaint() { latest?.setUi({}); },
};
addEventListener('resize', () => latest?.setUi({}));
const map = new DependencyMap(current => latest!.service(current), () => latest?.setUi({}));
const plans = (vc: ViewContext<Ui>) => { if (!vc.read) return []; const bound = vc.read.plans.filter(p => p.sourceId === vc.read!.binding.sourceId); if (!rail) return bound; const s = contextScope(bound, vc.session?.id, vc.directory); return s.kind === 'none' ? [] : s.plans; };
const current = (vc: ViewContext<Ui>) => plans(vc).find(p => p.id === vc.ui.plan) ?? plans(vc)[0];
startView<Ui>({
  surface: rail ? 'panel' : 'page', maxSessionSubscriptions: 0,
  initialUi: () => ({ plan: flags.__mapLarge ? 'P-large-dependencies' : 'P-map', selected: null, group: null, presentation: 'map' }),
  scope: ({ session, directory }) => rail ? contextListScope(session?.id, directory) : {},
  wantProjects: () => [], wantDetails: vc => { const p = current(vc); return p ? [p] : []; },
  refreshed: vc => vc.setUi({}),
  reading: vc => { const p = current(vc); return p ? { plan: p.key, scope: rail ? `rail:${vc.session?.id}` : 'board:all' } : null; },
  retire: reason => { if (reason === 'dispose') { map.dispose(); view.dispose(); interaction.reset(); } else if (reason === 'hidden') { map.pause(); interaction.leave(); } else { map.reset(); geometry.clear(); interaction.reset(); } },
  paint(root, vc) {
    latest = vc;
    const picker = document.createElement('select'); picker.dataset.testid = 'map-plan'; picker.setAttribute('aria-label', 'Preview plan');
    for (const p of plans(vc)) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.title; picker.append(o); } picker.value = vc.ui.plan; picker.onchange = () => { map.reset(); geometry.clear(); vc.setUi({ plan: picker.value, selected: null, group: null }); }; root.append(picker);
    const p = current(vc); if (!p || !vc.read) return;
    const claim: MapClaim = { account: vc.ctx.connection?.account ?? '', scope: rail ? `rail:${vc.session?.id}` : 'board:all', read: vc.read, plan: p, detail: vc.detailResult(p), health: vc.health, refreshSerial: vc.refreshSerial, active: !interactive || vc.ui.presentation === 'map', visible: document.visibilityState !== 'hidden', failure: vc.failure };
    if (interactive) {
      interaction.identify(mapReadingKey(claim));
      // Preview-only placement of the shared Plan view switch (production entries stay unwired until S5).
      root.append(planViewSwitch(vc.ui.presentation, mode => { if (mode === 'map') interaction.enter(document.hasFocus()); else interaction.leave(); vc.setUi({ presentation: mode }); }));
      if (vc.ui.presentation === 'map' && !interaction.value.active) interaction.enter(false);
      if (vc.ui.presentation === 'list') {
        map.pause();
        const article = planDetail(p, vc.env, { detail: vc.detail(p), document: { get: () => vc.document(p), request: () => vc.requestDocument(p) } }, { document: 'omit', reading: vc.reading });
        article.addEventListener('pointerdown', e => { const target = (e.target as Element).closest<HTMLElement>('li[data-testid^="item-"]'); if (target) interaction.listTarget(target.dataset.testid!.slice(5)); });
        article.addEventListener('focusin', e => { const target = e.target as HTMLElement; if (target.matches('li[data-nav-target][data-testid^="item-"]')) interaction.listTarget(target.dataset.testid!.slice(5)); });
        root.append(article); return;
      }
    }
    map.reconcile(claim);
    const snapshot = map.value;
    const layoutStart = performance.now();
    const graph = snapshot.picture?.graph ?? null, width = canvasWidth || 220;
    const reusable = interactive && graph === lastGraph && lastLayout && (lastLayout.edges.length > 0 || packedWidth === width);
    const layout = graph && innerWidth > 0 ? reusable ? lastLayout : geometry.compute(graph.items, { width: 220, height: 100, columnGap: 70, rowGap: 25 }, width) : null;
    if (interactive && layout && layout !== lastLayout) { cpu.layout.push(performance.now() - layoutStart); cpu.layouts++; }
    lastLayout = layout; lastGraph = graph; packedWidth = width;
    if (interactive && layout && snapshot.picture) {
      painting = true;
      const items = snapshot.picture.detail.detail.items, guidance = snapshot.current && snapshot.picture.detail.plan.lifecycle === 'active';
      interaction.reconcile({ identity: mapReadingKey(claim), layout, items, current: snapshot.current, guidance, working: guidance ? items.filter(n => n.kind === 'task' && n.status === 'working').map(n => n.id) : [], ready: guidance ? [...snapshot.picture.facts.tasks].filter(([, f]) => f.group === 'ready').map(([id]) => id) : [], status: vc.reading?.status ?? 'all', viewport: { width: canvasWidth || 220, height: canvasHeight } });
      painting = false;
    }
    const host = document.createElement('div'); host.dataset.testid = 'preview-map-host'; host.dataset.canvasWidth = String(canvasWidth); root.append(host);
    const renderStart = performance.now(), state = interaction.value;
    view.render(host, { ...snapshot, interaction: interactive ? binding : undefined, frame: rail ? 'rail' : 'board', layout, facts: snapshot.picture?.facts ?? null, status: vc.reading?.status ?? 'all', group: interactive ? state.group : vc.ui.group, selected: interactive ? state.selected : vc.ui.selected,
      onSelect: selected => interactive ? interaction.dispatch({ type: 'select', id: selected }) : vc.setUi({ selected }), onStatus: status => interactive ? interaction.dispatch({ type: 'filters', status }) : vc.reading?.set({ status }), onGroup: group => interactive ? interaction.dispatch({ type: 'filters', group }) : vc.setUi({ group }),
      onCanvasWidth: width => { if (interactive || !Number.isFinite(width) || width <= 0 || width === canvasWidth) return; canvasWidth = width; latest?.setUi({}); },
      onRetry: () => { map.pause(); vc.setUi({}); vc.retry(); }, onList: () => { if (interactive) interaction.leave(true); } });
    if (interactive) cpu.render.push(performance.now() - renderStart);
  },
  afterPaint(root, vc) {
    if (!interactive) return;
    const viewport = root.querySelector<HTMLElement>('[data-testid="map-viewport"]');
    if (viewport && (viewport.clientWidth !== canvasWidth || viewport.clientHeight !== canvasHeight)) { canvasWidth = viewport.clientWidth; canvasHeight = viewport.clientHeight; vc.setUi({}); }
    if (listReveal) { const id = listReveal; listReveal = null; const p = current(vc), article = root.querySelector<HTMLElement>('article.ap-plan'); if (p && article) revealCurrentTask(article, p, id, 'Selected map task'); }
  },
});
