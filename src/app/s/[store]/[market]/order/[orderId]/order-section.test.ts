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
// The order's invoice and credit notes (D159).
const documentsNow = vi.hoisted(() => ({
  value: { eligibility: "disabled", invoice: null, creditNotes: [], waiting: null, shopperNote: null, staffNote: null } as Record<string, unknown>,
}));
vi.mock("@/server/invoices", () => ({ getOrderDocuments: async () => documentsNow.value }));
// The order's parcels and what is still to come (D174).
const fulfilmentNow = vi.hoisted(() => ({ value: null as null | Record<string, unknown>, calls: 0 }));
vi.mock("@/server/fulfilment", () => ({
  shopperFulfilment: async () => {
    fulfilmentNow.calls += 1;
    return fulfilmentNow.value;
  },
}));
vi.mock("@/app/s/[store]/[market]/account/actions", () => ({ checkoutSignInAction: async () => undefined }));
vi.mock("@/components/own-bookings", () => ({ OwnBookings: () => null }));
vi.mock("@/components/account-sign-in", () => ({ PasswordReset: () => null }));
vi.mock("@/components/refresh-while", () => ({ RefreshOnce: () => null, RefreshWhile: () => null }));

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { Store } from "@/server/stores";

import { OrderDetails, OrderDocuments, OrderLines, OrderParcels, OrderTerms, OrderTotals } from "./order-section";

const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

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
  staffDiscountMinor: 0,
  staffDiscountLabel: null,
  gift: null,
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
  fulfilmentNow.value = null;
  fulfilmentNow.calls = 0;
  documentsNow.value = { eligibility: "disabled", invoice: null, creditNotes: [], waiting: null, shopperNote: null, staffNote: null };
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

describe("the order's invoice and credit notes (D159)", () => {
  const TOKEN = `inv_${"a".repeat(43)}`;
  const CREDIT = `crn_${"b".repeat(43)}`;
  const withDocuments = () => {
    documentsNow.value = {
      eligibility: "ok",
      invoice: { id: "i1", type: "invoice", documentNumber: "F-17", issuedOn: "2026-10-04", token: TOKEN, hasPdf: false, totalMinor: 9000, currency: "EUR" },
      creditNotes: [{ id: "c1", type: "credit_note", documentNumber: "K-3", issuedOn: "2026-10-09", token: CREDIT, hasPdf: true, totalMinor: 500, currency: "EUR" }],
      waiting: null,
      shopperNote: null,
      staffNote: null,
    };
  };
  const html = async (element: Promise<unknown>) => renderToString((await element) as never);

  it("are on the whole order page, with a link to each and to its PDF, under the order's own market", async () => {
    withDocuments();
    const page = await html(OrderDetails(shop));
    expect(page).toContain("Invoice F-17");
    expect(page).toContain("Credit note K-3");
    expect(page).toContain(`href="/s/demo/ie/account/documents/${TOKEN}"`);
    expect(page).toContain(`href="/s/demo/ie/account/documents/${TOKEN}/pdf"`);
    expect(page).toContain(`href="/s/demo/ie/account/documents/${CREDIT}/pdf"`);
  });

  it("are a piece of their own for a page built from pieces (D117)", async () => {
    withDocuments();
    expect(await html(OrderDocuments(shop))).toContain("Invoice F-17");
    documentsNow.value = { ...documentsNow.value, invoice: null, creditNotes: [], eligibility: "disabled" };
    expect(await html(OrderDocuments(shop))).toBe("");
  });

  it("say nothing for an order with no invoice (copied, a host's, switched off, or one that waits), and no error", async () => {
    for (const eligibility of ["copied", "host", "disabled", "ok"]) {
      documentsNow.value = { eligibility, invoice: null, creditNotes: [], waiting: eligibility === "ok" ? "seller_details" : null, shopperNote: null, staffNote: "staff only" };
      const page = await html(OrderDetails(shop));
      expect(page).not.toMatch(/Invoice|Documents|staff only|seller_details/);
    }
  });

  it("tell a test order that it has no invoice, in the store's language", async () => {
    documentsNow.value = { eligibility: "test_mode", invoice: null, creditNotes: [], waiting: null, shopperNote: "Test order: no invoice.", staffNote: null };
    expect(await html(OrderDocuments(shop))).toContain("Test order: no invoice.");
    const nb = { ...shop, market: { ...market, lang: "nb", locale: "nb-NO" } as Market };
    expect(await html(OrderDocuments(nb))).toContain("Testbestilling: ingen faktura.");
  });

  it("read in the store's language", async () => {
    withDocuments();
    const nb = { ...shop, market: { ...market, lang: "nb", locale: "nb-NO" } as Market };
    const page = await html(OrderDetails(nb));
    expect(page).toContain("Dokumenter");
    expect(page).toContain("Faktura F-17");
    expect(page).toContain("Kreditnota K-3");
  });
});

describe("the order's lines with a unit price (D160)", () => {
  const sold = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    variantId: "v1",
    title: "Coffee",
    quantity: 2,
    unitPriceMinor: 5000,
    taxRate: 0.25,
    taxMinor: 1700,
    gift: false,
    delivery: "physical",
    image: null,
    booking: null,
    measure: { amount: "250", unit: "g", base: "kg" },
    ...over,
  });
  const lines = async (shopFor = shop) =>
    renderToString(await OrderLines(shopFor))
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");

  it("shows what the line was sold with: the price charged per unit over the content kept on the line", async () => {
    getShopperOrder.mockResolvedValue(order({ lines: [sold()] }));
    const text = await lines();
    expect(text).toContain("2 × Coffee");
    expect(text).toContain("€200.00/kg");
  });

  it("is of the base the order was sold with, never one worked out again (a 100 g order keeps its 100 g)", async () => {
    getShopperOrder.mockResolvedValue(order({ lines: [sold({ measure: { amount: "250", unit: "g", base: "100g" } })] }));
    expect(await lines()).toContain("€20.00/100 g");
  });

  it("says nothing for an order placed before unit prices, a gift, or a line with content equal to its price", async () => {
    getShopperOrder.mockResolvedValue(
      order({
        lines: [
          sold({ id: "a", measure: null }),
          sold({ id: "b", gift: true }),
          sold({ id: "c", measure: { amount: "1", unit: "kg", base: "kg" } }),
        ],
      }),
    );
    expect(await lines()).not.toMatch(/\/kg|\/100 g/);
  });

  it("reads in the store's language", async () => {
    getShopperOrder.mockResolvedValue(order({ currency: "NOK", locale: "nb-NO", lines: [sold()] }));
    const nb = { ...shop, market: { ...market, lang: "nb", locale: "nb-NO", currency: "NOK" } as Market };
    expect(await lines(nb)).toMatch(/200,00\s*kr\/kg/);
  });
});

describe("the order's lines on backorder (wave 3, D172)", () => {
  const sold = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    variantId: "v1",
    title: "Thermos",
    quantity: 5,
    unitPriceMinor: 5000,
    taxRate: 0.25,
    taxMinor: 1700,
    gift: false,
    delivery: "physical",
    image: null,
    booking: null,
    measure: null,
    backorder: null,
    ...over,
  });
  const lines = async (shopFor = shop) =>
    renderToString(await OrderLines(shopFor))
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");

  it("says how many of the units are on backorder and within how many days they are expected to ship, never a date", async () => {
    getShopperOrder.mockResolvedValue(order({ lines: [sold({ backorder: { units: 2, days: 7 } })] }));
    const text = await lines();
    expect(text).toContain("2 of 5 on backorder: expected to ship within 7 days of your order");
    expect(text).not.toMatch(/in stock|\d{4}-\d{2}-\d{2}/i);
  });

  it("says nothing for a line wholly sold from stock", async () => {
    getShopperOrder.mockResolvedValue(order({ lines: [sold()] }));
    expect(await lines()).not.toMatch(/backorder/i);
  });

  it("reads in the store's language, by hand (nb, sv, da)", async () => {
    getShopperOrder.mockResolvedValue(order({ currency: "NOK", locale: "nb-NO", lines: [sold({ backorder: { units: 1, days: 1 } })] }));
    const say = async (lang: "nb" | "sv" | "da") => lines({ ...shop, market: { ...market, lang, locale: "nb-NO", currency: "NOK" } as Market });
    expect(await say("nb")).toContain("1 av 5 på restordre: forventes sendt innen 1 dag etter din bestilling");
    expect(await say("sv")).toContain("1 av 5 på restorder: förväntas skickas inom 1 dag efter din beställning");
    expect(await say("da")).toContain("1 af 5 på restordre: forventes afsendt inden for 1 dag efter din bestilling");
  });
});

describe("the order with a draft order's staff discount (wave 3, run 2, D173)", () => {
  it("shows it as its own row under the name staff gave it, apart from a code's discount", async () => {
    getShopperOrder.mockResolvedValue(order({ staffDiscountMinor: 1200, staffDiscountLabel: "Friends and family", discountMinor: 0 }));
    const words = await totals();
    expect(words).toContain("Friends and family −€12.00");
    expect(words).not.toMatch(/Discount −/);
  });

  it("names it a discount when staff gave it no name, and shows nothing for an order without one", async () => {
    getShopperOrder.mockResolvedValue(order({ staffDiscountMinor: 500, staffDiscountLabel: null }));
    expect(await totals()).toContain("Discount −€5.00");
    getShopperOrder.mockResolvedValue(order());
    expect(await totals()).not.toMatch(/Discount −|Friends/);
  });

  it("draws the staff's label as text, never as markup", async () => {
    getShopperOrder.mockResolvedValue(order({ staffDiscountMinor: 500, staffDiscountLabel: "<b>Loyal</b>" }));
    const markup = renderToString(await OrderTotals(shop));
    expect(markup).not.toContain("<b>Loyal</b>");
    expect(markup).toContain("&lt;b&gt;Loyal&lt;/b&gt;");
  });
});

describe("the order's gift message (wave 3, run 2, D173)", () => {
  const gift = { isGift: true, to: "Kari", from: "Ola", message: "Gratulerer\nmed dagen" };

  it("shows the buyer their own message under the lines, on the whole order page and in the lines piece", async () => {
    getShopperOrder.mockResolvedValue(order({ gift }));
    for (const markup of [renderToString(await OrderDetails(shop)), renderToString(await OrderLines(shop))]) {
      const words = text(markup);
      expect(words).toContain("Your gift message");
      expect(words).toContain("To: Kari");
      expect(words).toContain("From: Ola");
      expect(words).toContain("Gratulerer");
      // The lines the buyer typed are kept as lines, by style: the text itself stays text.
      expect(markup).toContain("whitespace-pre-line");
    }
  });

  it("is in the buyer's language", async () => {
    getShopperOrder.mockResolvedValue(order({ gift }));
    const nb = { ...shop, market: { ...market, lang: "nb", locale: "nb-NO" } as Market };
    expect(text(renderToString(await OrderLines(nb)))).toContain("Din gavehilsen");
  });

  it("shows nothing for an order that is not a gift", async () => {
    expect(text(renderToString(await OrderLines(shop)))).not.toContain("gift message");
    getShopperOrder.mockResolvedValue(order({ gift: null }));
    expect(renderToString(await OrderLines(shop))).not.toContain("data-gift-note");
  });

  it("says only that it is a gift when the buyer wrote nothing", async () => {
    getShopperOrder.mockResolvedValue(order({ gift: { isGift: true, to: null, from: null, message: null } }));
    const words = text(renderToString(await OrderLines(shop)));
    expect(words).toContain("This is a gift");
    expect(words).not.toContain("Your gift message");
  });

  it("draws markup the buyer typed as the characters they typed", async () => {
    getShopperOrder.mockResolvedValue(order({ gift: { isGift: true, to: "<i>Kari</i>", from: null, message: "<script>alert(1)</script> &amp; <b>x</b>" } }));
    const markup = renderToString(await OrderDetails(shop));
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<b>x</b>");
    expect(markup).not.toContain("<i>Kari</i>");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp; &lt;b&gt;x&lt;/b&gt;");
  });
});

describe("the order's parcels (wave 3, run 3, D174)", () => {
  const html = async (element: Promise<unknown>) => renderToString((await element) as never);
  const partly = {
    state: "partly_sent",
    parcels: [
      {
        id: "p1",
        createdAt: "2026-10-05T09:00:00.000Z",
        carrier: "Posten",
        trackingNumber: "70712345678901234",
        trackingUrl: "https://sporing.posten.no/sporing/70712345678901234",
        legacy: false,
        lines: [{ lineId: "l1", sku: "SWEATER", title: "Wool sweater", quantity: 2 }],
      },
    ],
    stillToCome: [{ lineId: "l1", sku: "SWEATER", title: "Wool sweater", quantity: 1, backordered: 0, backorderDays: null }],
  };

  it("are on the whole order page above the lines, with each parcel's lines and what is still to come", async () => {
    fulfilmentNow.value = partly;
    const page = text(await html(OrderDetails(shop)));
    expect(page).toContain("Partly sent");
    expect(page).toContain("Parcel 1");
    expect(page).toContain("2 × Wool sweater");
    expect(page).toMatch(/Still to come 1 × Wool sweater/);
    expect(page.indexOf("Partly sent")).toBeLessThan(page.indexOf("Total"));
  });

  it("are a piece of their own for a page built from pieces (D117), and draw nothing before the first parcel", async () => {
    fulfilmentNow.value = partly;
    expect(text(await html(OrderParcels(shop)))).toContain("Partly sent");
    fulfilmentNow.value = { state: "unsent", parcels: [], stillToCome: partly.stillToCome };
    expect(await html(OrderParcels(shop))).toBe("");
  });

  it("are not read for an order that is not paid or ships nothing", async () => {
    getShopperOrder.mockResolvedValue(order({ status: "pending_payment" }));
    await html(OrderDetails(shop));
    getShopperOrder.mockResolvedValue(order({ id: "6f1f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b11", ships: false }));
    await html(OrderDetails({ ...shop, orderId: "6f1f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b11" }));
    expect(fulfilmentNow.calls).toBe(0);
  });

  it("read in the store's language", async () => {
    fulfilmentNow.value = partly;
    const nb = { ...shop, market: { ...market, lang: "nb", locale: "nb-NO" } as Market };
    const page = text(await html(OrderParcels(nb)));
    expect(page).toContain("Delvis sendt");
    expect(page).toContain("Kommer senere");
  });
});
