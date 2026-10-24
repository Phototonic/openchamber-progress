/** Bounded, controller-owned native/move/compaction scenarios. No discovery/IO at import. */
import { type Destination } from './auth-live.ts';
import { insist, LiveSafetyError } from './auth-source.ts';

export type Scenario = 'native-move' | 'compaction';
export interface Metrics {
  admissions: number; dispatches: number; toolSnapshots: number;
  httpStatuses: { kind: string; status: number }[];
  admissionKinds: Record<string, number>; dispatchKinds: Record<string, number>;
}
export interface SubtestResult {
  name: string; pass: boolean; failureCode: string | null; completedProgressCalls: number;
  counters: { admissions: number; dispatches: number; toolSnapshots: number };
  httpStatuses: Metrics['httpStatuses']; admissionKinds: Record<string, number>; dispatchKinds: Record<string, number>;
  destinationStage: string | null; sessionHadErrorPart: boolean | null; assistantToolCounts: Record<string, number> | null;
}
export async function runSubtests(input: {
  scenario: Scenario; destination: Destination; rootID: string; childID?: string;
  nativeDirectory: string; moveDirectory: string; rootDirectory: string;
  boundary: () => void; snapshot: () => Metrics; moveBinding: () => void;
  results: SubtestResult[];
}) {
  const d = input.destination;
  function difference(after: Record<string, number>, before: Record<string, number>) {
    return Object.fromEntries(Object.entries(after).map(([kind, n]) => [kind, n - (before[kind] ?? 0)]).filter(([, n]) => Number(n) > 0));
  }
  async function step(name: string, reserve: number, action: () => Promise<{ completedProgressCalls: number }>) {
    const before = input.snapshot(); let completed = 0; let failureCode: string | null = null;
    d.resetDiagnostics();
    try {
      input.boundary();
      insist(before.admissions + reserve <= 6 && before.dispatches + reserve <= 12, 'ledger');
      completed = (await action()).completedProgressCalls; input.boundary();
    } catch (e) { failureCode = e instanceof LiveSafetyError ? e.code : 'destination'; throw e; }
    finally {
      const after = input.snapshot();
      input.results.push({ name, pass: failureCode === null, failureCode, completedProgressCalls: completed,
        counters: { admissions: after.admissions - before.admissions, dispatches: after.dispatches - before.dispatches, toolSnapshots: after.toolSnapshots - before.toolSnapshots },
        httpStatuses: after.httpStatuses.slice(before.httpStatuses.length),
        admissionKinds: difference(after.admissionKinds, before.admissionKinds), dispatchKinds: difference(after.dispatchKinds, before.dispatchKinds),
        ...d.diagnostics(),
      });
    }
    return completed;
  }
  let completed = 0;
  if (input.scenario === 'native-move') {
    insist(input.childID, 'action');
    completed += await step('native-child', 3, () => d.reportSession(input.childID!, { agent: 'general', parentID: input.rootID, directory: input.nativeDirectory, inspect: true, operationId: 'm1-native-1', expectedRevision: 0 }));
    completed += await step('move-attribution', 3, async () => {
      await d.move(input.rootID, input.moveDirectory); input.moveBinding(); input.boundary();
      return d.reportSession(input.rootID, { agent: 'build', directory: input.moveDirectory, inspect: true, operationId: 'm1-move-1', expectedRevision: 1 });
    });
  } else {
    completed += await step('compaction-baseline', 2, () => d.reportSession(input.rootID, { agent: 'build', directory: input.rootDirectory, inspect: false, operationId: 'm1-baseline-1', expectedRevision: 0 }));
    await step('manual-compaction', 1, () => d.compact(input.rootID));
    completed += await step('compaction-resume', 3, () => d.reportSession(input.rootID, { agent: 'build', directory: input.rootDirectory, inspect: true, operationId: 'm1-compact-1', expectedRevision: 1 }));
  }
  return completed;
}
