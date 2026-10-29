import fs from 'node:fs';
import { Store } from '../../shared/store.ts';
import { registerDelegation } from '../../plugin/delegation.ts';
import { sessionIdentity } from '../../plugin/identity.ts';
import type { Actor } from '../../shared/progress.ts';

export function deferred<T=void>() {let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};}
export class Events implements AsyncIterable<any> {
  queue:Array<{value:any;done:ReturnType<typeof deferred<void>>}> = [];
  wake=deferred();closed=false;previous?:ReturnType<typeof deferred<void>>;error=false;
  push(value:any){if(this.closed)return Promise.resolve();const done=deferred();this.queue.push({value,done});this.wake.resolve();return done.promise;}
  close(){this.closed=true;this.wake.resolve();this.previous?.resolve();for(const q of this.queue)q.done.resolve();}
  [Symbol.asyncIterator](){return {next:async():Promise<IteratorResult<any>>=>{
    this.previous?.resolve();this.previous=undefined;
    while(!this.queue.length&&!this.closed){await this.wake.promise;this.wake=deferred();}
    if(this.error)throw Error('Synthetic subscription failure');
    if(this.closed)return {done:true,value:undefined};
    const e=this.queue.shift()!;this.previous=e.done;return {done:false,value:e.value};
  }};}
}
export async function fixture(run:(f: Awaited<ReturnType<typeof makeFixture>>)=>Promise<void>) {
  const f=await makeFixture();try{await run(f);}finally{await f.dispose();}
}
export async function makeFixture() {
  const root=fs.mkdtempSync('/tmp/opencode/subagent-binding-');fs.chmodSync(root,0o700);
  const store=new Store(`${root}/progress.sqlite`,{create:true});
  const source={id:'source-alpha',configRoot:root,dataRoot:root,verified:true};store.registerSource(source);store.bindReads(source.id,true);
  const hooks=new Map<string,any>();let events=new Events(),clock=0,seq=0;
  const records=new Map<string,any>(['A','B','C1','C2','N1'].map(id=>[id,{id,agent:'synthetic',projectID:'alpha',location:{directory:'/synthetic/alpha'},parentID:id==='C1'||id==='C2'?'A':id==='N1'?'C1':null}]));
  let lookup=(id:string)=>Promise.resolve(records.get(id));
  const ctx:any={location:{directory:'/synthetic/alpha'},session:{get:({sessionID}:any)=>lookup(sessionID)},tool:{hook:async(name:string,callback:any)=>{hooks.set(name,callback);return {dispose:async()=>{hooks.delete(name);}};}},event:{subscribe:({signal}:any)=>{signal.addEventListener('abort',()=>events.close(),{once:true});return events;}}};
  const actor=(id='A'):Actor=>({sourceId:source.id,sessionId:id,agent:'synthetic',directory:'/synthetic/alpha',projectId:'alpha',parentId:records.get(id)?.parentID,ancestry:id==='C1'||id==='C2'?['A']:[],verifiedSource:true});
  const register=()=>registerDelegation(ctx,{store,sourceId:source.id,identity:(id,alive,signal)=>sessionIdentity(ctx,source,id,'unknown',{alive,signal,sameScope:true}),now:()=>clock});
  let binding=await register();
  const seed=(plan='plan-alpha',owner='A')=>store.apply({op:'start',plan,oid:'start',rev:0,title:'Synthetic plan',items:[{id:'task-1',title:'First',kind:'task'},{id:'task-2',title:'Second',kind:'task'},{id:'group',title:'Group',kind:'group'}]},actor(owner));
  seed();
  const request=(overrides:any={})=>({op:'delegate',plan:'plan-alpha',oid:'declare',rev:store.get(source.id,'plan-alpha')!.revision,assign:['task-1'],...overrides});
  const hook=(id='call-1',messageID='message-1',sessionID='A',tool='subagent')=>({id,messageID,sessionID,tool,agent:'synthetic'});
  const before=async(id='call-1',message='message-1',parent='A',tool='subagent')=>{await hooks.get('execute.before')?.(hook(id,message,parent,tool));};
  const after=async(id='call-1',message='message-1',child:any='C1',status='completed',parent='A',tool='subagent')=>{await hooks.get('execute.after')?.({...hook(id,message,parent,tool),status:'completed',result:{output:{sessionID:child,status}}});};
  const emit=async(type:string,data:any={},overrides:any={})=>events.push({type:`session.${type}`,location:ctx.location,durable:{aggregateID:data.sessionID??'A',seq:++seq},data:{sessionID:'A',assistantMessageID:'message-1',...data},...overrides});
  const native=async(id='call-1',message='message-1',name='subagent',parent='A')=>{await emit('tool.input.started',{id,name,assistantMessageID:message,sessionID:parent});await emit('tool.called',{id,assistantMessageID:message,sessionID:parent});};
  const close=async(message='message-1',parent='A')=>{await emit('step.ended',{assistantMessageID:message,sessionID:parent});await binding.settled();};
  const complete=async(child='C1',message='message-1')=>{await native('call-1',message);await before('call-1',message);await after('call-1',message,child);await close(message);};
  return {store,source,actor,records,hooks,ctx,get events(){return events;},seed,request,before,after,emit,native,close,complete,
    get binding(){return binding;},
    lookup(fn:typeof lookup){lookup=fn;},advance(ms:number){clock+=ms;},
    declare:(r=request(),a=actor())=>binding.declare(r,a),
    plan:()=>store.get(source.id,'plan-alpha')!,
    async restart(){await binding.dispose(); /* old stream closes; restart is exercised using a fresh fixture below */},
    async reload(){await binding.dispose();events=new Events();binding=await register();},
    async dispose(){await binding.dispose();store.close();fs.rmSync(root,{recursive:true,force:true});},
  };
}
