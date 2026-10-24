import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RELEASE } from '../shared/release.ts';

// Backend only. Designer owns every guest entry and guest bundle.
for (const [entry, outfile] of [['service/main.ts', 'build/service/main.js'], ['plugin/index.ts', 'build/companion/index.js'], ['setup/cli.ts','build/setup/main.js']]) {
  await mkdir(resolve(outfile, '..'), { recursive: true });
  const result = await Bun.build({ entrypoints: [entry], target: 'node', format: 'esm', write: false });
  if (!result.success) throw new Error(result.logs.map(x => x.message).join('\n'));
  await writeFile(outfile, await result.outputs[0].text());
}
await copyFile('plugin/SKILL.md', 'build/companion/SKILL.md');
await writeFile('build/companion/package.json', JSON.stringify({ name: 'openchamber-agent-progress-companion', version: RELEASE, type: 'module', exports: { '.': './index.js' } }, null, 2));
