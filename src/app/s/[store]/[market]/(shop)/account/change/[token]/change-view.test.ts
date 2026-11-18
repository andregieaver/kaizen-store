import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The action is a server action; the page's states are what is tested (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4 and 6.1 E2).
vi.mock("./actions", () => ({ startEditPaymentAction: async () => ({ problem: null }) }));
vi.mock("server-only", () => ({}));

import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { ChangeView, type ChangePageFound } from "./change-view";

const TOKEN = "T".repeat(43);
const MARKETS: Record<string, Market> = {
  nb: { slug: "no", code: "NO", currency: "NOK", locale: "nb-NO", lang: "nb" } as Market,
  sv: { slug: "se", code: "SE", currency: "SEK", locale: "sv-SE", lang: "sv" } as Market,
  da: { slug: "dk", code: "DK", currency: "DKK", locale: "da-DK", lang: "da" } as Market,
  en: { slug: "no-en-eur", code: "NO", currency: "EUR", locale: "en-IE", lang: "en" } as Market,
};
const store = {
  id: "s1",
  slug: "demo",
  name: "Demo Butikk",
  timeZone: "Europe/Oslo",
  details: { legalName: "Demo Butikk AS", organisationNumber: "923456789", contactEmail: "hei@demo.test", postalAddress: "Storgata 1\n0182 Oslo", country: "NO" },
} as unknown as Store;

const edit = (over: Record<string, unknown> = {}) =>
  ({
    id: "e1",
    orderId: "o1",
    seq: 1,
    label: "E1",
    status: "awaiting_payment",
    reason: "customer_request",
    currency: "NOK",
    totalBeforeMinor: 134900,
    totalAfterMinor: 149800,
    shippingBeforeMinor: 9900,
    shippingAfterMinor: 9900,
    differenceMinor: 14900,
    documents: "none",
    expiresAt: "2026-10-14T10:30:00.000Z",
    appliedAt: null,
    endedAt: null,
    createdAt: "2026-10-07T10:30:00.000Z",
    lines: [
      { n: 1, kind: "reduce", sku: "SWEATER", title: "Ullgenser", quantity: 1, unitPriceMinor: 62500, totalMinor: 62500, taxMinor: 12500 },
      { n: 2, kind: "add", sku: "SCARF", title: "Skjerf", quantity: 2, unitPriceMinor: 38700, totalMinor: 77400, taxMinor: 15480 },
    ],
    ...over,
  }) as ChangePageFound["edit"];
const order = (over: Record<string, unknown> = {}) =>
  ({ id: "o1", number: "1042", status: "paid", currency: "NOK", locale: "nb-NO", marketCode: "NO", ships: true, company: null, ...over }) as unknown as ChangePageFound["order"];
const found = (state: ChangePageFound["state"], over: { edit?: Record<string, unknown>; order?: Record<string, unknown>; backorders?: ChangePageFound["backorders"] } = {}): ChangePageFound => ({
  state,
  edit: edit(over.edit),
  order: order(over.order),
  alreadyPaidMinor: 134900,
  toPayMinor: Number(edit(over.edit).differenceMinor),
  backorders: over.backorders ?? [],
});
const draw = (page: ChangePageFound, extra: { lang?: string; termsHref?: string | null; withdrawalHref?: string | null; store?: Store } = {}) =>
  renderToString(
    createElement(ChangeView, {
      page,
      store: extra.store ?? store,
      market: MARKETS[extra.lang ?? "nb"],
      token: TOKEN,
      termsHref: extra.termsHref ?? null,
      withdrawalHref: extra.withdrawalHref ?? null,
    }),
  );
const words = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/ | /g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("ChangeView", () => {
  it("shows the seller, what changes, the new total, what was paid and what is to pay now, with one button stating the amount", () => {
    const markup = draw(found("ready"), { termsHref: "/s/demo/no/vilkar", withdrawalHref: "/s/demo/no/angrerett" });
    const text = words(markup);
    expect(text).toContain("Endring av bestilling 1042");
    expect(text).toContain("Selger Demo Butikk AS");
    expect(text).toContain("923456789");
    expect(text).toContain("hei@demo.test");
    expect(text).toMatch(/Tatt ut 1 × Ullgenser −625,00 kr/);
    expect(text).toMatch(/Lagt til 2 × Skjerf 774,00 kr/);
    expect(text).toMatch(/Ny sum for bestillingen 1 498,00 kr/);
    expect(text).toMatch(/Allerede betalt 1 349,00 kr/);
    expect(text).toMatch(/Å betale nå: 149,00 kr/);
    // Until when, and what happens if the customer does nothing (Art. 22: the change is applied only when paid).
    expect(text).toMatch(/For å bekrefte endringen betaler du 149,00 kr innen 14\. oktober 2026.*Gjør du ikke det, forblir bestillingen som den var\./);
    // The right of withdrawal for the added goods, and the terms accepted with the order, each with the store's page.
    // Counted from the last parcel of the order (CRD Art. 9(2)(b)), and the change is proposed, not made (CRD Art. 22: review fix).
    expect(text).toContain("Du kan angre innen 14 dager etter at du har mottatt den siste pakken i bestillingen");
    expect(text).toContain("Butikken foreslår en endring av bestillingen din. Ingenting er endret ennå");
    expect(text).not.toContain("Butikken har endret bestillingen din");
    expect(markup).toContain('href="/s/demo/no/angrerett"');
    expect(text).toContain("Vilkårene du godtok da du bestilte, gjelder også for endringen.");
    expect(markup).toContain('href="/s/demo/no/vilkar"');
    // One button, with the amount; no tick box (the order's acceptance stands), no card field, no Stripe.js.
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(text).toContain("Betal 149,00 kr");
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toMatch(/stripe\.com\/v3|<iframe/);
    expect(text).toContain("Du sendes til Stripes sikre betalingsside.");
    // Unchanged shipping is not repeated.
    expect(text).not.toContain("Frakt");
  });

  it("shows the shipping when the change moved it", () => {
    const text = words(draw(found("ready", { edit: { shippingAfterMinor: 0, totalAfterMinor: 139900, differenceMinor: 5000 } })));
    expect(text).toContain("Frakt Gratis frakt");
    expect(text).toMatch(/Å betale nå: 50,00 kr/);
  });

  it("says when added units are on backorder, with the days the store states", () => {
    const text = words(draw(found("ready", { backorders: [{ title: "Skjerf", units: 2, days: 10 }] })));
    expect(text).toContain("Skjerf: 2 på restordre: forventes sendt innen 10 dager");
  });

  it("tells a business buyer nothing about a statutory withdrawal period", () => {
    const text = words(draw(found("ready", { order: { company: { name: "Firma AS", number: "999888777" } } })));
    expect(text).not.toContain("Du kan angre innen 14 dager");
  });

  it("a paid change says it is paid and shows no button", () => {
    const markup = draw(found("paid", { edit: { status: "applied" } }));
    expect(words(markup)).toContain("Denne endringen er betalt, og bestillingen din er oppdatert.");
    expect(markup).not.toContain("<button");
  });

  it("an ended link says the order is unchanged, gives the store's address, and shows nothing of the change", () => {
    for (const status of ["cancelled", "expired"]) {
      const markup = draw(found("ended", { edit: { status } }));
      const text = words(markup);
      expect(text).toContain("Denne lenken virker ikke lenger. Bestillingen din er uendret. Spør butikken hvis du fortsatt vil ha endringen.");
      expect(text).toContain("Kontakt butikken: hei@demo.test");
      expect(text).not.toContain("Skjerf");
      expect(text).not.toContain("kr");
      expect(markup).not.toContain("<button");
    }
  });

  it("payments off and an amount too small for a card show the change without a button, in words", () => {
    const off = draw(found("payments_off"));
    expect(words(off)).toContain("Butikken kan ikke ta imot betaling akkurat nå.");
    expect(off).not.toContain("<button");
    const small = draw(found("too_small", { edit: { differenceMinor: 100, totalAfterMinor: 135000 } }));
    expect(words(small)).toContain("Beløpet er for lite til å betales med kort. Kontakt butikken.");
    expect(small).not.toContain("<button");
  });

  it("is said in Swedish, Danish and English, in the order's currency", () => {
    expect(words(draw(found("ready"), { lang: "sv" }))).toContain("Ändring av beställning 1042");
    expect(words(draw(found("ended"), { lang: "da" }))).toContain("Dette link virker ikke længere. Din bestilling er uændret.");
    const en = words(draw(found("ready"), { lang: "en" }));
    expect(en).toContain("Change to order 1042");
    expect(en).toContain("Already paid");
    // The change is in the order's own currency, even in a euro view of the market (D109: never converted again).
    expect(en).toMatch(/NOK\s?149\.00|149\.00\s?NOK/);
  });
});
