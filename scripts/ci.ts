/** Portable validation only; native host promotion remains a separate maintainer gate. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { eligibility, assetNames, validateReleaseNotes } from './release.ts';
import { verifyCompanionEntry } from './companion-entry.ts';
import { nativeOnlyTests } from './ci-backend.ts';
import { runLanes } from './test-lanes.ts';
import { freshCompileCache, portableLanes } from './test-plan.ts';
import { buildAll, outputHashes, compareOutputs } from './build-all.ts';
import { revisionKind, trackedOutputs } from './revision-kind.ts';

// Refuse before reading entries or starting checks: local archives are never disposable.
if (existsSync('build/artifacts') && readdirSync('build/artifacts').length > 0) {
  console.error('Portable CI requires a fresh disposable checkout: build/artifacts is nonempty. Existing artifacts were preserved.');
  process.exit(1);
}

function run(command:string, args:string[]) {
  if (spawnSync(command,args,{stdio:'inherit'}).status !== 0) throw new Error('Portable check failed');
}
const hash = (file:string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const event=process.env.GITHUB_EVENT_PATH?JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')):undefined;
const revision=process.env.GITHUB_SHA??spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
const kind = revisionKind(event, trackedOutputs(revision));
let candidate:ReturnType<typeof eligibility>=null;
try {
  validateReleaseNotes(revision,event?.pull_request?.base?.sha??event?.before);
  // Validate eligibility before costly checks or packaging, and again in publish.
  candidate=event?eligibility(event,process.env.GITHUB_EVENT_NAME!,process.env.GITHUB_SHA!,process.env.GITHUB_REPOSITORY!):null;
} catch { throw new Error('Release notes validation failed; check committed version notes and event history.'); }
console.log(`Runtime revision kind: ${kind}`);
if (kind === 'source') buildAll();
const before = outputHashes();
verifyCompanionEntry(process.cwd());
mkdirSync('/tmp/opencode',{recursive:true});
console.log(`Native-only tests NOT RUN: ${nativeOnlyTests.join(', ')}`);
// Root and UI typechecks, the parallel backend group, and browser-model and
// automation tests run beside the serial backend group that binds Setup ports.
// Output is grouped per step and the first failure stops every lane.
await runLanes(portableLanes({ fenced: true, env: freshCompileCache() }));
buildAll();
compareOutputs(before);
// The SDK's own readiness check: manifest schema, page scripts and service entry.
run('bun',['node_modules/@openchamber/sdk/scripts/check-guest.ts','.']);
run('node',['--experimental-strip-types','scripts/package.ts']);
run('node',['--experimental-strip-types','scripts/verify-package.ts']);
console.log('Native GUI/runtime certification NOT RUN; actualHostInstaller: not-run (no external host module supplied).');
if (process.env.GITHUB_EVENT_PATH) {
  const result = candidate;
  if (result) {
    mkdirSync('release-assets',{recursive:true});
    const hashes:Record<string,string> = {};
    for (const name of assetNames(result.version)) { copyFileSync(`build/artifacts/${name}`,`release-assets/${name}`); hashes[name]=hash(`release-assets/${name}`); }
    writeFileSync('release-assets/tested.json',JSON.stringify({...result,hashes}));
  }
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT,`eligible=${!!result}\nversion=${result?.version ?? ''}\n`,{flag:'a'});
}
