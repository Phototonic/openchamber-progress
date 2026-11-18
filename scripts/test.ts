/** Local portable test runner. Build the generated entries first: the package
 * scripts `test:all` and `test:fast` do. It never packages or starts a native
 * runtime, and it does not replace `scripts/ci.ts` for a pull request.
 *
 *   node --experimental-strip-types scripts/test.ts          every portable group
 *   node --experimental-strip-types scripts/test.ts --fast   the same without the serial Setup-port group */
import { mkdirSync } from 'node:fs';
import { nativeOnlyTests } from './ci-backend.ts';
import { runLanes } from './test-lanes.ts';
import { portableLanes } from './test-plan.ts';

const fast = process.argv.includes('--fast');
mkdirSync('/tmp/opencode', { recursive: true });
console.log(`Native-only tests NOT RUN: ${nativeOnlyTests.join(', ')}`);
if (fast) console.log('Fast loop: the serial Setup-port backend group is skipped. Run `bun run test:all` or CI before a pull request.');
const started = performance.now();
try {
  await runLanes(portableLanes({ fenced: !fast }));
  console.log(`\nAll portable groups passed in ${((performance.now() - started) / 1000).toFixed(1)}s${fast ? ' (fast loop, not the full set)' : ''}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
