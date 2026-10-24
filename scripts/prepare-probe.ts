import { mkdir, writeFile, copyFile, cp, lstat } from 'node:fs/promises';
import path from 'node:path';

// Explicit fixture setup only. Never discovers or touches actual user config.
const root = path.resolve(process.argv[2] ?? '');
if (!/^\/tmp\/opencode\/agent-progress-probe-[a-zA-Z0-9-]+$/.test(root)) throw new Error('pass a fresh /tmp/opencode/agent-progress-probe-<id> root');
// Refuse an existing root, including a symlink; reruns need a new ID.
if (await lstat(root).catch(() => null)) throw new Error('probe-root-already-exists');
await mkdir(root, { mode: 0o700 });
for (const dir of ['home', 'config/opencode', 'data', 'cache', 'state', 'projects/Alpha', 'projects/Alpha-worktree', 'projects/Beta', 'extension/build/service']) await mkdir(path.join(root, dir), { recursive: true, mode: 0o700 });
const descriptor = { probeOnly: true, database: path.join(root, 'data/progress.sqlite'), dataHome: path.join(root, 'data'), configHome: path.join(root, 'config') };
await writeFile(path.join(root, 'binding.json'), JSON.stringify(descriptor), { mode: 0o600 });
await writeFile(path.join(root, 'extension/build/service/probe-binding.json'), JSON.stringify(descriptor), { mode: 0o600 });
await copyFile('build/service/main.js', path.join(root, 'extension/build/service/main.js'));
const manifest = JSON.parse(await Bun.file('package.json').text());
await writeFile(path.join(root, 'extension/package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, type: 'module', openchamber: manifest.openchamber }, null, 2));
// Designer-authored files only; no generated HTML or guest JS here.
if (await lstat('ui').catch(() => null)) await cp('ui', path.join(root, 'extension/ui'), { recursive: true });
console.log(JSON.stringify({ root, extension: path.join(root, 'extension'), descriptor: path.join(root, 'binding.json'), status: 'prepared-not-installed', guestEntriesMustExist: ['ui/panel/index.html', 'ui/status/index.html', 'ui/page/index.html'] }, null, 2));
