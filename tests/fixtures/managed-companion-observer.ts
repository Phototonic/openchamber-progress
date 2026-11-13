/** Credential-free fixture provider. No prompts, document text or raw errors are recorded. */
import { Model, Provider, Plugin } from '@opencode/plugin';
import { appendFileSync, readFileSync, unlinkSync } from 'node:fs';

export default Plugin.define({id:'managed-fixture-observer',async setup(ctx){
  const root=process.env.MANAGED_FIXTURE_ROOT!;
  const record=(value:object)=>appendFileSync(`${root}/events.jsonl`,JSON.stringify(value)+'\n');
  const provider=Provider.ID.make('managed-fixture'),model=Model.ID.make('script');
  await ctx.provider.transform(e=>{for(const p of e.list())e.remove(p.provider.id);e.add({info:{...Provider.Info.empty(provider),activation:'enabled',package:`aisdk:file://${root}/sdk.mjs`},models:[Model.Info.default(provider,model)]});});
  await ctx.model.transform(e=>e.default.set(provider,model));
  await ctx.session.hook('title',e=>{e.result='Synthetic managed fixture';});
  await ctx.session.hook('retry',e=>{e.decision={retry:false};});
  await ctx.session.hook('http.request',()=>{record({type:'forbidden-http'});throw new Error('External provider transport forbidden');});
  await ctx.session.hook('context',e=>record({type:'context',session:e.sessionID,reportTool:Object.hasOwn(e.tools,'agent_progress_report'),guidance:e.system.join('\n').split('# Agent progress (companion)').length-1}));
  await ctx.tool.hook('execute.after',e=>{
    if(e.tool!=='agent_progress_report')return;
    let receipt:{rev?:number;error?:string}={};try{receipt=JSON.parse((e as any).result?.content??'{}');}catch{}
    record({type:'report',session:e.sessionID,status:e.status,revision:receipt.rev??null,error:receipt.error??null});
  });
  await ctx.aisdk.hook('sdk',e=>{if(e.model.providerID!==provider)throw new Error('Unexpected fixture provider');e.sdk={};});
  await ctx.aisdk.hook('language',e=>{
    if(e.model.providerID!==provider)throw new Error('Unexpected fixture provider');
    e.language={specificationVersion:'v3',provider,modelId:model,supportedUrls:{},async doGenerate(){throw new Error('Auxiliary generation forbidden');},async doStream(options:any){
      let step:any;try{step=JSON.parse(readFileSync(`${root}/step.json`,'utf8'));unlinkSync(`${root}/step.json`);}catch{}
      const system=options.prompt.filter((x:any)=>x.role==='system').map((x:any)=>typeof x.content==='string'?x.content:JSON.stringify(x.content)).join('\n');
      record({type:'outgoing',reportTool:options.tools?.some((t:any)=>t.name==='agent_progress_report')??false,guidance:system.split('# Agent progress (companion)').length-1});
      return {stream:new ReadableStream({start(c){
        c.enqueue({type:'stream-start',warnings:[]});
        if(step)c.enqueue({type:'tool-call',toolCallId:`fixture-${Date.now()}`,toolName:step.name,input:JSON.stringify(step.input)});
        else{c.enqueue({type:'text-start',id:'done'});c.enqueue({type:'text-delta',id:'done',delta:'Synthetic fixture complete.'});c.enqueue({type:'text-end',id:'done'});}
        c.enqueue({type:'finish',finishReason:{unified:step?'tool-calls':'stop',raw:undefined},usage:{inputTokens:{total:0,noCache:0,cacheRead:0,cacheWrite:0},outputTokens:{total:0,text:0,reasoning:0}}});c.close();
      }})};
    }} as any;
  });
  record({type:'observer-ready',node:process.version,bun:process.versions.bun??null});
  return ()=>record({type:'observer-disposed'});
}});
