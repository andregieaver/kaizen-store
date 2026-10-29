/**
 * How long the AI manager's conversations are kept (wave 11 unit L, D391, `docs/dpia-ai.md` R6): their messages hold what the tools
 * returned, customers' names and emails among them, so they go after a period counted from the conversation's last message. The
 * platform's rule (`assistant_conversations`, 12 months) is the default and Kaizena Flow's own; a store's owner may choose fewer or more
 * months (`stores.assistant_keep_months`). Pure, so the form and the server read the same limits.
 */

/** The default period in months; `retention.test.ts` holds it equal to the rule's seed. */
export const ASSISTANT_KEEP_MONTHS = 12;
export const ASSISTANT_KEEP = { min: 1, max: 60 } as const;

/** A typed number of months as a choice: null is the default, anything else a whole number of months within the limits, else a problem. */
export function readKeepMonths(value: unknown): { ok: true; months: number | null } | { ok: false } {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return { ok: true, months: null };
  const months = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(months) || months < ASSISTANT_KEEP.min || months > ASSISTANT_KEEP.max) return { ok: false };
  return { ok: true, months: months === ASSISTANT_KEEP_MONTHS ? null : months };
}
