// QA seeding through the production write path, without a model.
// Calls the INSTALLED companion's registered `agent_progress_report` tool exactly as OpenCode would
// (see real-tool.ts), with caller identity taken from real session records of the isolated host.
// Never touches store internals.
//
// Usage: node --experimental-strip-types tests/browser/seed-real.ts <isolatedRoot> <sessions.json> <script.json>
//   sessions.json: { NAME: { id, location:{directory}, parentID?, projectID?, agent? } } (from the host API)
//   script.json:   [{ as: NAME, input: {...report tool input}, deny?: [paths], clockOffsetMinutes?: n }
//                   | { fs: 'rename', from, to } | { fs: 'write', path, text }]
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { loadReportTool, type SessionRecord } from './real-tool.ts';

const [root, sessionsFile, scriptFile] = process.argv.slice(2);
if (!root || !sessionsFile || !scriptFile) throw new Error('usage: seed-real.ts <isolatedRoot> <sessions.json> <script.json>');

const sessions = JSON.parse(readFileSync(sessionsFile, 'utf8')) as Record<string, SessionRecord>;
type Step = { as: string; input: Record<string, unknown>; deny?: string[]; clockOffsetMinutes?: number } | { fs: 'rename'; from: string; to: string } | { fs: 'write'; path: string; text: string };

// QA6 "controlled old report timestamp": a test clock for this seeding process only. The
// production write path stamps times with the process clock, so shifting it for one step
// records a genuinely old report without editing store internals.
const RealDate = Date;
function useClock(offsetMinutes: number) {
  if (!offsetMinutes) { globalThis.Date = RealDate; return; }
  const shift = offsetMinutes * 60_000;
  class Shifted extends RealDate {
    constructor(...args: unknown[]) { if (args.length) super(...(args as [number])); else super(RealDate.now() - shift); }
    static now() { return RealDate.now() - shift; }
  }
  globalThis.Date = Shifted as DateConstructor;
}
const script = JSON.parse(readFileSync(scriptFile, 'utf8')) as Step[];

const tool = await loadReportTool(root, sessions);
let n = 0;
for (const step of script) {
  if ('fs' in step) {
    if (step.fs === 'rename') renameSync(step.from, step.to); else writeFileSync(step.path, step.text);
    console.log(JSON.stringify({ step: n++, fs: step.fs, ok: true }));
    continue;
  }
  useClock(step.clockOffsetMinutes ?? 0);
  const reply = await tool.report(step.as, step.input, step.deny);
  useClock(0);
  console.log(JSON.stringify({ step: n++, as: step.as, op: step.input.op, plan: step.input.plan, ...(step.clockOffsetMinutes ? { clockOffsetMinutes: step.clockOffsetMinutes } : {}), reply }));
}
tool.dispose();
