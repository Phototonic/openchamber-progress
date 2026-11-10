// Guest CSS. Colours come only from host tokens written by applyHostReady.
export const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:var(--oc-bg);color:var(--oc-fg);font-family:var(--oc-font);font-size:13px;line-height:1.45}
body{overflow-wrap:break-word}
[data-oc-theme="dark"]{color-scheme:dark}[data-oc-theme="light"]{color-scheme:light}
h1,h2,h3,h4,p,ul,ol,dl,dd{margin:0}ul,ol{padding:0;list-style:none}
button{font:inherit}
.ap-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ap{display:flex;flex-direction:column;gap:16px;padding:14px 14px 16px;min-width:0}
.ap-muted{color:var(--oc-muted)}
.ap-small{font-size:11px}
.ap-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;min-width:0}
.ap-between{justify-content:space-between}
.ap-grow{flex:1 1 auto;min-width:0}
.ap-capture{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--oc-border);padding-top:16px;min-width:0}
.ap-capture-controls,.ap-capture-metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.ap-capture-metadata>div{display:flex;flex-direction:column;gap:4px;min-width:0}
.ap-capture-path{font-family:monospace;overflow-wrap:anywhere}
.ap-capture-diff{border:1px solid var(--oc-border);border-radius:6px;overflow:hidden;min-width:0}
.ap-capture-line{display:grid;grid-template-columns:13ch minmax(0,1fr);gap:8px;padding:4px 8px;border-left:3px solid transparent;color:var(--oc-fg);font-family:monospace}
.ap-capture-added{border-left-color:var(--oc-success);background:color-mix(in srgb,var(--oc-success) 9%,var(--oc-bg))}
.ap-capture-removed{border-left-color:var(--oc-warning);background:color-mix(in srgb,var(--oc-warning) 9%,var(--oc-bg))}
.ap-capture-number{font-family:monospace;white-space:pre;text-align:right}
.ap-capture-text{font-family:monospace;white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
.ap-capture-ending{grid-column:2;font-size:11px}
.ap-capture-context{padding:6px 10px;background:var(--oc-hover);font-size:11px}
@media(max-width:600px){.ap-capture-controls,.ap-capture-metadata{grid-template-columns:minmax(0,1fr)}}
@media(forced-colors:active){.ap-capture-diff{border-color:CanvasText}.ap-capture-added,.ap-capture-removed{border-left-color:CanvasText}}

/* Secondary reporting diagnostics: compact observations, optional explanations. */
.ap-health{display:flex;flex-direction:column;gap:10px;max-width:520px;min-width:0}
.ap-health-grid{border:1px solid var(--oc-border);border-radius:8px;overflow:hidden;background:var(--oc-bg)}
.ap-health-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);align-items:center;gap:12px;padding:8px 12px}
.ap-health-row+.ap-health-row{border-top:1px solid var(--oc-border)}
.ap-health-row dt{color:var(--oc-muted);font-size:12px}
.ap-health-status{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500}
.ap-health-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;border:1px solid currentColor;border-radius:50%;font-size:11px}
.ap-health-status[data-tone=good] .ap-health-mark{color:var(--oc-success-text,var(--oc-fg))}
.ap-health-status[data-tone=attention] .ap-health-mark{color:var(--oc-warning-text,var(--oc-fg))}
.ap-health-status[data-tone=neutral] .ap-health-mark{color:var(--oc-muted)}
.ap-health-details{border-top:1px solid var(--oc-border);padding-top:8px}
.ap-health-details summary{cursor:pointer;font-size:12px;min-height:28px;display:list-item;list-style:revert}
.ap-health-details[open]>:not(summary){margin-top:8px}
.ap-health-explanations dt{font-weight:600;margin-top:10px}
.ap-health-explanations dd{font-size:12px;color:var(--oc-muted);margin-top:3px}
.ap-health :is(summary,textarea,button):focus-visible{outline:2px solid var(--oc-focus,var(--oc-info));outline-offset:3px}

/* Inline, selectable summaries: no modal or automatic clipboard write. */
.ap-summary{display:flex;flex-direction:column;gap:10px;min-width:0}
.ap-summary-preview{display:flex;flex-direction:column;gap:10px;padding:12px;min-width:0;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-summary-label{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px}
.ap-summary-text{display:block;width:100%;min-width:0;max-width:100%;resize:vertical;padding:9px;border:1px solid var(--oc-border);border-radius:6px;background:var(--oc-bg);color:var(--oc-fg);font-family:var(--oc-font-mono,monospace);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.ap-summary button{max-width:100%;white-space:normal;min-height:28px}
.ap-summary :is(button,textarea):focus-visible{outline:2px solid var(--oc-info);outline-offset:2px}

/* Plan header and progress story */
.ap-plan{display:flex;flex-direction:column;gap:14px;min-width:0}
.ap-plan-head{display:flex;flex-direction:column;gap:4px}
.ap-plan-title{font-size:15px;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.ap-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;color:var(--oc-muted);font-size:11.5px}
.ap-meta>*+*::before{content:"·";margin-right:8px;color:var(--oc-muted)}
.ap-progress{display:flex;flex-direction:column;gap:8px}
.ap-fraction{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.ap-fraction strong{font-size:24px;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}
.ap-fraction span{color:var(--oc-muted)}
/* The kit progress look (SDK mountProgress): a 6px pill groove 6% of the text colour, pill fills.
   Ours keeps three static segments with 2px gaps; done is the kit's finished green. */
.ap-seg{display:flex;height:6px;border-radius:9999px;overflow:hidden;background:color-mix(in srgb,var(--oc-fg) 6%,transparent)}
.ap-seg>i{display:block;height:100%;min-width:3px;border-radius:9999px}
.ap-seg>i+i{margin-left:2px}
.ap-seg [data-k="done"]{background:var(--oc-success)}
.ap-seg [data-k="working"]{background:var(--oc-info)}
.ap-seg [data-k="blocked"]{background:var(--oc-warning)}
/* Forced colours: three distinct fills (solid, highlight, hatched) on an outlined track */
@media(forced-colors:active){.ap-seg{forced-color-adjust:none;border:1px solid CanvasText;background:Canvas}.ap-seg [data-k="done"]{background:CanvasText}.ap-seg [data-k="working"]{background:Highlight}.ap-seg [data-k="blocked"]{background:repeating-linear-gradient(45deg,CanvasText 0 2px,Canvas 2px 4px)}}

/* Reported in-progress work: readable blue status text. Motion only under [data-motion="on"]
   (active plan, working tasks, fresh read, capture on), on one shared 2.4 s phase (app.ts alignMotion).
   Decorative only: the bar width, counts and text never change with it.
   Text pulse: the text keeps the host's readable info-text colour; an identical overlay fades in
   towards the foreground, so every phase has at least the token's own contrast. */
.ap-working-text{color:var(--oc-info-text,var(--oc-info))}
[data-motion="on"] .ap-working-text{position:relative;display:inline-block;white-space:nowrap}
[data-motion="on"] .ap-working-text::after{content:attr(data-text) / "";position:absolute;inset:0;color:color-mix(in srgb,var(--oc-info-text,var(--oc-info)) 55%,var(--oc-fg));opacity:0;animation:ap-text-pulse 2.4s ease-in-out infinite}
[data-motion="on"] .ap-seg [data-k="working"]{position:relative;overflow:hidden}
[data-motion="on"] .ap-seg [data-k="working"]::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--oc-bg) 55%,transparent),transparent);transform:translateX(-100%);animation:ap-sheen 2.4s ease-in-out infinite}
[data-motion="on"] :is([data-testid="progress-group-now"],[data-testid="current-work"]) .ap-mark[data-status="working"] .ap-mark-core{transform-box:fill-box;transform-origin:center;animation:ap-dot-pulse 2.4s ease-in-out infinite}
@keyframes ap-text-pulse{0%,100%{opacity:0}50%{opacity:.9}}
@keyframes ap-sheen{0%{transform:translateX(-100%)}65%,100%{transform:translateX(100%)}}
@keyframes ap-dot-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.7)}}
[data-ap-hidden] *,[data-ap-hidden] *::before,[data-ap-hidden] *::after{animation:none!important}

.ap-elapsed{color:var(--oc-info-text,var(--oc-info));font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ap-elapsed[data-kind="unknown"]{color:var(--oc-muted)}

/* Section heading */
.ap-h{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--oc-muted)}
.ap-section{display:flex;flex-direction:column;gap:8px;min-width:0}

/* Item hierarchy */
.ap-items{display:flex;flex-direction:column}
.ap-items ul{display:flex;flex-direction:column}
.ap-group{border-radius:8px}
.ap-group>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 0 4px;font-weight:600}
.ap-group>summary::-webkit-details-marker{display:none}
.ap-group>summary::before{content:"";width:6px;height:6px;margin:0 6px 0 4px;border-right:1.5px solid var(--oc-muted);border-bottom:1.5px solid var(--oc-muted);transform:rotate(-45deg);transition:transform .12s}
.ap-group[open]>summary::before{transform:rotate(45deg)}
.ap-group>summary .ap-count{margin-left:auto;font-weight:400;font-size:11.5px;color:var(--oc-muted);font-variant-numeric:tabular-nums}
.ap-group>ul{margin-left:8px;padding-left:12px;border-left:1px solid var(--oc-border)}
summary:focus-visible,.ap-link:focus-visible,pre:focus-visible,.ap-tasks-h:focus-visible{outline:none;box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}
.ap-tasks-h:focus{outline:none}
/* Owning headings: programmatic focus targets of a hand-off (never Tab stops), so focus shows on :focus */
.ap-region-h{margin:0;padding:2px 4px;font-size:13px;font-weight:600;color:var(--oc-fg);border-radius:4px}
.ap-region-h:focus{outline:none;box-shadow:inset 0 0 0 2px var(--oc-focus)}
:is([data-testid="plan-title"],[data-testid="status-plan-title"],[data-testid="setup-status-heading"],[data-testid="setup-needed"],[data-testid="empty-state"],[data-testid="unscoped-state"]):focus{outline:none;box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}
.ap-handoff-notice{margin:0}
/* SDK widgets mark focus only with the hover tint (or not at all): the app adds a focus-token ring */
.ap-plan-list [role="listbox"]:focus-visible [role="option"][data-active="true"]{box-shadow:inset 0 0 0 2px var(--oc-focus)}
.ap-plan-list [role="listbox"]:focus-visible:not(:has([role="option"][data-active="true"])){outline:2px solid var(--oc-focus);outline-offset:-2px;border-radius:8px}
[data-testid="detail-tabs"] [role="tab"]:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
:is(.ap-focus,.ap-focus-empty,.ap-setup,[data-testid="open-detail"],[data-testid="setup-needed"],[data-testid="stale-banner"],[data-testid^="state-"]) .oc-sdk-btn:focus-visible,.ap-picker .oc-sdk-trigger:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-group>summary{flex-wrap:wrap;row-gap:2px}
.ap-group>summary .ap-grow{flex:1 1 0}
.ap-branch{display:flex;flex-wrap:wrap;gap:0 8px;width:100%;padding-left:24px;font-weight:400;font-size:11.5px;color:var(--oc-muted)}
.ap-branch>*+*::before{content:"·";margin-right:8px}
.ap-branch [data-k="working"]{color:var(--oc-info-text,var(--oc-info))}
.ap-branch [data-k="blocked"]{color:var(--oc-warning-text,var(--oc-warning))}
.ap-branch [data-k="lead"]+*::before{content:none}
.ap-context{font-weight:400;font-size:11px;color:var(--oc-muted)}
.ap-items li[hidden]{display:none!important}

/* Task view controls: one wrapping group at the Tasks heading; native buttons, ordinary tab order */
.ap-focus{display:flex;flex-direction:column;gap:6px;min-width:0}
.ap-focus-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;min-width:0}
.ap-focus-set{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
.ap-focus-notice:empty{display:none}
.ap-focus-participant{min-width:0;max-width:100%}
.ap-focus-participant .oc-sdk-select{flex-direction:row;align-items:center;gap:6px;min-width:0}
.ap-focus-participant .oc-sdk-field-label{flex:none;white-space:nowrap}
.ap-focus-participant .oc-sdk-trigger{min-width:0;max-width:min(16rem,100%);height:24px;padding:0 8px}
.ap-focus-participant .oc-sdk-trigger:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-focus-participant .oc-sdk-popup{width:min(22rem,calc(100vw - 16px));max-height:min(320px,calc(100vh - 40px))}
.ap-focus-participant .oc-sdk-option-label{white-space:normal;overflow-wrap:anywhere}
.ap-focus-participant .oc-sdk-option-hint{flex:0 1 auto;max-width:45%;white-space:normal}
/* Why a row matches the participant filter: recorded relationships, never inferred ownership */
.ap-reasons{display:flex;flex-wrap:wrap;gap:0 8px;font-weight:400;font-size:11.5px;color:var(--oc-muted)}
.ap-group>summary .ap-reasons{width:100%;padding-left:24px}
.ap-reasons>*+*::before{content:"·";margin-right:8px}
.ap-focus-empty{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:10px 12px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
/* Canonical task rows are navigation targets (tabindex -1): ring for keyboard focus or a readiness jump */
.ap-items li:focus{outline:none}
.ap-items li:focus-visible,.ap-items li[data-nav-target]:focus{outline:none;box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}

.ap-ready-link{overflow-wrap:anywhere;text-align:left;font-size:inherit}
.ap-ready-who b{font-weight:500;color:var(--oc-fg)}
/* A session link is softer than a recorded assignment: muted name, never the assignee styling */
.ap-ready-links{display:inline-flex;flex-direction:column;gap:2px}
.ap-ready-links .ap-ready-who b{color:inherit}
.ap-ready-none{font-size:11.5px;color:var(--oc-muted)}
.ap-ready-deps{display:flex;flex-direction:column;gap:2px;font-size:11.5px}
.ap-ready-dep{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px;min-width:0}
.ap-ready-dep .ap-glyph{width:12px;height:12px;font-size:8px;align-self:center;margin-top:0}
.ap-ready-ref{overflow-wrap:anywhere;font-family:var(--oc-mono);font-size:11px}
span.ap-ready-ref{font-family:inherit;font-size:inherit}
.ap-ny-cat{align-self:start;margin-top:1px;padding:0 7px;border:1px solid transparent;border-radius:999px;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap;background:color-mix(in srgb,var(--oc-warning) 16%,transparent);color:var(--oc-warning-text,var(--oc-fg))}
.ap-ny-cat:is([data-category="unknown"],[data-category="unclassified"]){background:color-mix(in srgb,var(--oc-fg) 7%,transparent);color:var(--oc-muted)}
@media(forced-colors:active){.ap-ny-cat{border-color:CanvasText}}

/* Shared primitives (primitives.ts, docs/ui.md Shared primitives). Host tokens only. Orange
   (warning/primary in many themes) is kept for Blocked, primary actions and focus, never for
   selection, links or decoration. */
/* Status marks: inline SVG, one shape per state + a spoken name (or adjacent words), never colour alone */
.ap-mark{display:inline-grid;place-items:center;flex:none;width:16px;height:16px;color:color-mix(in srgb,var(--oc-muted) 85%,transparent)}
.ap-mark-svg,.ap-icon-svg{display:block;width:100%;height:100%;overflow:visible}
.ap-mark:is([data-status="done"],[data-status="ready"]){color:var(--oc-success)}
.ap-mark[data-status="working"]{color:var(--oc-info)}
.ap-mark[data-status="blocked"]{color:var(--oc-warning)}
.ap-mark[data-status="skipped"]{color:var(--oc-muted)}
.ap-mark .ap-mark-cut{stroke:var(--oc-bg)}
.ap-mark circle.ap-mark-cut{fill:var(--oc-bg);stroke:none}
.ap-glyph{margin-top:1px}
/* A mark has no text baseline: in baseline-aligned rows it centres on the first line instead of lifting it */
.ap-status-row>.ap-mark{align-self:center;margin-top:0}
.ap-icon{display:inline-grid;place-items:center;flex:none;width:16px;height:16px}
@media(forced-colors:active){.ap-mark,.ap-icon{forced-color-adjust:none}.ap-mark[data-status],.ap-icon[data-icon]{color:CanvasText}.ap-mark .ap-mark-cut{stroke:Canvas}.ap-mark circle.ap-mark-cut{fill:Canvas}}

/* State chips: legend and (as toggle buttons) filter. Selection is neutral, not orange. */
.ap-state-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.ap-state-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:26px;padding:2px 10px 2px 7px;border:1px solid var(--oc-border);border-radius:999px;background:transparent;color:var(--oc-muted);font:inherit;font-size:12px;line-height:1.3;font-variant-numeric:tabular-nums;text-align:start}
.ap-state-chip .ap-mark{width:14px;height:14px}
.ap-state-chip-n{color:var(--oc-fg);font-weight:600}
.ap-state-chip-label{min-width:0;overflow-wrap:anywhere}
button.ap-state-chip{cursor:pointer}
button.ap-state-chip:hover{background:var(--oc-hover);border-color:color-mix(in srgb,var(--oc-fg) 22%,var(--oc-border))}
button.ap-state-chip[aria-pressed="true"]{background:var(--oc-selection,var(--oc-hover));border-color:color-mix(in srgb,var(--oc-fg) 55%,var(--oc-border));color:var(--oc-selection-fg,var(--oc-fg))}
button.ap-state-chip[aria-pressed="true"] .ap-state-chip-label{font-weight:500}
button.ap-state-chip:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
@media(forced-colors:active){.ap-state-chip{border-color:CanvasText}button.ap-state-chip[aria-pressed="true"]{border:2px solid Highlight;padding:1px 9px 1px 6px}}

/* ⓘ info disclosure: generic explanations only; opens on focus or click, never hover alone */
.ap-info{position:relative;display:inline-flex;vertical-align:middle;flex:none}
.ap-info-btn{display:inline-grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:var(--oc-muted);cursor:pointer}
.ap-info-btn .ap-icon{width:15px;height:15px}
.ap-info-btn:hover,.ap-info[data-open]>.ap-info-btn{background:var(--oc-hover);color:var(--oc-fg)}
.ap-info-btn:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
.ap-info-content{position:absolute;z-index:20;top:calc(100% + 4px);left:0;transform:translateX(var(--ap-info-shift,0px));width:max-content;max-width:min(20rem,calc(100vw - 16px));padding:10px 12px;border:1px solid var(--oc-border);border-radius:var(--oc-radius,10px);background:var(--oc-elevated,var(--oc-bg));color:var(--oc-elevated-fg,var(--oc-fg));box-shadow:0 8px 24px color-mix(in srgb,var(--oc-fg) 14%,transparent);font-size:12px;font-weight:400;line-height:1.5;letter-spacing:normal;text-transform:none;text-align:start;white-space:normal;overflow-wrap:anywhere}
.ap-info-content[hidden]{display:none}
.ap-info-content:focus{outline:none}
.ap-info-content p+p{margin-top:6px}
@media(forced-colors:active){.ap-info-content{border-color:CanvasText}}

/* ⋯ plan actions: the SDK menu with a visible ⋯ and a spoken "Plan actions" */
.ap-actions{display:inline-flex;flex:none}
/* The kit's own size rules load later; the extra class keeps a readable, foreground ⋯ */
.ap-actions .oc-sdk-btn.ap-actions-btn{min-width:28px;height:26px;padding:0 6px;color:var(--oc-fg);font-size:18px;font-weight:700;line-height:1}
.ap-actions .oc-sdk-btn:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
.ap-actions .oc-sdk-popup{min-width:min(13rem,calc(100vw - 16px))!important;max-width:calc(100vw - 16px);max-height:min(560px,calc(100vh - 16px))}
.ap-actions .oc-sdk-option-label{white-space:normal;overflow-wrap:anywhere}

/* Compact warnings: always visible, wrap rather than clip; words carry the meaning */
.ap-warn{display:flex;align-items:flex-start;gap:6px;min-width:0;font-size:11.5px;line-height:1.45;color:var(--oc-fg)}
.ap-warn>.ap-icon{width:14px;height:14px;margin-top:1px;color:var(--oc-warning-text,var(--oc-warning))}
.ap-warn[data-tone="error"]>.ap-icon{color:var(--oc-error-text,var(--oc-error))}
.ap-warn[data-tone="info"]>.ap-icon{color:var(--oc-info-text,var(--oc-info))}
.ap-warn-text{min-width:0;overflow-wrap:anywhere}
.ap-warn-badge{display:inline-flex;align-items:center;max-width:100%;padding:0 6px;border-radius:5px;font-size:11px;font-weight:500;line-height:18px;overflow-wrap:anywhere;background:color-mix(in srgb,var(--oc-warning) 14%,transparent);color:var(--oc-warning-text,var(--oc-fg))}
.ap-warn-badge[data-tone="error"]{background:color-mix(in srgb,var(--oc-error) 14%,transparent);color:var(--oc-error-text,var(--oc-fg))}
.ap-warn-badge[data-tone="info"]{background:color-mix(in srgb,var(--oc-info) 14%,transparent);color:var(--oc-info-text,var(--oc-fg))}
@media(forced-colors:active){.ap-warn-badge{border:1px solid CanvasText}.ap-warn[data-tone]>.ap-icon{color:CanvasText}}

/* Session chips */
/* When name and state don't fit on one line, the state wraps below instead of squeezing the name */
.ap-chip{display:inline-flex;flex-wrap:wrap;align-items:center;gap:0 6px;min-width:0;max-width:100%}
.ap-chip>b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-chip-state{color:var(--oc-muted)}
.ap-chip-state::before{content:"· "}
.ap-dot{width:7px;height:7px;border-radius:50%;flex:none;background:color-mix(in srgb,var(--oc-muted) 55%,transparent)}
.ap-dot[data-tone="info"]{background:var(--oc-info)}
.ap-dot[data-tone="warning"]{background:var(--oc-warning)}
.ap-people{display:flex;flex-direction:column;gap:6px}
.ap-person{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center}
.ap-person .ap-small{grid-column:1/-1}
/* Ordinary links are text, not alarms: foreground with a dotted underline that turns solid on hover
   (orange is the warning/primary colour in several host themes) */
.ap-link{background:none;border:0;padding:0;color:var(--oc-fg);cursor:pointer;font-size:11.5px;text-decoration:underline dotted;text-decoration-color:color-mix(in srgb,currentColor 55%,transparent);text-underline-offset:2px}
.ap-link:hover{text-decoration-style:solid}

/* Sub-agents: Ran (host facts), Claimed (child-reported) and Accepted (plan task status) stay
   apart on every row. Static (no motion): a run is not reported work. Nesting reads from indentation
   + elbows + aria-level; each state has its own mark shape and words, colour only reinforces it. */
/* The page detail pane stacks without gaps: set the section apart from the recorded plan. */
.ap-detail>.ap-census{margin-top:18px;padding-top:14px;border-top:1px solid var(--oc-border)}
.ap-census-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.ap-sub-summary{display:flex;flex-wrap:wrap;gap:2px 12px;margin:0;font-size:12px;font-variant-numeric:tabular-nums;min-width:0}
.ap-sub-part{display:inline-flex;align-items:center;white-space:nowrap}
.ap-sub-part .ap-obs-mark{margin-right:5px}
.ap-sub-part[data-kind="running"] .ap-obs-mark{border-color:var(--oc-info);background:radial-gradient(circle,var(--oc-info) 0 2.5px,transparent 3px)}
.ap-sub-part[data-kind="waiting"]{color:var(--oc-warning-text,var(--oc-warning));font-weight:600}
.ap-sub-part[data-kind="waiting"] .ap-obs-mark{border-radius:1px;transform:rotate(45deg) scale(.85);border-color:var(--oc-warning)}
.ap-sub-part[data-kind="finished"] .ap-obs-mark{background:color-mix(in srgb,var(--oc-muted) 70%,transparent);border-color:transparent}
.ap-sub-part[data-kind="failed"] .ap-obs-mark{border-radius:2px;border-color:var(--oc-error);background:var(--oc-error)}
.ap-sub-part[data-kind="interrupted"] .ap-obs-mark{border-radius:2px;border-color:var(--oc-warning)}
.ap-sub-part[data-kind="unknown"] .ap-obs-mark{border-style:dashed}
.ap-sub-part[data-kind="unknown"]{color:var(--oc-muted)}
.ap-obs-list{display:flex;flex-direction:column;min-width:0}
.ap-obs-row{position:relative;display:flex;flex-direction:column;gap:3px;min-width:0;padding:7px 0 7px calc((var(--depth,1) - 1) * 14px)}
.ap-obs-list>.ap-obs-row+.ap-obs-row{border-top:1px solid color-mix(in srgb,var(--oc-border) 70%,transparent)}
.ap-obs-row[data-depth]:not([data-depth="1"])::before{content:"";position:absolute;left:calc((var(--depth,1) - 1) * 14px - 10px);top:6px;width:6px;height:10px;border-left:1px solid var(--oc-muted);border-bottom:1px solid var(--oc-muted);border-bottom-left-radius:3px;opacity:.55}
.ap-obs-meta{font-size:11px;color:var(--oc-muted);min-width:0;overflow-wrap:anywhere}
.ap-claim q{quotes:"“" "”";margin-left:4px;overflow-wrap:anywhere}
.ap-claim q::before{content:open-quote}.ap-claim q::after{content:close-quote}
.ap-claim time{color:var(--oc-muted)}
.ap-sub-page{margin:4px 0 2px;font-size:11.5px}
.ap-sub-page[aria-disabled="true"]{color:var(--oc-muted);cursor:default;text-decoration:none}
.ap-sub-notes{display:flex;flex-direction:column;gap:3px;margin:0;padding:0 0 0 14px;font-size:11.5px;color:var(--oc-muted)}
.ap-sub-notes .ap-link{font-size:11.5px}
.ap-obs-head{display:flex;align-items:baseline;gap:4px 8px;min-width:0}
.ap-obs-title{flex:1 1 auto;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-obs-row[data-role="root"] .ap-obs-title{font-weight:600}
.ap-obs-tag{flex:none;padding:0 6px;border-radius:999px;font-size:10.5px;line-height:17px;white-space:nowrap;background:var(--oc-muted-surface);color:var(--oc-muted)}
.ap-obs-head .ap-link{flex:none;margin-left:auto}
.ap-obs-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:1px 10px;font-size:11.5px;min-width:0}
.ap-obs-facts>div{display:contents}
.ap-obs-facts dt{color:var(--oc-muted)}
.ap-obs-facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
/* Inline prose, so a long stale line wraps like a sentence instead of stacking separators. */
.ap-obs{display:inline;min-width:0}
.ap-obs-last:empty{display:none}
.ap-obs time,.ap-obs-last{color:var(--oc-muted)}
/* An age moves to the next line as one unit ("· 2 minutes ago") instead of leaving "ago" alone;
   only a line narrower than the age itself (200% zoom) wraps inside it. */
.ap-census time{display:inline-block;max-width:100%}
.ap-obs-label{font-weight:500}
.ap-obs-mark{display:inline-block;vertical-align:-1px;margin-right:6px;width:9px;height:9px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--oc-muted) 80%,transparent)}
.ap-obs[data-state="active"] .ap-obs-mark{border-color:var(--oc-info);background:radial-gradient(circle,var(--oc-info) 0 2.5px,transparent 3px)}
.ap-obs[data-state="active"] .ap-obs-label{color:var(--oc-info-text,var(--oc-info))}
.ap-obs[data-state="waiting"] .ap-obs-mark{border-radius:1px;transform:rotate(45deg) scale(.85);border-color:var(--oc-warning)}
.ap-obs[data-state="waiting"] .ap-obs-label{color:var(--oc-warning-text,var(--oc-warning))}
.ap-obs[data-state="ended"] .ap-obs-mark{background:color-mix(in srgb,var(--oc-muted) 70%,transparent);border-color:transparent}
.ap-obs[data-state="failed"] .ap-obs-mark{border-radius:2px;border-color:var(--oc-error);background:var(--oc-error)}
.ap-obs[data-state="failed"] .ap-obs-label{color:var(--oc-error-text,var(--oc-error))}
.ap-obs[data-state="interrupted"] .ap-obs-mark{border-radius:2px;border-color:var(--oc-warning)}
.ap-obs[data-state="unknown"] .ap-obs-mark{border-style:dashed}
.ap-obs[data-state="unknown"] .ap-obs-label{font-weight:400;color:var(--oc-muted)}
.ap-obs-update time{color:var(--oc-muted)}
.ap-obs-more>summary{cursor:pointer;width:fit-content;max-width:100%;min-height:24px;padding:2px 0;font-size:11.5px;color:var(--oc-muted)}
.ap-obs-more>summary:hover{color:var(--oc-fg)}
.ap-obs-more[open]>summary{margin-bottom:2px}
.ap-obs-more>.ap-obs-list{border-top:1px solid color-mix(in srgb,var(--oc-border) 70%,transparent);padding-top:2px}
.ap[data-surface="page"] .ap-census .ap-obs-row:not([data-compact]){padding-top:10px;padding-bottom:10px}
.ap-census :is(button,summary):focus-visible{outline:none;box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}
/* Work Status: one line per session (name, state word), one muted line of recorded facts. */
.ap[data-surface="status"] .ap-census{gap:4px;border-top:1px solid var(--oc-border);padding-top:6px}
.ap-obs-row[data-compact]{padding-top:4px;padding-bottom:4px;gap:1px}
.ap[data-surface="status"] .ap-obs-list>.ap-obs-row+.ap-obs-row{border-top:0}
.ap-obs-row[data-compact] .ap-obs-head{flex-wrap:wrap}
.ap-obs-row[data-compact] .ap-obs-head>.ap-obs-title{flex:1 1 8em}
/* One line when it fits; at 200% zoom the state drops below the title and may wrap, never overflow. */
.ap-obs-row[data-compact] .ap-obs-head>.ap-obs{flex:0 1 auto;margin-left:auto;font-size:11.5px;min-width:0;overflow-wrap:anywhere}
.ap-obs-row[data-compact] .ap-obs-head>.ap-link{margin-left:0}
.ap-obs-row[data-compact] .ap-obs-label{font-weight:400}
.ap-obs-row[data-compact][data-ran="active"] .ap-obs-label,.ap-obs-row[data-compact][data-ran="waiting"] .ap-obs-label{font-weight:500}
.ap-obs-sub{display:flex;flex-wrap:wrap;gap:0 6px;font-size:11px;color:var(--oc-muted);min-width:0}
.ap-obs-sub>*+*::before{content:"·";margin-right:6px}
@media(forced-colors:active){.ap-obs-mark{border-color:CanvasText!important}.ap-obs[data-state=active] .ap-obs-mark,.ap-obs[data-state=failed] .ap-obs-mark,.ap-obs[data-state=ended] .ap-obs-mark{background:CanvasText}}

/* Official-main notice */
.ap-official{display:flex;flex-direction:column;gap:4px}

/* Plan selector */
.ap-picker .oc-sdk-select{width:100%}

/* Document */
.ap-doc{display:flex;flex-direction:column;gap:6px}
.ap-doc>summary,.ap-doc-title{cursor:pointer;width:fit-content;font-weight:600;font-size:12px}
.ap-doc-title{cursor:default}
.ap-doc pre{margin:6px 0 2px;padding:12px;border-radius:8px;background:var(--oc-muted-surface);font:11.5px/1.6 var(--oc-mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;tab-size:2}
.ap-note{font-size:11.5px;color:var(--oc-muted)}
.ap-empty{padding:28px 0 12px}

/* Document / capture states */
.ap-doc-warn{font-size:11.5px;color:var(--oc-warning-text,var(--oc-warning));line-height:1.45}
.ap-doc-body{display:flex;flex-direction:column;gap:4px}

/* History */
/* "Since you last reviewed" (page History). Static: no animation or transition; classification is
   always spelled out in text, colour only reinforces it. Everything wraps at 360px / 200% reflow. */
.ap-digest{gap:10px;padding:12px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-digest p,.ap-digest li{min-width:0;overflow-wrap:anywhere}
.ap-digest-h{font-size:12px;font-weight:600}
.ap-digest-coverage{display:flex;flex-direction:column;gap:2px;font-size:12.5px}
.ap-digest-warn{font-size:12px;color:var(--oc-warning-text,var(--oc-warning))}
.ap-digest-notice{font-size:12px;padding:6px 8px;border-left:3px solid var(--oc-info);background:color-mix(in srgb,var(--oc-info) 8%,transparent);border-radius:4px}
.ap-digest-fraction{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.ap-digest-causes{display:flex;flex-direction:column;gap:2px;font-size:12px}
.ap-digest-events{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;font-variant-numeric:tabular-nums}
.ap-digest-group{display:flex;flex-direction:column;gap:6px;min-width:0}
.ap-digest-tasks{display:flex;flex-direction:column;gap:8px}
.ap-digest-task{display:flex;flex-direction:column;gap:3px;padding:8px;border-radius:6px;background:var(--oc-bg);border:1px solid var(--oc-border)}
.ap-digest-task[data-present="false"]{border-style:dashed}
.ap-digest-line{display:flex;flex-wrap:wrap;align-items:flex-start;gap:4px 8px;min-width:0}
.ap-digest-title{flex:1 1 12em;min-width:0;font-weight:500}
.ap-digest-facets{font-size:12px}
.ap-digest-entry summary{cursor:pointer;font-size:11.5px;color:var(--oc-muted);width:fit-content;max-width:100%}
.ap-digest-refs{display:flex;flex-direction:column;gap:4px;margin-top:4px;padding-left:2px;font-size:11.5px}
.ap-digest-refs time{color:var(--oc-muted)}
.ap-digest-task>.ap-link{align-self:flex-start;text-align:start}
.ap-digest-actions button{max-width:100%;white-space:normal;min-height:28px}
.ap-digest [aria-disabled="true"]{opacity:.55;cursor:not-allowed}
.ap-digest button:focus-visible{outline:2px solid var(--oc-focus);outline-offset:2px}
.ap-history{display:flex;flex-direction:column}
.ap-history-row{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--oc-border);font-size:12px}
.ap-history-rev{font-weight:600;font-variant-numeric:tabular-nums}
.ap-history-row time{margin-left:auto;color:var(--oc-muted);font-size:11.5px}

/* Setup */
.ap-setup{display:flex;flex-direction:column;gap:12px;min-width:0}
.ap-setup-title{font-size:14px;font-weight:600}
.ap-setup-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-setup-form{display:flex;flex-direction:column;gap:10px}
.ap-setup-facts{margin-top:0}
.ap-setup-disclose{display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--oc-muted);border-left:2px solid var(--oc-border);padding-left:10px}
.ap-footer{display:flex;flex-direction:column;gap:8px}
.ap-footer>.ap-details+.ap-details{border-top:0;padding-top:0}

/* Quiet diagnostics */
.ap-cleanup{display:flex;flex-direction:column;gap:6px;min-width:0}
.ap-cleanup:empty{display:none}
.ap-cleanup-confirm{display:flex;flex-direction:column;gap:10px;padding:12px;background:var(--oc-muted-surface);border:1px solid var(--oc-border);border-radius:var(--oc-radius,10px)}
.ap-cleanup-confirm h3{font-size:13px}
.ap-cleanup-title{font-weight:600;overflow-wrap:anywhere}
.ap-cleanup-error{padding:10px 12px;border-left:2px solid var(--oc-warning);color:var(--oc-warning-text,var(--oc-warning));background:var(--oc-muted-surface);border-radius:4px}
/* The visible Delete button only; in ⋯ the hook names the menu holder, whose destructive item the kit colours */
[data-testid="cleanup-delete"]:not(.ap-actions-hold) button{color:var(--oc-error-text,var(--oc-fg))}
.ap-cleanup button:focus-visible,[data-testid="cleanup-modes"] button:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-details{border-top:1px solid var(--oc-border);padding-top:8px;font-size:11.5px;color:var(--oc-muted)}
.ap-details>summary{cursor:pointer;width:fit-content}
.ap-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 12px;margin-top:8px}
.ap-facts dt{color:var(--oc-muted)}
.ap-facts dd{color:var(--oc-fg);min-width:0;overflow-wrap:anywhere}
.ap-facts .ap-mono{font-family:var(--oc-mono);font-size:11px}
.ap-details ul{margin-top:6px;display:flex;flex-direction:column;gap:2px}

/* Calm progress (rail and board Progress): one header, one bar, state chips, one grouped list.
   Every task appears once; details open in the row. Host tokens only; orange stays for Blocked,
   primary and focus. No motion beyond the existing reported-progress gate. */
.ap-plan{gap:12px}
.ap-plan-head{gap:3px}
.ap-plan-top{display:flex;align-items:flex-start;gap:4px 6px;min-width:0}
.ap-plan-lead{flex:1 1 auto;display:flex;flex-wrap:wrap;align-items:center;gap:0 6px;min-width:0}
.ap-plan-lead .ap-plan-title{min-width:0;overflow-wrap:anywhere}
.ap-plan-title-pick{cursor:pointer}
.ap-plan-top>.ap-info,.ap-plan-top>.ap-actions,.ap-actions-hold{flex:none}
.ap-actions-hold{display:inline-flex}
.ap-actions-hold:empty{display:none}
.ap-meta>.ap-warn-badge::before{content:none}
/* Title-picker: the SDK select, drawn as a quiet "⌄ 1 of 3" beside the title (its name says which plan) */
.ap-title-picker{display:inline-flex;min-width:0}
.ap-title-picker .oc-sdk-select{display:inline-flex;width:auto}
.ap-title-picker .oc-sdk-field-label,.ap-title-picker .oc-sdk-trigger-value{display:none}
.ap-title-picker .oc-sdk-trigger{display:inline-flex;align-items:center;gap:3px;width:auto;min-width:0;height:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;box-shadow:none;color:var(--oc-muted);font-size:11.5px;font-variant-numeric:tabular-nums}
.ap-title-picker .oc-sdk-trigger:hover{background:var(--oc-hover);color:var(--oc-fg)}
.ap-title-picker .oc-sdk-trigger:focus-visible{outline:2px solid var(--oc-focus);outline-offset:0}
.ap-title-picker .oc-sdk-trigger-chevron{order:-1}
.ap-title-picker .oc-sdk-popup{width:min(22rem,calc(100vw - 16px));max-height:min(320px,calc(100vh - 40px))}
.ap-title-picker .oc-sdk-option-label{white-space:normal;overflow-wrap:anywhere}
.ap-title-picker .oc-sdk-option-hint{flex:0 1 auto;max-width:45%;white-space:normal}
.ap-rail-pick{display:flex;align-items:center;gap:6px;min-width:0}
/* done/total and the bar on one line */
.ap-progress-line{flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 10px}
.ap-progress-line .ap-fraction{flex:none;align-items:baseline;gap:0}
.ap-progress-line .ap-fraction strong{font-size:20px}
.ap-fraction-total{color:var(--oc-muted);font-size:13px;font-variant-numeric:tabular-nums}
.ap-progress-line .ap-seg{flex:1 1 48px;min-width:0}
/* Every task done (skipped tasks are not done): the kit's finished caption, a done mark and the
   count in the readable success colour. Decorative; the count's words already say it. */
.ap-done-mark{width:14px;height:14px;align-self:center;margin-right:5px}
[data-all-done] :is(strong,.ap-fraction-total,.ap-muted){color:var(--oc-success-text,var(--oc-fg))}
.ap-chip-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.ap-quals{display:flex;flex-direction:column;gap:4px;min-width:0}
.ap-quals:empty{display:none}
/* Task list */
.ap-tasks{position:relative;gap:4px}
/* Tasks heading: a programmatic focus fallback only; it shows itself while it has focus */
.ap-tasks-h{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--oc-muted);width:fit-content;padding:0 4px}
.ap-tasks-h:not(:focus){position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ap-tasks-h:focus{box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}
.ap-filter-line{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;min-width:0;padding:4px 4px 4px 10px;border-radius:8px;background:var(--oc-muted-surface);font-size:12px}
.ap-filter-line:empty{display:none}
.ap-filter-line>*+span::before{content:"·";margin-right:10px;color:var(--oc-muted)}
.ap-filter-text{font-weight:500;overflow-wrap:anywhere}
.ap-filter-line .oc-sdk-btn:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-pgroup+.ap-pgroup{margin-top:8px}
.ap-pgroup-box{display:flex;flex-direction:column;min-width:0}
.ap-pgroup-h{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--oc-muted);padding:2px 0}
.ap-pgroup-rows{display:flex;flex-direction:column}
.ap-fold>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;width:fit-content;min-height:28px;padding:0 6px;margin-left:-6px;border-radius:6px;font-size:12.5px;font-weight:500;letter-spacing:0;text-transform:none}
.ap-fold>summary::-webkit-details-marker{display:none}
.ap-fold>summary:hover{background:var(--oc-hover);color:var(--oc-fg)}
.ap-fold>summary .ap-icon{width:14px;height:14px;transform:rotate(-90deg)}
.ap-fold[open]>summary .ap-icon{transform:none}
.ap-fold>summary:focus-visible{outline:none;box-shadow:0 0 0 2px var(--oc-focus)}
/* One task row: status mark, title, its reported time or readiness word, a chevron; facts open in place */
.ap-trow-li{min-width:0}
/* A long title keeps its line; its time/wait wraps below, right-aligned, instead of squeezing it */
.ap-trow>summary.ap-trow-line{display:flex;flex-wrap:wrap;align-items:center;column-gap:9px;row-gap:0;min-height:32px;margin:0 -6px;padding:4px 6px;border-radius:6px;font-weight:400}
.ap-trow>summary.ap-trow-line::before{content:none}
.ap-trow>summary.ap-trow-line:hover{background:var(--oc-hover)}
.ap-trow-line>.ap-mark{margin-top:0}
.ap-trow-title{flex:1 1 10rem;min-width:0;line-height:1.4;overflow-wrap:anywhere}
.ap-trow-line>.ap-context{flex:none}
.ap-trow-li[data-status="skipped"] .ap-trow-title{color:var(--oc-muted);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--oc-muted) 60%,transparent)}
.ap-trow-li[data-status="done"]>.ap-trow>summary .ap-trow-title{color:var(--oc-muted)}
.ap-trow-end{flex:0 1 auto;margin-left:auto;display:inline-flex;align-items:center;gap:6px;min-width:0}
.ap-trow-meta{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:2px 6px;min-width:0;font-size:11.5px;color:var(--oc-muted);font-variant-numeric:tabular-nums}
/* 400% reflow: a long reported time may wrap rather than widen the page */
.ap-trow-meta .ap-elapsed,.ap-trow-meta>*{white-space:normal;overflow-wrap:anywhere;text-align:end}
/* A reported wait is a duration, not reported work: not the working blue */
.ap-trow-meta .ap-elapsed:not([data-testid^="elapsed-"]){color:var(--oc-muted)}
.ap-trow-ready{color:var(--oc-success-text,var(--oc-success))}
.ap-trow-meta .ap-ny-cat{align-self:center;margin-top:0}
.ap-trow-end>.ap-icon{width:14px;height:14px;color:var(--oc-muted)}
.ap-trow[open]>summary .ap-trow-end>.ap-icon{transform:rotate(180deg)}
.ap-trow-li>.ap-trow[open]{margin:2px -6px 4px;padding:0 6px 10px;border-radius:8px;background:color-mix(in srgb,var(--oc-fg) 4%,transparent)}
.ap-trow-li>.ap-trow[open]>summary{margin:0 -6px}
.ap-trow-body{display:flex;flex-direction:column;gap:8px;padding:2px 0 0 25px;min-width:0}
.ap-rfacts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;font-size:12px;min-width:0}
.ap-rfacts>div{display:contents}
.ap-rfacts dt{color:var(--oc-muted)}
.ap-rfacts dd{margin:0;min-width:0;overflow-wrap:anywhere;white-space:pre-line}
.ap-rfacts>p{grid-column:1/-1}
.ap-rfacts .ap-ny-unknown{color:var(--oc-muted);font-style:italic}
.ap-rfacts .ap-elapsed{color:var(--oc-fg);font-size:12px;white-space:normal}
.ap-rfacts .ap-elapsed[data-kind="unknown"]{color:var(--oc-muted);font-style:italic}
.ap-rfacts .ap-ready-deps{gap:3px}
.ap-rfacts .ap-ready-dep{display:grid;grid-template-columns:12px minmax(0,1fr);column-gap:6px;align-items:baseline}
.ap-rfacts .ap-ready-dep>:nth-child(n+3){grid-column:2}
.ap-rfacts .ap-ready-dep>.ap-glyph{align-self:start;margin-top:3px}
.ap-rfacts .ap-ready-who{white-space:normal}
.ap-rfacts-term{display:inline-flex;flex-wrap:wrap;align-items:center;gap:2px}
.ap-rfacts-term .ap-info-btn{width:20px;height:20px}
.ap-rfacts-lines{display:flex;flex-direction:column;gap:2px}
.ap-rfacts .ap-reasons{font-size:12px}
@media(max-width:300px){.ap-rfacts,.ap-facts{grid-template-columns:minmax(0,1fr)}.ap-rfacts dd{margin-bottom:4px}.ap-trow-body{padding-left:0}}
.ap-rcopy-open{display:inline-flex;align-items:center;gap:6px;width:fit-content;max-width:100%;white-space:normal;text-align:start;min-height:26px;padding:0 9px;border:1px solid var(--oc-border);border-radius:6px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;font-size:12px;cursor:pointer}
.ap-rcopy-open:hover{background:var(--oc-hover)}
.ap-rcopy-open .ap-icon{width:14px;height:14px;color:var(--oc-muted)}
.ap-rcopy-open:focus-visible,.ap-rcopy .oc-sdk-btn:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
.ap-rcopy-preview{background:var(--oc-bg);border:1px solid var(--oc-border)}
/* Plan order: the recorded hierarchy, indented under its groups */
.ap-tree{display:flex;flex-direction:column;margin-left:8px;padding-left:12px;border-left:1px solid var(--oc-border)}
.ap-tgroup>summary{font-weight:600}
/* Plan panels opened from ⋯ (Task view, Plan document, Sessions) */
.ap-panel{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px 12px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.ap-panel-h:focus{outline:none;box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}
.ap-panel .oc-sdk-btn:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-panel .ap-doc pre{background:var(--oc-bg)}
/* One compact session row; the Sessions panel holds every participant */
.ap-sessions{flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 12px;padding-top:10px;border-top:1px solid var(--oc-border)}
.ap-sessions .ap-people{flex:1 1 14rem;min-width:0}
.ap-sessions .ap-person .ap-small{display:none}
.ap-sessions-more{font-size:12px;color:var(--oc-muted)}
.ap-sessions-more:hover{color:var(--oc-fg)}
.ap-link:focus-visible{box-shadow:0 0 0 2px var(--oc-focus)}
/* Calm roster (rail and board): running rows on one line each, every other record folded */
.ap-census-calm{gap:6px}
.ap-census-calm .ap-census-head{flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:2px 10px}
.ap-census-title{display:inline-flex;align-items:center;gap:2px}
.ap .ap-census-calm .ap-obs-row.ap-obs-xrow:not([data-compact]){padding-top:0;padding-bottom:0}
.ap-census-calm .ap-obs-line time{display:inline}
.ap-census-calm .ap-sub-summary{flex:1 1 auto}
.ap-census-calm .ap-obs-list>.ap-obs-row+.ap-obs-row{border-top:0}
.ap-obs-xrow{padding:0 0 0 calc((var(--depth,1) - 1) * 14px)}
.ap-obs-xrow[data-depth]:not([data-depth="1"])::before{top:10px}
.ap-obs-x>summary.ap-obs-line{display:flex;flex-wrap:wrap;align-items:center;column-gap:8px;row-gap:0;min-height:30px;margin:0 -6px;padding:3px 6px;border-radius:6px;list-style:none;cursor:pointer;font-size:12.5px}
.ap-obs-x>summary::-webkit-details-marker{display:none}
.ap-obs-x>summary:hover{background:var(--oc-hover)}
.ap-obs-x>summary:focus-visible{outline:none;box-shadow:0 0 0 2px var(--oc-focus)}
.ap-obs-line>.ap-obs-title{flex:1 1 8rem;font-weight:400;white-space:normal;overflow:visible;overflow-wrap:anywhere}
.ap-obs-end{flex:0 1 auto;margin-left:auto;display:inline-flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:0 8px;min-width:0;font-size:11.5px}
.ap-obs-agent{color:var(--oc-muted)}
.ap-obs-end>.ap-obs{min-width:0;overflow-wrap:anywhere}
.ap-obs-end>.ap-icon{width:14px;height:14px;color:var(--oc-muted)}
.ap-obs-x[open]>summary .ap-obs-end>.ap-icon{transform:rotate(180deg)}
.ap-obs-body{display:flex;flex-direction:column;gap:4px;padding:2px 0 8px}
.ap-obs-body>.ap-link{align-self:flex-start}
.ap-warn-list{display:flex;flex-direction:column;gap:3px;padding:0}
.ap-warn-list>li{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px}

/* Status section */
/* Work Status is auto-height inside the sidebar: the host owns gutters and scrolling. */
html[data-oc-surface="status"]{scrollbar-gutter:auto}
.ap[data-surface="status"]{padding:4px 0 10px;gap:8px}
/* Compact Work Status: one title (the featured-plan picker beside it), the whole-plan bar, "3/8"
   with informational chips, at most two focus rows, a compact meta line and "+N more plans".
   Titles wrap instead of truncating; everything fits 190 px without horizontal overflow. */
.ap-status-plan{display:flex;flex-direction:column;gap:6px;min-width:0}
/* A short title shares its line with the picker and badge; a long title takes the full width,
   with the remaining controls wrapping below rather than reserving a column. */
.ap-status-head{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;min-width:0}
.ap-status-title{font-weight:600;line-height:1.35;min-width:0;overflow-wrap:anywhere}
/* A 24 x 24 px target (WCAG 2.2 target size). */
.ap-status-pick .oc-sdk-trigger{height:24px;min-width:24px;padding:0 4px}
/* A wrapped title can put the trigger midway down a short auto-height frame. Keep the
   fixed popup inside that frame even when neither side of the trigger has enough room. */
.ap-status-pick .oc-sdk-popup{top:8px!important;max-height:calc(100vh - 16px)}
.ap-status-head>span:not(.ap-status-title){align-self:start}
.ap-status-progress{gap:6px}
.ap-status-counts{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;min-width:0;font-size:12px}
.ap-status-fraction{font-variant-numeric:tabular-nums}
.ap-status-fraction strong{font-size:13px;font-weight:600}
.ap-status-fraction .ap-done-mark{width:12px;height:12px;margin-right:4px;vertical-align:-2px}
/* Informational chips here: mark, count and word inline, no pill (nothing to press) */
.ap-status-counts .ap-state-chip{min-height:0;padding:0;border:0;gap:4px;font-size:12px}
.ap-status-counts .ap-state-chip .ap-mark{width:12px;height:12px}
.ap-status-focus{display:flex;flex-direction:column;gap:3px;min-width:0}
.ap-status-row{display:flex;align-items:baseline;gap:8px;min-width:0}
.ap-status-row .ap-grow{min-width:0;overflow-wrap:anywhere}
.ap-status-meta{font-size:11px}
.ap-status-more{width:fit-content;font-size:12px;color:var(--oc-muted)}
.ap-status-more:hover{color:var(--oc-fg)}
/* Work Status has no side padding (the host owns its gutters): roster lines keep inside the frame */
.ap[data-surface="status"] .ap-obs-x>summary.ap-obs-line{margin:0;padding:3px 0;min-height:26px}
.ap[data-surface="status"] .ap-census-calm{gap:4px}
.ap[data-surface="status"] .ap-obs-line>.ap-obs-title{flex:1 1 auto}
.ap[data-surface="status"] .ap-obs-end{font-size:11px;gap:0 6px}
/* A wrapped title keeps its mark on the first line */
.ap-status-focus>.ap-status-row>.ap-mark{align-self:flex-start;margin-top:2px}

/* Page */
/* Wide board on every tab: the plan list and detail tabs keep one position; Progress, Document and
   History hold their reading width while the Map tab uses the full detail column. */
.ap[data-surface="page"]{padding:18px 22px 22px;gap:18px;max-width:2400px;margin:0 auto}
.ap-detail:not([data-tab="map"]){max-width:1120px}
.ap-filters{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end}
.ap-filters>div{min-width:150px;flex:1 1 150px;max-width:260px}
.ap-board{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}
.ap-plan-list{display:flex;flex-direction:column;gap:12px;min-width:0}
.ap-plan-list .oc-sdk-row{min-height:52px}
.ap-detail{min-width:0;padding:16px;border-radius:var(--oc-radius,12px);background:color-mix(in srgb,var(--oc-fg) 3%,transparent)}
.ap-detail-tabs{margin-bottom:4px}
/* Four tabs (Progress, Document, History, Map) wrap at 400% zoom instead of scrolling the last ones out of view */
.ap-detail-tabs .oc-sdk-tabs{flex-wrap:wrap}

/* Board search: labelled form, explicit scope, removable chips, grouped hits. No motion. */
.ap-search-area{display:flex;flex-direction:column;gap:8px;min-width:0}
.ap-search{display:flex;flex-direction:column;gap:6px;min-width:0}
.ap-search-row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;min-width:0}
.ap-search-field{display:flex;flex-direction:column;gap:4px;flex:2 1 280px;min-width:0}
.ap-search-label{font-size:12px;font-weight:600}
.ap-search-filters{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;flex:3 1 360px;min-width:0}
.ap-search-filters>div{min-width:140px;flex:1 1 140px;max-width:220px}
.ap-search-filters>.ap-search-submit{flex:0 0 auto;min-width:0}
.ap-search-help{max-width:72ch}
.ap-search-scope{color:var(--oc-fg)}
.ap-search-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;min-width:0}
.ap-chip-list{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.ap-chip-remove{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 8px;border:1px solid var(--oc-border);border-radius:999px;background:var(--oc-muted-surface);color:var(--oc-fg);font-size:11.5px;text-align:start;cursor:pointer;overflow-wrap:anywhere}
.ap-chip-remove:hover{border-color:var(--oc-muted)}
[data-available="false"]>.ap-chip-remove{border-style:dashed;color:var(--oc-warning-text,var(--oc-warning))}
.ap-chip-x{font-size:13px;line-height:1;color:var(--oc-muted)}
.ap-search-counts{display:flex;flex-direction:column;gap:2px}
.ap-search-found{font-weight:600;font-variant-numeric:tabular-nums}
.ap-search-coverage{display:flex;flex-direction:column;gap:2px}
.ap-search-actions{padding-top:2px}
.ap-search-blocked{display:flex;flex-direction:column;gap:8px}
.ap-hit-group{display:flex;flex-direction:column;gap:2px;min-width:0;padding-top:8px;border-top:1px solid var(--oc-border)}
.ap-hit-group[data-changed]{opacity:.85}
.ap-hit{display:flex;flex-direction:column;gap:2px;width:100%;min-width:0;padding:5px 6px;border:0;border-radius:6px;background:none;color:var(--oc-fg);text-align:start;cursor:pointer}
.ap-hit:hover{background:var(--oc-muted-surface)}
.ap-hit[aria-current="true"]{background:color-mix(in srgb,var(--oc-primary,var(--oc-info)) 12%,transparent)}
.ap-hit-plan .ap-hit-title{font-weight:600}
.ap-hit-meta,.ap-hit-note,.ap-hit-context{font-size:11.5px;color:var(--oc-muted);overflow-wrap:anywhere}
.ap-hit-note{color:var(--oc-fg)}
.ap-hit-tasks{display:flex;flex-direction:column;padding-left:10px}
.ap-hit-line{display:grid;grid-template-columns:18px minmax(0,1fr);gap:8px;align-items:start;min-width:0}
.ap-hit-line .ap-glyph{margin-top:1px}
.ap-hit-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.ap-hit-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;min-width:0}
.ap-hit-title{overflow-wrap:anywhere;min-width:0}
.ap-hit-id{font-family:var(--oc-font-mono,monospace);font-size:11px;color:var(--oc-muted);overflow-wrap:anywhere}
.ap-hit:focus-visible,.ap-chip-remove:focus-visible,.ap-search :is(button,input):focus-visible,.ap-search .oc-sdk-trigger:focus-visible,.ap-search-area button:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
/* Board bar: Current / Archived, one search field and Filters; everything else waits in Filters.
   Concrete states (problem, pending edit, chips, outcome, warnings) stay visible below it. */
.ap-board-bar-wrap{display:flex;flex-direction:column;gap:6px;min-width:0}
.ap-board-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;min-width:0}
.ap-board-bar>[data-testid="cleanup-modes"]{flex:none;gap:2px}
.ap-board-bar .ap-search{flex:1 1 22rem;min-width:0}
.ap-board-bar .ap-search-row{position:relative;flex-wrap:nowrap;align-items:center;gap:6px}
.ap-board-bar .ap-search-field{flex:1 1 auto;min-width:0}
.ap-filters-owner{flex:none;margin-left:auto}
.ap-filters-trigger{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--oc-border);border-radius:7px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;font-size:12.5px;white-space:nowrap;cursor:pointer}
.ap-filters-trigger:hover{background:var(--oc-hover)}
.ap-filters-trigger[aria-expanded="true"]{background:var(--oc-selection,var(--oc-hover))}
.ap-filters-trigger:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
.ap-filters-trigger .ap-icon{width:15px;height:15px;color:var(--oc-muted)}
.ap-filters-count{min-width:18px;height:18px;padding:0 5px;border:1px solid var(--oc-border);border-radius:999px;background:var(--oc-muted-surface);font-size:11px;font-weight:600;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
/* A nonmodal panel under the bar, across its width on a narrow board */
.ap-filters-panel{position:absolute;z-index:30;top:calc(100% + 6px);right:0;width:min(44rem,100%);display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--oc-border);border-radius:var(--oc-radius,10px);background:var(--oc-elevated,var(--oc-bg));color:var(--oc-elevated-fg,var(--oc-fg));box-shadow:0 12px 32px color-mix(in srgb,var(--oc-fg) 16%,transparent);text-align:start}
.ap-filters-panel[hidden]{display:none}
.ap-filters-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ap-filters-h{margin:0;padding:0 2px;font-size:13px;font-weight:600;border-radius:4px}
.ap-filters-h:focus{outline:none;box-shadow:0 0 0 2px var(--oc-focus)}
.ap-filters-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(12rem,100%),1fr));gap:10px 12px;min-width:0}
.ap-filters-grid>[data-testid="filters"]{grid-column:1/-1;display:grid;grid-template-columns:subgrid;gap:inherit}
.ap-filters-panel .ap-filters>div{min-width:0;max-width:none}
.ap-filters-panel .oc-sdk-select,.ap-filters-panel .oc-sdk-trigger{width:100%;min-width:0}
.ap-filters-panel .oc-sdk-popup{max-width:calc(100vw - 16px)}
.ap-filters-panel .ap-search-help,.ap-filters-panel .ap-search-scope{max-width:none}
.ap-filters-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;padding-top:10px;border-top:1px solid var(--oc-border)}
.ap-filters-foot>.ap-note{flex:1 1 16rem}
.ap-filters-panel :is(button,.oc-sdk-trigger):focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
@media(forced-colors:active){.ap-filters-panel,.ap-filters-trigger{border-color:CanvasText}}
.ap-search-strip{display:flex;flex-direction:column;gap:6px;min-width:0}
/* Plan list: project groups of calm rows (mark, title, done/total, mini bar); Finished folds */
.ap-board-project{gap:2px}
.ap-board-project>.ap-h{padding:0 8px 2px}
.ap-plan-list .oc-sdk-row{min-height:44px;gap:10px}
.ap-plan-list .oc-sdk-row-title{white-space:normal;overflow-wrap:anywhere}
.ap-plan-mark{width:15px;height:15px}
.ap-plan-mark[data-plan="failed"]{color:var(--oc-error)}
.ap-mini-bar{height:3px;margin-top:5px;max-width:16rem}
.ap-mini-bar>i{min-width:2px}
.ap-mini-bar>i+i{margin-left:1px}
.ap-fold-toggle{display:inline-flex;align-items:center;gap:6px;width:fit-content;min-height:30px;padding:0 8px;border:0;border-radius:6px;background:none;color:var(--oc-muted);font:inherit;font-size:12.5px;cursor:pointer}
.ap-fold-toggle:hover{background:var(--oc-hover);color:var(--oc-fg)}
.ap-fold-toggle:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-fold-toggle .ap-icon{width:14px;height:14px;transform:rotate(-90deg)}
.ap-fold-toggle[aria-expanded="true"] .ap-icon{transform:none}
.ap-board-fold[hidden]{display:none}
@media(forced-colors:active){.ap-fold-toggle{border:1px solid CanvasText}}
@media(min-width:820px){.ap-board{grid-template-columns:minmax(260px,340px) minmax(0,1fr)}.ap-plan-list{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
