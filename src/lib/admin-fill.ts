/**
 * A catalogue's text (D312, `src/lib/admin-messages/`) with its `{name}` placeholders filled; a name not given is left as it is written. Pure, so a client
 * part can use it without loading the catalogues.
 */
export function fillWords(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
