// QA9: intercept the guest's setup requests at the host page (CDP Fetch on the host's service proxy).
// - logs every guest service request: method + path (+ query keys), never bodies or tokens
// - optionally holds GET /v1/setup replies (late folder hints) until the control file releases them
// - optionally strips `suggestions` from setup replies (a service exposing no hints)
// Usage: node --experimental-strip-types tests/browser/setup-intercept.ts <cdp port> <control.json> <log.jsonl> <seconds>
//   control.json: { "holdSetup": boolean, "stripSuggestions": boolean } — re-read on every request.
import { appendFileSync, readFileSync } from 'node:fs';

const [portArg, controlFile, logFile, secondsArg] = process.argv.slice(2);
if (!logFile) throw new Error('usage: setup-intercept.ts <cdp port> <control.json> <log.jsonl> <seconds>');
const control = () => { try { return JSON.parse(readFileSync(controlFile, 'utf8')) as { holdSetup?: boolean; stripSuggestions?: boolean }; } catch { return {}; } };
const list = (await (await fetch(`http://127.0.0.1:${portArg}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const page = list.find((t) => t.type === 'page' && t.url.startsWith('openchamber-ui://')) ?? list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('cdp connect failed')); });
let next = 1;
const waiting = new Map<number, (m: any) => void>();
const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
  const id = next++;
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (entry: object) => appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), ...entry })}\n`);

ws.onmessage = (event) => {
  const m = JSON.parse(String(event.data));
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); return; }
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request, responseStatusCode } = m.params;
  let body: { method?: string; path?: string; query?: Record<string, string> } = {};
  try { body = JSON.parse(request.postData ?? '{}'); } catch {}
  const isSetupRead = body.method === 'GET' && body.path === '/v1/setup';
  void (async () => {
    if (responseStatusCode === undefined) { // request stage
      log({ stage: 'request', method: body.method, path: body.path, queryKeys: Object.keys(body.query ?? {}) });
      if (isSetupRead) {
        let held = false;
        while (control().holdSetup) { if (!held) { held = true; log({ stage: 'held', path: body.path }); } await sleep(100); }
        if (held) log({ stage: 'released', path: body.path });
      }
      await send('Fetch.continueRequest', { requestId, interceptResponse: isSetupRead });
      return;
    }
    // response stage (setup reads only)
    const r = await send('Fetch.getResponseBody', { requestId });
    const text = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
    let out = text;
    let had = false;
    try {
      const envelope = JSON.parse(text) as { status: number; body: string };
      const inner = JSON.parse(envelope.body);
      had = 'suggestions' in inner;
      log({ stage: 'response', path: body.path, status: envelope.status, configured: inner.configured, suggestionStates: inner.suggestions ? Object.fromEntries(Object.entries(inner.suggestions).map(([k, v]: [string, any]) => [k, v ? v.state : null])) : 'absent' });
      if (control().stripSuggestions && had) { delete inner.suggestions; out = JSON.stringify({ ...envelope, body: JSON.stringify(inner) }); log({ stage: 'stripped', path: body.path }); }
    } catch {}
    await send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders: m.params.responseHeaders ?? [], body: Buffer.from(out).toString('base64') });
  })().catch((e) => log({ stage: 'error', error: String(e).slice(0, 160) }));
};

await send('Fetch.enable', { patterns: [{ urlPattern: '*service/request*', requestStage: 'Request' }] });
await sleep(Number(secondsArg ?? 120) * 1000);
await send('Fetch.disable').catch(() => {});
ws.close();
