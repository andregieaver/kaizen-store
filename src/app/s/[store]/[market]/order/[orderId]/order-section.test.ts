import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The order's server reads are replaced by one order; what is tested is how its bonus credits are drawn (D130).
vi.mock("server-only", () => ({}));
const getShopperOrder = vi.fn();
vi.mock("@/server/orders", () => ({
  getShopperOrder: (...a: unknown[]) => getShopperOrder(...a),
  getOrderDownloads: async () => [],
}));
vi.mock("@/server/customers", () => ({ getCheckoutAccount: async () => null }));
vi.mock("@/server/returns", () => ({ listOrderReturns: async () => [] }));
// What the order kept of the store's terms (wave 1, 1e).
const termsNow = vi.hoisted(() => ({ record: null as null | Record<string, unknown> }));
vi.mock("@/server/checkout-terms", () => ({ termsForOrder: async () => termsNow.record }));
vi.mock("@/server/subscriptions", () => ({ getSubscriptionForOrder: async () => null }));
vi.mock("@/app/s/[store]/[market]/account/actions", () => ({ checkoutSignInAction: async () => undefined }));
vi.mock("@/components/own-bookings", () => ({ OwnBookings: () => null }));
vi.mock("@/components/account-sign-in", () => ({ PasswordReset: () => null }));
vi.mock("@/components/refresh-while", () => ({ RefreshOnce: () => null, RefreshWhile: () => null }));

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { OrderDetails, OrderTerms, OrderTotals } from "./order-section";

const ID = "6f1f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b10";
const market = { slug: "ie", code: "IE", currency: "EUR", locale: "en-IE", lang: "en" } as Market;
const store = { id: "s1", slug: "demo" } as Store;

const order = (over: Record<string, unknown> = {}) => ({
  id: ID,
  number: "1042",
  status: "paid",
  currency: "EUR",
  locale: "en-IE",
  lines: [],
  ships: true,
  shippingAddress: {},
  shippingMinor: 500,
  discountMinor: 0,
  discountCode: null,
  memberDiscountMinor: 0,
  memberLabel: null,
  memberPercent: null,
  campaignDiscountMinor: 0,
  campaignLabel: null,
  referralDiscountMinor: 0,
  totalMinor: 9000,
  taxMinor: 1680,
  balanceMinor: 0,
  company: null,
  subscriptionId: null,
  bonus: null,
  ...over,
});

const shop = { store, market, orderId: ID, query: Promise.resolve({ session_id: "cs_test_1" }) };
const totals = async () => {
  const element = await OrderTotals(shop);
  return renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
};

beforeEach(() => {
  vi.clearAllMocks();
  termsNow.record = null;
  getShopperOrder.mockResolvedValue(order());
});

describe("the order's totals with bonus credits", () => {
  it("show nothing about credits for an order without any, such as a guest's", async () => {
    const words = await totals();
    expect(words).toContain("Total");
    expect(words).not.toMatch(/bonus/i);
  });

  it("show the credits used as a line of their own", async () => {
    getShopperOrder.mockResolvedValue(order({ bonus: { usedMinor: 1500, earnedMinor: 0, availableAt: null } }));
    const words = await totals();
    expect(words).toContain("Bonus credits used −€15.00");
    expect(words).not.toContain("You earned");
  });

  it("say what the order earned and from when it can be used", async () => {
    const at = new Date(Date.now() + 14 * 86_400_000).toISOString();
    getShopperOrder.mockResolvedValue(order({ bonus: { usedMinor: 0, earnedMinor: 425, availableAt: at } }));
    const words = await totals();
    expect(words).toContain("You earned €4.25 in bonus credits, usable from ");
    expect(words).not.toContain("Bonus credits used");
  });

  it("say the credits are ready once their wait is over", async () => {
    getShopperOrder.mockResolvedValue(
      order({ bonus: { usedMinor: 200, earnedMinor: 425, availableAt: "2020-01-01T00:00:00Z" } }),
    );
    const words = await totals();
    expect(words).toContain("You earned €4.25 in bonus credits, ready to use.");
    expect(words).toContain("Bonus credits used −€2.00");
  });

  it("read in the store's language, and are part of the whole order page", async () => {
    getShopperOrder.mockResolvedValue(
      order({ bonus: { usedMinor: 1500, earnedMinor: 425, availableAt: "2020-01-01T00:00:00Z" } }),
    );
    const nb = { ...shop, market: { ...market, lang: "nb", locale: "nb-NO" } as Market };
    const page = renderToString(await OrderDetails(nb))
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(page).toContain(`${t("nb").bonus.usedRow} −`);
    expect(page).toContain("Du tjente");
  });
});

describe("the order's totals with a friend's welcome discount (D131)", () => {
  it("show nothing about it for an order without one", async () => {
    expect(await totals()).not.toContain("Welcome discount");
  });

  it("show it as a line of its own, apart from a code's discount and the credits", async () => {
    getShopperOrder.mockResolvedValue(
      order({ referralDiscountMinor: 1000, bonus: { usedMinor: 1500, earnedMinor: 0, availableAt: null } }),
    );
    const words = await totals();
    expect(words).toContain("Welcome discount −€10.00");
    expect(words).toContain("Bonus credits used −€15.00");
    expect(words).not.toContain("Discount −");
  });

  it("read in the store's language", async () => {
    getShopperOrder.mockResolvedValue(order({ referralDiscountMinor: 1000 }));
    const nb = { ...shop, market: { ...market, lang: "nb", locale: "nb-NO" } as Market };
    const page = renderToString(await OrderDetails(nb))
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(page).toContain(`${t("nb").affiliate.discountRow} −`);
  });
});

describe("the terms the order was placed under (wave 1, 1e)", () => {
  const record = (mode: string) => ({
    orderId: ID,
    mode,
    acceptedAt: new Date("2026-10-03T09:00:00Z"),
    locale: "en-IE",
    snapshots: [
      { role: "terms", snapshotId: "a", hash: "h1", title: "Terms of sale" },
      { role: "privacy", snapshotId: "b", hash: "h2", title: "Privacy statement" },
    ],
  });
  const piece = async () => {
    const markup = renderToString(await OrderTerms(shop));
    return { markup, words: markup.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
  };

  it("shows what was shown, with a read-only page for each text behind the order's own key", async () => {
    termsNow.record = record("link");
    const { markup, words } = await piece();
    expect(words).toContain("Terms you accepted");
    expect(words).toContain("These texts were shown when you ordered on");
    expect(markup).toContain(`href="/s/demo/ie/order/${ID}/terms/terms?session_id=cs_test_1"`);
    expect(markup).toContain(`href="/s/demo/ie/order/${ID}/terms/privacy?session_id=cs_test_1"`);
  });

  it("says the texts were ticked when the shopper ticked them", async () => {
    termsNow.record = record("checkbox");
    expect((await piece()).words).toContain("You ticked these texts when you ordered on");
  });

  it("shows nothing for an order that kept none, and is part of the whole order page when it did", async () => {
    expect((await piece()).markup).toBe("");
    expect(renderToString(await OrderDetails(shop))).not.toContain("Terms you accepted");
    termsNow.record = record("link");
    expect(renderToString(await OrderDetails(shop))).toContain("Terms you accepted");
  });
});
