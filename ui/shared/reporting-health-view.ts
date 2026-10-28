import { button, el, testid } from './components.ts';
import { supportSummary, type ReportingHealth } from './reporting-health.ts';
const explain:Record<string,string>={
  observed:'The service answered this explicit setup check. This does not prove recent reporting.',busy:'The progress store is busy. Try again shortly.',damaged:'The store could not be read because damage was reported. Preserve its files and review Setup diagnostics.',incompatible:'The store format is incompatible. Review the installed extension version.',
  'store-unavailable':'The configured store could not be opened. Review Setup and restore access before retrying.',
  'not-approved':'Service access is unavailable or not granted. Review the extension service permissions in the host.',paused:'The extension is paused. Resume it in the host before checking again.',
  'association-unknown':'This setup observation cannot be associated with the viewer source. Report verification was not attempted.',
  'source-mismatch':'The selected plan belongs to a different source from this configured companion. Select a plan from the configured source to check its reporting.',
  'selected-source':'The selected report belongs to the configured source and is included in this viewer selection.',
  'not-configured':'No configured installation was observed. Open Setup to review your folders.',installed:'Companion installation observed.',
  'not-observed':'An installed companion could not be established. Review Setup diagnostics.',
  'reload-required':'The selected companion files have no matching loaded observation. Restart OpenCode when convenient; this check does not restart it.',
  'matching-observation':'A matching companion load was recorded. Other running instances may still use earlier files.',
  on:'Capture is on. Agents still need to report explicitly.',off:'Capture is off. Existing history remains readable; review Setup to enable capture.',
  'not-checked':'No selected report checked. Select a plan, then open reporting health.',
  'recorded-revision':'A stored revision of the selected plan was read. This does not prove recent reporting or task completion.',
  unavailable:'The selected report could not be read. Refresh the board and review its service diagnostics.',
  'context-changed':'Setup and viewer identity could not be matched. Refresh the board before checking again.',
  stale:'The viewer has a failed refresh. Its displayed data may be stale.',
  'selected-report':'The selected report revision matches the viewer. This does not prove that a user reviewed it.',
  'revision-changed':'The stored revision differs from the viewer. Refresh the board.',unknown:'Unknown; this check has no supporting observation.',
};
export function reportingHealthBlock(p:ReturnType<ReportingHealth['claim']>){
  const box=testid(el('section','ap-details'),'reporting-health');
  button(box,'reporting-health-toggle',p.open?'Close reporting health':'Reporting health',p.toggle);
  box.querySelector('button')?.setAttribute('aria-expanded',String(p.open));
  if(!p.open)return box;
  box.append(el('h2','ap-setup-title','Reporting health'),el('p','ap-note','Read-only observations from this service. Tool availability in a particular session, including restricted child sessions, is unknown. No test report or model request is created.'));
  box.setAttribute('aria-busy',String(p.busy));
  if(p.busy)box.append(el('p','ap-note','Checking reporting observations…'));
  if(p.facts){
    const list=el('dl');
    for(const [key,label] of [['service','Service access'],['installation','Installation'],['loaded','Loaded companion'],['capture','Capture'],['report','Selected report'],['scope','Viewer scope'],['viewer','Viewer freshness']] as const){list.append(el('dt','',label),el('dd','',key==='service'&&p.facts[key]==='unavailable'?'The reporting service could not be checked. Review the host connection and Setup diagnostics, then retry.':explain[p.facts[key]]??explain.unknown));}
    box.append(list,el('p','ap-note','These observations are from the last explicit check. Refresh after changes. Service platform and session tools are not exposed by this check.'));
    const preview=testid(el('textarea'),'reporting-support-preview');preview.dataset.observation=p.observation;preview.readOnly=true;preview.value=supportSummary(p.facts);preview.rows=13;preview.style.width='100%';preview.setAttribute('aria-label','Support summary preview');box.append(preview);
    button(box,'reporting-support-copy','Copy support summary',p.copySummary);
    const status=el('p','ap-note',p.copy);status.setAttribute('role','status');box.append(status);
  }
  button(box,'reporting-health-refresh','Refresh observations',p.refresh,'outline',p.busy);
  return box;
}
