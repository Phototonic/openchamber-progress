/** Metadata-only guest loaded directly in a disposable native host fixture. */
import { connectHost, type GuestSessionsSnapshot } from '@openchamber/sdk';

const host = connectHost();
const observations: any[] = [];
let sequence = 0;
const record = (value: object) => { observations.push({ sequence: ++sequence, at: performance.now(), ...value }); if (observations.length > 1000) observations.shift(); };
const previous = new Map<string, Map<string, string>>();
const snapshots = (method: string, snapshot: GuestSessionsSnapshot) => {
  const key = `${method}:${snapshot.projectId}`;
  const before = previous.get(key) ?? new Map();
  const next = new Map(snapshot.sessions.map(s => [s.id, JSON.stringify([s.activity, s.outcome])]));
  const changedActivityIDs = snapshot.sessions.filter(s => before.get(s.id) !== next.get(s.id)).map(s => s.id);
  previous.set(key, next);
  record({ type: 'workspace', method, state: snapshot.state, changedActivityIDs,
  coverage: snapshot.coverage.map(c => ({ directory: c.directory, state: c.state })), projectId: snapshot.projectId,
  sessions: snapshot.sessions.map(s => ({ id: s.id, parentId: s.parentId, directory: s.directory, activity: s.activity, outcome: s.outcome })) });
};
const subscriptions = new Map<string, () => void>();
(window as any).__activityProbe = { observations, read: async () => {
  const projects = await host.listProjects();
  for (const p of projects.projects) if (p.directory.endsWith('/Alpha') || p.directory.endsWith('/Beta')) snapshots('listSessions', await host.listSessions(p.id));
} };
host.onReady(context => record({ type: 'selected-context', sessionID: context.session?.id ?? null, parentFieldPresent: Boolean(context.session && 'parentId' in context.session) }));
void host.onProjects(async snapshot => {
  record({ type: 'projects', state: snapshot.state, count: snapshot.projects.length });
  for (const project of snapshot.projects) {
    if (!(project.directory.endsWith('/Alpha') || project.directory.endsWith('/Beta')) || subscriptions.has(project.id)) continue;
    subscriptions.set(project.id, () => {});
    try {
      const stop = await host.onSessions(project.id, s => snapshots('onSessions', s));
      subscriptions.set(project.id, stop);
      snapshots('listSessions', await host.listSessions(project.id));
    } catch { record({ type: 'workspace-error', method: 'subscribe-or-list' }); }
  }
});
document.body.dataset.activityProbe = 'ready';
