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
.ap-seg{display:flex;height:6px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--oc-fg) 9%,transparent)}
.ap-seg>i{display:block;height:100%}
.ap-seg>i+i{margin-left:2px}
.ap-seg [data-k="done"]{background:var(--oc-success)}
.ap-seg [data-k="working"]{background:var(--oc-info)}
.ap-seg [data-k="blocked"]{background:var(--oc-warning)}
.ap-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--oc-muted)}
.ap-legend span{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
.ap-legend i{width:7px;height:7px;border-radius:2px;background:color-mix(in srgb,var(--oc-fg) 18%,transparent)}
.ap-legend [data-k="done"] i{background:var(--oc-success)}
.ap-legend [data-k="working"] i{background:var(--oc-info)}
.ap-legend [data-k="blocked"] i{background:var(--oc-warning)}

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
[data-motion="on"] .ap-now .ap-glyph[data-status="working"]::after,[data-motion="on"] [data-testid="current-work"] .ap-glyph[data-status="working"]::after{animation:ap-dot-pulse 2.4s ease-in-out infinite}
@keyframes ap-text-pulse{0%,100%{opacity:0}50%{opacity:.9}}
@keyframes ap-sheen{0%{transform:translateX(-100%)}65%,100%{transform:translateX(100%)}}
@keyframes ap-dot-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.7)}}
[data-ap-hidden] *,[data-ap-hidden] *::before,[data-ap-hidden] *::after{animation:none!important}

/* Current work callout */
.ap-now{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-now-label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--oc-muted)}
.ap-now-item{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ap-now-item strong{font-weight:500}
.ap-elapsed{color:var(--oc-info-text,var(--oc-info));font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ap-elapsed[data-kind="unknown"]{color:var(--oc-muted)}

/* Section heading */
.ap-h{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--oc-muted)}
.ap-section{display:flex;flex-direction:column;gap:8px;min-width:0}

/* Item hierarchy */
.ap-items{display:flex;flex-direction:column}
.ap-items ul{display:flex;flex-direction:column}
.ap-item{display:grid;grid-template-columns:18px minmax(0,1fr);gap:9px;align-items:start;padding:5px 0}
.ap-item-title{line-height:1.4}
.ap-item[data-status="skipped"] .ap-item-title{color:var(--oc-muted);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--oc-muted) 60%,transparent)}
.ap-item-sub{display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:2px;font-size:11.5px;color:var(--oc-muted)}
.ap-group{border-radius:8px}
.ap-group>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 0 4px;font-weight:600}
.ap-group>summary::-webkit-details-marker{display:none}
.ap-group>summary::before{content:"";width:6px;height:6px;margin:0 6px 0 4px;border-right:1.5px solid var(--oc-muted);border-bottom:1.5px solid var(--oc-muted);transform:rotate(-45deg);transition:transform .12s}
.ap-group[open]>summary::before{transform:rotate(45deg)}
.ap-group>summary .ap-count{margin-left:auto;font-weight:400;font-size:11.5px;color:var(--oc-muted);font-variant-numeric:tabular-nums}
.ap-group>ul{margin-left:8px;padding-left:12px;border-left:1px solid var(--oc-border)}
summary:focus-visible,.ap-link:focus-visible,pre:focus-visible,.ap-tasks-h:focus-visible{outline:none;box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}
.ap-tasks-h:focus{outline:none}
/* Branch facts stay visible while folded: full working/blocked, filter-hidden rows; "folded" only while closed */
.ap-group>summary{flex-wrap:wrap;row-gap:2px}
.ap-group>summary .ap-grow{flex:1 1 0}
.ap-branch{display:flex;flex-wrap:wrap;gap:0 8px;width:100%;padding-left:24px;font-weight:400;font-size:11.5px;color:var(--oc-muted)}
.ap-branch>*+*::before{content:"·";margin-right:8px}
.ap-branch [data-k="working"]{color:var(--oc-info-text,var(--oc-info))}
.ap-branch [data-k="blocked"]{color:var(--oc-warning-text,var(--oc-warning))}
.ap-branch [data-k="lead"]+*::before{content:none}
.ap-folded{display:none}
.ap-group:not([open])>summary .ap-folded{display:inline}
.ap-group[open]>summary .ap-branch:not(:has(>:not(.ap-folded))){display:none}
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
/* A task-parent's own recorded people (assignee chip, relay line) stay in its summary, visible while folded */
.ap-group>summary .ap-summary-sub{width:100%;margin-top:0;padding-left:24px;font-weight:400;min-width:0}
.ap-reasons>*+*::before{content:"·";margin-right:8px}
.ap-focus-empty{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:10px 12px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
/* Canonical task rows are navigation targets (tabindex -1): ring for keyboard focus or a readiness jump */
.ap-items li:focus{outline:none}
.ap-items li:focus-visible,.ap-items li[data-nav-target]:focus{outline:none;box-shadow:0 0 0 2px var(--oc-focus);border-radius:4px}

/* Readiness (active plans): recorded prerequisites only, read-only */
.ap-readiness{padding:10px 12px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-readiness .ap-note:empty{display:none}
.ap-ready-group{display:flex;flex-direction:column;gap:4px;min-width:0}
.ap-ready-group+.ap-ready-group{border-top:1px solid var(--oc-border);padding-top:8px}
.ap-ready-sub{margin-top:4px;padding-left:10px;border-left:2px dashed color-mix(in srgb,var(--oc-muted) 60%,transparent)}
.ap-ready-title{margin:0;font-size:12px;font-weight:600}
.ap-ready-list{display:flex;flex-direction:column;gap:8px}
.ap-ready-entry{display:flex;flex-direction:column;gap:2px;min-width:0}
.ap-ready-head{display:grid;grid-template-columns:18px minmax(0,1fr);gap:9px;align-items:start}
.ap-ready-head .ap-ready-link{font-size:13px;font-weight:500;color:var(--oc-fg);text-align:left;line-height:1.4}
.ap-ready-link{overflow-wrap:anywhere;text-align:left;text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 35%,transparent);text-underline-offset:2px}
.ap-ready-meta,.ap-ready-deps,.ap-ready-entry>p{margin-left:27px}
.ap-ready-meta{display:flex;flex-wrap:wrap;gap:2px 8px;font-size:11.5px;color:var(--oc-muted);min-width:0}
.ap-ready-meta>*{min-width:0;overflow-wrap:anywhere}
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

/* Status glyph: shape + colour + hidden text, never colour alone */
.ap-glyph{width:16px;height:16px;margin-top:1px;border-radius:50%;display:inline-grid;place-items:center;font-size:10px;font-weight:700;line-height:1;flex:none}
.ap-glyph[data-status="pending"]{border:1.5px solid color-mix(in srgb,var(--oc-muted) 75%,transparent)}
.ap-glyph[data-status="done"]{background:var(--oc-success);color:var(--oc-bg)}
.ap-glyph[data-status="done"]::after{content:"";width:6px;height:3px;border-left:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:translateY(-1px) rotate(-45deg)}
.ap-glyph[data-status="working"]{border:1.5px solid var(--oc-info)}
.ap-glyph[data-status="working"]::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--oc-info)}
.ap-glyph[data-status="blocked"]{background:var(--oc-warning);color:var(--oc-bg)}
.ap-glyph[data-status="blocked"]::after{content:"!"}
.ap-glyph[data-status="skipped"]{border:1.5px dashed color-mix(in srgb,var(--oc-muted) 70%,transparent)}
.ap-glyph[data-status="skipped"]::after{content:"";width:6px;height:1.5px;background:var(--oc-muted)}

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
.ap-link{background:none;border:0;padding:0;color:var(--oc-primary-text,var(--oc-primary));cursor:pointer;font-size:11.5px}
.ap-link:hover{text-decoration:underline}

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
[data-testid="cleanup-delete"] button{color:var(--oc-error-text,var(--oc-fg))}
.ap-cleanup button:focus-visible,[data-testid="cleanup-modes"] button:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-details{border-top:1px solid var(--oc-border);padding-top:8px;font-size:11.5px;color:var(--oc-muted)}
.ap-details>summary{cursor:pointer;width:fit-content}
.ap-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 12px;margin-top:8px}
.ap-facts dt{color:var(--oc-muted)}
.ap-facts dd{color:var(--oc-fg);min-width:0;overflow-wrap:anywhere}
.ap-facts .ap-mono{font-family:var(--oc-mono);font-size:11px}
.ap-details ul{margin-top:6px;display:flex;flex-direction:column;gap:2px}

/* Status section */
/* Work Status is auto-height inside the sidebar: the host owns gutters and scrolling. */
html[data-oc-surface="status"]{scrollbar-gutter:auto}
.ap[data-surface="status"]{padding:4px 0 10px;gap:8px}
/* Status-only compact SDK select. Keep its label association and popup behavior. */
.ap-status-picker .oc-sdk-select{flex-direction:row;align-items:center;gap:8px}
.ap-status-picker .oc-sdk-field-label{flex:none;white-space:nowrap}
.ap-status-picker .oc-sdk-trigger{margin-left:auto;max-width:65%;height:24px;padding:0 8px}
.ap-status-picker .oc-sdk-trigger:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-status-picker .oc-sdk-popup{width:min(24rem,calc(100vw - 16px));max-height:min(320px,calc(100vh - 40px))}
.ap-status-picker .oc-sdk-option-label{white-space:normal;overflow-wrap:anywhere}
.ap-status-picker .oc-sdk-option-hint{flex:0 1 auto;max-width:45%;white-space:normal}
.ap-status-plan{display:flex;flex-direction:column;gap:6px}
.ap-status-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ap-status-row{display:flex;align-items:baseline;gap:8px;min-width:0}
.ap-status-row .ap-grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-status-more{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--oc-border);padding-top:6px}

/* Page */
.ap[data-surface="page"]{padding:18px 22px 22px;gap:18px;max-width:1280px;margin:0 auto}
.ap-filters{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end}
.ap-filters>div{min-width:150px;flex:1 1 150px;max-width:260px}
.ap-board{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}
.ap-plan-list{display:flex;flex-direction:column;gap:12px;min-width:0}
.ap-plan-list .oc-sdk-row{min-height:52px}
.ap-detail{min-width:0;padding:16px;border-radius:var(--oc-radius,12px);background:color-mix(in srgb,var(--oc-fg) 3%,transparent)}
.ap-detail-tabs{margin-bottom:4px}
@media(min-width:820px){.ap-board{grid-template-columns:minmax(260px,340px) minmax(0,1fr)}.ap-plan-list{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
