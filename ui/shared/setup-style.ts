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
`;
export function ensureSetupStyle() {
  if (typeof document === 'undefined' || document.getElementById('ap-setup-style')) return;
  const style = document.createElement('style');
  style.id = 'ap-setup-style';
  style.textContent = SETUP_CSS;
  document.head.append(style);
}
