/**
 * The retention schedule (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.5 and 3.1), pure: which kinds of data have a period, the
 * seed of `commerce.retention_rules` (the migration's rows and this list are held equal by `src/db/privacy.test.ts`), and the
 * dates a period gives. The rows are data the platform's admin keeps (`commerce.set_retention_rule()`, read through
 * `commerce.retention_rule()` and the server's `retentionRule()`); the numbers here are only the seed and the safe fallback.
 *
 * Nothing here is legal advice. A period that comes from a statute says where, how much of the source was read, and when; every
 * bookkeeping row is *for an accountant to review* (`verified_at` stays null until one has). A `policy` row is Kaizen's own
 * proportionality choice under GDPR Art. 5(1)(e), not a statute, and says so.
 */

export const RETENTION_KINDS = [
  "bookkeeping",
  "host_bookkeeping",
  "unpaid_orders",
  "email_bodies",
  "security_emails",
  "carts",
  "delivery_quotes",
  "customer_codes",
  "customer_sessions",
  "webhook_payloads",
  "consents",
  "privacy_request_contact",
  "privacy_requests",
  "search_queries",
  "visits",
  "audit_log",
  "form_submissions",
  "integration_deliveries",
  "abandoned_checkouts",
  "recommendation_events",
  "ai_usage",
] as const;
export type RetentionKind = (typeof RETENTION_KINDS)[number];

export const isRetentionKind = (value: unknown): value is RetentionKind => (RETENTION_KINDS as readonly unknown[]).includes(value);

/** The kinds whose period comes from bookkeeping law and counts from the end of the calendar year (the rest are policy). */
export const BOOKKEEPING_KINDS = ["bookkeeping", "host_bookkeeping"] as const satisfies readonly RetentionKind[];
export const isBookkeepingKind = (kind: RetentionKind): boolean => (BOOKKEEPING_KINDS as readonly string[]).includes(kind);

export const PERIOD_UNITS = ["days", "months"] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];

export const COUNTS_FROM = ["event", "end_of_year"] as const;
export type CountsFrom = (typeof COUNTS_FROM)[number];

/** What was read of a source: the page itself, a snippet of it, a secondary source, nothing (a safe fallback), or Kaizen's own choice. */
export const RETENTION_BASES = ["read", "snippet", "secondary", "fallback", "policy"] as const;
export type RetentionBasis = (typeof RETENTION_BASES)[number];

/** The database refuses a bookkeeping period shorter than this (the shortest of the four countries read): a floor under a wrong rule. */
export const ANONYMISE_FLOOR_YEARS = 5;
export const ANONYMISE_FLOOR_MONTHS = ANONYMISE_FLOOR_YEARS * 12;
/** The longest of the four plus a margin: for a country nobody has read yet, and what an empty rules table means (never "keep nothing"). */
export const FALLBACK_RETENTION_YEARS = 10;
export const FALLBACK_RETENTION_MONTHS = FALLBACK_RETENTION_YEARS * 12;
/** A period above this is refused by `set_retention_rule()`: nobody keeps personal data for more than fifty years by typing a number. */
export const CEILING_RETENTION_MONTHS = 600;

/** The period of a rule. */
export type Period = { periodValue: number; periodUnit: PeriodUnit; countsFrom: CountsFrom };

export type RetentionRuleRow = Period & {
  kind: RetentionKind;
  /** ISO 3166 alpha-2, upper case; null is the default for every country. */
  country: string | null;
  source: string;
  sourceUrl: string | null;
  basis: RetentionBasis;
  /** `YYYY-MM-DD`. */
  checkedOn: string;
  validFrom: string;
  validTo: string | null;
  enforcedBy: string;
  note: string;
  verifiedAt?: string | null;
};

const CHECKED = "2026-10-04";
const SEED_FROM = "2000-01-01";

type Seed = Omit<RetentionRuleRow, "validFrom" | "validTo" | "checkedOn" | "verifiedAt" | "sourceUrl"> & { sourceUrl?: string | null };
const seed = (row: Seed): RetentionRuleRow => ({ sourceUrl: null, ...row, checkedOn: CHECKED, validFrom: SEED_FROM, validTo: null, verifiedAt: null });

const POLICY = "Kaizen's own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.";

/**
 * The rows of `commerce.retention_rules` as the migration seeds them (`src/db/privacy.test.ts` holds the two equal). Every
 * bookkeeping row is for an accountant to read: the NO and SE rows were read at the page, DK and DE are not.
 */
export const RETENTION_SEED: readonly RetentionRuleRow[] = [
  seed({
    kind: "bookkeeping",
    country: "NO",
    periodValue: 60,
    periodUnit: "months",
    countsFrom: "end_of_year",
    source: "Bokføringsloven § 13(2): accounting material is kept 5 years after the end of the financial year (page read 2026-10-04)",
    sourceUrl: "https://lovdata.no/lov/2004-11-19-73/§13",
    basis: "read",
    enforcedBy: "runRetention: commerce.anonymise_expired_orders()",
    note: "Read at the act's page. The financial year is taken as the calendar year (not modelled otherwise).",
  }),
  seed({
    kind: "bookkeeping",
    country: "SE",
    periodValue: 84,
    periodUnit: "months",
    countsFrom: "end_of_year",
    source:
      "Bokföringslag (1999:1078) 7 kap. 2 §: kept to the end of the seventh year after the calendar year in which the financial year ended (text of the section read 2026-10-04)",
    sourceUrl: "https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/",
    basis: "read",
    enforcedBy: "runRetention: commerce.anonymise_expired_orders()",
    note: "Text of 7 kap. 2 § read. The financial year is taken as the calendar year.",
  }),
  seed({
    kind: "bookkeeping",
    country: "DK",
    periodValue: 60,
    periodUnit: "months",
    countsFrom: "end_of_year",
    source:
      "Accounting material is kept 5 years after the end of the financial year (Skattestyrelsen's guidance; a search result cites bogføringsloven § 10 for the period); snippet level, section number unconfirmed",
    sourceUrl: "https://tax.dk/jv-2022-1/ab/A_B_3_1_3.htm",
    basis: "snippet",
    enforcedBy: "runRetention: commerce.anonymise_expired_orders()",
    note: "Not read at the act. Needs an accountant.",
  }),
  seed({
    kind: "bookkeeping",
    country: "DE",
    periodValue: 96,
    periodUnit: "months",
    countsFrom: "end_of_year",
    source:
      "Booking records (invoices, receipts, order confirmations, delivery notes) 8 years from 1 January 2025 (BEG IV; § 147(3) AO, § 257(4) HGB), down from 10; search results only, gesetze-im-internet.de could not be read",
    sourceUrl: null,
    basis: "secondary",
    enforcedBy: "runRetention: commerce.anonymise_expired_orders()",
    note: "Secondary source. Needs an accountant.",
  }),
  seed({
    kind: "bookkeeping",
    country: null,
    periodValue: 120,
    periodUnit: "months",
    countsFrom: "end_of_year",
    source: "No rule has been read for this country: the longest period of the four that were, plus a margin, so nothing is anonymised sooner than a rule says",
    basis: "fallback",
    enforcedBy: "runRetention: commerce.anonymise_expired_orders()",
    note: "Applies to every country with no row of its own.",
  }),
  seed({
    kind: "host_bookkeeping",
    country: null,
    periodValue: 120,
    periodUnit: "months",
    countsFrom: "end_of_year",
    source:
      "DAC7 (Directive (EU) 2021/514): platform operators keep records for at least 5 and at most 10 years, member states may extend; a search summary, not read",
    basis: "secondary",
    enforcedBy: "runRetention: commerce.anonymise_expired_orders()",
    note: "A host's order is reported by the store (D71); the longest period is the safe side.",
  }),
  seed({ kind: "unpaid_orders", country: null, periodValue: 30, periodUnit: "days", countsFrom: "event", source: `An order never paid is not a sale and no law keeps it; the row stays (its number is gap-free), the person goes. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: commerce.anonymise_order()", note: "From the day the order was placed." }),
  seed({ kind: "email_bodies", country: null, periodValue: 12, periodUnit: "months", countsFrom: "event", source: `Sent emails hold names, addresses and order contents. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: email_messages", note: "The row stays (its idempotency key stops a replayed webhook from sending again); evidence kinds wait for their order." }),
  seed({ kind: "security_emails", country: null, periodValue: 7, periodUnit: "days", countsFrom: "event", source: `Sign-in codes, links, password resets and invitations are of no use after a short time. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: email_messages", note: "" }),
  seed({ kind: "carts", country: null, periodValue: 90, periodUnit: "days", countsFrom: "event", source: `Carts hold a company name and VAT number. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: carts", note: "After the cart ended (an open cart: its expiry)." }),
  seed({ kind: "delivery_quotes", country: null, periodValue: 30, periodUnit: "days", countsFrom: "event", source: `A quote holds a postal code. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: delivery_quotes", note: "After the quote expired." }),
  seed({ kind: "customer_codes", country: null, periodValue: 7, periodUnit: "days", countsFrom: "event", source: `Every email address that ever asked for a sign-in code would otherwise be kept for ever. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: customer_codes", note: "After the code expired." }),
  seed({ kind: "customer_sessions", country: null, periodValue: 30, periodUnit: "days", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "runRetention: customer_sessions", note: "After the session expired." }),
  seed({ kind: "webhook_payloads", country: null, periodValue: 90, periodUnit: "days", countsFrom: "event", source: `A payment provider's event holds a name, an email and an address. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: webhook_events", note: "After the event was processed; the row stays so its id still de-duplicates." }),
  seed({ kind: "consents", country: null, periodValue: 12, periodUnit: "months", countsFrom: "event", source: `The cookie consent log. ${POLICY}`, basis: "policy", enforcedBy: "pg_cron kaizen-consent-retention and runRetention", note: "Idempotent: the app step and the database job may both run." }),
  seed({ kind: "privacy_request_contact", country: null, periodValue: 30, periodUnit: "days", countsFrom: "event", source: `The address a finished privacy request was logged under is no longer needed. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: privacy_requests", note: "After the request was done." }),
  seed({ kind: "privacy_requests", country: null, periodValue: 24, periodUnit: "months", countsFrom: "event", source: `The record that a request was answered in time. ${POLICY}`, basis: "policy", enforcedBy: "runRetention: privacy_requests", note: "After the request was done; the one deletion the table's guard allows." }),
  seed({ kind: "search_queries", country: null, periodValue: 90, periodUnit: "days", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "pruneSearchLog() (SEARCH_LOG_DAYS)", note: "The code's constant is the source; a test holds them equal." }),
  seed({ kind: "visits", country: null, periodValue: 25, periodUnit: "months", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "pruneVisits() (RETENTION_MONTHS)", note: "The code's constant is the source; a test holds them equal." }),
  seed({ kind: "audit_log", country: null, periodValue: 24, periodUnit: "months", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "pruneAuditLog() (AUDIT_RETENTION_MONTHS)", note: "The database refuses to remove a younger entry." }),
  seed({ kind: "form_submissions", country: null, periodValue: 30, periodUnit: "days", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "pruneFormSubmissions()", note: "The code's constant is the source; a test holds them equal." }),
  seed({ kind: "integration_deliveries", country: null, periodValue: 30, periodUnit: "days", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "integrations' KEEP_DAYS", note: "The code's constant is the source; a test holds them equal." }),
  seed({ kind: "abandoned_checkouts", country: null, periodValue: 30, periodUnit: "days", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "cart reminders' erase", note: "The code's constant is the source; a test holds them equal." }),
  seed({ kind: "recommendation_events", country: null, periodValue: 90, periodUnit: "days", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "recommendations' EVENT_DAYS", note: "The code's constant is the source; a test holds them equal." }),
  seed({ kind: "ai_usage", country: null, periodValue: 400, periodUnit: "days", countsFrom: "event", source: POLICY, basis: "policy", enforcedBy: "ai-usage's USAGE_KEEP_DAYS", note: "The code's constant is the source; a test holds them equal." }),
];

/** What an empty rules table means: the safe side, never "keep nothing" and never "delete everything". */
export function fallbackPeriod(kind: RetentionKind): Period {
  return { periodValue: FALLBACK_RETENTION_MONTHS, periodUnit: "months", countsFrom: isBookkeepingKind(kind) ? "end_of_year" : "event" };
}

const norm = (country: string | null | undefined): string | null => {
  const c = (country ?? "").trim().toUpperCase();
  return c === "" ? null : c;
};

/** A rule is in force on a day when it began on or before it and has not ended (`validTo` is the first day it no longer applies). */
export const inForce = (row: Pick<RetentionRuleRow, "validFrom" | "validTo">, at: string): boolean =>
  row.validFrom <= at && (row.validTo == null || at < row.validTo);

/**
 * The row of a kind that applies: the country's own in force on the day, else the default (no country), else null (the caller then
 * uses `fallbackPeriod()`). The same order as `commerce.retention_rule()`.
 */
export function ruleFor(kind: RetentionKind, country: string | null | undefined, at: string, rules: readonly RetentionRuleRow[] = RETENTION_SEED): RetentionRuleRow | null {
  const c = norm(country);
  const pick = (want: string | null) =>
    rules
      .filter((r) => r.kind === kind && norm(r.country) === want && inForce(r, at))
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0] ?? null;
  return (c ? pick(c) : null) ?? pick(null);
}

export function periodFor(kind: RetentionKind, country: string | null | undefined, at: string, rules: readonly RetentionRuleRow[] = RETENTION_SEED): Period {
  const row = ruleFor(kind, country, at, rules);
  return row ? { periodValue: row.periodValue, periodUnit: row.periodUnit, countsFrom: row.countsFrom } : fallbackPeriod(kind);
}

/** Whole years of an `end_of_year` period (a months period that is a multiple of 12 by the table's check). */
export const yearsOf = (p: Period): number => Math.ceil(p.periodUnit === "months" ? p.periodValue / 12 : p.periodValue / 365);

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Adds calendar months to a `YYYY-MM-DD` day, clamped to the target month's last day (31 January + 1 month = 28 or 29 February). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, last))}`;
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * The day before which something has passed its period, as a store day (`YYYY-MM-DD`; the thing is due when its anchor day is before it).
 * `end_of_year`: counts from the end of the calendar year of the event, so something of year Y goes on 1 January of Y + years + 1, and the
 * cutoff on `today` is 1 January of (year of today - years). `event`: the day that many days or months before `today`. A bookkeeping
 * period is never shorter than the floor (the database refuses one too).
 */
export function periodCutoff(period: Period, today: string, opts: { floorYears?: number } = {}): string {
  if (period.countsFrom === "end_of_year") {
    const years = Math.max(yearsOf(period), opts.floorYears ?? 0);
    return `${pad(Number(today.slice(0, 4)) - years, 4)}-01-01`;
  }
  return period.periodUnit === "months" ? addMonths(today, -period.periodValue) : addDays(today, -period.periodValue);
}

/** The same for a timestamp rule: the instant before which a row has passed its period (days are 24 hours, months calendar months in UTC). */
export function cutoffInstant(period: Period, now: Date): Date {
  if (period.periodUnit === "days") return new Date(now.getTime() - period.periodValue * 86_400_000);
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - period.periodValue);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * The date before which documents and orders of a country have passed their bookkeeping period, counted from the end of the calendar
 * year (the 1b rule): a sale of year Y is kept to the end of Y + years, so on 1 January of Y + years + 1 it may go. `today` is a store
 * day. Never younger than the floor. `kind` is `host_bookkeeping` for a host's order.
 */
export function retentionCutoff(
  country: string | null | undefined,
  today: string,
  rules: readonly RetentionRuleRow[] = RETENTION_SEED,
  kind: "bookkeeping" | "host_bookkeeping" = "bookkeeping",
): string {
  return periodCutoff(periodFor(kind, country, today, rules), today, { floorYears: ANONYMISE_FLOOR_YEARS });
}

/**
 * The first day an anchor day's personal data may go under a period that counts from the end of the year: 1 January of (anchor year +
 * years + 1). What the erasure preview says as "kept until".
 */
export function keptUntil(anchorDay: string, period: Period): string {
  const years = Math.max(yearsOf(period), ANONYMISE_FLOOR_YEARS);
  return `${pad(Number(anchorDay.slice(0, 4)) + years + 1, 4)}-01-01`;
}

/** What a rule row says in one line, for the platform's page and the privacy texts: "5 years from the end of the year" / "30 days". */
export function describePeriod(p: Period): string {
  if (p.periodUnit === "months" && p.periodValue % 12 === 0) {
    const years = p.periodValue / 12;
    const base = `${years} year${years === 1 ? "" : "s"}`;
    return p.countsFrom === "end_of_year" ? `${base} from the end of the calendar year` : base;
  }
  const unit = p.periodUnit === "months" ? "month" : "day";
  return `${p.periodValue} ${unit}${p.periodValue === 1 ? "" : "s"}`;
}

export type RuleProblem = "floor" | "ceiling" | "year_unit" | "period";

/** What `commerce.set_retention_rule()` refuses, so a form can say it first (the database still decides). */
export function ruleProblem(kind: RetentionKind, p: Period): RuleProblem | null {
  if (!Number.isInteger(p.periodValue) || p.periodValue <= 0) return "period";
  if (p.countsFrom === "end_of_year" && (p.periodUnit !== "months" || p.periodValue % 12 !== 0)) return "year_unit";
  const months = p.periodUnit === "months" ? p.periodValue : p.periodValue / 30;
  if (months > CEILING_RETENTION_MONTHS) return "ceiling";
  if (isBookkeepingKind(kind) && (p.periodUnit !== "months" || p.periodValue < ANONYMISE_FLOOR_MONTHS)) return "floor";
  return null;
}

/** The kinds a platform admin may add a country-specific row for (bookkeeping law differs by country; the rest are one policy). */
export const COUNTRY_KINDS: readonly RetentionKind[] = BOOKKEEPING_KINDS;
