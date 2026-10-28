import type { PlanView, SetupView, StoreRead } from './model.ts';
import { readPlanHead, setupCall, type ServiceHost } from './source.ts';

export interface HealthClaim { key: string; read: StoreRead | null; plan: PlanView | null; stale: boolean }
export interface HealthFacts { service: string; scope: string; installation: string; loaded: string; capture: string; report: string; viewer: string; version: string; platform: string; tools: string }
export const unknownFacts = (): HealthFacts => ({service:'unknown',scope:'unknown',installation:'unknown',loaded:'unknown',capture:'unknown',report:'not-checked',viewer:'unknown',version:'unknown',platform:'unknown',tools:'unknown'});
function serviceState(code:string){return ({busy:'busy',corrupt:'damaged',schema:'incompatible',storage:'store-unavailable',NOT_GRANTED:'not-approved',NO_SERVICE:'not-approved',DISABLED:'paused'} as Record<string,string>)[code]??'unavailable';}
export function setupFacts(s: SetupView): HealthFacts {
  return {...unknownFacts(),service:s.diagnostics.some(d=>['storage','busy','corrupt','schema'].includes(d))?serviceState(s.diagnostics.find(d=>['storage','busy','corrupt','schema'].includes(d))!):'observed',installation: !s.configured ? 'not-configured' : s.installed ? 'installed' : 'not-observed',
    loaded:s.activation === 'reload-required' ? 'reload-required' : s.activation === 'control-applies-to-loaded-instances' ? 'matching-observation' : 'unknown',
    capture:s.captureEnabled === true ? 'on' : s.captureEnabled === false ? 'off' : 'unknown',
    version:s.version && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(s.version) ? s.version : 'unknown'};
}
const allowed: Record<keyof HealthFacts, readonly string[]> = {
  service:['unknown','observed','busy','damaged','incompatible','store-unavailable','not-approved','paused','unavailable'],scope:['unknown','association-unknown','source-mismatch','selected-source'],
  installation:['unknown','not-configured','installed','not-observed'],loaded:['unknown','reload-required','matching-observation'],capture:['unknown','on','off'],
  report:['not-checked','recorded-revision','unavailable','context-changed'],viewer:['unknown','stale','selected-report','revision-changed'],version:[],platform:['unknown'],tools:['unknown'],
};
/** Serialization starts from a fixed schema, never from setup, diagnostics or a plan object. */
export function supportSummary(f: HealthFacts) {
  return ['Agent progress reporting observations',...Object.keys(allowed).map(k=>{
    const key=k as keyof HealthFacts;const value=f[key];
    const safe=allowed[key].includes(value)||(key==='version'&&/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value));
    return `${key}: ${safe?value:'unknown'}`;
  }),'Observed states only; no session tool availability or task completion proof.'].join('\n');
}
interface Visit { serial:number; key: string; claim: HealthClaim; open: boolean; busy: boolean; epoch: number; facts: HealthFacts | null; copy: string }
interface ReportingHost {service:(current:()=>boolean)=>ServiceHost;visible:()=>boolean;changed:()=>void;copy:(text:string)=>Promise<void>}
export class ReportingHealth {
  private visit: Visit | null=null;
  private serial=0;
  private host: ReportingHost;
  constructor(host:ReportingHost){this.host=host;}
  retire(){this.visit=null;}
  claim(claim:HealthClaim){
    if(this.visit?.key!==claim.key)this.visit={serial:++this.serial,key:claim.key,claim,open:false,busy:false,epoch:0,facts:null,copy:''};
    const v=this.visit!;v.claim=claim;
    const own=()=>this.visit===v&&this.host.visible();
    return {observation:`${v.serial}:${v.epoch}`,open:v.open,busy:v.busy,facts:v.facts,copy:v.copy,
      toggle:()=>{if(!own())return;if(v.open){v.open=false;v.epoch++;v.busy=false;v.facts=null;v.copy='';this.host.changed();}else{v.open=true;void this.refresh(v);}},
      refresh:()=>{if(own())void this.refresh(v);},
      copySummary:()=>{if(!own()||!v.open||!v.facts)return;const epoch=v.epoch;v.copy='Copying…';this.host.changed();void this.host.copy(supportSummary(v.facts)).then(()=>finish('Copied.'),()=>finish('Copy unavailable. Select the preview text and copy it manually.'));function finish(message:string){if(own()&&v.open&&epoch===v.epoch){v.copy=message;thisController.host.changed();}}const thisController=this;},
    };
  }
  private async refresh(v:Visit){
    if(!v.open||v.busy||!this.host.visible())return;
    const epoch=++v.epoch;const claim=v.claim;
    const own=()=>this.visit===v&&v.open&&v.epoch===epoch&&this.host.visible();
    v.busy=true;v.facts=null;v.copy='';this.host.changed();
    const host=this.host.service(own);const setup=await setupCall(host,null);
    if(!own())return;
    let facts=setup.ok?setupFacts(setup.setup):{...unknownFacts(),service:serviceState(setup.code)};
    const identity=setup.ok?setup.setup.reportingIdentity:undefined;
    const read=claim.read;
    const matches=identity&&read&&identity.storeId===read.storeId&&identity.sourceId===read.binding.sourceId&&identity.verified===read.binding.verified;
    if(read&&!identity){facts.scope='association-unknown';}
    else if(read&&!matches){facts=unknownFacts();facts.report='context-changed';}
    else if(claim.plan&&identity&&claim.plan.sourceId!==identity.sourceId){facts.scope='source-mismatch';}
    else if(claim.plan&&read&&matches){
      const result=await readPlanHead(host,claim.plan);if(!own())return;
      if(!result.ok)facts.report='unavailable';
      else if(result.envelope.storeId!==read.storeId||JSON.stringify(result.envelope.binding)!==JSON.stringify(read.binding)) {facts=unknownFacts();facts.report='context-changed';}
      else {facts.scope='selected-source';facts.report='recorded-revision';facts.viewer=result.plan.revision===claim.plan.revision?'selected-report':'revision-changed';}
    }
    if(claim.stale)facts.viewer='stale';
    v.facts=facts;v.busy=false;this.host.changed();
  }
}
