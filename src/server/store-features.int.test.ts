import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { addMember, auditRows, makeAccount, makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const features = await import("./store-features");
const bookings = await import("./bookings");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * Store features (D178, docs/store-features.md): owners switch, a feature's needs are enforced, switching off is refused while customers would be
 * hit and confirmed over warnings, every change is audited, and the modules of code from before D178 follow.
 */

let n = 0;
let store: { id: string; slug: string; account: Awaited<ReturnType<typeof makeAccount>> };

const kept = async () => ((await db().execute<Row>(sql`select features, modules from commerce.stores where id = ${store.id}::uuid`))[0]) as { features: string[]; modules: string[] };
const owner = () => membershipOf(store.slug, store.account, "owner");

async function variantOf(storeId: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid limit 1`);
  return String(row.id);
}

/** An order of the store with one physical line, paid or waiting for payment. */
async function order(status: "paid" | "pending_payment" | "fulfilled", market = "NO"): Promise<string> {
  const number = `F-${run}-${++n}`;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${store.id}::uuid, ${number}, ${market}, 'NOK', 'nb-NO', ${`${number}@example.com`}, ${status}::commerce.order_status, 10000, 0, 0, 2000, 10000, '{"name":"A"}'::jsonb, '{"name":"A","line1":"G 1","postalCode":"0150","city":"Oslo","country":"NO"}'::jsonb)
    returning id
  `);
  const id = String(o.id);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${store.id}::uuid, ${id}::uuid, ${await variantOf(store.id)}::uuid, 'X', 'Thing', 1, 10000, 100, 10000, 2000, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status, test_mode)
    values (${store.id}::uuid, ${id}::uuid, 'stripe', ${`pi_f_${run}_${n}`}, 10000, 0, 'NOK', ${status === "pending_payment" ? "pending" : "captured"}::commerce.payment_status, false)
  `);
  return id;
}

/** A running subscription in a market, with its first order. */
async function subscription(market = "NO"): Promise<string> {
  const first = await order("fulfilled", market);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, interval, interval_count, subtotal_minor, shipping_minor,
      total_minor, tax_minor, first_order_id, provider_reference, manage_token)
    values (${store.id}::uuid, ${`SUB-F-${run}-${++n}`}, 'active', ${market}, 'NOK', 'nb-NO', 'sub@example.com', 'month', 1, 10000, 0, 10000, 2000, ${first}::uuid,
      ${`sub_f_${run}_${n}`}, ${`tok-f-${run}-${n}`})
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  store = await makeStore("features");
});
afterAll(async () => {
  await closeDb();
});

describe("a new store's features (D178)", () => {
  it("starts with the shop alone, and the store says what is on", async () => {
    expect((await kept()).features).toEqual(["shop"]);
    const s = (await getStore(store.slug))!;
    expect(s).toMatchObject({ features: ["shop"], bookingsOn: false, deliveriesOn: false });
  });
});

describe("switching features (D178)", () => {
  it("is the owner's alone", async () => {
    const staff = await makeAccount("features-staff");
    await addMember(store.id, staff.id, "admin");
    const member = await membershipOf(store.slug, staff, "admin");
    expect(await features.setFeature(member, "bonus", true)).toEqual({ ok: false, problems: ["Only an owner can switch features on or off."] });
    expect((await kept()).features).toEqual(["shop"]);
  });

  it("refuses a feature whose needs are off, and audits each change with its area and before and after", async () => {
    expect(await features.setFeature(await owner(), "referrals", true)).toMatchObject({ ok: false, problems: [expect.stringContaining("needs the bonus program")] });
    expect(await features.setFeature(await owner(), "bonus", true)).toMatchObject({ ok: true, changed: true, features: ["shop", "bonus"] });
    expect(await features.setFeature(await owner(), "referrals", true)).toMatchObject({ ok: true, features: ["shop", "bonus", "referrals"] });
    // Switching on what is on changes nothing and writes nothing.
    expect(await features.setFeature(await owner(), "bonus", true)).toMatchObject({ ok: true, changed: false });
    const rows = await auditRows(store.id, "store.feature");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      account_id: store.account.id,
      area: "settings",
      target_type: "store",
      details: { feature: "referrals", on: true },
      changes: { features: { from: ["shop", "bonus"], to: ["shop", "bonus", "referrals"] } },
    });
  });

  it("asks to confirm switching off over warnings, and the feature that needs it goes to sleep with its switch kept", async () => {
    const asked = await features.setFeature(await owner(), "bonus", false);
    expect(asked).toMatchObject({ ok: false, needsConfirmation: true, warnings: [expect.stringContaining("Referral program needs it")] });
    expect((await kept()).features).toEqual(["bonus", "referrals", "shop"]);
    expect(await features.setFeature(await owner(), "bonus", false, { confirmed: true })).toMatchObject({ ok: true, features: ["shop", "referrals"] });
    const s = (await getStore(store.slug))!;
    expect(s.features).toEqual(["shop", "referrals"]);
    const { featureOn } = await import("@/lib/store-features");
    expect(featureOn(s, "referrals")).toBe(false);
    // A sleeping feature touches no customer: its switch goes down without a question.
    expect(await features.setFeature(await owner(), "referrals", false)).toMatchObject({ ok: true, features: ["shop"] });
    const last = (await auditRows(store.id, "store.feature")).at(-2);
    expect(last).toMatchObject({ details: { feature: "bonus", on: false, alsoAffected: ["referrals"] } });
  });

  it("refuses switching subscriptions off while one runs, with the page to go to, and allows it after", async () => {
    expect(await features.setFeature(await owner(), "subscriptions", true)).toMatchObject({ ok: true });
    const id = await subscription();
    const refused = await features.setFeature(await owner(), "subscriptions", false, { confirmed: true });
    expect(refused).toMatchObject({ ok: false, blockers: [{ path: "/subscriptions", text: expect.stringContaining("1 subscription is still running") }] });
    expect((await kept()).features).toContain("subscriptions");
    await db().execute(sql`update commerce.subscriptions set status = 'cancelled', cancelled_at = now() where id = ${id}::uuid`);
    expect(await features.setFeature(await owner(), "subscriptions", false, { confirmed: true })).toMatchObject({ ok: true });
  });

  it("refuses switching several countries off while a subscription runs in another country", async () => {
    expect(await features.setFeature(await owner(), "countries", true)).toMatchObject({ ok: true });
    await db().execute(sql`
      insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
      select ${store.id}::uuid, code, currency, default_locale, locales, true from commerce.countries where code = 'SE'
      on conflict do nothing
    `);
    const id = await subscription("SE");
    const facts = await features.featureFacts(store.id);
    expect(facts).toMatchObject({ runningSubscriptions: 1, foreignSubscriptions: 1 });
    expect(await features.storeFeatureBlockers(store.id, "countries")).toEqual([expect.objectContaining({ path: "/subscriptions" })]);
    expect(await features.setFeature(await owner(), "countries", false, { confirmed: true })).toMatchObject({ ok: false });
    await db().execute(sql`update commerce.subscriptions set status = 'cancelled', cancelled_at = now() where id = ${id}::uuid`);
    expect(await features.setFeature(await owner(), "countries", false, { confirmed: true })).toMatchObject({ ok: true });
  });

  it("refuses switching the shop off while paid goods are still to send", async () => {
    const id = await order("paid");
    expect(await features.storeFeatureBlockers(store.id, "shop")).toEqual([expect.objectContaining({ path: "/orders" })]);
    expect(await features.setFeature(await owner(), "shop", false, { confirmed: true })).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.stringContaining("goods still to send")]) });
    await db().execute(sql`update commerce.orders set status = 'fulfilled' where id = ${id}::uuid`);
    expect(await features.setFeature(await owner(), "shop", false, { confirmed: true })).toMatchObject({ ok: true, features: [] });
    // Nothing needs the shop to switch countries and languages, and nothing else can come on without it.
    expect(await features.setFeature(await owner(), "languages", true)).toMatchObject({ ok: true, features: ["languages"] });
    expect(await features.setFeature(await owner(), "boxes", true)).toMatchObject({ ok: false, problems: [expect.stringContaining("needs the online shop")] });
    expect(await features.setFeature(await owner(), "shop", true)).toMatchObject({ ok: true, features: ["shop", "languages"] });
    expect(await features.setFeature(await owner(), "languages", false)).toMatchObject({ ok: false, needsConfirmation: true });
    expect(await features.setFeature(await owner(), "languages", false, { confirmed: true })).toMatchObject({ ok: true });
  });

  it("keeps the modules of code from before D178 in step: on with the shop, asleep without it", async () => {
    expect(await features.setFeature(await owner(), "appointments", true)).toMatchObject({ ok: true });
    expect(await kept()).toMatchObject({ modules: ["bookings"] });
    expect((await getStore(store.slug))!.bookingsOn).toBe(true);
    expect(await features.setFeature(await owner(), "boxes", true)).toMatchObject({ ok: true });
    expect((await kept()).modules).toEqual(["bookings", "deliveries"]);
    expect(await features.setFeature(await owner(), "shop", false, { confirmed: true })).toMatchObject({ ok: true });
    expect(await kept()).toEqual({ features: ["appointments", "boxes"], modules: [] });
    expect((await getStore(store.slug))!).toMatchObject({ bookingsOn: false, deliveriesOn: false });
    expect(await features.setFeature(await owner(), "shop", true)).toMatchObject({ ok: true });
    expect((await kept()).modules).toEqual(["bookings", "deliveries"]);
    // The old switch still works, and moves the features.
    await bookings.setBookingsModule(await owner(), { enabled: false, timeZone: "Europe/Oslo", reminderHours: 24 });
    expect(await kept()).toEqual({ features: ["boxes", "shop"], modules: ["deliveries"] });
    expect(await features.setFeature(await owner(), "boxes", false, { confirmed: true })).toMatchObject({ ok: true });
    expect(await kept()).toEqual({ features: ["shop"], modules: [] });
  });

  it("refuses switching appointments off while one is still to come", async () => {
    expect(await features.setFeature(await owner(), "appointments", true)).toMatchObject({ ok: true });
    const facts = { ...(await features.featureFacts(store.id)), futureAppointments: 2 };
    const { featureBlockers } = await import("@/lib/store-features");
    expect(featureBlockers("appointments", facts)).toEqual([expect.objectContaining({ path: "/bookings" })]);
    expect(await features.setFeature(await owner(), "appointments", false, { confirmed: true })).toMatchObject({ ok: true });
  });

  it("saves the time zone and reminder without touching the switches", async () => {
    await bookings.saveBookingSettings(await owner(), { timeZone: "Europe/Stockholm", reminderHours: 48 });
    const [row] = await db().execute<Row>(sql`select time_zone, booking_reminder_hours, features from commerce.stores where id = ${store.id}::uuid`);
    expect(row).toEqual({ time_zone: "Europe/Stockholm", booking_reminder_hours: 48, features: ["shop"] });
    expect(await auditRows(store.id, "bookings.settings")).toHaveLength(1);
  });
});
