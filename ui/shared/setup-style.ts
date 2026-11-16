// Setup-only presentation for the step-by-step switch. Uses the shared tokens; injected once per frame.
export const SETUP_CSS = `
.ap-migration{gap:8px}
.ap-migration .ap-setup-title{font-size:13.5px;margin:0}
.ap-migration-step{font-weight:600;overflow-wrap:anywhere}
.ap-migration .ap-facts{margin-top:0}
.ap-migration .ap-facts dd{overflow-wrap:anywhere}
.ap-migration-failure{display:flex;flex-direction:column;gap:2px}
.ap-migration-where{overflow-wrap:anywhere}
.ap-migration-code{font-family:var(--oc-mono);font-size:11px;white-space:nowrap}
.ap-migration-confirm{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--oc-border);border-radius:var(--oc-radius,8px);background:var(--oc-bg)}
.ap-migration-confirm .ap-setup-title{font-size:13px;margin:0}
.ap-migration .oc-sdk-banner{min-width:0}
.ap-fresh-plan{display:flex;flex-direction:column;gap:2px}
.ap-fresh-steps{list-style:decimal;margin:4px 0;padding-left:1.6em;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.ap-fresh-steps li{padding:3px 0 3px 4px}
.ap-fresh-steps li::marker{color:var(--oc-muted)}
.ap-fresh-steps li[aria-current="step"]{font-weight:600}
.ap-fresh-steps li[data-state="complete"]::marker{color:var(--oc-success-text)}
.ap-fresh-group-state{display:block;color:var(--oc-muted);font-size:12px;font-weight:400}
.ap-setup-details{min-width:0;font-size:12px}
.ap-setup-details>summary{cursor:pointer;color:var(--oc-muted);padding:10px 0;overflow-wrap:anywhere}
.ap-setup-details>summary:focus-visible{outline:2px solid var(--oc-focus);outline-offset:2px}
.ap-setup-details[open]{display:flex;flex-direction:column;gap:8px}
.ap-setup-details .ap-fresh-steps{font-size:12px}
.ap-fresh-facts dd{overflow-wrap:anywhere}
`;
export function ensureSetupStyle() {
  if (typeof document === 'undefined' || document.getElementById('ap-setup-style')) return;
  const style = document.createElement('style');
  style.id = 'ap-setup-style';
  style.textContent = SETUP_CSS;
  document.head.append(style);
}
