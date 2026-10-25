import { parseManifestJson } from '@openchamber/sdk/schemas';
import { RELEASE } from '../shared/release.ts';
import type { ExtensionUpdateRead } from '../shared/progress.ts';

export const OFFICIAL_MANIFEST = 'https://api.github.com/repos/Phototonic/openchamber-progress/contents/package.json?ref=main';
export const UPDATE_LIMITS = { timeoutMs: 5000, bytes: 65_536, successMs: 3_600_000, failureMs: 300_000 } as const;
type Diagnostic = ExtensionUpdateRead['diagnostic'];
type Transport = (url: string, init: RequestInit) => Promise<Response>;

function versionParts(version: string) {
  const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!m || version.length>64 || m[4]?.split('.').some(p=>/^\d+$/.test(p)&&p.length>1&&p[0]==='0')) return;
  return { core:m.slice(1,4).map(BigInt), pre:m[4]?.split('.') };
}
/** Same numeric/prerelease ordering as companion comparison; build metadata is neutral. */
export function compareUpdateVersions(a: string, b: string): number | undefined {
  const left=versionParts(a),right=versionParts(b);if(!left||!right)return;
  for(let i=0;i<3;i++)if(left.core[i]!==right.core[i])return left.core[i]!>right.core[i]!?1:-1;
  if(!left.pre||!right.pre)return left.pre?-1:right.pre?1:0;
  for(let i=0;i<Math.max(left.pre.length,right.pre.length);i++){
    const x=left.pre[i],y=right.pre[i];if(x===y)continue;if(x===undefined)return -1;if(y===undefined)return 1;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn)return BigInt(x)>BigInt(y)?1:-1;
    if(xn!==yn)return xn?-1:1;return x>y?1:-1;
  }
  return 0;
}
class CheckFailure extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) { super(diagnostic);this.diagnostic=diagnostic; }
}

/** One service-generation cache; constructor seams are internal tests only, never HTTP/env inputs. */
export class ExtensionUpdates {
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private candidate?: string;
  private etag?: string;
  private checkedAt: string | null = null;
  private next = 0;
  private diagnostic: Diagnostic = 'unavailable';
  private stale = false;
  private pending?: Promise<ExtensionUpdateRead>;
  private controller?: AbortController;
  private closed = false;
  constructor(options: { transport?: Transport; now?: () => number; timeoutMs?: number } = {}) {
    this.transport=options.transport??((url,init)=>fetch(url,init));
    this.now=options.now??Date.now;this.timeoutMs=options.timeoutMs??UPDATE_LIMITS.timeoutMs;
  }
  close() { this.closed=true;this.controller?.abort(); }
  private reply(): ExtensionUpdateRead {
    return {installedVersion:RELEASE,repository:'Phototonic/openchamber-progress',ref:'main',
      state:this.candidate?(compareUpdateVersions(this.candidate,RELEASE)!>0?'available':'not-newer'):'unknown',
      checkedAt:this.checkedAt,stale:this.stale,...(this.candidate?{candidateVersion:this.candidate}:{}),
      diagnostic:this.diagnostic,nextCheckAt:new Date(this.next).toISOString()};
  }
  check(): Promise<ExtensionUpdateRead> {
    if(this.pending)return this.pending;
    if(this.closed){this.diagnostic='shutdown';this.stale=!!this.candidate;this.next=this.now()+UPDATE_LIMITS.failureMs;return Promise.resolve(this.reply());}
    if(this.now()<this.next)return Promise.resolve(this.reply());
    this.pending=this.run().finally(()=>{this.pending=undefined;});return this.pending;
  }
  private async run(): Promise<ExtensionUpdateRead> {
    const controller=new AbortController();this.controller=controller;
    let timedOut=false,providerDue=0;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeoutMs);
    try {
      const headers:Record<string,string>={Accept:'application/vnd.github.raw+json','User-Agent':'openchamber-agent-progress'};
      if(this.etag&&this.candidate)headers['If-None-Match']=this.etag;
      const response=await this.transport(OFFICIAL_MANIFEST,{method:'GET',headers,redirect:'manual',credentials:'omit',signal:controller.signal});
      try {
        const now=this.now();
        const retry=response.headers.get('retry-after');
        if(retry){const due=/^\d+$/.test(retry)?now+Number(retry)*1000:Date.parse(retry);if(Number.isFinite(due)&&due<=8.64e15)providerDue=Math.max(providerDue,due);}
        const reset=response.headers.get('x-ratelimit-reset');
        if(response.headers.get('x-ratelimit-remaining')==='0'&&reset&&/^\d+$/.test(reset)){
          const due=Number(reset)*1000;if(Number.isFinite(due)&&due<=8.64e15)providerDue=Math.max(providerDue,due);
        }
        if(response.status===304){
          if(!headers['If-None-Match']||!this.candidate||!this.checkedAt||response.headers.has('etag')&&response.headers.get('etag')!==this.etag)throw new CheckFailure('invalid-response');
        }else{
          if(response.status>=300&&response.status<400)throw new CheckFailure('redirect');
          if(response.status!==200)throw new CheckFailure(response.status===429||response.status===403&&response.headers.get('x-ratelimit-remaining')==='0'?'rate-limited':'unavailable');
          const declared=response.headers.get('content-length');
          if(declared&&Number(declared)>UPDATE_LIMITS.bytes)throw new CheckFailure('too-large');
          const reader=response.body?.getReader();if(!reader)throw new CheckFailure('invalid-response');
          const chunks:Uint8Array[]=[];let bytes=0;
          try {for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>UPDATE_LIMITS.bytes)throw new CheckFailure('too-large');chunks.push(chunk.value);}}
          finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
          let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new CheckFailure('invalid-manifest');}
          const parsed=parseManifestJson(text);
          if(!parsed.ok||!parsed.version||!versionParts(parsed.version))throw new CheckFailure('invalid-manifest');
          const c=parsed.manifest.contributes;
          if(c.panel.id!=='agent-progress-probe'||!c.panel.entry||!c.page||!c.statusSection||!c.service?.entry||c.service.runtime!=='host')throw new CheckFailure('invalid-manifest');
          if(controller.signal.aborted)throw new CheckFailure('unavailable');
          this.candidate=parsed.version;
          const etag=response.headers.get('etag');this.etag=etag&&etag.length<=256&&/^[\x20-\x7e]+$/.test(etag)?etag:undefined;
        }
        if(controller.signal.aborted)throw new CheckFailure('unavailable');
        this.checkedAt=new Date(this.now()).toISOString();this.stale=false;this.diagnostic='ok';this.next=Math.max(this.now()+UPDATE_LIMITS.successMs,providerDue);
      }finally{if(response.body&&!response.body.locked)await response.body.cancel().catch(()=>{});}
    }catch(error){
      this.diagnostic=this.closed?'shutdown':timedOut?'timeout':error instanceof CheckFailure?error.diagnostic:'unavailable';
      this.stale=!!this.candidate;this.next=Math.max(this.now()+UPDATE_LIMITS.failureMs,providerDue);
    }finally{clearTimeout(timer);this.controller=undefined;}
    return this.reply();
  }
}
