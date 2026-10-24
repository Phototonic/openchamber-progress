// T6 item 3a/3b: the UI read adapter (ui/shared/source.ts) against the REAL packaged service, with
// real writes through the installed companion injected between pages. Deterministic, no model.
//
// Usage: node --experimental-strip-types tests/browser/live-adapter.ts <isolatedRoot> <sessions.json> <service main.js> <binding.json> <plan id> <owner session name> <document file> [out.json]
// The service runs standalone with its own loopback port/bearer (as the host would supply) and
// reads the binding descriptor given; the isolated root's store must be the one that descriptor binds.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { readDetail, readDocument, type ServiceHost } from '../../ui/shared/source.ts';
import { loadReportTool, type SessionRecord } from './real-tool.ts';

const [root, sessionsFile, serviceMain, bindingFile, planId, owner, docFile, outFile] = process.argv.slice(2);
if (!docFile) throw new Error('usage: live-adapter.ts <isolatedRoot> <sessions.json> <service main.js> <binding.json> <plan> <owner> <document file> [out.json]');

const freePort = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });
const port = await freePort();
const token = randomBytes(24).toString('hex');
const service = spawn(process.execPath, [serviceMain], {
  env: { PATH: process.env.PATH, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: token, AGENT_PROGRESS_BINDING: bindingFile },
  stdio: ['ignore', 'ignore', 'pipe'],
});

type Logged = { path: string; query?: Record<string, string>; status: number; revision?: number; captureId?: number; diagnostics?: string[] };
let log: Logged[] = [];
let inject: ((req: GuestRequest) => Promise<void>) | null = null;

/** The host proxy's shape: path + query + body in, status + body text out. */
const host: ServiceHost = {
  async serviceRequest(req: GuestRequest): Promise<GuestRequestResult> {
    const url = `http://127.0.0.1:${port}${req.path}${req.query ? `?${new URLSearchParams(req.query)}` : ''}`;
    const res = await fetch(url, { method: req.method, headers: { authorization: `Bearer ${token}` }, ...(req.body !== undefined ? { body: req.body } : {}) });
    const body = await res.text();
    const j = JSON.parse(body) as { plan?: { revision?: number }; document?: { captureId?: number }; diagnostics?: string[] };
    log.push({ path: req.path, query: req.query, status: res.status, revision: j.plan?.revision, captureId: j.document?.captureId, diagnostics: j.diagnostics });
    // A write staged here lands strictly between this page and the next one the adapter asks for.
    if (inject) { const run = inject; inject = null; await run(req); }
    return { status: res.status, body };
  },
};

const results: Record<string, unknown> = {};
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { results[name] = { ok, ...(detail !== undefined ? { detail } : {}) }; if (!ok) failures.push(name); };

try {
  for (let i = 0; ; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` } }); if (r.ok && (await r.json() as { ready?: boolean }).ready) break; } catch {}
    if (i > 50) throw new Error('service did not become ready');
    await new Promise((r) => setTimeout(r, 100));
  }
  const sessions = JSON.parse(readFileSync(sessionsFile, 'utf8')) as Record<string, SessionRecord>;
  const tool = await loadReportTool(root, sessions);
  const list = JSON.parse(await (await host.serviceRequest({ method: 'GET', path: '/v1/plans', query: { limit: '50' } })).body) as { data: { id: string; sourceId: string; revision: number }[] };
  const listed = list.data.find((p) => p.id === planId);
  if (!listed) throw new Error(`plan ${planId} not listed`);
  const plan = { sourceId: listed.sourceId, id: planId, key: `${listed.sourceId}/${planId}` };

  // --- 3a: revision change between detail pages → the adapter restarts, never mixes revisions.
  log = [];
  const quiet = await readDetail(host, plan);
  check('3a.control-no-restart', quiet.ok && quiet.restarts === 0 && log.length >= 3, quiet.ok ? { restarts: quiet.restarts, pages: log.length, items: quiet.detail.items.length, revision: quiet.detail.revision } : quiet.failure);
  const before = quiet.ok ? quiet.detail.revision : -1;
  log = [];
  let receipt: Record<string, unknown> = {};
  // Flip M5 so reruns always make a real change.
  const target = quiet.ok && quiet.detail.items.find((i) => i.id === 'M5')?.status === 'done' ? 'working' : 'done';
  inject = async () => { receipt = await tool.report(owner, { op: 'change', plan: planId, oid: `t6-3a-${Date.now()}`, rev: 'auto', changes: [{ id: 'M5', status: target }] }); };
  const raced = await readDetail(host, plan);
  const pageRevs = log.filter((l) => l.path === '/v1/plan').map((l) => `${l.query?.cursor ?? 'first'}@${l.revision}`);
  check('3a.restart-on-revision-change', raced.ok && raced.restarts === 1 && raced.detail.revision === (receipt.rev as number) && raced.detail.revision > before, { receipt, restarts: raced.ok ? raced.restarts : null, pageRevs, finalRevision: raced.ok ? raced.detail.revision : null });
  if (raced.ok) {
    const m5 = raced.detail.items.find((i) => i.id === 'M5');
    const revs = new Set(log.filter((l) => l.path === '/v1/plan').slice(-Math.ceil(raced.detail.items.length / 20)).map((l) => l.revision));
    check('3a.final-read-single-revision', raced.detail.items.length === (quiet.ok ? quiet.detail.items.length : -1) && m5?.status === target && revs.size === 1, { items: raced.detail.items.length, m5: m5?.status, lastAttemptRevisions: [...revs] });
  }

  // --- 3b: document re-captured mid-read → continuation pinned to the older capture answers historically.
  const originalText = readFileSync(docFile, 'utf8');
  log = [];
  const docBefore = await readDocument(host, plan);
  check('3b.control-current-capture', docBefore.ok && !docBefore.body.historical && log.length >= 2 && docBefore.body.text === originalText, docBefore.ok ? { captureId: docBefore.body.captureId, pages: log.length, chars: docBefore.body.text?.length, matchesFile: docBefore.body.text === originalText } : docBefore.failure);
  log = [];
  let recapture: Record<string, unknown> = {};
  const revisedText = originalText.replace(/Revision \w+ of the long document[^\n]*/, `Revision R${Date.now()} of the long document (re-captured mid-read).`);
  if (revisedText === originalText) throw new Error('document has no revision line to change');
  inject = async () => {
    writeFileSync(docFile, revisedText);
    recapture = await tool.report(owner, { op: 'bind', plan: planId, oid: `t6-3b-${Date.now()}`, rev: 'auto', source: 'docs/long-plan.md', confirm: true });
  };
  const docRaced = await readDocument(host, plan);
  const docPages = log.filter((l) => l.path === '/v1/document').map((l) => ({ cursor: l.query?.cursor ?? 'first', capture: l.query?.capture ?? null, servedCapture: l.captureId, historical: l.diagnostics?.includes('historical-capture') ?? false }));
  const continuationHistorical = docPages.slice(1).every((p) => p.historical);
  check('3b.service-marks-continuation-historical', docPages.length >= 2 && !docPages[0].historical && continuationHistorical, { recapture, docPages });
  check('3b.text-is-one-coherent-older-capture', docRaced.ok && docRaced.body.text === originalText, docRaced.ok ? { chars: docRaced.body.text?.length, equalsOlderCapture: docRaced.body.text === originalText, containsRevisionB: docRaced.body.text?.includes('Revision B') } : docRaced.failure);
  // The adapter must carry the historical answer to the view (defect if only the first page counts).
  check('3b.adapter-reports-historical', docRaced.ok && docRaced.body.historical === true, docRaced.ok ? { historical: docRaced.body.historical } : docRaced.failure);
  log = [];
  const docAfter = await readDocument(host, plan);
  check('3b.next-read-is-current-capture', docAfter.ok && !docAfter.body.historical && docAfter.body.text === revisedText && (docAfter.body.captureId ?? 0) > (docBefore.ok ? docBefore.body.captureId ?? 0 : 0), docAfter.ok ? { captureId: docAfter.body.captureId, historical: docAfter.body.historical } : docAfter.failure);
  tool.dispose();
} catch (error) {
  failures.push(`harness: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  service.kill('SIGTERM');
}

const summary = { plan: planId, service: 'packaged build/service/main.js (standalone, host-shaped port/bearer)', results, failures };
const text = JSON.stringify(summary, null, 2);
if (outFile) writeFileSync(outFile, text + '\n');
console.log(text);
process.exitCode = failures.length ? 1 : 0;
