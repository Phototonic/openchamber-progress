/** These HTTP/worker fixtures acquire real target-derived coordination ports.
 * Distinct synthetic targets can hash to the same port: run their files serially,
 * separately from the parallel suite. Within-file contention tests remain intact.
 * Add new fenced HTTP/worker fixtures here; never override the product's ports. */
const fenceTests = new Set([
  'corrupt-store-startup.test.ts',
  'managed-binding.test.ts',
  'managed-health.test.ts',
  'managed-migration.test.ts',
  'managed-request-worker.test.ts',
  'managed-step-http.test.ts',
  'production-service.test.ts',
  'service-lifecycle.test.ts',
  'setup-paths.test.ts',
  'setup-suggestions.test.ts',
  'windows-service.test.ts',
]);

/** Backend files that need an independent OpenCode binary and Linux isolation
 * tools. Portable CI and the local runners leave them out and say so. */
export const nativeOnlyTests = [
  'production-runtime.test.ts',
  'plugin-failure-runtime.test.ts',
  'progress-activation-runtime.test.ts',
  'subagent-activity-runtime.test.ts',
  'subagent-upgrade-runtime.test.ts',
];

/** Files that take Setup ports only when an environment variable opts in, mapped to
 * that variable. `plan-cleanup-service.test.ts` runs the checked-in built service,
 * whose readiness probe takes writer slots, when `CP_BUILT_SERVICE=1` (found with a
 * listen probe, bundled service included). Where the opt-in is set the file is
 * fenced; where it is not, the file takes no port and stays in the parallel group. */
export const fencedWhenSet: Record<string, string> = { 'plan-cleanup-service.test.ts': 'CP_BUILT_SERVICE' };

export function backendTestCommands(files: string[], environment: NodeJS.ProcessEnv = process.env): string[][] {
  const fenced = (file: string) => {
    const name = file.split('/').at(-1)!;
    return fenceTests.has(name) || (name in fencedWhenSet && environment[fencedWhenSet[name]] === '1');
  };
  return [
    ['--experimental-strip-types', '--test', ...files.filter(file => !fenced(file))],
    ['--experimental-strip-types', '--test', '--test-concurrency=1', ...files.filter(fenced)],
  ];
}
