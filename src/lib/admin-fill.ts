/**
 * A catalogue's text (D312, `src/lib/admin-messages/`) with its `{name}` placeholders filled; a name not given is left as it is written. Pure, so a client
 * part can use it without loading the catalogues.
 */
export function fillWords(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** A count in words: `{ one, many }` chosen by `n` (one for 1, many otherwise, as English and Norwegian both count), with `{n}` filled in. */
export function countWords(n: number, words: { one: string; many: string }, values: Record<string, string | number> = {}): string {
  return fillWords(n === 1 ? words.one : words.many, { n, ...values });
}
