// Disposable source option for synthetic SDK/CDP fixture servers; no host/profile discovery.
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export type GuestSurface = 'panel' | 'status' | 'page';
const root = fileURLToPath(new URL('../../', import.meta.url));
/** Call before listening; serve read(pathname) for /ui/<surface>/{index.html,main.js}.
 * Pass source: process.argv.includes('--source'). Default retains current-bundle QA.
 * Always dispose in the fixture's finally / owned SIGTERM cleanup. Never overwrites tracked guests.
 */
export function createGuestAssets(options: { source?: boolean; surfaces?: readonly GuestSurface[] } = {}) {
  const surfaces = options.surfaces ?? ['panel', 'status', 'page'];
  let temporary: string | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  };
  try {
    if (options.source) {
      mkdirSync('/tmp/opencode', { recursive: true });
      temporary = mkdtempSync('/tmp/opencode/source-guests-');
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: join(temporary, 'home'), TMPDIR: temporary };
      mkdirSync(env.HOME!, { recursive: true, mode: 0o700 });
      env.XDG_RUNTIME_DIR = join(temporary, 'runtime');
      mkdirSync(env.XDG_RUNTIME_DIR, { mode: 0o700 });
      for (const key of ['CONFIG', 'CACHE', 'DATA', 'STATE']) {
        env[`XDG_${key}_HOME`] = join(temporary, key.toLowerCase());
        mkdirSync(env[`XDG_${key}_HOME`]!, { recursive: true, mode: 0o700 });
      }
      for (const surface of surfaces) {
        if (!['panel', 'status', 'page'].includes(surface)) throw new Error('Unknown guest surface');
        const result = spawnSync('bun', ['run', 'bundle:guest', `ui/${surface}/main.ts`, join(temporary, `${surface}.js`)], {
          cwd: root, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
        });
        if (result.error || result.status !== 0) throw new Error(`Source guest build failed (${surface}, exit ${result.status ?? 'unavailable'})`, { cause: result.error });
      }
    }
    return {
      source: options.source === true,
      read(pathname: string): Buffer | null {
        if (disposed) throw new Error('Guest assets disposed');
        const match = /^\/ui\/(panel|status|page)\/(index\.html|main\.js)$/.exec(pathname);
        if (!match || !surfaces.includes(match[1] as GuestSurface)) return null;
        return readFileSync(temporary && match[2] === 'main.js' ? join(temporary, `${match[1]}.js`) : join(root, 'ui', match[1], match[2]));
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
