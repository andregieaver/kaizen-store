import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { BONUS_DEFAULTS } from "@/lib/bonus";
import { AFFILIATE_DEFAULTS } from "@/lib/affiliates";

import { makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
// 'use cache' needs Next's cache outside a request: run the functions as they are.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

const features = await import("./store-features");
const { getStore } = await import("./stores");
const { listProducts, getProduct } = await import("./catalog");
const { listIndexedProducts } = await import("./seo");
const { resolveFeatureShop } = await import("./shop");
const { getBuyer } = await import("./b2b");
const { memberDiscountFor } = await import("./customer-tiers");
const { siteCookies } = await import("./site-cookies");
const bonus = await import("./bonus");
const affiliates = await import("./affiliates");

type Row = Record<string, unknown>;

/**
 * Store features, step 2 (D178, docs/store-features.md): the Customers group. With Sell to businesses off the store sells to consumers
 * (its own choice kept), business-only products leave the storefront, company discounts stop and the business cookie is not the site's;
 * with the bonus program off nothing is used, earned or expired, and its pages and changes are refused; with the referral program off no
 * link is captured and no change is taken. Switching each back on brings everything back. Money is held in `checkout-kinds.int.test.ts`.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const owner = () => membershipOf(store.slug, store.account, "owner");
const switchFeature = async (id: "business" | "bonus" | "referrals", on: boolean) => {
  const result = await features.setFeature(await owner(), id, on, { confirmed: true });
  expect(result, `${id} ${on ? "on" : "off"}`).toMatchObject({ ok: true });
};
const handles = async () => {
  const s = (await getStore(store.slug))!;
  return (await listProducts(s.id, s.markets[0])).map((p) => p.handle);
};

beforeAll(async () => {
  store = await makeStore("customers");
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${store.id}::uuid`);
});
afterAll(async () => {
  await closeDb();
});

describe("selling to businesses (D178)", () => {
  it("is the owner's choice only while the feature is on: off, the store sells to consumers and keeps the choice", async () => {
    await switchFeature("business", true);
    await db().execute(sql`update commerce.stores set audience = 'both', business_popup = true where id = ${store.id}::uuid`);
    expect(await getStore(store.slug)).toMatchObject({ audience: "both", chosenAudience: "both", businessPopup: true });
    await switchFeature("business", false);
    const off = (await getStore(store.slug))!;
    expect(off).toMatchObject({ audience: "consumers", chosenAudience: "both", businessPopup: false });
    expect(await getBuyer(off)).toBe("private");
    // Changing who it sells to is refused while it is off.
    const { saveStoreAudience } = await import("./b2b");
    expect(await saveStoreAudience(await owner(), { audience: "businesses", businessPopup: false })).toMatchObject({ ok: false });
    await switchFeature("business", true);
    expect(await getStore(store.slug)).toMatchObject({ audience: "both", chosenAudience: "both" });
  });

  it("takes business-only products out of the storefront while it is off, and brings them back", async () => {
    await db().execute(sql`update commerce.products set audience = 'businesses' where store_id = ${store.id}::uuid and handle = 'demo-notatbok'`);
    try {
      const s = (await getStore(store.slug))!;
      const market = s.markets[0];
      expect(await handles()).toContain("demo-notatbok");
      expect(await getProduct(s.id, market, "demo-notatbok")).not.toBeNull();

      await switchFeature("business", false);
      expect(await handles()).not.toContain("demo-notatbok");
      expect(await getProduct(s.id, market, "demo-notatbok")).toBeNull();
      expect((await listIndexedProducts(s.id)).map((p) => p.handle)).not.toContain("demo-notatbok");

      // The same where the owner simply chose consumers, the feature on: no business-only product is offered then either.
      await switchFeature("business", true);
      await db().execute(sql`update commerce.stores set audience = 'consumers' where id = ${store.id}::uuid`);
      expect(await handles()).not.toContain("demo-notatbok");
      await db().execute(sql`update commerce.stores set audience = 'both' where id = ${store.id}::uuid`);
      expect(await handles()).toContain("demo-notatbok");
    } finally {
      await db().execute(sql`update commerce.products set audience = 'all' where store_id = ${store.id}::uuid and handle = 'demo-notatbok'`);
    }
  });

  it("stops a company's discount while it is off; a customer's own group keeps theirs", async () => {
    const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${store.id}::uuid, 'Group', 10) returning id`);
    const [company] = await db().execute<Row>(sql`
      insert into commerce.customer_companies (store_id, name, tier_id, employee_share_percent) values (${store.id}::uuid, 'Acme AS', ${String(tier.id)}::uuid, 100) returning id
    `);
    const [employee] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, company_id, company_role) values (${store.id}::uuid, ${`emp-${run}@example.com`}, ${String(company.id)}::uuid, 'employee') returning id
    `);
    const [member] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, tier_id) values (${store.id}::uuid, ${`grp-${run}@example.com`}, ${String(tier.id)}::uuid) returning id
    `);
    expect(await memberDiscountFor(db(), store.id, String(employee.id))).toMatchObject({ percent: 10 });
    await switchFeature("business", false);
    expect(await memberDiscountFor(db(), store.id, String(employee.id))).toBeNull();
    expect(await memberDiscountFor(db(), store.id, String(member.id))).toMatchObject({ percent: 10 });
    await switchFeature("business", true);
    expect(await memberDiscountFor(db(), store.id, String(employee.id))).toMatchObject({ percent: 10 });
  });

  it("answers its storefront routes as missing while it is off", async () => {
    const s = (await getStore(store.slug))!;
    expect(await resolveFeatureShop(store.slug, s.markets[0].slug, "business")).not.toBeNull();
    await switchFeature("business", false);
    expect(await resolveFeatureShop(store.slug, s.markets[0].slug, "business")).toBeNull();
    await switchFeature("business", true);
  });

  it("lists the business cookie only while it is on, even when a scan found it", async () => {
    await db().execute(sql`
      insert into commerce.cookie_scans (store_id, status, finished_at, items)
      values (${store.id}::uuid, 'done', now(), ${JSON.stringify([{ kind: "cookie", name: `buyer_${store.id}`, domain: "localhost", thirdParty: false, days: 365, beforeConsent: true, page: "/" }])}::jsonb)
    `);
    // Declared by the store selling to both, and found by the scan: both ways it is gone while the feature is off.
    const names = async () => [
      ...(await siteCookies(store.id, {}, {}, { buyers: true })).cookies.map((c) => c.name),
      ...(await siteCookies(store.id, {})).cookies.map((c) => c.name),
    ];
    expect(await names()).toContain("buyer_…");
    await switchFeature("business", false);
    expect(await names()).not.toContain("buyer_…");
    await switchFeature("business", true);
  });
});

describe("the bonus program (D178)", () => {
  it("is refused while its feature is off: settings and adjustments, and the program does not work", async () => {
    const account = store.account;
    expect(await bonus.saveBonusSettings(account, store.id, { ...BONUS_DEFAULTS, enabled: true })).toEqual({
      ok: false,
      problems: [bonus.BONUS_FEATURE_OFF],
    });
    await switchFeature("bonus", true);
    expect(await bonus.saveBonusSettings(account, store.id, { ...BONUS_DEFAULTS, enabled: true, expiresMonths: 12 })).toEqual({ ok: true });
    expect((await bonus.bonusProgram(db(), store.id)).on).toBe(true);
    await switchFeature("bonus", false);
    const program = await bonus.bonusProgram(db(), store.id);
    // Its own switch is kept; the program does not work.
    expect(program).toMatchObject({ on: false, featureOn: false, settings: { enabled: true } });
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${store.id}::uuid, ${`adj-${run}@example.com`}) returning id`);
    expect(await bonus.adjustBonus(account, store.id, String(customer.id), 1000, "goodwill")).toEqual({ ok: false, problems: [bonus.BONUS_FEATURE_OFF] });
    await switchFeature("bonus", true);
  });

  it("expires nothing and reminds nobody while it is off, and moves the dates that passed when it comes back on", async () => {
    await switchFeature("bonus", true);
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${store.id}::uuid, ${`exp-${run}@example.com`}) returning id`);
    const id = String(customer.id);
    // Usable now, expiring in three days: a reminder is due.
    await db().execute(sql`
      select commerce.bonus_grant(${store.id}::uuid, ${id}::uuid, 'adjust', 4000, null, null, now() - interval '1 day', now() + interval '3 days', 'test', null, ${`exp-${id}`})
    `);
    expect((await bonus.expiringReminders()).some((r) => r.customerId === id)).toBe(true);

    await switchFeature("bonus", false);
    expect((await bonus.expiringReminders()).some((r) => r.customerId === id)).toBe(false);
    // Ten days pass while it is off: the date passes, nothing is written off.
    await db().execute(sql`update commerce.bonus_settings set paused_at = paused_at - interval '10 days' where store_id = ${store.id}::uuid`);
    await db().execute(sql`alter table commerce.bonus_entries disable trigger bonus_entries_immutable`);
    await db().execute(sql`update commerce.bonus_entries set expires_at = expires_at - interval '10 days' where customer_id = ${id}::uuid`);
    await db().execute(sql`alter table commerce.bonus_entries enable trigger bonus_entries_immutable`);
    await bonus.runBonusJobs();
    expect((await db().execute<Row>(sql`select 1 from commerce.bonus_entries where customer_id = ${id}::uuid and kind = 'expire'`)).length).toBe(0);

    // On again: the credits are back with the three days they had left.
    await switchFeature("bonus", true);
    await bonus.runBonusJobs();
    const { balance } = await bonus.customerBonus(store.id, id);
    expect(balance.availableMinor).toBe(4000);
    const days = (new Date(balance.expiringSoon!.at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
    // The move is not counted as expired credits.
    expect((await bonus.bonusOverview(store.id)).expired30dMinor).toBe(0);
  });
});

describe("the referral program (D178)", () => {
  it("captures no link and takes no change while its feature is off", async () => {
    await switchFeature("bonus", true);
    await switchFeature("referrals", true);
    expect(await affiliates.saveAffiliateSettings(store.account, store.id, { ...AFFILIATE_DEFAULTS, enabled: true })).toEqual({ ok: true });
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${store.id}::uuid, ${`ref-${run}@example.com`}) returning id`);
    const link = await affiliates.ensureAffiliate(store.id, String(customer.id));
    expect(link).not.toBeNull();
    expect((await affiliates.affiliateSite(store.id)).on).toBe(true);
    expect(await affiliates.validAffiliateCode(db(), store.id, link!.code)).toBe(link!.code);

    await switchFeature("referrals", false);
    expect((await affiliates.affiliateSite(store.id)).on).toBe(false);
    expect(await affiliates.validAffiliateCode(db(), store.id, link!.code)).toBeNull();
    expect(await affiliates.captureAffiliate(store.id, link!.code)).toBe(false);
    expect(await affiliates.saveAffiliateSettings(store.account, store.id, { ...AFFILIATE_DEFAULTS, enabled: true })).toMatchObject({ ok: false });

    // Kept on, but asleep with the bonus program: the same.
    await switchFeature("referrals", true);
    await switchFeature("bonus", false);
    expect((await affiliates.affiliateSite(store.id)).on).toBe(false);
    await switchFeature("bonus", true);
    expect((await affiliates.affiliateSite(store.id)).on).toBe(true);
    // The cookie is declared only while the program works.
    const names = async () => (await siteCookies(store.id, {})).cookies.map((c) => c.name);
    expect(await names()).toContain("kaizen_aff_…");
    await switchFeature("referrals", false);
    expect(await names()).not.toContain("kaizen_aff_…");
  });
});
