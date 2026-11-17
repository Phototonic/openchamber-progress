// Scan rendered extension-owned words, never source code or an agent's literal text.
// Advanced details, support summaries and Setup's disclosure are excluded by the caller.
export const INTERNAL_COPY = [
  /\bat least\b|не менее|至少/iu,
  /\b(?:sources?|stores?|revisions?|coverage|bindings?|capture[ds]?|reported|relayed|explicitly|contribut(?:ion|ions|es?)|companions?|observations?|heartbeats?|fingerprints?)\b/iu,
  /источник|хранилищ|ревизи|редакци|охват|привяз|компаньон|наблюдени|отпечаток|по отч[её]т|явно|сообщ[её]н/iu,
  /来源|存储|修订|覆盖|绑定|采集|报告为|明确报告|贡献|观察|指纹/u,
];

export function internalCopy(text: string, literals: readonly string[] = []) {
  text = text.replace(/\s+/gu, ' ');
  for (const literal of literals) if (literal) text = text.split(literal.replace(/\s+/gu, ' ')).join('');
  return INTERNAL_COPY.flatMap(pattern => text.match(pattern)?.[0] ?? []);
}
