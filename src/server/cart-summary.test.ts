import { beforeEach, describe, expect, it, vi } from "vitest";

import { NO_RULES } from "@/lib/checkout-rules";

// cartSummary() with every read replaced by the smallest answer that lets it run to its end: what is held is which reads it makes for a store whose
// features do not include Bonus or Referrals (bloat review step 0.22). Nothing from src/lib is mocked: those are pure and load as they are.
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ db: () => ({}), readDb: () => ({}) }));

const bonusProgram = vi.fn();
vi.mock("./bonus", () => ({
  bonusProgram: (...a: unknown[]) => bonusProgram(...a),
  bonusProgramOff: (market: { currency: string }) => ({ settings: {}, currency: market.currency, rates: new Map(), featureOn: false, on: false }),
  creditState: async () => null,
  planFor: (_state: unknown, eligible: number[]) => ({ maxUsableMinor: 0, usingMinor: 0, lines: eligible.map(() => 0) }),
  cartBonusOf: () => ({ enabled: false }),
}));
const codeInPlay = vi.fn();
const friendState = vi.fn();
vi.mock("./affiliates", () => ({
  codeInPlay: (...a: unknown[]) => codeInPlay(...a),
  friendState: (...a: unknown[]) => friendState(...a),
  cartAffiliateOf: () => null,
  welcomeFor: () => null,
}));
vi.mock("./cart", () => ({ readCartId: async () => "c1", getCart: async () => ({ lines: [] }) }));
vi.mock("./customer-tiers", () => ({ memberDiscountFor: async () => null }));
vi.mock("./delivery-options", () => ({ resolveDelivery: async () => null }));
const checkoutRuleOutcome = vi.fn();
vi.mock("./checkout-rules", () => ({ checkoutRuleOutcome: (...a: unknown[]) => checkoutRuleOutcome(...a) }));
vi.mock("./customers", () => ({ getCustomer: async () => null }));
vi.mock("./discounts", () => ({ getCartCodes: async () => [], previewCartCodes: async () => null }));
vi.mock("./discount-combinations", () => ({
  campaignsAndCodes: async () => ({
    outcome: { result: { lineOff: {}, freeShipping: null, applied: [], next: [] }, gifts: [], weighed: [] },
    codeRule: "any",
    leftOut: [],
  }),
}));
vi.mock("./gift-card-cart", () => ({ cartGiftCards: async () => [] }));
vi.mock("./orders", () => ({ getCheckoutInfo: async () => ({ shipping: null, vatRate: 0.25, provider: "stripe", paymentsOn: true, starter: false }) }));
vi.mock("./customs", () => ({
  loadCustomsFacts: async () => ({}),
  decideCustoms: () => ({ blocked: false, collectMinor: 0 }),
}));
vi.mock("./tax-treatment", () => ({
  loadTaxFacts: async () => ({}),
  decideTax: () => ({ reliefMinor: 0, taxMinor: 0, ioss: "none", result: { lines: [], shipping: { totalMinor: 0, taxMinor: 0 } } }),
  cartTaxOf: () => ({ kind: "standard" }),
}));

import { cartSummary } from "./cart-summary";

const market = { slug: "ie", code: "IE", currency: "EUR", locale: "en-IE", lang: "en" } as never;
const shop = { storeId: "s1", market };
const cart = {
  currency: "EUR",
  company: null,
  lines: [
    {
      variantId: "v1",
      productId: "p1",
      title: "Download",
      quantity: 2,
      unitPriceMinor: 5000,
      vatRate: 0.25,
      status: "ok",
      delivery: "digital",
      giftCard: null,
      plan: null,
      booking: null,
      hostId: null,
      priceListId: null,
      payment: null,
      withdrawalExclusion: null,
    },
  ],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  bonusProgram.mockResolvedValue({ settings: {}, currency: "EUR", rates: new Map(), featureOn: true, on: false });
  codeInPlay.mockResolvedValue(null);
  friendState.mockResolvedValue(null);
  checkoutRuleOutcome.mockResolvedValue(NO_RULES);
});

describe("cartSummary() and a feature that is off (bloat review step 0.22)", () => {
  it("sends no statement about the bonus program or referrals for a store with the shop only", async () => {
    const summary = await cartSummary(shop, cart, { customerId: null, cartId: "c1", features: ["shop"] });
    expect(summary.subtotal).toBe(10000);
    expect(bonusProgram).not.toHaveBeenCalled();
    expect(codeInPlay).not.toHaveBeenCalled();
    expect(friendState).not.toHaveBeenCalled();
    // The credits are the program's 'off' shape.
    expect(summary.bonus.enabled).toBe(false);
  });

  it("reads them for a store with Bonus and Referrals on, and as before for a caller that names no features", async () => {
    await cartSummary(shop, cart, { customerId: null, cartId: "c1", features: ["shop", "bonus", "referrals"] });
    expect(bonusProgram).toHaveBeenCalledTimes(1);
    expect(codeInPlay).toHaveBeenCalledTimes(1);
    expect(friendState).toHaveBeenCalledTimes(1);
    await cartSummary(shop, cart, { customerId: null, cartId: "c1" });
    expect(bonusProgram).toHaveBeenCalledTimes(2);
    expect(friendState).toHaveBeenCalledTimes(2);
  });

  it("asks for the program but not for a friend where Bonus is on and Referrals is off", async () => {
    await cartSummary(shop, cart, { customerId: null, cartId: "c1", features: ["shop", "bonus"] });
    expect(bonusProgram).toHaveBeenCalledTimes(1);
    expect(codeInPlay).not.toHaveBeenCalled();
    expect(friendState).not.toHaveBeenCalled();
  });
});
