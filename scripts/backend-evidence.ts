/** Synthetic semantic guidance dry-run and token ESTIMATES; never invokes a model. */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { productionFixture, P1 } from '../tests/fixtures/production.ts';
import { captureDocument } from '../plugin/document.ts';
import { REPORT_SCHEMA } from '../shared/progress.ts';
import { digest } from '../shared/store.ts';
import assert from 'node:assert/strict';

const f=productionFixture();
try{
  mkdirSync('evidence/backend',{recursive:true});
  const file=`${f.root}/canonical.md`;writeFileSync(file,'# Canonical planner\n\nПривет 🌱\n');
  const original=digest(readFileSync(file));const cap=await captureDocument(file,f.root,async()=>{});
  const s=f.store;const m=f.actor;const c=f.child;
  s.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Canonical workflow',items:P1,source:file},m,cap);
  s.apply({op:'link',plan:'P1',oid:'link',rev:1,child:'C1',assign:['I3']},m,cap,c);
  s.apply({op:'change',plan:'P1',oid:'child',rev:2,changes:[{id:'I3',status:'done'}]},c,cap);
  s.apply({op:'revise',plan:'P1',oid:'retitle',rev:3,title:'Canonical workflow revised'},m,cap);
  s.apply({op:'change',plan:'P1',oid:'final-batch',rev:4,changes:[{id:'I4',status:'done'}]},m,cap);
  s.apply({op:'finish',plan:'P1',oid:'finish',rev:5,outcome:'finished'},m,cap);
  assert.equal(s.get(m.sourceId,'P1')!.lifecycle,'finished');assert.equal(digest(readFileSync(file)),original);
  assert.equal(s.get(m.sourceId,'P1')!.items.find(i=>i.id==='I3')!.status,'done');
  const request={op:'change',plan:'P1',oid:'batch-1',rev:3,changes:[{id:'I3',status:'done'},{id:'I4',status:'working'}]};
  const receipt={plan:'P1',rev:4,structuralRev:1,changed:['I3','I4']};
  const size=(v:unknown)=>({utf8Bytes:Buffer.byteLength(JSON.stringify(v)),estimatedTokens:Math.ceil(JSON.stringify(v).length/4)});
  assert.ok(size(request).estimatedTokens<=250);assert.ok(size(receipt).estimatedTokens<=100);
  writeFileSync('evidence/backend/token-budget.md',`# T3 token tuning report\n\nSynthetic ASCII routine batch: ${JSON.stringify(size(request))}.\nRoutine receipt: ${JSON.stringify(size(receipt))}.\nTool schema: ${JSON.stringify(size(REPORT_SCHEMA))}.\n\nThese are character/4 estimates, NOT actual tokenizer, GLM usage or billed tokens.\nNo model request was made. Targets250 request/100 receipt are tuning goals, not\nvalidation limits. Large structures use explicit bounded stage/commit, never\ntruncation. Guidance is inline/on-demand, not a timer or second planner.\n`);
  writeFileSync('evidence/backend/guidance-dry-run.md','# T3 semantic guidance dry-run\n\nPASS: kept canonical planner document byte-identical; mirrored full P1 once;\nlinked an explicitly verified child; child changed assigned work only; coordinator\nretitled without resetting child status; batched final change and explicitly\nfinished. Read/revision/chunk/relay/failure variants are covered by QA2 tests.\nNo passive parser, heartbeat, inferred completion, model invocation or real file\npermission prompt was used. Capture authorization failures are separately tested.\nThis is synthetic contract evidence, not a new model-adherence claim.\n');
  console.log(JSON.stringify({guidanceDryRun:true,routineRequest:size(request),routineReceipt:size(receipt),modelRequests:0}));
}finally{f.cleanup();}
