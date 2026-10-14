import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import type { LocalDelivery, PickupDelivery } from "@/lib/delivery-options";
import { noteStart, shipWords, type DeliveryCell } from "@/lib/order-list-row";

import type { PackingSlip } from "@/server/packing-slips";

import { LocalDeliveryPanel, PickupPanel, type HandoverState } from "./handover-panel";
import { PackingSlipView } from "./packing-slip-view";
import { DeliveryText } from "./order-table";
import { ShipmentList, type ShipmentItem } from "./shipment-list";

/** The order page's pickup and local-delivery cards and the list's *Delivery* cell (D237, `docs/wave-3-shipping-methods.md` 2.2, 2.3, 6.2, 6.3). */

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s ]+/g, " ");
const draw = (element: Parameters<typeof renderToString>[0]) => {
  const html = renderToString(element);
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};
const action = async (): Promise<FormState> => ({ status: "ok", messages: [] });
const when = (iso: string) => iso.slice(0, 10);

const PICKUP: PickupDelivery = {
  kind: "pickup",
  label: "Shop Oslo",
  locationId: "l1",
  name: "Shop Oslo",
  street: "Storgata 1",
  postalCode: "0155",
  city: "Oslo",
  country: "NO",
  hours: { week: { mon: { open: "10:00", close: "18:00" }, tue: { open: "10:00", close: "18:00" }, wed: null, thu: null, fri: null, sat: null, sun: null }, exceptions: [] },
  instructions: "Ask at the counter.",
  readyInHours: 2,
};
const LOCAL: LocalDelivery = { kind: "local", label: "Oslo centre", areaId: "a1", name: "Oslo centre", postalCode: "0155", info: "Tuesdays and Fridays." };
const state = (change: Partial<HandoverState> = {}): HandoverState => ({ status: "paid", copied: false, unitsToSend: 2, waitingUnits: 0, editPending: false, basis: "b1", deliveredOn: null, ...change });

describe("the pickup card", () => {
  it("shows where to collect from the order's own snapshot, and Ready for pickup and Collected while nothing is marked", () => {
    const { text, html } = draw(h(PickupPanel, { delivery: PICKUP, readyAt: null, state: state(), canWrite: true, today: "2026-10-14", when, ready: action, collected: action }));
    expect(text).toContain("Collect at Shop Oslo");
    expect(text).toContain("Storgata 1, 0155 Oslo");
    expect(text).toContain("Opening hours: Mon–Tue 10:00–18:00");
    expect(text).toContain("Usually ready in 2 hours.");
    expect(text).toContain("Ask at the counter.");
    expect(text).toContain("Not marked ready yet.");
    expect(text).toContain("Ready for pickup");
    expect(text).toContain("Collected");
    expect(text).toContain("That day starts the 14 days to withdraw. No email is sent.");
    expect(html).toContain('name="seen" value="b1"');
    expect(html).toContain('max="2026-10-14"');
    expect(text).not.toContain("sold on backorder");
  });

  it("offers Send the email again once marked ready, and asks staff to confirm units sold on backorder", () => {
    const { text, html } = draw(h(PickupPanel, { delivery: PICKUP, readyAt: "2026-10-13T10:00:00Z", state: state({ waitingUnits: 1 }), canWrite: true, today: "2026-10-14", when, ready: action, collected: action }));
    expect(text).toContain("Marked ready for pickup 2026-10-13.");
    expect(text).toContain("Send the email again");
    expect(html).toContain('name="resend" value="1"');
    expect(text).toContain("1 unit was sold on backorder. Tick when you have it here.");
    expect(html).toContain('name="haveStock"');
  });

  it("shows only the facts on a collected, copied or read-only order, and waits while a change is unpaid", () => {
    const collected = draw(h(PickupPanel, { delivery: PICKUP, readyAt: "2026-10-13T10:00:00Z", state: state({ status: "fulfilled", unitsToSend: 0, deliveredOn: "2026-10-14" }), canWrite: true, today: "2026-10-14", when, ready: action, collected: action }));
    expect(collected.text).toContain("Collected on 2026-10-14.");
    expect(collected.text).toContain("A mistake is taken back with Undo");
    expect(collected.html).not.toContain('name="on"');
    const copied = draw(h(PickupPanel, { delivery: PICKUP, readyAt: null, state: state({ copied: true }), canWrite: true, today: "2026-10-14", when, ready: action, collected: action }));
    expect(copied.text).toContain("A copied order is history and is never handed over.");
    expect(copied.html).not.toContain("<button");
    const readOnly = draw(h(PickupPanel, { delivery: PICKUP, readyAt: null, state: state(), canWrite: false, today: "2026-10-14", when, ready: action, collected: action }));
    expect(readOnly.html).not.toContain("<button");
    const pending = draw(h(PickupPanel, { delivery: null, readyAt: null, state: state({ editPending: true }), canWrite: true, today: "2026-10-14", when, ready: action, collected: action }));
    expect(pending.text).toContain("Nothing is handed over until it is paid, cancelled or expired.");
    expect(pending.text).toContain("its details were not kept on this order");
  });
});

describe("the local delivery card", () => {
  it("shows the area, phone and the driver's note, with Out for delivery and a one-press Mark delivered", () => {
    const { text } = draw(
      h(LocalDeliveryPanel, { delivery: LOCAL, note: "Ring twice, the door is round the back.", phone: "+47 400 00 000", takenOutAt: null, state: state(), canWrite: true, when, today: "2026-10-14", out: action, delivered: action }),
    );
    expect(text).toContain("Local delivery: Oslo centre");
    expect(text).toContain("Priced for postal code 0155");
    expect(text).toContain("Tuesdays and Fridays.");
    expect(text).toContain("Phone: +47 400 00 000");
    expect(text).toContain("Note for the driver");
    expect(text).toContain("Ring twice, the door is round the back.");
    expect(text).toContain("Not taken out yet.");
    expect(text).toContain("Out for delivery");
    expect(text).toContain("Records the handover and the delivery in one go");
    expect(text).toContain("Mark delivered");
  });

  it("after the driver left, offers only Mark delivered; once delivered, nothing; waiting stock blocks taking it out", () => {
    const out = draw(h(LocalDeliveryPanel, { delivery: LOCAL, note: null, phone: null, takenOutAt: "2026-10-14T08:00:00Z", state: state({ status: "fulfilled", unitsToSend: 0 }), canWrite: true, when, today: "2026-10-14", out: action, delivered: action }));
    expect(out.text).toContain("Out for delivery 2026-10-14.");
    expect(out.text).not.toContain("Records the handover");
    expect(out.text).toContain("Mark delivered");
    const done = draw(h(LocalDeliveryPanel, { delivery: LOCAL, note: null, phone: null, takenOutAt: "2026-10-14T08:00:00Z", state: state({ status: "fulfilled", unitsToSend: 0, deliveredOn: "2026-10-14" }), canWrite: true, when, today: "2026-10-14", out: action, delivered: action }));
    expect(done.text).toContain("Delivered on 2026-10-14.");
    expect(done.html).not.toContain("<button");
    const waiting = draw(h(LocalDeliveryPanel, { delivery: LOCAL, note: null, phone: null, takenOutAt: null, state: state({ waitingUnits: 2 }), canWrite: true, when, today: "2026-10-14", out: action, delivered: action }));
    expect(waiting.text).toContain("Part of this order is waiting for stock.");
    expect(waiting.html).not.toContain("<button");
  });
});

describe("handovers in the order's list of what left", () => {
  it("says a handover was collected or taken out, without a carrier, tracking or Email again", () => {
    const shipment = (method: ShipmentItem["method"]): ShipmentItem => ({
      id: `s-${method}`,
      createdAt: "2026-10-14T08:00:00Z",
      carrier: "other",
      carrierId: null,
      trackingNumber: "",
      trackingUrl: null,
      hasLabel: false,
      legacy: false,
      method,
      lines: [{ lineId: "l1", sku: "MUG", title: "Mug", quantity: 2 }],
      undone: null,
    });
    const { text } = draw(
      h(ShipmentList, { shipments: [shipment("pickup"), shipment("local")], base: "/b", when, emailAgain: () => async () => ({ ok: true, message: "" }), undo: null, receiptRecorded: false } as never),
    );
    expect(text).toContain("Collected by the customer");
    expect(text).toContain("Taken out by your own driver");
    expect(text).not.toContain("Email again");
    expect(text).not.toContain("other");
  });
});

describe("the list's Delivery cell and fulfilment words", () => {
  const cell = (change: Partial<DeliveryCell>): DeliveryCell => ({ method: "ship", label: "Standard", ready: false, postalCode: null, city: null, phone: null, note: null, ...change });

  it("names the method, the pickup place, and where a local delivery goes with the start of its note", () => {
    expect(draw(h(DeliveryText, { cell: cell({}) })).text.trim()).toBe("Standard");
    expect(draw(h(DeliveryText, { cell: cell({ method: "pickup", label: "Shop Oslo" }) })).text.trim()).toBe("Collect at Shop Oslo");
    const local = draw(h(DeliveryText, { cell: cell({ method: "local", label: "Oslo centre", postalCode: "0155", city: "Oslo", phone: "+47 400 00 000", note: "Ring twice" }) })).text;
    expect(local).toContain("Local delivery: Oslo centre");
    expect(local).toContain("0155 Oslo");
    expect(local).toContain("+47 400 00 000");
    expect(local).toContain("“Ring twice”");
    expect(draw(h(DeliveryText, { cell: undefined })).text.trim()).toBe("–");
    expect(draw(h(DeliveryText, { cell: cell({ label: null }) })).text.trim()).toBe("–");
  });

  it("says To hand over, Ready and Collected for pickup, To deliver and Taken out for local delivery, and the usual words otherwise", () => {
    expect(shipWords({ ship: "to_send", delivery: cell({ method: "pickup" }) })).toBe("To hand over");
    expect(shipWords({ ship: "to_send", delivery: cell({ method: "pickup", ready: true }) })).toBe("Ready for pickup");
    expect(shipWords({ ship: "sent", delivery: cell({ method: "pickup" }) })).toBe("Collected");
    expect(shipWords({ ship: "to_send", delivery: cell({ method: "local" }) })).toBe("To deliver");
    expect(shipWords({ ship: "sent", delivery: cell({ method: "local" }) })).toBe("Taken out");
    expect(shipWords({ ship: "to_send", delivery: cell({}) })).toBe("To send");
    expect(shipWords({ ship: "waiting", delivery: cell({ method: "pickup" }) })).toBe("Waiting for stock");
    expect(shipWords({ ship: "copied", delivery: undefined })).toBe("Copied");
  });

  it("keeps a note to its first 80 characters", () => {
    expect(noteStart(null)).toBeNull();
    expect(noteStart("short")).toBe("short");
    const long = noteStart("x".repeat(120))!;
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the packing slip of a pickup or local order", () => {
  const slip = (handover: PackingSlip["handover"], lang: "nb" | "en" = "en"): PackingSlip => ({
    orderId: "o1",
    number: "1001",
    placedAt: "2026-10-05T10:30:00.000Z",
    locale: lang === "nb" ? "nb-NO" : "en-GB",
    lang,
    shipTo: { name: "Kari Nordmann", line1: "Gata 1", line2: null, postalCode: "0150", city: "Oslo", country: "NO" },
    lines: [{ quantity: 2, title: "Mug", sku: "MUG" }],
    gift: null,
    handover,
  });
  const seller = { legalName: "Kaffe AS", postalAddress: null, contactEmail: null };

  it("prints the place for a pickup order instead of an address, in the order's language", () => {
    const en = draw(h(PackingSlipView, { slip: slip({ method: "pickup", place: "Shop Oslo" }), storeName: "Kaffe AS", seller })).text;
    expect(en).toContain("Collect at Shop Oslo");
    expect(en).not.toContain("Gata 1");
    const nb = draw(h(PackingSlipView, { slip: slip({ method: "pickup", place: "Butikken" }, "nb"), storeName: "Kaffe AS", seller })).text;
    expect(nb).toContain("Butikken");
    expect(nb).not.toContain("Collect at");
  });

  it("prints the driver's note under the address of a local order", () => {
    const text = draw(h(PackingSlipView, { slip: slip({ method: "local", note: "Ring twice" }), storeName: "Kaffe AS", seller })).text;
    expect(text).toContain("Gata 1");
    expect(text).toContain("Your note for the driver");
    expect(text).toContain("Ring twice");
    expect(draw(h(PackingSlipView, { slip: slip(null), storeName: "Kaffe AS", seller })).text).not.toContain("note for the driver");
  });
});
