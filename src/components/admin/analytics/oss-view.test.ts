import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import { buildReturn, IOSS_OFF_TEXT, type RateLookup, type ReturnMode, type ReturnScheme } from "@/lib/oss-return";
import { DEFAULT_TAX_PROFILE } from "@/lib/tax-profile";
import { deadlineOf, deadlineSentence, deadlineState, monthPeriod, quarterPeriod, type TaxPeriod } from "@/lib/tax-periods";
import type { DocGroup } from "@/lib/tax-report";
import type { ReturnView } from "@/server/tax-reports";

import { OssView, type OssViewProps } from "./oss-view";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

const seller = { country: "SE", ossMemberState: "SE" };
const rates: Record<string, string> = { "DKK|2026-09-30": "7.4755" };
const rateFor: RateLookup = (currency, day) => (rates[`${currency}|${day}`] ? { rate: rates[`${currency}|${day}`], date: day, source: "ecb", reason: null } : null);

const g = (over: Partial<DocGroup> = {}): DocGroup => ({
  docKind: "invoice",
  taxDate: "2026-09-12",
  originalTaxDate: null,
  marketCode: "DE",
  marketInEu: true,
  currency: "EUR",
  mainCurrency: "SEK",
  fxState: "stored",
  fxRate: "11.2",
  vatKind: "standard",
  buyerType: "consumer",
  hasPhysical: true,
  hasDownload: false,
  hasService: false,
  dispatchCountry: "SE",
  dispatchSource: "order",
  sellerCountry: "SE",
  sellerOssMemberState: "SE",
  sellerSource: "order",
  rate: 0.19,
  basis: "standard",
  standardRate: 0.19,
  documents: 1,
  orders: 1,
  currencyOrders: 1,
  kindDocuments: 1,
  netMinor: 10000,
  vatMinor: 1900,
  grossMinor: 11900,
  netMainMinor: 0,
  vatMainMinor: 0,
  grossMainMinor: 0,
  ...over,
});
const dk = (over: Partial<DocGroup> = {}) => g({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000, grossMinor: 125000, ...over });
const norway = g({ marketCode: "NO", marketInEu: false, currency: "NOK", rate: 0.25, standardRate: 0.25, netMinor: 40000, vatMinor: 10000, grossMinor: 50000 });

type Over = { scheme?: ReturnScheme; period?: TaxPeriod; mode?: ReturnMode; groups?: DocGroup[]; ossScheme?: "none" | "union" | "non_union"; iossNumber?: string | null; rateFor?: RateLookup; today?: string; state?: ReturnView["state"]; intermediary?: string | null };

function viewOf(o: Over = {}): ReturnView {
  const scheme = o.scheme ?? "oss";
  const period = o.period ?? (scheme === "oss" ? quarterPeriod(2026, 3) : monthPeriod(2026, 9));
  const profile = { ...DEFAULT_TAX_PROFILE, ossScheme: o.ossScheme ?? "union", ossMemberState: "SE", iossNumber: o.iossNumber ?? null, iossIntermediary: o.intermediary ?? null };
  const today = o.today ?? "2026-10-04";
  const data = buildReturn({ scheme, period, mode: o.mode ?? "filing", groups: o.groups ?? [g(), dk()], registration: { ossScheme: profile.ossScheme, iossNumber: profile.iossNumber }, rateFor: o.rateFor ?? rateFor });
  return {
    data,
    state: o.state ?? (scheme === "ioss" ? (profile.iossNumber ? "on" : "off") : "on"),
    profile,
    today,
    deadline: { day: deadlineOf(period), state: deadlineState(period, today), sentence: deadlineSentence(period, today) },
    documentLines: (o.groups ?? [g(), dk()]).length,
  };
}

const idle = async (): Promise<FormState> => ({ status: "idle", messages: [] });

const props = (over: Partial<OssViewProps> & { view?: ReturnView } = {}): OssViewProps => {
  const view = over.view ?? viewOf();
  return {
    base: "/admin/shop",
    locale: "en",
    scheme: view.data.scheme,
    mode: view.data.mode,
    view,
    periods: [
      { key: "2026-Q4", label: "Q4 2026" },
      { key: "2026-Q3", label: "Q3 2026" },
    ],
    canExport: true,
    isOwner: true,
    drift: null,
    lastExportedAt: null,
    exportProblem: null,
    actions: { fetch: idle, override: idle },
    ...over,
  };
};

describe("the OSS view", () => {
  it("starts with the line that these are not a tax return and shows the deadline of the quarter", () => {
    const out = html(h(OssView, props()));
    expect(out).toContain("They are not a tax return and Kaizen files nothing.");
    expect(out).toContain("Q3 2026: submit and pay by 31 October 2026.");
  });

  it("shows the parts of the worked example: Part 2b for DE and DK in euro, Part 4 per Member State and Part 5 as the total due", () => {
    const out = html(h(OssView, props()));
    expect(out).toContain("Part 2b: goods dispatched from your Member State of identification");
    expect(out).toContain(">DE<");
    expect(out).toContain(">DK<");
    expect(out).toContain("€19.00");
    // 1000.00 DKK at 7.4755 is 133.77 EUR taxable and 33.44 EUR VAT.
    expect(out).toContain("€133.77");
    expect(out).toContain("€33.44");
    expect(out).toContain("Part 4: balance per Member State");
    expect(out).toContain("Total due, Part 5");
    expect(out).toContain("€52.44");
  });

  it("shows the euro rate of the last day with its date and source", () => {
    const out = html(h(OssView, props()));
    expect(out).toContain("Euro rates");
    expect(out).toContain("7.4755");
    expect(out).toContain("30 September 2026");
    expect(out).toContain("ECB reference rate");
  });

  it("lists what is not in the return, with the reason", () => {
    const out = html(h(OssView, props({ view: viewOf({ groups: [g(), norway] }) })));
    expect(out).toContain("Not in this return");
    // A Swedish store's Norway sale is Norwegian VAT: it is not sent to the Swedish return.
    expect(out).toContain("A market outside the EU, in a country your store is not established in.");
    expect(out).not.toContain("belongs in your national VAT return");
  });

  it("shows the Member State of dispatch of goods and says the dispatch state's number is the owner's to enter", () => {
    const out = html(h(OssView, props({ view: viewOf({ groups: [g({ marketCode: "DK", currency: "EUR", rate: 0.25, standardRate: 0.25, dispatchCountry: "PL" })] }) })));
    expect(out).toContain("Part 2d");
    expect(out).toContain("Member State of dispatch");
    expect(out).toContain(">PL<");
    expect(out).toContain("Kaizen does not hold it, so you enter it yourself");
    // Services have no dispatch state: their table has no such column.
    const services = html(h(OssView, props({ view: viewOf({ groups: [g({ hasPhysical: false, hasDownload: true })] }) })));
    expect(services).not.toContain("Member State of dispatch");
  });

  it("shows a store with no OSS registration the same figures under a heading that says so", () => {
    const out = html(h(OssView, props({ view: viewOf({ ossScheme: "none" }) })));
    expect(out).toContain("What an OSS return would hold: no OSS registration is recorded (Settings, Tax)");
    expect(out).toContain("Part 2b");
    expect(out).toContain("Registration and sales do not fit");
    expect(out).toContain("/admin/shop/settings/tax");
  });

  it("says a missing rate makes the return incomplete, shows the figures as missing, and does not offer the return data", () => {
    const view = viewOf({ rateFor: () => null });
    const out = html(h(OssView, props({ view })));
    expect(out).toContain("This return is incomplete");
    expect(out).toContain("DKK on 30 September 2026");
    expect(out).toContain("No euro rate is stored for this amount");
    expect(out).toContain("Missing");
    // The return data button is held back, the conversion detail is not.
    expect(out).toMatch(/<button type="submit" disabled=""[^>]*>Export OSS return data \(CSV\)<\/button>/);
    expect(out).toMatch(/<button type="submit" class="[^"]*">Export conversion detail \(CSV\)<\/button>/);
    expect(out).toContain("it shows the gap");
  });

  it("offers an owner the ECB's rate and an own rate with a reason, and nobody else", () => {
    const view = viewOf({ rateFor: () => null });
    const owner = html(h(OssView, props({ view })));
    expect(owner).toContain("Fetch from the ECB");
    expect(owner).toContain("Enter a rate");
    expect(owner).toContain("at least 10 characters");
    expect(owner).toContain('name="reason"');
    const staff = html(h(OssView, props({ view, isOwner: false, actions: null })));
    expect(staff).not.toContain("Fetch from the ECB");
    expect(staff).not.toContain('name="reason"');
    expect(staff).toContain("Only an owner can fetch a rate from the ECB or enter one.");
  });

  it("shows an owner's own rate with its reason where it is used", () => {
    const view = viewOf({ rateFor: (c, d) => (c === "DKK" ? { rate: "7.5", date: d, source: "owner", reason: "Accountant's rate for the quarter" } : null) });
    const out = html(h(OssView, props({ view })));
    expect(out).toContain("Owner's rate: Accountant's rate for the quarter");
    expect(out).toContain("Change your rate");
  });

  it("offers the exports to a member with write access and says what is needed otherwise", () => {
    const out = html(h(OssView, props()));
    expect(out).toContain('name="kind" value="oss"');
    expect(out).toContain('name="kind" value="oss_detail"');
    expect(out).toContain('name="period" value="2026-Q3"');
    expect(out).toContain('name="mode" value="filing"');
    const readOnly = html(h(OssView, props({ canExport: false })));
    expect(readOnly).not.toContain("analytics/tax/export");
    expect(readOnly).toContain("Exports need the analytics role with write access.");
  });

  it("says what changed since the last export and when it was made", () => {
    const out = html(h(OssView, props({ drift: "Changed since you exported this on 3 October 2026: VAT -€5.00. If you have already filed it, the difference belongs in your next return as a correction.", lastExportedAt: "2026-10-03T09:00:00.000Z" })));
    expect(out).toContain("This period has changed since you exported it");
    expect(out).toContain("Last exported on 3 October 2026.");
  });

  it("has a mode switch with the words for each mode and keeps the quarter in its links", () => {
    const filing = html(h(OssView, props()));
    expect(filing).toContain("Filing mode shows what a return for the period holds");
    expect(filing).toContain("view=oss&quarter=2026-Q3&mode=books");
    const books = html(h(OssView, props({ view: viewOf({ mode: "books" }) })));
    expect(books).toContain("Books mode is the bookkeeping view");
    expect(books).toContain("Books mode has no Part 3");
  });

  it("shows a correction of an earlier quarter in Part 3, in filing mode", () => {
    const credit = dk({ docKind: "credit_note", taxDate: "2026-10-06", originalTaxDate: "2026-09-12", orders: 0, netMinor: 50000, vatMinor: 12500, grossMinor: 62500 });
    const view = viewOf({ period: quarterPeriod(2026, 4), groups: [credit], today: "2027-01-10" });
    const out = html(h(OssView, props({ view, periods: [{ key: "2026-Q4", label: "Q4 2026" }] })));
    expect(out).toContain("2026-Q3");
    expect(out).toContain("−€16.72");
    expect(out).toContain("Reimbursed by the Member State, not counted in Part 5");
    expect(out).toContain("€0.00");
    expect(out).toContain("Q4 2026: submit and pay by 31 January 2027.");
  });

  it("marks a quarter that is still running as in progress", () => {
    const view = viewOf({ period: quarterPeriod(2026, 4), today: "2026-10-04", groups: [] });
    const out = html(h(OssView, props({ view })));
    expect(out).toContain("Q4 2026 is still in progress");
    expect(out).toContain("Nothing in Part 2 for Q4 2026.");
  });

  it("warns that a deadline has passed without saying a return is late", () => {
    const out = html(h(OssView, props({ view: viewOf({ today: "2026-11-05" }) })));
    expect(out).toContain("Deadline passed");
    expect(out).toContain("Kaizen does not know what was filed");
  });

  it("sets no cookie or storage and loads no script of its own (React adds its own form-replay script for the rate forms)", () => {
    const out = html(h(OssView, props()));
    expect(out).not.toMatch(/localStorage|sessionStorage|document\.cookie|<script[^>]*src=/);
  });
});

describe("the IOSS view", () => {
  const ioss = (o: Over = {}) => viewOf({ scheme: "ioss", ...o });
  const marked = (over: Partial<DocGroup> = {}) => g({ vatKind: "ioss", dispatchCountry: "NO", ...over });

  it("is off with its reason and a link to the settings when there is no number and no marked sale, and offers no file", () => {
    const out = html(h(OssView, props({ view: ioss({ groups: [] }) })));
    expect(out).toContain("IOSS is off");
    expect(out).toContain(IOSS_OFF_TEXT);
    expect(out).toContain("/admin/shop/settings/tax");
    expect(out).not.toContain("analytics/tax/export");
    expect(out).not.toContain("Part 4");
    expect(out).toContain("They are not a tax return and Kaizen files nothing.");
  });

  it("shows the marked sales of the month per Member State and rate, monthly, due at the end of the next month", () => {
    const view = ioss({ iossNumber: "IM2460000123", groups: [marked(), marked({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000, grossMinor: 125000 })] });
    const out = html(h(OssView, props({ view })));
    expect(out).toContain("IOSS return for September 2026");
    expect(out).toContain("Part 2: consignments of 150 EUR or less, import scheme");
    expect(out).toContain("September 2026: submit and pay by 31 October 2026.");
    expect(out).toContain('name="kind" value="ioss"');
    expect(out).toContain('name="period" value="2026-09"');
    expect(out).toContain("IOSS return data (CSV)");
  });

  it("lists the sale above the limit and a business buyer's sale as not in the return", () => {
    const view = ioss({ iossNumber: "IM2460000123", groups: [marked(), g({ dispatchCountry: "NO", marketCode: "SE", currency: "SEK" })] });
    const out = html(h(OssView, props({ view })));
    expect(out).toContain("Goods sent from outside the EU that were not marked IOSS.");
  });

  it("says history is shown when marked sales exist but the number has been taken away", () => {
    const view = ioss({ iossNumber: null, state: "history", groups: [marked()] });
    const out = html(h(OssView, props({ view })));
    expect(out).toContain("No IOSS number is recorded now");
    expect(out).toContain("They are shown as they were marked.");
    expect(out).toContain("Part 2: consignments of 150 EUR or less");
  });

  it("tells the owner when an intermediary is named that the intermediary normally files the return", () => {
    const view = ioss({ iossNumber: "IM2460000123", intermediary: "Fiskal AB", groups: [marked()] });
    const out = html(h(OssView, props({ view })));
    expect(out).toContain("Your IOSS intermediary (Fiskal AB) normally files the return.");
    expect(out).toContain("data to give them");
  });

  it("picks a month, not a quarter", () => {
    const out = html(h(OssView, props({ view: ioss({ iossNumber: "IM2460000123", groups: [marked()] }), periods: [{ key: "2026-09", label: "September 2026" }] })));
    expect(out).toContain('name="month"');
    expect(out).toContain('aria-label="Month"');
  });
});
