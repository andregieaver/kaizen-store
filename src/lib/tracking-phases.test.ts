import { describe, expect, it } from "vitest";

import { parseTracking } from "./bring";
import {
  CARRIER_PHASES,
  EVENTS_KEPT,
  TRACKING_PHASES,
  mergeEvents,
  nextCheck,
  parcelState,
  phaseOf,
  shownPhase,
  stopReason,
  storedEvents,
  toInstant,
  trackingEmailsDue,
  zoneFor,
  type StoredEvent,
} from "./tracking-phases";

/** Every event status of Bring's Tracking API v2 (developer.bring.com/api/tracking, read 2026-10-14 and 2026-10-15). */
const BRING_CODES: Record<string, string> = {
  ATTEMPTED_DELIVERY: "attempted",
  CUSTOMS: "in_transit",
  COLLECTED: "in_transit",
  DELIVERED: "delivered",
  DELIVERED_SENDER: "returned_to_sender",
  DELIVERY_CANCELLED: "problem",
  DELIVERY_CHANGED: "in_transit",
  DELIVERY_ORDERED: "info_received",
  DEVIATION: "problem",
  HANDED_IN: "in_transit",
  INTERNATIONAL: "in_transit",
  IN_TRANSIT: "in_transit",
  NOTIFICATION_SENT: "in_transit",
  PRE_NOTIFIED: "info_received",
  READY_FOR_PICKUP: "ready_for_collection",
  RETURN: "returned_to_sender",
  TRANSPORT_TO_RECIPIENT: "out_for_delivery",
  TERMINAL: "in_transit",
  UNKNOWN: "unknown",
};

const ev = (at: string, code: string, carrier = "bring"): StoredEvent => ({ at, code, ...phaseOf(carrier, code), description: code, location: null });

describe("phaseOf(): carrier codes to Kaizen's phases (4.4)", () => {
  it("maps every Bring status of the documentation, verified (but UNKNOWN)", () => {
    // Every code but Kaizen's own PACKAGE_DELIVERED (one package of several, parseTracking()) is Bring's documented list.
    expect(Object.keys(CARRIER_PHASES.bring.codes).filter((code) => code !== "PACKAGE_DELIVERED").sort()).toEqual(Object.keys(BRING_CODES).sort());
    for (const [code, phase] of Object.entries(BRING_CODES)) {
      expect([code, phaseOf("bring", code)]).toEqual([code, { phase, verified: phase !== "unknown" }]);
    }
  });

  it("never treats READY_FOR_PICKUP or COLLECTED as delivered", () => {
    expect(phaseOf("bring", "READY_FOR_PICKUP").phase).not.toBe("delivered");
    expect(phaseOf("bring", "COLLECTED").phase).not.toBe("delivered");
  });

  it("gives unlisted codes and carriers unknown, unverified", () => {
    expect(phaseOf("bring", "ARRIVED_DELIVERY")).toEqual({ phase: "unknown", verified: false });
    expect(phaseOf("dhl", "DELIVERED")).toEqual({ phase: "unknown", verified: false });
    expect(phaseOf("bring", "delivered")).toEqual({ phase: "unknown", verified: false });
  });

  it("marks PostNord, Helthjem and Porterbuddy unverified: their events never send an email or record a delivery", () => {
    expect(phaseOf("postnord", "DELIVERED")).toEqual({ phase: "delivered", verified: false });
    expect(phaseOf("postnord", "EN_ROUTE")).toEqual({ phase: "in_transit", verified: false });
    expect(phaseOf("helthjem", "001").verified).toBe(false);
    expect(phaseOf("porterbuddy", "ready").verified).toBe(false);
    const state = parcelState(storedEvents("postnord", [{ at: "2026-10-14T10:00:00Z", status: "DELIVERED", description: "Delivered" }], "Europe/Oslo"));
    expect(state).toMatchObject({ phase: "delivered", verified: false, deliveredAt: null });
    expect(trackingEmailsDue({ state, emailedOut: false, emailedDelivered: false, now: new Date("2026-10-14T11:00:00Z") })).toEqual({ out: false, delivered: false });
  });

  it("only uses phases of the list", () => {
    for (const table of Object.values(CARRIER_PHASES)) for (const phase of Object.values(table.codes)) expect(TRACKING_PHASES).toContain(phase);
  });
});

describe("times (4.4)", () => {
  it("keeps a zoned time as its instant", () => {
    expect(toInstant("2026-10-14T14:05:00+02:00", "Europe/Oslo")).toBe("2026-10-14T12:05:00.000Z");
    expect(toInstant("2026-10-14T12:05:00Z", "Europe/Stockholm")).toBe("2026-10-14T12:05:00.000Z");
    expect(toInstant("2026-10-14T14:05+0200", "UTC")).toBe("2026-10-14T12:05:00.000Z");
  });

  it("reads a time without a zone in the given zone, summer and winter", () => {
    expect(toInstant("2026-07-01T14:05", "Europe/Oslo")).toBe("2026-07-01T12:05:00.000Z");
    expect(toInstant("2026-12-01T14:05:30", "Europe/Oslo")).toBe("2026-12-01T13:05:30.000Z");
    expect(toInstant("2026-12-01 14:05", "Europe/Helsinki")).toBe("2026-12-01T12:05:00.000Z");
    // Across the change back to winter time (25 October 2026, 03:00 → 02:00 in Oslo).
    expect(toInstant("2026-10-25T04:00", "Europe/Oslo")).toBe("2026-10-25T03:00:00.000Z");
    expect(toInstant("2026-10-24T23:30", "Europe/Oslo")).toBe("2026-10-24T21:30:00.000Z");
  });

  it("gives null for what is not a time", () => {
    expect(toInstant("", "Europe/Oslo")).toBeNull();
    expect(toInstant("18.11.2022 14:05", "Europe/Oslo")).toBeNull();
    expect(toInstant("yesterday", "Europe/Oslo")).toBeNull();
  });

  it("reads by the delivery country, else the store's zone", () => {
    expect(zoneFor("SE", "Europe/Oslo")).toBe("Europe/Stockholm");
    expect(zoneFor("dk", "Europe/Oslo")).toBe("Europe/Copenhagen");
    expect(zoneFor("DE", "Europe/Oslo")).toBe("Europe/Oslo");
    expect(zoneFor(null, "Europe/Helsinki")).toBe("Europe/Helsinki");
  });

  it("stores Bring's events with dateIso as instants and without it in the zone", () => {
    const events = parseTracking({
      consignmentSet: [
        {
          packageSet: [
            {
              eventSet: [
                { status: "DELIVERED", description: "Delivered", displayDate: "14.10.2026", displayTime: "14:05", dateIso: "2026-10-14T14:05:00+02:00", city: "OSLO" },
                { status: "TRANSPORT_TO_RECIPIENT", description: "Loaded for delivery", displayDate: "14.10.2026", displayTime: "08:00" },
              ],
            },
          ],
        },
      ],
    });
    const stored = storedEvents("bring", events, "Europe/Oslo");
    expect(stored.map((e) => [e.at, e.phase, e.verified, e.location])).toEqual([
      ["2026-10-14T12:05:00.000Z", "delivered", true, "OSLO"],
      ["2026-10-14T06:00:00.000Z", "out_for_delivery", true, null],
    ]);
  });

  it("leaves out an event whose time cannot be read and clips long texts", () => {
    const stored = storedEvents("bring", [{ at: "?", status: "DELIVERED", description: "x" }, { at: "2026-10-14T10:00:00Z", status: "IN_TRANSIT", description: "d".repeat(500) }], "UTC");
    expect(stored).toHaveLength(1);
    expect(stored[0].description).toHaveLength(300);
  });
});

describe("mergeEvents() and parcelState()", () => {
  it("merges by time and code, newest first, counting what is new", () => {
    const a = ev("2026-10-14T08:00:00.000Z", "IN_TRANSIT");
    const b = ev("2026-10-14T10:00:00.000Z", "TRANSPORT_TO_RECIPIENT");
    const c = ev("2026-10-14T12:00:00.000Z", "DELIVERED");
    expect(mergeEvents([a], [a, b])).toEqual({ events: [b, a], added: 1 });
    expect(mergeEvents([b, a], [c, b, a])).toEqual({ events: [c, b, a], added: 1 });
    expect(mergeEvents([c, b, a], [c, b, a]).added).toBe(0);
  });

  it("keeps the newest 30", () => {
    const many = Array.from({ length: 40 }, (_, i) => ev(new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), "IN_TRANSIT"));
    const merged = mergeEvents([], many);
    expect(merged.events).toHaveLength(EVENTS_KEPT);
    expect(merged.events[0].at).toBe(many[39].at);
    expect(merged.added).toBe(EVENTS_KEPT);
  });

  it("takes the phase of the newest event that has one, and the first verified times", () => {
    const events = [
      ev("2026-10-14T13:00:00.000Z", "UNKNOWN"),
      ev("2026-10-14T12:00:00.000Z", "DELIVERED"),
      ev("2026-10-14T10:00:00.000Z", "TRANSPORT_TO_RECIPIENT"),
      ev("2026-10-14T09:00:00.000Z", "TRANSPORT_TO_RECIPIENT"),
    ];
    expect(parcelState(events)).toEqual({
      phase: "delivered",
      verified: true,
      outAt: "2026-10-14T09:00:00.000Z",
      deliveredAt: "2026-10-14T12:00:00.000Z",
      returnedAt: null,
    });
    expect(parcelState([])).toEqual({ phase: "unknown", verified: false, outAt: null, deliveredAt: null, returnedAt: null });
  });

  it("shows an unknown newest event as on its way only after an event with a phase", () => {
    expect(shownPhase([ev("2026-10-14T13:00:00.000Z", "UNKNOWN"), ev("2026-10-14T12:00:00.000Z", "IN_TRANSIT")])).toBe("in_transit");
    expect(shownPhase([ev("2026-10-14T13:00:00.000Z", "UNKNOWN")])).toBeNull();
    expect(shownPhase([ev("2026-10-14T13:00:00.000Z", "ATTEMPTED_DELIVERY")])).toBe("attempted");
    expect(shownPhase([])).toBeNull();
  });
});

describe("polling (4.5)", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const minutes = (d: Date) => (d.getTime() - now.getTime()) / 60000;

  it("checks again in 30 minutes after news or while it is out or ready", () => {
    expect(minutes(nextCheck({ now, failed: false, failures: 0, foundNew: true, phase: "in_transit", previousMinutes: 240 }))).toBe(30);
    expect(minutes(nextCheck({ now, failed: false, failures: 0, foundNew: false, phase: "out_for_delivery", previousMinutes: 240 }))).toBe(30);
    expect(minutes(nextCheck({ now, failed: false, failures: 0, foundNew: false, phase: "ready_for_collection", previousMinutes: 240 }))).toBe(30);
  });

  it("doubles a quiet wait up to six hours", () => {
    expect(minutes(nextCheck({ now, failed: false, failures: 0, foundNew: false, phase: "in_transit", previousMinutes: null }))).toBe(30);
    expect(minutes(nextCheck({ now, failed: false, failures: 0, foundNew: false, phase: "in_transit", previousMinutes: 30 }))).toBe(60);
    expect(minutes(nextCheck({ now, failed: false, failures: 0, foundNew: false, phase: "in_transit", previousMinutes: 240 }))).toBe(360);
    expect(minutes(nextCheck({ now, failed: false, failures: 0, foundNew: false, phase: "in_transit", previousMinutes: 360 }))).toBe(360);
  });

  it("backs off after failures from 30 minutes up to 12 hours", () => {
    expect([1, 2, 3, 4, 5, 6, 19].map((failures) => minutes(nextCheck({ now, failed: true, failures, foundNew: false, phase: "in_transit", previousMinutes: 30 })))).toEqual([
      30, 60, 120, 240, 480, 720, 720,
    ]);
  });

  it("stops on a verified delivery or return, an undone parcel, a removed agreement, 20 failures and 30 days", () => {
    const sentAt = new Date("2026-10-01T00:00:00.000Z");
    const base = { state: parcelState([]), now, sentAt, undone: false, agreement: true, failures: 0 };
    expect(stopReason(base)).toBeNull();
    expect(stopReason({ ...base, state: parcelState([ev("2026-10-13T00:00:00.000Z", "DELIVERED")]) })).toBe("delivered");
    expect(stopReason({ ...base, state: parcelState([ev("2026-10-13T00:00:00.000Z", "DELIVERED", "postnord")]) })).toBeNull();
    expect(stopReason({ ...base, state: parcelState([ev("2026-10-13T00:00:00.000Z", "RETURN")]) })).toBe("returned");
    expect(stopReason({ ...base, undone: true })).toBe("undone");
    expect(stopReason({ ...base, agreement: false })).toBe("no_agreement");
    expect(stopReason({ ...base, failures: 19 })).toBeNull();
    expect(stopReason({ ...base, failures: 20 })).toBe("carrier_failing");
    expect(stopReason({ ...base, now: new Date("2026-10-31T00:00:00.000Z") })).toBeNull();
    expect(stopReason({ ...base, now: new Date("2026-10-31T00:00:01.000Z") })).toBe("old");
  });
});

describe("carrier-event emails (2.7)", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const out = ev("2026-10-14T08:00:00.000Z", "TRANSPORT_TO_RECIPIENT");
  const delivered = ev("2026-10-14T11:00:00.000Z", "DELIVERED");

  it("sends out for delivery once, then delivered once", () => {
    const first = parcelState([out]);
    expect(trackingEmailsDue({ state: first, emailedOut: false, emailedDelivered: false, now })).toEqual({ out: true, delivered: false });
    expect(trackingEmailsDue({ state: first, emailedOut: true, emailedDelivered: false, now })).toEqual({ out: false, delivered: false });
    const second = parcelState([delivered, out]);
    expect(trackingEmailsDue({ state: second, emailedOut: true, emailedDelivered: false, now })).toEqual({ out: false, delivered: true });
    expect(trackingEmailsDue({ state: second, emailedOut: true, emailedDelivered: true, now })).toEqual({ out: false, delivered: false });
  });

  it("sends only the delivered email for a parcel first seen delivered", () => {
    expect(trackingEmailsDue({ state: parcelState([delivered, out]), emailedOut: false, emailedDelivered: false, now })).toEqual({ out: false, delivered: true });
    expect(trackingEmailsDue({ state: parcelState([delivered]), emailedOut: false, emailedDelivered: false, now })).toEqual({ out: false, delivered: true });
  });

  it("sends nothing for news more than 24 hours old when first seen", () => {
    const late = new Date("2026-10-15T11:00:00.001Z");
    expect(trackingEmailsDue({ state: parcelState([delivered]), emailedOut: false, emailedDelivered: false, now: late })).toEqual({ out: false, delivered: false });
    expect(trackingEmailsDue({ state: parcelState([delivered]), emailedOut: false, emailedDelivered: false, now: new Date("2026-10-15T11:00:00.000Z") }).delivered).toBe(true);
  });
});
