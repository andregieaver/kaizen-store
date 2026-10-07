import { describe, expect, it } from "vitest";

import { editInputFromForm, initialEditForm, variantsTakenOff, type EditorOrderLine } from "./order-edit-form";
import { addedMug, BOOK, MUG, summaryOf } from "./order-edit-view-fixture";
import { applyLabel, ratePercent } from "./order-edit-view";
import { fulfilmentEventText } from "./fulfilment-events-text";
import { parcelLinesFromChoice, parcelLinesFromForm, unitsInChoice } from "./parcel-form";

const money = (minor: number) => `${(minor / 100).toFixed(2)} kr`;

describe("the editor's summary (editSummaryView): the server's preview as rows, nothing priced again", () => {
  it("lists what is taken off and added with the preview's own amounts, and the totals before and after", () => {
    const { preview, view } = summaryOf({ quantities: { [MUG]: 1, [BOOK]: 0 }, added: [addedMug()] });
    const priced = preview.priced!;
    expect(view.takenOff.map((l) => [l.kind, l.quantity])).toEqual([
      ["reduce", 2],
      ["remove", 1],
    ]);
    expect(view.added).toHaveLength(1);
    expect(view.added[0]).toMatchObject({ kind: "add", sku: "PLATE-1", quantity: 2, unitPriceMinor: 14900, totalMinor: 29800, custom: false });
    // Every amount is the preview's: the lines and the totals are passed through untouched.
    for (const line of [...view.takenOff, ...view.added]) {
      const row = priced.lines.find((l) => l.n === line.n)!;
      expect([line.totalMinor, line.taxMinor, line.taxRate]).toEqual([row.totalMinor, row.taxMinor, row.taxRate]);
    }
    expect(view.before).toEqual(priced.before);
    expect(view.after).toEqual(priced.after);
    expect(view.differenceMinor).toBe(priced.differenceMinor);
    expect(view.base).toBe(preview.base);
  });

  it("says how much each rate's VAT moves, and the shipping's, adding up to the change of the order's VAT", () => {
    const { preview, view } = summaryOf({ quantities: { [BOOK]: 0 }, added: [addedMug()], shipping: { kind: "set", amountMinor: 4900 } });
    const priced = preview.priced!;
    const sum = view.vatChanges.reduce((s, v) => s + v.deltaMinor, 0) + view.shippingVatDeltaMinor;
    expect(sum).toBe(priced.taxDelta);
    // The book is at 0 %: taking it off moves no VAT, so no row for it.
    expect(view.vatChanges.map((v) => v.rate)).toEqual([0.25]);
    expect(view.shippingVatDeltaMinor).toBeLessThan(0);
  });

  it("keeps the backorder and custom price of an added product, and a refund's sentence", () => {
    const { view } = summaryOf({ quantities: { [MUG]: 1 }, added: [addedMug({ key: "a2", unitPriceMinor: 5000 })] });
    expect(view.added[0].custom).toBe(true);
    expect(view.added[0].backorder).toEqual({ units: 2, days: 10 });
    expect(view.money).toBe("refund");
    expect(view.sentences.money).toMatch(/refunded to the customer's card/);
  });

  it("has no lines or totals when nothing could be priced, only the problems", () => {
    const { view } = summaryOf({ quantities: { [MUG]: 7 } });
    expect(view.ok).toBe(false);
    expect(view.problems.map((p) => p.code)).toContain("only_down");
  });

  it("words the rate and the main button", () => {
    expect(ratePercent(0.25)).toBe("25 %");
    expect(ratePercent(0.125)).toBe("12.5 %");
    expect(applyLabel("charge")).toBe("Send the customer a pay link");
    expect(applyLabel("refund")).toBe("Save the change and refund");
    expect(applyLabel("none")).toBe("Save the change");
  });
});

const lines: EditorOrderLine[] = [
  { lineId: MUG, variantId: "v-mug", title: "Mug", sku: "MUG", quantity: 3, unitPriceMinor: 10000, totalMinor: 30000, editable: true, gift: false },
  { lineId: BOOK, variantId: null, title: "E-book", sku: "EBOOK", quantity: 1, unitPriceMinor: 5000, totalMinor: 5000, editable: false, gift: false },
];

describe("the editor's form (editInputFromForm): what the server is asked, never a total", () => {
  it("sends only the lines that changed, and nothing for a line that cannot change", () => {
    const state = initialEditForm(lines);
    expect(editInputFromForm(state, lines, "NOK").raw.quantities).toEqual({});
    const changed = { ...state, quantities: { ...state.quantities, [MUG]: "1", [BOOK]: "0" } };
    expect(editInputFromForm(changed, lines, "NOK").raw.quantities).toEqual({ [MUG]: 1 });
  });

  it("reads a typed price in the order's currency, empty as the list price, and refuses what is not a number", () => {
    const state = {
      ...initialEditForm(lines),
      added: [
        { variantId: "v1", title: "Plate", sku: "P", options: "", listPriceMinor: 14900, quantity: "2", price: "" },
        { variantId: "v2", title: "Bowl", sku: "B", options: "", listPriceMinor: 9900, quantity: "1", price: "79,50" },
      ],
    };
    const input = editInputFromForm(state, lines, "NOK");
    expect(input.raw.added).toEqual([
      { variantId: "v1", quantity: 2 },
      { variantId: "v2", quantity: 1, unitPriceMinor: 7950 },
    ]);
    expect(input.problems).toEqual([]);
    const bad = editInputFromForm({ ...state, added: [{ ...state.added[0], quantity: "two", price: "abc" }] }, lines, "NOK");
    expect(bad.problems).toHaveLength(2);
    // A whole amount in euros (a euro view of a krone order is priced in the order's own currency, whatever it is).
    expect(editInputFromForm({ ...state, added: [{ ...state.added[1], price: "15" }] }, lines, "EUR").raw.added[0].unitPriceMinor).toBe(1500);
  });

  it("sets the shipping, needs a reason before saving (previewed as Other until then), and keeps the note only when written", () => {
    const state = { ...initialEditForm(lines), shipping: { kind: "set" as const, amount: "49" } };
    const input = editInputFromForm(state, lines, "EUR");
    expect(input.raw.shipping).toEqual({ kind: "set", amountMinor: 4900 });
    expect(input.reasonMissing).toBe(true);
    expect(input.raw.reason).toBe("other");
    expect("note" in input.raw).toBe(false);
    const chosen = editInputFromForm({ ...state, reason: "out_of_stock", note: "  shelf empty  " }, lines, "EUR");
    expect(chosen.reasonMissing).toBe(false);
    expect(chosen.raw.reason).toBe("out_of_stock");
    expect(chosen.raw.note).toBe("shelf empty");
  });

  it("names the variants taken off for the restock choice, and drops the choice when nothing is put back", () => {
    const state = { ...initialEditForm(lines), quantities: { [MUG]: "2", [BOOK]: "0" }, noRestock: ["v-mug"] };
    expect(variantsTakenOff(state, lines)).toEqual([{ variantId: "v-mug", title: "Mug" }]);
    expect(editInputFromForm(state, lines, "NOK").raw.noRestock).toEqual(["v-mug"]);
    expect(editInputFromForm({ ...state, restock: false }, lines, "NOK").raw.noRestock).toEqual([]);
  });
});

describe("the parcel form (parcelLinesFromForm)", () => {
  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };

  it("is everything still to send without a choice (a weekly box, an old form)", () => {
    expect(parcelLinesFromForm(form([["carrier", "posten"]]))).toBeNull();
  });

  it("reads each line's units, 0 included (the server leaves those out)", () => {
    expect(parcelLinesFromForm(form([["parcel", "lines"], [`qty:${MUG}`, "2"], [`qty:${BOOK}`, "0"]]))).toEqual([
      { lineId: MUG, quantity: 2 },
      { lineId: BOOK, quantity: 0 },
    ]);
  });

  it("refuses a quantity that is not a whole number, and a field that is not a line id", () => {
    expect(parcelLinesFromForm(form([["parcel", "lines"], [`qty:${MUG}`, "-1"]]))).toBe("invalid");
    expect(parcelLinesFromForm(form([["parcel", "lines"], [`qty:${MUG}`, "1.5"]]))).toBe("invalid");
    expect(parcelLinesFromForm(form([["parcel", "lines"], ["qty:abc", "1"]]))).toBe("invalid");
  });
});

describe("a carrier booking's parcel (parcelLinesFromChoice)", () => {
  const rows = [
    { lineId: MUG, toSend: 3 },
    { lineId: BOOK, toSend: 1 },
    { lineId: "33333333-3333-4333-8333-333333333333", toSend: 0 },
  ];

  it("is everything still to send when nothing is lowered (the booking's meaning before parcels named their lines)", () => {
    expect(parcelLinesFromChoice(rows, {})).toBeNull();
    expect(parcelLinesFromChoice(rows, { [MUG]: "3", [BOOK]: " 1 " })).toBeNull();
    expect(unitsInChoice(rows, null)).toBe(4);
    expect(parcelLinesFromChoice([], {})).toBeNull();
  });

  it("names every open line once something is lowered, 0 included, and never a line with nothing left", () => {
    const lines = parcelLinesFromChoice(rows, { [MUG]: "2", [BOOK]: "0" });
    expect(lines).toEqual([
      { lineId: MUG, quantity: 2 },
      { lineId: BOOK, quantity: 0 },
    ]);
    expect(unitsInChoice(rows, lines as never)).toBe(2);
    // A line not typed keeps all it has left.
    expect(parcelLinesFromChoice(rows, { [BOOK]: "0" })).toEqual([
      { lineId: MUG, quantity: 3 },
      { lineId: BOOK, quantity: 0 },
    ]);
  });

  it("refuses what is not a whole number, and more than is left of the line", () => {
    for (const typed of ["", "-1", "1.5", "x", "1234567"]) expect(parcelLinesFromChoice(rows, { [MUG]: typed }), typed).toBe("invalid");
    expect(parcelLinesFromChoice(rows, { [MUG]: "4" })).toBe("invalid");
  });
});

describe("the history's words for parcels and changes (fulfilmentEventText)", () => {
  it("says what a parcel held and what is left; an event from before parcels named their lines as before", () => {
    expect(fulfilmentEventText("order.sent", { carrier: "Posten", tracking: "ABC", units: 2, left: 1 }, money)).toBe("Parcel sent with Posten (ABC): 2 units, 1 unit still to send");
    expect(fulfilmentEventText("order.sent", { carrier: "Posten", units: 3, left: 0 }, money)).toBe("Parcel sent with Posten: 3 units, nothing left to send");
    expect(fulfilmentEventText("order.sent", { carrier: "Posten", tracking: "ABC" }, money)).toBe("Sent with Posten (ABC)");
  });

  it("says what a change did with its number, difference, totals, reason and staff's note", () => {
    const text = fulfilmentEventText(
      "order.edit_applied",
      { label: "E1", difference: -10000, reason: "out_of_stock", before: { totals: { totalMinor: 49900 } }, after: { totals: { totalMinor: 39900 } }, note: "shelf empty" },
      money,
    );
    expect(text).toBe("Order changed (E1) (−100.00 kr), total 499.00 kr → 399.00 kr · Out of stock · shelf empty");
    expect(fulfilmentEventText("order.edit_sent", { label: "E2", difference: 14900, emailed: true }, money)).toBe("Change E2 waiting for the customer's payment of 149.00 kr: emailed to the customer");
    expect(fulfilmentEventText("order.edit_sent", { label: "E2", again: true, emailed: false }, money)).toBe("New pay link for change E2: made into a link to share");
    expect(fulfilmentEventText("order.edit_expired", { label: "E2" }, money)).toBe("Change expired unpaid (E2)");
    expect(fulfilmentEventText("order.edit_paid_outside", { label: "E3", method: "bank_transfer", note: "ref 77" }, money)).toBe("Change paid outside Kaizen (E3): bank transfer · ref 77");
    expect(fulfilmentEventText("order.edit_payment_refunded", { label: "E3", amount: 14900 }, money)).toMatch(/149\.00 kr given back/);
  });

  it("names the units taken off what is still to send, by SKU (D174, not sent)", () => {
    expect(fulfilmentEventText("order.unsent_closed", { units: 2, lines: [{ lineId: "l", sku: "TOTE", title: "Tote", quantity: 2 }], refundId: "r" }, money)).toBe(
      "Taken off what is still to send: 2 × TOTE will not be sent",
    );
    expect(fulfilmentEventText("order.unsent_closed", { units: 1, lines: [{ title: "Tote", quantity: 1 }] }, money)).toBe("Taken off what is still to send: 1 × Tote will not be sent");
    expect(fulfilmentEventText("order.unsent_closed", { units: 3 }, money)).toBe("Taken off what is still to send: 3 units will not be sent");
  });

  it("takes nothing else from the data, and answers null for other events", () => {
    expect(fulfilmentEventText("order.edit_cancelled", { label: "<b>x</b>", email: "a@b.no" }, money)).toBe("Change cancelled");
    expect(fulfilmentEventText("order.paid", {}, money)).toBeNull();
  });
});
