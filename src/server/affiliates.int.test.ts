import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { AFFILIATE_DEFAULTS } from "@/lib/affiliates";
import { toMarket } from "@/lib/markets";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined, cacheTag: () => undefined }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const {
  affiliateOverview,
  attachReferral,
  captureAffiliate,
  customerAffiliate,
  ensureAffiliate,
  getAffiliateSettings,
  listAffiliates,
  listAttributions,
  orderAttribution,
  rememberAffiliate,
  saveAffiliateSettings,
  setAffiliateBlocked,
  shopperReferrals,
  validAffiliateCode,
} = await import("./affiliates");
const { runAffiliateJobs, sendReferrerRewardEmail } = await import("./affiliate-emails");
const { deleteCustomer } = await import("./customers");
const { saveBonusSettings } = await import("./bonus");
const { BONUS_DEFAULTS } = await import("@/lib/bonus");

/**
 * The store's affiliate program on a real database (D131): its settings and who may change them, a customer's own code, the
 * visit and the code a visitor arrives with (kept on the cart, from memory or a consented cookie), registering as a friend,
 * what the shopper's page and the owner's pages read, blocking, and the email to a referrer. What checkout does with the
 * welcome discount is held in `checkout-kinds.int.test.ts`; the rules themselves in `src/db/affiliates.test.ts`.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let owner: Account;
let admin: Account;
let stranger: Account;
const shop = () => ({ storeId, market: no });
let counter = 0;

const account = async (role: "owner" | "admin" | null, label: string): Promise<Account> => {
  const email = `${label}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, ${label}) returning id`);
  const id = String(row.id);
  if (role) await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}::uuid, ${id}::uuid, ${role})`);
  return { id, email, name: label, platformAdmin: false };
};

const customer = async (label: string, over: { optedOut?: boolean; name?: string } = {}) => {
  counter += 1;
  const email = `${label}${counter}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${email}, ${over.name ?? label}) returning id`);
  if (over.optedOut) await db().execute(sql`insert into commerce.email_opt_outs (store_id, email, source) values (${storeId}::uuid, ${email}, 'unsubscribe')`);
  return { id: String(row.id), email };
};

const programs = async (over: { affiliate?: boolean; bonus?: boolean; bps?: number; orders?: number | null; percent?: number; cap?: number | null; pendingDays?: number } = {}) => {
  await db().execute(sql`
    insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, currency)
    values (${storeId}::uuid, ${over.bonus ?? true}, 500, ${over.pendingDays ?? 14}, 50, 'NOK')
    on conflict (store_id) do update set enabled = excluded.enabled, pending_days = excluded.pending_days
  `);
  await db().execute(sql`
    insert into commerce.affiliate_settings (store_id, enabled, reward_bps, reward_orders, friend_percent, monthly_cap_minor)
    values (${storeId}::uuid, ${over.affiliate ?? true}, ${over.bps ?? 500}, ${over.orders === undefined ? 1 : over.orders}, ${over.percent ?? 10}, ${over.cap ?? null})
    on conflict (store_id) do update set enabled = excluded.enabled, reward_bps = excluded.reward_bps, reward_orders = excluded.reward_orders,
      friend_percent = excluded.friend_percent, monthly_cap_minor = excluded.monthly_cap_minor
  `);
};

/** An order waiting for payment for a customer, with goods of `goods`, in NOK. */
async function order(customerId: string | null, goods: number, email?: string) {
  counter += 1;
  const who = customerId ? (await db().execute<Row>(sql`select email from commerce.customers where id = ${customerId}::uuid`))[0].email : `guest${counter}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${`AI-${run}-${counter}`}, 'NO', 'NOK', 'nb-NO', ${email ?? String(who)}, ${customerId}::uuid, ${goods}, 0, 0, 0, ${goods}, '{}'::jsonb, '{}'::jsonb) returning id
  `);
  const id = String(row.id);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, venue_minor, delivery)
    values (${storeId}::uuid, ${id}::uuid, 'SIGNUP-FEE', 'Thing', 1, ${goods}, ${goods}, 0, 0.25, 'txcd_99999999', 0, 'digital')
  `);
  return id;
}
const attribute = async (orderId: string, code: string | null, discount = 0) =>
  String((await db().execute<Row>(sql`select commerce.affiliate_attribute_order(${orderId}::uuid, ${code}, ${discount}) as v`))[0].v);
const pay = (orderId: string) => db().execute(sql`select commerce.complete_order_payment(${orderId}::uuid, 'cs')`);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`aff-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`aff-${run}`}, 'Affiliate test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
  await db().execute(sql`insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1) on conflict do nothing`);
  owner = await account("owner", "owner");
  admin = await account("admin", "admin");
  stranger = await account(null, "stranger");
});

afterAll(async () => {
  await closeDb();
});

describe("the program's settings", () => {
  it("starts off, with the defaults, for a store that has never chosen", async () => {
    const s = await getAffiliateSettings(storeId);
    expect(s).toMatchObject({ ...AFFILIATE_DEFAULTS, bonusOn: false, currency: "NOK" });
    expect(AFFILIATE_DEFAULTS.enabled).toBe(false);
  });

  it("cannot be switched on while the bonus program is off, and says why", async () => {
    const refused = await saveAffiliateSettings(owner, storeId, { ...AFFILIATE_DEFAULTS, enabled: true });
    expect(refused).toMatchObject({ ok: false, problems: [expect.stringContaining("Turn on the bonus program first")] });
    expect((await getAffiliateSettings(storeId)).enabled).toBe(false);
    // Switching it off is always possible.
    expect(await saveAffiliateSettings(owner, storeId, { ...AFFILIATE_DEFAULTS, enabled: false })).toEqual({ ok: true });
  });

  it("is saved by an owner, checked against the program's limits, and written to the audit log", async () => {
    expect(await saveBonusSettings(owner, storeId, { ...BONUS_DEFAULTS, enabled: true })).toEqual({ ok: true });
    const settings = { enabled: true, rewardBps: 750, rewardOrders: 2, friendPercent: 15, friendMaxMinor: 20_000, monthlyCapMinor: 100_000, cookieDays: 45 };
    expect(await saveAffiliateSettings(owner, storeId, settings)).toEqual({ ok: true });
    expect(await getAffiliateSettings(storeId)).toMatchObject({ ...settings, bonusOn: true });
    const [audit] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.affiliate_settings' order by created_at desc limit 1`);
    expect((audit.details as { after: unknown }).after).toEqual(settings);
    for (const bad of [{ rewardBps: 5_001 }, { friendPercent: 51 }, { cookieDays: 91 }, { cookieDays: 0 }, { rewardOrders: 0 }, { friendMaxMinor: -1 }]) {
      expect((await saveAffiliateSettings(owner, storeId, { ...settings, ...bad })).ok, JSON.stringify(bad)).toBe(false);
    }
    expect((await getAffiliateSettings(storeId)).rewardBps).toBe(750);
  });

  it("is an owner's to change: an admin, or someone outside the store, is refused", async () => {
    const settings = { ...AFFILIATE_DEFAULTS, enabled: true, rewardBps: 100 };
    expect(await saveAffiliateSettings(admin, storeId, settings)).toMatchObject({ ok: false, problems: ["Only an owner can change the referral program."] });
    expect(await saveAffiliateSettings(stranger, storeId, settings)).toMatchObject({ ok: false });
    expect((await getAffiliateSettings(storeId)).rewardBps).toBe(750);
  });

  it("is on only while both programs are", async () => {
    const { affiliateProgram } = await import("./affiliates");
    expect((await affiliateProgram(db(), storeId)).on).toBe(true);
    await db().execute(sql`update commerce.bonus_settings set enabled = false where store_id = ${storeId}::uuid`);
    expect((await affiliateProgram(db(), storeId)).on).toBe(false);
    await programs();
  });
});

describe("a customer's code", () => {
  it("is made the first time, kept after, and one per customer", async () => {
    await programs();
    const c = await customer("mine");
    const first = await ensureAffiliate(storeId, c.id);
    expect(first).toMatchObject({ code: expect.stringMatching(/^[a-z0-9]{6,16}$/), blocked: false });
    expect(await ensureAffiliate(storeId, c.id)).toEqual(first);
    const other = await customer("other");
    expect((await ensureAffiliate(storeId, other.id))?.code).not.toBe(first!.code);
    expect(await validAffiliateCode(db(), storeId, first!.code.toUpperCase())).toBe(first!.code);
  });

  it("is not made while the program is off, and a blocked customer keeps theirs but it counts for nothing", async () => {
    const c = await customer("later");
    await programs({ affiliate: false });
    expect(await ensureAffiliate(storeId, c.id)).toBeNull();
    await programs();
    const made = (await ensureAffiliate(storeId, c.id))!;
    await db().execute(sql`update commerce.affiliates set blocked_at = now() where customer_id = ${c.id}::uuid`);
    expect(await ensureAffiliate(storeId, c.id)).toEqual({ code: made.code, blocked: true });
    expect(await validAffiliateCode(db(), storeId, made.code)).toBeNull();
    expect(await ensureAffiliate(storeId, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("the link a visitor opens", () => {
  it("counts a live code's visits for the day and leaves no trace for any other", async () => {
    await programs();
    const a = (await ensureAffiliate(storeId, (await customer("visited")).id))!;
    expect(await captureAffiliate(storeId, a.code)).toBe(true);
    expect(await captureAffiliate(storeId, a.code.toUpperCase())).toBe(true);
    expect(await captureAffiliate(storeId, "nope")).toBe(false);
    expect(await captureAffiliate(storeId, "madeup234")).toBe(false);
    expect(await captureAffiliate(storeId, undefined)).toBe(false);
    const [row] = await db().execute<Row>(sql`select sum(visits)::int as n, count(*)::int as days from commerce.referral_visits where store_id = ${storeId}::uuid and code = ${a.code}`);
    expect(row).toMatchObject({ n: 2, days: 1 });
    expect(Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.referral_visits where code = 'madeup234'`))[0].n)).toBe(0);
  });

  it("keeps a valid code on the open cart, the last one wins, and ignores what is not one", async () => {
    await programs();
    const a = (await ensureAffiliate(storeId, (await customer("first")).id))!;
    const b = (await ensureAffiliate(storeId, (await customer("second")).id))!;
    const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
    const cartId = String(cart.id);
    const kept = async () => (await db().execute<Row>(sql`select affiliate_code from commerce.carts where id = ${cartId}::uuid`))[0].affiliate_code;
    await rememberAffiliate(shop(), cartId, "madeup234");
    expect(await kept()).toBeNull();
    await rememberAffiliate(shop(), cartId, a.code);
    expect(await kept()).toBe(a.code);
    await rememberAffiliate(shop(), cartId, b.code);
    expect(await kept()).toBe(b.code);
    await rememberAffiliate(shop(), cartId, "nonsense!");
    expect(await kept()).toBe(b.code);
    // A blocked referrer's code is not kept.
    await db().execute(sql`update commerce.affiliates set blocked_at = now() where code = ${a.code}`);
    await db().execute(sql`update commerce.carts set affiliate_code = null where id = ${cartId}::uuid`);
    await rememberAffiliate(shop(), cartId, a.code);
    expect(await kept()).toBeNull();
    // The consented cookie stands in when the page held nothing; without one, nothing changes.
    await rememberAffiliate(shop(), cartId);
    expect(await kept()).toBeNull();
    jar.set(`kaizen_aff_${storeId}`, b.code);
    await rememberAffiliate(shop(), cartId);
    expect(await kept()).toBe(b.code);
    jar.clear();
  });

  it("keeps nothing while the program is off", async () => {
    await programs();
    const a = (await ensureAffiliate(storeId, (await customer("quiet")).id))!;
    await programs({ affiliate: false });
    const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
    await rememberAffiliate(shop(), String(cart.id), a.code);
    expect((await db().execute<Row>(sql`select affiliate_code from commerce.carts where id = ${String(cart.id)}::uuid`))[0].affiliate_code).toBeNull();
    expect(await captureAffiliate(storeId, a.code)).toBe(false);
    await programs();
  });
});

describe("registering as a friend", () => {
  it("ties a new customer to the referrer whose code they carried, from the page or the cookie", async () => {
    await programs();
    const a = (await ensureAffiliate(storeId, (await customer("inviter")).id))!;
    const friend = await customer("newcomer");
    expect(await attachReferral(storeId, friend.id, a.code)).toBe(true);
    const referredBy = async (id: string) => (await db().execute<Row>(sql`select referred_by_customer_id as r from commerce.customers where id = ${id}::uuid`))[0].r;
    expect(await referredBy(friend.id)).toBe((await db().execute<Row>(sql`select customer_id from commerce.affiliates where code = ${a.code}`))[0].customer_id);
    // Once: a second code does not move them.
    const b = (await ensureAffiliate(storeId, (await customer("other2")).id))!;
    expect(await attachReferral(storeId, friend.id, b.code)).toBe(false);
    const viaCookie = await customer("cookie");
    jar.set(`kaizen_aff_${storeId}`, a.code);
    expect(await attachReferral(storeId, viaCookie.id)).toBe(true);
    jar.clear();
    expect(await referredBy(viaCookie.id)).not.toBeNull();
  });

  it("ties a friend who declined marketing cookies and whose page memory was lost on the way to the cart, by the code on their open cart", async () => {
    await programs();
    const a = (await ensureAffiliate(storeId, (await customer("inviter-nocookie")).id))!;
    const friend = await customer("nocookie-friend");
    const referredBy = async (id: string) => (await db().execute<Row>(sql`select referred_by_customer_id as r from commerce.customers where id = ${id}::uuid`))[0].r;
    // Adding to the cart put the code on the cart (from the page's memory); no kaizen_aff cookie was ever written.
    const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at, affiliate_code) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', ${a.code}) returning id`);
    jar.clear();
    // Nothing on the form (the memory is gone after the pay page's reload) and no cookie, no cart cookie: not tied.
    expect(await attachReferral(storeId, friend.id, null)).toBe(false);
    jar.set(`cart_${storeId}_NO`, String(cart.id));
    expect(await attachReferral(storeId, friend.id, null)).toBe(true);
    jar.clear();
    expect(await referredBy(friend.id)).not.toBeNull();
    // A cart that carries no code ties nobody.
    const other = await customer("nocookie-other");
    const [bare] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
    jar.set(`cart_${storeId}_NO`, String(bare.id));
    expect(await attachReferral(storeId, other.id, null)).toBe(false);
    jar.clear();
  });

  it("never ties an old account, one that has ordered, oneself, a blocked referrer's friend, or a code that is not one", async () => {
    await programs();
    const inviterCustomer = await customer("inviter2");
    const a = (await ensureAffiliate(storeId, inviterCustomer.id))!;
    const old = await customer("old");
    await db().execute(sql`update commerce.customers set created_at = now() - interval '2 hours' where id = ${old.id}::uuid`);
    expect(await attachReferral(storeId, old.id, a.code)).toBe(false);
    const bought = await customer("bought");
    await pay(await order(bought.id, 5_000));
    expect(await attachReferral(storeId, bought.id, a.code)).toBe(false);
    expect(await attachReferral(storeId, inviterCustomer.id, a.code)).toBe(false);
    const fresh = await customer("fresh");
    expect(await attachReferral(storeId, fresh.id, "madeup234")).toBe(false);
    expect(await attachReferral(storeId, fresh.id, null)).toBe(false);
    await db().execute(sql`update commerce.affiliates set blocked_at = now() where code = ${a.code}`);
    expect(await attachReferral(storeId, fresh.id, a.code)).toBe(false);
  });
});

describe("what the shopper's page shows", () => {
  it("makes the code on the first visit, counts visits, and lists friends by a first name at most, with what they earned", async () => {
    await programs({ bps: 1_000, pendingDays: 14 });
    const me = await customer("referrer", { name: "Rita Referrer" });
    const first = await shopperReferrals(shop(), me.id);
    expect(first).toMatchObject({ enabled: true, blocked: false, code: expect.stringMatching(/^[a-z0-9]{6,16}$/), visits: 0, friends: [], earnedMinor: 0, pendingMinor: 0, currency: "NOK", pendingDays: 14 });
    await captureAffiliate(storeId, first.code!);
    await captureAffiliate(storeId, first.code!);
    // A friend with a full name and an email buys: the referrer learns a first name, a date and a status, and what they earned.
    const friend = await customer("secretfriend", { name: "Fiona Friendly Secret" });
    const o = await order(friend.id, 10_000);
    await attribute(o, first.code, 1_000);
    const waiting = await shopperReferrals(shop(), me.id);
    expect(waiting.visits).toBe(2);
    expect(waiting.friends).toEqual([expect.objectContaining({ label: "Fiona", status: "pending", rewardMinor: 0 })]);
    await pay(o);
    const done = await shopperReferrals(shop(), me.id);
    expect(done.friends).toEqual([{ label: "Fiona", at: expect.any(String), status: "rewarded", rewardMinor: 1_000 }]);
    expect(done).toMatchObject({ earnedMinor: 0, pendingMinor: 1_000 });
    expect(JSON.stringify(done)).not.toContain(friend.email);
    expect(JSON.stringify(done)).not.toContain("Secret");
    expect(JSON.stringify(done)).not.toContain("AI-");
    // After the return period the credits are earned, not pending.
    await db().execute(sql`alter table commerce.bonus_entries disable trigger bonus_entries_immutable`);
    await db().execute(sql`update commerce.bonus_entries set available_at = now() - interval '1 day' where customer_id = ${me.id}::uuid`);
    await db().execute(sql`alter table commerce.bonus_entries enable trigger bonus_entries_immutable`);
    expect(await shopperReferrals(shop(), me.id)).toMatchObject({ earnedMinor: 1_000, pendingMinor: 0 });
    // Their own rejected attempt (their own order with their own link) is not shown.
    const own = await order(me.id, 5_000);
    expect(await attribute(own, first.code)).toBe("self");
    expect((await shopperReferrals(shop(), me.id)).friends).toHaveLength(1);
  });

  it("shows the owner's amounts and the credits in the market's currency, and nothing while the program is off", async () => {
    await programs();
    await db().execute(sql`update commerce.affiliate_settings set friend_max_minor = 11_500, monthly_cap_minor = 115_000 where store_id = ${storeId}::uuid`);
    const me = await customer("eur");
    const inEuro = { storeId, market: { ...no, currency: "EUR", locale: "en-IE", slug: "no-eur" } as typeof no };
    const page = await shopperReferrals(inEuro, me.id);
    // 115 NOK is 10 EUR; 1 150 NOK is 100 EUR.
    expect(page.currency).toBe("EUR");
    expect(page.settings).toMatchObject({ friendMaxMinor: 1_000, monthlyCapMinor: 10_000 });
    await db().execute(sql`update commerce.affiliate_settings set friend_max_minor = null, monthly_cap_minor = null where store_id = ${storeId}::uuid`);
    await programs({ affiliate: false });
    expect(await shopperReferrals(shop(), me.id)).toMatchObject({ enabled: false, code: null });
    await programs();
  });
});

describe("what the owner reads and does", () => {
  it("lists referrers with their friends and earnings, the orders through links with the reason a guard stopped a reward, and the overview", async () => {
    await programs({ bps: 1_000, pendingDays: 14 });
    const refCustomer = await customer("listed", { name: "Lisa Listed" });
    const a = (await ensureAffiliate(storeId, refCustomer.id))!;
    const friend = await customer("buyer", { name: "Bob Buyer" });
    const o = await order(friend.id, 10_000);
    await attribute(o, a.code, 1_000);
    await pay(o);
    const self = await order(refCustomer.id, 5_000);
    await attribute(self, a.code);
    const rows = await listAffiliates(storeId);
    const mine = rows.find((r) => r.customerId === refCustomer.id)!;
    expect(mine).toMatchObject({ name: "Lisa Listed", email: refCustomer.email, code: a.code, blocked: false, friends: 1, earnedMinor: 1_000 });
    const attributions = await listAttributions(storeId);
    expect(attributions.find((r) => r.orderId === o)).toMatchObject({ orderNumber: expect.stringContaining("AI-"), friendName: "Bob Buyer", friendEmail: friend.email, affiliateName: "Lisa Listed", status: "rewarded", reason: null, discountMinor: 1_000, rewardMinor: 1_000, creditsCurrency: "NOK", orderCurrency: "NOK" });
    expect(attributions.find((r) => r.orderId === self)).toMatchObject({ status: "rejected", reason: "self", rewardMinor: 0 });
    expect(await orderAttribution(storeId, o)).toMatchObject({ code: a.code, status: "rewarded" });
    expect(await orderAttribution(storeId, await order(friend.id, 100))).toBeNull();
    const overview = await affiliateOverview(storeId);
    expect(overview.currency).toBe("NOK");
    expect(overview.affiliates).toBeGreaterThanOrEqual(1);
    expect(overview.orders30d).toBeGreaterThanOrEqual(1);
    expect(overview.rewarded30dMinor).toBeGreaterThanOrEqual(1_000);
    expect(overview.pendingMinor).toBeGreaterThanOrEqual(1_000);
    expect(overview.rejected30d).toBeGreaterThanOrEqual(1);
    // A customer's own page: their link, and who referred them.
    expect(await customerAffiliate(storeId, refCustomer.id)).toMatchObject({ code: a.code, friends: 1, earnedMinor: 1_000, currency: "NOK", referredBy: null });
    const theirs = await customerAffiliate(storeId, friend.id);
    expect(theirs).toMatchObject({ code: null, referredBy: { customerId: refCustomer.id, name: "Lisa Listed", email: refCustomer.email, code: a.code } });
    expect(theirs.attributions).toHaveLength(1);
  });

  it("blocks a referrer with a reason, stops their rewards, and lets them earn again, for owners and admins, audited", async () => {
    await programs({ bps: 1_000, pendingDays: 0 });
    const c = await customer("abuser");
    const a = (await ensureAffiliate(storeId, c.id))!;
    // Needs a reason of 3 to 200 characters, and a link to block.
    expect(await setAffiliateBlocked(admin, storeId, c.id, true, "")).toMatchObject({ ok: false });
    expect(await setAffiliateBlocked(admin, storeId, c.id, true, "x".repeat(201))).toMatchObject({ ok: false });
    expect(await setAffiliateBlocked(stranger, storeId, c.id, true, "not allowed")).toMatchObject({ ok: false, problems: ["You do not have access to this store."] });
    const nobody = await customer("linkless");
    expect(await setAffiliateBlocked(admin, storeId, nobody.id, true, "no link")).toMatchObject({ ok: false, problems: ["This customer has no referral link."] });
    expect(await setAffiliateBlocked(admin, storeId, c.id, true, "referred themselves")).toEqual({ ok: true });
    expect(await ensureAffiliate(storeId, c.id)).toEqual({ code: a.code, blocked: true });
    expect(await customerAffiliate(storeId, c.id)).toMatchObject({ blocked: true, blockedReason: "referred themselves" });
    expect((await listAffiliates(storeId)).find((r) => r.customerId === c.id)?.blocked).toBe(true);
    // A friend's order placed and paid while blocked earns nothing.
    const friend = await customer("unlucky");
    const o = await order(friend.id, 10_000);
    expect(await attribute(o, a.code)).toBe("blocked");
    await pay(o);
    expect((await orderAttribution(storeId, o))).toMatchObject({ status: "rejected", reason: "blocked", rewardMinor: 0 });
    const [audit] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'customer.affiliate_blocked' order by created_at desc limit 1`);
    expect(audit.details).toEqual({ customerId: c.id, note: "referred themselves" });
    // Unblocked: earning again.
    expect(await setAffiliateBlocked(owner, storeId, c.id, false, "")).toEqual({ ok: true });
    expect(await ensureAffiliate(storeId, c.id)).toEqual({ code: a.code, blocked: false });
    const friend2 = await customer("lucky");
    const o2 = await order(friend2.id, 10_000);
    await attribute(o2, a.code);
    await pay(o2);
    expect(await orderAttribution(storeId, o2)).toMatchObject({ status: "rewarded", rewardMinor: 1_000 });
    // Doing it again changes nothing and says nothing wrong.
    expect(await setAffiliateBlocked(owner, storeId, c.id, false, "")).toEqual({ ok: true });
  });
});

describe("deleting a customer", () => {
  it("lets a referrer's friends and a friend's orders go free, and removes a referrer's link with them", async () => {
    await programs({ pendingDays: 0 });
    const refCustomer = await customer("leaving");
    const a = (await ensureAffiliate(storeId, refCustomer.id))!;
    const friend = await customer("stays");
    const o = await order(friend.id, 10_000);
    await attribute(o, a.code);
    await pay(o);
    expect((await db().execute<Row>(sql`select referred_by_customer_id as r from commerce.customers where id = ${friend.id}::uuid`))[0].r).toBe(refCustomer.id);
    await deleteCustomer(storeId, refCustomer.id);
    expect((await db().execute<Row>(sql`select referred_by_customer_id as r from commerce.customers where id = ${friend.id}::uuid`))[0].r).toBeNull();
    expect(await orderAttribution(storeId, o)).toBeNull();
    // A friend going away leaves the row, without them.
    const b = (await ensureAffiliate(storeId, (await customer("stayer")).id))!;
    const leaver = await customer("leaver");
    const o2 = await order(leaver.id, 10_000);
    await attribute(o2, b.code);
    await pay(o2);
    await deleteCustomer(storeId, leaver.id);
    expect(await orderAttribution(storeId, o2)).toMatchObject({ friendId: null, status: "rewarded" });
  });
});

describe("the email to a referrer", () => {
  const sent = async (orderId: string) => db().execute<Row>(sql`select to_address, subject, html, status from commerce.email_messages where store_id = ${storeId}::uuid and idempotency_key = ${`affiliate-reward:${orderId}`}`);

  it("goes once per order, says what they earned and from when, and never who the friend is", async () => {
    await programs({ bps: 1_000, pendingDays: 14 });
    const refCustomer = await customer("emailed", { name: "Ella Emailed" });
    const a = (await ensureAffiliate(storeId, refCustomer.id))!;
    const friend = await customer("privatefriend", { name: "Private Person" });
    const o = await order(friend.id, 10_000);
    await attribute(o, a.code, 1_000);
    // Nothing to say before the order is paid.
    expect(await sendReferrerRewardEmail(storeId, o)).toBeNull();
    await pay(o);
    expect(["sent", "logged"]).toContain(await sendReferrerRewardEmail(storeId, o));
    expect(await sendReferrerRewardEmail(storeId, o)).toBe("duplicate");
    const rows = await sent(o);
    expect(rows).toHaveLength(1);
    expect(rows[0].to_address).toBe(refCustomer.email);
    expect(String(rows[0].subject)).toContain("bonus");
    const html = String(rows[0].html);
    expect(html).toContain("10"); // the amount
    expect(html).toContain(`/account/referrals`);
    expect(html).not.toContain(friend.email);
    expect(html).not.toContain("Private");
    expect(html).not.toContain("AI-");
  });

  it("is not sent to someone who opted out, for an order that earned nothing, and is caught up by the job for paths that skip the confirmation", async () => {
    await programs({ bps: 1_000, pendingDays: 0 });
    const quiet = await customer("optedout", { optedOut: true });
    const q = (await ensureAffiliate(storeId, quiet.id))!;
    const o = await order((await customer("friend1")).id, 10_000);
    await attribute(o, q.code);
    await pay(o);
    expect(await sendReferrerRewardEmail(storeId, o)).toBeNull();
    // A rejected order has no reward to tell of.
    const refCustomer = await customer("norward");
    const n = (await ensureAffiliate(storeId, refCustomer.id))!;
    const own = await order(refCustomer.id, 10_000);
    await attribute(own, n.code);
    await pay(own);
    expect(await sendReferrerRewardEmail(storeId, own)).toBeNull();
    // The job sends for rewarded orders nobody has written to yet, once.
    const loud = await customer("jobbed");
    const l = (await ensureAffiliate(storeId, loud.id))!;
    const o3 = await order((await customer("friend3")).id, 10_000);
    await attribute(o3, l.code);
    await pay(o3);
    expect((await runAffiliateJobs()).emailed).toBeGreaterThanOrEqual(1);
    expect(await sent(o3)).toHaveLength(1);
    expect((await runAffiliateJobs()).emailed).toBe(0);
    expect(await sent(o)).toHaveLength(0);
  });
});
