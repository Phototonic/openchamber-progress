// Minimal CDP driver for the isolated OpenChamber desktop window (T2 probe only).
// Route per the desktop-shell skill: the page's own webSocketDebuggerUrl, real Input.* events.
// Usage: node --experimental-strip-types tests/browser/cdp.ts <port> <command> [...args]
//   targets | eval <expr> | frames | feval <urlPart> <expr> | shot <out.png> [x y w h] [--size WxH]
//   click <x> <y> | type <text> | key <Key> | console <seconds>
//   viewport <WxH> resizes an isolated browser window persistently for responsive interaction.
import { writeFileSync } from 'node:fs';

type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

const [portArg, command, ...args] = process.argv.slice(2);
const port = Number(portArg);
if (!Number.isInteger(port) || !command) throw new Error('usage: cdp.ts <port> <command> [...args]');

async function pageTarget() {
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { id: string; type: string; url: string; webSocketDebuggerUrl: string }[];
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('openchamber-ui://')) ?? list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  return { page, list };
}

async function connect(url: string) {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('cdp connect failed')); });
  let next = 1;
  const waiting = new Map<number, (m: Msg) => void>();
  const listeners: ((m: Msg) => void)[] = [];
  ws.onmessage = (event) => {
    const m = JSON.parse(String(event.data)) as Msg;
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); } else listeners.forEach((l) => l(m));
  };
  const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
    const id = next++;
    waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, on: (l: (m: Msg) => void) => listeners.push(l), close: () => ws.close() };
}

async function evaluate(cdp: Awaited<ReturnType<typeof connect>>, expression: string, sessionId?: string) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function attachFrames(cdp: Awaited<ReturnType<typeof connect>>) {
  const frames: { sessionId: string; url: string; type: string }[] = [];
  cdp.on((m) => { if (m.method === 'Target.attachedToTarget') frames.push({ sessionId: m.params.sessionId, url: m.params.targetInfo.url, type: m.params.targetInfo.type }); });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await new Promise((r) => setTimeout(r, 400));
  return frames;
}

// A frame is chosen by URL part, or by `surface:<panel|status|page>` for frames without a URL
// (relay runtime delivers guest documents as srcdoc). The latter matches the view's own root.
async function findFrame(cdp: Awaited<ReturnType<typeof connect>>, frames: Awaited<ReturnType<typeof attachFrames>>, part: string) {
  if (!part.startsWith('surface:')) return frames.find((f) => f.url.includes(part));
  for (const f of frames.filter((x) => x.type === 'iframe')) {
    const s = await evaluate(cdp, "document.querySelector('[data-surface]')?.dataset.surface ?? null", f.sessionId).catch(() => null);
    if (s === part.slice('surface:'.length)) return f;
  }
  return undefined;
}

/** Page coordinates of a frame's content box, via its owner element (works without a src). */
async function frameOffset(cdp: Awaited<ReturnType<typeof connect>>, sessionId: string) {
  const tree = await cdp.send('Page.getFrameTree', {}, sessionId);
  const owner = await cdp.send('DOM.getFrameOwner', { frameId: tree.frameTree.frame.id });
  const box = await cdp.send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId });
  return [box.model.content[0], box.model.content[1]] as [number, number];
}

const { page, list } = await pageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
try {
  if (command === 'targets') console.log(JSON.stringify(list.map(({ id, type, url }) => ({ id, type, url })), null, 2));
  else if (command === 'eval') console.log(JSON.stringify(await evaluate(cdp, args[0]), null, 2));
  else if (command === 'frames') console.log(JSON.stringify((await attachFrames(cdp)).map(({ url, type }) => ({ type, url: url.replace(/guest-files\/[^/]+/, 'guest-files/<grant>') })), null, 2));
  else if (command === 'feval') {
    const frame = await findFrame(cdp, await attachFrames(cdp), args[0]);
    if (!frame) throw new Error(`no frame matching ${args[0]}`);
    console.log(JSON.stringify(await evaluate(cdp, args[1], frame.sessionId), null, 2));
  } else if (command === 'shot') {
    const sizeIndex = args.indexOf('--size');
    if (sizeIndex >= 0) {
      const [width, height] = args[sizeIndex + 1].split('x').map(Number);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      args.splice(sizeIndex, 2);
    }
    const [out, x, y, w, h] = args;
    const clip = w ? { x: Number(x), y: Number(y), width: Number(w), height: Number(h), scale: 1 } : undefined;
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`wrote ${out}`);
  } else if (command === 'viewport') {
    const [width, height] = args[0].split('x').map(Number);
    const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: page.id });
    await cdp.send('Browser.setContentsSize', { windowId, width, height });
    console.log(JSON.stringify(await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({width:innerWidth,height:innerHeight}))))')));
  } else if (command === 'fclick' || command === 'fwait' || command === 'pclick') {
    // fclick <urlPart> <selector>: real mouse click on an element inside a guest frame.
    // fwait <urlPart> <expr> [ms]: poll a frame expression until truthy (bounded, no fixed sleep).
    // pclick <selector>: real mouse click on a host page element.
    const frames = command === 'pclick' ? [] : await attachFrames(cdp);
    const frame = command === 'pclick' ? undefined : await findFrame(cdp, frames, args[0]);
    if (command !== 'pclick' && !frame) throw new Error(`no frame matching ${args[0]}`);
    if (command === 'fwait') {
      const deadline = Date.now() + Number(args[2] ?? 8000);
      let value: unknown;
      while (Date.now() < deadline) {
        value = await evaluate(cdp, args[1], frame!.sessionId).catch(() => undefined);
        if (value) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      console.log(JSON.stringify({ ok: Boolean(value), value }));
      if (!value) process.exitCode = 1;
    } else {
      const selector = command === 'pclick' ? args[0] : args[1];
      const rectOf = `(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return [r.x+Math.min(r.width/2,24),r.y+r.height/2]})()`;
      const inner = await evaluate(cdp, rectOf, frame?.sessionId) as [number, number] | null;
      if (!inner) throw new Error(`no element ${selector}`);
      let [x, y] = inner;
      if (frame) {
        const part = JSON.stringify(args[0]);
        const offset = args[0].startsWith('surface:')
          ? await frameOffset(cdp, frame.sessionId)
          : await evaluate(cdp, `(()=>{const f=[...document.querySelectorAll('iframe')].find(i=>i.src.includes(${part}));const r=f.getBoundingClientRect();return [r.x,r.y]})()`) as [number, number];
        x += offset[0]; y += offset[1];
      }
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      console.log(`clicked ${selector} @${Math.round(x)},${Math.round(y)}`);
    }
  } else if (command === 'click') {
    const [x, y] = args.map(Number);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    console.log('clicked');
  } else if (command === 'type') await cdp.send('Input.insertText', { text: args[0] });
  else if (command === 'key') {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, End: 35, Home: 36, ' ': 32 };
    const times = Number(args[1] ?? 1);
    for (let i = 0; i < times; i++) for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: args[0], code: args[0], windowsVirtualKeyCode: codes[args[0]] ?? 0 });
  } else if (command === 'console') {
    const seen: string[] = [];
    const record = (where: string) => (m: Msg) => {
      if (m.method === 'Runtime.consoleAPICalled') seen.push(`${where} ${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ')}`);
      if (m.method === 'Runtime.exceptionThrown') seen.push(`${where} exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      if (m.method === 'Log.entryAdded') seen.push(`${where} log ${m.params.entry.level}: ${m.params.entry.text} ${(m.params.entry.url ?? '').split('?')[0]}`);
    };
    cdp.on((m) => record(m.sessionId ? 'frame' : 'page')(m));
    const frames = await attachFrames(cdp);
    await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    for (const f of frames) { await cdp.send('Runtime.enable', {}, f.sessionId).catch(() => {}); await cdp.send('Log.enable', {}, f.sessionId).catch(() => {}); }
    await new Promise((r) => setTimeout(r, Number(args[0] ?? 3) * 1000));
    console.log(JSON.stringify({ frames: frames.length, entries: seen.map((s) => s.replace(/guest-files\/[^/\s]+/g, 'guest-files/<grant>').replace(/token=[^&\s]+/g, 'token=<redacted>')) }, null, 2));
  } else throw new Error(`unknown command ${command}`);
} finally { cdp.close(); }
