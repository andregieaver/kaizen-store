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
vi.mock("@/server/cart", () => ({
  getCart: async () => ({
    lines: [
      {
        variantId: "v1",
        audience: "both",
        quantity: 1,
        title: "Tea",
        handle: "tea",
        options: {},
        delivery: "physical",
        image: null,
        plan: null,
        booking: null,
        status: "ok",
        available: 9,
        unitPriceMinor: 10000,
        vatRate: 0.25,
      },
    ],
    currency: "EUR",
    company: null,
  }),
}));
const cartSummary = vi.fn();
vi.mock("@/server/cart-summary", () => ({ cartSummary: (...a: unknown[]) => cartSummary(...a) }));
vi.mock("@/server/customers", () => ({ getCustomer: async () => null }));
vi.mock("@/components/checkout-button", () => ({ CheckoutButton: () => null }));
vi.mock("@/components/discount-code-form", () => ({ DiscountCodeForm: () => null }));

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { CartContents, CartCredits, CartSummary } from "./cart-contents";

const market = { slug: "ie", code: "IE", currency: "EUR", locale: "en-IE", lang: "en" } as Market;
const store = { id: "s1", slug: "demo", audience: "both" } as Store;
const m = t("en");

const line = { variantId: "v1", vatRate: 0.25, unitPriceMinor: 10000, quantity: 1 };
const summary = (over: Record<string, unknown> = {}) => ({
  payable: [line],
  blocked: false,
  checkout: { vatRate: 0.25, paymentsOn: true, shipping: null },
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
