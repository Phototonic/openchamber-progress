// Native continuity for the board's reading-owned dropdowns. Only the open select
// moves; the surrounding panel/warnings/results are always the fresh paint.
import { mountSelect } from '@openchamber/sdk/ui';

type Props = Parameters<typeof mountSelect>[1];
type MoveParent = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
type Select = { props: Props; current: () => boolean; control: ReturnType<typeof mountSelect>; change: (value: string) => void };
const selects = new WeakMap<HTMLElement, Select>();

export function mountLiveSelect(root: HTMLElement, props: Props, current: () => boolean = () => true) {
  const entry = { props, current } as Select;
  entry.change = value => { if (root.isConnected && entry.current()) entry.props.onChange(value); };
  entry.control = mountSelect(root, { ...props, onChange: entry.change });
  selects.set(root, entry);
}

/** Both roots must be connected; moveBefore keeps native focus/popup state intact.
 * A changed account/store/mode or closed panel cannot reuse the old control.
 * Props and callbacks are refreshed before accepting any subsequent interaction.
 */
export function preserveLiveSelects(previous: HTMLElement, next: HTMLElement) {
  const before = previous.querySelector<HTMLElement>('[data-live-popup]');
  const after = next.querySelector<HTMLElement>('[data-live-popup]');
  if (!before || !after || before.dataset.livePopup !== after.dataset.livePopup || after.querySelector<HTMLElement>('[role="dialog"]')?.hidden !== false) return;
  for (const holder of before.querySelectorAll<HTMLElement>('[data-testid]')) {
    const entry = selects.get(holder);
    if (!entry || !holder.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')) continue;
    const fresh = [...after.querySelectorAll<HTMLElement>('[data-testid]')].find(n => n.dataset.testid === holder.dataset.testid);
    const replacement = fresh && selects.get(fresh);
    const parent = fresh?.parentElement as MoveParent | null | undefined;
    if (!fresh || !replacement || !parent || typeof parent.moveBefore !== 'function') continue;
    parent.moveBefore(holder, fresh);
    entry.props = replacement.props;
    entry.current = replacement.current;
    entry.control.update({ ...entry.props, onChange: entry.change });
    replacement.control.dispose();
    selects.delete(fresh);
    fresh.remove();
  }
  // Native selects need no SDK state. Preserve them only while their options and
  // selected value are unchanged; changed choices must never leave a stale menu.
  const active = previous.ownerDocument.activeElement;
  if (!(active instanceof HTMLSelectElement) || !before.contains(active)) return;
  const fresh = [...after.querySelectorAll('select')].find(n => n.dataset.testid === active.dataset.testid && n.name === active.name);
  const parent = fresh?.parentElement as MoveParent | null | undefined;
  if (fresh && parent && typeof parent.moveBefore === 'function' && fresh.innerHTML === active.innerHTML && fresh.value === active.value && fresh.disabled === active.disabled) {
    parent.moveBefore(active, fresh); fresh.remove();
  }
}
