// One heap snapshot of the isolated host page, summarised in memory (nothing large is written):
// top constructors by count and self size, and how many live strings contain each marker.
// Use it to tell whether a host heap slope holds extension payloads. Snapshotting costs a few seconds
// of renderer CPU, so run it once per question, not per tick.
// Usage: node --max-old-space-size=4096 --experimental-strip-types tests/browser/heap-census.ts <cdp port> <marker> [marker ...]
const [portArg, ...markers] = process.argv.slice(2);
if (!portArg || !markers.length) throw new Error('usage: heap-census.ts <cdp port> <marker> [marker ...]');
const list = (await (await fetch(`http://127.0.0.1:${portArg}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const page = list.find((t) => t.type === 'page' && t.url.startsWith('openchamber-ui://')) ?? list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('cdp connect failed')); });
const chunks: string[] = [];
let id = 0;
const done = new Map<number, () => void>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(m.params.chunk);
  else if (m.id && done.has(m.id)) { done.get(m.id)!(); done.delete(m.id); }
};
const send = (method: string, params = {}) => new Promise<void>((r) => { const i = ++id; done.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const t0 = Date.now();
await send('HeapProfiler.enable');
await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
ws.close();
const snap = JSON.parse(chunks.join(''));
chunks.length = 0;
const f = snap.snapshot.meta.node_fields as string[], types = snap.snapshot.meta.node_types[0] as string[];
const W = f.length, iType = f.indexOf('type'), iName = f.indexOf('name'), iSize = f.indexOf('self_size');
const nodes = snap.nodes as number[], strings = snap.strings as string[];
const byCtor = new Map<string, { n: number; size: number }>();
const marks = Object.fromEntries(markers.map((k) => [k, { strings: 0, bytes: 0 }]));
let total = 0;
for (let i = 0; i < nodes.length; i += W) {
  const type = types[nodes[i + iType]], name = strings[nodes[i + iName]], size = nodes[i + iSize];
  total += size;
  const key = type === 'object' || type === 'closure' ? `${type}:${name}` : type;
  const c = byCtor.get(key) ?? { n: 0, size: 0 }; c.n++; c.size += size; byCtor.set(key, c);
  if (type === 'string' || type === 'concatenated string' || type === 'sliced string') for (const k of markers) if (name.includes(k)) { marks[k].strings++; marks[k].bytes += size; }
}
const top = [...byCtor].sort((a, b) => b[1].size - a[1].size).slice(0, 15).map(([k, v]) => ({ k: k.slice(0, 60), n: v.n, kb: Math.round(v.size / 1024) }));
console.log(JSON.stringify({ ms: Date.now() - t0, nodes: nodes.length / W, totalMB: +(total / 1048576).toFixed(2), markers: marks, topBySize: top }));
