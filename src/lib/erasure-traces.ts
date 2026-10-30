/**
 * What a shopper's erasure blanks in the AI manager's conversations (PSI REG-03, `docs/dpia-ai.md` R6): its tools may have returned the
 * person's email address, phone number or name, and those copies would otherwise outlive the erasure until the conversations' own period.
 * Pure: the patterns, for Postgres's `regexp_replace(…, 'gi')`; the server reads the person's details and runs them.
 */

/** What the person's details are replaced with. */
export const ERASED = "[erased]";

/** A name on its own (one word) is too common to blank everywhere; a full name of at least this many letters is the person's. */
const NAME_MIN = 5;
/** A phone number is matched on its last digits, written with any spacing. */
const PHONE_DIGITS = 8;
const PHONE_MIN = 6;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The patterns that find the person in a text: each email, each full name (two words or more) and each phone number, whatever its spacing. */
export function tracePatterns(person: { emails: readonly (string | null)[]; names: readonly (string | null)[]; phones: readonly (string | null)[] }): string[] {
  const out = new Set<string>();
  for (const email of person.emails) {
    const e = (email ?? "").trim();
    if (e.includes("@")) out.add(escape(e));
  }
  for (const name of person.names) {
    const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.join(" ").length >= NAME_MIN) out.add(words.map(escape).join("\\s+"));
  }
  for (const phone of person.phones) {
    const digits = (phone ?? "").replace(/\D/g, "");
    if (digits.length >= PHONE_MIN) out.add(digits.slice(-PHONE_DIGITS).split("").join("[\\s.-]*"));
  }
  return [...out];
}

/** The same, applied in code (for the tests and anything in memory). */
export function blankTraces(text: string, patterns: readonly string[]): string {
  return patterns.reduce((now, pattern) => now.replace(new RegExp(pattern, "gi"), ERASED), text);
}
