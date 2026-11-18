/**
 * Text carried by the latest message of an outgoing provider prompt. The
 * companion adds its request-only notes there (a text part on a user message,
 * the output of the last tool result on a tool message) and keeps its system
 * section fixed. Native observers use this to find those notes.
 */
export function latestMessageTexts(prompt: any[] | undefined): string[] {
  const message = prompt?.at(-1);
  if (!message) return [];
  const texts = (value: unknown): string[] => typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(part => typeof part?.text === 'string' ? [part.text] : []) : [];
  if (message.role === 'user') return texts(message.content);
  if (message.role !== 'tool' || !Array.isArray(message.content)) return [];
  const result = message.content.findLast((part: any) => part?.type === 'tool-result');
  return texts(result?.output?.value);
}
