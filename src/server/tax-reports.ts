import "server-only";

import { sql } from "drizzle-orm";

import { addDays, daysBetween } from "@/lib/analytics-period";
import { zonedDate } from "@/lib/booking-slots";
import { mainCurrency } from "@/lib/markets";
import { buildReturn, iossState, type RateChoice, type ReturnData, type ReturnMode, type ReturnScheme } from "@/lib/oss-return";
import type { ClassifyInput, RegistrationFacts } from "@/lib/tax-classes";
import { deadlineOf, deadlineSentence, deadlineState, type DeadlineState, type TaxPeriod } from "@/lib/tax-periods";
import { buildVatReport, parseDocGroup, type DocGroup, type VatReport } from "@/lib/tax-report";
import type { TaxProfile } from "@/lib/tax-profile";

import { db } from "@/db/client";

import { setBased, type SetBasedRead } from "./analytics-totals";
import { rateLookup, type RateRequest } from "./ecb-rates";
import type { Store } from "./stores";
import { getTaxProfile, storeCountry } from "./tax-profile";

type Row = Record<string, unknown>;

/**
 * The VAT report and the OSS and IOSS return data of a store (D161, `docs/wave-1c-reports.md` 2.2, 3.4 and 4). The figures are the store's
 * invoices' and credit notes': one database function, `commerce.tax_document_groups()`, is the only thing that opens a document for a
 * report, and this module names neither document table. An order with no document is not here at all (`tax-reconciliation.ts` counts
 * it and says why); nothing is recomputed from orders. Every query carries the store id.
 *
 * THESE ARE THE OWNER'S OWN FIGURES, FOR THE OWNER'S ACCOUNTANT. They are not a tax return and Kaizen files nothing. Needs review: accountant.
 */

/** A range of store days, `to` exclusive (an `AnalyticsPeriod`'s `from` and `to`). */
export type TaxRange = { from: string; to: string };

/** The longest range the VAT view reads, as the analytics period picker allows. */
export const MAX_RANGE_DAYS = 800;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A range that is two real days, in order, no longer than `MAX_RANGE_DAYS`: anything else is a bug in the caller, never an address's text. */
export function checkRange(range: TaxRange): void {
  if (!DAY.test(range.from) || !DAY.test(range.to) || range.to <= range.from || daysBetween(range.from, range.to) > MAX_RANGE_DAYS) {
    throw new RangeError(`Not a range of days: ${range.from}..${range.to}`);
  }
}

/**
 * The groups of the store's documents whose tax date is in the range (an invoice's supply date, a credit note's issue day). `read` is the
 * caller's own snapshot when it reads other figures it must agree with (`taxSnapshot()`), else a read of its own.
 */
export async function documentGroups(storeId: string, range: TaxRange, read: SetBasedRead = setBased): Promise<DocGroup[]> {
  checkRange(range);
  const rows = await read<Row>(sql`select * from commerce.tax_document_groups(${storeId}::uuid, ${range.from}::date, ${range.to}::date)`);
  return rows.map(parseDocGroup);
}

export type SellerFacts = {
  seller: ClassifyInput["seller"];
  registration: RegistrationFacts;
  profile: TaxProfile;
};

/**
 * What the store says about itself today: its country (the VAT table puts its own country's rows first) and its registrations (the
 * return's notes). Where a sale is reported does NOT come from here but from the seller each order froze (`tax_document_groups()`'s
 * `seller_*` columns), so editing the store later reclassifies nothing.
 */
export async function sellerFacts(storeId: string): Promise<SellerFacts> {
  const [profile, country] = await Promise.all([getTaxProfile(storeId), storeCountry(storeId)]);
  return {
    seller: { country, ossMemberState: profile.ossMemberState },
    registration: { ossScheme: profile.ossScheme, iossNumber: profile.iossNumber },
    profile,
  };
}

// ---------------------------------------------------------------------------
// The VAT view
// ---------------------------------------------------------------------------

export type VatReportView = {
  range: TaxRange;
  report: VatReport;
  seller: SellerFacts;
};

/** VAT per delivery country, rate and basis for a range of days, in each document's currency and the main one (stored rates only). */
export async function vatReport(store: Store, range: TaxRange): Promise<VatReportView> {
  const [groups, seller] = await Promise.all([documentGroups(store.id, range), sellerFacts(store.id)]);
  return vatReportOf(store, range, groups, seller);
}

/** The VAT view from groups already read (`taxSnapshot()` reads them in the same snapshot as the reconciliation's sums). */
export const vatReportOf = (store: Store, range: TaxRange, groups: readonly DocGroup[], seller: SellerFacts): VatReportView => ({
  range,
  report: buildVatReport(groups, seller.seller, { mainCurrency: mainCurrency(store) }),
  seller,
});

// ---------------------------------------------------------------------------
// The OSS and IOSS views
// ---------------------------------------------------------------------------

export type ReturnView = {
  data: ReturnData;
  /** IOSS only: `on` (a number), `history` (marked sales and no number now) or `off` (neither: the page says why). OSS views are always `on`. */
  state: "on" | "history" | "off";
  profile: TaxProfile;
  today: string;
  /** The return's deadline, `YYYY-MM-DD`, and where the period stands against it. */
  deadline: { day: string; state: DeadlineState; sentence: string };
  /** Documents the period's window holds, whatever the view's scheme (0: the period has nothing to report). */
  documentLines: number;
};

/** Whether the store has ever had an order marked IOSS (never a copied or a host's order): the IOSS view's history. */
export async function hasIossSales(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select exists (select 1 from commerce.orders o where o.store_id = ${storeId}::uuid and o.vat_kind = 'ioss' and o.copied_from is null and o.host_id is null) as found
  `);
  return row?.found === true;
}

/** The store's own calendar day today. */
export const storeToday = (store: Pick<Store, "timeZone">, now: Date = new Date()): string => zonedDate(now.getTime(), store.timeZone);

/**
 * The return data of one quarter (`scheme: "oss"`) or month (`"ioss"`) in a mode. Which rates it needs depends on the documents (a credit note
 * of an earlier period is converted at that period's last day), so the data is built once to learn them, the rates are read all at once
 * (the owner's own for the store and day, else the ECB's), and it is built again with them. A currency with no stored rate leaves the
 * return `incomplete`; nothing is converted at today's rate.
 */
export async function returnView(store: Store, scheme: ReturnScheme, period: TaxPeriod, mode: ReturnMode, deps: { today?: string } = {}): Promise<ReturnView> {
  if ((scheme === "oss") !== (period.kind === "quarter")) throw new RangeError("The OSS return is a quarter and the IOSS return a month.");
  const [groups, facts, iossSales] = await Promise.all([documentGroups(store.id, period), sellerFacts(store.id), scheme === "ioss" ? hasIossSales(store.id) : Promise.resolve(false)]);
  const today = deps.today ?? storeToday(store);
  const base = { scheme, period, mode, groups, registration: facts.registration };

  const asked: RateRequest[] = [];
  buildReturn({
    ...base,
    rateFor: (currency, day) => {
      asked.push({ currency, day });
      return null;
    },
  });
  const lookup = await rateLookup(store.id, asked);
  const known = new Map<string, RateChoice | null>();
  const data = buildReturn({
    ...base,
    rateFor: (currency, day) => {
      const key = `${currency}|${day}`;
      if (!known.has(key)) known.set(key, lookup(currency, day));
      return known.get(key) ?? null;
    },
  });
  return {
    data,
    state: scheme === "ioss" ? iossState(facts.profile.iossNumber, iossSales) : "on",
    profile: facts.profile,
    today,
    deadline: { day: deadlineOf(period), state: deadlineState(period, today), sentence: deadlineSentence(period, today) },
    documentLines: groups.reduce((n, g) => n + g.documents, 0),
  };
}

/** The first day of the quarter or month a day is in, and the day after the last: for a caller that has a day and wants the half-open range. */
export const rangeOfPeriod = (period: TaxPeriod): TaxRange => ({ from: period.from, to: period.to });

/** `to` exclusive from a last day included (a custom range typed as two days). */
export const exclusiveEnd = (lastDay: string): string => addDays(lastDay, 1);
