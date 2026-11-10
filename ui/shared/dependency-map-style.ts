// Map-only guest CSS, injected by dependency-map-view.ts once per document. Kept out of the shared
// stylesheet so Work Status, which never mounts the map, ships no map code.
// Colours come only from host tokens; the shared stylesheet's reduced-motion and hidden-frame rules
// (!important, style.ts) still stop the one map animation, so it never sets !important itself.
export const MAP_CSS = `
/* Dependency map (one renderer for board and rail). No transitions: viewport changes and anchoring
   apply instantly. The only motion is working-arrow beads, under the map region's own reported-work
   gate (see Arrow state below); cards, marks, layout and the selection panel never animate.
   Status is always words + a distinct mark shape; colour only reinforces it. Card slots come inline
   from the full-plan layout, so filters hide cards in place and status never changes card size. */
.ap-map{container:ap-map/inline-size;display:flex;flex-direction:column;gap:12px;min-width:0}
.ap-map-head{display:flex;flex-direction:column;gap:8px;min-width:0}
.ap-map-top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 16px;min-width:0}
.ap-map-titles{display:flex;flex-direction:column;gap:3px;flex:1 1 16rem;min-width:0}
.ap-map-titles .ap-plan-title{overflow-wrap:anywhere}
.ap-map-actions{display:flex;flex-wrap:wrap;gap:6px;flex:none;max-width:100%}
.ap-map .oc-sdk-btn:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-map-notice{min-width:0;font-size:12px}
.ap-map-notice-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-width:0}
.ap-map-notice-row>p{flex:1 1 18rem;min-width:0}
.ap-map-notice[data-tone="quiet"]{padding:6px 10px;border-left:3px solid var(--oc-info);border-radius:4px;background:color-mix(in srgb,var(--oc-info) 7%,transparent)}
.ap-map-notice[data-tone="warning"]{padding:8px 12px;border-left:3px solid var(--oc-warning);border-radius:4px;background:color-mix(in srgb,var(--oc-warning) 9%,transparent)}
.ap-map-notice[data-tone="neutral"]{padding:12px 14px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-map-summary{display:flex;flex-direction:column;gap:6px;min-width:0}
.ap-map-summary:empty{display:none}
.ap-map-stats{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
/* Pills wrap their own words at 400% zoom in a narrow rail instead of widening the page */
.ap-map-stat{display:inline-flex;flex-wrap:wrap;align-items:center;gap:2px 6px;max-width:100%;min-width:0;overflow-wrap:anywhere;padding:3px 10px 3px 7px;border:1px solid var(--oc-border);border-radius:999px;background:var(--oc-bg);font-size:12px;font-variant-numeric:tabular-nums}
.ap-map-stat strong{font-weight:650}
.ap-map-stat[data-kind="working"] strong{color:var(--oc-info-text,var(--oc-info))}
.ap-map-stat[data-kind="ready"] strong{color:var(--oc-success-text,var(--oc-success))}
.ap-map-stat[data-kind="blocked"] strong{color:var(--oc-warning-text,var(--oc-warning))}
/* Unlocks next is guidance, not an alarm or a selection: neutral, so orange keeps meaning Blocked,
   primary and focus (shared primitives, docs/ui.md). */
.ap-map-stat[data-kind="unlocks"] strong,.ap-map-stat[data-kind="unlocks"] .ap-map-unlock-icon{color:var(--oc-fg)}
.ap-map-stat[data-count="0"],.ap-map-stat[data-count="0"] strong{color:var(--oc-muted)}
.ap-map-counts{font-size:12px;font-variant-numeric:tabular-nums}
.ap-map-summary .ap-note{max-width:86ch}
.ap-map-context{font-size:12px;color:var(--oc-muted);max-width:86ch}
.ap-map-context strong{color:var(--oc-fg);font-weight:600}
.ap-map-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;min-width:0;padding-top:10px;border-top:1px solid var(--oc-border)}
.ap-map-field{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;font-size:12px}
.ap-map-field-label{flex:none;color:var(--oc-muted)}
.ap-map-select{min-width:0;max-width:min(20rem,100%);height:26px;padding:0 4px 0 7px;border:1px solid var(--oc-border);border-radius:6px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;font-size:12px;text-overflow:ellipsis;cursor:pointer}
.ap-map-select:hover{border-color:color-mix(in srgb,var(--oc-fg) 35%,var(--oc-bg))}
.ap-map-select:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
.ap-map-hidden{flex:1 1 14rem;min-width:0;font-size:11.5px;color:var(--oc-muted);font-variant-numeric:tabular-nums}
/* Pressed-button pairs: map Show all / Unfinished (the list's look) and the rail's Plan view switch */
.ap-map-pair{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
.ap-map-pair [aria-pressed="true"]{font-weight:600}
.ap-map-switch{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-width:0;font-size:12px}
.ap-map-switch-label{color:var(--oc-muted)}
.ap-map-switch .oc-sdk-btn:focus-visible,.ap-map-pair .oc-sdk-btn:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
.ap-map-body{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start;min-width:0}
.ap-map-stage{display:flex;flex-direction:column;min-width:0}
/* Wide board: the selection panel sits over the canvas's right edge while a task is selected. The
   frame decides when (MAP_PANEL in dependency-map-interaction.ts) and sets its width inline, so the
   canvas never resizes for it. No transition or animation, so reduced motion has nothing to remove. */
.ap-map-canvas{position:relative;min-width:0}
.ap-map-inspector[hidden]{display:none}
.ap-map-inspector[data-placement="over"]{position:absolute;z-index:2;top:8px;right:8px;bottom:8px;max-width:calc(100% - 16px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--oc-border);box-shadow:0 8px 24px color-mix(in srgb,var(--oc-fg) 16%,transparent)}
.ap-map-inspector[data-placement="over"]:focus{outline:none}
.ap-map-inspector[data-placement="over"]:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-map-inspector-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.ap-map-inspector-head .ap-h{margin:0}
.ap-map-viewport{position:relative;min-width:0;min-height:180px;max-height:clamp(300px,64vh,600px);overflow:auto;border:1px solid var(--oc-border);border-radius:var(--oc-radius,10px);background-color:color-mix(in srgb,var(--oc-fg) 2.5%,var(--oc-bg));background-image:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--oc-fg) 14%,transparent) 1px,transparent 1.5px);background-size:20px 20px;background-attachment:local}
.ap-map[data-frame="rail"] .ap-map-viewport{max-height:clamp(260px,58vh,480px)}
.ap-map-world{position:relative}
/* Interactive canvas: a fixed-height clipped viewport; the world is transformed, never scrolled */
.ap-map-viewport[data-interactive]{height:clamp(280px,60vh,600px);max-height:none;overflow:hidden;overflow:clip;border-top-left-radius:0;border-top-right-radius:0;cursor:grab;touch-action:pinch-zoom;user-select:none;-webkit-user-select:none;overscroll-behavior:contain}
.ap-map[data-frame="rail"] .ap-map-viewport[data-interactive]{height:clamp(240px,54vh,460px)}
.ap-map-viewport[data-dragging]{cursor:grabbing}
.ap-map-viewport[data-interactive] .ap-map-world{position:absolute;left:0;top:0;transform-origin:0 0}
.ap-map-viewport[data-interactive]:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-3px}
.ap-map-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-width:0;padding:6px 8px;border:1px solid var(--oc-border);border-bottom:0;border-radius:var(--oc-radius,10px) var(--oc-radius,10px) 0 0;background:var(--oc-muted-surface)}
.ap-map-tool-set{display:flex;flex-wrap:wrap;align-items:center;gap:3px;min-width:0;max-width:100%}
.ap-map-pan{margin-left:auto}
.ap-map-tool{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:28px;height:28px;padding:0 6px;border:1px solid var(--oc-border);border-radius:6px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}
.ap-map-tool[data-text]{padding:0 9px 0 7px}
.ap-map-tool:hover{background:var(--oc-hover,color-mix(in srgb,var(--oc-fg) 6%,var(--oc-bg)))}
.ap-map-tool:active{background:color-mix(in srgb,var(--oc-fg) 10%,var(--oc-bg))}
.ap-map-tool:focus{outline:none}
.ap-map-tool:focus-visible{outline:2px solid var(--oc-focus);outline-offset:1px}
.ap-map-icon{flex:none;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ap-map-zoom{min-width:3.6em;text-align:center;font-size:11.5px;color:var(--oc-muted);font-variant-numeric:tabular-nums}
.ap-map-help{min-width:0;font-size:12px;color:var(--oc-muted);max-width:86ch}
.ap-map-help-trigger{cursor:pointer;width:fit-content;color:var(--oc-fg);font-weight:600}
.ap-map-help-trigger:focus-visible{outline:2px solid var(--oc-focus);outline-offset:2px}
.ap-map-help-body{display:flex;flex-direction:column;gap:4px;padding:8px 0}
.ap-map-help strong{color:var(--oc-fg);font-weight:600}
.ap-map-keys{line-height:1.9}
.ap-map-keys .ap-map-nowrap{white-space:nowrap}
.ap-map-help kbd{display:inline-block;min-width:1.6em;padding:0 5px;border:1px solid var(--oc-border);border-bottom-width:2px;border-radius:4px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;font-size:11px;line-height:1.5;text-align:center}
.ap-map-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.ap-map-edge{fill:none;stroke:color-mix(in srgb,var(--oc-fg) 62%,var(--oc-bg));stroke-width:1.5;stroke-linecap:round}
.ap-map-edge[data-tone="quiet"]{stroke:color-mix(in srgb,var(--oc-fg) 38%,var(--oc-bg))}
.ap-map-edge[data-skipped]{stroke-dasharray:5 4}
.ap-map-marker-open .ap-map-arrowhead{fill:color-mix(in srgb,var(--oc-fg) 62%,var(--oc-bg))}
.ap-map-marker-quiet .ap-map-arrowhead{fill:color-mix(in srgb,var(--oc-fg) 38%,var(--oc-bg))}
.ap-map-card{position:absolute;display:flex;flex-direction:column;gap:5px;margin:0;padding:9px 11px 8px 13px;border:1px solid var(--oc-border);border-radius:8px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;text-align:start;cursor:pointer;overflow:hidden;box-shadow:0 1px 2px color-mix(in srgb,var(--oc-fg) 9%,transparent)}
.ap-map-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--ap-map-accent,transparent)}
.ap-map-card:hover{border-color:color-mix(in srgb,var(--oc-fg) 38%,var(--oc-bg))}
.ap-map-card:focus{outline:none}
.ap-map-card:focus-visible{outline:2px solid var(--oc-focus);outline-offset:2px}
.ap-map-card[data-mark="working"]{--ap-map-accent:var(--oc-info)}
.ap-map-card[data-mark="ready"]{--ap-map-accent:var(--oc-success);border-color:color-mix(in srgb,var(--oc-success) 60%,var(--oc-border))}
.ap-map-card[data-mark="blocked"]{--ap-map-accent:var(--oc-warning)}
.ap-map-card:is([data-mark="waiting"],[data-mark="waiting-skipped"],[data-mark="pending"]){--ap-map-accent:color-mix(in srgb,var(--oc-muted) 40%,transparent)}
.ap-map-card:is([data-mark="done"],[data-mark="skipped"]){background:color-mix(in srgb,var(--oc-fg) 3%,var(--oc-bg));box-shadow:none}
.ap-map-card[data-mark="done"]{--ap-map-accent:color-mix(in srgb,var(--oc-success) 50%,transparent)}
.ap-map-card[data-mark="skipped"]{border-style:dashed}
.ap-map-card:is([data-mark="done"],[data-mark="skipped"]) .ap-map-card-title{color:var(--oc-muted)}
.ap-map-card[aria-current="true"]{border-color:var(--oc-primary);background:color-mix(in srgb,var(--oc-primary) 7%,var(--oc-bg));box-shadow:0 0 0 1.5px var(--oc-primary),0 6px 16px color-mix(in srgb,var(--oc-fg) 14%,transparent)}
/* Zoom-safe rings: inside the transformed world, one screen pixel is 1px / zoom (capped). */
.ap-map-viewport[data-interactive] .ap-map-world{--ap-map-px:max(1px,min(calc(1px / var(--ap-map-zoom,1)),14px))}
.ap-map-viewport[data-interactive] .ap-map-card:focus-visible{outline-width:calc(2 * var(--ap-map-px));outline-offset:calc(2 * var(--ap-map-px))}
.ap-map-viewport[data-interactive] .ap-map-card[aria-current="true"]{box-shadow:0 0 0 calc(1.5 * var(--ap-map-px)) var(--oc-primary),0 6px 16px color-mix(in srgb,var(--oc-fg) 14%,transparent)}
/* Selection chain: upstream = solid outline + "Upstream" tag; downstream = double outline + tag.
   Unrelated cards and arrows recede. Shapes and words, not colour, carry the distinction. */
.ap-map[data-highlight] .ap-map-card:not([aria-current="true"]):not([data-related]){opacity:.55}
.ap-map[data-highlight] .ap-map-edge:not([data-path]){opacity:.3}
.ap-map-card[data-related]{opacity:1}
.ap-map-card[data-related="upstream"]{border:2px solid var(--oc-primary)}
.ap-map-card[data-related="downstream"]{border:3px double var(--oc-primary)}
.ap-map-viewport[data-interactive] .ap-map-card[data-related="upstream"]{border-width:calc(2 * var(--ap-map-px))}
.ap-map-viewport[data-interactive] .ap-map-card[data-related="downstream"]{border-width:calc(3 * var(--ap-map-px))}
.ap-map-card-rel{position:absolute;z-index:1;transform:translateX(-100%);padding:0 6px;border:1px solid currentColor;border-radius:4px;background:var(--oc-bg);font-size:10px;font-weight:600;letter-spacing:.02em;line-height:14px;white-space:nowrap;pointer-events:none;color:var(--oc-primary-text,var(--oc-primary))}
.ap-map-card-rel[data-related="downstream"]{border-style:double;border-width:3px;line-height:10px}
.ap-map-edge[data-path]{stroke:var(--oc-primary);stroke-width:2.25;opacity:1}
.ap-map-marker-path .ap-map-arrowhead{fill:var(--oc-primary)}
.ap-map-chain{font-size:11.5px}
/* Arrow state (eligible pictures only: active, unarchived, current; dependency-map-view.ts arrowCue).
   Working: round blue beads over a faint blue line with a blue head. Blocked: static warning line with
   a stop bar just before the head, never animated. Selection keeps chain colour and width; beads and
   the bar keep the state's shape (the bar keeps its warning colour). Off-chain beads recede, still. */
.ap-map-edge[data-arrow="working"]{stroke:color-mix(in srgb,var(--oc-info) 34%,var(--oc-bg));stroke-width:1.5}
.ap-map-edge[data-arrow="blocked"]{stroke:var(--oc-warning);stroke-width:2}
.ap-map-edge[data-arrow="working"][data-path]{stroke:color-mix(in srgb,var(--oc-primary) 40%,var(--oc-bg));stroke-width:2.25}
.ap-map-edge[data-arrow="blocked"][data-path]{stroke:var(--oc-primary);stroke-width:2.5}
.ap-map-bead{fill:none;stroke:var(--oc-info);stroke-width:3.4;stroke-linecap:round;stroke-dasharray:0 10;pointer-events:none}
.ap-map-bead[data-chain]{stroke:var(--oc-primary);stroke-width:4}
.ap-map[data-highlight] .ap-map-bead:not([data-chain]){opacity:.3}
.ap-map-marker-working .ap-map-arrowhead{fill:var(--oc-info)}
.ap-map-marker-blocked .ap-map-arrowhead{fill:var(--oc-warning)}
.ap-map-marker-blocked-path .ap-map-arrowhead{fill:var(--oc-primary)}
.ap-map-stopbar{fill:var(--oc-warning)}
/* Motion: only the separate bead layer, only under the region's [data-motion="on"] (permission +
   cost bounds, dependency-map-view.ts applyMotion), on the shared 2.4 s reported-work phase (app.ts).
   A steady linear loop of 40 px = four bead spacings per cycle: seamless, never a fill or a percentage. */
[data-motion="on"] .ap-map-flows .ap-map-bead{animation:ap-map-flow 2.4s linear infinite}
@keyframes ap-map-flow{from{stroke-dashoffset:0}to{stroke-dashoffset:-40}}
.ap-map-card-status{display:flex;align-items:center;gap:6px;min-width:0;font-size:11px;font-weight:600;line-height:16px}
.ap-map-card-word{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--oc-muted)}
:is(.ap-map-card,.ap-map-card-status)[data-mark="working"] .ap-map-card-word{color:var(--oc-info-text,var(--oc-info))}
:is(.ap-map-card,.ap-map-card-status)[data-mark="ready"] .ap-map-card-word{color:var(--oc-success-text,var(--oc-success))}
:is(.ap-map-card,.ap-map-card-status)[data-mark="blocked"] .ap-map-card-word{color:var(--oc-warning-text,var(--oc-warning))}
.ap-map-card-title{flex:0 1 auto;min-height:0;max-height:calc(2em * 1.35);font-size:12.5px;font-weight:500;line-height:1.35;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ap-map-card-foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;font-size:11px;line-height:16px;color:var(--oc-muted)}
.ap-map-card-group{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Attribution line (S4): one 16px line that takes the title's second line inside the same fixed
   slot, so no card ever grows, moves or reflows its other rows. Session activity is a small square
   on the assigned session's name (status marks are round): filled = active, outlined = waiting for
   input. Words live in the card name, inspector and help; no animation. */
/* Four rows need 77px; tighter padding/gaps leave room for the thickest selection/chain borders
   (forced colours, zoomed-out rings) so the one-line title is never squeezed mid-glyph. */
.ap-map-card[data-who]{gap:4px;padding-top:7px;padding-bottom:6px}
.ap-map-card[data-who] .ap-map-card-title{flex:none;-webkit-line-clamp:1;max-height:calc(1em * 1.35)}
.ap-map-card[data-who] .ap-map-card-status{flex:none}
.ap-map-card-who{display:flex;align-items:center;min-width:0;font-size:11px;line-height:16px;color:var(--oc-muted)}
.ap-map-card-who-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-map-card-who[data-attribution="assigned"] .ap-map-card-who-text{color:var(--oc-fg)}
.ap-map-live-mark{display:inline-block;width:8px;height:8px;margin:0 4px 0 1px;border-radius:2px;background:var(--oc-info);vertical-align:0;forced-color-adjust:none}
.ap-map-live-mark[data-live="waiting"]{background:transparent;border:1.5px solid var(--oc-warning)}
.ap-map-who-live{display:inline-flex;align-items:center;gap:2px;font-weight:600;color:var(--oc-info-text,var(--oc-info))}
.ap-map-who-live[data-live="waiting"]{color:var(--oc-warning-text,var(--oc-warning))}
.ap-map-who-note{display:block;margin-top:2px;font-size:11.5px;color:var(--oc-muted);white-space:normal}
.ap-map-card-unlocks{flex:none;display:inline-flex;align-items:center;gap:5px;padding:0 7px;border-radius:999px;background:var(--oc-muted-surface);color:var(--oc-fg);font-weight:600}
.ap-map-unlock-icon{flex:none;display:inline-block;width:6px;height:6px;margin-right:1px;border-top:1.6px solid currentColor;border-right:1.6px solid currentColor;transform:rotate(45deg)}
.ap-map-empty{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;text-align:center;font-size:12.5px;color:var(--oc-muted);pointer-events:none}
.ap-map-empty>*{pointer-events:auto}
/* Status marks: 14px, one shape per state (forced colours keep the shapes via system colours) */
.ap-map-mark{position:relative;flex:none;display:inline-grid;place-items:center;width:14px;height:14px;border-radius:50%;forced-color-adjust:none}
.ap-map-mark::after{content:"";display:block}
.ap-map-mark[data-mark="working"]{border:1.5px solid var(--oc-info)}
.ap-map-mark[data-mark="working"]::after{width:6px;height:6px;border-radius:50%;background:var(--oc-info)}
.ap-map-mark[data-mark="ready"]{border:1.5px solid var(--oc-success)}
.ap-map-mark[data-mark="ready"]::after{width:0;height:0;margin-left:2px;border-left:5px solid var(--oc-success);border-top:3.5px solid transparent;border-bottom:3.5px solid transparent}
.ap-map-mark:is([data-mark="waiting"],[data-mark="waiting-skipped"]){border:1.5px solid color-mix(in srgb,var(--oc-muted) 85%,transparent)}
.ap-map-mark[data-mark="waiting-skipped"]{border-style:dashed}
.ap-map-mark:is([data-mark="waiting"],[data-mark="waiting-skipped"])::after{width:3px;height:4px;margin:-2px 0 0 2px;border-left:1.5px solid var(--oc-muted);border-bottom:1.5px solid var(--oc-muted)}
.ap-map-mark[data-mark="blocked"]{background:var(--oc-warning)}
.ap-map-mark[data-mark="blocked"]::after{content:"!";color:var(--oc-bg);font-size:10px;font-weight:800;line-height:1}
.ap-map-mark[data-mark="done"]{background:var(--oc-success)}
.ap-map-mark[data-mark="done"]::after{width:6px;height:3px;border-left:1.6px solid var(--oc-bg);border-bottom:1.6px solid var(--oc-bg);transform:translateY(-1px) rotate(-45deg)}
.ap-map-mark[data-mark="skipped"]{border:1.5px dashed var(--oc-muted)}
.ap-map-mark[data-mark="skipped"]::after{width:6px;height:1.5px;background:var(--oc-muted)}
.ap-map-mark[data-mark="pending"]{border:1.5px solid color-mix(in srgb,var(--oc-muted) 75%,transparent)}
/* Inspector: literal text; stacked in the rail and a narrow board, over the canvas on a wide board */
.ap-map-inspector{display:flex;flex-direction:column;gap:10px;min-width:0;padding:12px 14px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface)}
.ap-map-inspector .ap-map-card-status{font-size:12px;flex-wrap:wrap}
.ap-map-inspector-title{font-size:14px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.ap-map-tag{padding:0 7px;border:1px solid var(--oc-border);border-radius:999px;font-size:11px;font-weight:500;color:var(--oc-muted)}
.ap-map-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 12px;font-size:12px;min-width:0}
.ap-map-facts>div{display:contents}
.ap-map-facts dt{color:var(--oc-muted)}
.ap-map-facts dd{min-width:0;overflow-wrap:anywhere;white-space:pre-line}
/* Very narrow map (a 360 px rail at 400% zoom): labels stack above values, help phrases wrap */
@container ap-map (max-width:240px){.ap-map-facts{grid-template-columns:minmax(0,1fr)}.ap-map-facts dd{margin-bottom:4px}.ap-map-keys .ap-map-nowrap{white-space:normal}.ap-map-tool[data-text]{height:auto;min-height:28px;max-width:100%;padding-block:4px;white-space:normal;text-align:start;line-height:1.25}}
.ap-map-rel{display:flex;flex-direction:column;gap:4px;min-width:0;padding-top:8px;border-top:1px solid var(--oc-border)}
.ap-map-rel-h{margin:0;font-size:12px;font-weight:600}
.ap-map-rel-list{display:flex;flex-direction:column;gap:1px}
.ap-map-rel-item{display:grid;grid-template-columns:14px minmax(0,1fr);gap:8px;align-items:start;width:calc(100% + 12px);margin:0 -6px;padding:5px 6px;border:0;border-radius:6px;background:none;color:var(--oc-fg);font:inherit;text-align:start;cursor:pointer}
.ap-map-rel-item>.ap-map-mark{margin-top:2px}
.ap-map-rel-item:hover{background:var(--oc-hover)}
.ap-map-rel-item:focus-visible{outline:2px solid var(--oc-focus);outline-offset:-2px}
.ap-map-rel-text{display:flex;flex-direction:column;min-width:0}
.ap-map-rel-title{font-size:12.5px;line-height:1.35;overflow-wrap:anywhere}
.ap-map-rel-sub{font-size:11px;color:var(--oc-muted)}
.ap-map-groups{padding-top:8px;border-top:1px solid var(--oc-border);font-size:12px}
.ap-map-groups>summary{cursor:pointer;width:fit-content;max-width:100%;min-height:24px;font-weight:600}
.ap-map-group-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.ap-map-group-list li{display:flex;flex-direction:column;gap:1px;min-width:0;padding-left:10px;border-left:2px solid var(--oc-border)}
.ap-map-group-name{font-weight:500;overflow-wrap:anywhere}
@media(forced-colors:active){
.ap-map-viewport{background:Canvas;border-color:CanvasText}
.ap-map-card,.ap-map-card[data-mark]{border-color:CanvasText;background:Canvas;color:CanvasText;box-shadow:none}
.ap-map :is(.ap-map-card,.ap-map-card-status,.ap-map-stats) :is(.ap-map-card-word,.ap-map-card-title,.ap-map-card-foot,strong,.ap-map-card-unlocks){color:CanvasText}
.ap-map-card-unlocks{background:Canvas}
.ap-map-card::before{forced-color-adjust:none;background:transparent}
.ap-map-card:is([data-mark="working"],[data-mark="ready"],[data-mark="blocked"])::before{background:CanvasText}
.ap-map-card[data-mark][aria-current="true"]{border:3px solid Highlight;background:Canvas;box-shadow:none}
.ap-map-viewport[data-interactive] .ap-map-card[data-mark][aria-current="true"]{border-width:calc(3 * var(--ap-map-px))}
.ap-map-card:focus-visible,.ap-map-rel-item:focus-visible,.ap-map-select:focus-visible,.ap-map-tool:focus-visible,.ap-map-viewport[data-interactive]:focus-visible{outline:2px solid CanvasText;outline-offset:2px}
.ap-map-viewport[data-interactive] .ap-map-card:focus-visible{outline:calc(3 * var(--ap-map-px)) solid CanvasText;outline-offset:calc(2 * var(--ap-map-px))}
.ap-map-card[data-related]{border-color:CanvasText}
.ap-map-card-rel{color:CanvasText;border-color:CanvasText}
.ap-map-toolbar{border-color:CanvasText}
.ap-map-inspector[data-placement="over"]{border:2px solid CanvasText;background:Canvas;box-shadow:none}
.ap-map-close{border:1px solid ButtonText;background:ButtonFace;color:ButtonText}
.ap-map .ap-map-edge[data-path]{stroke:Highlight;stroke-width:3}
.ap-map .ap-map-marker-path .ap-map-arrowhead{fill:Highlight}
.ap-map-edge,.ap-map-edge[data-tone="quiet"]{stroke:CanvasText}
.ap-map-arrowhead,.ap-map-marker-open .ap-map-arrowhead,.ap-map-marker-quiet .ap-map-arrowhead{fill:CanvasText}
/* Arrow state without colour: round beads, a thicker blocked line with its bar, dashes for skipped;
   chain lines, beads and heads in Highlight. */
.ap-map .ap-map-edge[data-arrow="working"]:not([data-path]){stroke:CanvasText;stroke-width:1}
.ap-map .ap-map-edge[data-arrow="working"][data-path]{stroke:Highlight;stroke-width:1.5}
.ap-map .ap-map-edge[data-arrow="blocked"]:not([data-path]){stroke:CanvasText;stroke-width:2.5}
.ap-map .ap-map-bead{stroke:CanvasText}
.ap-map .ap-map-bead[data-chain]{stroke:Highlight}
.ap-map :is(.ap-map-marker-working,.ap-map-marker-blocked) .ap-map-arrowhead{fill:CanvasText}
.ap-map .ap-map-marker-blocked-path .ap-map-arrowhead{fill:Highlight}
.ap-map .ap-map-stopbar{fill:CanvasText}
.ap-map-stat,.ap-map-tag,.ap-map-card-unlocks{border:1px solid CanvasText}
.ap-map-notice:is([data-tone="quiet"],[data-tone="warning"]){border-left-color:CanvasText}
.ap-map-mark[data-mark]{border-color:CanvasText;background:Canvas}
.ap-map-mark:is([data-mark="done"],[data-mark="blocked"]){background:CanvasText}
.ap-map-mark:is([data-mark="working"],[data-mark="skipped"])::after{background:CanvasText}
.ap-map-mark[data-mark="ready"]::after{border-left-color:CanvasText}
.ap-map-mark:is([data-mark="waiting"],[data-mark="waiting-skipped"])::after{border-color:CanvasText}
.ap-map-mark[data-mark="done"]::after{border-color:Canvas}
.ap-map-mark[data-mark="blocked"]::after{color:Canvas}
.ap-map :is(.ap-map-card-who,.ap-map-card-who-text,.ap-map-who-live){color:CanvasText}
.ap-map-live-mark{background:CanvasText}
.ap-map-live-mark[data-live="waiting"]{background:Canvas;border-color:CanvasText}
}
`;
