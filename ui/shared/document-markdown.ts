import MarkdownIt, { type Token } from 'markdown-it';
import type { InterfaceLanguage } from './i18n.ts';

const markdown = new MarkdownIt({ html: false, linkify: false });
// Keep destinations as data until the DOM renderer decides whether to offer navigation.
// This also lets images with disallowed sources contribute their alt text.
markdown.validateLink = () => true;
markdown.normalizeLink = url => url;

export const isMarkdownDocument = (path: string | undefined) => path?.slice(-3).toLowerCase() === '.md';

export function webDocumentUrl(destination: string): string | null {
  if (!/^https?:\/\/[^/\\?#]/i.test(destination) || /[\s\\\u0000-\u001f\u007f]/u.test(destination)) return null;
  const url = URL.parse(destination);
  return url?.hostname ? url.href : null;
}

const tags = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol', 'li', 'em', 'strong', 's',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
const checkLabels = {
  en: 'Checklist mark', ru: 'Отметка в документе', 'zh-CN': '清单标记',
};

function alternateText(tokens: Token[] | null): string {
  return tokens?.map(token => token.type === 'image' ? alternateText(token.children)
    : token.type === 'softbreak' || token.type === 'hardbreak' ? '\n'
      : token.type === 'text' || token.type === 'code_inline' ? token.content : '').join('') ?? '';
}

function linkNode(url: string, open: (url: string) => void) {
  const link = document.createElement('a');
  // The guest sandbox cannot open tabs; only explicit activation asks the host to navigate.
  link.setAttribute('role', 'link');
  link.tabIndex = 0;
  link.addEventListener('click', event => { if (event.isTrusted && event.button === 0) open(url); });
  link.addEventListener('keydown', event => {
    if (event.isTrusted && event.key === 'Enter' && !event.repeat) { event.preventDefault(); open(url); }
  });
  return link;
}

function appendTokens(root: HTMLElement, tokens: Token[], locale: InterfaceLanguage, open?: (url: string) => void, skip = 0) {
  const stack = [root];
  for (const [index, token] of tokens.entries()) {
    const parent = stack.at(-1)!;
    if (token.nesting === -1) { stack.pop(); continue; }
    if (token.nesting === 1) {
      const destination = token.type === 'link_open' && open ? webDocumentUrl(String(token.attrGet('href') ?? '')) : null;
      const node = destination && open ? linkNode(destination, open)
        : !token.hidden && tags.has(token.tag) ? document.createElement(token.tag) : null;
      if (node) {
        if (token.type === 'ordered_list_open') {
          const start = String(token.attrGet('start') ?? '');
          if (/^\d{1,9}$/.test(start)) node.setAttribute('start', start);
        }
        parent.append(node);
      }
      stack.push(node ?? parent);
      continue;
    }
    switch (token.type) {
      case 'inline': {
        const children = token.children ?? [];
        const marker = tokens[index - 2]?.type === 'list_item_open'
          && tokens[index - 1]?.type === 'paragraph_open'
          && /^\[([ xX])\][ \t]+/.exec(token.content);
        const first = children[0];
        if (marker && first?.type === 'text' && first.content.startsWith(marker[0])) {
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.disabled = true;
          check.checked = marker[1].toLowerCase() === 'x';
          check.setAttribute('aria-label', checkLabels[locale]);
          parent.closest('li')?.classList.add('ap-doc-task');
          parent.append(check);
          appendTokens(parent, children, locale, open, marker[0].length);
        } else appendTokens(parent, children, locale, open);
        break;
      }
      case 'text': parent.append(token.content.slice(index === 0 ? skip : 0)); break;
      case 'image': parent.append(alternateText(token.children)); break;
      case 'softbreak': parent.append('\n'); break;
      case 'hardbreak': parent.append(document.createElement('br')); break;
      case 'hr': parent.append(document.createElement('hr')); break;
      case 'code_inline':
      case 'fence':
      case 'code_block': {
        const code = document.createElement('code');
        code.textContent = token.content;
        if (token.type === 'code_inline') parent.append(code);
        else { const pre = document.createElement('pre'); pre.append(code); parent.append(pre); }
        break;
      }
    }
  }
}

export function renderDocumentMarkdown(root: HTMLElement, text: string, locale: InterfaceLanguage, open?: (url: string) => void) {
  appendTokens(root, markdown.parse(text, {}), locale, open);
}
