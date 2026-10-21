import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { EMPTY_NAVIGATION } from "@/lib/navigation";
import { parseStoreSeo } from "@/lib/seo";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/** Kaizen's Stripe client, faked: records coupons and sessions made on the store's account. */
const fake = vi.hoisted(() => {
  const coupons: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const sessions: Record<string, unknown>[] = [];
  let next = 0;
  const client = {
    coupons: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        coupons.push({ params, options });
        return { id: `coupon_${coupons.length}` };
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          sessions.push(params);
          const id = `cs_disc_${++next}`;
          return { id, url: `https://checkout.stripe.test/${id}`, client_secret: `${id}_secret`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, status: "open", payment_status: "unpaid" }),
        expire: async (id: string) => ({ id }),
      },
    },
    paymentMethodDomains: { create: async () => ({ id: "pmd" }), list: async () => ({ data: [] }) },
  };
  return { client, coupons, sessions };
});

vi.mock("server-only", () => ({}));
// No shopper signed in: checks at checkout run as a guest's.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));

const { cancelUnpaidOrder, placeOrder, startCheckout } = await import("./checkout");
const { checkCodeForOrder, codeItemCounts, deleteDiscount, exportCodeItems, generateCodes, getDiscount, saveDiscount } = await import("./discounts");

const run = Date.now().toString(36);
const slug = `disc-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
let storeId: string;
let member: Membership;
let customerId: string;
let monthly: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  // A new store starts with the shop alone (D178): these tests sell subscriptions, as an owner switches them on under Features.
  await db().execute(sql`update commerce.stores set features = features || array['subscriptions']::text[] where slug = ${slug}`);
  storeId = String(store.id);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${`acct_disc${run}`}, 'active', false)
  `);
  await db().execute(sql`
    update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid
  `);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id
  `);
  const [customer] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`kari-${run}@example.com`}) returning id
  `);
  customerId = String(customer.id);
  const [plan] = await db().execute<Row>(sql`
    insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
    select store_id, id, 'month', 1, 10 from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-notatbok'
    returning id
  `);
  monthly = String(plan.id);
  member = {
    account: { id: String(account.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: {
      id: storeId,
      slug,
      name: "Test",
      status: "active",
      isTemplate: false,
      starter: false,
      setupCompletedAt: null,
      paymentsOn: true,
      paymentsTest: true,
      details: { legalName: null, organisationNumber: null, contactEmail: null, postalAddress: null, country: "NO" },
      markets: [no, se],
      seo: parseStoreSeo({}),
      navigation: EMPTY_NAVIGATION,
    },
  } as Membership;
});

afterAll(async () => {
  await closeDb();
});

async function cart(lines: [string, number, string | null][], code: string | null): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, discount_code)
    values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', ${code}) returning id
  `);
  for (const [sku, quantity, plan] of lines) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id)
      select ${storeId}::uuid, ${String(row.id)}::uuid, id, ${quantity}, ${plan}::uuid
      from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
    `);
  }
  return String(row.id);
}

const code = async (input: Record<string, unknown>) => {
  const result = await saveDiscount(member, null, input);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id!;
};

describe("making codes (D31)", () => {
  it("checks what the owner types", async () => {
    expect(await saveDiscount(member, null, { code: "x", kind: "percent", percent: 10 })).toMatchObject({ ok: false });
    expect(await saveDiscount(member, null, { code: "PENGER", kind: "fixed" })).toEqual({
      ok: false,
      problems: ["Give the amount off in at least one country's currency."],
    });
    expect(
      await saveDiscount(member, null, { code: "DATO", kind: "percent", startsAt: "2026-12-01T10:00", endsAt: "2026-11-01T10:00" }),
    ).toMatchObject({ ok: false, problems: ["The code must end after it starts."] });
  });

  it("keeps codes in capitals, one of each per store", async () => {
    await code({ code: " sommer ", kind: "percent", percent: 20 });
    const [row] = await db().execute<Row>(sql`select code, amounts from commerce.discount_codes where store_id = ${storeId}::uuid`);
    expect(row).toMatchObject({ code: "SOMMER" });
    expect(await saveDiscount(member, null, { code: "Sommer", kind: "percent", percent: 5 })).toEqual({
      ok: false,
      problems: ["The store already has a code SOMMER."],
    });
  });
});

describe("placing an order with a code", () => {
  it("takes a percentage off each line, with the VAT on what is paid", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 2, null]], "sommer"));
    if (!result.ok) throw new Error(result.problem);
    const { order } = result;
    // 2 × 199,00 = 398,00; 20 % off each unit is 39,80; shipping 99,00.
    expect(order).toMatchObject({ shippingMinor: 9900, shippingDiscountMinor: 0, totalMinor: 31840 + 9900 });
    expect(order.discount).toEqual({ code: "SOMMER", couponMinor: 7960 });
    const [row] = await db().execute<Row>(sql`
      select subtotal_minor, discount_minor, total_minor, tax_minor, discount_code from commerce.orders where id = ${order.orderId}::uuid
    `);
    expect(row).toMatchObject({ subtotal_minor: "39800", discount_minor: "7960", total_minor: "41740", discount_code: "SOMMER" });
    expect(Number(row.tax_minor)).toBe(Math.round((31840 * 0.25) / 1.25) + Math.round((9900 * 0.25) / 1.25));
    const [line] = await db().execute<Row>(sql`
      select unit_price_minor, discount_minor, total_minor from commerce.order_lines where order_id = ${order.orderId}::uuid
    `);
    expect(line).toEqual({ unit_price_minor: "19900", discount_minor: "7960", total_minor: "31840" });
  });

  it("gives free shipping, and refuses a code below its minimum", async () => {
    await code({ code: "FRIFRAKT", kind: "free_shipping", minSubtotals: { NO: "300" } });
    expect(await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 1, null]], "FRIFRAKT"))).toEqual({
      ok: false,
      problem: "discount",
    });
    const result = await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 2, null]], "FRIFRAKT"));
    if (!result.ok) throw new Error(result.problem);
    expect(result.order).toMatchObject({ shippingMinor: 9900, shippingDiscountMinor: 9900, totalMinor: 39800 });
    expect(result.order.discount).toEqual({ code: "FRIFRAKT", couponMinor: 0 });
  });

  it("stops at its limit, counting orders waiting for payment, and frees a use when one is cancelled", async () => {
    await code({ code: "EN-GANG", kind: "fixed", amounts: { NO: "50" }, usageLimit: 1 });
    const first = await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 1, null]], "EN-GANG"));
    if (!first.ok) throw new Error(first.problem);
    expect(first.order.discount).toEqual({ code: "EN-GANG", couponMinor: 5000 });
    expect(await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 1, null]], "EN-GANG"))).toEqual({
      ok: false,
      problem: "discount",
    });
    await cancelUnpaidOrder(first.order.orderId, "checkout expired");
    expect((await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 1, null]], "EN-GANG"))).ok).toBe(true);
  });

  it("gives a once-per-customer code only to signed-in customers, once", async () => {
    await code({ code: "VELKOMMEN", kind: "percent", percent: 15, oncePerCustomer: true });
    const lines: [string, number, null][] = [["DEMO-TOTE", 1, null]];
    expect(await placeOrder({ storeId, market: no }, await cart(lines, "VELKOMMEN"))).toEqual({ ok: false, problem: "discount" });
    const first = await placeOrder({ storeId, market: no }, await cart(lines, "VELKOMMEN"), {}, { customerId });
    expect(first.ok).toBe(true);
    expect(await placeOrder({ storeId, market: no }, await cart(lines, "VELKOMMEN"), {}, { customerId })).toEqual({
      ok: false,
      problem: "discount",
    });
  });

  it("lowers a subscription's renewals with a recurring percentage, outside Stripe's coupon", async () => {
    await code({ code: "ALLTID", kind: "percent", percent: 10, recurring: true });
    const result = await placeOrder(
      { storeId, market: no },
      await cart([["DEMO-NOTEBOOK-LINED", 1, monthly], ["DEMO-TOTE", 1, null]], "ALLTID"),
      { subscription: true },
    );
    if (!result.ok) throw new Error(result.problem);
    // The notebook: 129,00 less 10 % subscriber's price = 116,10, less 10 % = 104,49 for good.
    expect(result.order.lines).toContainEqual(expect.objectContaining({ recurring: true, unitPriceMinor: 10449 }));
    // Only the tote's 10 % goes in the coupon: the notebook's is in its price.
    expect(result.order.discount).toEqual({ code: "ALLTID", couponMinor: 1990 });
    const [line] = await db().execute<Row>(sql`
      select l.unit_price_minor from commerce.subscription_lines l
      where l.subscription_id = ${result.order.subscription!.id}::uuid
    `);
    expect(line.unit_price_minor).toBe("10449");
  });

  it("can be changed and deleted after use, while orders keep what they got", async () => {
    const [used] = await db().execute<Row>(sql`select id from commerce.discount_codes where store_id = ${storeId}::uuid and code = 'SOMMER'`);
    const id = String(used.id);
    expect(await saveDiscount(member, id, { code: "SOMMER2", kind: "fixed", amounts: { NO: "10" } })).toMatchObject({ ok: true });
    expect(await deleteDiscount(member, id)).toEqual({ ok: true });
    const orders = await db().execute<Row>(sql`
      select discount_code_id, discount_code, discount_minor from commerce.orders
      where store_id = ${storeId}::uuid and discount_code = 'SOMMER'
    `);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0]).toEqual({ discount_code_id: null, discount_code: "SOMMER", discount_minor: "7960" });
  });
});

describe("a code typed at checkout (D38)", () => {
  it("is checked against the order waiting for payment, saying why it does not apply", async () => {
    await code({ code: "KASSE10", kind: "percent", percent: "10", minSubtotals: { NO: "300" } });
    const placed = await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 1, null]], null));
    if (!placed.ok) throw new Error(placed.problem);
    const shop = { storeId, market: no };
    expect(await checkCodeForOrder(shop, placed.order.orderId, "finnes-ikke")).toEqual({
      ok: false,
      problem: "unknown",
      with: null,
      minimumMinor: null,
    });
    // One tote (199,00) is below the code's 300,00.
    expect(await checkCodeForOrder(shop, placed.order.orderId, "kasse10")).toEqual({
      ok: false,
      problem: "minimum",
      with: null,
      minimumMinor: 30000,
    });
    const two = await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 2, null]], null));
    if (!two.ok) throw new Error(two.problem);
    expect(await checkCodeForOrder(shop, two.order.orderId, " kasse10 ")).toEqual({ ok: true, code: "KASSE10" });
  });
});

describe("paying with a code", () => {
  it("sends Stripe a one-time coupon on the store's account, and the shipping after any discount", async () => {
    await code({ code: "STRIPE", kind: "fixed", amounts: { NO: "25,50" } });
    const result = await startCheckout(
      { storeId, storeSlug: slug, market: no },
      await cart([["DEMO-TOTE", 1, null]], "STRIPE"),
      "http://localhost:3000",
      "Frakt",
    );
    expect(result.ok).toBe(true);
    const coupon = fake.coupons.at(-1)!;
    expect(coupon.params).toMatchObject({ amount_off: 2550, currency: "nok", duration: "once", max_redemptions: 1, name: "STRIPE" });
    expect(coupon.options).toMatchObject({ stripeAccount: `acct_disc${run}` });
    const session = fake.sessions.at(-1)!;
    expect(session.discounts).toEqual([{ coupon: `coupon_${fake.coupons.length}` }]);
  });
});

describe("codes in depth (D299 E1)", () => {
  it("reaches a category's products only, and asks for a number of items", async () => {
    const [term] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug) values (${storeId}::uuid, 'product', 'category', 'Vesker', ${`vesker-${run}`})
      returning id
    `);
    await db().execute(sql`
      insert into commerce.product_terms (store_id, product_id, term_id, content_type)
      select store_id, product_id, ${String(term.id)}::uuid, 'product' from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'
    `);
    expect(await saveDiscount(member, null, { code: "UKJENT-KAT", kind: "percent", percent: 10, termIds: ["00000000-0000-4000-8000-000000000000"] })).toMatchObject({
      ok: false,
    });
    await code({ code: "VESKER", kind: "percent", percent: 10, termIds: [String(term.id)], minQuantity: 2 });
    // One tote is below the two items asked for.
    expect(await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 1, null]], "VESKER"))).toEqual({ ok: false, problem: "discount" });
    const result = await placeOrder({ storeId, market: no }, await cart([["DEMO-TOTE", 2, null], ["DEMO-NOTEBOOK-LINED", 1, null]], "VESKER"));
    if (!result.ok) throw new Error(result.problem);
    // 10 % of the two totes (398,00) only; the notebook is in no category the code names.
    expect(result.order.discount).toEqual({ code: "VESKER", couponMinor: 3980 });
  });

  it("is for a customer group or named customers only", async () => {
    const [tier] = await db().execute<Row>(sql`
      insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'VIP', 1) returning id
    `);
    await code({ code: "GRUPPE", kind: "fixed", amounts: { NO: "20" }, tierIds: [String(tier.id)] });
    const lines: [string, number, null][] = [["DEMO-TOTE", 1, null]];
    const shop = { storeId, market: no };
    // A guest is asked to sign in; a customer outside the group is refused.
    expect(await placeOrder(shop, await cart(lines, "GRUPPE"))).toEqual({ ok: false, problem: "discount" });
    expect(await placeOrder(shop, await cart(lines, "GRUPPE"), {}, { customerId })).toEqual({ ok: false, problem: "discount" });
    await db().execute(sql`update commerce.customers set tier_id = ${String(tier.id)}::uuid where id = ${customerId}::uuid`);
    const inGroup = await placeOrder(shop, await cart(lines, "GRUPPE"), {}, { customerId });
    // The group's own 1 % (1,99) rides in the same coupon as the code's 20,00.
    expect(inGroup.ok && inGroup.order.discount).toEqual({ code: "GRUPPE + VIP", couponMinor: 2199 });
    await db().execute(sql`update commerce.customers set tier_id = null where id = ${customerId}::uuid`);

    expect(await saveDiscount(member, null, { code: "NAVN-FEIL", kind: "percent", percent: 5, customerEmails: "ingen@example.com" })).toMatchObject({ ok: false });
    await code({ code: "KARI", kind: "percent", percent: 5, customerEmails: `KARI-${run}@example.com` });
    const kari = await placeOrder(shop, await cart(lines, "KARI"), {}, { customerId });
    expect(kari.ok).toBe(true);
    expect(await placeOrder(shop, await cart(lines, "KARI"))).toEqual({ ok: false, problem: "discount" });
  });

  it("hands out single-use codes, each good for one order, also when two pay at once", async () => {
    const id = await code({ code: "KAMPANJE", kind: "percent", percent: 10, uniqueCodes: true });
    expect(await generateCodes(member, id, { count: 3, prefix: "vår!" })).toMatchObject({ ok: false });
    expect(await generateCodes(member, id, { count: 3, prefix: "VAAR" })).toEqual({ ok: true, made: 3 });
    const items = await db().execute<Row>(sql`select code from commerce.discount_code_items where discount_id = ${id}::uuid order by code`);
    expect(items).toHaveLength(3);
    for (const item of items) expect(String(item.code)).toMatch(/^VAAR-[A-HJKMNP-Z2-9]{8}$/);
    const shop = { storeId, market: no };
    const lines: [string, number, null][] = [["DEMO-TOTE", 1, null]];
    // The code's own text is no code once it hands out codes of its own.
    expect(await placeOrder(shop, await cart(lines, "KAMPANJE"))).toEqual({ ok: false, problem: "discount" });
    const [one, two] = await Promise.all([
      placeOrder(shop, await cart(lines, String(items[0].code).toLowerCase())),
      placeOrder(shop, await cart(lines, String(items[0].code))),
    ]);
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
    const won = (one.ok ? one : two) as Extract<typeof one, { ok: true }>;
    expect(won.order.discount).toEqual({ code: String(items[0].code), couponMinor: 1990 });
    const [row] = await db().execute<Row>(sql`select discount_code, discount_code_item_id is not null as item from commerce.orders where id = ${won.order.orderId}::uuid`);
    expect(row).toEqual({ discount_code: String(items[0].code), item: true });
    // Another of the codes still works.
    expect((await placeOrder(shop, await cart(lines, String(items[1].code)))).ok).toBe(true);
    expect(await codeItemCounts(storeId, id)).toEqual({ made: 3, used: 2 });
    const file = await exportCodeItems(member, id);
    expect(file?.csv.split("\n")[0]).toMatch(/^code,used,made_on/);
    expect(file?.csv).toContain(`${String(items[0].code)},yes,`);
    // A generated code's text can never be a code of the store's own.
    expect(await saveDiscount(member, null, { code: String(items[2].code), kind: "percent", percent: 5 })).toMatchObject({ ok: false });
  });
});

describe("several codes on one order (D299 E2)", () => {
  /** A cart holding these codes, in this order, as the cart page keeps them. */
  async function cartWith(lines: [string, number, string | null][], codes: string[]): Promise<string> {
    const id = await cart(lines, codes[0] ?? null);
    await db().execute(sql`
      update commerce.carts set more_codes = ${`{${codes.slice(1).join(",")}}`}::text[] where id = ${id}::uuid
    `);
    return id;
  }

  it("uses two codes that combine, keeping both and what each took off", async () => {
    const first = await code({ code: "PAR-EN", kind: "percent", percent: 10, combinesWith: ["order"] });
    await code({ code: "PAR-TO", kind: "fixed", amounts: { NO: "20" }, combinesWith: ["order"] });
    const result = await placeOrder({ storeId, market: no }, await cartWith([["DEMO-TOTE", 2, null]], ["PAR-EN", "PAR-TO"]));
    if (!result.ok) throw new Error(result.problem);
    // 10 % of 398,00 is 39,80; 20,00 off the 358,20 left.
    expect(result.order.discount).toEqual({ code: "PAR-EN + PAR-TO", couponMinor: 3980 + 2000 });
    const [order] = await db().execute<Row>(sql`
      select discount_code, discount_code_id, entered_codes from commerce.orders where id = ${result.order.orderId}::uuid
    `);
    expect(order).toEqual({ discount_code: "PAR-EN + PAR-TO", discount_code_id: first, entered_codes: ["PAR-EN", "PAR-TO"] });
    const rows = await db().execute<Row>(sql`
      select position, code, amount_minor from commerce.order_discount_codes where order_id = ${result.order.orderId}::uuid order by position
    `);
    expect(rows).toEqual([
      { position: 1, code: "PAR-EN", amount_minor: "3980" },
      { position: 2, code: "PAR-TO", amount_minor: "2000" },
    ]);
    // The second code's uses count this order too.
    const second = await db().execute<Row>(sql`select id from commerce.discount_codes where store_id = ${storeId}::uuid and code = 'PAR-TO'`);
    expect((await getDiscount(storeId, String(second[0].id)))?.used).toBe(1);
  });

  it("keeps the better of two that cannot combine, in the cart and the order alike, and does not stop the checkout", async () => {
    await code({ code: "ALENE-LITEN", kind: "percent", percent: 5 });
    await code({ code: "ALENE-STOR", kind: "fixed", amounts: { NO: "50" } });
    const result = await placeOrder({ storeId, market: no }, await cartWith([["DEMO-TOTE", 1, null]], ["ALENE-LITEN", "ALENE-STOR"]));
    if (!result.ok) throw new Error(result.problem);
    expect(result.order.discount).toEqual({ code: "ALENE-STOR", couponMinor: 5000 });
    // The order remembers both were typed, and that only the better one applied.
    const [order] = await db().execute<Row>(sql`select entered_codes from commerce.orders where id = ${result.order.orderId}::uuid`);
    expect(order.entered_codes).toEqual(["ALENE-LITEN", "ALENE-STOR"]);
    const rows = await db().execute<Row>(sql`select code from commerce.order_discount_codes where order_id = ${result.order.orderId}::uuid`);
    expect(rows).toEqual([{ code: "ALENE-STOR" }]);
  });

  it("still stops the checkout for a code that does not apply on its own", async () => {
    await code({ code: "PAR-MIN", kind: "percent", percent: 10, minSubtotals: { NO: "1000" }, combinesWith: ["order"] });
    expect(await placeOrder({ storeId, market: no }, await cartWith([["DEMO-TOTE", 1, null]], ["PAR-EN", "PAR-MIN"]))).toEqual({
      ok: false,
      problem: "discount",
    });
  });
});
