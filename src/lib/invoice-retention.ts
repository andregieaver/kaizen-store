/**
 * How long invoices and credit notes are kept, and how soon the personal data in an old one may be removed (D159,
 * `docs/wave-1b-invoices.md` 3.6). Since unit 1g (D162) the numbers live in `commerce.retention_rules` and in `RETENTION_SEED`
 * (`src/lib/retention.ts`); this file keeps the names the invoice code already uses and answers from the seed, so the two
 * cannot differ. `runRetention()` calls `commerce.anonymise_expired_documents()` with the cutoff `retentionCutoff()` gives.
 *
 * Every row needs review by an accountant: the source and what was read of it are said, and an unknown country is the safe side
 * (the longest period, so no document is anonymised sooner than a rule says).
 */
import { ANONYMISE_FLOOR_YEARS, FALLBACK_RETENTION_YEARS, RETENTION_SEED, retentionCutoff, ruleFor, yearsOf, type RetentionBasis } from "./retention";

export { ANONYMISE_FLOOR_YEARS, FALLBACK_RETENTION_YEARS, retentionCutoff };

export type RetentionRule = {
  years: number;
  /** Where the period comes from, and how it was read. */
  source: string;
  /** What was read: the page itself, a snippet of it, a secondary source, or nothing (the fallback). */
  basis: Exclude<RetentionBasis, "policy">;
  checkedOn: string;
};

const asRule = (row: (typeof RETENTION_SEED)[number]): RetentionRule => ({
  years: yearsOf(row),
  source: row.source,
  basis: row.basis as RetentionRule["basis"],
  checkedOn: row.checkedOn,
});

/** The four countries read, from the seed. */
export const RETENTION_RULES: Record<string, RetentionRule> = Object.fromEntries(
  RETENTION_SEED.filter((r) => r.kind === "bookkeeping" && r.country !== null).map((r) => [r.country as string, asRule(r)]),
);

export const retentionRuleOf = (country: string | null | undefined): RetentionRule => {
  const c = (country ?? "").toUpperCase();
  const own = RETENTION_RULES[c];
  if (own) return own;
  const row = ruleFor("bookkeeping", null, "2026-10-04");
  return row
    ? asRule(row)
    : { years: FALLBACK_RETENTION_YEARS, source: "No rule has been read for this country.", basis: "fallback", checkedOn: "2026-10-04" };
};
