import { describe, expect, it } from "vitest";

import { kaizenLifeDoor, workSummaryOf, type SummaryInput } from "./work-summary";
import { combineOverviews, type StoreOverview, type WorkStore } from "./work-owner";
import { workOverview, type OverviewEntry, type OverviewInvoice } from "./work-overview";

const TODAY = "2026-09-29";
const NOW = Date.parse("2026-09-29T12:00:00Z");
const ORIGIN = "https://kaizenaflow.com";
const door = (path: string) => kaizenLifeDoor(ORIGIN, path);
/** The admin path a door address opens. */
const nextOf = (href: string) => {
  const url = new URL(href);
  expect(url.origin + url.pathname).toBe(`${ORIGIN}/admin/sign-in/kaizen-life`);
  return url.searchParams.get("next");
};

const store = (over: Partial<WorkStore> & Pick<WorkStore, "slug">): WorkStore => ({
  id: `id-${over.slug}`,
  name: over.slug.toUpperCase(),
  timeZone: "Europe/Oslo",
  role: "owner",
  market: { code: "NO", currency: "NOK", defaultLocale: "nb" },
  workOn: true,
  lastUsedAt: null,
  ...over,
});
const KAFFE = store({ slug: "kaffe" });
const TE = store({ slug: "te" });
const BOK = store({ slug: "bok", market: { code: "SE", currency: "SEK", defaultLocale: "sv" } });

const invoice = (o: Partial<OverviewInvoice> & Pick<OverviewInvoice, "id" | "status">): OverviewInvoice => ({
  clientId: "c1",
  currency: "NOK",
  totalMinor: 0,
  paidMinor: 0,
  creditedMinor: 0,
  dueOn: null,
  paidOn: null,
  updatedOn: TODAY,
  recurringPeriod: null,
  ...o,
});
const entry = (o: Partial<OverviewEntry>): OverviewEntry => ({
  clientId: "c1",
  assignmentId: "a1",
  billingType: "hourly",
  currency: "NOK",
  rateMinor: 100_000,
  workDate: "2026-09-20",
  minutes: 60,
  billable: true,
  prepaidMinutes: 0,
  invoiceLineId: null,
  ...o,
});
const part = (s: WorkStore, invoices: OverviewInvoice[], entries: OverviewEntry[] = []): StoreOverview => ({
  store: s,
  today: TODAY,
  clientCount: 1,
  overview: workOverview({
    today: TODAY,
    now: NOW,
    invoices,
    entries,
    timers: [],
    base: `/admin/account/work/s/${s.slug}`,
    label: s.name,
  }),
});

const input = (over: Partial<SummaryInput> & Pick<SummaryInput, "combined">): SummaryInput => ({
  stores: { using: [KAFFE, BOK], off: [] },
  clientNames: { c1: "Nordlys Media", c2: "Fjord AS" },
  timer: null,
  now: new Date(NOW),
  door,
  ...over,
});

describe("the Work summary for Kaizen Life", () => {
  const kaffe = part(
    KAFFE,
    [invoice({ id: "i1", status: "sent", totalMinor: 1_250_000, paidMinor: 250_000, dueOn: "2026-09-09" })],
    [entry({ minutes: 90 })],
  );
  const bok = part(BOK, [
    invoice({ id: "i2", clientId: "c2", status: "sent", currency: "SEK", totalMinor: 500_000, dueOn: "2026-09-26" }),
  ]);

  it("keeps money per currency, the urgent first, and names a client only on a line about one", () => {
    const summary = workSummaryOf(input({ combined: combineOverviews([kaffe, bok]) }));
    expect(summary.workOn).toBe(true);
    expect(summary.asOf).toBe("2026-09-29T12:00:00.000Z");
    expect(summary.needs.map((n) => [n.kind, n.urgent, n.money?.currency])).toEqual([
      ["overdue", true, "NOK"],
      ["overdue", false, "SEK"],
      ["unbilled", false, "NOK"],
    ]);
    const [nok, sek, unbilled] = summary.needs;
    expect(nok).toMatchObject({
      store: { slug: "kaffe", name: "KAFFE" },
      count: 1,
      money: { minor: 1_000_000, currency: "NOK" },
      since: "2026-09-09",
      client: "Nordlys Media",
    });
    expect(nextOf(nok.href)).toBe("/admin/account/work/s/kaffe/invoices?show=overdue");
    expect(sek).toMatchObject({ store: { slug: "bok" }, money: { minor: 500_000, currency: "SEK" }, client: "Fjord AS" });
    expect(unbilled).toMatchObject({ minutes: 90, money: { minor: 150_000, currency: "NOK" }, since: "2026-09-20" });
    expect(nextOf(unbilled.href)).toBe("/admin/account/work/s/kaffe");
    // Never added across currencies.
    expect(summary.currencies.map((c) => [c.currency, c.onItsWay, c.overdue])).toEqual([
      ["NOK", 1_000_000, 1_000_000],
      ["SEK", 500_000, 500_000],
    ]);
    expect(summary.stores.map((s) => [s.slug, s.workOn, s.unbilledMinutes])).toEqual([
      ["kaffe", true, 90],
      ["bok", true, 0],
    ]);
    expect(nextOf(summary.open)).toBe("/admin/account/work");
    expect(summary.turnOn).toBeNull();
  });

  it("puts two stores' overdue invoices in one currency on one line, without a store or a client", () => {
    const te = part(TE, [invoice({ id: "i3", clientId: "c2", status: "sent", totalMinor: 300_000, dueOn: "2026-09-20" })]);
    const summary = workSummaryOf(
      input({ stores: { using: [KAFFE, TE], off: [] }, combined: combineOverviews([kaffe, te]) }),
    );
    const overdue = summary.needs.filter((n) => n.kind === "overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ store: null, count: 2, money: { minor: 1_300_000, currency: "NOK" }, since: "2026-09-09" });
    expect(overdue[0].client).toBeUndefined();
    expect(nextOf(overdue[0].href)).toBe("/admin/account/work/invoices?show=overdue");
  });

  it("shows the person's own timer, urgent after twelve hours", () => {
    const timer = {
      storeSlug: "kaffe",
      storeName: "KAFFE",
      clientName: "Nordlys Media",
      taskTitle: "Website care",
      startedAt: "2026-09-28T23:00:00Z",
      elapsedSeconds: 13 * 3600 + 59,
    };
    const summary = workSummaryOf(input({ combined: combineOverviews([part(KAFFE, [])]), timer }));
    expect(summary.needs).toEqual([
      {
        kind: "timer",
        urgent: true,
        store: { slug: "kaffe", name: "KAFFE" },
        minutes: 780,
        since: "2026-09-28T23:00:00Z",
        client: "Nordlys Media",
        task: "Website care",
        href: door("/admin/account/work/s/kaffe"),
      },
    ]);
    const short = workSummaryOf(input({ combined: combineOverviews([]), timer: { ...timer, elapsedSeconds: 600 } }));
    expect(short.needs[0]).toMatchObject({ urgent: false, minutes: 10 });
  });

  it("says where to turn Work on when no store uses it, and shows nothing else", () => {
    const summary = workSummaryOf(
      input({ stores: { using: [], off: [store({ slug: "kaffe", workOn: false })] }, combined: combineOverviews([]) }),
    );
    expect(summary.workOn).toBe(false);
    expect(summary.needs).toEqual([]);
    expect(summary.currencies).toEqual([]);
    expect(nextOf(summary.turnOn ?? "")).toBe("/admin/account/work/settings");
    expect(summary.stores).toEqual([
      { slug: "kaffe", name: "KAFFE", workOn: false, href: door("/admin/account/work/settings"), currencies: [], unbilledMinutes: 0 },
    ]);
    // Neither using Work nor able to switch it on: nothing to offer.
    expect(workSummaryOf(input({ stores: { using: [], off: [] }, combined: combineOverviews([]) })).turnOn).toBeNull();
  });

  it("builds the handoff door's address with the path encoded", () => {
    expect(kaizenLifeDoor("https://kaizenaflow.com/", "/admin/account/work/invoices?show=overdue")).toBe(
      "https://kaizenaflow.com/admin/sign-in/kaizen-life?next=%2Fadmin%2Faccount%2Fwork%2Finvoices%3Fshow%3Doverdue",
    );
  });
});
