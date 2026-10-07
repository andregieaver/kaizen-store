import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { vatIncluded } from "@/lib/checkout";
import { localizationOf, conversionFor } from "@/lib/localization";
import { showMarket, toMarket, type Market } from "@/lib/markets";
import { VIES_LIMIT_PER_CART_PER_HOUR, VIES_LIMIT_PER_STORE_PER_HOUR } from "@/lib/vies";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The VAT engine from the cart to a paid order (D157, docs/wave-1a-tax.md): reverse charge for a business buyer with a valid VAT
 * number in another EU country, IOSS marking, the check of the number (VIES, faked: nothing here reaches the network), and what
 * the cart page showed against what checkout charged, to the minor unit, in the country's own currency and in euro.
 */

vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const coupons = new Map<string, number>();
  let next = 0;
  const client = {
    refunds: { create: async () => ({ id: `re_${++next}`, status: "succeeded" }) },
    coupons: {
      create: async (params: { amount_off: number }) => {
        const id = `coupon_${++next}`;
        coupons.set(id, params.amount_off);
        return { id };
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_vat_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", mode: params.mode });
          created.push({ params, options });
          return { id, url: null, client_secret: `${id}_secret_test`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, ...sessions.get(id) }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client, created, sessions, coupons };
});

vi.mock("./connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connect")>()),
  getCheckoutUi: async () => "custom",
}));
vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformPublishableKey: () => "pk_test_vat",
  platformModes: () => ["test"],
}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { changeLine, getCart, readCartId, setCartCompany, setCartVatNumber } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { getOpenCheckout, placeOrder, startCheckout, cancelUnpaidOrder } = await import("./checkout");
const { getOrder, getOrderTreatment, getShopperOrder } = await import("./orders");
const { saveCampaign } = await import("./campaigns");
const { saveDiscount, setCartCode } = await import("./discounts");
const { preRegisterCustomer, startSession } = await import("./customers");
const { checkOwnVatNumber, getTaxProfile, saveTaxProfile } = await import("./tax-profile");
const { checkCartVatNumber, pruneVatChecks, setCartVat } = await import("./vat-checks");
const { cancelOrder, refundOrder } = await import("./order-admin");

// ---------------------------------------------------------------------------
// A faked VIES: the answer by number, every request recorded
// ---------------------------------------------------------------------------

type Mode = "valid" | "invalid" | "down" | "malformed" | "slow";
const vies = {
  calls: [] as { url: string; body: Record<string, string> }[],
  mode: "valid" as Mode,
  /** A number's own answer, over the mode. */
  byNumber: new Map<string, Mode>(),
};
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const viesFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
  vies.calls.push({ url: String(url), body });
  const mode = vies.byNumber.get(`${body.countryCode}${body.vatNumber}`) ?? vies.mode;
  if (mode === "down") return reply(503, "unavailable");
  if (mode === "malformed") return reply(200, "<html>maintenance</html>");
  if (mode === "slow") {
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
  }
  if (mode === "invalid") return reply(200, { valid: false });
  return reply(200, { valid: true, name: "KUNDE GMBH", address: "HAUPTSTRASSE 1\n10115 BERLIN", requestIdentifier: body.requesterNumber ? `WAPI${vies.calls.length}` : "---" });
});

const run = Date.now().toString(36);
const slug = `vat-${run}`;
const origin = "http://localhost:3000";
const SELLER = "SE556677889901";
const DE_NUMBER = "DE123456789";
const DK_NUMBER = "DK12345678";
const CZ_NUMBER = "CZ12345678";
/** A German number nobody has used in this store yet: the 24 hour cache is per number, and the database is shared between runs. */
let sequence = 0;
const fresh = () => `DE${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++sequence).padStart(3, "0")}`;

const defs = {
  NO: { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  SE: { code: "SE", currency: "SEK", defaultLocale: "sv-SE" },
  DK: { code: "DK", currency: "DKK", defaultLocale: "da-DK" },
  DE: { code: "DE", currency: "EUR", defaultLocale: "de-DE" },
  CZ: { code: "CZ", currency: "CZK", defaultLocale: "cs-CZ" },
};
const se = toMarket(defs.SE);
const de = toMarket(defs.DE);
const dk = toMarket(defs.DK);
const cz = toMarket(defs.CZ);
const no = toMarket(defs.NO);
/** Denmark shown in euro (D109): 1 EUR = 7.5 DKK. */
const dkInEuro = showMarket(defs.DK, {
  currency: "EUR",
  conversion: conversionFor(localizationOf([], [{ currency: "DKK", rate: 7.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [dk]), "DKK", "EUR")!,
});

let storeId: string;
let member: Membership;
const variant: Record<string, string> = {};
const product: Record<string, string> = {};
let view: Market = de;
const shop = () => ({ storeId, market: view });
const cartKey = () => `cart_${storeId}_${view.code.toLowerCase()}`;
const cartId = () => jar.get(cartKey())!;

async function add(sku: string, quantity: number) {
  expect(await changeLine(shop(), variant[sku], quantity, "add"), sku).toMatchObject({ outcome: "added" });
}

/** A business in Germany (or wherever the cart goes): its company, then its VAT number, as the cart page does. */
const company = { name: "Kunde GmbH", number: "123456789" };
async function typeNumber(number: string, withCompany: typeof company | null = company) {
  return setCartVatNumber(shop(), number, withCompany);
}

/** The cart page's totals and the checkout's order for what is in the cart, held to each other. */
async function checkout(options: { consent?: { digital?: boolean }; customerId?: string | null } = {}) {
  const cart = await getCart(shop());
  const summary = await cartSummary(shop(), cart);
  const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", options.consent ?? {}, { customerId: options.customerId ?? null });
  expect(started).toMatchObject({ ok: true });
  const open = await getOpenCheckout(storeId, cartId());
  expect(open).toMatchObject({ changed: false });
  const order = (await getOrder(storeId, open!.orderId))!;
  const { params } = fake.created.at(-1)!;
  // The order is what the cart page showed.
  expect({ total: order.totalMinor, vat: order.taxMinor, kind: order.vatKind, relief: order.vatReliefMinor, shipping: order.shippingMinor }).toEqual({
    total: summary.total,
    vat: summary.vat,
    kind: summary.tax.kind,
    relief: summary.reliefMinor,
    shipping: summary.shipping ?? 0,
  });
  // What Stripe charges is what is due now.
  expect(chargedNow(params)).toBe(summary.dueNowMinor);
  return { cart, summary, order, open: open!, params };
}

/** What Stripe's session charges today: its lines, shipping, less its coupon. */
function chargedNow(params: Record<string, unknown>): number {
  const items = params.line_items as { quantity: number; price_data: { unit_amount: number } }[];
  const lines = items.reduce((sum, i) => sum + i.price_data.unit_amount * i.quantity, 0);
  const shipping = (params.shipping_options as { shipping_rate_data: { fixed_amount: { amount: number } } }[] | undefined)?.[0]?.shipping_rate_data.fixed_amount.amount ?? 0;
  const coupon = (params.discounts as { coupon: string }[] | undefined)?.[0]?.coupon;
  return lines + shipping - (coupon ? (fake.coupons.get(coupon) ?? 0) : 0);
}

const dbSums = async (orderId: string) => {
  const [row] = await db().execute<Row>(sql`
    select o.subtotal_minor, o.shipping_minor, o.discount_minor, o.tax_minor, o.total_minor, o.vat_relief_minor,
      (select coalesce(sum(l.vat_relief_minor), 0) from commerce.order_lines l where l.order_id = o.id)::bigint as line_relief,
      (select coalesce(sum(l.tax_minor), 0) from commerce.order_lines l where l.order_id = o.id)::bigint as line_tax
    from commerce.orders o where o.id = ${orderId}::uuid
  `);
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as Record<string, number>;
};

const checksFor = (number: string) =>
  db().execute<Row>(sql`select * from commerce.vat_checks where store_id = ${storeId}::uuid and number = ${number} order by requested_at`);

beforeAll(async () => {
  vi.stubGlobal("fetch", viesFetch);
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  storeId = String(created.id);
  // A store selling to businesses as well as private shoppers (D178: Sell to businesses on).
  await db().execute(sql`update commerce.stores set country = 'SE', audience = 'both', features = features || array['business'] where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${`acct_vat${run}`}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid`);
  // Germany (euro) and Czechia (koruna) as markets too; Czechia's currency has no euro rate in the store, on purpose.
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${storeId}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('DE', 'CZ')
    on conflict do nothing
  `);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'DKK', 7.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1), (${storeId}::uuid, 'NOK', 11.5, 1, 2), (${storeId}::uuid, 'SEK', 11, 1, 3)
  `);
  const rows = await db().execute<Row>(sql`
    select p.id as product_id, p.handle, v.id as variant_id, v.sku from commerce.products p
    join commerce.product_variants v on v.product_id = p.id where p.store_id = ${storeId}::uuid
  `);
  for (const row of rows) {
    variant[String(row.sku)] = String(row.variant_id);
    product[String(row.handle)] = String(row.product_id);
  }
  // Prices and shipping where the demo has none: the mug 40.00 EUR (Germany) or 500.00 CZK, the notebook 20.00 EUR or 250.00 CZK, the lamp 25.00 EUR.
  for (const [sku, de_, cz_] of [["DEMO-MUG-WHITE", 4_000, 50_000], ["DEMO-NOTEBOOK-LINED", 2_000, 25_000], ["DEMO-LAMP", 2_500, 30_000]] as const) {
    await db().execute(sql`select commerce.set_price(${variant[sku]}::uuid, 'DE', ${de_})`);
    await db().execute(sql`select commerce.set_price(${variant[sku]}::uuid, 'CZ', ${cz_})`);
  }
  await db().execute(sql`
    insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor)
    values (${storeId}::uuid, 'DE', 'EUR', 500), (${storeId}::uuid, 'CZ', 'CZK', 15000)
  `);
  await db().execute(sql`update commerce.product_variants set delivery = 'digital' where store_id = ${storeId}::uuid and sku = 'DEMO-LAMP'`);
  await db().execute(sql`
    update commerce.products p set delivery = 'digital', download_limit = 2, download_days = 7
    from commerce.product_variants v where v.product_id = p.id and v.store_id = ${storeId}::uuid and v.sku = 'DEMO-LAMP'
  `);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  const [owner] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id`);
  member = {
    account: { id: String(owner.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug, markets: [se] } as unknown as Store,
  };
  // A Swedish store, registered for VAT, whose number VIES has said is valid.
  const saved = await saveTaxProfile(member, {
    vatRegistered: true, vatNumber: SELLER, dispatchCountry: "", ossScheme: "none", ossMemberState: "", ossNumber: "", ossRegisteredOn: "",
    iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "",
  });
  if (!saved.ok) throw new Error(saved.problems.join(" "));
  const checked = await checkOwnVatNumber(member, { fetch: viesFetch as unknown as typeof fetch });
  if (!checked.ok || checked.profile.vatNumberValid !== true) throw new Error("the seller's number was not checked valid");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

const reset = (market: Market = de) => {
  jar.clear();
  view = market;
  vies.mode = "valid";
  vies.byNumber.clear();
  vies.calls.length = 0;
};

// ---------------------------------------------------------------------------

describe("money review: reverse charge with the discounts the main test leaves out", () => {
  const mk = async (c: Parameters<typeof saveCampaign>[2]) => {
    const r = await saveCampaign(member, null, c);
    if (!r.ok) throw new Error(r.problems.join(" "));
  };
  const agree = async (customerId: string | null = null) => {
    const ordinary = await cartSummary(shop(), await getCart(shop()), customerId ? { customerId } : undefined);
    await typeNumber(DE_NUMBER);
    const r = await checkout({ customerId });
    expect(r.summary.tax.kind).toBe("reverse_charge");
    expect(r.summary.total).toBe(ordinary.total - ordinary.vat);
    const sums = await dbSums(r.order.id);
    expect(sums.total_minor).toBe(sums.subtotal_minor + sums.shipping_minor - sums.discount_minor);
    expect(sums.line_relief + r.order.shippingReliefMinor).toBe(sums.vat_relief_minor);
    return r;
  };

  it("free shipping code", async () => {
    reset(de);
    const code = `FS${run}`.toUpperCase();
    const made = await saveDiscount(member, null, { code, kind: "free_shipping" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    await add("DEMO-MUG-WHITE", 1);
    await add("DEMO-NOTEBOOK-LINED", 1);
    expect(await setCartCode(shop(), code)).toBe(true);
    await agree();
  });

  it("3 for 2 campaign and odd quantities", async () => {
    reset(de);
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await mk({ name: "3 for 2", kind: "multi_buy", buyQuantity: 3, payQuantity: 2 });
    await add("DEMO-NOTEBOOK-LINED", 7);
    await add("DEMO-MUG-WHITE", 1);
    await agree();
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
  });

  it("gift over an amount", async () => {
    reset(de);
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    (member.store as unknown as { markets: Market[] }).markets = [se, de];
    await mk({ name: "free notebook", kind: "gift", giftVariantId: variant["DEMO-NOTEBOOK-LINED"], giftQuantity: 1, thresholds: { DE: "30.00" } });
    await add("DEMO-MUG-WHITE", 2);
    const r = await agree();
    expect(r.order.lines.some((l) => l.gift)).toBe(true);
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
  });

  it("euro view of Denmark with a percent code and a campaign", async () => {
    reset(dkInEuro);
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await mk({ name: "7 off", kind: "percent", percent: 7 });
    const code = `DK${run}`.toUpperCase();
    const made = await saveDiscount(member, null, { code, kind: "percent", percent: 13 });
    if (!made.ok) throw new Error(made.problems.join(" "));
    await add("DEMO-MUG-WHITE", 3);
    await add("DEMO-NOTEBOOK-LINED", 5);
    expect(await setCartCode(shop(), code)).toBe(true);
    const ordinary = await cartSummary(shop(), await getCart(shop()));
    expect(await typeNumber(DK_NUMBER, { name: "Kunde ApS", number: "12345678" })).toMatchObject({ ok: true, outcome: "valid" });
    const r = await checkout();
    expect(r.summary.tax.kind).toBe("reverse_charge");
    expect(r.summary.total).toBe(ordinary.total - ordinary.vat);
    const sums = await dbSums(r.order.id);
    expect(sums.total_minor).toBe(sums.subtotal_minor + sums.shipping_minor - sums.discount_minor);
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
  });
});

describe("money review: IOSS marks goods in a consignment, not downloads", () => {
  it("a download-only cart from a store outside the EU is not an IOSS consignment", async () => {
    reset(de);
    const form = {
      vatRegistered: true, vatNumber: SELLER, dispatchCountry: "CN", ossScheme: "none" as const, ossMemberState: "", ossNumber: "", ossRegisteredOn: "",
      iossNumber: "IM2460000000", iossIntermediary: "Customs Agent AB", iossMarkets: ["DE"], iossRegisteredOn: "2026-07-01",
    };
    await add("DEMO-LAMP", 1);
    expect(await saveTaxProfile(member, form)).toMatchObject({ ok: true });
    try {
      const summary = await cartSummary(shop(), await getCart(shop()));
      expect(summary.tax.kind).toBe("standard");
    } finally {
      await saveTaxProfile(member, { ...form, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" });
    }
  });
});

describe("money review: import notice", () => {
  it("is not said to a shopper buying only downloads", async () => {
    reset(de);
    const form = {
      vatRegistered: true, vatNumber: SELLER, dispatchCountry: "CN", ossScheme: "none" as const, ossMemberState: "", ossNumber: "", ossRegisteredOn: "",
      iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "",
    };
    await add("DEMO-LAMP", 1);
    expect(await saveTaxProfile(member, form)).toMatchObject({ ok: true });
    try {
      const summary = await cartSummary(shop(), await getCart(shop()));
      expect(summary.tax.importNotice).toBe(false);
    } finally {
      await saveTaxProfile(member, { ...form, dispatchCountry: "" });
    }
  });
});
