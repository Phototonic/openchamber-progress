import { mountSelect } from '@openchamber/sdk/ui';
import { button, el, testid } from './components.ts';
import type { CapturePanel } from './capture-comparison.ts';

const when = (value: string, locale: string) => new Date(value).toLocaleString(locale);
/** Literal text only: captured markup never reaches an HTML or Markdown renderer. */
export function captureComparisonBlock(p: CapturePanel, locale: string): HTMLElement {
  const section = testid(el('section', 'ap-capture'), 'capture-comparison');
  section.setAttribute('aria-label', 'Compare recorded captures');
  section.append(el('h3', 'ap-h', 'Compare recorded captures'));
  section.append(el('p', 'ap-note', 'See changes between two saved versions of this plan document. The live file is not rechecked.'));
  if (!p.capable) { section.append(el('p', 'ap-note', 'Capture comparison is unavailable with this service version.')); return section; }
  const opener = button(section, 'capture-toggle', p.open ? 'Close comparison' : 'Compare recorded captures', p.toggle);
  opener.querySelector('button')?.setAttribute('aria-expanded', String(p.open));
  if (!p.open) return section;
  const controls = el('div', 'ap-capture-controls');
  for (const [side,label] of [['before','Older capture'],['after','Newer capture']] as const) {
    const holder = testid(el('div'), `capture-${side}`);
    mountSelect(holder, { label, value: p[side] ? String(p[side]!.id) : '', options: p.entries.map(e => ({ id: String(e.id), label: `#${e.id} · ${when(e.capturedAt,locale)} · revision ${e.revision}` })), onChange: id => p.choose(side, Number(id)) });
    controls.append(holder);
  }
  section.append(controls);
  const actions = el('div', 'ap-row'), reversed = !!p.before && !!p.after && p.before.id > p.after.id;
  button(actions,'capture-compare',p.comparing ? 'Comparing…' : 'Compare',p.compare,'outline',p.comparing || !p.before || !p.after || reversed);
  button(actions,'capture-refresh','Refresh captures',p.refresh,'ghost',p.loading);
  if (!p.exhausted && p.hasRead) button(actions,'capture-more','Look for older captures',p.more,'ghost',p.loading);
  section.append(actions);
  if (reversed) section.append(el('p','ap-note','Choose the older capture first.'));
  if (p.loading) section.append(testid(el('p','ap-note','Looking for recorded captures…'),'capture-loading'));
  if (p.indexError) { section.append(testid(el('p','ap-note',p.indexError),'capture-index-error'));button(section,'capture-retry','Retry capture discovery',p.retryIndex,'outline',p.loading); }
  if (p.hasRead && !p.loading && !p.indexError) {
    const count=p.entries.length;
    const message=p.exhausted ? count===0 ? 'No document captures have been recorded for this plan.' : count===1 ? 'Only one recorded capture is available. A second capture is needed to show changes.' : 'Reached the beginning of recorded capture history.' : 'More history may be available. Look for older captures to continue the bounded search.';
    section.append(testid(el('p','ap-note',message),'capture-coverage'));
  }
  if (p.newer) section.append(testid(el('p','ap-note','A newer plan report is available. Your capture pair stays selected; refresh captures to discover versions, or Compare again for current checklist metadata.'),'capture-newer'));
  if (p.comparisonError) section.append(testid(el('p','ap-note',p.comparisonError),'capture-error'));
  const r=p.result;if(!r)return section;
  const metadata=el('div','ap-capture-metadata');
  for(const [label,e] of [['Older',r.before],['Newer',r.after]] as const){
    const box=el('div');box.append(el('h4','ap-h',`${label} capture #${e.id}`),el('p','ap-note',`${when(e.capturedAt,locale)} · revision ${e.revision}`),el('p','ap-capture-path',e.path));
    box.append(el('p','ap-note',e.id===r.current.captureId ? r.current.checklistSynchronized ? 'Current capture: the task list was confirmed against it at the observed revision.' : 'Current capture: task-list synchronization was not confirmed at the observed revision.' : 'Historical capture: checklist synchronization is unknown.'));
    metadata.append(box);
  }
  section.append(metadata);
  section.append(el('p','ap-note',`Current metadata observed at plan revision ${r.current.revision}. Last file check: ${r.current.checkedAt ? when(r.current.checkedAt,locale) : 'unknown'}.`));
  if(r.current.state!=='captured')section.append(el('p','ap-note',`The latest file check is ${r.current.state}. These retained captures are not the current file.`));
  if(!r.current.captureEnabled)section.append(el('p','ap-note','Capture is disabled; retained versions remain readable.'));
  section.append(el('p','ap-note','This comparison does not establish approval, completion, or the live file’s current contents.'));
  const result=r.result;
  if(result.state==='equal'){section.append(testid(el('p','ap-note','These captures contain identical text. This does not mean the live file is unchanged.'),'capture-equal'));return section;}
  if(result.state==='limited'){
    const reason={bytes:'the stored document exceeds the supported size',lines:'there are too many lines',work:'the changes exceed the comparison work limit',output:'the diff is too large to display'}[result.reason];
    section.append(testid(el('p','ap-note',`Comparison is limited because ${reason}. No partial diff is shown. Choose a closer pair or read the recorded document above.`),'capture-limited'));return section;
  }
  section.append(testid(el('p','ap-note',`${result.added} added · ${result.removed} removed. + means added; − means removed. LF, CRLF and “no final newline” identify line endings.`),'capture-diff-summary'));
  const diff=testid(el('div','ap-capture-diff'),'capture-diff');
  for(const h of result.hunks){
    if(h.omittedBefore)diff.append(el('p','ap-capture-context',`${h.omittedBefore} unchanged lines omitted`));
    diff.append(el('p','ap-capture-context',`Older line ${h.oldStart} · newer line ${h.newStart}`));
    for(const l of h.lines){
      const line=el('div',`ap-capture-line ap-capture-${l.kind}`);
      line.append(el('span','ap-capture-number',`${l.oldLine??'·'} ${l.newLine??'·'} ${l.kind==='added'?'+':l.kind==='removed'?'−':' '}`),el('code','ap-capture-text',l.text));
      if(l.kind!=='context')line.append(el('span','ap-capture-ending',l.ending==='none'?'no final newline':l.ending.toUpperCase()));
      diff.append(line);
    }
  }
  if(result.omittedAfter)diff.append(el('p','ap-capture-context',`${result.omittedAfter} unchanged lines omitted`));
  section.append(diff);return section;
}
