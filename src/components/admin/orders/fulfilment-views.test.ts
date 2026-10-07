import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EDIT_BLOCKS, type EditBlockReason } from "@/lib/order-edit";
import { addedMug, BOOK, MUG, summaryOf } from "@/lib/order-edit-view-fixture";
import type { EditorOrderLine } from "@/lib/order-edit-form";

import { ChosenDeliveryBooking } from "../chosen-delivery-booking";
import { OrderEditCard, type EditListItem } from "./order-edit-card";
import { OrderEditEditor } from "./order-edit-editor";
import { OrderEditSummary } from "./order-edit-summary";
import { ParcelChoice } from "./parcel-choice";
import { SendParcelForm, type ParcelRow } from "./send-parcel";
import { ShipmentList, type ShipmentItem } from "./shipment-list";

// The editor pushes back to the order page when a change is saved; drawn on the server here, it never navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s  ]+/g, " ");
const check = (html: string) => {
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return text;
};
const money = (minor: number) => `${(minor / 100).toFixed(2)} kr`;
const when = (iso: string) => iso.slice(0, 10);
const answer = async () => ({ ok: true, message: "" });

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";
const row = (lineId: string, over: Partial<ParcelRow> = {}): ParcelRow => ({
  lineId,
  title: `Item ${lineId.slice(0, 1)}`,
  sku: `SKU-${lineId.slice(0, 1)}`,
  ordered: 3,
  sent: 0,
  withdrawn: 0,
  toSend: 3,
  backordered: 0,
  backorderDays: null,
  ...over,
});
const carriers = [
  { id: "bring", name: "Posten / Bring" },
  { id: "other", name: "Other" },
];

describe("the Send card (D174 2.1)", () => {
  const rows = [row(L1, { sent: 1, toSend: 2 }), row(L2, { ordered: 2, toSend: 1, withdrawn: 1, backordered: 1, backorderDays: 10 }), row(L3, { ordered: 1, sent: 0, withdrawn: 1, toSend: 0 })];

  it("lists ordered, sent, withdrawn and to send per line, with a number field starting at what is left", () => {
    const html = renderToString(h(SendParcelForm, { rows, basis: "b1", carriers, hasEmail: true, send: answer }));
    const text = check(html);
    for (const heading of ["Ordered", "Sent", "Withdrawn", "To send", "In this parcel"]) expect(text).toContain(heading);
    expect(html).toContain(`name="qty:${L1}"`);
    expect(html).toMatch(new RegExp(`name="qty:${L1}"[^>]*max="2"|max="2"[^>]*name="qty:${L1}"`));
    expect(html).toContain(`name="qty:${L2}"`);
    // A line with nothing left has no field, and says why.
    expect(html).not.toContain(`name="qty:${L3}"`);
    expect(text).toContain("Withdrawn before sending");
    // The staff member chose (parcel=lines), and the order as the card saw it travels with the parcel.
    expect(html).toContain('name="parcel" value="lines"');
    expect(html).toContain('name="seen" value="b1"');
    expect(text).toContain("3 units are still to send");
    expect(text).toContain("1 on backorder (within 10 days): check you have them");
    expect(text).toContain("Tell the customer");
    expect(text).toContain("Send this parcel");
  });

  it("sends a subscription box whole: no quantities and no line choice", () => {
    const html = renderToString(h(SendParcelForm, { rows: [row(L1)], basis: "b", carriers, hasEmail: false, whole: true, submitLabel: "Charge and send", send: answer }));
    const text = check(html);
    expect(html).not.toContain('name="parcel"');
    expect(html).not.toContain("qty:");
    expect(text).toContain("sent whole, not in parts");
    expect(text).toContain("Charge and send");
    expect(text).not.toContain("Tell the customer");
  });

  it("says which units will not be sent (taken off with 'not sent'), and gives them no field", () => {
    const html = renderToString(
      h(SendParcelForm, { rows: [row(L1, { sent: 1, closed: 2, toSend: 0 }), row(L2, { closed: 1, toSend: 2 }), row(L3, { ordered: 1, closed: 1, toSend: 0 })], basis: "b", carriers, hasEmail: true, send: answer }),
    );
    const text = check(html);
    expect(text).toContain("The rest will not be sent");
    expect(text).toContain("Will not be sent");
    expect(text).toContain("2 will not be sent");
    expect(text).toContain("1 will not be sent");
    expect(html).not.toContain(`name="qty:${L1}"`);
    expect(html).toMatch(new RegExp(`name="qty:${L2}"[^>]*max="2"|max="2"[^>]*name="qty:${L2}"`));
  });

  it("cannot be pressed when nothing is left to send", () => {
    const html = renderToString(h(SendParcelForm, { rows: [row(L1, { sent: 3, toSend: 0 })], basis: "b", carriers, hasEmail: true, send: answer }));
    expect(check(html)).toContain("All sent");
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });
});

describe("a carrier booking's parcel (D174 2.1)", () => {
  const rows = [row(L1, { sent: 1, toSend: 2 }), row(L2, { toSend: 0, sent: 3 })];

  it("offers each line with units left, starting at what is left, and says the booking takes everything until a number is lowered", () => {
    const html = renderToString(h(ParcelChoice, { rows, typed: {}, onChange: () => undefined }));
    const text = check(html);
    expect(html).toContain('aria-label="In this parcel: Item 1"');
    expect(html).not.toContain("In this parcel: Item 2");
    expect(text).toContain("2 to send");
    expect(text).toContain("Everything still to send (2 units)");
  });

  it("says a lowered parcel leaves the rest to send and is to be weighed, and refuses a number above what is left", () => {
    expect(check(renderToString(h(ParcelChoice, { rows, typed: { [L1]: "1" }, onChange: () => undefined })))).toContain("1 of 2 units in this parcel; the rest stays to send. The weight is guessed from the whole order: weigh this parcel.");
    expect(check(renderToString(h(ParcelChoice, { rows, typed: { [L1]: "5" }, onChange: () => undefined })))).toContain("A number is not a whole number from 0 to what is left of its item.");
  });

  it("draws nothing when nothing is left, and sits in the Porterbuddy and Helthjem booking", () => {
    expect(renderToString(h(ParcelChoice, { rows: [row(L1, { toSend: 0 })], typed: {}, onChange: () => undefined }))).toBe("");
    const text = check(renderToString(h(ChosenDeliveryBooking, { carrierName: "Helthjem", chosenText: "Home delivery", estimatedGrams: 1200, test: false, hasEmail: true, book: answer, rows })));
    expect(text).toContain("In this parcel");
    expect(text).toContain("Book and mark as sent");
    expect(check(renderToString(h(ChosenDeliveryBooking, { carrierName: "Helthjem", chosenText: "Home delivery", estimatedGrams: 1200, test: false, hasEmail: true, book: answer })))).not.toContain("In this parcel");
  });
});

describe("the parcels (D174 2.1)", () => {
  const shipment = (over: Partial<ShipmentItem> = {}): ShipmentItem => ({
    id: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-10-06T10:00:00Z",
    carrier: "Posten / Bring",
    carrierId: null,
    trackingNumber: "TRACK123",
    trackingUrl: "https://tracking.example/TRACK123",
    hasLabel: false,
    legacy: false,
    lines: [{ lineId: L1, sku: "SKU-1", title: "Mug (White)", quantity: 2 }],
    ...over,
  });

  it("numbers each parcel with its date, carrier, tracking, items, packing slip and Email again", () => {
    const html = renderToString(
      h(ShipmentList, {
        shipments: [shipment(), shipment({ id: "55555555-5555-4555-8555-555555555555", hasLabel: true, lines: [{ lineId: L2, sku: "", title: "Plate", quantity: 1 }] })],
        base: "/admin/shop/orders/o1",
        when,
        emailAgain: () => answer,
      }),
    );
    const text = check(html);
    expect(text).toContain("Parcel 1 · 2026-10-06");
    expect(text).toContain("Parcel 2");
    expect(text).toContain("TRACK123");
    expect(html).toContain('href="https://tracking.example/TRACK123"');
    expect(text).toContain("2 × Mug (White)");
    expect(text).toContain("1 × Plate");
    expect(html).toContain('href="/admin/shop/orders/o1/packing-slip?shipment=44444444-4444-4444-8444-444444444444"');
    expect(html).toContain('href="/admin/shop/orders/o1/label/55555555-5555-4555-8555-555555555555"');
    expect(text.match(/Email again/g)).toHaveLength(2);
  });

  it("says a parcel from before parcels listed their items counts as everything sent, and offers no Email again to someone who may not", () => {
    const html = renderToString(h(ShipmentList, { shipments: [shipment({ legacy: true, lines: [] })], base: "/admin/shop/orders/o1", when, emailAgain: null }));
    const text = check(html);
    expect(text).toContain("Recorded before parcels listed their items: counts as everything sent.");
    expect(text).not.toContain("Packing slip");
    expect(text).not.toContain("Email again");
  });

  it("draws nothing without parcels", () => {
    expect(renderToString(h(ShipmentList, { shipments: [], base: "/x", when, emailAgain: null }))).toBe("");
  });
});

describe("the order page's Change the items card (D174 2.2)", () => {
  const edit = (over: Partial<EditListItem> = {}): EditListItem => ({
    id: "e1",
    label: "E1",
    status: "applied",
    reason: "customer_request",
    differenceMinor: -10000,
    totalBeforeMinor: 39900,
    totalAfterMinor: 29900,
    documents: "issued",
    expiresAt: null,
    createdAt: "2026-10-05T10:00:00Z",
    appliedAt: "2026-10-05T10:00:00Z",
    endedAt: null,
    madeBy: "kari@example.com",
    ...over,
  });
  const base = { editHref: "/admin/shop/orders/o1/edit", money, when, hasEmail: true, mayRecordOutside: true, awaitingActions: null };

  it("says when a change's refund failed after it was applied, with what the customer is still owed (review fix), and nothing when nothing is owed", () => {
    const owed = check(renderToString(h(OrderEditCard, { ...base, canWrite: true, blockText: null, edits: [edit({ refundOwedMinor: 10000 })] })));
    expect(owed).toContain("The refund of change E1 failed. 100.00 kr has not reached the customer");
    const none = check(renderToString(h(OrderEditCard, { ...base, canWrite: true, blockText: null, edits: [edit({ refundOwedMinor: 0 })] })));
    expect(none).not.toContain("failed");
  });

  it("offers Edit items when the order can be changed, and lists the changes so far without staff's note", () => {
    const html = renderToString(h(OrderEditCard, { ...base, canWrite: true, blockText: null, edits: [edit()] }));
    const text = check(html);
    expect(html).toContain('href="/admin/shop/orders/o1/edit"');
    expect(text).toContain("Edit items");
    expect(text).toContain("E1 · Applied · 2026-10-05 · −100.00 kr (399.00 kr → 299.00 kr)");
    expect(text).toContain("The customer asked");
    expect(text).toContain("documents issued");
    expect(text).toContain("kari@example.com");
  });

  it("shows why an order cannot be changed, in words, for every reason, and no Edit items", () => {
    for (const reason of Object.keys(EDIT_BLOCKS) as EditBlockReason[]) {
      const html = renderToString(h(OrderEditCard, { ...base, canWrite: true, blockText: EDIT_BLOCKS[reason], edits: [] }));
      const text = check(html);
      expect(text, reason).toContain(plain(EDIT_BLOCKS[reason]).trim());
      expect(text, reason).not.toContain("Edit items");
    }
  });

  it("offers nothing to change to someone who may only read", () => {
    const html = renderToString(h(OrderEditCard, { ...base, canWrite: false, blockText: null, edits: [edit({ status: "awaiting_payment", differenceMinor: 14900, expiresAt: "2026-10-13T10:00:00Z", appliedAt: null })] }));
    const text = check(html);
    expect(text).not.toContain("Edit items");
    expect(text).toContain("Change E1 is waiting for the customer's payment of 149.00 kr until 2026-10-13");
    expect(text).not.toContain("Send again");
    expect(text).not.toContain("Cancel the change");
  });

  it("shows a change waiting for payment with Send again, a link to share, Record as paid outside and Cancel", () => {
    const awaitingActions = { resend: answer, cancel: answer, paidOutside: answer };
    const waiting = edit({ status: "awaiting_payment", differenceMinor: 14900, expiresAt: "2026-10-13T10:00:00Z", appliedAt: null });
    const text = check(renderToString(h(OrderEditCard, { ...base, canWrite: true, blockText: EDIT_BLOCKS.edit_pending, edits: [waiting], awaitingActions })));
    for (const words of ["Send again", "Create a link to share", "Record as paid outside Kaizen", "Cancel the change", "The order stays as it is until it is paid"]) expect(text).toContain(words);
    // Without an email address there is nobody to send it to; without the owner's leave, staff cannot record money taken outside Kaizen.
    const noEmail = check(renderToString(h(OrderEditCard, { ...base, hasEmail: false, mayRecordOutside: false, canWrite: true, blockText: null, edits: [waiting], awaitingActions })));
    expect(noEmail).not.toContain("Send again");
    expect(noEmail).toContain("Only the owner can record a payment taken outside Kaizen");
  });
});

describe("the editor's summary (D174 2.2): the server's preview, in words", () => {
  it("lists what is taken off and added, the totals before and after, the VAT per rate, the difference and what happens with the money and the documents", () => {
    const { view } = summaryOf({ quantities: { [MUG]: 1, [BOOK]: 0 }, added: [addedMug()] });
    const text = check(renderToString(h(OrderEditSummary, { summary: view, currency: "NOK", locale: "en-GB", state: "fresh" })));
    expect(text).toContain("Fewer: Item 1111");
    expect(text).toContain("Taken off: A book");
    expect(text).toContain("Added: Plate (Blue)");
    for (const words of ["Subtotal", "Discounts", "Shipping", "VAT included", "Total", "Before", "After", "Difference", "VAT at 25 %"]) expect(text).toContain(words);
    expect(text).toContain(view.sentences.money);
    expect(text).toContain("A credit note for what is taken off and an additional invoice for what is added, referring to invoice F-17.");
  });

  it("says when the customer will be asked to pay, and marks a custom price and units on backorder", () => {
    const { view } = summaryOf({ added: [addedMug({ key: "a2", unitPriceMinor: 9900 })] });
    const text = check(renderToString(h(OrderEditSummary, { summary: view, currency: "NOK", locale: "en-GB", state: "fresh" })));
    expect(view.money).toBe("charge");
    expect(text).toContain("The customer will be asked to pay");
    expect(text).toContain("custom price, list");
    expect(text).toContain("On backorder: 2 units, shipped within 10 days");
  });

  it("shows the problems in words and says when it is still working", () => {
    const { view } = summaryOf({ quantities: { [MUG]: 0, [BOOK]: 0 } });
    const html = renderToString(h(OrderEditSummary, { summary: view, currency: "NOK", locale: "en-GB", state: "working", formProblems: ["The quantity of Mug is not a whole number."] }));
    const text = check(html);
    expect(html).toContain('aria-busy="true"');
    expect(text).toContain("Calculating");
    expect(text).toContain("The quantity of Mug is not a whole number.");
    expect(text).toContain("problem nothing_left");
  });

  it("asks for a change before it has one", () => {
    expect(check(renderToString(h(OrderEditSummary, { summary: null, currency: "NOK", locale: "en-GB", state: "fresh" })))).toContain("Change a quantity or add a product");
  });
});

describe("the order editor (D174 2.2)", () => {
  const lines: EditorOrderLine[] = [
    { lineId: L1, variantId: "v1", title: "Mug (White)", sku: "MUG-W", quantity: 3, unitPriceMinor: 10000, totalMinor: 30000, editable: true, gift: false },
    { lineId: L2, variantId: "v2", title: "Free tote", sku: "TOTE", quantity: 1, unitPriceMinor: 0, totalMinor: 0, editable: true, gift: true },
    { lineId: L3, variantId: null, title: "E-book", sku: "EBOOK", quantity: 1, unitPriceMinor: 9900, totalMinor: 9900, editable: false, gift: false },
  ];
  const actions = {
    preview: async () => ({ ok: false as const, message: "", problems: [] }),
    apply: answer,
    send: answer,
    paidOutside: answer,
    searchVariants: async () => [],
  };
  const props = { orderHref: "/admin/shop/orders/o1", number: "1042", currency: "NOK", locale: "en-GB", lines, shippingMinor: 9900, hasEmail: true, mayRecordOutside: true, actions };

  it("shows the lines as sold with a quantity that can only go down, goods that stay as they are, the shipping, the reason and the restock choice", () => {
    const html = renderToString(h(OrderEditEditor, { ...props, initialSummary: summaryOf().view }));
    const text = check(html);
    expect(text).toContain("Items on order #1042");
    expect(html).toContain('aria-label="Keep of Mug (White)"');
    expect(html).toMatch(/aria-label="Keep of Mug \(White\)"|max="3"/);
    expect(html).not.toContain('aria-label="Keep of E-book"');
    expect(text).toContain("Stays as it is");
    expect(text).toContain("Free gift: it is not taken off by itself");
    for (const words of ["Add a product", "Shipping", "Put removed items back in stock", "The customer asked", "Out of stock", "Our mistake", "Other", "Tell the customer"]) expect(text).toContain(words);
    // No reason chosen yet: nothing can be saved.
    expect(text).toContain("Choose a reason first.");
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Save the change<\/button>/);
  });

  it("asks the customer to pay for a higher total, never saving it at once, and makes Tell the customer compulsory", () => {
    const { view } = summaryOf({ added: [addedMug()] });
    const html = renderToString(h(OrderEditEditor, { ...props, initialSummary: view }));
    const text = check(html);
    expect(text).toContain("Ask the customer to pay");
    expect(text).toContain("Send the customer a pay link");
    expect(text).toContain("Create a link to share");
    expect(text).toContain("Record as paid outside Kaizen");
    expect(text).not.toContain("Save the change and refund");
    expect(text).toContain("always, for a change that asks them to pay or takes something off");
    expect(html).toMatch(/<input type="checkbox" disabled="" class="size-4" checked=""\/>Tell the customer/);
  });

  it("refunds a lower total on save, and says only the owner may pay back money taken outside Kaizen", () => {
    const { view } = summaryOf({ quantities: { [BOOK]: 0 }, outside: true });
    const text = check(renderToString(h(OrderEditEditor, { ...props, mayRecordOutside: false, initialSummary: view })));
    expect(text).toContain("Save the change and refund");
    expect(text).toContain("only the owner, or staff the owner allows, can record paying it back");
  });

  it("cannot email a pay link to an order without an email address", () => {
    const text = check(renderToString(h(OrderEditEditor, { ...props, hasEmail: false, initialSummary: summaryOf({ added: [addedMug()] }).view })));
    expect(text).toContain("The order has no email address");
  });
});
