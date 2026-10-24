// Setup UI (plan T4). Every change shows the resolved folders, the service privilege and the
// separate capture lifecycle first, then needs an explicit confirmation. Controls act on the
// configured folders only; a different folder set goes through inspect + install/update.
import { mountBanner, mountCheckbox, mountTextField } from '@openchamber/sdk/ui';
import type { SetupAction } from './adapter.ts';
import type { ViewContext } from './app.ts';
import { button, el, partState, testid } from './components.ts';
import type { SetupSuggestions, SetupTargets, SetupView } from './model.ts';

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
  'store-permissions': 'The progress store folder must be private to you (permissions 700).',
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
/** The store folder suggested for a data folder: `<data>/openchamber-progress` (a folder of its own). */
export const deriveStore = (dataRoot: string) => {
  const d = dataRoot.trim();
  return d ? `${d.replace(/\/+$/, '')}/${STORE_SUFFIX}` : '';
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
  configRoot: 'Absolute path, usually …/.config/opencode',
  dataRoot: 'Absolute path, usually …/.local/share/opencode',
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
}

export const initialSetupUi = (): SetupUi => ({ form: { configRoot: '', dataRoot: '', storeRoot: '' }, edited: { configRoot: false, dataRoot: false, storeRoot: false }, review: null, confirm: null, ack: false, busy: false, error: null, notice: null });

type Host<U> = ViewContext<U & { setup: SetupUi }>;

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
  const set = (patch: Partial<SetupUi>) => vc.updateUi((u) => ({ setup: { ...u.setup, ...patch } }) as Partial<U & { setup: SetupUi }>);
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

  const run = async (action: SetupAction, targets: SetupTargets | null, confirmed: boolean, after: (r: SetupView) => Partial<SetupUi>) => {
    set({ busy: true, error: null, notice: null });
    const r = await vc.runSetup(action, targets, confirmed);
    if (r.ok) set({ busy: false, ...after(r.setup) });
    else set({ busy: false, error: r.code });
  };

  if (s.error) {
    const slot = testid(el('div'), 'setup-error');
    slot.dataset.code = s.error;
    slot.setAttribute('role', 'alert');
    mountBanner(slot, { tone: 'error', title: s.error === 'missing-folders' ? 'Folders needed' : 'Setup did not change anything', body: setupErrorText(s.error) });
    if (s.error === 'service-binding-unavailable' || s.error === 'service-binding-unavailable-capture-disabled') (slot.querySelector('.oc-sdk-banner-title') as HTMLElement | null)?.replaceChildren('Setup only partly finished');
    wrap.append(slot);
  }
  if (s.notice) {
    const slot = testid(el('div'), 'setup-notice');
    slot.setAttribute('role', 'status');
    mountBanner(slot, { tone: 'success', title: s.notice });
    wrap.append(slot);
  }

  // Review step: shown before any install/update confirmation.
  if (s.review) {
    const r = s.review;
    const card = testid(el('div', 'ap-setup-card'), 'setup-review');
    card.append(el('h3', 'ap-setup-title', r.action === 'install' ? 'Review before installing' : 'Review before updating'));
    const t = r.result.targets!;
    card.append(facts([...targetRows(t), ...(r.result.version ? [['Installed version', r.result.version] as [string, string]] : [])]));
    if (r.result.installed && r.action === 'install') card.append(el('p', 'ap-doc-warn', 'A companion is already installed in these folders. Use update instead.'));
    for (const d of r.result.diagnostics.filter((x) => x !== 'targets-unverified')) card.append(el('p', 'ap-note', setupDiagnosticText(d)));
    disclosure(card);
    const ack = testid(el('div'), 'setup-ack');
    mountCheckbox(ack, { label: r.action === 'install' ? 'I reviewed these folders and want to install the companion' : 'I reviewed these folders and want to update the companion', checked: s.ack, onChange: (checked) => set({ ack: checked }) });
    card.append(ack);
    const row = el('div', 'ap-row');
    button(row, 'setup-confirm', r.action === 'install' ? 'Install' : 'Update', () => {
      void run(r.action, r.targets, true, (res) => ({ review: null, ack: false, notice: res.activation === 'reload-required' ? null : 'Done.' }));
    }, 'default', !s.ack || s.busy || (r.action === 'install' && r.result.installed));
    button(row, 'setup-cancel', 'Cancel', () => set({ review: null, ack: false }), 'ghost', s.busy);
    card.append(row);
    wrap.append(card);
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
      if (!Object.values(targets).every((v) => v.startsWith('/'))) { set({ error: 'missing-folders' }); return; }
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
  if (phase === 'reload-required') status.append(testid(el('p', 'ap-doc-warn', 'Start a new OpenCode session or reload OpenCode to begin capturing. This view does not restart anything.'), 'setup-reload'));
  if (phase === 'removed') status.append(el('p', 'ap-note', 'The companion files were removed and capture is off. Recorded plans and history are kept in the progress store.'));
  if (phase === 'recovery' && info.recovery) {
    status.append(testid(el('p', 'ap-doc-warn', `An interrupted setup left ${info.recovery.stagedPackages + info.recovery.stagedActivations + info.recovery.stagedReleases} staged item(s). Nothing was cleaned up automatically. Run the same update again to finish it, or check the folders.`), 'setup-recovery'));
  }
  if (!info.verified) status.append(el('p', 'ap-doc-warn', 'These folders are not a verified OpenCode setup, so sessions cannot be linked across agents.'));
  if (info.targets) status.append(facts([...targetRows(info.targets), ...(info.version ? [['Version', info.version] as [string, string]] : [])]));
  for (const d of info.diagnostics) status.append(el('p', 'ap-note', setupDiagnosticText(d)));
  const row = el('div', 'ap-row');
  if (info.installed && info.captureEnabled !== false) button(row, 'setup-disable', 'Turn off capture', () => set({ confirm: 'disable', error: null, notice: null }), 'outline', s.busy);
  if (info.installed && info.captureEnabled === false) button(row, 'setup-enable', 'Turn capture back on', () => set({ confirm: 'enable', error: null, notice: null }), 'outline', s.busy);
  if (info.installed) {
    button(row, 'setup-update', 'Update companion', () => {
      void run('inspect', null, false, (res) => ({ review: { action: 'update', targets: null, result: res }, ack: false }));
    }, 'ghost', s.busy);
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

/** After install/update, until the service restarts: file installation is not activation proof. */
export function reloadNote<U>(vc: ViewContext<U>) {
  const s = vc.setup;
  if (!s || s.state !== 'ready' || s.value.activation !== 'reload-required') return null;
  return testid(el('p', 'ap-doc-warn', 'The companion was installed. Start a new OpenCode session or reload OpenCode so agents can report progress. This view does not restart anything.'), 'setup-reload');
}
