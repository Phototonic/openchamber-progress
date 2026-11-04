/** Serialize data for a JavaScript expression, including inside an HTML script element.
 * This is not for executable source or HTML attributes. Escaping the HTML delimiters
 * prevents a value from ending its enclosing script; separators remain portable JS.
 */
export function javascriptLiteral(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Value has no JSON representation');
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
