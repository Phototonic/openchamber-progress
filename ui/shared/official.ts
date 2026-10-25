// Official-main version notice (U2). It names only the official repository's main branch: this
// extension cannot see which source it was installed from, and the host remains the only updater.
// No one-click update, no Settings navigation, no claim about bundled or installed versions.
import { mountBanner } from '@openchamber/sdk/ui';
import { button, el, testid } from './components.ts';
import { relativeAge } from './format.ts';
import type { OfficialMainView } from './model.ts';
import { readExtensionUpdate, type ServiceHost } from './source.ts';

export const OFFICIAL_MAIN_DISMISSED_KEY = 'official-main-dismissed';

/**
 * A frame's official-main knowledge and dismissal. A check reads the reply and the stored dismissal
 * together; a dismissal the user makes while that check is in flight is newer than the stored value
 * it read, so it is kept (an edit counter, snapshotted when the check starts).
 */
export class OfficialMainState {
  value: OfficialMainView | null = null;
  dismissed: string | null = null;
  private edits = 0;
  dismiss(version: string) { this.dismissed = version; this.edits++; }
  /** Applies a finished check; true when what the view shows may have changed. */
  apply(snapshot: number, next: OfficialMainView | null, stored: unknown) {
    // Nothing un-dismisses, so an empty stored read never clears a local dismissal either.
    const dismissed = snapshot === this.edits && typeof stored === 'string' ? stored : this.dismissed;
    const changed = JSON.stringify([next, dismissed]) !== JSON.stringify([this.value, this.dismissed]);
    this.value = next;
    this.dismissed = dismissed;
    return changed;
  }
  /** One check: the service reply plus the stored dismissal. The caller decides whether to apply it (generation). */
  async check(host: ServiceHost, storage: { get: (key: string) => Promise<unknown> }) {
    const snapshot = this.edits;
    const [next, stored] = await Promise.all([readExtensionUpdate(host), storage.get(OFFICIAL_MAIN_DISMISSED_KEY).catch(() => undefined)]);
    return { next, apply: () => this.apply(snapshot, next, stored) };
  }
}

export interface OfficialMainNotice { candidate: string; installed: string; stale: boolean; checkedAt: string | null; diagnostic: OfficialMainView['diagnostic'] }

/** The notice to show, or null: only an availability not dismissed for that version. Unknown and not-newer show nothing. */
export function officialMainNotice(v: OfficialMainView | null, dismissed: string | null): OfficialMainNotice | null {
  if (!v || v.state !== 'available' || !v.candidateVersion || dismissed === v.candidateVersion) return null;
  return { candidate: v.candidateVersion, installed: v.installedVersion, stale: v.stale, checkedAt: v.checkedAt, diagnostic: v.diagnostic };
}

export const OFFICIAL_MAIN_HOWTO = 'If this extension was installed from the standard official Git URL, check for updates and update it in OpenChamber Settings → Extensions. A custom branch, tag, fork or ZIP install may not follow main, and this extension can’t tell which source it came from.';

const FAILED: Partial<Record<OfficialMainView['diagnostic'], string>> = { 'rate-limited': 'was rate-limited', timeout: 'timed out' };

export function officialMainText(n: OfficialMainNotice, locale: string, now = Date.now()) {
  const title = `Official main version ${n.candidate} available · This extension ${n.installed}`;
  const stale = n.stale && n.checkedAt ? `This may be out of date: the latest check ${FAILED[n.diagnostic] ?? 'did not succeed'}; last confirmed ${relativeAge(n.checkedAt, now, locale)}. ` : '';
  return { title, body: `${stale}${OFFICIAL_MAIN_HOWTO}` };
}

interface Hooks { officialMain: OfficialMainView | null; officialMainDismissed: string | null; dismissOfficialMain: (v: string) => void; openOfficialMain: () => void; env: { locale: string } }

/** Rail and page: a quiet info banner with the fixed official link, then Dismiss (this version only). */
export function officialMainBlock(vc: Hooks) {
  const n = officialMainNotice(vc.officialMain, vc.officialMainDismissed);
  if (!n) return null;
  const wrap = testid(el('section', 'ap-official'), 'extension-update-notice');
  wrap.dataset.stale = String(n.stale);
  wrap.dataset.version = n.candidate;
  const slot = el('div');
  mountBanner(slot, { tone: 'info', ...officialMainText(n, vc.env.locale), action: { label: 'View official main', onClick: vc.openOfficialMain } });
  slot.querySelector('.oc-sdk-banner-action button')?.setAttribute('data-testid', 'extension-update-open');
  wrap.append(slot);
  const row = el('div', 'ap-row');
  button(row, 'extension-update-dismiss', 'Dismiss', () => vc.dismissOfficialMain(n.candidate), 'ghost');
  wrap.append(row);
  return wrap;
}

/** Work Status: one compact line into the rail, where the notice and its directions are. */
export function officialMainLine(vc: Hooks, openRail: () => void) {
  const n = officialMainNotice(vc.officialMain, vc.officialMainDismissed);
  if (!n) return null;
  const b = testid(el('button', 'ap-link', `Official main ${n.candidate} available${n.stale ? ' · check out of date' : ''}`), 'extension-update-line');
  b.type = 'button';
  b.title = `${n.stale ? 'This may be out of date. ' : ''}This extension is ${n.installed}. Open progress for how to update.`;
  b.addEventListener('click', openRail);
  return b;
}
