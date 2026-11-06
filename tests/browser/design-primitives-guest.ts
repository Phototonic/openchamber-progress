// Supplemental test guest only: mounts the real primitives and real guest stylesheet.
import { CSS } from '../../ui/shared/style.ts';
import { icon, infoDisclosure, planActions, segmentedBar, stateChip, statusMark } from '../../ui/shared/primitives.ts';
// Live window/document listeners, so retirement checks can prove nothing leaks.
const live: [EventTarget, string, unknown, boolean][] = [];
const capture = (o: unknown) => (typeof o === 'boolean' ? o : !!(o as AddEventListenerOptions | undefined)?.capture);
const at = (t: EventTarget, type: string, fn: unknown, o: unknown) => live.findIndex((l) => l[0] === t && l[1] === type && l[2] === fn && l[3] === capture(o));
const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;
EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: any, o?: any) { if ((this === window || this === document) && fn && at(this, type, fn, o) < 0) live.push([this, type, fn, capture(o)]); return addListener.call(this, type, fn, o); };
EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: any, o?: any) { const i = at(this, type, fn, o); if (i >= 0) live.splice(i, 1); return removeListener.call(this, type, fn, o); };
const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
const root = document.getElementById('root')!;
root.style.padding = '16px';
const outside = document.createElement('button'); outside.id = 'outside'; outside.textContent = 'Outside'; root.append(outside);
const link = document.createElement('a'); link.href = '#help'; link.textContent = 'Read fixture explanation';
const info = infoDisclosure({ label: 'About fixture readiness', content: link }); root.append(info.root);
let toggles = 0, pressed = false;
const chipMount = document.createElement('div'); root.append(chipMount);
const renderChip = () => {
  const chip = stateChip({ state: 'blocked', count: 1, label: 'Needs you', pressed, onToggle: () => { toggles++; pressed = !pressed; chip!.setAttribute('aria-pressed', String(pressed)); } });
  chipMount.replaceChildren(chip!);
};
renderChip();
root.append(stateChip({ state: 'done', count: 3, label: 'Done' })!);
const marks = document.createElement('div'); marks.id = 'marks';
for (const status of ['pending', 'working', 'blocked', 'done', 'skipped', 'ready', 'waiting'] as const) marks.append(statusMark(status));
root.append(marks, statusMark('working', { decorative: true, className: 'decorative' }), icon('info', 'Fixture information'), icon('close'));
root.append(segmentedBar({ done: 3, total: 8, working: 2, blocked: 1 }, '3 of 8 done; 2 reported working; 1 blocked; 2 pending')!);
let selected = '';
const makeMenu = () => planActions({ items: [{ id: 'details', label: 'Details' }, { id: 'document', label: 'Plan document' }], onSelect: id => { selected = id; } });
let menu = makeMenu();
root.append(menu.root);
// A right-edge disclosure restored open by a repaint: built detached with open:true, then attached.
const edge = document.createElement('div'); edge.id = 'edge'; edge.style.display = 'flex'; edge.style.justifyContent = 'flex-end';
let edgeInfo: ReturnType<typeof infoDisclosure> | null = null;
const restoreEdge = () => {
  edgeInfo?.dispose();
  edgeInfo = infoDisclosure({ open: true, label: 'About edge readiness', content: ['Based on recorded prerequisites only. Other prerequisites may not be recorded, so a task shown as ready may still wait on something.'] });
  edgeInfo.root.dataset.edge = '';
  if (!edge.isConnected) root.append(edge);
  edge.replaceChildren(edgeInfo.root);
};
Object.assign(window, { primitiveFixture: {
  zeroChip: stateChip({ state: 'done', count: 0, label: 'Done' }) === null,
  zeroBar: segmentedBar({ done: 0, total: 0, working: 0, blocked: 0 }, 'No tasks') === null,
  get toggles() { return toggles; }, get selected() { return selected; },
  get listeners() { return live.length; },
  restoreEdge,
  clearEdge() { edgeInfo?.dispose(); edgeInfo = null; edge.remove(); },
  /** Retire the menu while it is open and mount its replacement in the same place (a repaint). */
  remountMenu() { const next = makeMenu(); menu.root.before(next.root); menu.dispose(); menu.root.remove(); menu = next; },
  dispose() { info.dispose(); menu.dispose(); },
  retire() { info.dispose(); menu.dispose(); root.replaceChildren(outside); },
} });
