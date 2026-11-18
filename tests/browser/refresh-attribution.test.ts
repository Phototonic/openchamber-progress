import assert from 'node:assert/strict';
import test from 'node:test';
import { attributeRefreshes, type IssuedRequest } from './refresh-attribution.ts';

const plans = (frame: string, cursor?: string, needsYou?: string): IssuedRequest => ({ frame, path: '/v1/plans', query: { ...(cursor ? { cursor } : {}), ...(needsYou ? { needsYou } : {}) } });
const other = (frame: string, path: string): IssuedRequest => ({ frame, path, query: null });

test('requests belong to the refresh that issued them; only refreshes closed by a later first page are complete', () => {
  const { listStarts, complete } = attributeRefreshes([
    plans('page', undefined, '1'), plans('page', 'c1'), plans('page', 'c2'), other('page', '/v1/subagent-runs'),
    plans('page', undefined, '1'), plans('page', 'c1'), other('page', '/v1/needs-you'),
    plans('page', undefined, '1'), plans('page', 'c1'), // still sending when the window ends
  ]);
  assert.equal(listStarts.page, 3);
  assert.equal(complete.page.refreshes, 2);
  assert.deepEqual(complete.page.traffic, { '/v1/plans': 5, '/v1/subagent-runs': 1, '/v1/needs-you': 1 });
  assert.deepEqual(complete.page.inbox, { needsYouRoute: 1, plansFirstWindow: 2 });
  assert.deepEqual(complete.panel, { refreshes: 0, traffic: {}, inbox: { needsYouRoute: 0, plansFirstWindow: 0 } });
});

test('a read still in flight when the next refresh starts stays with its issuing refresh', () => {
  // Refresh 1 sends an inbox continuation, then refresh 2's first page goes out; the continuation's reply arrives after
  // refresh 2's first-page reply. Attribution follows the order of sending, so refresh 1 keeps it and refresh 2 has none.
  const { complete } = attributeRefreshes([
    plans('page'), other('page', '/v1/needs-you'), // issued by refresh 1 (its reply is slow)
    plans('page'), // refresh 2 starts and its reply lands first
    plans('page'), // refresh 3 closes refresh 2
  ]);
  assert.equal(complete.page.refreshes, 2);
  assert.equal(complete.page.traffic['/v1/needs-you'], 1);
  assert.deepEqual(attributeRefreshes([plans('page'), other('page', '/v1/needs-you'), plans('page')]).complete.page.traffic, { '/v1/plans': 1, '/v1/needs-you': 1 });
});

test('frames are attributed separately and requests before the first start are ignored', () => {
  const { listStarts, complete } = attributeRefreshes([
    other('page', '/v1/needs-you'), plans('page'), plans('panel'), other('panel', '/v1/needs-you'), plans('page'), plans('panel'),
  ]);
  assert.deepEqual(listStarts, { page: 2, panel: 2 });
  assert.equal(complete.page.traffic['/v1/needs-you'], undefined);
  assert.equal(complete.panel.traffic['/v1/needs-you'], 1);
});
