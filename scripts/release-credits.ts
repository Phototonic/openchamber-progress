/** Standalone advice only. Never imported by CI's gate or the publisher. */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonical, parseReleaseNotes } from './release.ts';

const shaPattern=/^[a-f0-9]{40}$/;
const loginPattern=/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const neutral='Release credit reminder could not be produced (data or history unavailable).';
type Env=Record<string,string|undefined>;
type ReadAPI=(path:string)=>Promise<unknown>;
export type Context={version:string;head:string[];tags:string[];body:string};
export type Pull={number:number;sha:string;merged:string;login:string|null;bot:boolean};
type Report={text:string;warning:boolean};
type Dependencies={load:()=>Context|null;ancestors:(tag:string)=>string[];api:ReadAPI};
const ensure=(value:unknown):void=>{if(!value)throw new Error('Unavailable');};
function parts(v:string):number[]|null {
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)) return null;
  const result=v.split('.').map(Number);return result.every(Number.isSafeInteger)?result:null;
}
const compare=(a:number[],b:number[])=>a.map((n,i)=>Math.sign(n-b[i])).find(n=>n!==0)??0;
function latest(version:string,tags:string[]):string|null {
  const target=parts(version);ensure(target);
  return tags.filter(t=>t.startsWith('v')&&parts(t.slice(1))&&compare(parts(t.slice(1))!,target!)<0)
    .sort((a,b)=>compare(parts(b.slice(1))!,parts(a.slice(1))!))[0]??null;
}
async function pages(api:ReadAPI,path:string):Promise<any[]> {
  const rows:any[]=[];
  for(let page=1;page<=20;page++) {
    const batch=await api(`${path}${path.endsWith('?')?'':'&'}per_page=100&page=${page}`);
    ensure(Array.isArray(batch)&&batch.length<=100);rows.push(...batch as any[]);
    if((batch as any[]).length<100)return rows;
  }
  throw new Error('Page bound');
}
export async function baseline(version:string,tags:string[],api:ReadAPI):Promise<{tag:string|null;source:string}> {
  try {
    const releases=await pages(api,'/releases?');
    ensure(releases.every(r=>r&&typeof r.tag_name==='string'&&typeof r.draft==='boolean'&&(r.published_at===null||(typeof r.published_at==='string'&&Number.isFinite(Date.parse(r.published_at))))));
    return {tag:latest(version,releases.filter(r=>!r.draft&&r.published_at!==null&&tags.includes(r.tag_name)).map(r=>r.tag_name)),source:'published releases'};
  } catch { return {tag:latest(version,tags),source:'local tag fallback; published releases unavailable'}; }
}
export async function pullRequests(api:ReadAPI):Promise<Pull[]> {
  // state=all keeps reopened PRs in the same created-order pagination universe.
  const rows=await pages(api,'/pulls?state=all&sort=created&direction=asc'),seen=new Set<number>(),result:Pull[]=[];
  for(const p of rows) {
    ensure(p&&Number.isSafeInteger(p.number)&&p.number>0&&!seen.has(p.number));seen.add(p.number);
    ensure(p.merged_at===null||(typeof p.merged_at==='string'&&Number.isFinite(Date.parse(p.merged_at))));
    if(p.merged_at===null)continue;
    ensure(typeof p.merge_commit_sha==='string'&&shaPattern.test(p.merge_commit_sha));
    ensure(p.user===null||(p.user&&typeof p.user.login==='string'&&typeof p.user.type==='string'));
    const login=p.user&&loginPattern.test(p.user.login)?p.user.login.toLowerCase():null;
    result.push({number:p.number,sha:p.merge_commit_sha,merged:p.merged_at,login,bot:p.user?.type==='Bot'});
  }
  return result;
}
function prose(markdown:string):string {
  let fence='';
  const text=markdown.replaceAll('\r\n','\n').replace(/<!--[\s\S]*?(?:-->|$)/g,'').split('\n').map(line=>{
    const m=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(fence) {if(m&&m[1][0]===fence[0]&&m[1].length>=fence.length&&line.slice(m[0].length).trim()==='')fence='';return '';}
    if(m){fence=m[1];return '';}
    return /^( {4}|\t)/.test(line)?'':line;
  }).join('\n');
  // Code spans close only with a run of exactly the same length.
  let out='';
  for(let i=0;i<text.length;) {
    if(text[i]==='`'&&(i===0||text[i-1]!=='\\')) {
      const open=/^`+/.exec(text.slice(i))![0];let end=i+open.length,closed=false;
      while(end<text.length) {
        const at=text.indexOf('`',end);if(at<0)break;
        const run=/^`+/.exec(text.slice(at))![0];end=at+run.length;
        if(run.length===open.length){i=end;closed=true;break;}
      }
      if(closed)continue;
      out+=open;i+=open.length;
    } else {out+=text[i++];}
  }
  return out;
}
export function visibleMentions(markdown:string):Set<string> {
  const text=prose(markdown).replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*/gm,'');
  let visible='';
  for(let i=0;i<text.length;i++) {
    // Preserve link labels, not destinations (including balanced parentheses).
    if(text[i]===']'&&text[i+1]==='(') {
      visible+=']';let depth=1;i+=2;
      for(;i<text.length;i++) {if(text[i]==='\\'){i++;continue;}if(text[i]==='(')depth++;if(text[i]===')'&&!--depth)break;}
    } else visible+=text[i];
  }
  visible=visible.replace(/\]\s*\[[^\]\n]*\]/g,']').replace(/<[^>\n]*>/g,'').replace(/\\([\\`*{}\[\]()#+\-.!_>@])/g,'$1');
  return new Set([...visible.matchAll(/(?:^|[^a-z0-9-])@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?![a-z0-9-])/gi)]
    .map(m=>m[1].toLowerCase()).filter(l=>loginPattern.test(l)));
}
const bullet=(login:string,number:number)=>`- [@${login}](https://github.com/${login}) made their first contribution in #${number}`;
export function report(context:Context,previous:string[],pulls:Pull[],base:{tag:string|null;source:string}):Report {
  const head=new Set(context.head),prior=new Set(previous),owner=canonical.split('/')[0].toLowerCase();
  const included=pulls.filter(p=>head.has(p.sha)&&!prior.has(p.sha));
  const authors=[...new Set(included.filter(p=>p.login&&p.login!==owner&&!p.bot).map(p=>p.login!))].sort();
  const unavailable=included.filter(p=>!p.login&&!p.bot).map(p=>`#${p.number}`);
  const first=new Map<string,number>();
  for(const login of authors) if(!pulls.some(p=>p.login===login&&prior.has(p.sha))) {
    first.set(login,included.filter(p=>p.login===login).sort((a,b)=>Date.parse(a.merged)-Date.parse(b.merged)||a.number-b.number)[0].number);
  }
  const mentions=visibleMentions(context.body),missing=authors.filter(l=>!mentions.has(l));
  const section=/^## New contributors\s*\n([\s\S]*)/m.exec(prose(context.body));
  const entries=new Map<string,number>(),extra:string[]=[];let malformed=0;
  for(const line of (section?.[1]??'').split('\n').filter(l=>l.trim())) {
    const m=/^- \[@([a-z0-9-]+)\]\(https:\/\/github\.com\/\1\) made their first contribution in #([1-9]\d*)$/i.exec(line);
    if(!m||!loginPattern.test(m[1])||!Number.isSafeInteger(Number(m[2]))) {malformed++;continue;}
    const login=m[1].toLowerCase(),number=Number(m[2]);
    if(entries.has(login)||first.get(login)!==number)extra.push(bullet(login,number));
    entries.set(login,number);
  }
  const absent=[...first].filter(([l,n])=>entries.get(l)!==n);
  const lines=['### Release credit reminder (advisory)',`Baseline: ${base.tag?`\`${base.tag}\``:'all reachable history'} (${base.source}).`,`Merged pull requests in range: ${included.length}.`];
  lines.push(authors.length?`Outside contributors: ${authors.map(l=>`@${l}`).join(', ')}.`:'No outside contributors found.');
  if(unavailable.length)lines.push(`Author unavailable: ${unavailable.join(', ')}. Review these pull requests manually.`);
  if(missing.length)lines.push(`Missing credit mentions: ${missing.map(l=>`@${l}`).join(', ')}.`);
  if(first.size)lines.push('First-time contributors (ready to paste):',...Array.from(first,([l,n])=>bullet(l,n)));
  if(absent.length)lines.push('Missing New contributors entries:',...absent.map(([l,n])=>bullet(l,n)));
  if(extra.length)lines.push('Extra or incorrect New contributors entries:',...extra);
  if(malformed)lines.push(`Unrecognized New contributors lines: ${malformed}. Review manually.`);
  const empty=!!section&&!first.size&&!entries.size;
  if(empty)lines.push('Omit the New contributors section when there are none.');
  return {text:lines.join('\n'),warning:!!(missing.length||absent.length||extra.length||malformed||empty||unavailable.length)};
}
function git(args:string[]):string {
  const r=spawnSync('git',args,{encoding:'utf8',timeout:10_000,maxBuffer:8*1024*1024});ensure(r.status===0);return r.stdout.trim();
}
function ancestors(ref:string):string[] {
  const rows=git(['rev-list','--max-count=100001',ref]).split('\n');ensure(rows.length<=100000&&rows.every(s=>shaPattern.test(s)));return rows;
}
function load(env:Env):Context|null {
  const sha=env.GITHUB_SHA||git(['rev-parse','HEAD']);ensure(shaPattern.test(sha));
  ensure(git(['rev-parse','--is-shallow-repository'])==='false');
  const read=(ref:string,file:string)=>git(['show',`${ref}:${file}`]);
  const version=JSON.parse(read(sha,'package.json')).version;ensure(typeof version==='string'&&parts(version));
  if(env.GITHUB_EVENT_PATH) {
    const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')),base=event.pull_request?.base?.sha??event.before;
    ensure(typeof base==='string'&&shaPattern.test(base));
    const old=JSON.parse(read(base,'package.json')).version;ensure(typeof old==='string'&&parts(old));
    if(compare(parts(version)!,parts(old)!)<=0)return null;
  } else ensure(env.GITHUB_ACTIONS!=='true');
  return {version,head:ancestors(sha),tags:git(['tag','--list']).split('\n'),body:parseReleaseNotes(version,`release-notes/${version}.md`,read(sha,`release-notes/${version}.md`)).body};
}
function api(token?:string):ReadAPI {
  const budget=AbortSignal.timeout(60_000);
  return async(path)=>{
    const response=await fetch(`https://api.github.com/repos/${canonical}${path}`,{
      signal:AbortSignal.any([budget,AbortSignal.timeout(10_000)]),
      // 2022 retains merge_commit_sha, removed by the 2026 API version.
      headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:`Bearer ${token}`}:{})},
    });
    ensure(response.ok);return response.json();
  };
}
export async function runReminder(env:Env=process.env,deps:Partial<Dependencies>={}):Promise<Report> {
  try {
    const context=(deps.load??(()=>load(env)))();
    if(!context)return {text:'Release credit reminder: package version did not increase.',warning:false};
    if(env.GITHUB_ACTIONS==='true'&&!env.GITHUB_TOKEN)throw new Error('Missing token');
    const read=deps.api??api(env.GITHUB_TOKEN),base=await baseline(context.version,context.tags,read);
    const previous=base.tag?(deps.ancestors??ancestors)(`${base.tag}^{commit}`):[];
    return report(context,previous,await pullRequests(read),base);
  } catch { return {text:neutral,warning:false}; }
}
export async function main(env:Env=process.env,deps:Partial<Dependencies>={}):Promise<void> {
  try {
    const result=await runReminder(env,deps);
    if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,result.text+'\n');
    console.log(result.text);
    // A constant annotation: no API or notes bytes enter workflow commands.
    if(result.warning&&env.GITHUB_ACTIONS==='true')console.log('::warning title=Release credits::Review missing or unexpected credits in the release credit reminder.');
  } catch {
    try {if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,neutral+'\n');} catch { /* Advice remains optional even if the summary is unwritable. */ }
    try {console.log(neutral);} catch { /* An unavailable output stream cannot make advice a gate. */ }
  } finally {process.exitCode=0;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
