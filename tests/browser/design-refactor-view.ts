// Interactive QA-D companion to the existing search shell. No browser/profile is opened here.
import { startSearchShell } from './plan-task-search-shell.ts';
const arg = (name: string) => { const n = process.argv.indexOf(name); return n < 0 ? undefined : process.argv[n + 1]; };
const fx = await startSearchShell(process.argv.includes('--built-service'), false, 'design-refactor', false, false, { guestRoot: arg('--guest-root'), slice: arg('--design-slice') ?? 'primitives' });
console.log(`Synthetic design QA shell: http://127.0.0.1:${fx.port}/`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await fx.stop(); process.exit(0); });
