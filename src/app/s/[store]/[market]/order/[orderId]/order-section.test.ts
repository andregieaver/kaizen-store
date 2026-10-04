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
  vatKind: "standard",
  vatReliefMinor: 0,
  shippingVatRate: 0.25,
  vat: null,
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

// ---------------------------------------------------------------------------
// VAT (D157): reverse charge, IOSS, VAT per rate
// ---------------------------------------------------------------------------

const treatment = (over: Record<string, unknown> = {}) => ({
  reason: "reverse_charge",
  sellerVatNumber: "SE556677889901",
  buyerVatNumber: "DE123456789",
  buyerCountry: "DE",
  iossNumber: null,
  viesStatus: "valid",
  viesCheckedAt: "2026-10-03T10:00:00.000Z",
  ...over,
});
const reverseOrder = () =>
  order({
    vatKind: "reverse_charge",
    vatReliefMinor: 1680,
    taxMinor: 0,
    totalMinor: 7320,
    company: { name: "Kunde GmbH", number: "123456789" },
    vat: treatment(),
  });

describe("the order's totals with reverse charge (D157)", () => {
  it("show the VAT not charged before the total, a VAT row that says reverse charge, the statement and both numbers", async () => {
    getShopperOrder.mockResolvedValue(reverseOrder());
    const words = await totals();
    expect(words).toContain("VAT not charged (reverse charge) −€16.80");
    expect(words).toContain("Total €73.20");
    expect(words).toContain("VAT (reverse charge) €0.00");
    expect(words).toContain("Reverse charge: VAT has not been charged. The buyer accounts for the VAT in their own country.");
    expect(words).toContain("Seller's VAT number: SE556677889901");
    expect(words).toContain("Buyer's VAT number: DE123456789");
  });

  it("say it by hand in Norwegian, Swedish and Danish, and in English for any other language", async () => {
    getShopperOrder.mockResolvedValue(reverseOrder());
    const page = async (lang: string) =>
      renderToString(await OrderDetails({ ...shop, market: { ...market, lang, locale: `${lang}-NO` } as Market }))
        .replace(/<!-- -->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
    expect(await page("nb")).toContain("Omvendt avgiftsplikt: det er ikke beregnet merverdiavgift.");
    expect(await page("nb")).toContain("Kjøpers mva-nr.: DE123456789");
    expect(await page("sv")).toContain("Omvänd skattskyldighet: ingen moms har debiterats.");
    expect(await page("da")).toContain("Omvendt betalingspligt: der er ikke opkrævet moms.");
    expect(await page("fr")).toContain("Reverse charge: VAT has not been charged.");
  });

  it("show nothing of it for an ordinary order", async () => {
    const words = await totals();
    expect(words).not.toContain("Reverse charge");
    expect(words).not.toContain("not charged");
    expect(words).toContain("of which VAT €16.80");
  });
});

describe("the order's totals with IOSS (D157)", () => {
  it("say VAT was collected under IOSS with the store's number, and no more is due on delivery", async () => {
    getShopperOrder.mockResolvedValue(order({ vatKind: "ioss", vat: treatment({ reason: "ioss", iossNumber: "IM2760000742", buyerVatNumber: null, sellerVatNumber: null }) }));
    const words = await totals();
    expect(words).toContain("VAT has been collected at checkout under IOSS (IM2760000742). No further VAT is due on delivery.");
    expect(words).not.toContain("Reverse charge");
    // The price is as ever: the VAT is in the total.
    expect(words).toContain("of which VAT €16.80");
  });

  it("do not say VAT has been collected on an order that is waiting for payment: the neutral line instead", async () => {
    getShopperOrder.mockResolvedValue(
      order({ status: "pending_payment", vatKind: "ioss", vat: treatment({ reason: "ioss", iossNumber: "IM2760000742", buyerVatNumber: null, sellerVatNumber: null }) }),
    );
    const words = await totals();
    expect(words).not.toContain("has been collected");
    expect(words).not.toContain("No further VAT is due");
    expect(words).toContain("This order falls under IOSS (IM2760000742). The VAT is collected when the order has been paid.");
  });

  it("say nothing of IOSS on a cancelled order", async () => {
    getShopperOrder.mockResolvedValue(
      order({ status: "cancelled", vatKind: "ioss", vat: treatment({ reason: "ioss", iossNumber: "IM2760000742", buyerVatNumber: null, sellerVatNumber: null }) }),
    );
    const words = await totals();
    expect(words).not.toContain("IOSS");
    expect(words).not.toContain("collected");
  });

  it("say that VAT was collected on a sent order and a closed one as on a paid one", async () => {
    for (const status of ["fulfilled", "closed"] as const) {
      getShopperOrder.mockResolvedValue(order({ status, vatKind: "ioss", vat: treatment({ reason: "ioss", iossNumber: "IM2760000742", buyerVatNumber: null, sellerVatNumber: null }) }));
      expect(await totals()).toContain("VAT has been collected at checkout under IOSS (IM2760000742).");
    }
  });

  it("say that import VAT and customs may be collected when the order was above the IOSS limit", async () => {
    getShopperOrder.mockResolvedValue(order({ vat: treatment({ reason: "ioss_over_limit", buyerVatNumber: null }) }));
    expect(await totals()).toContain("Import VAT and customs charges may be collected on delivery.");
  });
});

describe("the order's VAT per rate (D157)", () => {
  it("lists each rate on its own row when there is more than one, adding up to the order's VAT", async () => {
    getShopperOrder.mockResolvedValue(
      order({
        taxMinor: 1_000 + 130 + 500,
        shippingVatRate: 0.25,
        lines: [
          { id: "l1", title: "Tea", quantity: 1, unitPriceMinor: 5000, totalMinor: 5000, taxRate: 0.25, taxMinor: 1000, vatReliefMinor: 0, gift: false, image: null, booking: null, delivery: "physical", variantId: "v1" },
          { id: "l2", title: "Bread", quantity: 1, unitPriceMinor: 1000, totalMinor: 1000, taxRate: 0.15, taxMinor: 130, vatReliefMinor: 0, gift: false, image: null, booking: null, delivery: "physical", variantId: "v2" },
        ],
      }),
    );
    const words = await totals();
    expect(words).toContain("of which VAT 25 % €15.00");
    expect(words).toContain("of which VAT 15 % €1.30");
    expect(words).not.toContain("of which VAT €");
  });
});
