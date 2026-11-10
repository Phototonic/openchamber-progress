import assert from 'node:assert/strict';

/** Accept stable releases at the tested floor within the same major line. */
export function requireRuntimeVersion(runtime: 'node' | 'opencode', detected: string): string {
  const floor = runtime === 'node' ? [24, 19, 0] : [2, 2, 2];
  const match = (runtime === 'node' ? /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/ : /^opencode v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/).exec(detected.trim());
  const parts = match?.slice(1).map(Number);
  assert.ok(parts && parts.every(Number.isSafeInteger), `${runtime}: malformed version; expected a stable major.minor.patch release`);
  const [major, minor, patch] = parts;
  assert.ok(major === floor[0] && (minor > floor[1] || minor === floor[1] && patch >= floor[2]), `${runtime}: requires >=${floor.join('.')} within major ${floor[0]}`);
  return parts.join('.');
}
