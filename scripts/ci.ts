/** Portable validation only; native host promotion remains a separate maintainer gate. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { eligibility, assetNames } from './release.ts';

// Refuse before reading entries or starting checks: local archives are never disposable.
if (existsSync('build/artifacts') && readdirSync('build/artifacts').length > 0) {
  console.error('Portable CI requires a fresh disposable checkout: build/artifacts is nonempty. Existing artifacts were preserved.');
  process.exit(1);
}

const excluded = ['production-runtime.test.ts', 'plugin-failure-runtime.test.ts', 'progress-activation-runtime.test.ts', 'subagent-activity-runtime.test.ts'];
const entries = ['build/service/main.js','build/setup/main.js','build/companion/index.js','build/companion/package.json','build/companion/SKILL.md', ...['panel','status','page'].map(s=>`ui/${s}/main.js`)];
function run(command:string, args:string[]) {
  if (spawnSync(command,args,{stdio:'inherit'}).status !== 0) throw new Error('Portable check failed');
}
const hash = (file:string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const before = entries.map(hash);
mkdirSync('/tmp/opencode',{recursive:true});
console.log(`Native-only tests NOT RUN: ${excluded.join(', ')}`);
run('bun',['run','typecheck']);
run('./node_modules/.bin/tsc',['-p','ui/tsconfig.json','--noEmit']);
const tests = (dir:string) => readdirSync(dir).filter(f=>f.endsWith('.test.ts')).sort().map(f=>`${dir}/${f}`);
run('node',['--experimental-strip-types','--test',...tests('tests/backend').filter(f=>!excluded.includes(f.split('/').at(-1)!))]);
run('node',['--experimental-strip-types','--test',...tests('tests/browser'),...tests('tests/automation')]);
run('bun',['run','build:backend']);
for (const surface of ['panel','status','page']) run('bun',['run','bundle:guest',`ui/${surface}/main.ts`,`ui/${surface}/main.js`]);
if (entries.some((file,i)=>hash(file)!==before[i])) throw new Error('Generated entry parity failed; do not regenerate accepted entries silently');
run('bun',['run','package']);
run('bun',['run','verify:package']);
console.log('Native GUI/runtime certification NOT RUN; actualHostInstaller: not-run (no external host module supplied).');
if (process.env.GITHUB_EVENT_PATH) {
  const result = eligibility(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),process.env.GITHUB_EVENT_NAME!,process.env.GITHUB_SHA!,process.env.GITHUB_REPOSITORY!);
  if (result) {
    mkdirSync('release-assets',{recursive:true});
    const hashes:Record<string,string> = {};
    for (const name of assetNames(result.version)) { copyFileSync(`build/artifacts/${name}`,`release-assets/${name}`); hashes[name]=hash(`release-assets/${name}`); }
    writeFileSync('release-assets/tested.json',JSON.stringify({...result,hashes}));
  }
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT,`eligible=${!!result}\nversion=${result?.version ?? ''}\n`,{flag:'a'});
}
