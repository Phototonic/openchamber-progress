import { setImmediate } from 'node:timers/promises';
import { MENTIONS_ITEMS_MAX, MENTION_TITLE_MAX, MENTION_TEXT_MAX, MENTIONS_RESOLVE_TIMEOUT_MS } from '@openchamber/sdk';
import { identifier, countItems, ProgressError, requireProgress as need, type Item, type Contribution } from '../shared/progress.ts';
import { validateDigestSnapshot } from '../shared/change-digest.ts';
import { queryTokens, searchMatches } from '../shared/plan-task-search.ts';
import { formatComposerSummary } from '../shared/summary.ts';
import type { SummaryInput } from '../shared/summary-types.ts';
import type { Store } from '../shared/store.ts';

export function mentionBody(text:string,kind:'search'|'resolve'):Record<string,unknown> {
  let b:unknown;try{b=JSON.parse(text);}catch{throw new ProgressError('invalid');}
  need(b!==null&&typeof b==='object'&&!Array.isArray(b));
  const body=b as Record<string,unknown>,keys=kind==='search'?['query','directory']:['id'];
  need(Object.keys(body).length===keys.length&&Object.keys(body).every(k=>keys.includes(k)));
  if(kind==='search'){
    need(typeof body.query==='string'&&body.query.length<=200&&!body.query.includes('\0'));
    need(body.directory===null||typeof body.directory==='string'&&body.directory.length<=4096&&!body.directory.includes('\0'));
  }else{need(typeof body.id==='string');const parts=body.id.split('/');need(parts.length===2&&parts.every(identifier));}
  return body;
}

/** Display only: identity and summary keep the complete recorded values. */
export function menuText(text:string):string {
  const flat=text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu,' ').trim();
  if(flat.length<=MENTION_TITLE_MAX)return flat;
  let end=MENTION_TITLE_MAX-1;if(/[\uD800-\uDBFF]/.test(flat[end-1]))end--;
  return flat.slice(0,end)+'…';
}
export function searchMentions(store:Store,query:string,directory:string|null,alive:()=>boolean) {
  // The 200-code-unit body limit bounds mention queries; /v1/search's 16-token admission limit does not apply here.
  const tokens=queryTokens(query),read=store.mentionCandidates(directory,alive);
  const candidates=read.candidates.filter(c=>searchMatches(tokens,c.plan.title,c.plan.id));
  candidates.sort((a,b)=>a.locality-b.locality||Number(a.plan.lifecycle!=='active')-Number(b.plan.lifecycle!=='active')||Date.parse(b.plan.reportedAt)-Date.parse(a.plan.reportedAt)||Buffer.compare(Buffer.from(`${a.plan.sourceId}/${a.plan.id}`),Buffer.from(`${b.plan.sourceId}/${b.plan.id}`)));
  return {items:candidates.slice(0,MENTIONS_ITEMS_MAX).map(({plan:p,verified})=>{
    const source=!read.binding.verified||!verified?'Unverified OpenCode setup':read.binding.sourceId!==p.sourceId?'From another OpenCode setup':'';
    return {id:`${p.sourceId}/${p.id}`,title:menuText(p.title)||p.id,subtitle:menuText([p.lifecycle,`${p.counts.done}/${p.counts.total} done`,source,read.limited?'Limited search':''].filter(Boolean).join(' · '))};
  })};
}

/** Bounded complete current detail, without loopback HTTP/document/history/timing work. */
// The service reopens its Store per request, which closes the previous handle. Reacquire it for
// every page instead of holding one across awaits; each page is still checked against the pinned identity.
export async function resolveMention(source:Store|(()=>Store),key:string,alive:()=>boolean) {
  const acquire=typeof source==='function'?source:()=>source;
  const store={mentionDetail:(...args:Parameters<Store['mentionDetail']>)=>acquire().mentionDetail(...args)};
  return resolveFrom(store,key,alive);
}
async function resolveFrom(store:Pick<Store,'mentionDetail'>,key:string,alive:()=>boolean) {
  const [source,id]=key.split('/'),deadline=performance.now()+MENTIONS_RESOLVE_TIMEOUT_MS-2000;
  let bytes=0,pinned:string|undefined;
  const check=()=>need(alive()&&performance.now()<deadline,'storage');
  for(let restart=0;restart<=3;restart++){
    check();const first=store.mentionDetail(source,id);
    const identity=(p:typeof first)=>JSON.stringify([p.storeId,p.sourceBinding,p.plan.sourceId,p.plan.id,p.sources.find(s=>s.id===source)?.verified]);
    need(first.plan.sourceId===source&&first.plan.id===id,'conflict');
    const pin=identity(first);if(pinned!==undefined)need(pin===pinned,'conflict');pinned=pin;
    need(first.plan.cleanup?.state!=='archived','not-found');
    const items:Item[]=[],contributions:Contribution[]=[];
    let page=first,mixed=false,itemNext=true,contribNext=true;
    for(let n=0;n<120;n++){
      check();need(identity(page)===pin,'conflict');need(page.plan.cleanup?.state!=='archived','not-found');
      if(page.plan.revision!==first.plan.revision||JSON.stringify(page.plan.cleanup??null)!==JSON.stringify(first.plan.cleanup??null)){mixed=true;break;}
      bytes+=Buffer.byteLength(JSON.stringify(page));need(bytes<=16*1024*1024,'storage');
      if(itemNext)items.push(...page.items.data);if(contribNext)contributions.push(...page.contributions.data);
      need(items.length<=1000,'storage');
      const itemCursor:string|null=itemNext?page.items.nextCursor:null,contribCursor:string|null=contribNext?page.contributions.nextCursor:null;
      itemNext=itemCursor!==null;contribNext=contribCursor!==null;
      if(!itemNext&&!contribNext)break;
      const cursor=itemCursor??contribCursor;need(cursor===String(n+1),'conflict');
      await setImmediate();check();page=store.mentionDetail(source,id,Number(cursor));
    }
    if(mixed)continue;
    need(!itemNext&&!contribNext,'storage');
    const p=first.plan;
    need(validateDigestSnapshot({...p,items,links:first.links},source,id,p.revision)!==null,'conflict');
    need(first.assembly?.itemCount===items.length,'conflict');
    const counts=countItems(items);need((Object.keys(counts) as (keyof typeof counts)[]).every(k=>counts[k]===p.counts[k]),'conflict');
    // Every committed progress revision has exactly one contribution; neutral receipts
    // do not advance the revision. A prematurely ended contribution stream is not complete.
    need(contributions.length===p.revision&&contributions.every((c,n)=>c.revision===n+1&&['direct','parent-relay'].includes(c.mode)),'conflict');
    const plan:SummaryInput['plan']={key,id,sourceId:source,title:p.title,ownerSessionId:p.sessionId,revision:p.revision,lifecycle:p.lifecycle==='finished'?'completed':p.lifecycle,reportedAt:p.reportedAt,counts:p.counts,cleanup:p.cleanup,document:p.document};
    const input:SummaryInput={ok:true,plan,snapshot:{plan:{...plan,counts:p.counts},identity:{storeId:first.storeId,binding:first.sourceBinding,sourceId:source,planId:id},captureEnabled:first.captureEnabled,diagnostics:first.diagnostics},detail:{key,revision:p.revision,items,contributions}};
    const sourceState=!first.sourceBinding.verified||first.sources.find(s=>s.id===source)?.verified!==true?'unverified':first.sourceBinding.sourceId===source?'bound':'other';
    check();const text=formatComposerSummary(input,'handoff','en',{source:sourceState});need(text!==null&&text.length>0&&text.length<=MENTION_TEXT_MAX,'storage');return {text};
  }
  throw new ProgressError('conflict');
}
