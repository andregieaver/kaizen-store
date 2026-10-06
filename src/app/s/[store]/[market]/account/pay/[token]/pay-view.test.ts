import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The action is a server action; the page's states are what is tested (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1).
vi.mock("./actions", () => ({ startDraftPaymentAction: async () => ({ problem: null }) }));
vi.mock("server-only", () => ({}));

import type { TermsDisplay } from "@/lib/checkout-terms";
import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { PayView, type PayPageFound } from "./pay-view";

const TOKEN = "T".repeat(43);
const market = (lang = "en", slug = "ie", currency = "EUR", locale = "en-IE") => ({ slug, code: "IE", currency, locale, lang }) as Market;
const store = {
  id: "s1",
  slug: "demo",
  name: "Demo Shop",
  timeZone: "Europe/Dublin",
  details: { legalName: "Demo Shop Ltd", organisationNumber: "IE1234567", contactEmail: "hello@demo.test", postalAddress: "1 Main Street\nDublin", country: "IE" },
} as unknown as Store;

const line = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  variantId: "v1",
  title: "Tea",
  quantity: 2,
  unitPriceMinor: 5000,
  totalMinor: 10000,
  taxRate: 0.25,
  taxMinor: 2000,
  gift: false,
  custom: false,
  image: null,
  measure: null,
  backorder: null,
  ...over,
});
const order = (over: Record<string, unknown> = {}) =>
  ({
    id: "o1",
    number: "1042",
    status: "pending_payment",
    currency: "EUR",
    locale: "en-IE",
    lines: [line()],
    ships: true,
    shippingMinor: 500,
    shippingVatRate: 0.25,
    delivery: null,
    discountMinor: 0,
    staffDiscountMinor: 0,
    staffDiscountLabel: null,
    vatKind: "standard",
    vatReliefMinor: 0,
    taxMinor: 2100,
    vat: null,
    totalMinor: 10500,
    balanceMinor: 0,
    company: null,
    ...over,
  }) as unknown as NonNullable<PayPageFound["order"]>;
const found = (state: PayPageFound["state"], over: Record<string, unknown> = {}, note: string | null = null): PayPageFound => ({
  state,
  order: order(over),
  draft: { number: "D-7", noteToBuyer: note, expiresAt: "2026-10-20T10:30:00.000Z" },
  terms: "link",
});
const draw = (page: PayPageFound, extra: { lang?: string; terms?: TermsDisplay | null; withdrawalHref?: string | null; store?: Store } = {}) => {
  const lang = extra.lang ?? "en";
  const m = lang === "nb" ? market("nb", "no", "NOK", "nb-NO") : lang === "sv" ? market("sv", "se", "SEK", "sv-SE") : lang === "da" ? market("da", "dk", "DKK", "da-DK") : market();
  return renderToString(
    createElement(PayView, { page, store: extra.store ?? store, market: m, token: TOKEN, terms: extra.terms ?? null, withdrawalHref: extra.withdrawalHref ?? null }),
  );
};
const words = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const LINK_TERMS: TermsDisplay = {
  mode: "link",
  kind: "both",
  pages: [
    { role: "terms", title: "Terms of sale", href: "/s/demo/ie/terms" },
    { role: "privacy", title: "Privacy", href: "/s/demo/ie/privacy" },
  ],
};

describe("the pay link, ready to pay", () => {
  it("shows the order, who sells it, what it costs and the button with the amount", () => {
    const text = words(draw(found("ready")));
    expect(text).toContain("Order 1042");
    expect(text).toContain("The store has made this order for you");
    // The seller: the page has no site footer.
    expect(text).toContain("Seller Demo Shop Ltd");
    expect(text).toContain("Organisation number: IE1234567");
    expect(text).toContain("Address: 1 Main Street Dublin");
    expect(text).toContain("Contact: hello@demo.test");
    expect(text).toContain("2 × Tea €100.00");
    expect(text).toContain("Shipping €5.00");
    expect(text).toContain("Total €105.00");
    expect(text).toContain("VAT");
    expect(text).toContain("Pay €105.00");
    expect(text).toContain("You are sent to Stripe's secure payment page.");
  });

  it("says how long the link is valid, in the store's time zone", () => {
    // 10:30 UTC on 20 October is 11:30 in Dublin (summer time ended on 25 October at the earliest).
    expect(words(draw(found("ready")))).toMatch(/This link is valid until 20 October 2026(,| at) 11:30/);
  });

  it("says the right of withdrawal in one sentence, with a link to the store's page where it has one", () => {
    const without = draw(found("ready"));
    expect(words(without)).toContain("You can withdraw from the purchase within 14 days of receiving the goods");
    expect(without).not.toContain("Read the store");
    const withLink = draw(found("ready"), { withdrawalHref: "/s/demo/ie/withdrawal" });
    expect(withLink).toContain('href="/s/demo/ie/withdrawal"');
    expect(words(withLink)).toContain("Read the store's information about the right of withdrawal");
  });

  it("tells no goods-receipt right of withdrawal to a business buyer or for an order with nothing to ship, as the confirmation email does not (review fix)", () => {
    const sentence = "You can withdraw from the purchase within 14 days of receiving the goods";
    // A company has no statutory right: the sentence is left out, and the store's own page is still linked where it has one.
    const company = draw(found("ready", { company: { name: "Acme AS", number: "123456789" } }), { withdrawalHref: "/s/demo/ie/withdrawal" });
    expect(words(company)).not.toContain(sentence);
    expect(words(company)).not.toContain("14 days");
    expect(company).toContain('href="/s/demo/ie/withdrawal"');
    // A services-only order (nothing shipped): no goods-receipt period either.
    const services = draw(found("ready", { ships: false, shippingMinor: 0, totalMinor: 10000, taxMinor: 2000, lines: [line({ custom: true, variantId: null, title: "Installation" })] }));
    expect(words(services)).not.toContain(sentence);
    expect(words(services)).not.toContain("receiving the goods");
    // The consumer's goods order keeps it.
    expect(words(draw(found("ready")))).toContain(sentence);
  });

  it("shows the staff's discount under the name staff gave it, and a custom price as the price agreed", () => {
    const markup = draw(
      found("ready", {
        lines: [line({ title: "Consulting", unitPriceMinor: 8000, quantity: 1, custom: true })],
        staffDiscountMinor: 800,
        staffDiscountLabel: "Friends and family",
        totalMinor: 7700,
        taxMinor: 1540,
        shippingMinor: 500,
      }),
    );
    const text = words(markup);
    expect(text).toContain("Friends and family −€8.00");
    expect(text).toContain("1 × Consulting €80.00");
    // No "was" price: nothing is struck through and no list price is anywhere in it.
    expect(markup).not.toContain("line-through");
  });

  it("shows the store's note as text, with its lines kept and no markup", () => {
    const markup = draw(found("ready", {}, "Pick up Friday\n<b>Bring ID</b>"));
    expect(words(markup)).toContain("Message from the store");
    expect(markup).toContain("whitespace-pre-line");
    expect(markup).not.toContain("<b>Bring ID</b>");
    expect(markup).toContain("&lt;b&gt;Bring ID&lt;/b&gt;");
    expect(words(draw(found("ready")))).not.toContain("Message from the store");
  });

  it("says what is on backorder with the days the store states", () => {
    const text = words(draw(found("ready", { lines: [line({ backorder: { units: 1, days: 10 } })] })));
    expect(text).toContain("1 of 2 on backorder: expected to ship within 10 days of your order");
  });

  it("names a business buyer and the total without VAT", () => {
    const text = words(draw(found("ready", { company: { name: "Acme AS", number: "123456789" } })));
    expect(text).toContain("Acme AS");
    expect(text).toContain("Organisation number: 123456789");
    expect(text).toContain("Total excl. VAT €84.00");
  });

  it("shows no shipping row for an order with nothing to ship", () => {
    expect(words(draw(found("ready", { ships: false, shippingMinor: 0, totalMinor: 10000, taxMinor: 2000 })))).not.toContain("Shipping");
  });

  it("is a form with one button, no script, no card field and no Stripe.js, and does not repeat the token", () => {
    const markup = draw(found("ready"));
    expect(markup.match(/<button/g)).toHaveLength(1);
    // React's own form replay script is the only one `renderToString` adds for a form; nothing of ours loads a script.
    expect(markup.replace(/<script>addEventListener\("submit"[\s\S]*?<\/script>/, "")).not.toContain("<script");
    expect(markup).not.toMatch(/js\.stripe\.com|stripe\.js|cardnumber|autocomplete="cc-/i);
    expect(markup).not.toContain(TOKEN);
  });
});

describe("the pay link's terms, as the checkout draws them", () => {
  it("is a sentence with links when the store shows its terms, and the button is not held", () => {
    const markup = draw(found("ready"), { terms: LINK_TERMS });
    expect(markup).toContain('data-terms="link"');
    expect(markup).toContain('href="/s/demo/ie/terms"');
    expect(markup).toContain('href="/s/demo/ie/privacy"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain('type="checkbox"');
  });

  it("is a tick box that must be ticked, with the button held until it is, when the store asks for a tick", () => {
    const markup = draw(found("ready"), { terms: { ...LINK_TERMS, mode: "checkbox" } });
    expect(markup).toContain('data-terms="checkbox"');
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*required|<input[^>]*required[^>]*type="checkbox"/);
    expect(markup).toMatch(/<button[^>]*disabled=""/);
  });

  it("shows no sentence when the store shows none", () => {
    expect(draw(found("ready"))).not.toContain("data-terms");
  });
});

describe("the pay link's other states", () => {
  it("says a paid order is paid and offers no way to pay again", () => {
    const markup = draw(found("paid"));
    expect(words(markup)).toContain("This order is paid. Thank you!");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<form");
  });

  it("says an expired, cancelled or replaced link no longer works, with the store's address, and shows nothing of the order", () => {
    const page: PayPageFound = { state: "expired", order: null, draft: { number: "D-7", noteToBuyer: "secret note", expiresAt: "2026-10-01T00:00:00.000Z" }, terms: "link" };
    const markup = draw(page);
    const text = words(markup);
    expect(text).toContain("This link no longer works. Ask the store for a new one.");
    expect(text).toContain("Contact the store: hello@demo.test");
    expect(markup).not.toContain("<button");
    expect(text).not.toContain("secret note");
    expect(text).not.toMatch(/€/);
  });

  it("says the store cannot take payments right now, shows the order and offers no button", () => {
    const markup = draw(found("payments_off"));
    const text = words(markup);
    expect(text).toContain("The store cannot take payments right now.");
    expect(text).toContain("Total €105.00");
    expect(markup).not.toContain("<button");
  });

  it("leaves out the contact line of a store with no contact address", () => {
    const bare = { ...store, details: { ...store.details, contactEmail: null } } as Store;
    const page: PayPageFound = { state: "expired", order: null, draft: { number: "D-7", noteToBuyer: null, expiresAt: "2026-10-01T00:00:00.000Z" }, terms: "link" };
    expect(words(draw(page, { store: bare }))).not.toContain("Contact the store");
  });
});

describe("the pay link in the order's language", () => {
  it.each([
    ["nb", "Bestilling 1042", "Selger", "Du kan angre kjøpet innen 14 dager", "Betal"],
    ["sv", "Beställning 1042", "Säljare", "Du kan ångra köpet inom 14 dagar", "Betala"],
    ["da", "Ordre 1042", "Sælger", "Du kan fortryde købet inden for 14 dage", "Betal"],
    ["en", "Order 1042", "Seller", "You can withdraw from the purchase within 14 days", "Pay"],
  ])("is said in %s by hand", (lang, heading, seller, withdrawal, pay) => {
    const text = words(draw(found("ready", { currency: lang === "nb" ? "NOK" : lang === "sv" ? "SEK" : lang === "da" ? "DKK" : "EUR" }), { lang }));
    expect(text).toContain(heading);
    expect(text).toContain(seller);
    expect(text).toContain(withdrawal);
    expect(text).toContain(pay);
  });

  it("says an expired link in Norwegian, Swedish and Danish", () => {
    const page: PayPageFound = { state: "expired", order: null, draft: { number: "D-7", noteToBuyer: null, expiresAt: "2026-10-01T00:00:00.000Z" }, terms: "link" };
    expect(words(draw(page, { lang: "nb" }))).toContain("Denne lenken virker ikke lenger. Be butikken om en ny.");
    expect(words(draw(page, { lang: "sv" }))).toContain("Den här länken fungerar inte längre. Be butiken om en ny.");
    expect(words(draw(page, { lang: "da" }))).toContain("Dette link virker ikke længere. Bed butikken om et nyt.");
  });
});
