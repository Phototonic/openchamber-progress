// Isolated headless Chromium + CDP helpers for the phone-layout driver. Starts a fresh disposable
// profile under /tmp/opencode, never downloads a browser or discovers a personal profile/cache:
// the binary comes from --chromium or CHROMIUM_PATH. Stops only what it started.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type Cdp = { send: (method: string, params?: object) => Promise<any>; close: () => void; errors: string[] };

async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('CDP connect failed')); });
  let next = 1;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const errors: string[] = [];
  ws.onmessage = (event) => {
    const m = JSON.parse(String(event.data));
    const w = m.id && waiting.get(m.id);
    if (w) { waiting.delete(m.id); if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 300));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  return { errors, send: (method, params = {}) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }), close: () => ws.close() };
}

export function chromiumPath(arg?: string) {
  const path = arg ?? process.env.CHROMIUM_PATH;
  if (!path || !existsSync(path)) throw new Error('Pass --chromium <path> or CHROMIUM_PATH (this driver never discovers or downloads a browser).');
  return path;
}

export async function launchChromium(binary: string) {
  mkdirSync('/tmp/opencode', { recursive: true });
  const profile = mkdtempSync('/tmp/opencode/phone-layout-qa-');
  const chrome = spawn(binary, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore', detached: true });
  let page: Cdp | null = null;
  const stop = async () => {
    page?.close();
    try { process.kill(-chrome.pid!, 'SIGTERM'); } catch {}
    await new Promise((r) => { if (chrome.exitCode !== null) r(null); else { chrome.once('exit', r); setTimeout(() => { try { process.kill(-chrome.pid!, 'SIGKILL'); } catch {} r(null); }, 3000); } });
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    let devtools = '';
    for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
      const f = join(profile, 'DevToolsActivePort');
      if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0];
      else await new Promise((r) => setTimeout(r, 100));
    }
    if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
    const version = (await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json() as { Browser: string }).Browser;
    const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    page = await connect(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
    return { page, version, stop };
  } catch (error) { await stop(); throw error; }
}
