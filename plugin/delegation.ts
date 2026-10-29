import type { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { canonical, Store } from '../shared/store.ts';
import { identifier, parseRequest, requireProgress as need, type Actor, type Request, type Receipt } from '../shared/progress.ts';

const TTL = 300_000;
type Intent = { request: Request; actor: Actor; generation: number; expires: number; expiresAt: string; state: 'pending' | 'reserved' | 'retired' | 'bound'; hash: string; receipt?: Receipt; group?: Group; call?: string; oid: string; observedAt?: string; controller?: AbortController };
type Candidate = { tool?: string; before?: boolean; after?: boolean; child?: string; start?: boolean; called?: boolean };
type Group = { parent: string; message: string; expires: number; hooks: Map<string,Candidate>; native: Map<string,Candidate>; closed: boolean; failed: boolean; intent?: Intent };
const object = (v: unknown): v is Record<string,any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One running companion only. No declarations, census or retry records are persisted. */
export async function registerDelegation(ctx: Plugin.Context, options: {
  store: Store;
  sourceId: string;
  identity(sessionID: string, alive: () => boolean, signal: AbortSignal): Promise<Actor>;
  now?: () => number;
}) {
  const { store } = options;
  store.installDelegationControl();
  const now = options.now ?? (() => performance.now());
  const pending = new Map<string,Intent>(), retries = new Map<string,Intent>(), groups = new Map<string,Group>();
  const calls = new Map<string,Group>();
  const registrations: Array<{dispose(): Promise<void>}> = [];
  const jobs = new Set<Promise<void>>();
  const lookups = new Set<string>();
  const abort = new AbortController();
  let disposed = false, healthy = false;
  let epoch = store.delegationControl().generation;
  let events: Promise<void> | undefined;
  function retire(i: Intent) { if(i.state === 'bound') return; i.state = 'retired'; i.controller?.abort(); if(pending.get(i.actor.sessionId) === i)pending.delete(i.actor.sessionId); }
  function fault() { healthy = false; for(const i of pending.values())retire(i); }
  function control() {
    if(disposed)return false;
    const c = store.delegationControl();
    if(c.generation !== epoch || !c.enabled) { for(const i of pending.values())retire(i); epoch=c.generation; }
    return c.enabled;
  }
  function prune() {
    for(const i of pending.values())if(now() >= i.expires)retire(i);
    for(const [k,i] of retries)if(now() >= i.expires)retries.delete(k);
    // Authority expires; evidence of outstanding execution does not. Dropping
    // unresolved groups/calls would falsely certify an empty in-flight census.
    for(const [k,g] of groups)if(now() >= g.expires) {
      if(g.intent) { retire(g.intent);delete g.intent; }
      if(!unresolved(g))groups.delete(k);
    }
    for(const [k,g] of calls)if(now() >= g.expires && !unresolved(g))calls.delete(k);
  }
  function unresolved(g: Group, except?: { group: Group; call: string }) {
    if(g.closed)return false;
    const other=(id:string)=>g!==except?.group || id!==except.call;
    return [...g.hooks].some(([id,h])=>other(id) && h.before && !h.after) ||
      [...g.native].some(([id,n])=>other(id) && (n.tool==='subagent'||n.tool==='task'||!n.tool) && !g.hooks.get(id)?.after);
  }
  function live(i: Intent) { return control() && healthy && now() < i.expires && pending.get(i.actor.sessionId) === i && i.state === 'reserved' && !i.group?.failed; }
  function group(parent: string, message: string): Group | undefined {
    const key=JSON.stringify([parent,message]);
    let g=groups.get(key);
    if(!g) {
      if(groups.size >= 256) { fault(); return; }
      g={parent,message,expires:now()+TTL,hooks:new Map(),native:new Map(),closed:false,failed:false}; groups.set(key,g);
    }
    return g;
  }
  function reject(g: Group) { g.failed=true; if(g.intent)retire(g.intent); }
  function candidate(g: Group, map: Map<string,Candidate>, id: string) {
    let c=map.get(id);
    if(!c) {
      const key=JSON.stringify([g.parent,g.message,id]);
      if(!calls.has(key)) { if(calls.size>=256){reject(g);fault();return;}calls.set(key,g); }
      c={}; map.set(id,c);
    }
    return c;
  }
  function unique(g: Group, i: Intent) {
    if(g.failed || !g.closed || g.hooks.size !== 1)return false;
    const h=g.hooks.get(i.call!);
    // Unpaired called/start stages, even with unknown names, cannot certify a census.
    if([...g.native.values()].some(c => !c.start || !c.called || !c.tool))return false;
    const native=[...g.native].filter(([,c])=>c.tool==='subagent'||c.tool==='task');
    return !!h?.before && !!h.after && !!h.child && h.tool==='subagent' && native.length===1 && native[0]![0]===i.call && native[0]![1].tool===h.tool;
  }
  function launch(action: () => Promise<void>) {
    const job=action().catch(()=>{fault();}); jobs.add(job); void job.finally(()=>jobs.delete(job));
  }
  function finalize(g: Group) {
    const i=g.intent;
    if(!i || !live(i))return;
    if(!unique(g,i)) { retire(i); return; }
    if(lookups.has(g.parent)) { retire(i);return; }
    lookups.add(g.parent);
    const controller=new AbortController(); i.controller=controller;
    const deadline=now()+1000;
    const alive=()=>!controller.signal.aborted && now()<deadline && live(i) && unique(g,i);
    launch(async()=>{
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Never await the closing event from execute.after: the runner publishes it afterwards.
        const lookup=(async()=>{
          if(!alive())return;
          const child=await options.identity(g.hooks.get(i.call!)!.child!,alive,controller.signal);
          if(!alive())return;
          need(child.sessionId===g.hooks.get(i.call!)!.child && child.parentId===g.parent && child.ancestry?.[0]===g.parent && child.sourceId===options.sourceId && child.verifiedSource,'assignment');
          need(child.directory===i.actor.directory && child.projectId===i.actor.projectId,'assignment');
          if(!alive())return;
          i.receipt=store.apply({op:'link',plan:i.request.plan,oid:i.oid,rev:i.request.rev,child:child.sessionId,assign:i.request.assign},i.actor,undefined,child,{generation:i.generation,messageId:g.message,callId:i.call!,observedAt:i.observedAt!});
          i.state='bound'; pending.delete(i.actor.sessionId);
        })().finally(()=>lookups.delete(g.parent));
        await Promise.race([lookup,new Promise<void>(resolve=>{timer=setTimeout(()=>{retire(i);resolve();},1000);})]);
      } catch { retire(i); }
      finally { clearTimeout(timer); controller.abort(); if(i.state!=='bound')retire(i); }
    });
  }
  function disposition(i: Intent) { return { plan:i.request.plan,rev:i.request.rev,delegation:{state:i.state,expiresAt:i.expiresAt,memoryOnly:true,lostOnRestart:true,requires:'supported-next-delegation',...(i.receipt?{receipt:i.receipt}:{})} }; }
  function declare(value: unknown, actor: Actor) {
    prune(); need(!disposed,'binding');need(control(),'disabled');
    const r=parseRequest(value); need(r.op==='delegate');
    need(actor.sourceId===options.sourceId && actor.verifiedSource,'source-unverified');
    const key=JSON.stringify([actor.sourceId,actor.sessionId,r.plan,r.oid]), hash=canonical(r);
    const old=retries.get(key);
    if(old) { need(old.hash===hash,'operation-reused'); return disposition(old); }
    need(healthy,'binding');
    const current=pending.get(actor.sessionId);
    if(current && r.assign!.length) { retire(current); store.validateDeclaration(r,actor); need(false,'conflict',r.rev); }
    const generation=store.validateDeclaration(r,actor);
    need(retries.size<256,'busy');
    if(current && current.request.plan===r.plan)retire(current);
    need(pending.size<128 || !r.assign!.length,'busy');
    const i:Intent={request:r,actor:structuredClone(actor),generation,expires:now()+TTL,expiresAt:new Date(Date.now()+TTL).toISOString(),state:r.assign!.length?'pending':'retired',hash,oid:`delegation-${randomUUID()}`};
    retries.set(key,i); if(r.assign!.length)pending.set(actor.sessionId,i);
    return disposition(i);
  }
  async function dispose() {
    disposed=true; fault(); abort.abort();
    for(const r of registrations.splice(0))try{await r.dispose();}catch{}
    await events; pending.clear(); retries.clear(); groups.clear();calls.clear();
  }
  try {
    registrations.push(await ctx.tool.hook('execute.before', event=>{
      try {
        if(event.tool!=='subagent' && event.tool!=='task')return;
        prune(); const enabled=control(); if(!healthy)return;
        if(!identifier(event.sessionID)||!identifier(event.messageID)||!identifier(event.id)) { fault();return; }
        const g=group(event.sessionID,event.messageID); if(!g)return;
        if(g.hooks.get(event.id)?.before && g.hooks.get(event.id)?.tool===event.tool)return;
        if(g.closed) { reject(g);const i=pending.get(event.sessionID);if(i)retire(i);return; }
        const c=candidate(g,g.hooks,event.id); if(!c)return;
        if(c.before) { if(c.tool!==event.tool)reject(g);return; }
        c.tool=event.tool;c.before=true;
        if(!enabled)return; // capture-off observes execution, never reserves authority
        const i=pending.get(event.sessionID);
        if(!i)return;
        if(i.state==='reserved') { reject(g);retire(i);return; }
        const inFlight=[...groups.values()].some(other=>other.parent===g.parent && unresolved(other,{group:g,call:event.id}));
        if(inFlight || g.failed || g.hooks.size!==1 || event.tool!=='subagent') { retire(i);return; }
        i.state='reserved';i.group=g;i.call=event.id;i.observedAt=new Date().toISOString();g.intent=i;
      } catch { fault(); } // observations must never affect delegated execution
    }));
    registrations.push(await ctx.tool.hook('execute.after',event=>{
      try {
        if(event.tool!=='subagent' && event.tool!=='task')return;
        prune();control();if(!healthy)return;
        const g=group(event.sessionID,event.messageID);if(!g)return;
        const c=g.hooks.get(event.id);
        const output=event.status==='completed' && object(event.result.output)?event.result.output:undefined;
        const child=output?.sessionID;
        if(c?.after && c.tool===event.tool && c.child===child && ['completed','running'].includes(output?.status))return;
        if(g.closed || !c?.before || c.tool!==event.tool) { reject(g); const i=pending.get(event.sessionID);if(i)retire(i);return; }
        // Even an error result closes this observed execution. It can release
        // outstanding-call evidence, but can never make a failed group bind.
        if(!identifier(child) || !['completed','running'].includes(output?.status)) { c.after=true;reject(g);return; }
        if(c.after && c.child!==child) { reject(g);return; }
        c.after=true;c.child=child;
      } catch { fault(); }
    }));
    try {
      const stream=ctx.event.subscribe({signal:abort.signal});
      need(stream && typeof stream[Symbol.asyncIterator]==='function','binding'); healthy=true;
      events=(async()=>{
        try {
          for await(const event of stream) {
            if(disposed)break;
            if(!['session.tool.input.started','session.tool.called','session.step.ended','session.step.failed'].includes(event.type))continue;
            prune();control();if(!healthy)continue;
            const e=event as any, d=e.data;
            if(!object(d)||!identifier(d.sessionID)||!identifier(d.assistantMessageID)||e.location?.directory!==ctx.location.directory || e.durable?.aggregateID!==d.sessionID || !Number.isSafeInteger(e.durable?.seq)) { fault();continue; }
            const g=group(d.sessionID,d.assistantMessageID);if(!g)continue;
            if(event.type==='session.step.failed') { g.closed=true;reject(g);continue; }
            if(event.type==='session.step.ended') {
              if(g.closed)continue;
              g.closed=true;finalize(g);continue;
            }
            if(g.closed) {
              const prior=g.native.get(d.id);
              if(prior && (event.type==='session.tool.called' && prior.called || event.type==='session.tool.input.started' && prior.start && prior.tool===d.name))continue;
              reject(g);continue;
            }
            if(!identifier(d.id)) { reject(g);continue; }
            const c=candidate(g,g.native,d.id);if(!c)continue;
            if(event.type==='session.tool.input.started') {
              if(typeof d.name!=='string'||!d.name||d.name.length>128 || c.tool && c.tool!==d.name) { reject(g);continue; }
              c.start=true;c.tool=d.name;
            } else c.called=true; // never inspect called-event arguments
            if([...g.native.values()].filter(n=>n.tool==='subagent'||n.tool==='task').length>1 && g.intent)retire(g.intent);
          }
        } catch { /* subscription loss cannot fall back to hook-only uniqueness */ }
        finally { fault(); }
      })();
    } catch { fault(); }
    return {declare,dispose,settled:async()=>{await Promise.all([...jobs]);}};
  } catch(error) { await dispose();throw error; }
}
