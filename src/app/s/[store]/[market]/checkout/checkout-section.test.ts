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
vi.mock("@/server/stripe", () => ({ platformPublishableKey: () => null }));
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

import { Checkout, CheckoutCredits, CheckoutDelivery, CheckoutTotals } from "./checkout-section";

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
      gift: false,
      image: null,
      booking: null,
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
