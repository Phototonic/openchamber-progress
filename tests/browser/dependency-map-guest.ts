// Test-only entry; bundled only into a disposable preview, never a production guest.
import { startView, type ViewContext } from '../../ui/shared/app.ts';
import { contextListScope, contextScope } from '../../ui/shared/scope.ts';
import { DependencyMap } from '../../ui/shared/dependency-map.ts';
import { DependencyMapLayout } from '../../ui/shared/dependency-map-layout.ts';
import { createDependencyMapView } from '../../ui/shared/dependency-map-view.ts';
type Ui = { plan: string; selected: string | null; group: string | null };
const rail = location.pathname.includes('/panel/');
const view = createDependencyMapView(), geometry = new DependencyMapLayout();
let latest: ViewContext<Ui> | null = null;
// Frame-local presentation measurement, retained across controller root replacement.
// Until the canvas is measured, use a conservative single-card row, not the frame width.
let canvasWidth = 0;
addEventListener('resize', () => latest?.setUi({}));
const map = new DependencyMap(current => latest!.service(current), () => latest?.setUi({}));
const plans = (vc: ViewContext<Ui>) => { if (!vc.read) return []; const bound = vc.read.plans.filter(p => p.sourceId === vc.read!.binding.sourceId); if (!rail) return bound; const s = contextScope(bound, vc.session?.id, vc.directory); return s.kind === 'none' ? [] : s.plans; };
const current = (vc: ViewContext<Ui>) => plans(vc).find(p => p.id === vc.ui.plan) ?? plans(vc)[0];
startView<Ui>({
  surface: rail ? 'panel' : 'page', maxSessionSubscriptions: 0,
  initialUi: () => ({ plan: 'P-map', selected: null, group: null }),
  scope: ({ session, directory }) => rail ? contextListScope(session?.id, directory) : {},
  wantProjects: () => [], wantDetails: vc => { const p = current(vc); return p ? [p] : []; },
  refreshed: vc => vc.setUi({}),
  reading: vc => { const p = current(vc); return p ? { plan: p.key, scope: rail ? `rail:${vc.session?.id}` : 'board:all' } : null; },
  retire: reason => { if (reason === 'dispose') { map.dispose(); view.dispose(); } else if (reason === 'hidden') map.pause(); else { map.reset(); geometry.clear(); } },
  paint(root, vc) {
    latest = vc;
    const picker = document.createElement('select'); picker.dataset.testid = 'map-plan'; picker.setAttribute('aria-label', 'Preview plan');
    for (const p of plans(vc)) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.title; picker.append(o); } picker.value = vc.ui.plan; picker.onchange = () => { map.reset(); geometry.clear(); vc.setUi({ plan: picker.value, selected: null, group: null }); }; root.append(picker);
    const p = current(vc); if (!p || !vc.read) return;
    map.reconcile({ account: vc.ctx.connection?.account ?? '', scope: rail ? `rail:${vc.session?.id}` : 'board:all', read: vc.read, plan: p, detail: vc.detailResult(p), health: vc.health, refreshSerial: vc.refreshSerial, active: true, visible: document.visibilityState !== 'hidden', failure: vc.failure });
    const snapshot = map.value;
    const layout = snapshot.picture && innerWidth > 0 ? geometry.compute(snapshot.picture.graph.items, { width: 220, height: 100, columnGap: 70, rowGap: 25 }, canvasWidth || 220) : null;
    const host = document.createElement('div'); host.dataset.testid = 'preview-map-host'; host.dataset.canvasWidth = String(canvasWidth); root.append(host);
    view.update({ ...snapshot, frame: rail ? 'rail' : 'board', layout, facts: snapshot.picture?.facts ?? null, status: vc.reading?.status ?? 'all', group: vc.ui.group, selected: vc.ui.selected,
      onSelect: selected => vc.setUi({ selected }), onStatus: status => vc.reading?.set({ status }), onGroup: group => vc.setUi({ group }),
      onCanvasWidth: width => { if (!Number.isFinite(width) || width <= 0 || width === canvasWidth) return; canvasWidth = width; latest?.setUi({}); },
      onRetry: () => { map.pause(); vc.setUi({}); vc.retry(); }, onList: () => {} }); view.mount(host);
  },
});
