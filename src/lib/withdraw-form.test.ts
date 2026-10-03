import { describe, expect, it } from "vitest";

import {
  FIELD,
  declaredLines,
  emptyForm,
  fieldErrorsOf,
  isIntent,
  lineField,
  orderInfoOf,
  pickedLines,
  quantityNotice,
  refusalCode,
  returnableLines,
  valuesOf,
  withdrawableLines,
  type OrderInfo,
} from "./withdraw-form";

const form = (pairs: [string, string][]): [string, FormDataEntryValue][] => pairs;
const A = "6f1f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b10";
const B = "7a2f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b11";

const order: OrderInfo = {
  number: "1042",
  storeName: "Demo",
  contactEmail: "butikk@example.com",
  window: { state: "statutory", basis: "delivered", statutoryEndDay: "2026-10-16", voluntaryEndDay: "2026-10-16" },
  right: "withdrawal",
  subscription: false,
  timeZone: "Europe/Oslo",
  lines: [
    { lineId: A, title: "Lampe", quantity: 3, right: "withdrawal", max: 2, refusal: null, exclusion: null, sealed: false },
    { lineId: B, title: "Kopp med navn", quantity: 1, right: "none", max: 0, refusal: "excluded_by_law", exclusion: "custom_made", sealed: false },
    { lineId: "c", title: "Vase", quantity: 1, right: "return", max: 1, refusal: null, exclusion: null, sealed: false },
  ],
};

describe("the withdrawal form's fields (D153)", () => {
  it("reads who is asking from the identifying fields, trimmed", () => {
    expect(valuesOf(form([[FIELD.name, "  Kari Nordmann "], [FIELD.email, " kari@example.com"], [FIELD.orderNumber, " 1042 "]]))).toEqual({
      name: "Kari Nordmann",
      email: "kari@example.com",
      orderNumber: "1042",
    });
    expect(valuesOf(form([]))).toEqual({ name: "", email: "", orderNumber: "" });
  });

  it("knows the buttons by what they do, and nothing else", () => {
    for (const intent of ["start", "confirm", "edit", "return"]) expect(isIntent(intent)).toBe(true);
    for (const intent of ["", "delete", "Confirm", undefined, 3]) expect(isIntent(intent)).toBe(false);
  });

  it("reads ticked lines with their numbers, and a ticked line with no readable number as 0", () => {
    const entries = form([
      [lineField("take", A), "on"],
      [lineField("qty", A), " 2 "],
      [lineField("take", B), "on"],
      [lineField("qty", B), "two"],
      // An unticked box sends nothing; a number without a tick is not declared.
      [lineField("qty", "c"), "5"],
    ]);
    expect(declaredLines(entries)).toEqual([
      { lineId: A, quantity: 2 },
      { lineId: B, quantity: 0 },
    ]);
    expect(declaredLines(form([[lineField("take", A), "on"], [lineField("qty", A), "-1"]]))).toEqual([{ lineId: A, quantity: 0 }]);
    expect(declaredLines(form([[lineField("take", A), "on"], [lineField("qty", A), "1.5"]]))).toEqual([{ lineId: A, quantity: 0 }]);
  });

  it("keeps the return request's lines apart from the withdrawal's", () => {
    const entries = form([
      [lineField("take", A), "on"],
      [lineField("qty", A), "1"],
      [lineField("rtake", "c"), "on"],
      [lineField("rqty", "c"), "1"],
    ]);
    expect(declaredLines(entries, "take")).toEqual([{ lineId: A, quantity: 1 }]);
    expect(declaredLines(entries, "rtake")).toEqual([{ lineId: "c", quantity: 1 }]);
  });

  it("carries step 2's lines back to the form", () => {
    expect(pickedLines(form([[lineField("pick", A), "2"], [lineField("pick", B), "x"], [FIELD.name, "Kari"]]))).toEqual({ [A]: 2, [B]: 0 });
  });
});

describe("what the action answers", () => {
  it("shows only what the form needs of an order: no money, no address, no person", () => {
    const info = orderInfoOf({
      number: "1042",
      storeName: "Demo",
      contactEmail: null,
      window: { state: "closed", basis: "delivered", statutoryEndDay: "2026-09-01", voluntaryEndDay: "2026-09-01" },
      right: "none",
      subscription: true,
      timeZone: "Europe/Oslo",
      lines: [{ lineId: A, title: "Lampe", quantity: 1, right: "none", maxQuantity: 0, refusal: "period_over", exclusion: null, sealed: false }],
    });
    expect(Object.keys(info).sort()).toEqual(["contactEmail", "lines", "number", "right", "storeName", "subscription", "timeZone", "window"]);
    expect(info.lines[0]).toEqual({ lineId: A, title: "Lampe", quantity: 1, right: "none", max: 0, refusal: "period_over", exclusion: null, sealed: false });
  });

  it("declares everything that can be withdrawn, in full, when no line was chosen", () => {
    expect(withdrawableLines(order)).toEqual([{ lineId: A, quantity: 2 }]);
    // A line the law excludes is never declared for the shopper, and a return line is another request.
    expect(withdrawableLines({ lines: order.lines.filter((l) => l.right !== "withdrawal") })).toEqual([]);
    expect(returnableLines(order).map((l) => l.lineId)).toEqual(["c"]);
  });

  it("maps a failed check to the field it belongs to, with its code", () => {
    expect(
      fieldErrorsOf([
        { path: "email", code: "email" },
        { path: "name", code: "required" },
        { path: "lines.0.quantity", code: "quantity" },
        { path: "lines", code: "lines" },
        { path: "orderNumber", code: "too_long" },
        { path: "email", code: "too_long" },
        { path: "mystery", code: "x" },
      ]),
    ).toEqual({ email: "email", name: "required", lines: "quantity", orderNumber: "too_long" });
    expect(fieldErrorsOf([])).toEqual({});
  });

  it("starts a form with what was typed and nothing proven, and says what was wrong with a quantity", () => {
    const start = emptyForm({ name: "Kari", orderNumber: "1042" });
    expect(start).toMatchObject({ phase: "form", values: { name: "Kari", email: "", orderNumber: "1042" }, order: null, notice: null, returned: null, serial: 0, orderKey: null });
    expect(quantityNotice([{ lineId: A, code: "too_many" }])).toBe("quantity");
    expect(quantityNotice([])).toBe("nothing");
  });

  it("tells a system's reason from the words a person wrote", () => {
    expect(refusalCode("excluded_by_law")).toBe("excluded_by_law");
    expect(refusalCode("Opened and used")).toBeNull();
    expect(refusalCode(null)).toBeNull();
  });
});
