/** Disposable native renderer observer; no installed profile or host resource is modified. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export async function startActivityHost(root: string, baseEnv: Record<string, string>, rootSessionID?: string, production = false) {
  const diagnostics: any = {};
  const app = '/tmp/opencode/agent-progress-t4-appimage/squashfs-root';
  const waylandSocket = baseEnv.ACTIVITY_WAYLAND_SOCKET;
  if (!waylandSocket || !path.isAbsolute(waylandSocket) || !fs.statSync(waylandSocket).isSocket()) return { available: false, reason: 'authorized-wayland-socket-unavailable', diagnostics, read: async (_lists = true) => [], stop: async () => {} };
  if (!fs.existsSync(`${app}/AppRun`)) return { available: false, reason: 'existing-host-unavailable', diagnostics, read: async (_lists = true) => [], stop: async () => {} };
  diagnostics.displayTransport = 'authorized-existing-wayland';
  const env = { ...baseEnv, APPDIR: app, WAYLAND_DISPLAY: waylandSocket, LANG: 'en_US.UTF-8', SHELL: '/bin/sh', OPENCODE_HOST: 'http://127.0.0.1:18767', OPENCODE_SKIP_START: 'true', OPENCODE_SERVER_PASSWORD: 'synthetic-local-only',
    OPENCODE_BINARY: process.env.OPENCODE_BINARY!,
    OPENCHAMBER_DATA_DIR: `${root}/openchamber`, OPENCHAMBER_DESKTOP_USER_DATA_DIR: `${root}/electron`, OPENCHAMBER_RELAY_HOST: 'off', DBUS_SESSION_BUS_ADDRESS: 'disabled:' };
  const host = spawn(`${app}/AppRun`, ['--no-sandbox', '--ozone-platform=wayland', '--password-store=basic', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=18768'], { env, cwd: `${root}/Alpha`, stdio: ['ignore', 'pipe', 'pipe'] });
  diagnostics.startupClasses = {};
  const classify = (chunk: Buffer) => {
    const text = chunk.toString();
    for (const [name, pattern] of Object.entries({ missingModule: /Cannot find module|ERR_MODULE_NOT_FOUND/, missingBinary: /OpenCode.*not found|opencode.*ENOENT/i, refusedConnection: /ECONNREFUSED/, unauthorized: /\b401\b/, displayFailure: /Missing X server|cannot open display/i, nativeFailure: /FATAL|segmentation fault/i, backendStarted: /server.*(?:listening|started)|listening.*127\.0\.0\.1/i })) {
      if (pattern.test(text)) diagnostics.startupClasses[name] = (diagnostics.startupClasses[name] ?? 0) + 1;
    }
    for (const phase of ['electron.server.start', 'electron.server.ready', 'electron.navigation.start', 'electron.navigation.ready', 'electron.renderer.dom-ready', 'electron.renderer.loaded']) {
      if (text.includes(phase)) { diagnostics.startupPhases = diagnostics.startupPhases ?? []; if (!diagnostics.startupPhases.includes(phase)) diagnostics.startupPhases.push(phase); }
    }
  };
  host.stdout.on('data', classify); host.stderr.on('data', classify);
  const wait = async (condition: () => Promise<boolean>, ms = 25000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await condition()) return true; await new Promise(r => setTimeout(r, 50)); }
    return false;
  };
  let socket: WebSocket | undefined;
  const frames: string[] = [];
  let next = 1;
  const pending = new Map<number, (value: any) => void>();
  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
    const id = next++;
    const timeout = setTimeout(() => { pending.delete(id); diagnostics.protocolDeadlines = (diagnostics.protocolDeadlines ?? 0) + 1; reject(new Error('CDP deadline')); }, 5000);
    pending.set(id, m => {
      clearTimeout(timeout);
      if (m.error) {
        const text = m.error.message ?? '';
        diagnostics.lastProtocolError = text.includes('default execution context') ? 'default-context-unavailable' : text.includes('Session') || text.includes('Target') ? 'target-or-session-unavailable' : 'other-cdp-error';
        reject(new Error('CDP request failed'));
      } else resolve(m.result);
    });
    socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (expression: string, sessionId?: string) => {
    const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (value.exceptionDetails) {
      const text = value.exceptionDetails.exception?.description ?? '';
      diagnostics.lastEvaluation = { exception: true, bodyMissing: /null.*(?:textContent|querySelector)|(?:textContent|querySelector).*null/.test(text), referenceError: text.startsWith('ReferenceError') };
      throw new Error('CDP evaluation failed');
    }
    return value.result?.value;
  };
  let connectedTarget: string | undefined;
  const attachPage = async (target: any) => {
    if (connectedTarget === target.id && socket?.readyState === WebSocket.OPEN) return;
    socket?.close(); frames.length = 0;
    diagnostics.pageAttachments = (diagnostics.pageAttachments ?? 0) + 1;
    const connected = new WebSocket(target.webSocketDebuggerUrl);
    socket = connected;
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('CDP connection deadline')), 2000); connected.onopen = () => { clearTimeout(timer); resolve(); }; connected.onerror = () => { clearTimeout(timer); reject(new Error('CDP unavailable')); }; });
    connectedTarget = target.id;
    connected.onmessage = e => {
      if (socket !== connected) return;
      const m = JSON.parse(String(e.data));
      if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
      else if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') frames.push(m.params.sessionId);
      else if (m.method === 'Target.detachedFromTarget') { const i = frames.indexOf(m.params.sessionId); if (i >= 0) frames.splice(i, 1); }
      else if (m.method === 'Network.loadingFailed') {
        diagnostics.failedLoads = diagnostics.failedLoads ?? {};
        const kind = ['net::ERR_FAILED', 'net::ERR_FILE_NOT_FOUND', 'net::ERR_CONNECTION_REFUSED', 'net::ERR_ABORTED'].includes(m.params.errorText) ? m.params.errorText : 'other-network-failure';
        diagnostics.failedLoads[kind] = (diagnostics.failedLoads[kind] ?? 0) + 1;
      }
      else if (m.method === 'Runtime.exceptionThrown') {
        diagnostics.rendererExceptions = (diagnostics.rendererExceptions ?? 0) + 1;
      }
      else if (m.method === 'Runtime.executionContextCreated') diagnostics.contextsCreated = (diagnostics.contextsCreated ?? 0) + 1;
      else if (m.method === 'Runtime.executionContextsCleared') diagnostics.contextsCleared = (diagnostics.contextsCleared ?? 0) + 1;
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false });
  };
  const applicationReady = async () => {
    try {
      const targets: any = await (await fetch('http://127.0.0.1:18768/json/list', { signal: AbortSignal.timeout(1000) })).json();
      const pages = targets.filter((t: any) => t.type === 'page' && t.url.startsWith('openchamber-ui://'));
      diagnostics.currentMainPages = pages.length;
      for (const page of pages) {
        await attachPage(page);
        if (await evaluate(`Boolean(document.body && typeof window.__OPENCHAMBER_API_BASE_URL__==='string')`).catch(() => false)) return true;
      }
    } catch {}
    return false;
  };
  const stop = async () => {
    socket?.close();
    for (const process of [host]) {
      if (process.exitCode === null && !process.signalCode) {
        process.kill('SIGTERM');
        await wait(async () => process.exitCode !== null || process.signalCode !== null, 5000);
        if (process.exitCode === null && !process.signalCode) process.kill('SIGKILL');
      }
    }
  };
  try {
    let target: any;
    if (!await wait(async () => {
      if (host.exitCode !== null) return false;
      try {
        const targets: any = await (await fetch('http://127.0.0.1:18768/json/list')).json();
        diagnostics.targets = targets.map((t: any) => ({ type: t.type === 'page' ? 'page' : 'other', mainScheme: t.url.startsWith('openchamber-ui://'), blank: t.url === 'about:blank' }));
        target = targets.find((t: any) => t.type === 'page' && t.url.startsWith('openchamber-ui://'));
        return Boolean(target);
      } catch { return false; }
    }, 45000)) throw new Error('native-renderer-startup');
    await attachPage(target);
    diagnostics.applicationReady = await wait(applicationReady, 12000);
    if (!diagnostics.applicationReady) {
      // A single reload belongs only to this disposable renderer, matching the
      // native context QA's document-start observer/reload precedent.
      await send('Page.reload', { ignoreCache: true }); diagnostics.disposablePageReloaded = true;
      diagnostics.applicationReady = await wait(applicationReady, 30000);
    }
    diagnostics.mainPage = await evaluate(`({mainScheme:location.protocol==='openchamber-ui:',ready:document.readyState,hasRuntimeBase:typeof window.__OPENCHAMBER_API_BASE_URL__==='string'})`).catch(() => ({ classification: 'context-unavailable' }));
    if (!diagnostics.applicationReady) {
      diagnostics.document = await evaluate(`({bodyPresent:Boolean(document.body),rootPresent:Boolean(document.querySelector('#root')),appDocument:location.pathname.endsWith('/index.html'),bootOutcomePresent:typeof window.__OPENCHAMBER_DESKTOP_BOOT_OUTCOME__!=='undefined'})`).catch(() => ({ classification: 'document-unavailable' }));
      throw new Error('native-application-not-ready');
    }
    diagnostics.catalog = await evaluate(`(async()=>{try{const base=window.__OPENCHAMBER_API_BASE_URL__;const url=new URL('/api/guests',base);if(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')return {blocked:'non-loopback'};const headers={...window.__OPENCHAMBER_RUNTIME_HEADERS__};if(window.__OPENCHAMBER_CLIENT_TOKEN__)headers.Authorization='Bearer '+window.__OPENCHAMBER_CLIENT_TOKEN__;const r=await fetch(url,{headers,credentials:'include'});const j=await r.json();const g=j.guests?.find(g=>g.id==='activity-probe');return {status:r.status,count:j.guests?.length??0,fixture:g?{present:true,enabled:g.enabled,entry:g.entry==='index.html',requested:g.capabilities?.requested,granted:g.capabilities?.granted}:null}}catch{return {classification:'catalog-request-failed'}}})()`);
    // The native rail is absent without an effective directory. Select the real
    // synthetic session through its own sidebar row, as native context QA does.
    if (rootSessionID) diagnostics.rootSelected = await wait(async () => {
      const rect = await evaluate(`(()=>{const row=document.querySelector('[data-session-row='+CSS.escape(${JSON.stringify(rootSessionID)})+']');const b=row?.querySelector('[data-session-row-main]')??row;if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+Math.min(40,r.width/2),y:r.y+r.height/2}})()`).catch(() => null);
      if (!rect) return false;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect }); return true;
    });
    // Open the genuine host's fixture rail button; never inject SDK/workspace state.
    const click = await wait(async () => {
      const rect = await evaluate(`(()=>{const b=${production ? `document.querySelector('[data-context-surface="plugin:activity-probe"]')` : `[...document.querySelectorAll('button')].find(b=>[b.title,b.getAttribute('aria-label')].some(v=>v&&v.includes('Activity probe')))`};if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`).catch(() => null);
      if (!rect) return false;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect }); return true;
    }, 35000);
    if (!click) {
      diagnostics.ui = await evaluate(`({sessionRows:document.querySelectorAll('[data-session-row]').length,contextSurfaces:document.querySelectorAll('[data-context-surface]').length,fixtureSurface:Boolean(document.querySelector('[data-context-surface="plugin:activity-probe"]')),fixtureText:document.body.textContent.includes('Activity probe'),welcome:document.body.textContent.includes('Welcome')})`).catch(() => ({ classification: 'ui-unavailable' }));
      throw new Error('fixture-rail-not-discovered');
    }
    let frame: string | undefined;
    if (!await wait(async () => {
      for (const f of frames) if (await evaluate(production ? `Boolean(document.querySelector('main'))` : `Boolean(document.querySelector('[data-activity-probe]'))`, f).catch(() => false)) { frame = f; return true; }
      return false;
    })) throw new Error('fixture-guest-not-mounted');
    const collected: any[] = [];
    const seen = new Set<string>();
    return { available: true, reason: 'native-guest-mounted', diagnostics,
      controls: { evaluate, send, frames, wait },
      read: async (lists = true) => {
        for (const f of frames) {
          const ready = await evaluate(`Boolean(window.__activityProbe)`, f).catch(() => false);
          if (!ready) continue;
          frame = f;
          if (lists) await evaluate(`window.__activityProbe.read()`, frame);
          const observations = await evaluate(`window.__activityProbe.observations`, frame);
          for (const e of observations) { const key = f + ':' + e.sequence; if (!seen.has(key)) { seen.add(key); collected.push(e); } }
        }
        return collected;
      }, stop };
  } catch (error) {
    const reason = error instanceof Error && ['native-renderer-startup', 'native-application-not-ready', 'fixture-rail-not-discovered', 'fixture-guest-not-mounted'].includes(error.message) ? error.message : 'native-host-observer-failed';
    diagnostics.hostExitCode = host.exitCode;
    await stop(); return { available: false, reason, diagnostics, read: async (_lists = true) => [], stop };
  }
}
