import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { t } from "@/lib/i18n";
import type { ShopperFulfilment } from "@/server/fulfilment";

import { OrderShipments } from "./order-shipments";

/**
 * The parcels on the shopper's order pages (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4 and 6.2 F2): both order pages draw this component, so its states are held here; the e2e
 * `partial-shipment.spec.ts` holds the order page with real rows.
 */

const parcel = (over: Partial<ShopperFulfilment["parcels"][number]> = {}): ShopperFulfilment["parcels"][number] => ({
  id: "p1",
  createdAt: "2026-10-05T09:00:00.000Z",
  carrier: "Posten",
  trackingNumber: "70712345678901234",
  trackingUrl: "https://sporing.posten.no/sporing/70712345678901234",
  legacy: false,
  lines: [{ lineId: "l1", sku: "SWEATER", title: "Ullgenser", quantity: 2 }],
  ...over,
});

const partly: ShopperFulfilment = {
  state: "partly_sent",
  parcels: [parcel()],
  stillToCome: [
    { lineId: "l1", sku: "SWEATER", title: "Ullgenser", quantity: 1, backordered: 0, backorderDays: null },
    { lineId: "l2", sku: "CAP", title: "Lue", quantity: 2, backordered: 2, backorderDays: 10 },
  ],
};

const sent: ShopperFulfilment = {
  state: "sent",
  parcels: [parcel(), parcel({ id: "p2", createdAt: "2026-10-06T09:00:00.000Z", trackingNumber: "70799", trackingUrl: null, lines: [{ lineId: "l2", sku: "CAP", title: "Lue", quantity: 2 }] })],
  stillToCome: [],
};

const draw = (fulfilment: ShopperFulfilment | null, lang = "nb", extra: { business?: boolean } = {}) =>
  renderToString(createElement(OrderShipments, { fulfilment, m: t(lang), locale: { nb: "nb-NO", sv: "sv-SE", da: "da-DK", en: "en-IE" }[lang] ?? "en-IE", timeZone: "Europe/Oslo", ...extra }));
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("OrderShipments", () => {
  it("draws nothing before the first parcel, or without fulfilment", () => {
    expect(draw(null)).toBe("");
    expect(draw({ state: "unsent", parcels: [], stillToCome: [{ lineId: "l1", sku: "S", title: "Ullgenser", quantity: 3, backordered: 0, backorderDays: null }] })).toBe("");
  });

  it("names the state, lists each parcel with its day, carrier, tracking and lines, and what is still to come", () => {
    const words = text(draw(partly));
    expect(words).toContain("Delvis sendt");
    expect(words).toContain("Pakke 1 · Sendt 5. oktober 2026");
    expect(words).toContain("Posten 70712345678901234");
    expect(words).toContain("Spor pakken");
    expect(words).toMatch(/Kommer senere 1 × Ullgenser 2 × Lue/);
    // Units on backorder keep the words of D172, with the days stated when sold.
    expect(words).toContain("2 på restordre: forventes sendt innen 10 dager");
    // Goods in parts: the right of withdrawal counts from the last parcel.
    expect(words).toContain("Angrefristen på 14 dager regnes fra den dagen du mottar den siste pakken.");
    const markup = draw(partly);
    expect(markup).toContain('href="https://sporing.posten.no/sporing/70712345678901234"');
    expect(markup).toContain('aria-labelledby="order-shipments"');
    expect(markup).toContain('data-order-shipments="partly_sent"');
  });

  it("says Sent when nothing is left, lists both parcels and keeps the receipt sentence for goods that came in parts", () => {
    const words = text(draw(sent));
    expect(words).toContain("Sendt");
    expect(words).toContain("Pakke 1");
    expect(words).toContain("Pakke 2 · Sendt 6. oktober 2026");
    expect(words).toContain("2 × Lue");
    expect(words).not.toContain("Kommer senere");
    expect(words).toContain("siste pakken");
    // A parcel without a web address is shown as text, never linked.
    expect((draw(sent).match(/<a /g) ?? []).length).toBe(1);
  });

  it("shows a single parcel that held everything without the receipt sentence", () => {
    const words = text(draw({ state: "sent", parcels: [parcel()], stillToCome: [] }));
    expect(words).toContain("2 × Ullgenser");
    expect(words).not.toContain("siste pakken");
  });

  it("shows a parcel from before parcels named their lines as before: carrier and tracking, no lines", () => {
    const words = text(draw({ state: "sent", parcels: [parcel({ legacy: true, lines: [] })], stillToCome: [] }));
    expect(words).toContain("Posten 70712345678901234");
    expect(words).not.toContain("×");
  });

  it("never links a tracking address that is not a web address", () => {
    const markup = draw({ state: "sent", parcels: [parcel({ trackingUrl: "javascript:alert(1)" })], stillToCome: [] });
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("<a ");
  });

  it("tells a business buyer nothing about a statutory withdrawal period", () => {
    expect(text(draw(partly, "nb", { business: true }))).not.toContain("Angrefristen");
  });

  it("is said in Swedish, Danish and English", () => {
    expect(text(draw(partly, "sv"))).toContain("Delvis skickad");
    expect(text(draw(partly, "sv"))).toContain("Kommer senare");
    expect(text(draw(partly, "sv"))).toContain("det sista paketet");
    expect(text(draw(partly, "da"))).toContain("Delvist sendt");
    expect(text(draw(partly, "da"))).toContain("den sidste pakke");
    expect(text(draw(partly, "en"))).toContain("Partly sent");
    expect(text(draw(partly, "en"))).toContain("Still to come");
    expect(text(draw(partly, "en"))).toContain("Parcel 1 · Sent 5 October 2026");
    expect(text(draw(partly, "en"))).toContain("count from the day you receive the last parcel");
  });

  it("shows no amount", () => {
    expect(text(draw(partly))).not.toMatch(/kr|NOK|€/);
  });
});
