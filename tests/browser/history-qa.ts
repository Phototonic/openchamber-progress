// Focused rendered History regression in the existing synthetic SDK shell.
// Usage: node --experimental-strip-types tests/browser/history-qa.ts --chromium <binary> --artifacts <dir>
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { HEALTH, P1, P1_ITEMS, envelope, planPage, plansPage } from './fixtures.ts';
import { internalCopy } from './interface-copy.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw Error('Pass --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });
let count = 263;
const offsets: number[] = [];
const fixture = await startLanguageFixture({ source: process.argv.includes('--source'), service: async r => {
  const plan = { ...P1, revision: count };
  let body: unknown;
  if (r.path === '/health') body = HEALTH;
  else if (r.path === '/v1/plans') body = plansPage([plan]);
  else if (r.path === '/v1/plan') body = planPage(plan, P1_ITEMS, []);
  else if (r.path === '/v1/history') {
    const offset = Number(r.query?.cursor ?? 0), limit = Number(r.query?.limit ?? 20);
    offsets.push(offset);
    body = envelope({ data: Array.from({ length: Math.min(limit, Math.max(0, count - offset)) }, (_, i) => ({
      revision: offset + i + 1, structuralRevision: 1, lifecycle: 'active', reportedAt: P1.reportedAt,
    })), nextCursor: offset + limit < count ? String(offset + limit) : null });
  } else return { status: 404, body: '{"error":"not-found"}' };
  return { status: 200, body: JSON.stringify(body) };
} });
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
const results: object[] = [];
try {
  browser = await launchChromium(chromiumPath(arg('--chromium')));
  const c = browser.page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = (code: string) => evaluate(`(()=>{const w=frame('page').contentWindow,d=w.document;${code}})()`);
  const wait = async (condition: string) => {
    assert.ok(await evaluate(`(async()=>{const end=performance.now()+10000;while(performance.now()<end){try{const w=frame('page').contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>requestAnimationFrame(r))}return false})()`), condition);
  };
  const click = async (selector: string) => {
    await guest(`d.querySelector(${js(selector)})?.scrollIntoView({block:'center'});return true`);
    await guest('return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))');
    const [x, y] = await guest(`const n=d.querySelector(${js(selector)});if(!n)throw Error('Missing control');const r=n.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${fixture.port}/` });
  await wait(`!!d.querySelector('[data-testid="plan-view-history"] button')`);
  // The shared host shell has no viewport tag; keep phone screenshots at their
  // actual CSS width rather than Chromium's zoomed-out legacy mobile viewport.
  await evaluate(`const meta=document.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';document.head.append(meta);true`);
  for (const [size, revisions, locale] of [[1100, 263, 'en'], [390, 3, 'en'], [390, 263, 'ru'], [390, 263, 'zh-CN']] as const) {
    count = revisions; offsets.length = 0;
    await c.send('Emulation.setDeviceMetricsOverride', { width: size, height: 900, deviceScaleFactor: 1, mobile: size === 390 });
    const url = await evaluate<string>(`qa.ctx.locale=${js(locale)};qa.show('page',${size});qa.reload('page');frame('page').src`);
    await wait(`w.location.href===${js(url)} && d.documentElement.lang===${js(locale)} && !!d.querySelector('[data-testid="plan-view-history"] button')`);
    await click('[data-testid="plan-view-history"] button');
    await wait(`d.querySelectorAll('.ap-history-row').length===${Math.min(revisions, 250)}`);
    const state = await guest(`const box=d.querySelector('[data-testid="history-P1"]');return {ids:[...box.querySelectorAll('.ap-history-row')].map(n=>n.dataset.testid),note:box.querySelector('.ap-note')?.textContent??null,text:box.textContent}`);
    assert.equal(state.ids[0], `revision-${revisions}`);
    assert.equal(state.ids.at(-1), `revision-${Math.max(1, revisions - 249)}`);
    assert.equal(state.note, revisions > 250 ? ({ en: 'Older updates are not shown.', ru: 'Более ранние обновления не показаны.', 'zh-CN': '未显示较早的更新。' }[locale]) : null);
    assert.deepEqual(internalCopy(state.text), []);
    assert.deepEqual(offsets, revisions > 250 ? [13, 63, 113, 163, 213] : [0]);
    assert.equal(await guest('return d.documentElement.scrollWidth>d.documentElement.clientWidth+1'), false);
    const name = `history-${revisions}-${locale}-${size}.png`;
    await guest(`d.querySelector('[data-testid="history-P1"]').scrollIntoView({block:'start'});return true`);
    const png = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(artifacts, name), Buffer.from(png.data, 'base64'));
    results.push({ revisions, locale, size, offsets: [...offsets], first: state.ids[0], last: state.ids.at(-1), note: state.note, screenshot: name });
  }
  assert.deepEqual(c.errors, []);
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ pass: true, browser: browser.version, source: process.argv.includes('--source'), results, consoleErrors: c.errors }, null, 2));
} finally { await browser?.stop(); await fixture.stop(); }
