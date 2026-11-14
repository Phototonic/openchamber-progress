// Phone presentation for the rail panel and the full page (docs/ui.md, Phone layout).
// One owner: optional host device hints become document attributes/variables
// (PHONE_LAYOUT_HOOKS) and the CSS below reads them, with responsive media queries and
// env() as the fallback when a host omits them. Hints are presentation only: never identity,
// permission, visibility or read evidence, and they never trigger a read.
// Work Status (sidebar card) and the dependency map keep their own owners: the status surface is
// excluded here, and map controls (inside `.ap-map`) are styled by the map's own module.
import type { DeviceView } from './model.ts';
import { PHONE_LAYOUT_HOOKS } from './components.ts';

/** Minimum coarse-pointer target, CSS pixels (host contract: "at least 44px tall"). */
export const PHONE_TARGET_PX = 44;
/** At or below this width the board and rail use the compact phone spacing. */
export const PHONE_MAX_WIDTH_PX = 480;
/** Larger values are not plausible screen insets or keyboard heights; treated as absent. */
const MAX_HINT_PX = 4096;

const FORM_FACTORS: readonly string[] = ['phone', 'tablet', 'desktop'];
const POINTERS: readonly string[] = ['coarse', 'fine'];
const INSETS = [['top', 'safeTop'], ['right', 'safeRight'], ['bottom', 'safeBottom'], ['left', 'safeLeft']] as const;

const px = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_HINT_PX ? `${Math.round(value * 100) / 100}px` : null;

/**
 * Applies (or, with no device, removes) the presentation hooks on `root`, normally the document
 * element. Idempotent; unknown or malformed values remove that hook rather than guessing one, so
 * the responsive CSS fallback stays in force. Call on every host ready (the host re-sends it on
 * rotation and keyboard changes).
 */
export function applyDeviceHooks(root: HTMLElement, device: DeviceView | undefined | null): void {
  const d = device && typeof device === 'object' ? device : null;
  const attr = (name: string, value: unknown, allowed: readonly string[]) => {
    if (typeof value === 'string' && allowed.includes(value)) { if (root.getAttribute(name) !== value) root.setAttribute(name, value); }
    else root.removeAttribute(name);
  };
  const variable = (name: string, value: string | null) => {
    if (value === null) root.style.removeProperty(name);
    else if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  };
  attr(PHONE_LAYOUT_HOOKS.formFactor, d?.formFactor, FORM_FACTORS);
  attr(PHONE_LAYOUT_HOOKS.pointer, d?.pointer, POINTERS);
  const insets = d?.insets && typeof d.insets === 'object' ? d.insets : null;
  for (const [side, hook] of INSETS) variable(PHONE_LAYOUT_HOOKS[hook], px(insets?.[side]));
  variable(PHONE_LAYOUT_HOOKS.keyboard, px(d?.keyboard));
}

const H = PHONE_LAYOUT_HOOKS;
const safe = (side: 'top' | 'right' | 'bottom' | 'left', hook: string) => `var(${hook},env(safe-area-inset-${side},0px))`;
const SAFE_L = safe('left', H.safeLeft), SAFE_R = safe('right', H.safeRight), SAFE_B = safe('bottom', H.safeBottom);
const KEYBOARD = `var(${H.keyboard},0px)`;
const T = `${PHONE_TARGET_PX}px`;
/** Panel and page only; Work Status keeps its compact, auto-height card. */
const SURFACES = `:not([data-oc-surface="status"])`;

/** Coarse-pointer rules, emitted twice: under the media query unless the host says the pointer is
 * fine, and under the host's coarse hint whatever the media query says. Map controls are excluded. */
const COARSE_RULES = `
.oc-sdk-btn:not(.ap-map *),.oc-sdk-trigger:not(.ap-map *),.oc-sdk-tab:not(.ap-map *),.oc-sdk-input:not(.ap-map *){height:auto;min-height:${T}}
.oc-sdk-btn:not(.ap-map *),.oc-sdk-tab:not(.ap-map *){min-width:${T}}
.oc-sdk-option,.oc-sdk-row,[role="menuitem"]{min-height:${T}}
.oc-sdk-input:not(.ap-map *),textarea:not(.ap-map *),input:not([type="checkbox"]):not([type="radio"]):not(.ap-map *){font-size:max(16px,1em)}
.ap-actions .oc-sdk-btn.ap-actions-btn{min-width:${T};height:${T}}
.ap-title-picker .oc-sdk-trigger,.ap-focus-participant .oc-sdk-trigger{height:auto;min-height:${T};min-width:${T}}
.ap-state-chip,.ap-chip-remove,.ap-rcopy-open,.ap-sub-cue,.ap-filters-trigger,.ap-fold-toggle,.ap-hit{min-height:${T}}
.ap-filters-trigger{height:auto}
.ap-info-btn{width:${T};height:${T}}
.ap-rfacts-term .ap-info-btn{width:${T};height:${T}}
.ap-link:not(.ap-map *){display:inline-flex;align-items:center;min-height:${T};min-width:${T}}
.ap-trow>summary.ap-trow-line,.ap-obs-x>summary.ap-obs-line,.ap-fold>summary,.ap-group>summary{min-height:${T}}
:is(.ap-details,.ap-doc,.ap-health-details,.ap-obs-more,.ap-digest-entry)>summary{min-height:${T};min-width:${T};padding-top:13px;padding-bottom:13px;line-height:18px}
.ap-chip>b{white-space:normal;overflow-wrap:anywhere}
`;
const scoped = (prefix: string) => COARSE_RULES.trim().split('\n').map((rule) => {
  const brace = rule.indexOf('{');
  return rule.slice(0, brace).split(/,(?![^(]*\))/).map((s) => `${prefix} ${s.trim()}`).join(',') + rule.slice(brace);
}).join('\n');

export const PHONE_CSS = `
/* Phone layout (phone-layout.ts). Desktop without hints is unchanged: every inset/keyboard term is 0. */
html${SURFACES}{scroll-padding-bottom:calc(${SAFE_B} + ${KEYBOARD})}
.ap[data-surface="panel"]{padding-left:max(14px,${SAFE_L});padding-right:max(14px,${SAFE_R});padding-bottom:calc(16px + ${SAFE_B} + ${KEYBOARD})}
.ap[data-surface="page"]{padding-left:max(22px,${SAFE_L});padding-right:max(22px,${SAFE_R});padding-bottom:calc(22px + ${SAFE_B} + ${KEYBOARD})}
@media(max-width:${PHONE_MAX_WIDTH_PX}px){
.ap[data-surface="page"]{padding-top:12px;padding-left:max(12px,${SAFE_L});padding-right:max(12px,${SAFE_R});gap:14px}
.ap[data-surface="page"] .ap-detail{padding:12px}
.ap[data-surface="page"] .ap-board{gap:14px}
/* Current/Archived wrap (Russian, 200% zoom) instead of widening the board */
.ap-board-bar>[data-testid="cleanup-modes"]{flex:0 1 auto;max-width:100%}
.ap-board-bar>[data-testid="cleanup-modes"] .oc-sdk-btn{height:auto;min-height:32px;max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:start}
}
/* A phone in landscape keeps the single board column: no sticky side list in a short window */
html[${H.formFactor}="phone"] .ap-board{grid-template-columns:minmax(0,1fr)}
html[${H.formFactor}="phone"] .ap-plan-list{position:static;max-height:none;overflow:visible}
@media(pointer:coarse){
${scoped(`html:not([${H.pointer}="fine"])${SURFACES}`)}
}
${scoped(`html[${H.pointer}="coarse"]${SURFACES}`)}
`;
