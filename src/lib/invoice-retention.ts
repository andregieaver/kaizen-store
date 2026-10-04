/**
 * How long invoices and credit notes are kept, and how soon the personal data in an old one may be removed (D159,
 * `docs/wave-1b-invoices.md` 3.6). The constants live here until unit 1g adds `commerce.retention_rules`; 1g's `runRetention()`
 * calls `commerce.anonymise_expired_documents()` with the cutoff `retentionCutoff()` gives.
 *
 * Every row needs review by an accountant: the source and what was read of it are said, and an unknown country is the safe side
 * (the longest period, so no document is anonymised sooner than a rule says).
 */

export type RetentionRule = {
  years: number;
  /** Where the period comes from, and how it was read. */
  source: string;
  /** What was read: the page itself, a snippet of it, a secondary source, or nothing (the fallback). */
  basis: "read" | "snippet" | "secondary" | "fallback";
  checkedOn: string;
};

export const RETENTION_RULES: Record<string, RetentionRule> = {
  NO: { years: 5, source: "bokføringsloven § 13, https://lovdata.no/lov/2004-11-19-73/§13 (5 years after the end of the fiscal year)", basis: "read", checkedOn: "2026-10-04" },
  SE: { years: 7, source: "bokföringslagen 7 kap. 2 § (seven years after the end of the calendar year of the financial year); a snippet quoting Skatteverket and FAR Online", basis: "snippet", checkedOn: "2026-10-04" },
  DK: { years: 5, source: "bogføringsloven § 12, as quoted by Skattestyrelsen's guidance (5 years after the end of the financial year); snippet level", basis: "snippet", checkedOn: "2026-10-04" },
  DE: { years: 8, source: "§ 147(3) AO and § 14b UStG as changed by BEG IV from 1 January 2025 (8 years); a search result, not the act", basis: "secondary", checkedOn: "2026-10-04" },
};

/** The longest of the four plus a margin: for a country nobody has read yet. */
export const FALLBACK_RETENTION_YEARS = 10;
/** The database refuses a cutoff younger than this (the shortest period of the four): a floor under a wrong rule. */
export const ANONYMISE_FLOOR_YEARS = 5;

export const retentionRuleOf = (country: string | null | undefined): RetentionRule =>
  RETENTION_RULES[(country ?? "").toUpperCase()] ?? { years: FALLBACK_RETENTION_YEARS, source: "No rule has been read for this country: the longest period of the four that were.", basis: "fallback", checkedOn: "2026-10-04" };

/**
 * The date before which documents issued have passed their period, counted from the end of the calendar year of the document
 * (`YYYY-MM-DD`): a document issued in year Y is kept until the end of Y + years, so on 1 January of the year after it may go.
 * `today` is a store day. Never younger than the floor.
 */
export function retentionCutoff(country: string | null | undefined, today: string): string {
  const year = Number(today.slice(0, 4));
  const years = Math.max(retentionRuleOf(country).years, ANONYMISE_FLOOR_YEARS);
  return `${String(year - years).padStart(4, "0")}-01-01`;
}
