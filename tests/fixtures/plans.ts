import type { ProbePlan } from '../../shared/contract.ts';
export const FIXTURE_TIME = '2026-10-24T10:00:00.000Z';
export function plans(directory = '/fixture/Alpha'): ProbePlan[] {
  const common = {
    sessionId: 'M', project: 'Alpha' as const, directory, revision: 1,
    reportedAt: FIXTURE_TIME, lifecycle: 'active' as const,
    document: { state: 'captured-fixture' as const, text: '# Canonical fixture\n\nUnicode: Привет 🌱\n<script>never execute</script>\n![sentinel](https://invalid.example/no-fetch)\n', capturedAt: FIXTURE_TIME, currentFile: 'not-rechecked' as const },
  };
  return [
    { ...common, id: 'P1', title: 'Alpha implementation', items: [
      { id: 'G', title: 'Implementation', kind: 'group', status: 'pending' },
      { id: 'I1', title: 'Contract', kind: 'task', parentId: 'G', status: 'done' },
      { id: 'I2', title: 'Probe', kind: 'task', parentId: 'G', status: 'done' },
      { id: 'I3', title: 'Native child contribution', kind: 'task', status: 'working', assigneeSessionId: 'C1' },
      { id: 'I4', title: 'Integration', kind: 'task', status: 'pending' },
      { id: 'I5', title: 'Optional experiment', kind: 'task', status: 'skipped' },
    ], contributions: [{ reporterSessionId: 'M', attributedSessionId: 'C2', mode: 'parent-relay', itemId: 'I2' }] },
    { ...common, id: 'P2', title: 'Independent later objective', items: [{ id: 'P2-I1', title: 'Second objective', kind: 'task', status: 'pending' }], contributions: [] },
    { ...common, id: 'P3', sessionId: 'U', project: 'Beta', directory: '/fixture/Beta', title: 'Unrelated work', items: [], contributions: [] },
  ];
}
