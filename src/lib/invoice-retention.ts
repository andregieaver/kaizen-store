/**
 * How long invoices and credit notes are kept, and how soon the personal data in an old one may be removed (D159,
 * `docs/wave-1b-invoices.md` 3.6). Since unit 1g (D162) the numbers live in `commerce.retention_rules` and in `RETENTION_SEED`
 * (`src/lib/retention.ts`); this file keeps the names the invoice code already uses and answers from the seed, so the two
 * cannot differ. `runRetention()` calls `commerce.anonymise_expired_documents()` with the cutoff `retentionCutoff()` gives.
 *
 * Every row needs review by an accountant: the source and what was read of it are said, and an unknown country is the safe side
 * (the longest period, so no document is anonymised sooner than a rule says).
 */
import { ANONYMISE_FLOOR_YEARS, FALLBACK_RETENTION_YEARS, RETENTION_SEED, retentionCutoff as countryCutoff, ruleFor, yearsOf, type RetentionBasis } from "./retention";

export { ANONYMISE_FLOOR_YEARS, FALLBACK_RETENTION_YEARS };

/**
 * The records of a store that uses the OSS or IOSS schemes are kept 10 years from the end of the year of the transaction (D161): the
 * Commission's One Stop Shop Guidelines, Part 4, quoting Council Implementing Regulation (EU) 282/2011 Art. 63c, read 2026-10-04 in the
 * guide, not in the regulation itself (verify). Needs review by an accountant.
 */
export const SCHEME_RETENTION_YEARS = 10;

/**
 * The date before which documents have passed their period (the country's, from the seed). For a store that uses an OSS or IOSS scheme
 * (`options.scheme`: an OSS registration or an IOSS number) the period is at least 10 years (D161); the scheme never shortens anything.
 */
export function retentionCutoff(country: string | null | undefined, today: string, options: { scheme?: boolean } = {}): string {
  const base = countryCutoff(country, today);
  if (!options.scheme) return base;
  const scheme = `${String(Number(today.slice(0, 4)) - SCHEME_RETENTION_YEARS).padStart(4, "0")}-01-01`;
  return scheme < base ? scheme : base;
}

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
