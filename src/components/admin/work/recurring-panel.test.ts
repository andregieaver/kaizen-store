import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RecurringList, RecurringSummary } from "@/server/work-recurring";

// The actions and the reads are server code (they import the database); the screens call them only when a button is pressed.
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/recurring-actions", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/actions", () => ({}));
vi.mock("@/server/auth", () => ({ requireMember: async () => ({}) }));
vi.mock("@/server/work-recurring", () => ({ listRecurring: async () => ({ today: "", templates: [] }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { RecurringForm } from "./recurring-form";
import { RecurringPanelView, type RecurringPanelProps } from "./recurring-panel";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "");

const STORE = "kaffe";
const CLIENT = "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1001";
const TODAY = "2026-09-29";

const props: RecurringPanelProps = {
  storeSlug: STORE,
  clientId: CLIENT,
  currency: "NOK",
  currencies: ["EUR", "NOK", "SEK"],
  locale: "en-GB",
  archived: false,
};

const template = (over: Partial<RecurringSummary> = {}): RecurringSummary => ({
  id: "t1",
  clientId: CLIENT,
  name: "Monthly retainer",
  description: "Monthly retainer",
  unit: "unit",
  quantityHundredths: 100,
  unitPriceMinor: 950_000,
  discountBp: 0,
  vatCategory: "standard",
  currency: "NOK",
  recurrenceInterval: 1,
  recurrencePeriod: "month",
  startDate: "2026-08-15",
  endDate: null,
  paymentDays: null,
  autoIssue: false,
  isActive: true,
  skippedPeriods: [],
  sortOrder: 0,
  next: ["2026-10-15"],
  open: [],
  last: null,
  invoiceCount: 0,
  ...over,
});

const panel = (list: Partial<RecurringList>, over: Partial<Parameters<typeof RecurringPanelView>[0]> = {}) =>
  html(createElement(RecurringPanelView, { ...props, list: { today: TODAY, templates: [], ...list }, canAutoIssue: true, ...over }));

describe("the repeating invoices panel", () => {
  it("explains itself and offers the first one when nothing repeats", () => {
    const out = panel({});
    expect(out).toContain("Repeating invoices");
    expect(out).toContain("Nothing repeats for this client");
    expect(out).toContain("Add repeating invoice");
  });

  it("offers no new one for an archived client", () => {
    expect(panel({}, { archived: true })).not.toContain("Add repeating invoice");
  });

  it("shows what a template bills before VAT, its schedule and what comes next", () => {
    const out = panel({ templates: [template()] });
    expect(out).toContain("Monthly retainer");
    expect(out).toContain("9,500.00");
    expect(out).toContain("before VAT");
    expect(out).toContain("Every month from 15/08/2026");
    expect(out).toContain("15/10/2026");
    expect(out).toContain("none yet");
    expect(out).not.toContain("Issued by itself");
    expect(out).not.toContain("Paused");
  });

  it("says when a template is paused or issues by itself, and offers to pause or start it", () => {
    const paused = panel({ templates: [template({ isActive: false })] });
    expect(paused).toContain("Paused");
    expect(paused).toContain("Start again");
    const auto = panel({ templates: [template({ autoIssue: true })] });
    expect(auto).toContain("Issued by itself");
    expect(auto).toContain(">Pause<");
  });

  it("lets a template that made nothing be deleted, and one that made invoices only be paused", () => {
    expect(panel({ templates: [template({ invoiceCount: 0 })] })).toContain(">Delete<");
    const made = panel({
      templates: [template({ invoiceCount: 2, last: { invoiceId: "i1", period: "2026-09-15", status: "sent", documentNumber: "W-4" } })],
    });
    expect(made).not.toContain(">Delete<");
    expect(made).toContain(`href="/admin/${STORE}/work/invoices/i1"`);
    expect(made).toContain("W-4 for 15/09/2026");
  });

  it("lists due periods with what can be done, and says which the job will not make", () => {
    const out = panel({
      templates: [
        template({
          open: [
            { period: "2026-07-15", invoiceId: null, overdueForJob: true },
            { period: "2026-09-15", invoiceId: "d1", overdueForJob: false },
          ],
        }),
      ],
    });
    expect(out).toContain("Generate now");
    expect(out).toContain("Generate draft");
    expect(out).toContain("older than 40 days");
    expect(out).toContain("draft waiting to be issued");
    expect(out).toContain(`href="/admin/${STORE}/work/invoices/d1"`);
    expect(out).toContain("Skip this period");
    expect(out).toContain("Skip and delete the draft");
    expect(out).toContain("Issue now");
  });

  it("keeps the skipped periods where they can be restored", () => {
    const out = panel({ templates: [template({ skippedPeriods: ["2026-09-15"] })] });
    expect(out).toContain("Skipped periods (1)");
    expect(out).toContain("Restore");
  });
});

describe("the repeating invoice form", () => {
  const form = (over: Partial<Parameters<typeof RecurringForm>[0]> = {}) =>
    html(
      createElement(RecurringForm, {
        storeSlug: STORE,
        clientId: CLIENT,
        currency: "NOK",
        currencies: ["EUR", "NOK"],
        today: TODAY,
        canAutoIssue: true,
        ...over,
      }),
    );

  it("starts today, in the client's currency, with automatic issuing off", () => {
    const out = form();
    expect(out).toContain(`value="${TODAY}"`);
    expect(out).toContain("Price (NOK)");
    expect(out).toContain("Add repeating invoice");
    expect(out).not.toMatch(/name="autoIssue"[^>]*checked/);
    expect(out).toContain("waits for you to check and issue it");
  });

  it("fills in a template that is being changed", () => {
    const out = form({ template: template({ unitPriceMinor: 123_450, endDate: "2027-08-15", paymentDays: 30 }) });
    expect(out).toContain('value="1234.50"');
    expect(out).toContain('value="2027-08-15"');
    expect(out).toContain('value="30"');
    expect(out).toContain("Invoices already made are left as they are");
    expect(out).toContain(">Save<");
  });

  it("leaves automatic issuing to owners", () => {
    const admin = form({ canAutoIssue: false, template: template({ autoIssue: true }) });
    expect(admin).not.toContain('name="autoIssue"');
    expect(admin).toContain("Only an owner can change this.");
    expect(admin).toContain("Each invoice is issued and emailed by itself.");
    expect(form()).toContain('name="autoIssue"');
  });
});
