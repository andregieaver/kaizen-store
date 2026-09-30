import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_WORK_SETTINGS, sellerReadiness } from "@/lib/work-settings";
import { workOverview, type OverviewEntry, type OverviewInvoice } from "@/lib/work-overview";

import { WorkComingSoon } from "./coming-soon";
import { SeriesForm, WorkSettingsForm } from "./settings-form";
import { OverviewBody, type OverviewProps } from "./work-overview";
import { WorkOff } from "./work-off";

/**
 * The Work pages are server-rendered and the settings form is client code
 * that renders on the server too: this holds that each draws in every state
 * (empty, busy, module off, read-only) and says what it should.
 */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "");

const TODAY = "2026-09-29";
const BASE = "/admin/account/work/s/kaffe";

const base = (over: Partial<OverviewProps> = {}): OverviewProps => ({
  base: BASE,
  settingsHref: "/admin/account/work/s/kaffe/settings",
  locale: "en",
  today: TODAY,
  overview: workOverview({
    today: TODAY,
    now: Date.parse("2026-09-29T12:00:00Z"),
    invoices: [],
    entries: [],
    timers: [],
    base: BASE,
  }),
  clientCount: 0,
  clientNames: {},
  invoiceNumbers: {},
  assignmentNames: {},
  people: {},
  missing: [],
  ...over,
});

const invoice = (o: Partial<OverviewInvoice>): OverviewInvoice => ({
  id: "i1",
  clientId: "c1",
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

const entry = (o: Partial<OverviewEntry> = {}): OverviewEntry => ({
  clientId: "c1",
  assignmentId: "a1",
  billingType: "hourly",
  currency: "NOK",
  rateMinor: 120_000,
  workDate: "2026-09-20",
  minutes: 90,
  billable: true,
  prepaidMinutes: 0,
  invoiceLineId: null,
  ...o,
});

describe("the Work overview", () => {
  it("starts a store with no clients by asking for the first one", () => {
    const out = html(createElement(OverviewBody, base()));
    expect(out).toContain("Add your first client");
    expect(out).toContain(`href="${BASE}/clients"`);
    expect(out).not.toContain("Overdue invoices");
  });

  it("says what is missing before the first invoice, and where to fix it", () => {
    const missing = sellerReadiness({
      legalName: null,
      organisationNumber: null,
      postalAddress: null,
      country: null,
      vatRegistered: true,
      vatNumber: null,
      bankAccount: null,
    }).problems;
    const out = html(createElement(OverviewBody, base({ missing })));
    expect(out).toContain("Before your first invoice");
    expect(out).toContain("Add your business&#x27;s legal name on the Company page.");
    expect(out).toContain('href="/admin/account/work/s/kaffe/settings"');
  });

  it("shows figures per currency, attention items, unbilled time, overdue invoices and running timers", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    const overview = workOverview({
      today: TODAY,
      now,
      invoices: [
        invoice({}),
        invoice({ id: "i2", currency: "EUR", totalMinor: 10_000, dueOn: "2026-10-30" }),
        invoice({ id: "i3", status: "draft", dueOn: null, totalMinor: 50_000 }),
      ],
      entries: [entry()],
      timers: [{ accountId: "u1", assignmentId: "a1", startedAt: now - 95 * 60_000 }],
      base: BASE,
    });
    const out = html(
      createElement(
        OverviewBody,
        base({
          overview,
          clientCount: 1,
          clientNames: { c1: "Acme AS" },
          invoiceNumbers: { i1: "W-12" },
          assignmentNames: { a1: { name: "Strategy", clientName: "Acme AS" } },
          people: { u1: "Kari" },
        }),
      ),
    );
    expect(out).toContain("Needs your attention");
    expect(out).toContain("1 invoice is overdue, the oldest by 28 days.");
    expect(out).toContain(`href="${BASE}/invoices?show=overdue"`);
    // Amounts stay in their own currency; nothing is added across them.
    expect(out).toMatch(/>NOK<\/h3>/);
    expect(out).toMatch(/>EUR<\/h3>/);
    expect(out).toContain("1h 30m at your rates");
    expect(out).toContain(`href="${BASE}/clients/c1"`);
    expect(out).toContain("Acme AS");
    expect(out).toContain(`href="${BASE}/invoices/i1"`);
    expect(out).toContain("W-12");
    expect(out).toContain("28 days ago");
    expect(out).toContain("Kari is working on");
    expect(out).toContain("Strategy");
    expect(out).toContain("1h 35m so far");
  });

  it("says so when there is nothing to attend to, and nothing overdue or running", () => {
    const out = html(createElement(OverviewBody, base({ clientCount: 2 })));
    expect(out).toContain("Nothing needs your attention.");
    expect(out).toContain("No invoice is overdue.");
    expect(out).toContain("No timer is running.");
    expect(out).toContain("No unbilled time.");
  });
});

describe("the settings form", () => {
  const props = {
    action: async () => ({ status: "idle" as const, messages: [] }),
    settings: {
      ...DEFAULT_WORK_SETTINGS,
      vatNumber: "NO923456789MVA",
      bankAccount: "NO9386011117947",
      defaultCurrency: "EUR",
    },
    currencies: ["EUR", "NOK", "SEK"],
    mainCurrency: "NOK",
    canEdit: true,
  };

  it("draws every setting with what is saved", () => {
    const out = html(createElement(WorkSettingsForm, props));
    for (const name of [
      "vatRegistered",
      "vatNumber",
      "bankAccount",
      "bic",
      "paymentNote",
      "invoiceFooter",
      "latePaymentNote",
      "defaultPaymentDays",
      "defaultCurrency",
      "estimateAlertMinutes",
      "estimateAlertPopup",
      "estimateAlertSound",
      "showTimeNotesToClients",
    ]) {
      expect(out, name).toContain(`name="${name}"`);
    }
    expect(out).toContain('value="NO923456789MVA"');
    expect(out).toContain("Your store&#x27;s main currency (NOK)");
    expect(out).toContain("Save settings");
  });

  it("leaves out the VAT number of a store that is not registered", () => {
    const out = html(
      createElement(WorkSettingsForm, {
        ...props,
        settings: { ...props.settings, vatRegistered: false, vatNumber: null },
      }),
    );
    expect(out).not.toContain('name="vatNumber"');
  });

  it("is read-only for someone who is not an owner", () => {
    const out = html(createElement(WorkSettingsForm, { ...props, canEdit: false }));
    expect(out).toContain("<fieldset disabled");
    expect(out).toContain("Only an owner can change Work&#x27;s settings.");
    expect(out).not.toContain("Save settings");
  });
});

describe("the numbering form", () => {
  const props = {
    action: async () => ({ status: "idle" as const, messages: [] }),
    title: "Invoices",
    prefix: "W-",
    nextNumber: 1,
    issued: 0,
    lastDocumentNumber: null,
    nextDocumentNumber: "W-1",
    canEdit: true,
  };

  it("can be changed until a document is issued", () => {
    const out = html(createElement(SeriesForm, props));
    expect(out).toContain('name="prefix"');
    expect(out).toContain('name="nextNumber"');
    expect(out).toContain("W-1");
    expect(out).toContain("Save numbering");
  });

  it("is fixed from the first document, and says which was the last", () => {
    const out = html(
      createElement(SeriesForm, {
        ...props,
        issued: 3,
        lastDocumentNumber: "W-3",
        nextNumber: 4,
        nextDocumentNumber: "W-4",
      }),
    );
    expect(out).not.toContain('name="nextNumber"');
    const text = out.replace(/<[^>]+>/g, "");
    expect(text).toContain("3 issued, the last is W-3.");
    expect(text).toContain("The next will be W-4.");
    expect(out).toContain("can no longer be changed");
  });
});

describe("the stand-ins", () => {
  it("point to the switch when Work is off, and back to Work while a page is still to come", () => {
    const off = html(createElement(WorkOff, { storeSlug: "kaffe", title: "Clients" }));
    expect(off).toContain('href="/admin/account/work/settings"');
    expect(off).toContain("Work is off");
    const soon = html(createElement(WorkComingSoon, { storeSlug: "kaffe", title: "Clients" }));
    expect(soon).toContain("Coming in the next step.");
    expect(soon).toContain('href="/admin/account/work/s/kaffe"');
  });
});
