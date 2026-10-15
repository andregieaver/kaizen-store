import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { t } from "@/lib/i18n";
import { EVENTS_SHOWN, type StoredEvent } from "@/lib/tracking-phases";
import type { ShopperFulfilment } from "@/server/fulfilment";
import type { ParcelTracking as Row } from "@/server/shipment-tracking";

import { OrderShipments } from "./order-shipments";
import { ParcelTracking, trackingPhaseLine } from "./parcel-tracking";

/**
 * Where a parcel is on the shopper's order pages (wave 3, D238, `docs/wave-3-notifications.md` 2.7 and 6.2): the phase line, the stored events, the
 * *no news* sentence, a carrier Kaizen does not follow, and a last check that failed. Both order pages draw it through `OrderShipments`.
 */

const event = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  at: "2026-10-06T08:15:00.000Z",
  code: "IN_TRANSIT",
  phase: "in_transit",
  verified: true,
  description: "Sendingen er på vei",
  location: "Oslo",
  ...over,
});

const row = (over: Partial<Row> = {}): Row => ({
  shipmentId: "p1",
  followed: "bring",
  phase: "in_transit",
  phaseVerified: true,
  events: [event()],
  checkedAt: "2026-10-06T09:00:00.000Z",
  lastCheckFailed: false,
  failures: 0,
  stopped: null,
  outAt: null,
  deliveredAt: null,
  ...over,
});

const LOCALES: Record<string, string> = { nb: "nb-NO", sv: "sv-SE", da: "da-DK", en: "en-IE" };
const draw = (tracking: Row | undefined, lang = "en") =>
  renderToString(createElement(ParcelTracking, { tracking, m: t(lang), locale: LOCALES[lang], timeZone: "Europe/Oslo" }));
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("ParcelTracking", () => {
  it("draws nothing for a parcel Kaizena Flow does not follow (its link stays in the parcel, as before)", () => {
    expect(draw(undefined)).toBe("");
    expect(draw(row({ followed: null, events: [] }))).toBe("");
  });

  it("says plainly when the carrier has no news yet, in the order's language", () => {
    expect(text(draw(row({ phase: null, events: [], checkedAt: null })))).toBe("Posten / Bring has no news about this parcel yet.");
    expect(text(draw(row({ events: [] }), "nb"))).toBe(t("nb").tracking.noNews("Posten / Bring"));
    expect(text(draw(row({ events: [] }), "sv"))).toBe(t("sv").tracking.noNews("Posten / Bring"));
  });

  it("shows the phase and the events newest first, with the time in the store's zone, the carrier's words and the place", () => {
    const markup = draw(
        row({
          events: [
            event({ at: "2026-10-05T07:00:00.000Z", code: "HANDED_IN", description: "Sendingen er levert inn", location: "Bergen" }),
            event({ at: "2026-10-06T06:30:00.000Z", code: "TRANSPORT_TO_RECIPIENT", phase: "out_for_delivery", description: "Sendingen er på vei til mottaker", location: null }),
          ],
        }),
      );
    const words = text(markup);
    expect(markup).toContain('aria-label="News from the carrier"');
    expect(words.startsWith("Out for delivery")).toBe(true);
    expect(words.indexOf("Sendingen er på vei til mottaker")).toBeLessThan(words.indexOf("Sendingen er levert inn"));
    expect(words).toContain("08:30"); // 06:30 UTC is 08:30 in Oslo (summer time)
    expect(words).toContain("· Bergen");
  });

  it("names the day of a verified delivery and the place of a parcel ready to collect", () => {
    const delivered = text(draw(row({ events: [event({ code: "DELIVERED", phase: "delivered" })], deliveredAt: "2026-10-06T08:15:00.000Z" })));
    expect(delivered.startsWith("Delivered 6 October 2026")).toBe(true);
    const ready = text(draw(row({ events: [event({ code: "READY_FOR_PICKUP", phase: "ready_for_collection", location: "Coop Mega Majorstuen" })] })));
    expect(ready.startsWith("Ready to collect at Coop Mega Majorstuen")).toBe(true);
    const problem = text(draw(row({ events: [event({ code: "DEVIATION", phase: "problem" })] }), "nb"));
    expect(problem.startsWith(t("nb").tracking.phases.problem)).toBe(true);
  });

  it("never states a phase from an unverified code: a PostNord parcel shows its events in the carrier's words only", () => {
    const markup = draw(row({ followed: "postnord", events: [event({ code: "DELIVERED", phase: "delivered", verified: false, description: "The item has been delivered" })] }));
    const words = text(markup);
    expect(words).toContain("The item has been delivered");
    expect(words.startsWith("Delivered")).toBe(false);
    expect(markup).toContain('data-parcel-tracking="events"');
  });

  it("reads an unlisted code after a known one as on its way, and an event without words by its phase or code", () => {
    expect(trackingPhaseLine([event({ code: "NEW_THING", phase: "unknown", verified: false }), event()])).toBe("in_transit");
    expect(trackingPhaseLine([event({ code: "NEW_THING", phase: "unknown", verified: false })])).toBeNull();
    expect(trackingPhaseLine([])).toBeNull();
    const words = text(draw(row({ events: [event({ description: "" }), event({ at: "2026-10-04T08:00:00.000Z", code: "ODD", phase: "unknown", verified: false, description: "" })] })));
    expect(words).toContain("On its way");
    expect(words).toContain("ODD");
  });

  it("shows at most the newest ten events", () => {
    const events = Array.from({ length: 14 }, (_, i) => event({ at: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), description: `Hendelse ${i}` }));
    const markup = draw(row({ events }));
    expect(markup.match(/data-tracking-event/g)?.length).toBe(EVENTS_SHOWN);
    expect(text(markup)).toContain("Hendelse 13");
    expect(text(markup)).not.toContain("Hendelse 3 ");
  });

  it("after a failed check shows what was last stored and never an error", () => {
    const words = text(draw(row({ lastCheckFailed: true, failures: 3 })));
    expect(words).toContain("Sendingen er på vei");
    expect(words.toLowerCase()).not.toMatch(/error|could not|failed|feil/);
  });

  it("escapes the carrier's words", () => {
    const markup = draw(row({ events: [event({ description: "<script>alert(1)</script>", location: "<b>x</b>" })] }));
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<b>");
  });
});

describe("OrderShipments with tracking", () => {
  const fulfilment: ShopperFulfilment = {
    state: "sent",
    parcels: [
      {
        id: "p1",
        createdAt: "2026-10-05T09:00:00.000Z",
        carrier: "Posten",
        trackingNumber: "70712345678901234",
        trackingUrl: "https://sporing.posten.no/sporing/70712345678901234",
        legacy: false,
        lines: [{ lineId: "l1", sku: "SWEATER", title: "Ullgenser", quantity: 2 }],
      },
      {
        id: "p2",
        createdAt: "2026-10-06T09:00:00.000Z",
        carrier: "DHL",
        trackingNumber: "JD0001",
        trackingUrl: "https://www.dhl.com/track?JD0001",
        legacy: false,
        lines: [{ lineId: "l2", sku: "CAP", title: "Lue", quantity: 1 }],
      },
    ],
    stillToCome: [],
  };
  const draw2 = (tracking: Row[]) =>
    renderToString(createElement(OrderShipments, { fulfilment, tracking, m: t("en"), locale: "en-IE", timeZone: "Europe/Oslo" }));

  it("draws each parcel's own tracking under it, and only the link for a parcel Kaizena Flow does not follow", () => {
    const markup = draw2([row({ shipmentId: "p1" }), row({ shipmentId: "p2", followed: null, events: [] })]);
    expect(markup.match(/data-parcel-tracking=/g)?.length).toBe(1);
    expect(markup).toContain("https://www.dhl.com/track?JD0001");
    expect(markup).toContain("https://sporing.posten.no/sporing/70712345678901234");
    const words = text(markup);
    expect(words.indexOf("Sendingen er på vei")).toBeLessThan(words.indexOf("Lue"));
  });

  it("draws the parcels as before without tracking rows", () => {
    expect(draw2([])).not.toContain("data-parcel-tracking");
  });
});
