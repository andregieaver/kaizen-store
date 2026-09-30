import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { combineOverviews, mergeReports, type StoreOverview, type WorkStore } from "@/lib/work-owner";
import { workOverview, type OverviewEntry, type OverviewInvoice } from "@/lib/work-overview";
import { parseInvoiceListParams } from "@/lib/work-invoice-ui";
import { parseReportParams, type PeriodReport } from "@/lib/work-reports";
import { EMPTY_TIME_FILTERS } from "@/lib/work-ui";
import type { OwnerInvoiceList, OwnerOverviewView, OwnerSettingsRow } from "@/server/work-owner";

import { OwnerClientsList } from "./owner-clients";
import { OwnerInvoicesView } from "./owner-invoices";
import { OwnerOverviewBody } from "./owner-overview";
import { NewInStoreButton } from "./owner-parts";
import { OwnerReportView } from "./owner-report";
import { OwnerSettingsView, OwnerWorkStart } from "./owner-settings";
import { OwnerTimeView } from "./owner-time";

vi.mock("@/components/admin/action-form", () => ({
  ActionForm: ({ children }: { children: unknown }) => createElement("form", null, children as never),
  SubmitButton: ({ children }: { children: unknown }) => createElement("button", null, children as never),
}));

/** The combined Work pages draw in every state and say what they should: empty, one store, two currencies, read-only. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "");
const TODAY = "2026-09-29";
const NOW = Date.parse("2026-09-29T12:00:00Z");

const store = (slug: string, over: Partial<WorkStore> = {}): WorkStore => ({
  id: `id-${slug}`,
  slug,
  name: slug === "kaffe" ? "Kaffe AS" : "Bok AB",
  timeZone: "Europe/Oslo",
  role: "owner",
  market: null,
  workOn: true,
  lastUsedAt: null,
  ...over,
});
const NO = store("kaffe");
const SE = store("bok", { role: "admin" });

const invoice = (o: Partial<OverviewInvoice> & Pick<OverviewInvoice, "id">): OverviewInvoice => ({
  clientId: `c-${o.id}`,
  status: "sent",
  currency: "NOK",
  totalMinor: 250_000,
  paidMinor: 0,
  creditedMinor: 0,
  dueOn: "2026-09-01",
  paidOn: null,
  updatedOn: TODAY,
  recurringPeriod: null,
  ...o,
});
const entry = (o: Partial<OverviewEntry>): OverviewEntry => ({
  clientId: "c-e",
  assignmentId: "a1",
  billingType: "hourly",
  currency: "NOK",
  rateMinor: 100_000,
  workDate: "2026-09-20",
  minutes: 90,
  billable: true,
  prepaidMinutes: 0,
  invoiceLineId: null,
  ...o,
});

const part = (s: WorkStore, invoices: OverviewInvoice[], entries: OverviewEntry[], clientCount: number): StoreOverview => ({
  store: s,
  today: TODAY,
  clientCount,
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

const view = (parts: StoreOverview[]): OwnerOverviewView => ({
  combined: combineOverviews(parts),
  clientNames: { "c-i1": "Acme", "c-i2": "Fjord", "c-e": "Ravn" },
  invoiceNumbers: { i1: "2026-0007", i2: "2026-0003" },
  assignmentNames: {},
  people: {},
  missing: [],
});

describe("the overview", () => {
  it("asks for a first client when there is none", () => {
    const out = html(createElement(OwnerOverviewBody, { view: view([part(NO, [], [], 0)]), stores: [NO] }));
    expect(out).toContain("Add your first client");
    expect(out).toContain("/admin/account/work/s/kaffe/clients");
  });

  it("keeps two currencies apart and links each row to its store", () => {
    const parts = [
      part(NO, [invoice({ id: "i1" })], [entry({})], 2),
      part(SE, [invoice({ id: "i2", currency: "SEK", totalMinor: 90_000 })], [entry({ currency: "SEK" })], 1),
    ];
    const out = html(createElement(OwnerOverviewBody, { view: view(parts), stores: [NO, SE] }));
    expect(out).toContain("all stores");
    expect(out).toMatch(/NOK/);
    expect(out).toMatch(/SEK/);
    expect(out).toContain("never added together");
    expect(out).toContain("/admin/account/work/s/kaffe/invoices/i1");
    expect(out).toContain("/admin/account/work/s/bok/invoices/i2");
    expect(out).toContain("2026-0007");
    expect(out).toContain("By store");
    expect(out).toContain("Kaffe AS");
    expect(out).toContain("Bok AB");
  });

  it("lists what a store still needs before its first invoice", () => {
    const v = view([part(NO, [], [], 1)]);
    v.missing = [
      {
        store: { slug: "kaffe", name: "Kaffe AS" },
        problems: [{ code: "bank_account", severity: "error", where: "settings", message: "Add a bank account." } as never],
      },
    ];
    const out = html(createElement(OwnerOverviewBody, { view: v, stores: [NO] }));
    expect(out).toContain("Add a bank account.");
    expect(out).toContain("/admin/account/work/s/kaffe/settings");
  });
});

describe("New client and New invoice", () => {
  it("is a plain link with one store and a store choice with several", () => {
    const one = html(createElement(NewInStoreButton, { kind: "invoice", stores: [{ slug: "kaffe", name: "Kaffe AS" }], defaultSlug: "" }));
    expect(one).toContain('href="/admin/account/work/s/kaffe/invoices?new=1"');
    const many = html(
      createElement(NewInStoreButton, {
        kind: "client",
        stores: [
          { slug: "kaffe", name: "Kaffe AS" },
          { slug: "bok", name: "Bok AB" },
        ],
        defaultSlug: "bok",
      }),
    );
    expect(many).toContain("New client");
    expect(html(createElement(NewInStoreButton, { kind: "client", stores: [], defaultSlug: "" }))).toBe("");
  });
});

describe("clients", () => {
  const client = {
    id: "c1",
    storeId: "id-kaffe",
    storeSlug: "kaffe",
    storeName: "Kaffe AS",
    name: "Acme",
    legalName: null,
    contactName: "Ola",
    billingEmail: null,
    currency: "NOK",
    archivedAt: null,
    activeAssignments: 1,
    loggedMinutes: 120,
    unbilledMinutes: 30,
  };
  const props = { stores: [NO, SE], query: "", show: "active" as const, storeSlug: "", defaultStore: "kaffe", truncated: false };

  it("shows the store of every client and links to it there", () => {
    const out = html(createElement(OwnerClientsList, { ...props, clients: [client] }));
    expect(out).toContain('href="/admin/account/work/s/kaffe/clients/c1"');
    expect(out).toContain("Kaffe AS");
    expect(out).toContain('name="store"');
  });

  it("says so when nothing matches, and offers no store column for one store", () => {
    expect(html(createElement(OwnerClientsList, { ...props, clients: [], query: "zzz" }))).toContain("No client matches");
    const one = html(createElement(OwnerClientsList, { ...props, stores: [NO], clients: [client] }));
    expect(one).not.toContain('name="store"');
  });
});

describe("time", () => {
  it("draws entries with their store and leads to the assignment in it", () => {
    const out = html(
      createElement(OwnerTimeView, {
        stores: [NO, SE],
        storeSlug: "",
        filters: EMPTY_TIME_FILTERS,
        clients: [],
        people: null,
        today: TODAY,
        page: 1,
        pageSize: 50,
        showPerson: false,
        list: {
          entries: [
            {
              id: "e1",
              storeId: "id-kaffe",
              storeSlug: "kaffe",
              storeName: "Kaffe AS",
              assignmentId: "a1",
              assignmentName: "Website",
              clientId: "c1",
              clientName: "Acme",
              taskId: null,
              taskTitle: null,
              accountId: "u1",
              accountName: "Ola",
              workDate: "2026-09-20",
              minutes: 90,
              billable: true,
              note: "Fixed the menu",
              prepaidMinutes: 0,
              invoiceableMinutes: 90,
              invoiceLineId: null,
              invoiceId: null,
              invoiceStatus: null,
              invoiceNumber: null,
              locked: false,
              createdAt: "2026-09-20T10:00:00.000Z",
            },
          ],
          totals: { count: 1, minutes: 90, billableMinutes: 90, unbilledMinutes: 90 },
          truncated: false,
        },
      }),
    );
    expect(out).toContain("1h 30m");
    expect(out).toContain('href="/admin/account/work/s/kaffe/assignments/a1"');
    expect(out).toContain("Fixed the menu");
  });
});

describe("invoices", () => {
  const list = (over: Partial<OwnerInvoiceList> = {}): OwnerInvoiceList => ({
    rows: [
      {
        id: "i1",
        storeId: "id-kaffe",
        storeSlug: "kaffe",
        storeName: "Kaffe AS",
        status: "sent",
        documentNumber: "2026-0007",
        clientId: "c1",
        clientName: "Acme",
        assignmentName: null,
        currency: "NOK",
        issuedOn: "2026-09-01",
        dueOn: "2026-09-15",
        totalMinor: 125_000,
        creditedMinor: 0,
        outstandingMinor: 125_000,
        today: TODAY,
        overdue: true,
        daysOverdue: 14,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
    totals: [
      { currency: "NOK", count: 1, totalMinor: 125_000, outstandingMinor: 125_000 },
      { currency: "SEK", count: 2, totalMinor: 10_000, outstandingMinor: 0 },
    ],
    counts: { draft: 1, sent: 1, paid: 0, void: 0, overdue: 1 },
    ...over,
  });

  it("totals per currency and links to the invoice in its store", () => {
    const out = html(
      createElement(OwnerInvoicesView, {
        stores: [NO, SE],
        list: list(),
        params: parseInvoiceListParams({}),
        storeSlug: "",
        defaultStore: "kaffe",
      }),
    );
    expect(out).toContain('href="/admin/account/work/s/kaffe/invoices/i1"');
    expect(out).toContain("NOK, 1 invoice");
    expect(out).toContain("SEK, 2 invoices");
    expect(out).toContain("never added together");
    expect(out).toContain("Overdue");
  });

  it("says when there are no invoices at all", () => {
    const out = html(
      createElement(OwnerInvoicesView, {
        stores: [NO],
        list: list({ rows: [], total: 0, totals: [], counts: { draft: 0, sent: 0, paid: 0, void: 0, overdue: 0 } }),
        params: parseInvoiceListParams({}),
        storeSlug: "",
        defaultStore: "kaffe",
      }),
    );
    expect(out).toContain("No invoices yet");
  });
});

describe("reports", () => {
  const report: PeriodReport = {
    from: "2026-09-01",
    to: "2026-09-30",
    by: "client",
    rows: [],
    totals: [],
    totalMinutes: 0,
    totalBillableMinutes: 0,
  };
  it("draws an empty period and offers the download with the store in it", () => {
    const params = parseReportParams({}, TODAY);
    const out = html(
      createElement(OwnerReportView, {
        stores: [NO, SE],
        params: { ...params, clientId: "" },
        report: mergeReports([{ store: NO, report }]),
        storeSlug: "kaffe",
      }),
    );
    expect(out).toContain("Nothing to report");
    expect(out).toContain("/admin/account/work/reports/csv?period=this_month&amp;store=kaffe");
  });
});

describe("settings and the empty state", () => {
  const row = (s: WorkStore, over: Partial<OwnerSettingsRow> = {}): OwnerSettingsRow => ({
    store: s,
    issuedInvoices: 0,
    runningTimers: 0,
    problems: s.workOn ? [] : null,
    ...over,
  });
  const action = async () => ({ status: "ok" as const, messages: [] });

  it("shows a switch per store, read-only for an admin, with a link to the store's own settings", () => {
    const out = html(
      createElement(OwnerSettingsView, {
        rows: [row(NO, { issuedInvoices: 3 }), row(SE)],
        actions: { kaffe: action, bok: action },
      }),
    );
    expect(out).toContain("Use Work in this store");
    expect(out).toContain('href="/admin/account/work/s/kaffe/settings"');
    expect(out).toContain("3 issued invoices");
    expect(out).toContain("Only an owner of the store can switch Work on or off.");
    expect(out).toContain("disabled");
  });

  it("explains Work and offers the switches when no store uses it", () => {
    const off = row(store("kaffe", { workOn: false }));
    const out = html(createElement(OwnerWorkStart, { title: "Clients", rows: [off], actions: { kaffe: action } }));
    expect(out).toContain("Work is for the time you sell");
    expect(out).toContain("Use Work in this store");
    expect(out).not.toContain("<table");
  });

  it("tells an account that owns no store who can switch it on", () => {
    const out = html(createElement(OwnerWorkStart, { title: "Time", rows: [], actions: {} }));
    expect(out).toContain("Ask an owner");
  });
});
