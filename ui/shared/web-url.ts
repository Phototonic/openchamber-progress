/** Admit an absolute web destination without credentials or ambiguous path syntax. */
export function webDocumentUrl(destination: string): string | null {
  if (destination.length > 2048 || !/^https?:\/\/[^/\\?#]/i.test(destination) || /[\s\\\u0000-\u001f\u007f]/u.test(destination)) return null;
  try {
    const url = new URL(destination);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
