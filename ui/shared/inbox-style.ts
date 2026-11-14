// Needs you inbox styles, appended after style.ts (owned by the phone layout lane). Colours come
// only from host tokens. Coarse pointers get 44px targets from the shared device hook or the
// pointer media query; nothing here depends on hover.
export const INBOX_CSS = `
.ap-inbox{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--oc-border);border-radius:var(--oc-radius,10px);background:color-mix(in srgb,var(--oc-warning) 4%,var(--oc-bg))}
.ap-inbox[data-availability]:not([data-availability="ready"]){background:transparent;padding:10px 12px}
.ap-inbox-head{display:flex;align-items:center;gap:8px;min-width:0}
.ap-inbox-title{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;font-size:13px;font-weight:600;line-height:1.3}
.ap-inbox-title:focus{outline:none}.ap-inbox-title:focus-visible{outline:2px solid var(--oc-focus,var(--oc-info));outline-offset:3px;border-radius:4px}
.ap-inbox-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border-radius:999px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;background:color-mix(in srgb,var(--oc-fg) 8%,transparent);color:var(--oc-muted)}
.ap-inbox-count[data-tone="attention"]{background:color-mix(in srgb,var(--oc-warning) 22%,transparent);color:var(--oc-warning-text,var(--oc-fg))}
.ap-inbox-scope{flex:none}
.ap-inbox-notes{display:flex;flex-direction:column;gap:4px}
.ap-inbox-empty{font-size:12.5px;color:var(--oc-fg)}
.ap-inbox-empty[data-complete="false"]{color:var(--oc-muted)}
.ap-inbox-list{display:flex;flex-direction:column;gap:2px;min-width:0}
.ap-inbox-row{display:flex;flex-direction:column;gap:4px;min-width:0;padding:8px 10px;border-radius:8px;border-left:3px solid color-mix(in srgb,var(--oc-warning) 55%,transparent);background:var(--oc-bg);cursor:pointer}
.ap-inbox-row[data-group="also-blocked"]{border-left-color:var(--oc-border)}
.ap-inbox-row:hover{background:var(--oc-hover)}
.ap-inbox-open{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;max-width:100%;padding:2px 0;border:0;background:none;color:var(--oc-fg);text-align:start;cursor:pointer;font:inherit}
.ap-inbox-open:focus-visible,.ap-inbox-back:focus-visible,.ap-inbox-line-open:focus-visible,.ap-inbox-expand:focus-visible,.ap-inbox-also>summary:focus-visible{outline:2px solid var(--oc-focus,var(--oc-info));outline-offset:2px;border-radius:4px}
.ap-inbox-task{font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.ap-inbox-open:hover .ap-inbox-task{text-decoration:underline;text-underline-offset:2px}
.ap-inbox-plan{font-size:11.5px;color:var(--oc-muted);overflow-wrap:anywhere}
.ap-inbox-facts{display:flex;flex-direction:column;gap:4px;min-width:0;cursor:auto}
.ap-inbox-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;font-size:11.5px;min-width:0}
.ap-inbox-cat{align-self:center;margin:0}
.ap-inbox-cat:is([data-category="absent"],[data-category="invalid"],[data-category="unknown"],[data-category="unclassified"]){background:color-mix(in srgb,var(--oc-fg) 7%,transparent);color:var(--oc-muted)}
.ap-inbox-wait{font-variant-numeric:tabular-nums}
.ap-inbox-wait .ap-elapsed{color:var(--oc-fg);font-size:inherit;white-space:normal}
.ap-inbox-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;font-size:12px;min-width:0}
.ap-inbox-dl>div{display:contents}
.ap-inbox-dl dt{color:var(--oc-muted)}
.ap-inbox-dl dd{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
.ap-inbox-dl dd[data-unknown]{font-style:italic}
.ap-inbox-expand{font-size:12px}
.ap-inbox-continue{gap:6px 10px}
.ap-inbox-also{border-top:1px solid var(--oc-border);padding-top:6px;min-width:0}
.ap-inbox-also>summary{display:flex;align-items:center;gap:6px;min-height:28px;cursor:pointer;list-style:none;font-size:12px;font-weight:500;color:var(--oc-muted)}
.ap-inbox-also>summary::-webkit-details-marker{display:none}
.ap-inbox-also>summary .ap-icon{transition:transform .15s ease;transform:rotate(-90deg)}
.ap-inbox-also[open]>summary .ap-icon{transform:none}
.ap-inbox-also[open]>:not(summary){margin-top:6px}
.ap-inbox-line{min-width:0}
.ap-inbox-line-open{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;max-width:100%;min-height:26px;padding:2px 10px 2px 8px;border:1px solid var(--oc-border);border-radius:999px;background:transparent;color:var(--oc-fg);font:inherit;font-size:12px;text-align:start;cursor:pointer}
.ap-inbox-line-open:hover{background:var(--oc-hover)}
.ap-inbox-line-text{font-weight:500}
.ap-inbox-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--oc-muted)}
.ap-inbox-dot[data-tone="attention"]{background:var(--oc-warning)}
.ap-inbox-reading{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px 12px;border-radius:var(--oc-radius,10px);background:var(--oc-muted-surface,var(--oc-hover))}
.ap-inbox-back{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:2px 10px 2px 6px;border:1px solid var(--oc-border);border-radius:6px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;font-size:12px;cursor:pointer}
.ap-inbox-back:hover{background:var(--oc-hover)}
.ap-inbox-reading-h{display:flex;flex-direction:column;gap:2px;min-width:0}
.ap-inbox-reading-h:focus{outline:none}.ap-inbox-reading-h:focus-visible{outline:2px solid var(--oc-focus,var(--oc-info));outline-offset:3px;border-radius:4px}
.ap-inbox-reading-label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--oc-muted)}
.ap-inbox-reading-task{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.ap-inbox-reading-status:empty{display:none}
.ap-inbox-reading-status{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12px}
@media(pointer:coarse){.ap-inbox-open,.ap-inbox-back,.ap-inbox-line-open,.ap-inbox-also>summary,.ap-inbox-expand,.ap-inbox-continue button,.ap-inbox-reading-status button{min-height:44px}.ap-inbox-expand{display:inline-flex;align-items:center}}
[data-device-pointer="coarse"] :is(.ap-inbox-open,.ap-inbox-back,.ap-inbox-line-open,.ap-inbox-also>summary,.ap-inbox-expand,.ap-inbox-continue button,.ap-inbox-reading-status button){min-height:44px}
[data-device-pointer="coarse"] .ap-inbox-expand{display:inline-flex;align-items:center}
@media(min-width:760px){.ap-inbox-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:8px;align-items:start}}
@media(max-width:480px){.ap-inbox{padding:10px}.ap-inbox-row{padding:8px}}
@media(max-width:340px){.ap-inbox-dl{grid-template-columns:minmax(0,1fr)}.ap-inbox-dl dd{margin-bottom:2px}}
@media(prefers-reduced-motion:reduce){.ap-inbox-also>summary .ap-icon{transition:none}}
@media(forced-colors:active){.ap-inbox,.ap-inbox-row,.ap-inbox-line-open,.ap-inbox-back{border-color:CanvasText}.ap-inbox-dot,.ap-inbox-count{forced-color-adjust:none;background:CanvasText;color:Canvas}}
`;
