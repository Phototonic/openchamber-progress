// QA9: intercept the guest's setup requests at the host page (CDP Fetch on the host's service proxy).
// - logs every guest service request: method + path (+ query keys), never bodies or tokens
// - optionally holds GET /v1/setup replies (late folder hints) until the control file releases them
// - optionally strips `suggestions` from setup replies (a service exposing no hints)
// - optionally strips or replaces `update` in setup reads (an older service, or malformed metadata)
// - optionally strips plan-detail `timing` or drops its entries for some task IDs (an older service, an
//   unprovable start), and replaces `/v1/extension-update` replies (status/body: older service, malformed)
//   — labelled QA seams; the real service reply is logged first
// Usage: node --experimental-strip-types tests/browser/setup-intercept.ts <cdp port> <control.json> <log.jsonl> <seconds>
//   control.json: { "holdSetup": boolean, "stripSuggestions": boolean, "stripUpdate": boolean, "replaceUpdate": unknown,
//                   "stripTiming": boolean, "dropTimingItems": string[], "extensionUpdate": { status?: number, body?: unknown } }
//   — re-read on every request.
import { appendFileSync, readFileSync } from 'node:fs';

const [portArg, controlFile, logFile, secondsArg] = process.argv.slice(2);
if (!logFile) throw new Error('usage: setup-intercept.ts <cdp port> <control.json> <log.jsonl> <seconds>');
type Control = { holdSetup?: boolean; stripSuggestions?: boolean; stripUpdate?: boolean; replaceUpdate?: unknown; stripTiming?: boolean; dropTimingItems?: string[]; extensionUpdate?: { status?: number; body?: unknown } };
const control = (): Control => { try { return JSON.parse(readFileSync(controlFile, 'utf8')) as Control; } catch { return {}; } };
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
  const isPlanRead = body.method === 'GET' && body.path === '/v1/plan';
  const isExtensionUpdate = body.method === 'GET' && body.path === '/v1/extension-update';
  void (async () => {
    if (responseStatusCode === undefined) { // request stage
      log({ stage: 'request', method: body.method, path: body.path, queryKeys: Object.keys(body.query ?? {}) });
      if (isSetupRead) {
        let held = false;
        while (control().holdSetup) { if (!held) { held = true; log({ stage: 'held', path: body.path }); } await sleep(100); }
        if (held) log({ stage: 'released', path: body.path });
      }
      await send('Fetch.continueRequest', { requestId, interceptResponse: isSetupRead || isPlanRead || isExtensionUpdate });
      return;
    }
    // response stage (setup, plan-detail and extension-update reads only)
    const r = await send('Fetch.getResponseBody', { requestId });
    const text = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
    let out = text;
    if (isPlanRead || isExtensionUpdate) {
      try {
        const envelope = JSON.parse(text) as { status: number; body: string };
        const c = control();
        if (isPlanRead) {
          const inner = JSON.parse(envelope.body);
          log({ stage: 'response', path: body.path, status: envelope.status, revision: inner.plan?.revision, timing: inner.timing ? Object.fromEntries(Object.entries(inner.timing.items ?? {}).map(([k, v]: [string, any]) => [k, v.kind])) : 'absent' });
          let changed = false;
          if (c.stripTiming && 'timing' in inner) { delete inner.timing; changed = true; log({ stage: 'stripped-timing', path: body.path }); }
          for (const id of c.dropTimingItems ?? []) if (inner.timing?.items?.[id]) { delete inner.timing.items[id]; changed = true; log({ stage: 'dropped-timing-item', id }); }
          if (changed) out = JSON.stringify({ ...envelope, body: JSON.stringify(inner) });
        } else {
          let inner: any = null;
          try { inner = JSON.parse(envelope.body); } catch {}
          log({ stage: 'response', path: body.path, status: envelope.status, state: inner?.state, candidate: inner?.candidateVersion ?? null, stale: inner?.stale, diagnostic: inner?.diagnostic });
          if (c.extensionUpdate) {
            out = JSON.stringify({ ...envelope, status: c.extensionUpdate.status ?? envelope.status, body: c.extensionUpdate.body === undefined ? envelope.body : JSON.stringify(c.extensionUpdate.body) });
            log({ stage: 'replaced-extension-update', status: c.extensionUpdate.status ?? envelope.status });
          }
        }
      } catch {}
      await send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders: m.params.responseHeaders ?? [], body: Buffer.from(out).toString('base64') });
      return;
    }
    let had = false;
    try {
      const envelope = JSON.parse(text) as { status: number; body: string };
      const inner = JSON.parse(envelope.body);
      had = 'suggestions' in inner;
      log({ stage: 'response', path: body.path, status: envelope.status, configured: inner.configured, suggestionStates: inner.suggestions ? Object.fromEntries(Object.entries(inner.suggestions).map(([k, v]: [string, any]) => [k, v ? v.state : null])) : 'absent', update: inner.update ? inner.update.state : 'absent', version: inner.version ?? null, activation: inner.activation });
      const c = control();
      let changed = false;
      if (c.stripSuggestions && had) { delete inner.suggestions; changed = true; log({ stage: 'stripped', path: body.path }); }
      if (c.stripUpdate && 'update' in inner) { delete inner.update; changed = true; log({ stage: 'stripped-update', path: body.path }); }
      if (c.replaceUpdate !== undefined) { inner.update = c.replaceUpdate; changed = true; log({ stage: 'replaced-update', path: body.path }); }
      if (changed) out = JSON.stringify({ ...envelope, body: JSON.stringify(inner) });
    } catch {}
    await send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders: m.params.responseHeaders ?? [], body: Buffer.from(out).toString('base64') });
  })().catch((e) => log({ stage: 'error', error: String(e).slice(0, 160) }));
};

await send('Fetch.enable', { patterns: [{ urlPattern: '*service/request*', requestStage: 'Request' }] });
await sleep(Number(secondsArg ?? 120) * 1000);
await send('Fetch.disable').catch(() => {});
ws.close();
