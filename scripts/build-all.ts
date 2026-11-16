/** The generated runtime projection. Keep its paths and build order together. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const outputs = [
  'build/service/main.js', 'build/setup/main.js', 'build/companion/index.js',
  'build/companion/package.json', 'build/companion/SKILL.md', 'background/main.js',
  'ui/panel/main.js', 'ui/status/main.js', 'ui/page/main.js',
];
export function buildAll(cwd = process.cwd()) {
  const commands = [
    ['run', 'build:backend'],
    ...['background', 'ui/panel', 'ui/status', 'ui/page'].map(dir =>
      ['run', 'bundle:guest', `${dir}/main.ts`, `${dir}/main.js`]),
  ];
  for (const args of commands) {
    const result = spawnSync('bun', args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Runtime build failed: bun ${args.join(' ')}`);
  }
}
export const outputHashes = (cwd = process.cwd()) => outputs.map(file =>
  createHash('sha256').update(readFileSync(`${cwd}/${file}`)).digest('hex'));
export function compareOutputs(before: string[], cwd = process.cwd()) {
  const after = outputHashes(cwd);
  const changed = outputs.filter((_, i) => before[i] !== after[i]);
  if (changed.length) throw new Error(`Generated entry parity failed: ${changed.join(', ')}`);
  console.log('Generated entry rebuild comparison passed (nine outputs).');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildAll();
