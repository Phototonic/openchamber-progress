/** Comparison spelling only: the service remains authoritative for filesystem paths. */
export function directoryKey(value: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(value);
  const spelling = windows ? value[0].toUpperCase() + value.slice(1).replace(/\\/g, '/') : value;
  const trimmed = spelling.replace(/\/+$/, '');
  if (windows && /^[A-Za-z]:$/.test(trimmed)) return `${trimmed}/`;
  return trimmed || (spelling.startsWith('/') ? '/' : '');
}
