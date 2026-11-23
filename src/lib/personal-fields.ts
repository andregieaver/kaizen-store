/**
 * Personal fields in a marketing email (email plan M2.6, the owner's decision M0.1 c): `{first_name|there}` in a subject, a preview, a
 * heading, words or a button becomes the reader's first name, or the fallback after the bar when there is none. Every field must carry a
 * fallback, so no email ever reads "Hi ,"; a field the store does not have is refused. The fields are the person's own, as they gave them:
 * the first word of their name, and the company they buy for. A customer's staff-only fields (D120) never go in an email. Pure.
 */

export const PERSONAL_FIELDS = ["first_name", "company"] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];

/** What a reader brings to their email: their name and the company they buy for, as they gave them; empty when not known. */
export type PersonalFacts = { name: string; company: string };

const TOKEN = /\{([a-z_]+)(?:\|([^{}]*))?\}/g;

export type TokenProblem = { kind: "no_fallback" | "unknown"; field: string };

/** What is wrong with a text's fields: one without a fallback after its bar, or one the store does not have. */
export function tokenProblems(text: string): TokenProblem[] {
  const out: TokenProblem[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const field = m[1];
    if (!(PERSONAL_FIELDS as readonly string[]).includes(field)) out.push({ kind: "unknown", field });
    else if (!m[2] || !m[2].trim()) out.push({ kind: "no_fallback", field });
  }
  return out;
}

function valueOf(field: PersonalField, facts: PersonalFacts | null): string {
  if (!facts) return "";
  if (field === "first_name") return facts.name.trim().split(/\s+/)[0] ?? "";
  return facts.company.trim();
}

/** A text with each field filled for the reader, or its fallback; without a reader (a test, the preview), every fallback: the worst case. */
export function personalize(text: string, facts: PersonalFacts | null): string {
  return text.replace(TOKEN, (whole, field: string, fallback: string | undefined) => {
    if (!(PERSONAL_FIELDS as readonly string[]).includes(field)) return whole;
    const value = valueOf(field as PersonalField, facts);
    return value || (fallback ?? "").trim();
  });
}

type Texts = { subject: string; preview: string; blocks: readonly { type: string }[] };

/** A columns block's cells (M4.1), whose heading, words and button's words take fields too. */
type Cell = { heading: string; text: string; buttonText: string };
const cellsOf = (b: { type: string }): Cell[] | null => (b.type === "columns" && "cells" in b && Array.isArray(b.cells) ? (b.cells as Cell[]) : null);
const textOf = (b: { type: string }): string | null => ("text" in b && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : null);

/** One language's words with every field filled (subject, preview, headings, words and buttons, in columns too); other blocks as they are. */
export function personalizeContent<T extends Texts>(content: T, facts: PersonalFacts | null): T {
  const fill = (text: string) => personalize(text, facts);
  return {
    ...content,
    subject: fill(content.subject),
    preview: fill(content.preview),
    blocks: content.blocks.map((b) => {
      const cells = cellsOf(b);
      if (cells) return { ...b, cells: cells.map((c) => ({ ...c, heading: fill(c.heading), text: fill(c.text), buttonText: fill(c.buttonText) })) };
      const text = textOf(b);
      return text === null ? b : { ...b, text: fill(text) };
    }),
  };
}

/** Every text of one language's words, for the checks: the subject, the preview, and each block's words (a column's each). */
export function contentTexts(content: Texts): string[] {
  return [
    content.subject,
    content.preview,
    ...content.blocks.flatMap((b) => {
      const cells = cellsOf(b);
      if (cells) return cells.flatMap((c) => [c.heading, c.text, c.buttonText]);
      const text = textOf(b);
      return text === null ? [] : [text];
    }),
  ];
}
