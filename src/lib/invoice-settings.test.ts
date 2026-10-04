import { describe, expect, it } from "vitest";

import { FOOTER_NOTE_MAX, cleanNote, parseInvoiceSettings, parseSeries, seriesProblem } from "./invoice-settings";

describe("the invoicing settings", () => {
  it("default to on, with no note, and the confirmation carrying the invoice", () => {
    expect(parseInvoiceSettings({})).toEqual({ ok: true, values: { enabled: true, footerNote: null, emailWithConfirmation: true } });
  });

  it("read a form's checkboxes", () => {
    const r = parseInvoiceSettings({ enabled: "false", emailWithConfirmation: "on", footerNote: "  Bank 1234  " });
    expect(r).toEqual({ ok: true, values: { enabled: false, footerNote: "Bank 1234", emailWithConfirmation: true } });
    expect(parseInvoiceSettings({ enabled: false, emailWithConfirmation: false })).toMatchObject({ values: { enabled: false, emailWithConfirmation: false } });
  });

  it("keeps the note to text: line breaks stay, other control characters go", () => {
    expect(cleanNote("a\r\nb\u0000c\u0007d\te")).toBe("a\nbcd\te");
  });

  it("refuses a note over the limit and counts characters, not bytes", () => {
    expect(parseInvoiceSettings({ footerNote: "å".repeat(FOOTER_NOTE_MAX) }).ok).toBe(true);
    const over = parseInvoiceSettings({ footerNote: "x".repeat(FOOTER_NOTE_MAX + 1) });
    expect(over).toMatchObject({ ok: false, errors: { footerNote: expect.any(String) } });
  });
});

describe("a series' prefix and first number", () => {
  it("takes either series, a prefix of up to 10 safe characters and a first number from 1", () => {
    expect(parseSeries({ series: "invoice", prefix: "F-", nextNumber: "1001" })).toEqual({ ok: true, series: "invoice", prefix: "F-", nextNumber: 1001 });
    expect(parseSeries({ series: "credit_note", prefix: "", nextNumber: 1 })).toEqual({ ok: true, series: "credit_note", prefix: "", nextNumber: 1 });
  });

  it("refuses anything else, with a message per field", () => {
    expect(parseSeries({ series: "order", prefix: "F-", nextNumber: 1 })).toMatchObject({ ok: false, errors: { series: expect.any(String) } });
    expect(parseSeries({ series: "invoice", prefix: "F F", nextNumber: 1 })).toMatchObject({ errors: { prefix: expect.any(String) } });
    expect(parseSeries({ series: "invoice", prefix: "ABCDEFGHIJK", nextNumber: 1 })).toMatchObject({ errors: { prefix: expect.any(String) } });
    for (const bad of ["0", "-3", "1.5", "abc", "", "1000000000"]) {
      expect(parseSeries({ series: "invoice", prefix: "F-", nextNumber: bad }), bad).toMatchObject({ ok: false, errors: { nextNumber: expect.any(String) } });
    }
  });

  it("says the database's refusals in words", () => {
    expect(seriesProblem("document_series.issued: numbers already issued cannot be changed")).toBe("Numbers already issued cannot be changed.");
    expect(seriesProblem("something unrelated")).toBeNull();
  });
});
