import { describe, expect, it } from "vitest";

import { UNNAMED_LINE } from "./work-calc";
import {
  MAX_INVOICE_LINES,
  addressText,
  assignmentInput,
  clientInput,
  creditNoteInput,
  invoiceDraftInput,
  invoiceInput,
  invoiceLineInput,
  issueInvoiceInput,
  numberSeriesInput,
  recordPaymentInput,
  recurringInvoiceInput,
  startTimerInput,
  taskInput,
  timeEntryInput,
  timeEntryNoteInput,
  workSettingsInput,
} from "./work-input";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The messages of the first problem at a path, or null when the input is fine. */
function problem(
  schema: {
    safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
) {
  const r = schema.safeParse(value);
  return r.success ? null : r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("clients", () => {
  const valid = { name: "  Acme AS ", currency: "nok" };

  it("takes a name and a currency and fills in the rest", () => {
    const client = clientInput.parse(valid);
    expect(client).toMatchObject({
      name: "Acme AS",
      currency: "NOK",
      locale: "en",
      business: true,
      vatTreatment: "domestic",
      usePrepaid: true,
      legalName: null,
      country: null,
      billingAddress: null,
      billingEmail: null,
      defaultHourlyRateMinor: null,
      paymentDays: null,
      customerCompanyId: null,
      notes: null,
    });
  });

  it("cleans what is typed: empty text becomes null, VAT numbers are normalised, countries upper-cased", () => {
    const client = clientInput.parse({
      ...valid,
      legalName: "  ",
      vatNumber: "no 123.456.789 mva",
      country: "no",
      billingEmail: "  ap@acme.example ",
      locale: "nb-NO",
      defaultHourlyRateMinor: 120_000,
      paymentDays: 30,
      customerCompanyId: id(1),
    });
    expect(client).toMatchObject({
      legalName: null,
      vatNumber: "NO123456789MVA",
      country: "NO",
      billingEmail: "ap@acme.example",
      locale: "nb-NO",
      defaultHourlyRateMinor: 120_000,
      paymentDays: 30,
      customerCompanyId: id(1),
    });
  });

  it("refuses a blank name, an unknown currency, a bad email and limits", () => {
    expect(problem(clientInput, { ...valid, name: "  " })).toEqual(["name: Give the client a name."]);
    expect(problem(clientInput, { ...valid, name: "x".repeat(121) })).not.toBeNull();
    expect(problem(clientInput, { ...valid, currency: "XXX" })).toEqual(["currency: Choose a currency."]);
    expect(problem(clientInput, { ...valid, billingEmail: "not-an-email" })).toEqual([
      "billingEmail: That email address is not right.",
    ]);
    expect(problem(clientInput, { ...valid, paymentDays: 0 })).not.toBeNull();
    expect(problem(clientInput, { ...valid, paymentDays: 91 })).not.toBeNull();
    expect(problem(clientInput, { ...valid, defaultHourlyRateMinor: -1 })).not.toBeNull();
    expect(problem(clientInput, { ...valid, defaultHourlyRateMinor: 1.5 })).not.toBeNull();
    expect(problem(clientInput, { ...valid, country: "Norway" })).not.toBeNull();
    expect(problem(clientInput, { ...valid, customerId: "not-a-uuid" })).not.toBeNull();
    expect(problem(clientInput, { ...valid, locale: "Norsk" })).not.toBeNull();
  });

  it("does not let a private customer have anything but domestic VAT", () => {
    expect(problem(clientInput, { ...valid, business: false, vatTreatment: "reverse_charge" })).toEqual([
      "vatTreatment: A private customer is always charged VAT at the domestic rate.",
    ]);
    expect(problem(clientInput, { ...valid, business: false })).toBeNull();
    expect(problem(clientInput, { ...valid, vatTreatment: "reverse_charge" })).toBeNull();
    expect(problem(clientInput, { ...valid, vatTreatment: "zero_rated" })).not.toBeNull();
  });

  it("writes an address as one text", () => {
    expect(addressText({ line1: "Storgata 1", line2: "", postalCode: "0155", city: "Oslo" }, "NO")).toBe(
      "Storgata 1, 0155 Oslo, NO",
    );
    expect(addressText({ line1: "Storgata 1", postalCode: "", city: "" })).toBe("Storgata 1");
    expect(addressText(null)).toBe("");
  });
});

describe("assignments, tasks and time", () => {
  it("takes an hourly assignment", () => {
    const a = assignmentInput.parse({
      clientId: id(1),
      name: "Website",
      estimatedMinutes: 600,
      startDate: "2026-09-01",
    });
    expect(a).toMatchObject({
      status: "active",
      billingType: "hourly",
      hourlyRateMinor: null,
      estimatedMinutes: 600,
      startDate: "2026-09-01",
      endDate: null,
      estimateAlertMinutes: null,
      estimateAlertPopup: true,
    });
  });

  it("needs an amount for a fixed fee and dates in order", () => {
    const base = { clientId: id(1), name: "Retainer", billingType: "fixed_fee" };
    expect(problem(assignmentInput, base)).toEqual(["fixedAmountMinor: A fixed fee needs an amount."]);
    expect(problem(assignmentInput, { ...base, fixedAmountMinor: 500_000 })).toBeNull();
    expect(
      problem(assignmentInput, { clientId: id(1), name: "x", startDate: "2026-09-10", endDate: "2026-09-01" }),
    ).toEqual(["endDate: The end comes before the start."]);
    expect(problem(assignmentInput, { clientId: id(1), name: "x", startDate: "2026-02-30" })).not.toBeNull();
    expect(problem(assignmentInput, { clientId: id(1), name: "x", estimateAlertMinutes: 481 })).not.toBeNull();
    expect(problem(assignmentInput, { clientId: id(1), name: "x", estimatedMinutes: 0 })).not.toBeNull();
  });

  it("takes tasks", () => {
    expect(taskInput.parse({ assignmentId: id(1), title: " Design " })).toEqual({
      assignmentId: id(1),
      title: "Design",
      status: "open",
      estimatedMinutes: null,
    });
    expect(problem(taskInput, { assignmentId: id(1), title: "" })).not.toBeNull();
  });

  it("takes time entries of a minute to a day", () => {
    const base = { assignmentId: id(1), workDate: "2026-09-29", minutes: 90 };
    expect(timeEntryInput.parse(base)).toMatchObject({ billable: true, note: null, taskId: null, minutes: 90 });
    expect(problem(timeEntryInput, { ...base, minutes: 0 })).not.toBeNull();
    expect(problem(timeEntryInput, { ...base, minutes: 1441 })).not.toBeNull();
    expect(problem(timeEntryInput, { ...base, minutes: 1.5 })).not.toBeNull();
    expect(problem(timeEntryInput, { ...base, workDate: "29.09.2026" })).not.toBeNull();
    expect(problem(timeEntryInput, { ...base, note: "x".repeat(501) })).not.toBeNull();
    expect(timeEntryInput.parse({ ...base, note: "x".repeat(500), taskId: id(2) }).taskId).toBe(id(2));
  });

  it("lets only the note change after logging", () => {
    expect(timeEntryNoteInput.parse({ note: " a note " })).toEqual({ note: "a note" });
    expect(timeEntryNoteInput.parse({ note: "", minutes: 5 })).toEqual({ note: null });
    expect(startTimerInput.parse({ assignmentId: id(1) })).toEqual({ assignmentId: id(1), taskId: null });
  });
});

describe("invoice lines and drafts", () => {
  const line = { description: "Consulting", quantityHundredths: 175, unitPriceMinor: 120_000, discountBp: 0 };

  it("takes a line: a category, never a free VAT percentage", () => {
    const parsed = invoiceLineInput.parse({ ...line, vatPercent: 99, vatRate: 0.99 });
    expect(parsed).toMatchObject({ vatCategory: "standard", unit: "hour", quantityManual: false, id: null });
    expect(parsed).not.toHaveProperty("vatPercent");
    expect(parsed).not.toHaveProperty("vatRate");
    expect(problem(invoiceLineInput, { ...line, vatCategory: "reduced" })).not.toBeNull();
    expect(invoiceLineInput.parse({ ...line, vatCategory: "reverse_charge" }).vatCategory).toBe("reverse_charge");
  });

  it("names an unnamed line with the placeholder", () => {
    expect(invoiceLineInput.parse({ ...line, description: "   " }).description).toBe(UNNAMED_LINE);
    expect(invoiceLineInput.parse({ ...line, description: " Design " }).description).toBe("Design");
    expect(problem(invoiceLineInput, { ...line, description: "x".repeat(501) })).not.toBeNull();
  });

  it("holds quantities, prices and discounts to their limits", () => {
    expect(problem(invoiceLineInput, { ...line, quantityHundredths: 10_000_001 })).not.toBeNull();
    expect(problem(invoiceLineInput, { ...line, quantityHundredths: -1 })).not.toBeNull();
    expect(problem(invoiceLineInput, { ...line, quantityHundredths: 1.5 })).not.toBeNull();
    expect(problem(invoiceLineInput, { ...line, unitPriceMinor: 1_000_000_001 })).not.toBeNull();
    expect(problem(invoiceLineInput, { ...line, unitPriceMinor: -1 })).not.toBeNull();
    expect(problem(invoiceLineInput, { ...line, discountBp: 10_001 })).not.toBeNull();
    expect(
      problem(invoiceLineInput, {
        ...line,
        quantityHundredths: 10_000_000,
        unitPriceMinor: 1_000_000_000,
        discountBp: 10_000,
      }),
    ).toBeNull();
    expect(problem(invoiceLineInput, { ...line, unit: "days" })).not.toBeNull();
  });

  it("takes a draft's header and keeps the period in order", () => {
    const header = { clientId: id(1), currency: "eur" };
    expect(invoiceDraftInput.parse(header)).toMatchObject({
      currency: "EUR",
      assignmentId: null,
      paymentDays: null,
      notes: null,
    });
    expect(problem(invoiceDraftInput, { ...header, serviceFrom: "2026-09-30", serviceTo: "2026-09-01" })).toEqual([
      "serviceTo: The period ends before it starts.",
    ]);
    expect(problem(invoiceDraftInput, { ...header, reference: "x".repeat(101) })).not.toBeNull();
  });

  it("takes a whole invoice, in order, with each line's id used once", () => {
    const header = { clientId: id(1), currency: "NOK" };
    const parsed = invoiceInput.parse({
      ...header,
      lines: [{ ...line, id: id(5) }, { ...line, id: null }, { ...line }],
    });
    expect(parsed.lines.map((l) => l.id)).toEqual([id(5), null, null]);
    expect(
      problem(invoiceInput, {
        ...header,
        lines: [
          { ...line, id: id(5) },
          { ...line, id: id(5) },
        ],
      }),
    ).toEqual(["lines.1.id: A line appears twice."]);
    expect(
      problem(invoiceInput, { ...header, lines: Array.from({ length: MAX_INVOICE_LINES + 1 }, () => line) }),
    ).not.toBeNull();
    expect(
      problem(invoiceInput, { ...header, lines: Array.from({ length: MAX_INVOICE_LINES }, () => line) }),
    ).toBeNull();
    expect(problem(invoiceInput, { ...header, lines: [] })).toBeNull();
  });

  it("issues with an optional date and an explicit confirmation to go earlier", () => {
    expect(issueInvoiceInput.parse({ invoiceId: id(1) })).toEqual({
      invoiceId: id(1),
      issuedOn: null,
      confirmEarlierDate: false,
    });
    expect(problem(issueInvoiceInput, { invoiceId: id(1), issuedOn: "yesterday" })).not.toBeNull();
  });
});

describe("recurring templates", () => {
  const base = {
    clientId: id(1),
    name: "Monthly support",
    quantityHundredths: 100,
    unitPriceMinor: 500_000,
    currency: "NOK",
    recurrenceInterval: 1,
    recurrencePeriod: "month",
    startDate: "2026-10-01",
  };

  it("keeps auto-issue off unless it is switched on", () => {
    expect(recurringInvoiceInput.parse(base)).toMatchObject({
      autoIssue: false,
      isActive: true,
      endDate: null,
      vatCategory: "standard",
      discountBp: 0,
    });
    expect(recurringInvoiceInput.parse({ ...base, autoIssue: true }).autoIssue).toBe(true);
  });

  it("holds the rule to Life's intervals and periods and keeps the end after the start", () => {
    expect(problem(recurringInvoiceInput, { ...base, recurrenceInterval: 5 })).not.toBeNull();
    expect(problem(recurringInvoiceInput, { ...base, recurrenceInterval: 0 })).not.toBeNull();
    expect(problem(recurringInvoiceInput, { ...base, recurrencePeriod: "day" })).not.toBeNull();
    expect(problem(recurringInvoiceInput, { ...base, recurrencePeriod: "year", recurrenceInterval: 4 })).toBeNull();
    expect(problem(recurringInvoiceInput, { ...base, endDate: "2026-09-30" })).toEqual([
      "endDate: The end comes before the start.",
    ]);
    expect(problem(recurringInvoiceInput, { ...base, quantityHundredths: 0 })).not.toBeNull();
    expect(problem(recurringInvoiceInput, { ...base, name: "" })).not.toBeNull();
  });
});

describe("settings", () => {
  it("takes the VAT registration and payment details", () => {
    const s = workSettingsInput.parse({
      vatRegistered: true,
      vatNumber: "no 123 456 789 mva",
      bankAccount: "NO93 8601 1117 947",
      bic: "dnbanokk",
    });
    expect(s).toMatchObject({
      vatNumber: "NO123456789MVA",
      bankAccount: "NO93 8601 1117 947",
      bic: "DNBANOKK",
      defaultPaymentDays: 14,
      estimateAlertMinutes: 10,
      estimateAlertPopup: true,
      estimateAlertSound: false,
      showTimeNotesToClients: false,
      paymentNote: null,
    });
  });

  it("checks an IBAN's digits but accepts a national account number", () => {
    expect(problem(workSettingsInput, { vatRegistered: false, bankAccount: "NO94 8601 1117 947" })).toEqual([
      "bankAccount: The IBAN is not right. Check it against your bank's.",
    ]);
    expect(problem(workSettingsInput, { vatRegistered: false, bankAccount: "1234.56.78903" })).toBeNull();
    expect(problem(workSettingsInput, { vatRegistered: false, bankAccount: "" })).toBeNull();
  });

  it("checks the BIC, the terms and the warning minutes", () => {
    expect(problem(workSettingsInput, { vatRegistered: false, bic: "abc" })).not.toBeNull();
    expect(problem(workSettingsInput, { vatRegistered: false, bic: "DNBANOKKXXX" })).toBeNull();
    expect(problem(workSettingsInput, { vatRegistered: false, bic: "" })).toBeNull();
    expect(problem(workSettingsInput, { vatRegistered: false, defaultPaymentDays: 91 })).not.toBeNull();
    expect(problem(workSettingsInput, { vatRegistered: false, estimateAlertMinutes: null })).toBeNull();
    expect(problem(workSettingsInput, { vatRegistered: false, estimateAlertMinutes: 0 })).not.toBeNull();
    expect(problem(workSettingsInput, {})).not.toBeNull();
  });

  it("takes a number series' prefix and next number", () => {
    expect(numberSeriesInput.parse({ series: "work_invoice", prefix: " W- ", nextNumber: 1001 })).toEqual({
      series: "work_invoice",
      prefix: "W-",
      nextNumber: 1001,
    });
    expect(numberSeriesInput.parse({ series: "work_credit_note", prefix: "", nextNumber: 1 }).prefix).toBe("");
    expect(problem(numberSeriesInput, { series: "invoice", prefix: "W-", nextNumber: 1 })).not.toBeNull();
    expect(problem(numberSeriesInput, { series: "work_invoice", prefix: "W- 1", nextNumber: 1 })).not.toBeNull();
    expect(
      problem(numberSeriesInput, { series: "work_invoice", prefix: "TOOLONGPREFIX1", nextNumber: 1 }),
    ).not.toBeNull();
    expect(problem(numberSeriesInput, { series: "work_invoice", prefix: "W-", nextNumber: 0 })).not.toBeNull();
  });
});

describe("payments and credit notes", () => {
  it("records a payment by hand", () => {
    expect(recordPaymentInput.parse({ invoiceId: id(1), amountMinor: 229_688, receivedOn: "2026-10-01" })).toEqual({
      invoiceId: id(1),
      amountMinor: 229_688,
      receivedOn: "2026-10-01",
      method: "bank",
      reference: null,
    });
    expect(problem(recordPaymentInput, { invoiceId: id(1), amountMinor: 0, receivedOn: "2026-10-01" })).not.toBeNull();
    expect(problem(recordPaymentInput, { invoiceId: id(1), amountMinor: -5, receivedOn: "2026-10-01" })).not.toBeNull();
    expect(
      problem(recordPaymentInput, { invoiceId: id(1), amountMinor: 5, receivedOn: "2026-10-01", method: "stripe" }),
    ).not.toBeNull();
    expect(
      problem(recordPaymentInput, { invoiceId: id(1), amountMinor: 5, receivedOn: "2026-10-01", method: "prepaid" }),
    ).not.toBeNull();
  });

  it("credits a whole invoice or chosen lines, with a reason", () => {
    expect(creditNoteInput.parse({ invoiceId: id(1), reason: " Wrong rate ", kind: "full" })).toMatchObject({
      kind: "full",
      lines: [],
      reason: "Wrong rate",
    });
    expect(problem(creditNoteInput, { invoiceId: id(1), reason: "", kind: "full" })).not.toBeNull();
    expect(problem(creditNoteInput, { invoiceId: id(1), reason: "x", kind: "partial" })).toEqual([
      "lines: Choose the lines to credit.",
    ]);
    expect(
      problem(creditNoteInput, {
        invoiceId: id(1),
        reason: "x",
        kind: "full",
        lines: [{ lineId: id(2), quantityHundredths: 100 }],
      }),
    ).toEqual(["lines: A full credit note credits every line."]);
    expect(
      problem(creditNoteInput, {
        invoiceId: id(1),
        reason: "x",
        kind: "partial",
        lines: [{ lineId: id(2), quantityHundredths: 100 }],
      }),
    ).toBeNull();
    expect(
      problem(creditNoteInput, {
        invoiceId: id(1),
        reason: "x",
        kind: "partial",
        lines: [
          { lineId: id(2), quantityHundredths: 100 },
          { lineId: id(2), quantityHundredths: 50 },
        ],
      }),
    ).toEqual(["lines.1.lineId: A line appears twice."]);
    expect(
      problem(creditNoteInput, {
        invoiceId: id(1),
        reason: "x",
        kind: "partial",
        lines: [{ lineId: id(2), quantityHundredths: 0 }],
      }),
    ).not.toBeNull();
  });
});
