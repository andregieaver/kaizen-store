import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CartBonus } from "@/lib/bonus";

// The checkout's server reads are replaced by one open order; what is tested is how the credits are drawn (D130).
vi.mock("server-only", () => ({}));
vi.mock("../cart/bonus", () => ({ readCartBonus: async () => bonusNow }));
vi.mock("./actions", () => ({
  checkoutCreditsAction: async () => ({ status: "idle", message: "" }),
  checkoutCodeAction: async () => undefined,
}));
vi.mock("@/server/cart", () => ({ readCartId: async () => "cart-1" }));
vi.mock("@/server/checkout", () => ({ getOpenCheckout: async () => ({ orderId: "o1", subscription: null }) }));
const getOrder = vi.fn();
vi.mock("@/server/orders", () => ({ getOrder: (...a: unknown[]) => getOrder(...a) }));
vi.mock("@/server/cart-reminders", () => ({ cartRemindersOn: async () => false, checkoutOptedOut: async () => false }));
vi.mock("@/server/customers", () => ({ getCustomer: async () => null }));
vi.mock("@/server/discounts", () => ({ getCartCode: async () => null }));
const stripeNow = vi.hoisted(() => ({ key: null as string | null }));
vi.mock("@/server/stripe", () => ({ platformPublishableKey: () => stripeNow.key }));
// The terms the store shows at checkout (wave 1, 1e): replaced by what the store has chosen.
const termsNow = vi.hoisted(() => ({ display: null as null | Record<string, unknown> }));
vi.mock("@/server/checkout-terms", () => ({ termsDisplayFor: async () => termsNow.display }));
vi.mock("@/components/checkout-button", () => ({ CheckoutButton: () => null }));
vi.mock("@/components/checkout-code-form", () => ({ CheckoutCodeForm: () => null }));
vi.mock("@/components/checkout-form", () => ({ CheckoutForm: () => null }));
vi.mock("@/components/line-thumbnail", () => ({ LineThumbnail: () => null }));
const deliveryNow = vi.hoisted(() => ({ options: null as null | { postalCode: string | null; options: unknown[] } }));
vi.mock("@/server/delivery-choice", () => ({ deliveryView: async () => deliveryNow.options }));
vi.mock("@/components/delivery-choice", () => ({ DeliveryChoice: () => "DELIVERY-CHOICE" }));

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { Checkout, CheckoutCredits, CheckoutDelivery, CheckoutItems, CheckoutTerms, CheckoutTotals } from "./checkout-section";

let bonusNow: CartBonus | null = null;
const market = { slug: "ie", code: "IE", currency: "EUR", locale: "en-IE", lang: "en" } as Market;
const store = { id: "s1", slug: "demo" } as Store;

const order = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  currency: "EUR",
  locale: "en-IE",
  lines: [
    {
      id: "l1",
      title: "Tea",
      quantity: 2,
      unitPriceMinor: 5000,
      taxRate: 0.25,
      taxMinor: 1700,
      gift: false,
      image: null,
      booking: null,
      measure: null,
    },
  ],
  subtotalMinor: 10000,
  ships: false,
  shippingMinor: 0,
  shippingVatRate: 0.25,
  discountMinor: 0,
  discountCode: null,
  memberDiscountMinor: 0,
  memberLabel: null,
  memberPercent: null,
  campaignDiscountMinor: 0,
  campaignLabel: null,
  referralDiscountMinor: 0,
  totalMinor: 8500,
  taxMinor: 1700,
  vatKind: "standard",
  vatReliefMinor: 0,
  vat: null,
  balanceMinor: 0,
  company: null,
  bonus: null,
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

beforeEach(() => {
  bonusNow = bonus();
  getOrder.mockResolvedValue(order({ bonus: { usedMinor: 1500, earnedMinor: 0, availableAt: null } }));
});

describe("the checkout's totals with bonus credits", () => {
  it("show the credits used as a discount row, separate from a code's discount", async () => {
    const text = words(renderToString(await CheckoutTotals({ store, market })));
    expect(text).toContain("Bonus credits −€15.00");
    expect(text).not.toContain("Discount");
  });

  it("have no row for an order without credits", async () => {
    getOrder.mockResolvedValue(order());
    expect(words(renderToString(await CheckoutTotals({ store, market })))).not.toContain("Bonus credits");
  });

  it("keep a business's discount apart from the credits, both without VAT", async () => {
    // 100.00 of goods, a 10.00 discount and 15.00 of credits, paid 75.00 with 25% VAT: 60.00 of VAT-free goods less the 8.00 and 12.00.
    getOrder.mockResolvedValue(
      order({
        company: { name: "Acme", number: "123456789" },
        discountMinor: 1000,
        totalMinor: 7500,
        taxMinor: 1500,
        bonus: { usedMinor: 1500, earnedMinor: 0, availableAt: null },
      }),
    );
    const text = words(renderToString(await CheckoutTotals({ store, market })));
    expect(text).toContain("Bonus credits −€12.00");
    expect(text).toContain("Discount −€8.00");
  });
});

describe("the checkout's totals with a friend's welcome discount (D131)", () => {
  it("show it as its own row, apart from a code's discount and the credits", async () => {
    getOrder.mockResolvedValue(order({ referralDiscountMinor: 1000, totalMinor: 9000, taxMinor: 1800 }));
    const text = words(renderToString(await CheckoutTotals({ store, market })));
    expect(text).toContain("Welcome discount −€10.00");
    expect(text).not.toContain("Discount −");
    expect(text).not.toContain("Bonus credits");
  });

  it("keep a business's discount apart from the welcome discount and the credits, all without VAT", async () => {
    // 100.00 of goods, a 10.00 code, a 10.00 welcome discount and 15.00 of credits, paid 65.00 with 25% VAT.
    getOrder.mockResolvedValue(
      order({
        company: { name: "Acme", number: "123456789" },
        discountMinor: 1000,
        referralDiscountMinor: 1000,
        totalMinor: 6500,
        taxMinor: 1300,
        bonus: { usedMinor: 1500, earnedMinor: 0, availableAt: null },
      }),
    );
    const text = words(renderToString(await CheckoutTotals({ store, market })));
    expect(text).toContain("Welcome discount −€8.00");
    expect(text).toContain("Bonus credits −€12.00");
    expect(text).toContain("Discount −€8.00");
  });

  it("have no row for an order without one", async () => {
    getOrder.mockResolvedValue(order());
    expect(words(renderToString(await CheckoutTotals({ store, market })))).not.toContain("Welcome discount");
  });
});

describe("the checkout's credits piece", () => {
  it("draws the control, filled in with what is in use", async () => {
    const markup = renderToString(await CheckoutCredits({ store, market }));
    expect(markup).toContain("<form");
    expect(markup).toContain('value="15"');
    expect(words(markup)).toContain("you can use up to €30.00 on this order");
  });

  it("says what the order earns to a customer with nothing to use", async () => {
    bonusNow = bonus({ availableMinor: 0, maxUsableMinor: 0, usingMinor: 0 });
    const markup = renderToString(await CheckoutCredits({ store, market }));
    expect(markup).not.toContain("<form");
    expect(words(markup)).toContain("You'll earn €2.50 in bonus credits on this order, usable 14 days after you pay.");
  });

  it("draws nothing without the program, and the whole checkout has no frame for it then", async () => {
    bonusNow = bonus({ enabled: false });
    expect(renderToString((await CheckoutCredits({ store, market })) ?? null)).toBe("");
    const page = words(renderToString(await Checkout({ store, market })));
    expect(page).not.toContain("Use bonus credits");
    bonusNow = bonus();
    expect(words(renderToString(await Checkout({ store, market })))).toContain(t("en").bonus.useHeading);
  });
});

describe("the checkout's delivery piece (D135)", () => {
  beforeEach(() => {
    deliveryNow.options = null;
    getOrder.mockResolvedValue(order({ ships: true, shippingMinor: 9900 }));
  });

  it("draws nothing when no carrier's services are on, in the piece and in the whole checkout", async () => {
    expect(renderToString((await CheckoutDelivery({ store, market })) ?? null)).toBe("");
    expect(renderToString(await Checkout({ store, market }))).not.toContain("DELIVERY-CHOICE");
  });

  it("draws the choice when there is something to choose from, before the payment", async () => {
    deliveryNow.options = { postalCode: null, options: [{ id: "flat" }] };
    expect(renderToString((await CheckoutDelivery({ store, market })) ?? null)).toContain("DELIVERY-CHOICE");
    expect(renderToString(await Checkout({ store, market }))).toContain("DELIVERY-CHOICE");
  });

  it("names the chosen service and its pickup point in the totals", async () => {
    getOrder.mockResolvedValue(
      order({
        ships: true,
        shippingMinor: 14113,
        delivery: { carrier: "bring", serviceId: "5800", label: "Pakke til hentested", postalCode: "0150", pickupPoint: { id: "PP1", name: "Kiwi", street: "Storgata 9", postalCode: "0155", city: "Oslo" } },
      }),
    );
    const markup = renderToString(await CheckoutTotals({ store, market }));
    expect(markup).toContain("Pakke til hentested");
    expect(markup).toContain("Kiwi, Storgata 9, 0155 Oslo");
  });
});

describe("the checkout's terms piece (wave 1, 1e)", () => {
  const pages = [
    { role: "terms", title: "Terms of sale", href: "/s/demo/ie/terms-of-sale" },
    { role: "privacy", title: "Privacy statement", href: "/s/demo/ie/privacy" },
  ];

  beforeEach(() => {
    stripeNow.key = "pk_test_1";
    termsNow.display = { mode: "link", kind: "both", pages };
  });

  it("draws the sentence with the store's two pages as links", async () => {
    const markup = renderToString(await CheckoutTerms({ store, market }));
    expect(words(markup)).toContain("By ordering you accept Terms of sale (opens in a new tab) and confirm that you have read Privacy statement (opens in a new tab) .");
    expect(markup).toContain('href="/s/demo/ie/terms-of-sale"');
    expect(markup).toContain('href="/s/demo/ie/privacy"');
    expect(markup).not.toContain('type="checkbox"');
  });

  it("draws a tick box in checkbox mode", async () => {
    termsNow.display = { mode: "checkbox", kind: "both", pages };
    const markup = renderToString(await CheckoutTerms({ store, market }));
    expect(markup).toContain('type="checkbox"');
    expect(words(markup)).toContain("I accept Terms of sale");
  });

  it("draws nothing when the store shows no terms, or the checkout starts over", async () => {
    termsNow.display = null;
    expect(renderToString(await CheckoutTerms({ store, market }))).toBe("");
    termsNow.display = { mode: "link", kind: "both", pages };
    stripeNow.key = null;
    expect(renderToString(await CheckoutTerms({ store, market }))).toBe("");
  });
});

describe("the checkout's totals with reverse charge (D157)", () => {
  it("say reverse charge on the VAT row and under the totals, with both VAT numbers, before the shopper pays", async () => {
    getOrder.mockResolvedValue(
      order({
        vatKind: "reverse_charge",
        vatReliefMinor: 1700,
        taxMinor: 0,
        totalMinor: 6800,
        company: { name: "Kunde GmbH", number: "123456789" },
        vat: { reason: "reverse_charge", sellerVatNumber: "SE556677889901", buyerVatNumber: "DE123456789", buyerCountry: "DE", iossNumber: null, viesStatus: "valid", viesCheckedAt: null },
      }),
    );
    const text = words(renderToString(await CheckoutTotals({ store, market })));
    expect(text).toContain("VAT (reverse charge) €0.00");
    expect(text).toContain("Total excl. VAT €68.00");
    expect(text).toContain("Reverse charge: VAT has not been charged.");
    expect(text).toContain("Seller's VAT number: SE556677889901");
    expect(text).toContain("Buyer's VAT number: DE123456789");
    // Collected under IOSS is only said once it has been (the order page and the email).
    expect(text).not.toContain("under IOSS");
  });
});

describe("the checkout's lines with a unit price (D160)", () => {
  const measured = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    title: "Coffee",
    quantity: 2,
    unitPriceMinor: 5000,
    taxRate: 0.25,
    taxMinor: 1700,
    gift: false,
    image: null,
    booking: null,
    measure: { amount: "250", unit: "g", base: "kg" },
    ...over,
  });
  const items = async () => renderToString(await CheckoutItems({ store, market }));

  it("show the price per kg from the order line's own price and the content it was sold with, whatever the quantity", async () => {
    getOrder.mockResolvedValue(order({ lines: [measured()] }));
    // 50.00 for 250 g is 200.00 per kg.
    expect(words(await items())).toContain("2 × Coffee");
    expect(words(await items())).toContain("€200.00/kg");
  });

  it("show a business the price without VAT, as the line's amount is", async () => {
    getOrder.mockResolvedValue(order({ company: { name: "Acme", number: "123456789" }, lines: [measured()] }));
    // 50.00 with 25% VAT is 40.00 without it: 160.00 per kg.
    const text = words(await items());
    expect(text).toContain("€160.00/kg");
    expect(text).not.toContain("€200.00/kg");
  });

  it("leave out a gift, a line without content and one whose price equals the unit price", async () => {
    getOrder.mockResolvedValue(
      order({
        lines: [
          measured({ id: "g", gift: true, title: "Gift" }),
          measured({ id: "n", measure: null, title: "Plain" }),
          measured({ id: "e", measure: { amount: "1", unit: "kg", base: "kg" }, title: "Kilo" }),
        ],
      }),
    );
    expect(await items()).not.toContain("data-unit-price");
  });

  it("is part of the whole checkout page", async () => {
    getOrder.mockResolvedValue(order({ lines: [measured()] }));
    expect(words(renderToString(await Checkout({ store, market })))).toContain("€200.00/kg");
  });
});

describe("the checkout's lines on backorder (wave 3, D172)", () => {
  const backordered = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    title: "Thermos",
    quantity: 5,
    unitPriceMinor: 5000,
    taxRate: 0.25,
    taxMinor: 1700,
    gift: false,
    image: null,
    booking: null,
    measure: null,
    backorder: { units: 2, days: 7 },
    ...over,
  });
  const items = async () => renderToString(await CheckoutItems({ store, market }));

  it("say how many units are on backorder and the days the store states, before the shopper pays", async () => {
    getOrder.mockResolvedValue(order({ lines: [backordered()] }));
    expect(words(await items())).toContain("2 on backorder: expected to ship within 7 days");
  });

  it("say nothing for a line wholly in stock, and keep the line's amount as it is", async () => {
    getOrder.mockResolvedValue(order({ lines: [backordered({ backorder: null })] }));
    const text = words(await items());
    expect(text).not.toMatch(/backorder/i);
    expect(text).toContain("5 × Thermos");
  });
});
