import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMarkdownDocument, webDocumentUrl } from '../../ui/shared/document-markdown.ts';

test('only the final Markdown suffix selects formatted document reading', () => {
  for (const path of ['/fixture/plan.md', 'C:\\fixture\\plan.MD']) assert.equal(isMarkdownDocument(path), true);
  for (const path of [undefined, '/fixture/.md/plan', '/fixture/plan.md.txt', '/fixture/plan']) assert.equal(isMarkdownDocument(path), false);
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
