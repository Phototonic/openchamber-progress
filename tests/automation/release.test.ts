import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { eligibility, canonical, publish, assetNames, assets, githubAPI, type API } from '../../scripts/release.ts';

const sha='a'.repeat(40),before='b'.repeat(40),candidate={version:'0.2.6',sha};
const event={ref:'refs/heads/main',before,after:sha,repository:{full_name:canonical}};
function source(old='0.2.5',next='0.2.6',compiled=next) {
  return (revision:string,file:string) => {
    if(file==='package.json') return JSON.stringify({version:revision===before?old:next});
    if(file==='shared/release.ts') return `export const RELEASE = '${next}';`;
    if(file==='build/companion/package.json') return JSON.stringify({version:compiled});
    return `var RELEASE = "${compiled}";`;
  };
}
test('eligibility: exact event range, numeric increase, equal/nonmain zero eligibility, fail closed',()=>{
  assert.deepEqual(eligibility(event,'push',sha,canonical,source()),candidate);
  assert.equal(eligibility(event,'push',sha,canonical,source('0.2.5','0.2.5')),null);
  for(const [e,name,repo] of [[{...event,ref:'refs/heads/dev'},'push',canonical],[event,'pull_request',canonical],[{...event,ref:'refs/tags/v0.2.6'},'push',canonical],[event,'push','example/fork']] as const) {
    assert.equal(eligibility(e,name,sha,repo,()=>{throw Error('must not read');}),null);
  }
  for(const read of [source('0.2.6','0.2.5'),source('invalid'),source('0.2.5','0.02.6'),source('0.2.5','0.2.6','0.2.5')]) assert.throws(()=>eligibility(event,'push',sha,canonical,read));
  assert.throws(()=>eligibility({...event,before:'0'.repeat(40)},'push',sha,canonical,source()));
  assert.throws(()=>eligibility({...event,before:undefined},'push',sha,canonical,source()));
  assert.throws(()=>eligibility(event,'push',sha,canonical,()=>{throw Error('unavailable');}));
  assert.throws(()=>eligibility({...event,after:before},'push',sha,canonical,source()));
});
test('actual multi-commit Git push compares event before, not HEAD parent',()=>{
  const root=mkdtempSync(join(tmpdir(),'release-git-'));
  const git=(...args:string[])=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim();};
  try {
    git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
    function commit(v:string) {
      for(const file of ['package.json','shared/release.ts','build/companion/package.json','build/setup/main.js','build/service/main.js']) {
        mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),source(v,v)(sha,file));
      }
      git('add','.');git('commit','-qm','Fixture');return git('rev-parse','HEAD');
    }
    const start=commit('0.2.5');commit('0.2.6');writeFileSync(join(root,'note'),'fixture');git('add','.');git('commit','-qm','Same version');const end=git('rev-parse','HEAD');
    const read=(rev:string,file:string)=>git('show',`${rev}:${file}`);
    assert.deepEqual(eligibility({...event,before:start,after:end},'push',end,canonical,read),{version:'0.2.6',sha:end});
    assert.equal(eligibility({...event,before:git('rev-parse','HEAD^'),after:end},'push',end,canonical,read),null);
  } finally {rmSync(root,{recursive:true,force:true});}
});

function fixture() {
  const files=new Map(assetNames(candidate.version).map(n=>[n,Buffer.from(n)]));
  let ref:any=null,tag:any=null,release:any=null;
  const bytes=new Map<number,Buffer>(),writes:string[]=[],reads:string[]=[];let next=1;
  let fault:string|undefined;
  const api:API=async(method,path,body:any)=>{
    if(method==='GET') {
      reads.push(path);
      if(path.startsWith('/git/ref/')) return structuredClone(ref);
      if(path.startsWith('/git/tags/')) return structuredClone(tag);
      // GitHub's tag endpoint never exposes a draft. Only authenticated list/by-ID do.
      if(path.startsWith('/releases/tags/')) return release&&!release.draft?structuredClone(release):null;
      if(path==='/releases?per_page=100&page=1') return release?[structuredClone(release)]:[];
      if(path.startsWith('/releases?')) return [];
      if(path===`/releases/${release?.id}`) return structuredClone(release);
      throw Error('unexpected release read');
    }
    if(method==='DOWNLOAD') return bytes.get(Number(path.split('/').at(-1)));
    writes.push(`${method} ${path}`);
    if(method==='POST'&&path==='/git/tags') {tag={message:body.message,object:{type:'commit',sha:body.object}};return {sha:before};}
    if(method==='POST'&&path==='/git/refs') {assert.equal(ref,null,'must not replace ref');ref={object:{type:'tag',sha:body.sha}};return ref;}
    if(method==='POST'&&path==='/releases') {
      assert.equal(body.generate_release_notes,true);assert.equal(body.draft,true);assert.equal(body.target_commitish,sha);
      assert(!('body' in body),'native notes must not be rewritten');
      release={...body,id:10,author:{login:'github-actions[bot]'},assets:[]};return structuredClone(release);
    }
    if(method==='UPLOAD') {
      if(fault==='upload'&&release.assets.length===1) throw Error('upload unavailable');
      const name=decodeURIComponent(path.split('?name=')[1]);assert(!release.assets.some((a:any)=>a.name===name),'must not replace asset');
      const id=next++;bytes.set(id,body);release.assets.push({id,name,size:body.length,state:'uploaded'});return {};
    }
    if(method==='PATCH') {
      assert.equal(release.assets.length,files.size,'publish only complete set');
      if(fault==='publish') throw Error('publish failed');
      release.draft=false;if(fault==='lost') throw Error('response lost');return structuredClone(release);
    }
    throw Error('unexpected API operation');
  };
  return {files,api,writes,reads,fail:(value:string|undefined)=>{fault=value;},get release(){return release;},set release(value){release=value;},get ref(){return ref;},set ref(value){ref=value;},get tag(){return tag;},bytes};
}
test('native notes, exact tested SHA, complete publication, verified rerun has zero writes',async()=>{
  const f=fixture();await publish(candidate,f.files,f.api);assert.equal(f.release.draft,false);
  const count=f.writes.length;await publish(candidate,f.files,f.api);assert.equal(f.writes.length,count);
});
test('foreign tag and foreign release collisions are never adopted',async()=>{
  const f=fixture();f.ref={object:{type:'commit',sha:before}};
  await assert.rejects(publish(candidate,f.files,f.api));assert.equal(f.writes.length,0);
  const g=fixture();g.release={id:1};await assert.rejects(publish(candidate,g.files,g.api));assert.equal(g.writes.length,0);
  const h=fixture();await publish(candidate,h.files,h.api);h.release.author.login='someone-else';const count=h.writes.length;
  await assert.rejects(publish(candidate,h.files,h.api));assert.equal(h.writes.length,count);
  const i=fixture();await publish(candidate,i.files,i.api);i.tag.object.sha=before;const size=i.writes.length;
  await assert.rejects(publish(candidate,i.files,i.api));assert.equal(i.writes.length,size);
});
test('middle upload failure leaves draft; matching retry resumes without overwrites',async()=>{
  const f=fixture();f.fail('upload');await assert.rejects(publish(candidate,f.files,f.api));
  assert.equal(f.release.draft,true);assert.equal(f.release.assets.length,1);
  assert.equal(await f.api('GET',`/releases/tags/v${candidate.version}`),null);
  f.fail(undefined);await publish(candidate,f.files,f.api);assert.equal(f.release.draft,false);
  assert.equal(f.writes.filter(w=>w.startsWith('UPLOAD')).length,5);
  assert.equal(f.writes.filter(w=>w==='POST /releases').length,1,'Retry must resume existing draft, never create a second one');
  assert(f.reads.includes('/releases/10'),'Draft is resumed by discovered ID');
});
test('provider-shaped foreign drafts and ambiguous matches refuse before any write',async()=>{
  const f=fixture();
  f.release={id:22,tag_name:'v0.2.6',target_commitish:sha,name:'v0.2.6',draft:true,author:{login:'foreign-owner'},assets:[]};
  assert.equal(await f.api('GET','/releases/tags/v0.2.6'),null);
  await assert.rejects(publish(candidate,f.files,f.api));assert.equal(f.writes.length,0);
  const g=fixture();g.fail('upload');await assert.rejects(publish(candidate,g.files,g.api));
  g.release.author.login='foreign-owner';const count=g.writes.length;
  await assert.rejects(publish(candidate,g.files,g.api));assert.equal(g.writes.length,count,'Even a matching owned tag cannot authorize a foreign draft');
  g.release.author.login='github-actions[bot]';
  await assert.rejects(publish(candidate,g.files,async(m,p,b)=>{
    if(m==='GET'&&p==='/releases?per_page=100&page=1')return [structuredClone(g.release),{...structuredClone(g.release),id:11}];
    return g.api(m,p,b);
  }),/Ambiguous matching releases/);assert.equal(g.writes.length,count);
});
test('draft discovery paginates past 100 unrelated releases before resuming by ID',async()=>{
  const f=fixture();f.fail('upload');await assert.rejects(publish(candidate,f.files,f.api));
  f.fail(undefined);const pages:number[]=[];
  await publish(candidate,f.files,async(m,p,b)=>{
    if(m==='GET'&&p.startsWith('/releases?')) {
      const page=Number(new URL(`https://api.example.invalid${p}`).searchParams.get('page'));pages.push(page);
      if(page===1)return Array.from({length:100},(_,i)=>({id:100+i,tag_name:`unrelated-${i}`,draft:false}));
      if(page===2)return [structuredClone(f.release)];
      throw Error('unexpected page');
    }
    return f.api(m,p,b);
  });
  assert.deepEqual(pages,[1,2]);assert.equal(f.release.draft,false);
  assert.equal(f.writes.filter(w=>w==='POST /releases').length,1);
  assert(f.reads.includes('/releases/10'));
});
test('malformed or duplicate paginated release identities fail closed without writes',async()=>{
  for(const response of [null,{},[{id:1,tag_name:'v0.2.6'}],[{id:1,tag_name:'unrelated',draft:false},{id:1,tag_name:'unrelated',draft:false}]]) {
    const f=fixture();
    await assert.rejects(publish(candidate,f.files,async(m,p,b)=>m==='GET'&&p.startsWith('/releases?')?response:f.api(m,p,b)));
    assert.equal(f.writes.length,0);
  }
});
test('notes/create failure and publish failure never claim success',async()=>{
  const f=fixture();await assert.rejects(publish(candidate,f.files,async(m,p,b)=>{if(p==='/releases'&&m==='POST')throw Error('notes unavailable');return f.api(m,p,b);}));assert.equal(f.release,null);
  const g=fixture();g.fail('publish');await assert.rejects(publish(candidate,g.files,g.api));assert.equal(g.release.draft,true);
});
test('lost final response reconciles read-only; published missing/tampered assets fail closed',async()=>{
  const f=fixture();f.fail('lost');await assert.rejects(publish(candidate,f.files,f.api));assert.equal(f.release.draft,false);
  const count=f.writes.length;await publish(candidate,f.files,f.api);assert.equal(f.writes.length,count);
  f.bytes.set(f.release.assets[0].id,Buffer.from('tampered'));await assert.rejects(publish(candidate,f.files,f.api));assert.equal(f.writes.length,count);
  f.release.assets.pop();await assert.rejects(publish(candidate,f.files,f.api));assert.equal(f.writes.length,count);
});
test('same-version attempts serialized by publisher concurrency converge; different target refuses',async()=>{
  const f=fixture();let queue=Promise.resolve();
  const attempt=()=>{queue=queue.then(()=>publish(candidate,f.files,f.api));return queue;};
  await Promise.all([attempt(),attempt(),attempt()]);assert.equal(f.writes.filter(w=>w==='POST /releases').length,1);
  const count=f.writes.length;await assert.rejects(publish({...candidate,sha:before},f.files,f.api));assert.equal(f.writes.length,count);
});
test('artifact provenance and checksum coverage reject modification',()=>{
  const root=mkdtempSync(join(tmpdir(),'release-assets-'));const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
  try {
    const names=assetNames(candidate.version);const payload=`agent-progress-extension-${candidate.version}/LICENSE`;
    const entries=`${hash('license')}  ${payload}\n`;
    const data=new Map<string,string>([[names[0],'zip-a'],[names[1],'zip-b'],[names[2],entries]]);
    data.set('sha256.txt',`${hash('license')}  ${payload}\n`+[...data].map(([n,b])=>`${hash(b)}  ${n}\n`).join(''));
    for(const [n,b] of data)writeFileSync(join(root,n),b);
    const receipt={...candidate,hashes:Object.fromEntries([...data].map(([n,b])=>[n,hash(b)]))};
    writeFileSync(join(root,'tested.json'),JSON.stringify(receipt));assert.equal(assets(root,candidate).size,4);
    assert.throws(()=>assets(root,{...candidate,sha:before}));writeFileSync(join(root,names[0]),'tampered');assert.throws(()=>assets(root,candidate));
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('workflow keeps PR read-only, exact same-run artifact join and version serialization',()=>{
  const text=readFileSync('.github/workflows/ci.yml','utf8');
  assert(!text.includes('pull_request_target'));assert(!text.includes('secrets.'));
  assert.match(text,/permissions:\n  contents: read/);assert.match(text,/publish:\n    needs: portable/);
  assert.match(text,/group: publish-v\$\{\{ needs.portable.outputs.version \}\}/);
  assert.match(text,/cancel-in-progress: false/);assert(!/^concurrency:/m.test(text));
  assert.equal((text.match(/persist-credentials: false/g)??[]).length,2);
  assert.equal((text.match(/name: tested-release-\$\{\{ github.sha \}\}/g)??[]).length,2);
  assert.match(text,/ref: \$\{\{ github.sha \}\}/);
  assert.match(text,/needs.portable.outputs.eligible == 'true'/);
});
test('HTTP adapter sends JSON/native notes and binary assets only to fixed GitHub endpoints; errors stay sanitized',async()=>{
  const original=globalThis.fetch;
  const requests:{url:string;init:RequestInit}[]=[];
  let status=200;
  globalThis.fetch=async(input,init)=>{
    requests.push({url:String(input),init:init!});
    const binary=(init!.headers as Record<string,string>).Accept==='application/octet-stream';
    return new Response(binary?new Uint8Array([1,2,3]):JSON.stringify({message:'synthetic-private-response'}),{status});
  };
  try {
    const api=githubAPI('synthetic-token');
    await api('POST','/releases',{generate_release_notes:true,draft:true});
    assert.equal(requests[0].url,`https://api.github.com/repos/${canonical}/releases`);
    assert.deepEqual(JSON.parse(requests[0].init.body as string),{generate_release_notes:true,draft:true});
    await api('UPLOAD','/releases/10/assets?name=fixture.zip',Buffer.from([1,2,3]));
    assert.equal(requests[1].url,`https://uploads.github.com/repos/${canonical}/releases/10/assets?name=fixture.zip`);
    assert.equal(requests[1].init.method,'POST');
    assert.deepEqual([...requests[1].init.body as Uint8Array],[1,2,3]);
    assert.equal((requests[1].init.headers as Record<string,string>)['Content-Type'],'application/octet-stream');
    assert.deepEqual(await api('DOWNLOAD','/releases/assets/1'),Buffer.from([1,2,3]));
    status=404;assert.equal(await api('GET','/releases/tags/v0.2.6'),null);
    await assert.rejects(api('UPLOAD','/releases/10/assets?name=fixture.zip',Buffer.from('fixture')),/GitHub operation failed \(404\)/);
    status=500;
    await assert.rejects(api('PATCH','/releases/10',{draft:false}),error=>{
      assert(error instanceof Error);assert(!error.message.includes('synthetic-token'));assert(!error.message.includes('synthetic-private-response'));return true;
    });
    await assert.rejects(api('GET','/../unexpected'));
  } finally {globalThis.fetch=original;}
});
