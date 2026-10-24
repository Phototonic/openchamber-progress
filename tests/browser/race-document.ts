// T6 item 3b in a real frame: hold the frame's first pinned document continuation at the host
// page (CDP Fetch), run real writes through the installed companion (seed-real.ts), then release
// it. The service answers that page from the older capture; the view must say so.
//
// Usage: node --experimental-strip-types tests/browser/race-document.ts <cdp port> <isolatedRoot> <sessions.json> <script.json> <out.png> [seconds]
// Start it, then open the plan's document in the page view; it exits after the race (or timeout).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [portArg, root, sessionsFile, scriptFile, outPng, secondsArg] = process.argv.slice(2);
if (!outPng) throw new Error('usage: race-document.ts <cdp port> <isolatedRoot> <sessions.json> <script.json> <out.png> [seconds]');
const list = (await (await fetch(`http://127.0.0.1:${portArg}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const page = list.find((t) => t.type === 'page' && t.url.startsWith('openchamber-ui://')) ?? list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('cdp connect failed')); });
let next = 1;
const waiting = new Map<number, (m: Msg) => void>();
const frames: { sessionId: string; url: string }[] = [];
const log: string[] = [];
let raced = false;
let done: () => void = () => {};
const finished = new Promise<void>((r) => { done = r; });
const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
  const id = next++;
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

ws.onmessage = (event) => {
  const m = JSON.parse(String(event.data)) as Msg;
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); return; }
  if (m.method === 'Target.attachedToTarget') frames.push({ sessionId: m.params.sessionId, url: m.params.targetInfo.url });
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params as { requestId: string; request: { postData?: string } };
  let body: { path?: string; query?: Record<string, string> } = {};
  try { body = JSON.parse(request.postData ?? '{}'); } catch {}
  void (async () => {
    if (!raced && body.path === '/v1/document' && body.query?.capture) {
      raced = true;
      log.push(`held continuation cursor=${body.query.cursor} capture=${body.query.capture}`);
      // Real writes while the page is held: change the file, then re-capture through the companion.
      const out = execFileSync(process.execPath, ['--experimental-strip-types', 'tests/browser/seed-real.ts', root, sessionsFile, scriptFile], { encoding: 'utf8' });
      log.push(...out.trim().split('\n'));
      await send('Fetch.continueRequest', { requestId });
      log.push('released');
      done();
      return;
    }
    await send('Fetch.continueRequest', { requestId });
  })();
};

await send('Fetch.enable', { patterns: [{ urlPattern: '*service/request*', requestStage: 'Request' }] });
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const timeout = new Promise<void>((r) => setTimeout(r, Number(secondsArg ?? 60) * 1000));
await Promise.race([finished, timeout]);
let shown: unknown = null;
if (raced) {
  // The note must appear in the same frame document, before the next refresh replaces it.
  for (let i = 0; i < 40 && !shown; i++) {
    await new Promise((r) => setTimeout(r, 100));
    for (const f of frames.filter((x) => x.url.includes('/ui/page/') || x.url.includes('/ui/panel/'))) {
      const r = await send('Runtime.evaluate', { expression: "(()=>{const n=document.querySelector('[data-testid=document-historical]');return n?{note:n.textContent,text:document.querySelector('[data-testid=document-text]')?.textContent.split('\\n')[2]}:null})()", returnByValue: true }, f.sessionId).catch(() => null);
      if (r?.result?.value) { shown = r.result.value; break; }
    }
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
}
await send('Fetch.disable');
ws.close();
console.log(JSON.stringify({ raced, shown, log }, null, 2));
process.exitCode = raced && shown ? 0 : 1;
