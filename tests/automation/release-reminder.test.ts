import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonical } from '../../scripts/release.ts';
import { baseline, pullRequests, visibleMentions, runReminder, type Context } from '../../scripts/release-credits.ts';

const head='a'.repeat(40),old='b'.repeat(40),other='c'.repeat(40);
const context:Context={version:'1.1.0',head:[head,old],tags:['v1.0.0'],body:'## Fixes\n\n- Board: Clearer progress.'};
const release=(tag_name='v1.0.0',draft=false)=>({tag_name,draft,published_at:draft?null:'2026-01-01T00:00:00Z'});
const pull=(number:number,login:string|null,sha=head,type='User',merged_at:string|null='2026-01-02T00:00:00Z')=>({number,merge_commit_sha:sha,merged_at,user:login===null?null:{login,type},title:'untrusted title',body:'untrusted body'});
const first='- [@alice](https://github.com/alice) made their first contribution in #2';
const fixture=(rows:unknown[],body=context.body)=>({load:()=>({...context,body}),ancestors:()=>[old],api:async(path:string)=>path.startsWith('/releases?')?[release()]:rows});
function runChild(scenario:object,timeout=10_000) {
  const root=mkdtempSync(join(tmpdir(),'release-reminder-child-'));
  try {
    const file=join(root,'scenario.json');writeFileSync(file,JSON.stringify(scenario));
    return spawnSync(process.execPath,['--experimental-strip-types',resolve('tests/automation/fixtures/release-reminder-child.ts'),file],{cwd:root,encoding:'utf8',timeout});
  } finally {rmSync(root,{recursive:true,force:true});}
}

test('owner-only release and real notes need no contributor credit; advice does not run for a non-bump',async()=>{
  const result=await runReminder({},fixture(Array.from({length:17},(_,i)=>pull(i+1,canonical.split('/')[0])),readFileSync('release-notes/1.1.1.md','utf8')));
  assert(result.text.includes('Merged pull requests in range: 17.'));assert(result.text.includes('No outside contributors found.'));assert.equal(result.warning,false);
  const skipped=await runReminder({}, {load:()=>null,api:async()=>{throw Error('must not read');}});
  assert.equal(skipped.text,'Release credit reminder: package version did not increase.');
});

test('outside mentions, first-time and returning contributors, and unresolved historical authors',async()=>{
  const rows=[pull(1,'returning',old),pull(2,'alice'),pull(3,'returning'),pull(4,null,old),pull(5,null),pull(6,'helper[bot]',head,'Bot')];
  const result=await runReminder({},fixture(rows,'Thanks to [@RETURNING](https://github.com/returning).'));
  assert(result.text.includes('Outside contributors: @alice, @returning.'));
  assert(result.text.includes('Missing credit mentions: @alice.'));assert(!result.text.includes('Missing credit mentions: @returning'));
  assert(result.text.includes(`First-time contributors (ready to paste):\n${first}`));assert(!result.text.includes('[@returning]'));
  assert(result.text.includes('Author unavailable: #5.'));assert(!result.text.includes('#4.'));assert(!result.text.includes('helper'));
  assert(result.text.includes(`Missing New contributors entries:\n${first}`));assert.equal(result.warning,true);
  const complete=await runReminder({},fixture(rows.filter(p=>p.number!==5),`Thanks to @alice and @returning.\n\n## New contributors\n\n${first}`));
  assert.equal(complete.warning,false);assert(!complete.text.includes('Missing'));
});

test('New contributors extras, wrong PRs and malformed entries are advice only',async()=>{
  const rows=[pull(2,'alice')];
  const result=await runReminder({},fixture(rows,'Thanks to @alice.\n\n## New contributors\n\n- [@extra](https://github.com/extra) made their first contribution in #3\n- malformed'));
  assert(result.text.includes('Missing New contributors entries:'));assert(result.text.includes('Extra or incorrect New contributors entries:'));
  assert(result.text.includes('[@extra]'));assert(result.text.includes('Unrecognized New contributors lines: 1.'));
  assert.equal(result.warning,true);
});

test('mentions count visible text and labels, not code, comments, destinations or login prefixes',()=>{
  for(const markdown of ['`@alice`','``code ` @alice``','```md\n@alice\n```','~~~\n@alice\n~~~','<!-- @alice -->','<!--\nhidden @alice\n-->','[Other](https://github.com/@alice)','[Other](https://example.invalid/(a)/@alice)','[link][ref]\n\n[ref]: https://example.invalid/@alice','<a title="@alice">Other</a>','@alice-other','@alicelonger']) {
    assert(!visibleMentions(markdown).has('alice'),markdown);
  }
  for(const markdown of ['Thanks to @alice.','[@ALICE](https://github.com/alice)','**@alice**','\\@alice'])assert(visibleMentions(markdown).has('alice'),markdown);
});

test('angle regions hide attributes and malformed markup without hiding adjacent ordinary mentions',()=>{
  for(const markdown of ['<a title="@ann">label</a>','<a title="> @ann">label</a>','<<script>script @ann>','<unfinished @ann','<!-- first line\n@ann\nlast line -->','@an<span></span>n']) {
    assert(!visibleMentions(markdown).has('ann'),markdown);
  }
  for(const markdown of ['<<script>script>@ann','@ann<span>text</span>','<span>text</span>@ann','<unfinished\n@ann','<!-- @hidden\n-->@ann']) {
    assert(visibleMentions(markdown).has('ann'),markdown);
  }
});

test('visibility scanning returns promptly on long malformed angles, references, and escapes',()=>{
  const markdown=[
    '<'.repeat(125000)+'@hidden\n@ann',
    ']'.repeat(40000)+' '.repeat(40000)+'['.repeat(40000)+'\n@ann',
    '\\'.repeat(120000)+'@ann',
    '<!--'+'<'.repeat(120000)+'@hidden\n-->@ann',
    'prefix '+Array.from({length:450},(_,i)=>'`'.repeat(i+1)).join(' ')+' @ann',
  ];
  const result=runChild({behavior:'visible-mentions',context,markdown},3000);
  assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),markdown.map(()=>['ann']));
});

test('published baseline ignores stranded and draft tags; failed read clearly falls back to local tags',async()=>{
  const tags=['v0.9.0','v1.0.0','v1.0.1','v1.0.2'];
  assert.deepEqual(await baseline('1.1.0',tags,async()=>[release(),release('v1.0.1',true),release('v9.0.0')]),{tag:'v1.0.0',source:'published releases'});
  assert.deepEqual(await baseline('1.1.0',tags,async()=>{throw Error('rate limited');}),{tag:'v1.0.2',source:'local tag fallback; published releases unavailable'});
  assert.deepEqual(await baseline('1.1.0',[],async()=>[]),{tag:null,source:'published releases'});
  const result=await runReminder({}, {...fixture([pull(2,'alice')]),api:async(path)=>{if(path.startsWith('/releases?'))throw Error('offline');return [pull(2,'alice')];}});
  assert(result.text.includes('local tag fallback; published releases unavailable'));
  // A stranded tag must not subtract this contributor's earlier commit.
  const range=await runReminder({}, {load:()=>({...context,tags:[...context.tags,'v1.0.2']}),ancestors:ref=>ref.startsWith('v1.0.2')?[head,old]:[old],api:async path=>path.startsWith('/releases?')?[release()]:[pull(2,'alice')]});
  assert(range.text.includes('Outside contributors: @alice.'));
});

test('state=all pagination includes reopened rows without moving the merged population',async()=>{
  const calls:string[]=[];
  const rows=await pullRequests(async path=>{
    calls.push(path);assert(path.includes('state=all&sort=created&direction=asc'));
    return path.endsWith('page=1')?Array.from({length:100},(_,i)=>pull(i+1,'person',head,'User',null)):[pull(101,'alice')];
  });
  assert.equal(calls.length,2);assert.deepEqual(rows.map(p=>p.number),[101]);
  const bounded=await runReminder({}, {...fixture([]),api:async(path)=>path.startsWith('/releases?')?[release()]:Array.from({length:100},(_,i)=>pull(Number(new URL('https://example.invalid'+path).searchParams.get('page'))*100+i+1,'person'))});
  assert.match(bounded.text,/^Release credit reminder could not be produced \([^)]+\)\.$/);
});

test('all operational failures become one neutral report and never throw',async()=>{
  const failures=[
    {...fixture([]),load:()=>{throw Error('missing history');}},
    {...fixture([]),ancestors:()=>{throw Error('missing tag history');}},
    {...fixture([]),api:async()=>{throw new DOMException('timeout','TimeoutError');}},
    {...fixture([]),api:async()=>{throw Error('HTTP 403 rate limit, synthetic-token');}},
    fixture([{number:'::warning::injection'}]),fixture([pull(2,'alice'),pull(2,'alice')]),
  ];
  for(const deps of failures) {
    const result=await runReminder({},deps);assert.equal(result.text,'Release credit reminder could not be produced (data or history unavailable).');assert.equal(result.warning,false);
  }
  assert.match((await runReminder({GITHUB_ACTIONS:'true'},fixture([]))).text,/could not be produced/);
});

test('hostile API fields cannot inject annotations; HTTP reads pin the legacy merge-SHA API',async()=>{
  const original=globalThis.fetch,requests:{url:string;init:RequestInit}[]=[];
  globalThis.fetch=async(url,init)=>{
    requests.push({url:String(url),init:init!});
    return new Response(JSON.stringify(String(url).includes('/releases?')?[release()]:[pull(2,'bad%\n::warning::injected')]),{status:200});
  };
  try {
    const result=await runReminder({GITHUB_TOKEN:'synthetic-token'},{load:()=>context,ancestors:()=>[old]});
    assert(result.text.includes('Author unavailable: #2.'));assert(!result.text.includes('::'));assert(!result.text.includes('%'));assert(!result.text.includes('untrusted'));
    assert(requests.every(r=>r.init.method===undefined||r.init.method==='GET'));
    assert(requests.every(r=>(r.init.headers as Record<string,string>)['X-GitHub-Api-Version']==='2022-11-28'));
    assert(requests.every(r=>(r.init.headers as Record<string,string>).Authorization==='Bearer synthetic-token'));
  } finally {globalThis.fetch=original;}
});

test('actual advisory entry point exits zero on API errors, bad rows, missing history and summary errors',()=>{
  for(const behavior of ['throw-error','rate-limit','timeout','bad-rows','missing-history','summary','token']) {
    const env=behavior==='summary'?{GITHUB_STEP_SUMMARY:'missing-parent/summary'}:behavior==='token'?{GITHUB_ACTIONS:'true'}:{};
    const r=runChild({behavior:behavior==='summary'||behavior==='token'?'ok':behavior,context,releases:[release()],env});
    assert.equal(r.status,0);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'Release credit reminder could not be produced (data or history unavailable).');
  }
});

test('summary has the same report and annotations use only a constant, not API text',()=>{
  const root=mkdtempSync(join(tmpdir(),'release-reminder-'));
  try {
    const summary=join(root,'summary');
    const r=runChild({behavior:'ok',context,previous:[old],releases:[release()],pulls:[pull(2,'alice')],env:{GITHUB_ACTIONS:'true',GITHUB_TOKEN:'synthetic-token',GITHUB_STEP_SUMMARY:summary}});
    assert.equal(r.status,0);assert.equal(r.stderr,'');
    assert.equal((r.stdout.match(/::warning title=Release credits::/g)??[]).length,1);
    assert(r.stdout.endsWith('::warning title=Release credits::Review missing or unexpected credits in the release credit reminder.\n'));
    assert(r.stdout.startsWith(readFileSync(summary,'utf8')));assert(!readFileSync(summary,'utf8').includes('::warning'));
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('workflow isolates advisory permissions/token/step from every gate',()=>{
  const text=readFileSync('.github/workflows/ci.yml','utf8');
  const portable=text.slice(text.indexOf('  portable:'),text.indexOf('  node-latest:'));
  assert.match(portable,/permissions:\n      contents: read\n      pull-requests: read/);
  assert.match(portable,/name: Release credit reminder \(advisory\)\n        if: \$\{\{ always\(\) && !cancelled\(\) \}\}\n        continue-on-error: true/);
  assert.equal((portable.match(/GITHUB_TOKEN:/g)??[]).length,1);
  assert(!portable.slice(portable.indexOf('id: check'),portable.indexOf('- name: Release credit reminder')).includes('GITHUB_TOKEN'));
  assert(!readFileSync('scripts/ci.ts','utf8').includes('release-credits'));
  assert(!readFileSync('scripts/release.ts','utf8').includes('release-credits'));
});
