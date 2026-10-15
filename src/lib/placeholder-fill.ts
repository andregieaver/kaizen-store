/**
 * Filling named placeholders (`{name}`) in a text an owner or staff wrote: the one rule shared by saved replies (D216, `fillPlaceholders()` in
 * `support-replies.ts`) and email templates (D238, `fillTemplate()` in `email-template.ts`). Pure, no imports; values are plain text (the caller's
 * renderer escapes them).
 *
 * - A placeholder whose value is known becomes it; one whose value is not known (null, empty) is left out with the space before it, and a comma, full
 *   stop, semicolon or colon it leaves alone at the start of a line goes too ("Hi {customer_first_name}," becomes "Hi,").
 * - With `dropBareLines`, a line that held a placeholder left out and is left with nothing but punctuation goes ("{customer_first_name},").
 * - Anything else in braces stays as it was written (the checks of each caller refuse what they do not allow).
 */
export function fillNamed(
  text: string,
  values: Readonly<Record<string, string | null | undefined>>,
  options: { dropBareLines?: boolean } = {},
): string {
  const names = Object.keys(values).filter((n) => /^[a-z_]+$/.test(n));
  if (names.length === 0) return text;
  const GONE = "\u0000";
  const pattern = new RegExp(`([ \\t]*)\\{(${names.join("|")})\\}`, "g");
  const lines = text
    .replaceAll(GONE, "")
    .replace(pattern, (_, space: string, name: string) => {
      const value = values[name]?.trim();
      return value ? `${space}${value}` : GONE;
    })
    .split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (!line.includes(GONE)) {
      out.push(line);
      continue;
    }
    const left = line.replace(/^[ \t]*\u0000[ \t]*[,.;:]?[ \t]*/, "").replaceAll(GONE, "").replace(/[ \t]+$/, "");
    if (options.dropBareLines && /^[\s\p{P}]*$/u.test(left)) continue;
    out.push(left);
  }
  return out.join("\n");
}
