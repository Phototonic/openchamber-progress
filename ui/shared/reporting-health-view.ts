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
  const box=testid(el('section','ap-health'),'reporting-health');
  button(box,'reporting-health-toggle',p.open?'Close reporting health':'Reporting health',p.toggle,'ghost');
  box.querySelector('button')?.setAttribute('aria-expanded',String(p.open));
  if(!p.open)return box;
  box.append(el('p','ap-note','Last explicit check · recorded observations only'));
  box.setAttribute('aria-busy',String(p.busy));
  if(p.busy)box.append(el('p','ap-note','Checking reporting observations…'));
  if(p.facts){
    const labels = [['service','Service'],['installation','Companion'],['loaded','Loaded version'],['capture','Capture'],['report','Selected report'],['scope','Source'],['viewer','Viewer']] as const;
    const short:Record<string,string>={observed:'Responding',installed:'Installed','not-configured':'Not configured','not-observed':'Not confirmed','matching-observation':'Match observed','reload-required':'Reload needed',on:'On',off:'Off','recorded-revision':'Recorded','not-checked':'Not checked','selected-source':'Matches selection','source-mismatch':'Different source','association-unknown':'Not verified','selected-report':'Revision matches','revision-changed':'Refresh needed',stale:'Stale',unknown:'Unknown',unavailable:'Unavailable','context-changed':'Recheck needed',busy:'Busy',damaged:'Unreadable',incompatible:'Incompatible','store-unavailable':'Unavailable','not-approved':'Access needed',paused:'Paused'};
    const positive=new Set(['observed','installed','matching-observation','on','recorded-revision','selected-source','selected-report']);
    const neutral=new Set(['unknown','not-checked','not-observed','association-unknown']);
    const list=el('dl','ap-health-grid');
    for(const [key,label] of labels){const value=p.facts[key];const row=el('div','ap-health-row');const status=el('dd','ap-health-status');status.dataset.tone=positive.has(value)?'good':neutral.has(value)?'neutral':'attention';const mark=el('span','ap-health-mark',positive.has(value)?'✓':neutral.has(value)?'—':'!');mark.setAttribute('aria-hidden','true');status.append(mark,el('span','',short[value]??'Unknown'));row.append(el('dt','',label),status);list.append(row);}
    box.append(list);
    const details=testid(el('details','ap-health-details'),'reporting-explanations');details.append(el('summary','','What these checks mean'));
    const explanations=el('dl','ap-health-explanations');
    for(const [key,label] of labels)explanations.append(el('dt','',label),el('dd','',key==='service'&&p.facts[key]==='unavailable'?'The reporting service could not be checked. Review the host connection and Setup diagnostics, then retry.':explain[p.facts[key]]??explain.unknown));
    details.append(explanations,el('p','ap-note','Service platform and session tool availability are unknown. These checks do not prove recent reporting or task completion.'));box.append(details);
    const support=testid(el('details','ap-health-details'),'reporting-support');support.append(el('summary','','Support summary'));
    const preview=testid(el('textarea'),'reporting-support-preview');preview.dataset.observation=p.observation;preview.readOnly=true;preview.value=supportSummary(p.facts);preview.rows=8;preview.className='ap-summary-text';preview.setAttribute('aria-label','Support summary preview');support.append(preview);
    button(support,'reporting-support-copy','Copy support summary',p.copySummary);
    const status=el('p','ap-note',p.copy);status.setAttribute('role','status');support.append(status);box.append(support);
  }
  button(box,'reporting-health-refresh','Refresh observations',p.refresh,'outline',p.busy);
  return box;
}
