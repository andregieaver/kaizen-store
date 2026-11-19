/**
 * A date formatted without a zone (D796, D812), the detector both date scans share (`src/lib/dates.scan.test.ts` outside the admin,
 * `src/lib/admin-dates.scan.test.ts` in it): a `toLocaleDateString` or `toLocaleTimeString` call, and a `toLocaleString` or
 * `Intl.DateTimeFormat` one with date or time parts, none of them naming a `timeZone`. On the server such a date is UTC's (Vercel's clock),
 * in a client part the browser's, so a page and its hydration disagree. A number's `toLocaleString` (no date parts) is not one.
 */

const CALL = /(toLocaleDateString|toLocaleString|toLocaleTimeString|Intl\.DateTimeFormat)\(/g;
const DATE_PARTS = /dateStyle|timeStyle|\bday\b|\bmonth\b|\byear\b|weekday|\bhour\b|\bminute\b/;

/** The lines (from 1) of a text's date formatting calls that name no zone. */
export function zoneless(text: string): number[] {
  const lines: number[] = [];
  for (const m of text.matchAll(CALL)) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const args = text.slice(m.index + m[0].length, i - 1);
    const isDate = m[1] === "toLocaleDateString" || m[1] === "toLocaleTimeString" || DATE_PARTS.test(args);
    if (isDate && !/timeZone/.test(args)) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines;
}
