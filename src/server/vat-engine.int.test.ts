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
const { issueWaitingInvoices } = await import("./invoice-issue");
const documents = await import("./invoice-test-fixture");
const invoicesRead = await import("./invoices");

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
  // A store selling to businesses as well as private shoppers (D178: Sell to businesses on; the bonus program for the credits scenario).
  await db().execute(sql`
    update commerce.stores set country = 'SE', audience = 'both', features = features || array['business', 'bonus'] where id = ${storeId}::uuid
  `);
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

describe("reverse charge: from the cart to a paid order", () => {
  it("takes the VAT off for a valid number in the delivery country: the cart, the order and Stripe agree to the minor unit", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 2);
    await add("DEMO-NOTEBOOK-LINED", 3);
    // The same cart for a private buyer: what it would cost with VAT.
    const ordinary = await cartSummary(shop(), await getCart(shop()));
    expect(ordinary.tax).toMatchObject({ kind: "standard", reason: "consumer" });
    expect(ordinary.vat).toBeGreaterThan(0);

    expect(await typeNumber(DE_NUMBER)).toMatchObject({ ok: true, outcome: "valid", cached: false });
    const { summary, order, params } = await checkout();
    expect(summary.tax).toMatchObject({ kind: "reverse_charge", reason: "reverse_charge", buyerVatNumber: DE_NUMBER, sellerVatNumber: SELLER, buyerState: "valid" });
    // The total is exactly the ordinary total minus the ordinary VAT, to the minor unit.
    expect(summary.total).toBe(ordinary.total - ordinary.vat);
    expect(summary.vat).toBe(0);
    expect(summary.reliefMinor).toBe(ordinary.vat);
    expect(order).toMatchObject({ taxMinor: 0, vatKind: "reverse_charge", vatReliefMinor: ordinary.vat, discountMinor: 0 });

    // The database's own sums hold: the relief is part of the discount, and each line is net.
    const sums = await dbSums(order.id);
    expect(sums.total_minor).toBe(sums.subtotal_minor + sums.shipping_minor - sums.discount_minor);
    expect(sums.discount_minor).toBe(sums.vat_relief_minor);
    expect(sums.line_relief + (order.shippingReliefMinor)).toBe(sums.vat_relief_minor);
    expect(sums.line_tax).toBe(0);
    for (const line of order.lines) expect(line.totalMinor).toBe(line.unitPriceMinor * line.quantity - line.vatReliefMinor);
    // The rate that would have applied is kept (19 %), and shipping's rate as it was.
    expect(order.lines.map((l) => l.taxRate)).toEqual([0.19, 0.19]);
    expect(order.shippingVatRate).toBe(0.19);

    // Stripe is sent the order's own net amounts: every line at its amount due, no coupon, the shipping net.
    const items = params.line_items as { quantity: number; price_data: { unit_amount: number } }[];
    expect(items.every((i) => i.quantity === 1)).toBe(true);
    expect(params.discounts).toBeUndefined();
    const lineSum = items.reduce((sum, i) => sum + i.price_data.unit_amount, 0);
    const shipping = (params.shipping_options as { shipping_rate_data: { fixed_amount: { amount: number } } }[])[0].shipping_rate_data.fixed_amount.amount;
    expect(lineSum + shipping).toBe(order.totalMinor);
    // The invoice option's fields say it, with both numbers (only when the store switched invoices on).
    expect(params.invoice_creation).toBeUndefined();

    // What the order keeps: both numbers and the VIES answer, for staff; the shopper's view has no registered name.
    const staff = await getOrderTreatment(storeId, order.id);
    expect(staff).toMatchObject({ kind: "reverse_charge", sellerVatNumber: SELLER, buyerVatNumber: DE_NUMBER, buyerCountry: "DE", vies: { status: "valid", registeredName: "KUNDE GMBH" } });
    expect(order.vat).toMatchObject({ reason: "reverse_charge", buyerVatNumber: DE_NUMBER, sellerVatNumber: SELLER, viesStatus: "valid" });
    expect(JSON.stringify(order.vat)).not.toContain("KUNDE");
    expect(order.company).toMatchObject({ name: "Kunde GmbH" });

  });

  it("tells the store's Stripe invoice: the words and both VAT numbers, in four fields (while Kaizen's own invoicing is off, D159)", async () => {
    reset(de);
    await db().execute(sql`update commerce.payment_providers set order_invoices = true where store_id = ${storeId}::uuid`);
    await db().execute(sql`insert into commerce.invoice_settings (store_id, enabled) values (${storeId}::uuid, false) on conflict (store_id) do update set enabled = false`);
    try {
      await add("DEMO-MUG-WHITE", 1);
      await typeNumber(DE_NUMBER);
      const { params } = await checkout();
      const fields = (params.invoice_creation as { invoice_data: { custom_fields: { name: string; value: string }[] } }).invoice_data.custom_fields;
      expect(fields.length).toBeLessThanOrEqual(4);
      expect(fields).toEqual([
        { name: "Reverse charge", value: "VAT 0" },
        { name: "Seller VAT no.", value: SELLER },
        { name: "Buyer VAT no.", value: DE_NUMBER },
        { name: "Buyer", value: "Kunde GmbH" },
      ]);
      // A private buyer's invoice says the VAT in it, as it always did.
      reset(de);
      await add("DEMO-MUG-WHITE", 1);
      const ordinary = (await checkout()).params.invoice_creation as { invoice_data: { custom_fields: { name: string }[] } };
      expect(ordinary.invoice_data.custom_fields.map((f) => f.name)).toEqual(["Incl. VAT"]);
      // With Kaizen's own invoicing on, the database makes the invoice and Stripe is not asked for one (D159).
      await db().execute(sql`update commerce.invoice_settings set enabled = true where store_id = ${storeId}::uuid`);
      reset(de);
      await add("DEMO-MUG-WHITE", 1);
      await typeNumber(DE_NUMBER);
      expect((await checkout()).params.invoice_creation).toBeUndefined();
    } finally {
      await db().execute(sql`update commerce.payment_providers set order_invoices = false where store_id = ${storeId}::uuid`);
      await db().execute(sql`update commerce.invoice_settings set enabled = true where store_id = ${storeId}::uuid`);
    }
  });

  it("holds after payment: the order's VAT cannot be changed, and a refund is capped by what was paid net", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await typeNumber(DE_NUMBER);
    const { order, open, params } = await checkout();
    fake.sessions.set(open.sessionId, { status: "complete", payment_status: "paid", mode: params.mode, payment_intent: `pi_${open.sessionId}` });
    const paid = await getShopperOrder(storeId, order.id, open.sessionId);
    expect(paid).toMatchObject({ status: "paid", vatKind: "reverse_charge", taxMinor: 0 });
    await expect(db().execute(sql`update commerce.orders set vat_kind = 'standard', vat_relief_minor = 0 where id = ${order.id}::uuid`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/order_vat_frozen|orders_vat_kind_relief/) },
    });
    await expect(db().execute(sql`update commerce.orders set shipping_tax_rate = 0.5 where id = ${order.id}::uuid`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/order_vat_frozen/) },
    });
    // The confirmation says reverse charge with both numbers (German market: the English words, as legal wording is never machine-translated).
    await db().execute(sql`update commerce.orders set email = ${`buyer-${run}@example.com`} where id = ${order.id}::uuid`);
    await (await import("./shopper-emails")).sendOrderConfirmation(storeId, order.id);
    const [mail] = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${order.id}::uuid`);
    expect(String(mail.html)).toContain("Reverse charge");
    expect(String(mail.html)).toContain("VAT number: " + SELLER);
    expect(String(mail.html)).toContain(DE_NUMBER);
    expect(String(mail.html)).toContain("VAT not charged");
    // A full refund of a net order is its net total, and no more.
    const over = await refundOrder(storeId, order.id, { amountMinor: order.totalMinor + 1, reason: "too much", restock: [] }, member.account.id);
    expect(over.ok).toBe(false);
    expect(await refundOrder(storeId, order.id, { amountMinor: order.totalMinor, reason: "all of it", restock: [] }, member.account.id)).toMatchObject({ ok: true });
    expect(await cancelOrder(storeId, order.id, "after the refund", member.account.id)).toMatchObject({ ok: true });
  });

  it("works for downloads alone: no shipping, the VAT off the download", async () => {
    reset(de);
    await add("DEMO-LAMP", 1);
    await typeNumber(DE_NUMBER);
    const { summary, order } = await checkout({ consent: { digital: true } });
    expect(summary.tax.kind).toBe("reverse_charge");
    expect(order).toMatchObject({ taxMinor: 0, shippingMinor: 0, shippingReliefMinor: 0, vatReliefMinor: vatIncluded(2_500, 0.19) });
    expect(order.totalMinor).toBe(2_500 - vatIncluded(2_500, 0.19));
  });

  it("shown in euro: a Danish market in euro, with the number of a Danish business", async () => {
    reset(dkInEuro);
    await add("DEMO-MUG-WHITE", 2);
    const ordinary = await cartSummary(shop(), await getCart(shop()));
    expect(await typeNumber(DK_NUMBER, { name: "Kunde ApS", number: "12345678" })).toMatchObject({ ok: true, outcome: "valid" });
    const { summary, order, params } = await checkout();
    expect(order.currency).toBe("EUR");
    expect(JSON.stringify(params)).toContain('"currency":"eur"');
    expect(summary.tax.kind).toBe("reverse_charge");
    expect(summary.total).toBe(ordinary.total - ordinary.vat);
    expect(order.lines[0].taxRate).toBe(0.25);
    const sums = await dbSums(order.id);
    expect(sums.total_minor).toBe(sums.subtotal_minor + sums.shipping_minor - sums.discount_minor);
    expect(order.vatReliefMinor).toBe(ordinary.vat);
  });

  it("shown in the country's own currency when it is not the euro: Czechia in koruna", async () => {
    reset(cz);
    await add("DEMO-MUG-WHITE", 3);
    const ordinary = await cartSummary(shop(), await getCart(shop()));
    expect(await typeNumber(CZ_NUMBER, { name: "Zakaznik sro", number: "12345678" })).toMatchObject({ ok: true, outcome: "valid" });
    const { summary, order } = await checkout();
    expect(order.currency).toBe("CZK");
    expect(summary.tax.kind).toBe("reverse_charge");
    expect(summary.total).toBe(ordinary.total - ordinary.vat);
    expect(order.lines[0].taxRate).toBe(0.21);
  });

  it("with a code, a campaign, a group's discount and bonus credits: relief is worked out last, on what is left", async () => {
    reset(de);
    const customerId = await preRegisterCustomer(storeId, `buyer-${run}@example.com`);
    const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Wholesale', 10) returning id`);
    await db().execute(sql`update commerce.customers set tier_id = ${String(tier.id)}::uuid where id = ${customerId}::uuid`);
    await startSession(storeId, customerId);
    const code = `VAT${run}`.toUpperCase();
    const made = await saveDiscount(member, null, { code, kind: "percent", percent: 10 });
    if (!made.ok) throw new Error(made.problems.join(" "));
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    const campaign = await saveCampaign(member, null, { name: "15 % off", kind: "percent", percent: 15 });
    if (!campaign.ok) throw new Error(campaign.problems.join(" "));
    await db().execute(sql`
      insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, currency)
      values (${storeId}::uuid, true, 500, 14, 50, 0, 'EUR')
      on conflict (store_id) do update set enabled = true, max_redeem_percent = 50, currency = 'EUR'
    `);
    await db().execute(sql`select commerce.bonus_adjust(${storeId}::uuid, ${customerId}::uuid, 1000, 'test credits', null, ${`vat-${customerId}`})`);
    await add("DEMO-MUG-WHITE", 4);
    await add("DEMO-NOTEBOOK-LINED", 2);
    expect(await setCartCode(shop(), code)).toBe(true);
    // The cart as a private buyer sees it, credits used: the VAT those amounts carry.
    const { setCartCredits } = await import("./bonus");
    expect(await setCartCredits(shop(), cartId(), customerId, 800)).toMatchObject({ ok: true });
    const ordinary = await cartSummary(shop(), await getCart(shop()), { customerId });
    expect(ordinary.discountMinor).toBeGreaterThan(0);
    expect(ordinary.bonusMinor).toBeGreaterThan(0);

    await typeNumber(DE_NUMBER);
    const { summary, order } = await checkout({ customerId });
    expect(summary.tax.kind).toBe("reverse_charge");
    expect(summary.total).toBe(ordinary.total - ordinary.vat);
    expect(order).toMatchObject({ vatKind: "reverse_charge", creditMinor: ordinary.bonusMinor, taxMinor: 0 });
    // Everything else is as it was: the code's, the group's and the campaign's discounts, with the relief apart.
    expect(order.discountMinor).toBe(ordinary.discountMinor);
    const sums = await dbSums(order.id);
    expect(sums.total_minor).toBe(sums.subtotal_minor + sums.shipping_minor - sums.discount_minor);
    // What it earns is counted on the lines' net totals, as the database counts it.
    const [earned] = await db().execute<Row>(sql`select coalesce(sum(total_minor - venue_minor), 0)::bigint as n from commerce.order_lines where order_id = ${order.id}::uuid`);
    expect(Number(earned.n)).toBe(order.lines.reduce((sum, l) => sum + l.totalMinor, 0));
    await db().execute(sql`update commerce.bonus_settings set enabled = false where store_id = ${storeId}::uuid`);
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
  });
});

describe("what never takes the VAT off", () => {
  async function standardFor(reason: string, over: () => Promise<void> | void = () => {}) {
    await over();
    const { summary, order } = await checkout();
    expect(summary.tax.reason).toBe(reason);
    expect(summary.tax.kind).toBe("standard");
    expect(summary.vat).toBeGreaterThan(0);
    expect(order).toMatchObject({ vatKind: "standard", vatReliefMinor: 0 });
    expect((await getOrderTreatment(storeId, order.id))?.reason).toBe(reason);
    return { summary, order };
  }

  it("a number VIES says is not valid", async () => {
    reset(de);
    vies.mode = "invalid";
    await add("DEMO-MUG-WHITE", 1);
    expect(await typeNumber(fresh())).toMatchObject({ ok: true, outcome: "invalid" });
    const { order } = await standardFor("number_invalid");
    expect(order.vat).toMatchObject({ viesStatus: "invalid" });
  });

  it.each(["down", "malformed", "slow"] as const)("VIES being unavailable (%s): VAT is charged, the sale goes through, the failure is logged", async (mode) => {
    reset(de);
    vies.mode = mode;
    await add("DEMO-MUG-WHITE", 1);
    // A slow answer is given up on after the timeout (a short one here), the others after the one retry.
    const number = fresh();
    const outcome = await setCartVatNumber(shop(), number, company, { fetch: viesFetch as unknown as typeof fetch, timeoutMs: 30 });
    expect(outcome).toMatchObject({ ok: true, outcome: "unavailable" });
    expect(vies.calls.length).toBe(mode === "malformed" ? 1 : 2);
    const logged = (await checksFor(number)).at(-1)!;
    expect(logged).toMatchObject({ status: "unavailable", source: "vies", purpose: "buyer" });
    expect(String(logged.error)).toBe(mode === "down" ? "http_503" : mode === "malformed" ? "malformed" : "timeout");
    // Checkout asks once more before placing the order (it is down still), and goes on.
    await standardFor("number_unavailable");
  });

  it("a check more than 24 hours old: VAT is charged until it is made again, and checkout makes it again", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    const number = fresh();
    await setCartCompany(shop(), company);
    // An answer from 25 hours ago (the log is immutable: a row is inserted with its old time).
    const [old] = await db().execute<Row>(sql`
      insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, requested_at)
      values (${storeId}::uuid, 'buyer', ${cartId()}::uuid, ${number}, 'DE', 'valid', 'vies', now() - interval '25 hours') returning id
    `);
    await setCartVat(storeId, cartId(), number, String(old.id));
    expect((await cartSummary(shop(), await getCart(shop()))).tax).toMatchObject({ kind: "standard", reason: "number_stale", buyerState: "stale" });
    // Placing the order never asks VIES: it sees the old answer and charges VAT.
    vies.calls.length = 0;
    const placed = await placeOrder(shop(), cartId());
    expect(placed).toMatchObject({ ok: true, order: { vatKind: "standard", vatReliefMinor: 0 } });
    expect(vies.calls).toHaveLength(0);
    if (placed.ok) {
      expect((await getOrderTreatment(storeId, placed.order.orderId))?.reason).toBe("number_stale");
      await cancelUnpaidOrder(placed.order.orderId, "test");
    }
    // Starting checkout asks again first (once), and places the order with a current answer: the shopper pays less than the stale cart page said.
    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, {});
    expect(started).toMatchObject({ ok: true });
    expect(vies.calls).toHaveLength(1);
    const open = await getOpenCheckout(storeId, cartId());
    expect(await getOrder(storeId, open!.orderId)).toMatchObject({ vatKind: "reverse_charge" });
  });

  it("a number for another country than the one the goods go to, a non-EU number, the store's own number", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    expect(await typeNumber("FR12345678901")).toMatchObject({ ok: true, outcome: "valid" });
    await standardFor("number_other_country");
    expect(await typeNumber("NO923609016MVA")).toMatchObject({ ok: true, outcome: "not_eu", check: null });
    await standardFor("number_not_eu");
    const calls = vies.calls.length;
    expect(await typeNumber(SELLER)).toMatchObject({ ok: true, outcome: "own_number" });
    expect(vies.calls.length).toBe(calls);
    await standardFor("own_number");
  });

  it("the seller's own country: a domestic sale", async () => {
    reset(se);
    await add("DEMO-MUG-WHITE", 1);
    expect(await typeNumber("SE556000000001", { name: "Kund AB", number: "5560000000" })).toMatchObject({ ok: true, outcome: "valid" });
    await standardFor("same_country");
  });

  it("a private buyer: a number cannot even be given, and none is ever kept", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    expect(await typeNumber(DE_NUMBER, null)).toEqual({ ok: false, problem: "no_company" });
    expect(vies.calls).toHaveLength(0);
    const { summary } = await standardFor("consumer");
    expect(summary.tax.buyerVatNumber).toBeNull();
    expect(summary.tax.field).toEqual({ offered: false, reason: "private" });
  });

  it("a cart with a booking or a subscription", async () => {
    reset(de);
    // A subscription (the demo notebook, every other month), bought in the country's own currency.
    const [plan] = await db().execute<Row>(sql`
      insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
      values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 2, 0) returning id
    `);
    expect(await changeLine(shop(), variant["DEMO-NOTEBOOK-LINED"], 1, "add", String(plan.id))).toMatchObject({ outcome: "added" });
    await add("DEMO-MUG-WHITE", 1);
    await typeNumber(DE_NUMBER);
    const summary = await cartSummary(shop(), await getCart(shop()));
    expect(summary.tax).toMatchObject({ kind: "standard", reason: "has_subscription", field: { offered: false, reason: "has_subscription" } });
    expect(summary.vat).toBeGreaterThan(0);
    await changeLine(shop(), variant["DEMO-NOTEBOOK-LINED"], 0, "set", String(plan.id));
    expect((await cartSummary(shop(), await getCart(shop()))).tax.kind).toBe("reverse_charge");
  });

  it("a store whose own number was not checked valid: reverse charge stays off, and says so", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await typeNumber(DE_NUMBER);
    // Saving another number clears the check of the old one; the same number again would not.
    const profile = await getTaxProfile(storeId);
    const form = { vatRegistered: true, vatNumber: "SE556677889902", dispatchCountry: "", ossScheme: "none" as const, ossMemberState: "", ossNumber: "", ossRegisteredOn: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" };
    expect(await saveTaxProfile(member, form)).toMatchObject({ ok: true, profile: { vatNumber: "SE556677889902", vatNumberValid: null, vatNumberCheckId: null } });
    try {
      expect((await cartSummary(shop(), await getCart(shop()))).tax).toMatchObject({ kind: "standard", reason: "seller_number_unverified", field: { offered: false, reason: "seller_not_ready" } });
    } finally {
      await saveTaxProfile(member, { ...form, vatNumber: profile.vatNumber! });
      const again = await checkOwnVatNumber(member, { fetch: viesFetch as unknown as typeof fetch });
      expect(again).toMatchObject({ ok: true, profile: { vatNumberValid: true } });
    }
    expect((await cartSummary(shop(), await getCart(shop()))).tax.kind).toBe("reverse_charge");
  });
});

describe("the check of a number", () => {
  it("is kept for 24 hours: the same number again costs nothing, and is logged once", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    const number = fresh();
    await typeNumber(number);
    expect(vies.calls).toHaveLength(1);
    // The consultation number comes back because the store's own number goes with the request.
    expect(vies.calls[0].body).toMatchObject({ countryCode: "DE", vatNumber: number.slice(2), requesterMemberStateCode: "SE", requesterNumber: "556677889901" });
    expect(await typeNumber(number)).toMatchObject({ ok: true, outcome: "valid", cached: true });
    expect(await typeNumber(`de ${number.slice(2, 5)} ${number.slice(5)}`)).toMatchObject({ ok: true, outcome: "valid", cached: true });
    expect(vies.calls).toHaveLength(1);
    expect(await checksFor(number)).toHaveLength(1);
    expect((await checksFor(number))[0]).toMatchObject({ request_identifier: expect.stringMatching(/^WAPI/), purpose: "buyer" });
  });

  it("takes the prefix from the delivery country, and refuses what is not a number's shape without asking", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    expect(await typeNumber("123456780")).toMatchObject({ ok: true, number: "DE123456780" });
    expect(await typeNumber("12")).toMatchObject({ ok: false, problem: "shape" });
    expect(await typeNumber("12-3<script>")).toMatchObject({ ok: false, problem: "characters" });
    expect(vies.calls).toHaveLength(1);
  });

  it("taking the number off clears it with its check; so does buying privately", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await typeNumber(DE_NUMBER);
    expect((await getCart(shop())).company).toMatchObject({ vatNumber: DE_NUMBER, vatCheck: { status: "valid" } });
    expect(await typeNumber("")).toEqual({ ok: true, outcome: "cleared" });
    expect((await getCart(shop())).company).toMatchObject({ vatNumber: null, vatCheck: null });
    await typeNumber(DE_NUMBER);
    await setCartCompany(shop(), null);
    expect((await getCart(shop())).company).toBeNull();
    const [row] = await db().execute<Row>(sql`select vat_number, vat_check_id from commerce.carts where id = ${cartId()}::uuid`);
    expect(row).toMatchObject({ vat_number: null, vat_check_id: null });
    // Another company takes the old company's number off too.
    await typeNumber(DE_NUMBER);
    await setCartCompany(shop(), { name: "Annan GmbH", number: "987654321" });
    expect((await getCart(shop())).company).toMatchObject({ vatNumber: null });
  });

  it("is limited by what has been done: ten live requests a cart an hour, cache hits not counted", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    const numbers = Array.from({ length: VIES_LIMIT_PER_CART_PER_HOUR }, () => fresh());
    for (const number of numbers) expect(await typeNumber(number)).toMatchObject({ ok: true, outcome: "valid", cached: false });
    // Repeating one of them is a cache hit, which costs nothing.
    expect(await typeNumber(numbers[0])).toMatchObject({ outcome: "valid", cached: true });
    const before = vies.calls.length;
    const eleventh = fresh();
    expect(await typeNumber(eleventh)).toMatchObject({ ok: true, outcome: "unavailable" });
    expect(vies.calls.length).toBe(before);
    // Nothing is logged for a request that was not made, and VAT is charged until it can be checked.
    expect(await checksFor(eleventh)).toHaveLength(0);
    expect((await cartSummary(shop(), await getCart(shop()))).tax.buyerState).toBe("unavailable");
  });

  it("is limited for the whole store too: the shoppers' count is taken before VIES is asked", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    // The store's count for this hour is brought to its limit, as sixty shoppers' requests would (the counter holds no number).
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, 'vies:s', date_trunc('hour', now()), ${VIES_LIMIT_PER_STORE_PER_HOUR})
      on conflict (store_id, bucket, "window") do update set count = ${VIES_LIMIT_PER_STORE_PER_HOUR}
    `);
    try {
      expect(await typeNumber(fresh())).toMatchObject({ ok: true, outcome: "unavailable" });
      expect(vies.calls).toHaveLength(0);
    } finally {
      // Not left behind: the scenarios after this one can ask.
      await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid and bucket like 'vies:%'`);
    }
  });

  it("is never made from another store's cart, and another store never sees a check", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    const [other] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, country) values (${`other-${run}`}, 'Other', 'SE') returning id`);
    expect(await checkCartVatNumber({ storeId: String(other.id), market: de }, cartId(), DE_NUMBER)).toEqual({ ok: false, problem: "no_cart" });
    await typeNumber(DE_NUMBER);
    const { getCheck } = await import("./vat-checks");
    const [mine] = await checksFor(DE_NUMBER);
    expect(await getCheck(db(), String(other.id), String(mine.id))).toBeNull();
  });

  it("is forgotten after 30 days unless an order rests on it", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await typeNumber(fresh());
    const { order } = await checkout();
    const oldRow = async (number: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, requested_at)
        values (${storeId}::uuid, 'buyer', null, ${number}, 'DE', 'valid', 'vies', now() - interval '40 days') returning id
      `);
      return String(row.id);
    };
    const unused = await oldRow(fresh());
    const [usedByOrder] = await db().execute<Row>(sql`select vat_check_id from commerce.orders where id = ${order.id}::uuid`);
    expect(usedByOrder.vat_check_id).not.toBeNull();
    // Make the order's own check old: it is kept all the same.
    await db().execute(sql`alter table commerce.vat_checks disable trigger vat_checks_immutable`);
    await db().execute(sql`update commerce.vat_checks set requested_at = now() - interval '40 days' where id = ${String(usedByOrder.vat_check_id)}::uuid`);
    await db().execute(sql`alter table commerce.vat_checks enable trigger vat_checks_immutable`);
    expect((await pruneVatChecks()).deleted).toBeGreaterThanOrEqual(1);
    const left = await db().execute<Row>(sql`select id from commerce.vat_checks where id in (${unused}::uuid, ${String(usedByOrder.vat_check_id)}::uuid)`);
    expect(left.map((r) => String(r.id))).toEqual([String(usedByOrder.vat_check_id)]);
  });

  it("changes what the order says: a number checked after the order was placed asks checkout to start again", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    const first = await checkout();
    expect(first.order.vatKind).toBe("standard");
    await typeNumber(DE_NUMBER);
    expect(await getOpenCheckout(storeId, cartId())).toMatchObject({ changed: true });
    const second = await checkout();
    expect(second.order.vatKind).toBe("reverse_charge");
    // The first order was replaced, never paid.
    expect((await getOrder(storeId, first.order.id))?.status).toBe("cancelled");
  });
});

describe("IOSS marking: orders from outside the EU", () => {
  const iossForm = {
    vatRegistered: true, vatNumber: SELLER, dispatchCountry: "CN", ossScheme: "none" as const, ossMemberState: "", ossNumber: "", ossRegisteredOn: "",
    iossNumber: "IM2460000000", iossIntermediary: "Customs Agent AB", iossMarkets: ["DE", "DK", "CZ"], iossRegisteredOn: "2026-07-01",
  };

  it("marks a consignment of at most 150 EUR with the store's IOSS number, and leaves the price as it was", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 2);
    const without = await cartSummary(shop(), await getCart(shop()));
    expect(without.tax.kind).toBe("standard");
    expect(await saveTaxProfile(member, iossForm)).toMatchObject({ ok: true });
    try {
      const { summary, order } = await checkout();
      // 2 mugs at 40.00 EUR with 19 % VAT: 67.23 EUR without VAT, well within 150 EUR.
      expect(summary.tax).toMatchObject({ kind: "ioss", reason: "ioss", importNotice: false });
      expect(summary.total).toBe(without.total);
      expect(summary.vat).toBe(without.vat);
      expect(order).toMatchObject({ vatKind: "ioss", vatReliefMinor: 0, taxMinor: without.vat });
      expect(order.vat).toMatchObject({ reason: "ioss", iossNumber: "IM2460000000" });
      expect((await getOrderTreatment(storeId, order.id))?.consignmentEurMinor).toBe(8_000 - vatIncluded(8_000, 0.19));
    } finally {
      await saveTaxProfile(member, { ...iossForm, vatNumber: SELLER, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" });
    }
  });

  it("does not mark one above 150 EUR, and says the buyer may pay import VAT on delivery", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 5);
    await saveTaxProfile(member, iossForm);
    try {
      const { summary, order } = await checkout();
      // 5 mugs: 200.00 EUR with VAT, 168.07 without.
      expect(summary.tax).toMatchObject({ kind: "standard", reason: "ioss_over_limit", importNotice: true });
      expect(order).toMatchObject({ vatKind: "standard" });
      expect((await getOrderTreatment(storeId, order.id))).toMatchObject({ reason: "ioss_over_limit", iossNumber: null });
    } finally {
      await saveTaxProfile(member, { ...iossForm, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" });
    }
  });

  it("shown in euro: a Danish market, counted in euro", async () => {
    reset(dkInEuro);
    await add("DEMO-MUG-WHITE", 1);
    const without = await cartSummary(shop(), await getCart(shop()));
    await saveTaxProfile(member, iossForm);
    try {
      const { summary, order } = await checkout();
      expect(summary.tax.kind).toBe("ioss");
      expect(summary.total).toBe(without.total);
      expect(order.currency).toBe("EUR");
      expect(order.vatKind).toBe("ioss");
    } finally {
      await saveTaxProfile(member, { ...iossForm, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" });
    }
  });

  it("marks nothing when the currency has no euro rate: Czechia in koruna", async () => {
    reset(cz);
    await add("DEMO-MUG-WHITE", 1);
    await saveTaxProfile(member, iossForm);
    try {
      const { summary, order } = await checkout();
      expect(summary.tax).toMatchObject({ kind: "standard", reason: "ioss_no_rate", importNotice: true });
      expect((await getOrderTreatment(storeId, order.id))).toMatchObject({ consignmentEurMinor: null });
    } finally {
      await saveTaxProfile(member, { ...iossForm, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" });
    }
  });

  it("marks neither a business buyer, a market that is not listed, nor a store that sends from inside the EU", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await saveTaxProfile(member, { ...iossForm, iossMarkets: ["DK"] });
    try {
      expect((await cartSummary(shop(), await getCart(shop()))).tax.kind).toBe("standard");
    } finally {
      await saveTaxProfile(member, iossForm);
    }
    await typeNumber(DE_NUMBER);
    // A business buyer with a valid number is never marked: goods sent from outside the EU are an import, so VAT is charged
    // (the store says it sends from China); sent from inside the EU they are reverse-charged.
    expect((await cartSummary(shop(), await getCart(shop()))).tax).toMatchObject({ kind: "standard", reason: "dispatch_outside_eu" });
    await saveTaxProfile(member, { ...iossForm, dispatchCountry: "PL" });
    expect((await cartSummary(shop(), await getCart(shop()))).tax.kind).toBe("reverse_charge");
    await saveTaxProfile(member, iossForm);
    await typeNumber("");
    await saveTaxProfile(member, { ...iossForm, dispatchCountry: "SE" });
    try {
      expect((await cartSummary(shop(), await getCart(shop()))).tax.kind).toBe("standard");
    } finally {
      await saveTaxProfile(member, { ...iossForm, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" });
    }
  });
});

describe("downloads are no consignment, and reverse charge looks at where the goods are sent from", () => {
  const iossForm = {
    vatRegistered: true, vatNumber: SELLER, dispatchCountry: "CN", ossScheme: "none" as const, ossMemberState: "", ossNumber: "", ossRegisteredOn: "",
    iossNumber: "IM2460000000", iossIntermediary: "Customs Agent AB", iossMarkets: ["DE", "DK"], iossRegisteredOn: "2026-07-01",
  };
  const plain = { ...iossForm, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" };
  const consent = { consent: { digital: true } };

  it("marks goods and a download by the goods alone: the download's value is not in the 150 EUR consignment", async () => {
    reset(de);
    // 3 mugs: 120.00 EUR with VAT, 100.84 without. 3 downloads: 75.00 with VAT, 63.03 without: together over 150 EUR.
    await add("DEMO-MUG-WHITE", 3);
    await add("DEMO-LAMP", 3);
    await saveTaxProfile(member, iossForm);
    try {
      const { summary, order } = await checkout(consent);
      expect(summary.tax).toMatchObject({ kind: "ioss", reason: "ioss", importNotice: false });
      expect(order.vatKind).toBe("ioss");
      expect((await getOrderTreatment(storeId, order.id))?.consignmentEurMinor).toBe(12_000 - vatIncluded(12_000, 0.19));
    } finally {
      await saveTaxProfile(member, plain);
    }
  });

  it("does not mark a download on its own, says no import notice for it, and leaves the order as any consumer order", async () => {
    reset(de);
    await add("DEMO-LAMP", 1);
    const ordinary = await cartSummary(shop(), await getCart(shop()));
    await saveTaxProfile(member, iossForm);
    try {
      const { summary, order } = await checkout(consent);
      expect(summary.tax).toMatchObject({ kind: "standard", reason: "consumer", importNotice: false });
      expect(summary.total).toBe(ordinary.total);
      expect(order).toMatchObject({ vatKind: "standard" });
      expect((await getOrderTreatment(storeId, order.id))).toMatchObject({ reason: "consumer", iossNumber: null });
    } finally {
      await saveTaxProfile(member, plain);
    }
  });

  it("is the same in euro: a Danish market shown in euro, goods and a download", async () => {
    reset(dkInEuro);
    await db().execute(sql`select commerce.set_price(${variant["DEMO-LAMP"]}::uuid, 'DK', 18000)`);
    await add("DEMO-MUG-WHITE", 1);
    await add("DEMO-LAMP", 1);
    const without = await cartSummary(shop(), await getCart(shop()));
    await saveTaxProfile(member, iossForm);
    try {
      const { summary, order } = await checkout(consent);
      expect(summary.tax.kind).toBe("ioss");
      expect(summary.total).toBe(without.total);
      expect(order.currency).toBe("EUR");
      // Only the mug is the consignment: its euro value without VAT is below what both together would be.
      const consignment = (await getOrderTreatment(storeId, order.id))?.consignmentEurMinor ?? 0;
      const lines = order.lines.filter((l) => l.delivery === "physical");
      expect(lines).toHaveLength(1);
      expect(consignment).toBe(lines[0].totalMinor - lines[0].taxMinor);
    } finally {
      await saveTaxProfile(member, plain);
    }
  });

  it("charges VAT in full when the goods are sent from outside the EU, from the buyer's own country, and not for downloads alone", async () => {
    for (const [dispatch, reason] of [["CN", "dispatch_outside_eu"], ["DE", "dispatch_domestic"]] as const) {
      reset(de);
      await add("DEMO-MUG-WHITE", 1);
      await saveTaxProfile(member, { ...plain, dispatchCountry: dispatch });
      try {
        const ordinary = await cartSummary(shop(), await getCart(shop()));
        expect(await typeNumber(DE_NUMBER)).toMatchObject({ ok: true, outcome: "valid" });
        const { summary, order } = await checkout();
        expect(summary.tax).toMatchObject({ kind: "standard", reason, reverseCharge: false, reliefMinor: 0 });
        expect(summary.total).toBe(ordinary.total);
        expect(order).toMatchObject({ vatKind: "standard", vatReliefMinor: 0, taxMinor: ordinary.vat });
        expect((await getOrderTreatment(storeId, order.id))).toMatchObject({ reason });
        // The number is not offered: the cart says nothing it cannot honour.
        expect(summary.tax.field).toMatchObject({ offered: false, reason });
      } finally {
        await saveTaxProfile(member, plain);
      }
    }
    // Downloads alone are not sent: reverse charge stands, whatever the goods' dispatch fact says.
    reset(de);
    await add("DEMO-LAMP", 1);
    await saveTaxProfile(member, { ...plain, dispatchCountry: "CN" });
    try {
      await typeNumber(DE_NUMBER);
      const { summary, order } = await checkout(consent);
      expect(summary.tax).toMatchObject({ kind: "reverse_charge", reverseCharge: true });
      expect(order.vatKind).toBe("reverse_charge");
    } finally {
      await saveTaxProfile(member, plain);
    }
  });

  it("reverse-charges goods sent from a third member state", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await saveTaxProfile(member, { ...plain, dispatchCountry: "PL" });
    try {
      await typeNumber(DE_NUMBER);
      const { summary, order } = await checkout();
      expect(summary.tax).toMatchObject({ kind: "reverse_charge", reason: "reverse_charge" });
      expect(order.vatKind).toBe("reverse_charge");
    } finally {
      await saveTaxProfile(member, plain);
    }
  });
});

describe("shipping VAT", () => {
  const read = async () => (await getOrder(storeId, (await checkout()).order.id))!;

  it("takes the standard rate until a person has verified another rule for the country", async () => {
    reset(de);
    await db().execute(sql`update commerce.products set vat_category = 'exempt' where store_id = ${storeId}::uuid and id = ${product["demo-keramikkopp"]}::uuid`);
    try {
      await add("DEMO-MUG-WHITE", 2);
      // A rule that was never verified changes nothing.
      await db().execute(sql`select commerce.set_shipping_vat_rule('DE', 'follows_goods', 'a draft', null, '', false, ${member.account.id}::uuid)`);
      const ignored = await read();
      expect(ignored.shippingVatRate).toBe(0.19);
      // Verified (with its source, the date and the person), it applies to new orders: the goods are exempt, so shipping carries none.
      await db().execute(sql`select commerce.set_shipping_vat_rule('DE', 'follows_goods', 'https://example.org/act (test data)', date '2026-10-03', '', true, ${member.account.id}::uuid)`);
      const verified = await read();
      expect(verified.shippingVatRate).toBe(0);
      expect(verified.taxMinor).toBe(0);
      // The order that was placed first keeps its own.
      expect((await getOrder(storeId, ignored.id))!.shippingVatRate).toBe(0.19);
    } finally {
      await db().execute(sql`select commerce.set_shipping_vat_rule('DE', 'standard', '', null, '', false, ${member.account.id}::uuid)`);
      await db().execute(sql`update commerce.products set vat_category = 'standard' where store_id = ${storeId}::uuid and id = ${product["demo-keramikkopp"]}::uuid`);
    }
  });
});

describe("what the VAT number field needs", () => {
  it("is offered to a business in another EU country when the store is ready, and to nobody else", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).tax.field).toEqual({ offered: false, reason: "private" });
    await setCartCompany(shop(), company);
    expect((await cartSummary(shop(), await getCart(shop()))).tax.field).toEqual({ offered: true });
    view = no;
    jar.clear();
    await add("DEMO-MUG-WHITE", 1);
    await setCartCompany(shop(), { name: "Kunde AS", number: "923609016" });
    expect((await cartSummary(shop(), await getCart(shop()))).tax.field).toEqual({ offered: false, reason: "market_not_eu" });
  });
});

describe("the VAT of every placed order is what the order page says", () => {
  it("keeps the placed order's treatment for staff and a shopper-safe copy for the shopper", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await typeNumber(DE_NUMBER);
    const { order, open, params } = await checkout();
    fake.sessions.set(open.sessionId, { status: "complete", payment_status: "paid", mode: params.mode, payment_intent: `pi_${open.sessionId}` });
    const shopper = await getShopperOrder(storeId, order.id, open.sessionId);
    expect(shopper?.vat).toMatchObject({ reason: "reverse_charge", sellerVatNumber: SELLER, buyerVatNumber: DE_NUMBER, buyerCountry: "DE" });
    expect(shopper?.vatReliefMinor).toBeGreaterThan(0);
    expect(shopper?.shippingReliefMinor).toBeGreaterThan(0);
    expect(readCartId).toBeDefined();
  });
});

describe("the invoice of a reverse-charge or IOSS order (D159)", () => {
  const iossForm = {
    vatRegistered: true, vatNumber: SELLER, dispatchCountry: "CN", ossScheme: "none" as const, ossMemberState: "", ossNumber: "", ossRegisteredOn: "",
    iossNumber: "IM2460000000", iossIntermediary: "Customs Agent AB", iossMarkets: ["DE", "DK", "CZ"], iossRegisteredOn: "2026-07-01",
  };
  const home = { ...iossForm, dispatchCountry: "", iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "" };

  beforeAll(async () => {
    await db().execute(sql`
      update commerce.stores set legal_name = 'Vat AB', organisation_number = '5566778899', postal_address = 'Storgatan 1, 111 22 Stockholm' where id = ${storeId}::uuid
    `);
    await db().execute(sql`delete from commerce.invoice_settings where store_id = ${storeId}::uuid`);
  });

  /** Pays the order the way Stripe's session does, then issues its invoice: the store's account is a test one (no legal number), so it is live for that one call. */
  async function invoiceOf(open: { orderId: string; sessionId: string }, params: Record<string, unknown>) {
    fake.sessions.set(open.sessionId, { status: "complete", payment_status: "paid", mode: params.mode, payment_intent: `pi_${open.sessionId}` });
    await getShopperOrder(storeId, open.orderId, open.sessionId);
    await db().execute(sql`update commerce.stripe_accounts set mode = 'live' where store_id = ${storeId}::uuid`);
    try {
      await issueWaitingInvoices(storeId);
    } finally {
      await db().execute(sql`update commerce.stripe_accounts set mode = 'test' where store_id = ${storeId}::uuid`);
    }
    return documents.invoiceOf(storeId, open.orderId);
  }

  it("says reverse charge with both VAT numbers, at rate 0 with the rate that would have applied, and never prints VIES's name or address", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 2);
    await add("DEMO-NOTEBOOK-LINED", 3);
    await typeNumber(DE_NUMBER);
    const { order, open, params } = await checkout();
    // A business's invoice needs its full address (Art. 226 point 5): Stripe is asked for the billing address, not only a postal code.
    expect(params.billing_address_collection).toBe("required");
    const invoice = (await invoiceOf(open, params))!;
    expect(invoice).toMatchObject({ vatKind: "reverse_charge", taxMinor: 0, totalMinor: order.totalMinor, netMinor: order.totalMinor, currency: "EUR" });
    const s = invoice.snapshot;
    expect(s.treatment).toMatchObject({ kind: "reverse_charge", sellerVatNumber: SELLER, buyerVatNumber: DE_NUMBER, statements: ["reverse_charge"] });
    expect(s.buyer).toMatchObject({ type: "business", company: "Kunde GmbH", vatNumber: DE_NUMBER });
    expect(s.seller).toMatchObject({ vatRegistered: true, vatNumber: SELLER, country: "SE" });
    expect(s.buckets).toEqual([{ rate: 0, basis: "reverse_charge", netMinor: order.totalMinor, vatMinor: 0, grossMinor: order.totalMinor }]);
    for (const line of s.lines) expect(line).toMatchObject({ vatRate: 0, vatMinor: 0, basis: "reverse_charge", wouldHaveRate: 0.19 });
    expect(s.shipping).toMatchObject({ vatRate: 0, vatMinor: 0, wouldHaveRate: 0.19 });
    // The VAT amount is nothing, so no VAT in the seller's currency is needed (an invoice in euro from a Swedish seller).
    expect(s.vatHome).toBeNull();
    // What VIES answered about the buyer is for staff alone: it is in no document.
    const text = JSON.stringify(s);
    // (VIES's name is in capitals; the company is written as the buyer typed it.)
    for (const private_ of ["KUNDE GMBH", "HAUPTSTRASSE", "BERLIN", "requestIdentifier", "WAPI"]) expect(text).not.toContain(private_);
    // The number in the hosted page's data is the buyer's own number, once, in the buyer block and the treatment.
    expect(text.split(DE_NUMBER).length - 1).toBe(2);
  });

  it("credits a reverse-charge invoice with a note that carries the same statement and no VAT", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 2);
    await typeNumber(DE_NUMBER);
    const { order, open, params } = await checkout();
    const invoice = (await invoiceOf(open, params))!;
    const admin = await (await import("./order-admin")).getOrderAdmin(storeId, order.id);
    expect(admin!.refundableMinor).toBe(order.totalMinor);
    expect(await refundOrder(storeId, order.id, { amountMinor: Math.floor(order.totalMinor / 2), reason: "Del", restock: [] }, null)).toMatchObject({ ok: true });
    expect(await refundOrder(storeId, order.id, { amountMinor: order.totalMinor - Math.floor(order.totalMinor / 2), reason: "Rest", restock: [] }, null)).toMatchObject({ ok: true });
    const notes = await documents.notesOf(storeId, order.id);
    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(note).toMatchObject({ taxMinor: 0, currency: "EUR" });
      expect(note.snapshot.treatment).toMatchObject({ kind: "reverse_charge", buyerVatNumber: DE_NUMBER, sellerVatNumber: SELLER });
      expect(note.snapshot.buckets).toEqual([expect.objectContaining({ rate: 0, basis: "reverse_charge", vatMinor: 0 })]);
    }
    expect(notes.reduce((sum, n) => sum + n.totalMinor, 0)).toBe(invoice.totalMinor);
    expect(notes[1].snapshot.position.leftOnInvoiceMinor).toBe(0);
  });

  it("flags a waiting reverse-charge invoice as overdue after the 15th of the month after the payment, on the store's day", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    await typeNumber(DE_NUMBER);
    const { order, open, params } = await checkout();
    // The seller's details are taken away while it is paid: it waits.
    await db().execute(sql`update commerce.stores set legal_name = null where id = ${storeId}::uuid`);
    try {
      fake.sessions.set(open.sessionId, { status: "complete", payment_status: "paid", mode: params.mode, payment_intent: `pi_${open.sessionId}` });
      await getShopperOrder(storeId, order.id, open.sessionId);
      await db().execute(sql`update commerce.stripe_accounts set mode = 'live' where store_id = ${storeId}::uuid`);
      const waiting = await invoicesRead.waitingInvoices(storeId);
      const mine = waiting.find((w) => w.orderId === order.id)!;
      expect(mine).toMatchObject({ reason: "seller_details", vatKind: "reverse_charge", overdue: false });
      const [y, m] = mine.paidOn.split("-").map(Number);
      const deadline = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-15`;
      expect(mine.deadline).toBe(deadline);
      expect((await invoicesRead.waitingInvoices(storeId, deadline)).find((w) => w.orderId === order.id)!.overdue).toBe(false);
      const after = new Date(`${deadline}T12:00:00Z`);
      after.setUTCDate(after.getUTCDate() + 1);
      expect((await invoicesRead.waitingInvoices(storeId, after.toISOString().slice(0, 10))).find((w) => w.orderId === order.id)!.overdue).toBe(true);
      expect((await invoicesRead.invoiceCounts(storeId, after.toISOString().slice(0, 10))).overdue).toBeGreaterThanOrEqual(1);
      // Issued when the details are back, with today as its issue date and the payment day as its supply date.
      await db().execute(sql`update commerce.stores set legal_name = 'Vat AB' where id = ${storeId}::uuid`);
      expect(await issueWaitingInvoices(storeId)).toBeGreaterThanOrEqual(1);
      expect(await documents.invoiceOf(storeId, order.id)).toMatchObject({ vatKind: "reverse_charge", supplyDate: mine.paidOn });
    } finally {
      await db().execute(sql`update commerce.stores set legal_name = 'Vat AB' where id = ${storeId}::uuid`);
      await db().execute(sql`update commerce.stripe_accounts set mode = 'test' where store_id = ${storeId}::uuid`);
    }
  });

  it("states the store's IOSS number on an IOSS-marked order, with the VAT charged as always, and none on one above 150 EUR", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 2);
    expect(await saveTaxProfile(member, iossForm)).toMatchObject({ ok: true });
    try {
      const { order, open, params } = await checkout();
      expect(order.vatKind).toBe("ioss");
      const invoice = (await invoiceOf(open, params))!;
      expect(invoice).toMatchObject({ vatKind: "ioss", taxMinor: order.taxMinor, totalMinor: order.totalMinor });
      expect(invoice.taxMinor).toBeGreaterThan(0);
      expect(invoice.snapshot.treatment).toMatchObject({ kind: "ioss", iossNumber: "IM2460000000", statements: ["ioss"], buyerVatNumber: null });
      expect(invoice.snapshot.buyer.vatNumber).toBeNull();

      // A consignment above the limit is not an IOSS sale: no statement, no number.
      reset(de);
      await add("DEMO-MUG-WHITE", 5);
      const over = await checkout();
      const overInvoice = (await invoiceOf(over.open, over.params))!;
      expect(overInvoice).toMatchObject({ vatKind: "standard" });
      expect(overInvoice.snapshot.treatment).toMatchObject({ kind: "standard", iossNumber: null });
      expect(overInvoice.snapshot.treatment.statements).not.toContain("ioss");
    } finally {
      await saveTaxProfile(member, home);
    }
  });

  it("prints no buyer's VAT number on a consumer's invoice, and the VAT in it", async () => {
    reset(de);
    await add("DEMO-MUG-WHITE", 1);
    const { order, open, params } = await checkout();
    // A private buyer is not asked for more than before.
    expect(params.billing_address_collection).toBeUndefined();
    const invoice = (await invoiceOf(open, params))!;
    expect(invoice).toMatchObject({ vatKind: "standard", taxMinor: order.taxMinor });
    expect(invoice.taxMinor).toBeGreaterThan(0);
    expect(invoice.snapshot.buyer).toMatchObject({ type: "consumer", vatNumber: null });
    expect(invoice.snapshot.treatment).toMatchObject({ kind: "standard", buyerVatNumber: null, iossNumber: null });
  });
});
