/** Narrow GitHub release boundary. No dependency installation or custom release notes. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const canonical = 'Phototonic/openchamber-progress';
const shaPattern = /^[a-f0-9]{40}$/;
const digest = (bytes:Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
function version(value:unknown):number[] {
  assert.equal(typeof value,'string','Invalid version');
  assert.match(value as string,/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,'Invalid version');
  const parts=(value as string).split('.').map(Number);
  assert(parts.every(Number.isSafeInteger),'Invalid version'); return parts;
}
export function gitFile(sha:string,file:string):string {
  const result=spawnSync('git',['show',`${sha}:${file}`],{encoding:'utf8'});
  assert.equal(result.status,0,'Required event history unavailable'); return result.stdout;
}
type Event = {ref?:string;before?:string;after?:string;repository?:{full_name?:string}};
export type Candidate = {version:string;sha:string};
export function eligibility(event:Event,eventName:string,sha:string,repository:string,read=gitFile):Candidate|null {
  if(eventName!=='push'||event.ref!=='refs/heads/main'||repository!==canonical||event.repository?.full_name!==canonical) return null;
  assert.match(sha,shaPattern); assert.equal(event.after,sha,'Event SHA mismatch');
  assert(event.before&&shaPattern.test(event.before)&&!/^0+$/.test(event.before),'Missing event before');
  const old=JSON.parse(read(event.before,'package.json')).version;
  const next=JSON.parse(read(sha,'package.json')).version;
  const a=version(old),b=version(next);
  const order=b.map((v,i)=>Math.sign(v-a[i])).find(v=>v!==0)??0;
  assert(order>=0,'Version decreased');
  const release=read(sha,'shared/release.ts').match(/export const RELEASE = '([^']+)';/);
  assert.equal(release?.[1],next,'Source version mismatch');
  assert.equal(JSON.parse(read(sha,'build/companion/package.json')).version,next,'Compiled version mismatch');
  for(const file of ['build/service/main.js','build/setup/main.js']) assert(read(sha,file).includes(`var RELEASE = "${next}";`),'Compiled version mismatch');
  return order===0?null:{version:next,sha};
}
export const assetNames = (v:string) => [`agent-progress-extension-${v}.zip`,`agent-progress-companion-${v}.zip`,`entries-${v}.sha256`,'sha256.txt'];
export function assets(directory:string,candidate:Candidate):Map<string,Buffer> {
  const receipt=JSON.parse(readFileSync(`${directory}/tested.json`,'utf8'));
  assert.equal(receipt.sha,candidate.sha,'Artifact SHA mismatch'); assert.equal(receipt.version,candidate.version);
  const names=assetNames(candidate.version);
  assert.deepEqual(readdirSync(directory).sort(),[...names,'tested.json'].sort(),'Unexpected artifact set');
  assert.deepEqual(Object.keys(receipt.hashes).sort(),[...names].sort());
  const result=new Map(names.map(name=>[name,readFileSync(`${directory}/${name}`)]));
  for(const [name,bytes] of result) assert.equal(digest(bytes),receipt.hashes[name],'Artifact checksum mismatch');
  function checks(text:string):Map<string,string> {
    const map=new Map<string,string>();
    for(const line of text.trimEnd().split('\n')) {
      const match=/^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert(match,'Invalid checksum inventory');
      assert(!match[2].split('/').some(p=>p==='..'||p==='')&&!map.has(match[2]),'Unsafe checksum path'); map.set(match[2],match[1]);
    } return map;
  }
  const inventory=checks(result.get('sha256.txt')!.toString());
  const entries=checks(result.get(`entries-${candidate.version}.sha256`)!.toString());
  assert(entries.size>0);
  for(const [name,hash] of entries) {
    assert(name.startsWith(`agent-progress-extension-${candidate.version}/`)||name.startsWith(`agent-progress-companion-${candidate.version}/`),'Wrong payload version');
    assert.equal(inventory.get(name),hash,'Entry checksum mismatch');
  }
  assert.deepEqual([...inventory.keys()].sort(),[...entries.keys(),...names.filter(n=>n!=='sha256.txt')].sort(),'Checksum coverage mismatch');
  for(const name of names.filter(n=>n!=='sha256.txt')) assert.equal(inventory.get(name),digest(result.get(name)!),'Distribution checksum mismatch');
  return result;
}

type Asset = {id:number;name:string;size:number;state:string};
type Release = {id:number;tag_name:string;target_commitish:string;name:string;draft:boolean;author:{login:string};assets:Asset[]};
export type API = (method:string,path:string,body?:unknown)=>Promise<any>;
// Serialization is provided by the version-scoped publisher job. No overwrite/delete endpoints exist here.
export async function publish(candidate:Candidate,files:Map<string,Buffer>,api:API):Promise<void> {
  version(candidate.version); assert.match(candidate.sha,shaPattern);
  assert.deepEqual([...files.keys()].sort(),assetNames(candidate.version).sort());
  const tag=`v${candidate.version}`;
  const marker=`agent-progress-release-v1:${candidate.sha}:${digest(JSON.stringify([...files].map(([n,b])=>[n,digest(b)]).sort()))}`;
  async function checkTag():Promise<boolean> {
    const ref=await api('GET',`/git/ref/tags/${tag}`); if(!ref) return false;
    assert.equal(ref.object.type,'tag','Foreign tag collision');
    const object=await api('GET',`/git/tags/${ref.object.sha}`);
    assert.equal(object.message,marker,'Foreign tag collision'); assert.equal(object.object.type,'commit'); assert.equal(object.object.sha,candidate.sha,'Tag SHA collision'); return true;
  }
  let tagged=await checkTag();
  function identity(r:Release) {
    assert(r&&Number.isSafeInteger(r.id)&&r.id>0,'Invalid release identity');
    assert.equal(typeof r.draft,'boolean'); assert(Array.isArray(r.assets),'Invalid release assets');
    assert.equal(r.tag_name,tag); assert.equal(r.target_commitish,candidate.sha,'Release target collision');
    assert.equal(r.name,tag); assert.equal(r.author.login,'github-actions[bot]','Foreign release collision');
  }
  // The tag endpoint exposes published releases only. Authenticated listing is
  // required to discover interrupted/foreign drafts, including on later pages.
  const published:Release|null=await api('GET',`/releases/tags/${tag}`);
  if(published) { identity(published); assert.equal(published.draft,false); }
  const matches:Release[]=[],listed=new Set<number>();
  for(let page=1;;page++) {
    const releases=await api('GET',`/releases?per_page=100&page=${page}`);
    assert(Array.isArray(releases)&&releases.length<=100,'Invalid release listing');
    for(const release of releases) {
      assert(release&&Number.isSafeInteger(release.id)&&release.id>0&&typeof release.tag_name==='string'&&typeof release.draft==='boolean','Invalid listed release identity');
      assert(!listed.has(release.id),'Duplicate/unstable release listing'); listed.add(release.id);
      if(release.tag_name===tag) matches.push(release);
    }
    if(releases.length<100) break;
  }
  assert(matches.length<=1,'Ambiguous matching releases');
  if(published&&matches.length) {
    assert.equal(matches[0].id,published.id,'Ambiguous matching releases');
    assert.equal(matches[0].draft,false,'Inconsistent release identity');
  }
  let release:Release|null=matches[0]??published;
  assert(!release||tagged,'Foreign release collision');
  if(release) {
    identity(release);
    const id=release.id;
    release=await api('GET',`/releases/${id}`);
    assert(release,'Matching release unavailable'); identity(release); assert.equal(release.id,id,'Release ID collision');
  }
  if(!tagged) {
    const object=await api('POST','/git/tags',{tag,message:marker,object:candidate.sha,type:'commit'});
    await api('POST','/git/refs',{ref:`refs/tags/${tag}`,sha:object.sha});
    tagged=await checkTag(); assert(tagged);
  }
  if(!release) release=await api('POST','/releases',{tag_name:tag,target_commitish:candidate.sha,name:tag,draft:true,generate_release_notes:true});
  assert(release); identity(release);
  async function verify(r:Release,complete:boolean) {
    identity(r); const seen=new Set<string>();
    for(const asset of r.assets) {
      assert(files.has(asset.name)&&!seen.has(asset.name),'Foreign/duplicate asset collision'); seen.add(asset.name);
      assert.equal(asset.state,'uploaded'); assert.equal(asset.size,files.get(asset.name)!.length);
      const bytes=await api('DOWNLOAD',`/releases/assets/${asset.id}`);
      assert.equal(digest(bytes),digest(files.get(asset.name)!),'Remote asset checksum collision');
    }
    if(complete) assert.equal(seen.size,files.size,'Incomplete release assets'); return seen;
  }
  let seen=await verify(release,!release.draft);
  if(!release.draft) { assert(await checkTag()); return; }
  for(const [name,bytes] of files) if(!seen.has(name)) await api('UPLOAD',`/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,bytes);
  release=await api('GET',`/releases/${release.id}`); assert(release); await verify(release,true); assert(await checkTag());
  // Lost responses fail this attempt; a retry reconciles the published state read-only.
  await api('PATCH',`/releases/${release.id}`,{draft:false});
  const final=await api('GET',`/releases/${release.id}`); assert(final&&!final.draft,'Publication not confirmed'); await verify(final,true); assert(await checkTag());
}

export function githubAPI(token:string):API {
  return async(method,path,body)=> {
    const upload=method==='UPLOAD',download=method==='DOWNLOAD';
    assert(path.startsWith('/')&&!path.includes('..'));
    const response=await fetch(`${upload?'https://uploads.github.com':'https://api.github.com'}/repos/${canonical}${path}`,{
      method:upload?'POST':download?'GET':method,
      signal:AbortSignal.timeout(upload||download?120_000:30_000),
      headers:{Authorization:`Bearer ${token}`,Accept:download?'application/octet-stream':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':upload?'application/octet-stream':'application/json'}:{})},
      body:body?(upload?new Uint8Array(body as Uint8Array):JSON.stringify(body)):undefined,
    });
    if(response.status===404&&method==='GET') return null;
    assert(response.ok,`GitHub operation failed (${response.status}); inspect draft/tag state before retry`);
    return download?Buffer.from(await response.arrayBuffer()):response.json();
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const candidate=eligibility(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!,'utf8')),process.env.GITHUB_EVENT_NAME!,process.env.GITHUB_SHA!,process.env.GITHUB_REPOSITORY!);
    assert(candidate,'Publisher requires an eligible canonical main push');
    assert(process.env.GITHUB_TOKEN,'Missing publisher token');
    await publish(candidate,assets('release-assets',candidate),githubAPI(process.env.GITHUB_TOKEN));
    if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,'Verified matching tag and complete published assets. Notes generated by GitHub.\n');
  } catch {
    console.error('Release refused or incomplete. Inspect matching draft/tag/assets read-only before retry; no state was deleted or overwritten.'); process.exitCode=1;
  }
}
