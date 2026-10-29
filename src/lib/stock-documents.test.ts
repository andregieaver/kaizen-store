import { describe, expect, it } from "vitest";

import { allIn, documentState, linesFromCsv, purchaseOrderInput, receiptPlan, transferInput, unitCostMinor, unitsToCome } from "./stock-documents";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("a stock document's state (D383)", () => {
  it("is partly received once some units are in, and draft, received and cancelled as stored", () => {
    expect(documentState("sent", [{ quantity: 3, received: 0 }])).toBe("open");
    expect(documentState("ordered", [{ quantity: 3, received: 1 }])).toBe("partly_received");
    expect(documentState("draft", [{ quantity: 3, received: 0 }])).toBe("draft");
    expect(documentState("cancelled", [{ quantity: 3, received: 1 }])).toBe("cancelled");
    expect(unitsToCome([{ quantity: 3, received: 1 }, { quantity: 2, received: 2 }])).toBe(2);
    expect(allIn([{ quantity: 2, received: 2 }])).toBe(true);
    expect(allIn([])).toBe(false);
  });
});

describe("what a receipt takes", () => {
  const lines = [
    { variantId: "v1", quantity: 5, received: 2 },
    { variantId: "v2", quantity: 1, received: 0 },
  ];

  it("cuts a figure to what is still to come and leaves out zeros and lines not on the document", () => {
    expect(receiptPlan(lines, [{ variantId: "v1", quantity: 9 }, { variantId: "v2", quantity: 0 }, { variantId: "v9", quantity: 4 }])).toEqual([{ variantId: "v1", quantity: 3 }]);
  });

  it("counts a line asked twice once, within what is to come", () => {
    expect(receiptPlan(lines, [{ variantId: "v1", quantity: 2 }, { variantId: "v1", quantity: 2 }])).toEqual([{ variantId: "v1", quantity: 3 }]);
  });
});

describe("what a person sends to make one", () => {
  it("refuses one place twice and a SKU on two lines", () => {
    expect(transferInput.safeParse({ origin: A, destination: A, lines: [{ sku: "X", quantity: 1 }] }).success).toBe(false);
    expect(transferInput.safeParse({ origin: A, destination: B, lines: [{ sku: "x", quantity: 1 }, { sku: "X", quantity: 2 }] }).success).toBe(false);
    expect(transferInput.parse({ origin: A, destination: B, note: " ", lines: [{ sku: " X ", quantity: "2" }] })).toEqual({ origin: A, destination: B, note: null, lines: [{ sku: "X", quantity: 2 }] });
  });

  it("reads a purchase order's currency and date, and a unit cost as typed", () => {
    const parsed = purchaseOrderInput.parse({ supplier: "Vevstua", currency: "nok", location: A, expectedOn: "", lines: [{ sku: "X", quantity: 1, unitCost: "45,50" }] });
    expect(parsed).toMatchObject({ currency: "NOK", expectedOn: null, reference: null });
    expect(purchaseOrderInput.safeParse({ supplier: "V", currency: "NOK", location: A, expectedOn: "next week", lines: [{ sku: "X", quantity: 1, unitCost: "1" }] }).success).toBe(false);
    expect(unitCostMinor("45,50", "NOK")).toBe(4550);
    expect(unitCostMinor("lots", "NOK")).toBeNull();
    expect(unitCostMinor("-1", "NOK")).toBeNull();
  });
});

describe("lines from a file", () => {
  const rows = (text: string) => ({ rows: text.split("\n").map((l) => l.split(",")), unterminated: false });

  it("reads SKU, units and an optional unit cost by their headers, skipping empty rows", () => {
    expect(linesFromCsv(rows("Variant SKU,Title,Quantity,Unit cost\nA,Cup,3,12.50\n,,,\nB,Mug,1,"))).toEqual({
      ok: true,
      lines: [
        { sku: "A", quantity: "3", unitCost: "12.50" },
        { sku: "B", quantity: "1", unitCost: "" },
      ],
    });
    expect(linesFromCsv(rows("varenummer,antall\nA,2"))).toMatchObject({ ok: true, lines: [{ sku: "A", quantity: "2" }] });
  });

  it("names what it cannot read", () => {
    expect(linesFromCsv(rows("Title,Quantity\nCup,1"))).toEqual({ ok: false, problem: { kind: "no_sku" } });
    expect(linesFromCsv(rows("SKU,Title\nA,Cup"))).toEqual({ ok: false, problem: { kind: "no_units" } });
    expect(linesFromCsv(rows("SKU,Quantity\nA,1\nB,1.5"))).toEqual({ ok: false, problem: { kind: "bad_row", row: 3 } });
    expect(linesFromCsv({ rows: [["SKU", "Quantity"]], unterminated: true })).toEqual({ ok: false, problem: { kind: "unreadable" } });
    const many = ["SKU,Quantity", ...Array.from({ length: 201 }, (_, i) => `S${i},1`)].join("\n");
    expect(linesFromCsv(rows(many))).toEqual({ ok: false, problem: { kind: "too_many" } });
  });
});
