import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/orders/actions", () => {
  const action = async () => ({ ok: true, message: null });
  return { addNoteAction: action, cancelOrderAction: action, markBalancePaidAction: action, refundOrderAction: action, resendConfirmationAction: action, sendOrderAction: action, updateContactAction: action };
});

import type { ParcelTracking } from "@/server/shipment-tracking";

import { CancelForm, RefundForm } from "../order-actions";
import { HoldPanel } from "./hold-panel";
import { NotifySwitchedOff } from "./notify-off";
import { ParcelStatus } from "./parcel-status";
import { SendParcelForm } from "./send-parcel";

const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
const BAD = /\bNaN\b|undefined|\[object/;
const action = async () => ({ status: "ok" as const, messages: [] });
const when = (iso: string) => iso.slice(0, 10);

describe("the order's hold (D238, 2.6)", () => {
  it("says who held it and why, with Release for those who may", () => {
    const html = plain(renderToString(h(HoldPanel, { hold: { heldAt: "2026-10-01T10:00:00Z", reason: "Check the address", rule: { id: "r1", name: "Big orders" }, byAccount: null }, base: "/admin/kaffe", when, release: action, holdAction: null })));
    expect(html).not.toMatch(BAD);
    expect(html).toContain("On hold: Check the address");
    expect(html).toContain('href="/admin/kaffe/settings/automation/r1"');
    expect(html).toContain("Nothing of this order can be sent or handed over until it is released.");
    expect(html).toContain(">Release<");
  });

  it("names a deleted rule plainly and a person by name; no Release without orders:write", () => {
    const deleted = plain(renderToString(h(HoldPanel, { hold: { heldAt: "2026-10-01T10:00:00Z", reason: "x", rule: { id: "r1", name: null }, byAccount: null }, base: "/b", when, release: null, holdAction: null })));
    expect(deleted).toContain("that was deleted since");
    expect(deleted).not.toContain(">Release<");
    const person = plain(renderToString(h(HoldPanel, { hold: { heldAt: "2026-10-01T10:00:00Z", reason: "x", rule: null, byAccount: { id: "a", name: "Kari" } }, base: "/b", when, release: null, holdAction: null })));
    expect(person).toContain("by Kari");
  });

  it("offers Hold with a reason when the order can be held, and nothing when it cannot", () => {
    const html = plain(renderToString(h(HoldPanel, { hold: null, base: "/b", when, release: null, holdAction: action })));
    expect(html).toContain("Hold fulfilment");
    expect(html).toMatch(/name="reason"[^>]*required|required[^>]*name="reason"/);
    expect(renderToString(h(HoldPanel, { hold: null, base: "/b", when, release: null, holdAction: null }))).toBe("");
  });
});

const tracking = (over: Partial<ParcelTracking> = {}): ParcelTracking => ({
  shipmentId: "s1",
  followed: "bring",
  phase: "in_transit",
  phaseVerified: true,
  events: [
    { at: "2026-10-02T08:00:00Z", code: "IN_TRANSIT", phase: "in_transit", verified: true, description: "The parcel is on its way", location: "Oslo" },
    { at: "2026-10-01T08:00:00Z", code: "PRE_NOTIFIED", phase: "info_received", verified: true, description: "Announced", location: null },
  ],
  checkedAt: "2026-10-02T09:00:00Z",
  lastCheckFailed: false,
  failures: 0,
  stopped: null,
  outAt: null,
  deliveredAt: null,
  ...over,
});

describe("a parcel's tracking on the staff order page (D238, 2.3)", () => {
  it("shows the phase, the stored events, when it was last checked and Check now", () => {
    const html = plain(renderToString(h(ParcelStatus, { tracking: tracking(), carrierName: "Posten / Bring", when, checkNow: action })));
    expect(html).not.toMatch(BAD);
    expect(html).toContain("On its way");
    expect(html).toContain("The parcel is on its way, Oslo");
    expect(html).toContain("Announced");
    expect(html).toContain("Last checked 2026-10-02");
    expect(html).toContain("Check now");
  });

  it("says so when the carrier has nothing, when checks fail, and when the code is not verified", () => {
    expect(plain(renderToString(h(ParcelStatus, { tracking: tracking({ events: [], phase: "unknown" }), carrierName: "PostNord", when, checkNow: null })))).toContain("PostNord has no news about this parcel yet.");
    const failing = plain(renderToString(h(ParcelStatus, { tracking: tracking({ lastCheckFailed: true, failures: 3 }), carrierName: "PostNord", when, checkNow: null })));
    expect(failing).toContain("the last 3 checks did not reach PostNord");
    expect(failing).not.toMatch(/error/i);
    const unverified = plain(renderToString(h(ParcelStatus, { tracking: tracking({ phaseVerified: false }), carrierName: "Helthjem", when, checkNow: null })));
    expect(unverified).toContain("no email or delivery date comes from it");
    const stopped = plain(renderToString(h(ParcelStatus, { tracking: tracking({ stopped: "carrier_failing" }), carrierName: "Helthjem", when, checkNow: action })));
    expect(stopped).toContain("Kaizen could not reach the carrier");
  });

  it("shows a carrier's delivery and a warning for a problem", () => {
    const delivered = plain(renderToString(h(ParcelStatus, { tracking: tracking({ phase: "delivered", deliveredAt: "2026-10-03T12:00:00Z" }), carrierName: "Posten / Bring", when, checkNow: null })));
    expect(delivered).toContain("Delivered (from Posten / Bring, 2026-10-03)");
    expect(plain(renderToString(h(ParcelStatus, { tracking: tracking({ phase: "problem" }), carrierName: "x", when, checkNow: null })))).toContain("bg-warning-soft");
  });

  it("tells staff how to have a parcel followed when its carrier is not connected", () => {
    expect(plain(renderToString(h(ParcelStatus, { tracking: undefined, carrierName: "x", when, checkNow: null })))).toContain("Kaizen follows parcels from carriers you connect under Shipping.");
    expect(plain(renderToString(h(ParcelStatus, { tracking: tracking({ followed: null }), carrierName: "x", when, checkNow: null })))).toContain("carriers you connect under Shipping");
  });
});

describe("the Notify the customer boxes follow the email's switch (D238, 2.2)", () => {
  it("draws the box off, with a link to Notifications, when the email is switched off", () => {
    const html = plain(renderToString(h(NotifySwitchedOff, { href: "/admin/kaffe/settings/notifications/order-sent", children: "Tell the customer" })));
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('href="/admin/kaffe/settings/notifications/order-sent"');
  });

  it("sends no notify box from the send, refund and cancel forms while their email is off", () => {
    const send = plain(renderToString(h(SendParcelForm, { rows: [{ lineId: "l1", title: "Coffee", sku: "C1", ordered: 1, sent: 0, withdrawn: 0, toSend: 1, closed: 0, backordered: 0, backorderDays: null }], basis: "b", carriers: [{ id: "bring", name: "Bring" }], hasEmail: true, send: async () => ({ ok: true, message: null }), notifyOff: "/n/order-sent" })));
    expect(send).not.toContain('name="notify"');
    expect(send).toContain("switched off in");
    const sendOn = plain(renderToString(h(SendParcelForm, { rows: [], basis: "b", carriers: [], hasEmail: true, send: async () => ({ ok: true, message: null }) })));
    expect(sendOn).toContain('name="notify"');
    const refund = plain(renderToString(h(RefundForm, { storeSlug: "kaffe", orderId: "o", refundable: "10,00", refundableLabel: "10 kr", lines: [], hasEmail: true, canRefund: true, notifyOff: "/n/order-refunded" })));
    expect(refund).not.toContain('name="notify"');
    const cancel = plain(renderToString(h(CancelForm, { storeSlug: "kaffe", orderId: "o", amountLabel: "10 kr", hasEmail: true, notifyOff: "/n/order-cancelled" })));
    expect(cancel).not.toContain('name="notify"');
    expect(plain(renderToString(h(CancelForm, { storeSlug: "kaffe", orderId: "o", amountLabel: "10 kr", hasEmail: true })))).toContain('name="notify"');
  });
});
