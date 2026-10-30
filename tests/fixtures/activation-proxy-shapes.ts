/** Neutral replay of observed mutation metadata; never contacts a tracker. */
export function trackerShape(name: 'save_issue' | 'save_comment'): Record<string, any> {
  return name === 'save_issue' ? {
    id: 'SYN-100', uuid: '00000000-0000-4000-8000-000000000001', title: 'Synthetic issue',
    status: 'Synthetic pending', statusType: 'unstarted', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    priority: { value: 0, name: 'Synthetic priority' }, labels: [],
    completedAt: null, canceledAt: null, archivedAt: null, startedAt: null, dueDate: null,
    slaStartedAt: null, slaMediumRiskAt: null, slaHighRiskAt: null, slaBreachesAt: null,
    assignee: null, assigneeId: null, project: null, projectId: null, parent: null,
    team: 'Synthetic team', teamId: 'synthetic-team', url: 'https://example.invalid/synthetic',
    gitBranchName: 'synthetic-branch', createdBy: 'Synthetic author', createdById: 'synthetic-author',
  } : {
    id: '00000000-0000-4000-8000-000000000002', body: 'Synthetic comment', attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    parentId: null, resolvedAt: null, quotedText: null, author: { id: 'synthetic-author', name: 'Synthetic author' }, onBehalfOf: null,
  };
}
