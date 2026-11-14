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

export function backendTestCommands(files: string[]): string[][] {
  const fenced = (file: string) => fenceTests.has(file.split('/').at(-1)!);
  return [
    ['--experimental-strip-types', '--test', ...files.filter(file => !fenced(file))],
    ['--experimental-strip-types', '--test', '--test-concurrency=1', ...files.filter(fenced)],
  ];
}
