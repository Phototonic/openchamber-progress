import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isMarkdownDocument, parseDocumentMarkdown, webDocumentUrl } from '../../ui/shared/document-markdown.ts';

test('only the final Markdown suffix selects formatted document reading', () => {
  for (const path of ['/fixture/plan.md', 'C:\\fixture\\plan.MD']) assert.equal(isMarkdownDocument(path), true);
  for (const path of [undefined, '/fixture/.md/plan', '/fixture/plan.md.txt', '/fixture/plan']) assert.equal(isMarkdownDocument(path), false);
});

test('block and inline tokens share a fresh budget for each document', () => {
  const headings = '# Task\n\n'.repeat(9_000);
  const inline = '**Ready** '.repeat(6_000);
  assert.ok(parseDocumentMarkdown(headings));
  assert.ok(parseDocumentMarkdown(inline));
  assert.equal(parseDocumentMarkdown(headings + inline), null);
  assert.equal(parseDocumentMarkdown('# Next document')?.[0].tag, 'h1');
});

test('a near-limit real guide still parses as formatted Markdown', () => {
  const bytes = readFileSync(new URL('../../docs/ui.md', import.meta.url)).subarray(0, 256 * 1024);
  assert.ok(bytes.length >= 200 * 1024);
  const text = new TextDecoder().decode(bytes, { stream: true });
  const tokens = parseDocumentMarkdown(text);
  assert.ok(tokens);
  assert.equal(tokens[0].type, 'heading_open');
  assert.ok(tokens.some(token => token.type === 'list_item_open'));
});

test('only explicit absolute web destinations are normalized for navigation', () => {
  assert.equal(webDocumentUrl('HTTP://example.invalid'), 'http://example.invalid/');
  assert.equal(webDocumentUrl('https://example.invalid/notes#next'), 'https://example.invalid/notes#next');
  for (const url of ['/notes', 'notes.md', '#next', '//example.invalid', 'https:notes', 'https:///notes', 'https://', 'https://[notes]', 'mailto:notes@example.invalid', 'file:///fixture/notes.md']) {
    assert.equal(webDocumentUrl(url), null, url);
  }
});

test('web destinations work in browsers without URL.parse', () => {
  const descriptor = Object.getOwnPropertyDescriptor(URL, 'parse');
  Reflect.deleteProperty(URL, 'parse');
  try {
    assert.equal(webDocumentUrl('https://example.invalid/notes'), 'https://example.invalid/notes');
    assert.equal(webDocumentUrl('https://[invalid'), null);
  } finally {
    if (descriptor) Object.defineProperty(URL, 'parse', descriptor);
  }
});

test('web destinations reject oversized and userinfo URLs', () => {
  const prefix = 'https://example.invalid/';
  const atLimit = prefix + 'x'.repeat(2048 - prefix.length);
  assert.equal(webDocumentUrl(atLimit), atLimit);
  assert.equal(webDocumentUrl(atLimit + 'x'), null);
  assert.equal(webDocumentUrl('https://example.invalid@other.invalid/'), null);
  assert.equal(webDocumentUrl('https://:pass@other.invalid/'), null);
});
