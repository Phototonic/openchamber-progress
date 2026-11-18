import assert from 'node:assert/strict';
import test from 'node:test';
import * as attribution from './refresh-attribution.ts';
import type { IssuedRequest, LoggedReply } from './refresh-attribution.ts';

const { attributeRefreshes } = attribution;
const plans = (frame: string, cursor?: string, needsYou?: string): IssuedRequest => ({ frame, path: '/v1/plans', query: { ...(cursor ? { cursor } : {}), ...(needsYou ? { needsYou } : {}) } });
const other = (frame: string, path: string): IssuedRequest => ({ frame, path, query: null });
const reply = (r: IssuedRequest): LoggedReply & Pick<IssuedRequest, 'query'> => ({ ...r, bytes: 100, status: 200, ms: 5 });
const empty = { traffic: {}, inbox: { needsYouRoute: 0, plansFirstWindow: 0 } };

test('requests belong to the refresh that issued them; only refreshes closed by a later first page are complete', () => {
  const { listStarts, complete } = attributeRefreshes([
    plans('page', undefined, '1'), plans('page', 'c1'), plans('page', 'c2'), other('page', '/v1/needs-you'),
    plans('page', undefined, '1'), plans('page', 'c1'), other('page', '/v1/needs-you'),
    plans('page', undefined, '1'), plans('page', 'c1'), // still sending when the window ends
  ]);
  assert.equal(listStarts.page, 3);
  assert.equal(complete.page.refreshes, 2);
  assert.deepEqual(complete.page.traffic, { '/v1/plans': 5, '/v1/needs-you': 2 });
  assert.deepEqual(complete.page.inbox, { needsYouRoute: 2, plansFirstWindow: 2 });
  assert.deepEqual(complete.panel, { refreshes: 0, ...empty });
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

test('run reads are counted once per window, whichever refresh preceded them, and stay out of the per-refresh figures', () => {
  const { listStarts, runReads, complete } = attributeRefreshes([
    other('page', '/v1/subagent-runs'), // sent inside the window before its first list start
    plans('page'), plans('page', 'c1'),
    plans('page'), // next refresh starts
    other('page', '/v1/subagent-runs'), // the reconciliation follow-up, sent after that first page
    plans('page', 'c1'),
    plans('page'), // closes the second refresh
    other('page', '/v1/subagent-runs'), // sent after the last list start, with the refresh still open
  ]);
  assert.equal(complete.page.refreshes, 2);
  assert.deepEqual(complete.page.traffic, { '/v1/plans': 4 });
  assert.equal(listStarts.page, 3);
  assert.equal(runReads.page, 3);
  assert.equal(runReads.panel, 0);
});

test('a health read sent before its refresh\'s first page is not added to the previous refresh', () => {
  const { complete } = attributeRefreshes([plans('page'), other('page', '/health'), plans('page'), other('page', '/health'), plans('page')]);
  assert.equal(complete.page.refreshes, 2);
  assert.deepEqual(complete.page.traffic, { '/v1/plans': 2 });
});

/** The driver's window summary: both logs are sliced between the offsets captured when the timer started and stopped. */
const window = (requests: IssuedRequest[], replies: (LoggedReply & Pick<IssuedRequest, 'query'>)[], start: [number, number], stop: [number, number]) =>
  attribution.summarizeWindow({ requests, replies }, { start: { requests: start[0], replies: start[1] }, stop: { requests: stop[0], replies: stop[1] } });

test('entries logged after the stop offset are ignored, and a first page logged after the stop closes no refresh', () => {
  const requests = [plans('page'), plans('page', 'c1'), plans('page'), other('page', '/v1/needs-you'), plans('page'), other('page', '/health')];
  const replies = requests.map(reply);
  // The timer stopped with four requests and three replies logged; two more requests and replies landed before the driver read the logs.
  const summary = window(requests, replies, [0, 0], [4, 3]);
  assert.equal(summary.listStarts.page, 2);
  assert.equal(summary.complete.page.refreshes, 1);
  assert.deepEqual(summary.complete.page.traffic, { '/v1/plans': 2 });
  assert.deepEqual(summary.sent, { 'page /v1/plans': 3, 'page /v1/needs-you': 1 });
  assert.deepEqual(summary.traffic, { 'page /v1/plans': { count: 3, bytes: 300 } });
  assert.equal(summary.attribution, 'request-order');
});

test('entries logged before the start offset are not part of the window', () => {
  const requests = [plans('page'), other('page', '/v1/needs-you'), plans('page'), other('page', '/health')];
  const summary = window(requests, requests.map(reply), [2, 2], [4, 4]);
  assert.equal(summary.listStarts.page, 1);
  assert.deepEqual(summary.sent, { 'page /v1/plans': 1, 'page /health': 1 });
  assert.deepEqual(summary.inbox.page, { needsYouRoute: 0, plansFirstWindow: 0 });
});

test('a request counts by when it was sent, not when it was answered', () => {
  for (const route of ['/v1/needs-you', '/health']) {
    const first = plans('page'), sentBefore = other('page', route), sentInside = other('page', route);
    // Sent before the window, answered inside it: out of the request counts, though its reply is in the reply log slice.
    const early = window([sentBefore, first], [reply(sentBefore), reply(first)], [1, 0], [2, 2]);
    assert.equal(early.sent[`page ${route}`], undefined, `${route} sent before the window`);
    assert.equal(early.traffic[`page ${route}`]?.count, 1);
    // Sent inside the window, answered after it: in the request counts, and its reply is outside the reply bounds.
    const late = window([first, sentInside], [reply(first), reply(sentInside)], [0, 0], [2, 1]);
    assert.equal(late.sent[`page ${route}`], 1, `${route} sent inside the window`);
    assert.equal(late.traffic[`page ${route}`], undefined);
  }
});

test('attribution follows the order requests were sent, not the order replies arrived', () => {
  // Refresh 1 sends an inbox read; refresh 2 and refresh 3 start; the inbox reply arrives after the final first-page reply.
  const p1 = plans('page'), inbox = other('page', '/v1/needs-you'), p2 = plans('page'), p3 = plans('page');
  const requests = [p1, inbox, p2, p3];
  const replies = [reply(p1), reply(p2), reply(p3), reply(inbox)];
  const summary = window(requests, replies, [0, 0], [4, 4]);
  assert.equal(summary.complete.page.refreshes, 2);
  assert.deepEqual(summary.complete.page.traffic, { '/v1/plans': 2, '/v1/needs-you': 1 });
  assert.deepEqual(summary.complete.page.inbox, { needsYouRoute: 1, plansFirstWindow: 0 });
});

test('a standalone request after the final list start is in the window split and changes no complete-refresh figure', () => {
  const base = [plans('page', undefined, '1'), plans('page', 'c1'), plans('page', undefined, '1'), plans('page', 'c1'), plans('page', undefined, '1')];
  const without = window(base, base.map(reply), [0, 0], [base.length, base.length]);
  const late = [...base, other('page', '/v1/needs-you')];
  const withLate = window(late, late.map(reply), [0, 0], [late.length, late.length]);
  assert.deepEqual(without.inbox.page, { needsYouRoute: 0, plansFirstWindow: 3 });
  assert.deepEqual(withLate.inbox.page, { needsYouRoute: 1, plansFirstWindow: 3 });
  assert.deepEqual(withLate.complete, without.complete);
  assert.deepEqual(withLate.listStarts, without.listStarts);
});

test('a standalone request sent before the window and answered inside it is out of the split; one sent inside and answered after is in', () => {
  const early = other('page', '/v1/needs-you'), p1 = plans('page'), late = other('page', '/v1/needs-you');
  const summary = window([early, p1, late], [reply(p1), reply(early)], [1, 0], [3, 2]);
  assert.deepEqual(summary.inbox.page, { needsYouRoute: 1, plansFirstWindow: 0 });
  assert.equal(summary.sent['page /v1/needs-you'], 1);
});
