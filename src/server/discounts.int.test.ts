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
vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));

const { cancelUnpaidOrder, placeOrder, startCheckout } = await import("./checkout");
const { deleteDiscount, saveDiscount } = await import("./discounts");

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

  it("only lets unused codes be deleted", async () => {
    const [used] = await db().execute<Row>(sql`select id from commerce.discount_codes where store_id = ${storeId}::uuid and code = 'SOMMER'`);
    expect(await deleteDiscount(member, String(used.id))).toEqual({
      ok: false,
      problems: ["Orders have used this code, so it can only be switched off."],
    });
    const unused = await code({ code: "UBRUKT", kind: "percent", percent: 5 });
    expect(await deleteDiscount(member, unused)).toEqual({ ok: true });
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
