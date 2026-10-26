// Setup UI (plan T4). Every change shows the resolved folders, the service privilege and the
// separate capture lifecycle first, then needs an explicit confirmation. Controls act on the
// configured folders only; a different folder set goes through inspect + install/update.
import { mountBanner, mountCheckbox, mountTextField } from '@openchamber/sdk/ui';
import type { SetupAction } from './adapter.ts';
import type { ViewContext } from './app.ts';
import { button, el, partState, testid } from './components.ts';
import type { CompanionUpdateView, SetupSuggestions, SetupTargets, SetupView } from './model.ts';

export type SetupPhase = 'unconfigured' | 'recovery' | 'reload-required' | 'removed' | 'disabled' | 'installed';

export function setupPhase(s: SetupView): SetupPhase {
  if (!s.configured) return 'unconfigured';
  if (s.recovery && (s.recovery.stagedPackages || s.recovery.stagedActivations || s.recovery.stagedReleases)) return 'recovery';
  if (s.activation === 'reload-required') return 'reload-required';
  if (!s.installed) return 'removed';
  if (s.captureEnabled === false) return 'disabled';
  return 'installed';
}

const ERROR_TEXT: Record<string, string> = {
  'missing-folders': 'Fill in all three folders as absolute paths.',
  'confirmation-required': 'Review the folders and confirm before anything changes.',
  'targets-unverified': 'These folders could not be verified. Use absolute paths to existing folders you own, without symbolic links.',
  'path-unverified': 'A folder path is not absolute, does not exist, or is not owned by you.',
  'symlink-escape': 'A folder path goes through a symbolic link, which setup refuses for safety.',
  collision: 'Something else already exists where the companion would be installed. Setup will not overwrite it.',
  'foreign-files': 'The install folder contains files setup did not create. Nothing was changed.',
  'modified-owned-files': 'Installed companion files were changed outside setup. They were left untouched.',
  'store-permissions': 'The progress store folder must be owned by you and private to your account.',
  'private-permissions': 'A folder used for progress must be owned by you and private to your account.',
  'windows-security-unavailable': 'Windows could not check folder ownership and privacy using its built-in PowerShell. Check that Windows PowerShell is available, then try again.',
  'not-installed': 'The companion is not installed in these folders.',
  'ownership-invalid': 'The installation does not match the folders this extension is set up for. Nothing was changed.',
  'payload-invalid': 'The companion packaged with this extension is incomplete. Reinstall the extension.',
  'installation-changed': 'The installation changed while updating. Check the folders again before retrying.',
  'service-binding-collision': 'This extension’s own setup record was changed outside setup. It was left untouched.',
  'service-binding-modified': 'This extension’s own setup record was changed outside setup. It was left untouched.',
  'service-binding-unavailable': 'The companion files were installed, but this extension could not record the setup.',
  'service-binding-unavailable-capture-disabled': 'The companion files were installed, but this extension could not record the setup, so capture was turned off to stay safe.',
  'action-invalid': 'That setup action is not available.',
  'arguments-invalid': 'The setup request was not accepted.',
  invalid: 'The setup request was not accepted. Check that all three folders are filled in.',
  'request-too-large': 'The setup request was too large.',
  'setup-unavailable': 'Setup is not available from this service.',
  storage: 'The progress store could not be opened.',
  busy: 'The progress store is busy. Try again in a moment.',
  corrupt: 'The progress store is damaged. It was left untouched.',
  schema: 'The progress store uses a newer format than this extension.',
  binding: 'This extension is not connected to a progress store yet.',
};

/** Plain-language text for a fixed SetupError code; unknown codes stay honest. */
export const setupErrorText = (code: string) => ERROR_TEXT[code] ?? `Setup could not finish (${code}).`;

const DIAGNOSTIC_TEXT: Record<string, string> = {
  'targets-unverified': 'These folders are not confirmed yet.',
  'rollback-payloads-retained': 'Earlier companion versions are kept for recovery.',
  'unreferenced-payloads-retained': 'Some unused companion versions are kept; nothing is deleted automatically.',
  'staged-payloads-present': 'An interrupted setup left staged files.',
  'service-binding-collision': 'This extension’s setup record could not be used.',
};
export const setupDiagnosticText = (code: string) => DIAGNOSTIC_TEXT[code] ?? ERROR_TEXT[code] ?? code;

export const PRIVILEGE_TEXT = 'The progress service runs on this computer with your full user access. The companion records progress only when an agent reports it; it never reads conversations.';
export const LIFECYCLE_TEXT = 'Capture is separate from this extension: it keeps running if you close, pause or uninstall the extension. Remove capture here before uninstalling this extension; uninstalling the extension alone leaves capture installed (the companion’s remove utility also works afterwards). Recorded history is always kept.';

const STORE_SUFFIX = 'openchamber-progress';
/** A form-level absolute-path check; the service owns canonicalization and safety checks. */
export const absoluteSetupPath = (value: string) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
/** The store folder suggested for a data folder: `<data>/openchamber-progress` (a folder of its own). */
export const deriveStore = (dataRoot: string) => {
  const d = dataRoot.trim();
  if (!d) return '';
  const windows = /^[A-Za-z]:[\\/]/.test(d);
  const separator = windows && d.includes('\\') ? '\\' : '/';
  return `${d.replace(windows ? /[\\/]+$/ : /\/+$/, '')}${separator}${STORE_SUFFIX}`;
};

/**
 * Prefill the unconfigured form. Precedence: configured targets (no form at all) > the user's own
 * edits, including a deliberate clear > suggestions. Only untouched fields change; an unknown (null)
 * hint never wipes an earlier prefill. The store follows the data folder only while the store is
 * untouched, so a store folder the user chose or cleared is never overwritten.
 */
export function applySuggestions(s: Pick<SetupUi, 'form' | 'edited'>, hints: SetupSuggestions | undefined) {
  if (!s.edited.configRoot && hints?.configRoot) s.form.configRoot = hints.configRoot.value;
  if (!s.edited.dataRoot && hints?.dataRoot) s.form.dataRoot = hints.dataRoot.value;
  if (!s.edited.storeRoot) {
    const fromHint = !s.edited.dataRoot && hints?.storeRoot ? hints.storeRoot.value : null;
    const derived = fromHint ?? deriveStore(s.form.dataRoot);
    if (derived || !s.form.storeRoot) s.form.storeRoot = derived;
  }
}

const PLAIN_HELP: Record<keyof SetupTargets, string> = {
  configRoot: 'Absolute path to your OpenCode global config folder',
  dataRoot: 'Absolute path to your OpenCode data folder',
  storeRoot: 'A private folder outside your projects; created if missing',
};

/** Plain-language provenance for a field's current value. Never claims a verified OpenCode setup. */
export function fieldHint(key: keyof SetupTargets, s: Pick<SetupUi, 'form' | 'edited'>, hints: SetupSuggestions | undefined) {
  if (s.edited[key] || !s.form[key]) return PLAIN_HELP[key];
  if (key === 'storeRoot') return 'Suggested inside the OpenCode data folder; created private if missing';
  const h = hints?.[key];
  if (h && h.value === s.form[key]) {
    return h.state === 'resolved'
      ? 'Found on this computer; not yet confirmed as your OpenCode folder'
      : 'Usual location on this computer; not found there or not confirmed';
  }
  return PLAIN_HELP[key];
}

/** The service's latest bundled-companion comparison, with the installed version it describes. */
export interface BundledComparison { update: CompanionUpdateView; version: string }

/** The comparison in a setup read, or null when it makes none (absent, not ready, no version). */
export const bundledComparison = (s: SetupView | null | undefined): BundledComparison | null => (s?.update && s.version ? { update: s.update, version: s.version } : null);

export interface SetupUi {
  form: SetupTargets;
  /** Fields the user has typed in (a cleared field counts); prefill never touches these. */
  edited: Record<keyof SetupTargets, boolean>;
  /** Inspect reply and the exact folders it describes; confirmation applies to these only. */
  review: { action: 'install' | 'update'; targets: SetupTargets | null; result: SetupView } | null;
  confirm: Extract<SetupAction, 'disable' | 'enable' | 'remove-capture'> | null;
  ack: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Where the last action started: the update notice in the reading order, or the setup surface. */
  from: 'notice' | 'setup';
}

export const initialSetupUi = (): SetupUi => ({ form: { configRoot: '', dataRoot: '', storeRoot: '' }, edited: { configRoot: false, dataRoot: false, storeRoot: false }, review: null, confirm: null, ack: false, busy: false, error: null, notice: null, from: 'setup' });

type Host<U> = ViewContext<U & { setup: SetupUi }>;

export type UpdateKind = 'upgrade' | 'rebuild' | 'downgrade';
export interface UpdateNotice { kind: UpdateKind; tone: 'info' | 'warning'; title: string; body: string; action: string }

/**
 * Plain-language notice when the bundled companion differs from the installed one. `current` and an
 * absent comparison show nothing: absence is no claim either way. A same-version rebuild is never
 * called newer, and a newer installed companion is a warning, never an upgrade prompt.
 */
export function updateNotice(s: SetupView | null | undefined): UpdateNotice | null {
  const u = s?.update;
  if (!s?.version || !u || u.state === 'current') return null;
  if (u.state === 'newer-installed') {
    return { kind: 'downgrade', tone: 'warning', title: 'Installed companion is newer than this extension', body: `Installed ${s.version} · bundled ${u.candidateVersion}. Nothing changes on its own. Choosing the bundled version would go back to an older companion; updating this extension is usually the better fix.`, action: 'Review' };
  }
  if (u.candidateVersion === s.version) {
    return { kind: 'rebuild', tone: 'info', title: 'Different companion build available', body: `This extension bundles a different build of version ${s.version}. Nothing changes until you review and confirm.`, action: 'Review update' };
  }
  return { kind: 'upgrade', tone: 'info', title: 'Companion update available', body: `Installed ${s.version} → bundled ${u.candidateVersion}. Nothing changes until you review and confirm.`, action: 'Review update' };
}

/**
 * Version facts for a review: the installed version from the inspect reply and, for an update, the
 * bundled version from the frame's latest setup read (inspect replies carry no comparison). A
 * comparison for another installed version is out of date, and a missing one makes no claim, so a
 * refused action whose re-read drops the comparison also drops it from the open review.
 */
export function reviewVersions(review: NonNullable<SetupUi['review']>, snap: BundledComparison | null): { rows: [string, string][]; kind: UpdateKind | 'same' | null; note: string | null } {
  const installed = review.result.version;
  const rows: [string, string][] = installed ? [['Installed version', installed]] : [];
  if (review.action !== 'update') return { rows, kind: null, note: null };
  if (!snap || !installed || snap.version !== installed) {
    return { rows, kind: null, note: 'The service has not compared the bundled companion with the installed one, so this review cannot say which version updating selects.' };
  }
  rows.push(['Bundled version', snap.update.candidateVersion]);
  if (snap.update.state === 'current') return { rows, kind: 'same', note: 'The bundled companion has the same files as the installed one, so updating changes nothing.' };
  const kind = updateNotice({ ...review.result, update: snap.update })!.kind;
  const note = kind === 'rebuild' ? 'Same version number, different files: updating selects the bundled files.'
    : kind === 'downgrade' ? 'The bundled companion is older than the installed one. Choosing it goes back to that version.' : null;
  return { rows, kind, note };
}

const UPDATE_EFFECT = 'Updating keeps these folders, your plans and history, and switches only the companion files. Agents use the new files once OpenCode loads the companion again.';
const SWITCH_EFFECT = 'Switching keeps these folders, your plans and history, and changes only the companion files. Agents use them once OpenCode loads the companion again.';
const RELOAD_TEXT = 'OpenCode has not loaded the current companion files yet. Restart OpenCode when convenient so agents use them; sessions already running may keep earlier files until then. This view does not restart anything.';

/** Shared setup state, actions and their bookkeeping for one place (`from`) in the frame. */
function controls<U>(vc: Host<U>, from: SetupUi['from']) {
  const set = (patch: Partial<SetupUi>) => vc.updateUi((u) => ({ setup: { ...u.setup, ...patch } }) as Partial<U & { setup: SetupUi }>);
  const run = async (action: SetupAction, targets: SetupTargets | null, confirmed: boolean, after: (r: SetupView) => Partial<SetupUi>) => {
    set({ busy: true, error: null, notice: null, from });
    const r = await vc.runSetup(action, targets, confirmed);
    if (r.ok) set({ busy: false, ...after(r.setup) });
    else set({ busy: false, error: r.code });
  };
  /** Update review over the configured folders. */
  const reviewUpdate = () => {
    void run('inspect', null, false, (res) => ({ review: { action: 'update', targets: null, result: res }, ack: false }));
  };
  return { set, run, reviewUpdate };
}

/** Setup feedback banners; `onDismiss` lets them be closed where no other control would clear them. */
function banners(parent: ParentNode, s: SetupUi, onDismiss?: () => void) {
  if (s.error) {
    const slot = testid(el('div'), 'setup-error');
    slot.dataset.code = s.error;
    slot.setAttribute('role', 'alert');
    mountBanner(slot, { tone: 'error', title: s.error === 'missing-folders' ? 'Folders needed' : 'Setup did not change anything', body: setupErrorText(s.error), ...(onDismiss ? { action: { label: 'Dismiss', onClick: onDismiss } } : {}) });
    if (s.error === 'service-binding-unavailable' || s.error === 'service-binding-unavailable-capture-disabled') (slot.querySelector('.oc-sdk-banner-title') as HTMLElement | null)?.replaceChildren('Setup only partly finished');
    parent.append(slot);
  }
  if (s.notice) {
    const slot = testid(el('div'), 'setup-notice');
    slot.setAttribute('role', 'status');
    mountBanner(slot, { tone: 'success', title: s.notice, ...(onDismiss ? { action: { label: 'Dismiss', onClick: onDismiss } } : {}) });
    parent.append(slot);
  }
}

/** Review step: shown before any install/update confirmation. */
function reviewCard<U>(vc: Host<U>, c: ReturnType<typeof controls<U>>) {
  const s = vc.ui.setup;
  const r = s.review!;
  const versions = reviewVersions(r, bundledComparison(vc.setup?.state === 'ready' ? vc.setup.value : null));
  const back = versions.kind === 'downgrade';
  const card = testid(el('div', 'ap-setup-card'), 'setup-review');
  card.dataset.action = r.action;
  if (versions.kind) card.dataset.kind = versions.kind;
  card.append(el('h3', 'ap-setup-title', r.action === 'install' ? 'Review before installing' : back ? 'Review before switching to the older companion' : 'Review before updating'));
  const t = r.result.targets!;
  card.append(facts([...targetRows(t), ...versions.rows]));
  if (versions.note) card.append(testid(el('p', back ? 'ap-doc-warn' : 'ap-note', versions.note), 'setup-review-versions'));
  if (r.result.installed && r.action === 'install') card.append(el('p', 'ap-doc-warn', 'A companion is already installed in these folders. Use update instead.'));
  if (r.action === 'update') card.append(el('p', 'ap-note', back ? SWITCH_EFFECT : UPDATE_EFFECT));
  for (const d of r.result.diagnostics.filter((x) => x !== 'targets-unverified')) card.append(el('p', 'ap-note', setupDiagnosticText(d)));
  disclosure(card);
  const ack = testid(el('div'), 'setup-ack');
  const label = r.action === 'install' ? 'I reviewed these folders and want to install the companion'
    : back ? 'I reviewed these folders and want to switch to the older bundled companion' : 'I reviewed these folders and want to update the companion';
  mountCheckbox(ack, { label, checked: s.ack, onChange: (checked) => c.set({ ack: checked }) });
  card.append(ack);
  const row = el('div', 'ap-row');
  button(row, 'setup-confirm', r.action === 'install' ? 'Install' : back ? 'Use bundled version' : 'Update', () => {
    void c.run(r.action, r.targets, true, (res) => ({ review: null, ack: false, notice: res.activation === 'reload-required' ? null : 'Done.' }));
  }, 'default', !s.ack || s.busy || (r.action === 'install' && r.result.installed));
  button(row, 'setup-cancel', 'Cancel', () => c.set({ review: null, ack: false, error: null }), 'ghost', s.busy);
  card.append(row);
  return card;
}

/** The update notice as a kit banner; `onReview` adds its action (the reading-order notice). */
function updateBanner(id: string, n: UpdateNotice, onReview?: () => void) {
  const slot = testid(el('div'), id);
  slot.dataset.kind = n.kind;
  mountBanner(slot, { tone: n.tone, title: n.title, body: n.body, ...(onReview ? { action: { label: n.action, onClick: onReview } } : {}) });
  slot.querySelector('.oc-sdk-banner-action button')?.setAttribute('data-testid', `${id}-review`);
  return slot;
}

function facts(rows: [string, string][]) {
  const dl = el('dl', 'ap-facts ap-setup-facts');
  for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', 'ap-mono', v));
  return dl;
}

const targetRows = (t: SetupTargets): [string, string][] => [
  ['Companion', `${t.configRoot}/plugins/agent-progress`],
  ['OpenCode data', t.dataRoot],
  ['Progress store', t.storeRoot],
];

function disclosure(parent: Element) {
  const box = testid(el('div', 'ap-setup-disclose'), 'setup-disclosure');
  box.append(el('p', '', PRIVILEGE_TEXT), el('p', '', LIFECYCLE_TEXT));
  parent.append(box);
}

/** The setup surface. `compact` is used inside the rail. */
export function setupBlock<U>(vc: Host<U>, options: { compact?: boolean } = {}) {
  const wrap = testid(el('section', 'ap-setup'), 'setup-panel');
  const s = vc.ui.setup;
  const c = controls(vc, 'setup');
  const { set, run } = c;
  // Feedback and a review started from the update notice stay with the notice (reloadNote).
  const mine = s.from !== 'notice';
  const state = vc.setup;
  if (!state) vc.requestSetup();
  // The service already says it is not set up: the form is usable at once; folder hints from the
  // setup reply fill untouched fields when (or if) they arrive.
  const early = (!state || state.state !== 'ready') && vc.health?.ready === false;
  if ((!state || state.state !== 'ready') && !early) {
    wrap.append(partState('setup-loading', 'setup status', state, vc.requestSetup));
    return wrap;
  }
  const info = state && state.state === 'ready' ? state.value : null;
  const phase: SetupPhase = info ? setupPhase(info) : 'unconfigured';
  wrap.dataset.phase = phase;

  if (mine) banners(wrap, s);

  if (mine && s.review) {
    wrap.append(reviewCard(vc, c));
    return wrap;
  }

  // Control confirmation: restates the configured folders and consequences.
  if (s.confirm && info?.targets) {
    const c = s.confirm;
    const card = testid(el('div', 'ap-setup-card'), `setup-confirm-${c}`);
    const title = { disable: 'Turn off capture?', enable: 'Turn capture back on?', 'remove-capture': 'Remove capture?' }[c];
    const body = {
      disable: 'Agents stop recording progress in every open OpenCode session using this setup. Existing plans and history stay.',
      enable: 'Agents can record progress again. Nothing else changes.',
      'remove-capture': 'Capture is turned off first, then the companion files are removed. Do this before uninstalling this extension; uninstalling the extension alone leaves capture installed. Plans, revisions and captured documents stay in the progress store. Changed files are left untouched.',
    }[c];
    card.append(el('h3', 'ap-setup-title', title), el('p', '', body), facts(targetRows(info.targets)));
    const row = el('div', 'ap-row');
    button(row, 'setup-confirm', { disable: 'Turn off capture', enable: 'Turn on capture', 'remove-capture': 'Remove capture' }[c], () => {
      void run(c, null, true, () => ({ confirm: null, notice: { disable: 'Capture is off.', enable: 'Capture is on.', 'remove-capture': 'Capture removed. History is kept.' }[c] }));
    }, c === 'enable' ? 'default' : 'destructive', s.busy);
    button(row, 'setup-cancel', 'Cancel', () => set({ confirm: null }), 'ghost', s.busy);
    card.append(row);
    wrap.append(card);
    return wrap;
  }

  if (phase === 'unconfigured') {
    const hints = info?.suggestions;
    applySuggestions(s, hints);
    wrap.append(el('h3', 'ap-setup-title', 'Set up agent progress'));
    wrap.append(el('p', 'ap-note', 'Choose your OpenCode global config and data folders and a private folder for the progress store. Nothing is written until you review and confirm.'));
    if (!info) {
      if (state?.state === 'error') wrap.append(partState('setup-loading', 'folder suggestions', state, vc.requestSetup));
      else wrap.append(testid(el('p', 'ap-note', 'Looking for your OpenCode folders on this computer…'), 'setup-hints-loading'));
    } else if (!hints || (!hints.configRoot && !hints.dataRoot)) {
      wrap.append(testid(el('p', 'ap-note', 'Your OpenCode folders could not be detected on this computer. Enter them below.'), 'setup-hints-unknown'));
    }
    for (const d of (info?.diagnostics ?? []).filter((x) => x !== 'targets-unverified')) wrap.append(el('p', 'ap-doc-warn', setupDiagnosticText(d)));
    const form = testid(el('div', 'ap-setup-form'), 'setup-form');
    const fields = {} as Record<keyof SetupTargets, ReturnType<typeof mountTextField>>;
    const field = (key: keyof SetupTargets, label: string) => {
      const holder = testid(el('div'), `setup-${key}`);
      holder.dataset.hint = s.edited[key] || !s.form[key] ? 'none' : key === 'storeRoot' ? 'derived' : hints?.[key]?.value === s.form[key] ? hints[key]!.state : 'none';
      // Typing updates the form in place (no repaint, caret untouched). A typed or cleared field is the
      // user's from then on; the store keeps following the data folder only while it is untouched.
      fields[key] = mountTextField(holder, {
        label, value: s.form[key], mono: true, helper: fieldHint(key, s, hints),
        onChange: (value) => {
          const setup = vc.ui.setup;
          setup.form[key] = value;
          setup.edited[key] = true;
          holder.dataset.hint = 'none';
          fields[key].update({ value, helper: fieldHint(key, setup, hints) });
          if (key === 'dataRoot' && !setup.edited.storeRoot) {
            setup.form.storeRoot = deriveStore(value);
            fields.storeRoot.update({ value: setup.form.storeRoot, helper: fieldHint('storeRoot', setup, hints) });
            const storeHolder = form.querySelector<HTMLElement>('[data-testid=setup-storeRoot]');
            if (storeHolder) storeHolder.dataset.hint = setup.form.storeRoot ? 'derived' : 'none';
          }
        },
      });
      const input = holder.querySelector('input');
      input?.setAttribute('data-keep', `setup-${key}`);
      input?.setAttribute('data-fixed', 'form'); // the form state is authoritative (a late prefill must land)
      input?.setAttribute('spellcheck', 'false');
      form.append(holder);
    };
    field('configRoot', 'OpenCode config folder');
    field('dataRoot', 'OpenCode data folder');
    field('storeRoot', 'Progress store folder');
    wrap.append(form);
    const row = el('div', 'ap-row');
    button(row, 'setup-inspect', 'Check these folders', () => {
      const f = vc.ui.setup.form;
      const targets = { configRoot: f.configRoot.trim(), dataRoot: f.dataRoot.trim(), storeRoot: f.storeRoot.trim() };
      if (!Object.values(targets).every(absoluteSetupPath)) { set({ error: 'missing-folders' }); return; }
      // Folders that already hold the companion (e.g. this extension was reinstalled and lost its
      // binding) are re-bound by updating; installing over them is refused.
      void run('inspect', targets, false, (res) => ({ review: { action: res.installed ? 'update' : 'install', targets, result: res }, ack: false }));
    }, 'default', s.busy);
    wrap.append(row);
    if (!options.compact) disclosure(wrap);
    return wrap;
  }
  if (!info) return wrap; // not reached: every other phase comes from a setup reply

  const status = testid(el('div', 'ap-setup-card'), 'setup-status');
  const headline = {
    installed: 'Capture is on', disabled: 'Capture is off', 'reload-required': 'Companion installed', removed: 'Capture removed', recovery: 'Setup was interrupted', unconfigured: '',
  }[phase];
  status.append(el('h3', 'ap-setup-title', headline));
  // The comparison is independent of the setup phase: an update can be available while a reload is
  // still pending, and the two notes stay distinct.
  const update = updateNotice(info);
  if (update) status.append(updateBanner('setup-update-notice', update));
  if (phase === 'reload-required') status.append(testid(el('p', 'ap-doc-warn', RELOAD_TEXT), 'setup-reload'));
  if (phase === 'removed') status.append(el('p', 'ap-note', 'The companion files were removed and capture is off. Recorded plans and history are kept in the progress store.'));
  if (phase === 'recovery' && info.recovery) {
    status.append(testid(el('p', 'ap-doc-warn', `An interrupted setup left ${info.recovery.stagedPackages + info.recovery.stagedActivations + info.recovery.stagedReleases} staged item(s). Nothing was cleaned up automatically. Run the same update again to finish it, or check the folders.`), 'setup-recovery'));
  }
  if (!info.verified) status.append(el('p', 'ap-doc-warn', 'These folders are not a verified OpenCode setup, so sessions cannot be linked across agents.'));
  if (info.targets) status.append(facts([...targetRows(info.targets), ...versionRows(info)]));
  for (const d of info.diagnostics) status.append(el('p', 'ap-note', setupDiagnosticText(d)));
  const row = el('div', 'ap-row');
  if (info.installed && info.captureEnabled !== false) button(row, 'setup-disable', 'Turn off capture', () => set({ confirm: 'disable', error: null, notice: null }), 'outline', s.busy);
  if (info.installed && info.captureEnabled === false) button(row, 'setup-enable', 'Turn capture back on', () => set({ confirm: 'enable', error: null, notice: null }), 'outline', s.busy);
  if (info.installed) {
    button(row, 'setup-update', update?.action ?? 'Update companion', c.reviewUpdate, update?.kind === 'upgrade' || update?.kind === 'rebuild' ? 'outline' : 'ghost', s.busy);
    button(row, 'setup-remove', 'Remove capture', () => set({ confirm: 'remove-capture', error: null, notice: null }), 'ghost', s.busy);
  } else if (info.targets) {
    const targets = info.targets;
    button(row, 'setup-reinstall', 'Install again', () => {
      void run('inspect', targets, false, (res) => ({ review: { action: 'install', targets, result: res }, ack: false }));
    }, 'outline', s.busy);
  }
  status.append(row);
  wrap.append(status);
  if (!options.compact) disclosure(wrap);
  return wrap;
}

/**
 * The "capture is off" note, worded from the established setup phase only: a removed companion
 * points to Install again, a disabled one to turning capture back on. Anything not established
 * (setup still loading, unreadable, interrupted or awaiting reload) gets no instruction.
 */
export function captureOffNote(setup: ViewContext<unknown>['setup']): { reason: 'removed' | 'disabled' | 'unknown'; text: string } {
  const phase = setup?.state === 'ready' ? setupPhase(setup.value) : null;
  if (phase === 'removed') return { reason: 'removed', text: 'Capture was removed, so no new progress is being recorded. Use Install again under Setup to record again.' };
  if (phase === 'disabled') return { reason: 'disabled', text: 'Capture is off, so no new progress is being recorded. Turn it back on under Setup.' };
  return { reason: 'unknown', text: 'Capture is off, so no new progress is being recorded.' };
}

/**
 * Version facts for the configured setup: the selected installed version, the bundled one when the
 * service compared them, and the folder's utility from the install when it differs.
 */
function versionRows(info: SetupView): [string, string][] {
  const rows: [string, string][] = [];
  const u = info.update;
  if (info.version) rows.push(['Installed version', info.version]);
  if (u) rows.push(['Bundled version', u.state === 'current' ? `${u.candidateVersion} · same files as installed` : u.candidateVersion]);
  if (u?.rootVersion && u.rootVersion !== info.version) rows.push(['Folder utility', `${u.rootVersion} · loader and remove script from when the companion was installed; updates keep it`]);
  return rows;
}

/**
 * Setup notes in the progress reading order (rail and page, above the plan): the companion update
 * notice with its review, then the pending-reload note. They are independent: an update can be
 * available while a reload is pending. The update notice clears only when the service reports the
 * bundled files selected, the reload note only when it observes them loaded. File installation is
 * never presented as activation, and nothing here restarts anything.
 */
export function reloadNote<U>(vc: Host<U>) {
  const out = document.createDocumentFragment();
  const s = vc.ui.setup;
  const info = vc.setup?.state === 'ready' ? vc.setup.value : null;
  const c = controls(vc, 'notice');
  const reviewing = s.from === 'notice' && !!s.review;
  if (s.from === 'notice') banners(out, s, reviewing ? undefined : () => c.set({ error: null, notice: null }));
  if (reviewing) {
    const wrap = testid(el('section', 'ap-setup'), 'update-review-panel');
    wrap.append(reviewCard(vc, c));
    out.append(wrap);
  } else {
    const n = updateNotice(info);
    if (n) out.append(updateBanner('update-notice', n, () => { if (!vc.ui.setup.busy) c.reviewUpdate(); }));
  }
  if (info?.activation === 'reload-required') out.append(testid(el('p', 'ap-doc-warn', RELOAD_TEXT), 'setup-reload'));
  return out.childNodes.length ? out : null;
}
