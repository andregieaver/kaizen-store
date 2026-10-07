import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CartBonus } from "@/lib/bonus";

// The cart's server reads are replaced by one cart and its summary; what is tested is how the credits are drawn (D130).
vi.mock("server-only", () => ({}));
const readCartBonus = vi.fn();
vi.mock("./bonus", () => ({ readCartBonus: (...a: unknown[]) => readCartBonus(...a) }));
vi.mock("./actions", () => ({
  updateCartLine: async () => undefined,
  setCartCreditsAction: async () => ({ status: "idle", message: "" }),
}));
const getBuyer = vi.fn();
vi.mock("@/server/b2b", () => ({ getBuyer: (...a: unknown[]) => getBuyer(...a) }));
const cartState = vi.hoisted(() => ({ company: null as unknown, measure: null as unknown, quantity: 1, status: "ok", backorder: null as unknown }));
// The store's gift messages (wave 3, D173): whether the switch is on, and what the cart holds of a gift.
const giftState = vi.hoisted(() => ({ enabled: false, gift: { isGift: false, to: null, from: null, message: null } as unknown }));
vi.mock("@/server/cart", () => ({
  getCart: async () => ({
    lines: [
      {
        variantId: "v1",
        audience: "both",
        quantity: cartState.quantity,
        measure: cartState.measure,
        title: "Tea",
        handle: "tea",
        options: {},
        delivery: "physical",
        image: null,
        plan: null,
        booking: null,
        status: cartState.status,
        available: 9,
        inStock: 9,
        backorder: cartState.backorder,
        unitPriceMinor: 10000,
        vatRate: 0.25,
      },
    ],
    currency: "EUR",
    company: cartState.company,
  }),
  getCartGift: async () => ({ enabled: giftState.enabled, gift: giftState.gift }),
}));
// The box itself is a client component with its own test; here only where the cart draws it, and what it is given.
vi.mock("./cart-gift", () => ({
  GiftBox: (props: { store: string; market: string; lang: string; initial: { isGift: boolean } }) =>
    createElement("div", { "data-gift-box-mock": "", "data-ticked": String(props.initial.isGift), "data-lang": props.lang }),
}));
const cartSummary = vi.fn();
vi.mock("@/server/cart-summary", () => ({ cartSummary: (...a: unknown[]) => cartSummary(...a) }));
vi.mock("@/server/customers", () => ({ getCustomer: async () => null }));
const checkoutButton = vi.hoisted(() => vi.fn());
vi.mock("@/components/checkout-button", () => ({
  CheckoutButton: (props: unknown) => {
    checkoutButton(props);
    return null;
  },
}));
vi.mock("@/components/discount-code-form", () => ({ DiscountCodeForm: () => null }));

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { CartCheckout, CartContents, CartCredits, CartGift, CartSummary } from "./cart-contents";

const market = { slug: "ie", code: "IE", currency: "EUR", locale: "en-IE", lang: "en" } as Market;
const store = { id: "s1", slug: "demo", audience: "both" } as Store;
const m = t("en");

const line = { variantId: "v1", vatRate: 0.25, unitPriceMinor: 10000, quantity: 1 };
/** What `cartSummary().tax` holds for an ordinary cart (D157): VAT charged, no VAT number field offered. */
const standardTax = (over: Record<string, unknown> = {}) => ({
  kind: "standard",
  reason: "consumer",
  reverseCharge: false,
  notes: [],
  importNotice: false,
  reliefMinor: 0,
  shippingRate: 0.25,
  buyerVatNumber: null,
  buyerState: "none",
  sellerVatNumber: null,
  field: { offered: false, reason: "private" },
  fieldIfBusiness: { offered: false, reason: "market_not_eu" },
  ...over,
});
const summary = (over: Record<string, unknown> = {}) => ({
  payable: [line],
  blocked: false,
  checkout: { vatRate: 0.25, paymentsOn: true, starter: false, shipping: null },
  fees: [],
  feeMinor: 0,
  ships: false,
  basket: { renewal: 0 },
  shipping: null,
  code: null,
  applied: null,
  discountMinor: 0,
  member: null,
  memberDiscountMinor: 0,
  campaignDiscountMinor: 0,
  campaignNames: [],
  today: () => 10000,
  lineDiscount: () => 0,
  total: 8500,
  vat: 1700,
  balance: 0,
  bonusMinor: 0,
  referralMinor: 0,
  referral: { state: "none", percent: 0, discountMinor: 0 },
  tax: standardTax(),
  plan: null,
  renewal: null,
  trial: false,
  gifts: [],
  atVenueOnly: false,
  digital: false,
  ...over,
});
const bonus = (over: Partial<CartBonus> = {}): CartBonus => ({
  enabled: true,
  signedIn: true,
  availableMinor: 5000,
  pendingMinor: 0,
  pendingAvailableAt: null,
  maxUsableMinor: 3000,
  usingMinor: 1500,
  willEarnMinor: 250,
  earnPercent: 5,
  pendingDays: 14,
  ...over,
});
const words = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const draw = async (piece: typeof CartSummary) => renderToString(await piece({ store, market, m }));

beforeEach(() => {
  vi.clearAllMocks();
  getBuyer.mockResolvedValue("consumer");
  cartState.company = null;
  cartState.measure = null;
  cartState.quantity = 1;
  cartState.status = "ok";
  cartState.backorder = null;
  giftState.enabled = false;
  giftState.gift = { isGift: false, to: null, from: null, message: null };
  cartSummary.mockResolvedValue(summary());
  readCartBonus.mockResolvedValue(bonus());
});

describe("the cart's totals with bonus credits", () => {
  it("show the credits used as a discount row that comes off the total", async () => {
    cartSummary.mockResolvedValue(summary({ bonusMinor: 1500, total: 7000, vat: 1400 }));
    const text = words(await draw(CartSummary));
    expect(text).toContain("Bonus credits −€15.00");
    expect(text).toMatch(/Total €70\.00/);
  });

  it("have no row when no credits are used", async () => {
    expect(words(await draw(CartSummary))).not.toContain("Bonus credits");
  });

  it("show a business the credits without VAT, like the other amounts", async () => {
    getBuyer.mockResolvedValue("business");
    cartSummary.mockResolvedValue(summary({ bonusMinor: 1500, total: 7000, vat: 1400 }));
    // 15.00 at 25% VAT is 12.00 without it.
    expect(words(await draw(CartSummary))).toContain("Bonus credits −€12.00");
  });
});

describe("the cart's credits piece", () => {
  it("draws the control for a signed-in customer with credits, filled in with what is in use", async () => {
    const markup = renderToString(await CartCredits({ store, market, m }));
    expect(markup).toContain("<form");
    expect(markup).toContain('value="15"');
    expect(words(markup)).toContain("You have €50.00 available; you can use up to €30.00 on this order.");
    expect(readCartBonus).toHaveBeenCalledWith(store, market);
  });

  it("invites a guest to sign in, to the store's own sign-in", async () => {
    readCartBonus.mockResolvedValue(
      bonus({ signedIn: false, availableMinor: 0, maxUsableMinor: 0, usingMinor: 0, willEarnMinor: 0 }),
    );
    const markup = renderToString(await CartCredits({ store, market, m }));
    expect(words(markup)).toContain("Sign in to earn 5% back in bonus credits");
    expect(markup).toContain('href="/s/demo/ie/account"');
  });

  it("draws nothing in a store without the program, or for an empty cart", async () => {
    readCartBonus.mockResolvedValue(bonus({ enabled: false }));
    expect(renderToString((await CartCredits({ store, market, m })) ?? null)).toBe("");
    readCartBonus.mockResolvedValue(null);
    expect(renderToString((await CartCredits({ store, market, m })) ?? null)).toBe("");
  });

  it("is part of the whole cart page, and only where the store has the program", async () => {
    const markup = renderToString(await CartContents({ store, market, m }));
    expect(markup).toContain("Use bonus credits");
    readCartBonus.mockResolvedValue(bonus({ enabled: false }));
    expect(renderToString(await CartContents({ store, market, m }))).not.toContain("Use bonus credits");
  });
});

describe("the cart's totals with a friend's welcome discount (D131)", () => {
  it("show it as its own row, apart from the discount and the credits, and it comes off the total", async () => {
    cartSummary.mockResolvedValue(
      summary({ referralMinor: 1000, referral: { state: "applied", percent: 10, discountMinor: 1000 }, total: 7500, vat: 1500 }),
    );
    const text = words(await draw(CartSummary));
    expect(text).toContain("Welcome discount −€10.00");
    expect(text).toMatch(/Total €75\.00/);
    expect(text).not.toContain("Discount (");
    expect(text).not.toContain("Sign in to get");
  });

  it("show a business the discount without VAT, like the other amounts", async () => {
    getBuyer.mockResolvedValue("business");
    cartSummary.mockResolvedValue(summary({ referralMinor: 1000, referral: { state: "applied", percent: 10, discountMinor: 1000 } }));
    // 10.00 at 25% VAT is 8.00 without it.
    expect(words(await draw(CartSummary))).toContain("Welcome discount −€8.00");
  });

  it("invite a guest who came through a friend's link to sign in for it, to the store's own sign-in", async () => {
    cartSummary.mockResolvedValue(summary({ referral: { state: "guest", percent: 10, discountMinor: 0 } }));
    const markup = renderToString(await CartSummary({ store, market, m }));
    expect(words(markup)).toContain("Sign in to get 10% off the goods in your first order");
    expect(markup).toContain('href="/s/demo/ie/account"');
    expect(words(markup)).not.toContain("Welcome discount");
  });

  it("say nothing when it does not apply, so the cart never tells a shopper why a guard stopped them", async () => {
    const text = words(await draw(CartSummary));
    expect(text).not.toContain("Welcome discount");
    expect(text).not.toContain("Sign in to get");
  });
});

// ---------------------------------------------------------------------------
// VAT (D157): reverse charge, the VAT number field, the import notice
// ---------------------------------------------------------------------------

const reverse = (over: Record<string, unknown> = {}) =>
  standardTax({
    kind: "reverse_charge",
    reason: "reverse_charge",
    reverseCharge: true,
    reliefMinor: 2000,
    buyerVatNumber: "DE123456789",
    buyerState: "valid",
    sellerVatNumber: "SE556677889901",
    field: { offered: true },
    fieldIfBusiness: { offered: true },
    ...over,
  });

describe("the cart's totals with reverse charge (D157)", () => {
  it("show a business the amounts without VAT, a VAT row that says reverse charge, the statement and both numbers", async () => {
    getBuyer.mockResolvedValue("business");
    cartSummary.mockResolvedValue(summary({ total: 8000, vat: 0, tax: reverse() }));
    const text = words(await draw(CartSummary));
    expect(text).toContain("Total excl. VAT €80.00");
    expect(text).toContain("VAT (reverse charge) €0.00");
    expect(text).toContain("Reverse charge: VAT has not been charged.");
    expect(text).toContain("Seller's VAT number: SE556677889901");
    expect(text).toContain("Buyer's VAT number: DE123456789");
    expect(text).not.toContain("incl. VAT");
  });

  it("show a shopper who sees prices with VAT the VAT not charged as a row before the total, and never say VAT is included", async () => {
    cartSummary.mockResolvedValue(summary({ total: 8000, vat: 0, tax: reverse() }));
    const text = words(await draw(CartSummary));
    expect(text).toContain("VAT not charged (reverse charge) −€20.00");
    expect(text).toMatch(/Total €80\.00/);
    expect(text).not.toContain("incl. VAT");
  });

  it("say it in the store's language, by hand: Norwegian omvendt avgiftsplikt, Danish omvendt betalingspligt", async () => {
    cartSummary.mockResolvedValue(summary({ total: 8000, vat: 0, tax: reverse() }));
    const nb = { ...market, lang: "nb", locale: "nb-NO" } as Market;
    expect(words(renderToString(await CartSummary({ store, market: nb, m: t("nb") })))).toContain("Omvendt avgiftsplikt: det er ikke beregnet merverdiavgift.");
    const da = { ...market, lang: "da", locale: "da-DK" } as Market;
    expect(words(renderToString(await CartSummary({ store, market: da, m: t("da") })))).toContain("Omvendt betalingspligt: der er ikke opkrævet moms.");
  });

  it("show nothing about reverse charge for an ordinary cart, and keep saying VAT is included", async () => {
    const text = words(await draw(CartSummary));
    expect(text).not.toContain("Reverse charge");
    expect(text).not.toContain("not charged");
    expect(text).toContain("incl. VAT");
  });

  it("say that import VAT and customs may be collected on delivery when the cart's goods come from outside the EU", async () => {
    cartSummary.mockResolvedValue(summary({ tax: standardTax({ importNotice: true }) }));
    expect(words(await draw(CartSummary))).toContain("Import VAT and customs charges may be collected on delivery.");
  });
});

describe("the cart's VAT number field (D157)", () => {
  const checkoutProps = async () => {
    checkoutButton.mockClear();
    // The piece returns the button's element: render it so the mock records its props.
    renderToString(await CartCheckout({ store, market, m }));
    return checkoutButton.mock.calls.at(-1)?.[0] as { company: { ask: boolean }; vat?: { offered: boolean; initial: string; message: { text: string; tone: string } | null; note?: string } };
  };

  it("is not offered to a private buyer", async () => {
    expect((await checkoutProps()).vat).toBeUndefined();
  });

  it("is offered to a business where reverse charge could apply, before any number is typed", async () => {
    getBuyer.mockResolvedValue("business");
    cartSummary.mockResolvedValue(summary({ tax: standardTax({ fieldIfBusiness: { offered: true } }) }));
    const props = await checkoutProps();
    expect(props.company.ask).toBe(true);
    expect(props.vat).toMatchObject({ offered: true, initial: "", message: null });
  });

  it("is not offered where it cannot help: the seller's own country, a market outside the EU, a seller not ready", async () => {
    getBuyer.mockResolvedValue("business");
    for (const reason of ["domestic", "market_not_eu", "seller_not_ready", "host_order"]) {
      cartSummary.mockResolvedValue(summary({ tax: standardTax({ fieldIfBusiness: { offered: false, reason } }) }));
      expect((await checkoutProps()).vat, reason).toBeUndefined();
    }
  });

  it("says in one line why not for a cart with a booking or a subscription", async () => {
    getBuyer.mockResolvedValue("business");
    cartSummary.mockResolvedValue(summary({ tax: standardTax({ fieldIfBusiness: { offered: false, reason: "has_service" } }) }));
    expect((await checkoutProps()).vat).toMatchObject({ offered: false, note: expect.stringContaining("appointment") });
    cartSummary.mockResolvedValue(summary({ tax: standardTax({ fieldIfBusiness: { offered: false, reason: "has_subscription" } }) }));
    expect((await checkoutProps()).vat).toMatchObject({ offered: false, note: expect.stringContaining("subscription") });
  });

  it("carries the number on the cart and what the server made of it, in the words of each outcome", async () => {
    getBuyer.mockResolvedValue("business");
    cartState.company = { name: "Kunde GmbH", number: "123456789", vatNumber: "DE123456789", vatCheck: { status: "valid", checkedAt: "2026-10-03T10:00:00.000Z" } };
    const outcome = async (reason: string, state = "valid") => {
      cartSummary.mockResolvedValue(
        summary({ tax: standardTax({ reason, buyerVatNumber: "DE123456789", buyerState: state, field: { offered: true }, fieldIfBusiness: { offered: true } }) }),
      );
      return (await checkoutProps()).vat;
    };
    expect(await outcome("reverse_charge")).toMatchObject({ initial: "DE123456789", message: { text: expect.stringContaining("accepted"), tone: "ok" } });
    expect((await outcome("number_invalid", "invalid"))?.message).toMatchObject({ text: "This VAT number was not accepted. VAT is charged.", tone: "warn" });
    // VIES could not answer: VAT is charged, said plainly, never "exempt".
    expect((await outcome("number_unavailable", "unavailable"))?.message?.text).toBe(
      "The VAT number could not be checked right now. VAT is charged. Try again in a moment.",
    );
    expect((await outcome("number_stale", "stale"))?.message?.text).toContain("could not be checked right now");
    expect((await outcome("number_other_country"))?.message?.text).toBe("The number is for Germany, but the goods go to Ireland. VAT is charged.");
    expect((await outcome("own_number"))?.message?.text).toContain("store's own VAT number");
    expect((await outcome("number_not_eu"))?.message?.text).toContain("Only VAT numbers from EU member states");
  });
});

describe("the cart's lines with a unit price (D160)", () => {
  const lines = async () => renderToString(await CartContents({ store, market, m }));

  it("show the price per kg of one unit's price, with the content the variant has now", async () => {
    cartState.measure = { amount: "500", unit: "g", base: "kg" };
    const markup = await lines();
    // 100.00 for 500 g is 200.00 per kg.
    expect(words(markup)).toContain("€200.00/kg");
    expect(markup).toMatch(/sr-only[^>]*>Unit price: €200\.00 per kg</);
  });

  it("does not depend on the quantity", async () => {
    cartState.measure = { amount: "500", unit: "g", base: "kg" };
    cartState.quantity = 3;
    expect(words(await lines())).toContain("€200.00/kg");
  });

  it("is of the price without VAT for a business buyer, as the line's own amount is", async () => {
    getBuyer.mockResolvedValue("business");
    cartState.measure = { amount: "500", unit: "g", base: "kg" };
    // 100.00 with 25% VAT is 80.00 without it, so 160.00 per kg.
    const text = words(await lines());
    expect(text).toContain("€160.00/kg");
    expect(text).not.toContain("€200.00/kg");
  });

  it("has none without content, for a line that cannot be bought, or when it equals the price", async () => {
    expect(await lines()).not.toContain("data-unit-price");
    cartState.measure = { amount: "500", unit: "g", base: "kg" };
    cartState.status = "unavailable";
    expect(await lines()).not.toContain("data-unit-price");
    cartState.status = "ok";
    cartState.measure = { amount: "1", unit: "kg", base: "kg" };
    expect(await lines()).not.toContain("data-unit-price");
  });

  it("is drawn in the slide-out cart too", async () => {
    cartState.measure = { amount: "500", unit: "g", base: "kg" };
    const markup = renderToString(await CartContents({ store, market, m, drawer: true }));
    expect(words(markup)).toContain("€200.00/kg");
  });
});

describe("the cart's lines on backorder (wave 3, D172)", () => {
  const lines = async (drawer = false) => renderToString(await CartContents({ store, market, m, drawer }));

  it("say how many units are on backorder and within how many days they are expected to ship, and are not an alert", async () => {
    cartState.quantity = 5;
    cartState.backorder = { units: 2, days: 7 };
    const markup = await lines();
    expect(words(markup)).toContain("2 on backorder: expected to ship within 7 days");
    expect(markup).not.toMatch(/role="alert"[^>]*>[^<]*backorder/);
  });

  it("choose the singular for one day and say nothing for a line wholly in stock", async () => {
    cartState.backorder = { units: 1, days: 1 };
    expect(words(await lines())).toContain("1 on backorder: expected to ship within 1 day");
    cartState.backorder = null;
    expect(await lines()).not.toContain("data-backorder");
  });

  it("is drawn in the slide-out cart too, and promises no date and never says in stock", async () => {
    cartState.backorder = { units: 3, days: 30 };
    const text = words(await lines(true));
    expect(text).toContain("3 on backorder: expected to ship within 30 days");
    expect(text).not.toMatch(/in stock|på lager|\d{4}-\d{2}-\d{2}/i);
  });

  it("is said in Norwegian, Swedish and Danish by hand", async () => {
    cartState.backorder = { units: 2, days: 7 };
    const say = async (lang: "nb" | "sv" | "da") => words(renderToString(await CartContents({ store, market: { ...market, lang } as Market, m: t(lang) })));
    expect(await say("nb")).toContain("2 på restordre: forventes sendt innen 7 dager");
    expect(await say("sv")).toContain("2 på restorder: förväntas skickas inom 7 dagar");
    expect(await say("da")).toContain("2 på restordre: forventes afsendt inden for 7 dage");
  });
});

describe("the cart's gift box (wave 3, run 2, D173)", () => {
  const box = (markup: string) => markup.includes("data-gift-box-mock");

  it("is drawn by the whole cart page, under the lines, only in a store with gift messages switched on", async () => {
    expect(box(renderToString(await CartContents({ store, market, m })))).toBe(false);
    giftState.enabled = true;
    const markup = renderToString(await CartContents({ store, market, m }));
    expect(box(markup)).toBe(true);
    // Under the lines, before the summary.
    expect(markup.indexOf("data-gift-box-mock")).toBeLessThan(markup.indexOf("<aside"));
    expect(markup.indexOf("data-gift-box-mock")).toBeGreaterThan(markup.indexOf("<ul"));
  });

  it("is given what the cart holds, in the shopper's language", async () => {
    giftState.enabled = true;
    giftState.gift = { isGift: true, to: "Kari", from: null, message: "Hei" };
    const markup = renderToString(await CartContents({ store, market: { ...market, lang: "nb" } as Market, m: t("nb") }));
    expect(markup).toContain('data-ticked="true"');
    expect(markup).toContain('data-lang="nb"');
  });

  it("is its own piece, which draws nothing in a store without gift messages", async () => {
    expect(renderToString((await CartGift({ store, market, m })) ?? null)).toBe("");
    giftState.enabled = true;
    expect(box(renderToString(await CartGift({ store, market, m })))).toBe(true);
  });

  it("is drawn by the checkout piece when the page has no gift piece of its own, so an older cart page still has it", async () => {
    giftState.enabled = true;
    expect(box(renderToString(await CartCheckout({ store, market, m })))).toBe(false);
    expect(box(renderToString(await CartCheckout({ store, market, m, drawGift: true })))).toBe(true);
    giftState.enabled = false;
    expect(box(renderToString(await CartCheckout({ store, market, m, drawGift: true })))).toBe(false);
  });

  it("is in the slide-out cart too", async () => {
    giftState.enabled = true;
    expect(box(renderToString(await CartContents({ store, market, m, drawer: true })))).toBe(true);
  });
});

describe("the cart of a store template (D175)", () => {
  it("says the store takes no orders instead of drawing the checkout button", async () => {
    cartSummary.mockResolvedValue(summary({ checkout: { vatRate: 0.25, paymentsOn: false, starter: true, shipping: null } }));
    checkoutButton.mockClear();
    const text = words(renderToString(await CartCheckout({ store, market, m })));
    expect(checkoutButton).not.toHaveBeenCalled();
    expect(text).toContain(m.starterCheckout);
    expect(text).not.toContain(m.checkoutUnavailable);
  });

  it("keeps the ordinary words for a store whose payments are off", async () => {
    cartSummary.mockResolvedValue(summary({ checkout: { vatRate: 0.25, paymentsOn: false, starter: false, shipping: null } }));
    expect(words(renderToString(await CartCheckout({ store, market, m })))).toContain(m.checkoutUnavailable);
  });
});
