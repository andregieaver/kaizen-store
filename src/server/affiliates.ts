import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { cookies } from "next/headers";

import { db, readDb } from "@/db/client";
import {
  AFFILIATE_DEFAULTS,
  affiliateCookie,
  affiliateSettingsInput,
  friendLabel,
  makeAffiliateCode,
  normalizeAffiliateCode,
  NO_CART_AFFILIATE,
  planWelcome,
  statusOf,
  type AffiliateAttributionRow,
  type AffiliateOverview,
  type AffiliateRejection,
  type AffiliateResult,
  type AffiliateRow,
  type AffiliateSettings,
  type AffiliateStatus,
  type AffiliateVerdict,
  type CartAffiliate,
  type CustomerAffiliate,
  type ShopperReferrals,
} from "@/lib/affiliates";
import { convertCredits } from "@/lib/bonus";
import type { Market } from "@/lib/markets";

import { audit, type Account } from "./auth";
import { bonusProgram, roleIn, type BonusProgram, type Runner } from "./bonus";
import { deviceCartIds, type Shop } from "./cart";

type Row = Record<string, unknown>;

/**
 * The affiliate program, store level (D131, `docs/affiliates.md`): a store's signed-in customers refer friends. The rules
 * are in SQL (`commerce.affiliate_*`: who is whose friend, the guards, the reward when an order is paid and its reversal
 * by refund or cancellation, through the bonus ledger); this module reads and drives them, keeps the code a visitor
 * arrives with on the cart, and works out the friend's welcome discount the same way for the cart page and for
 * `placeOrder()`.
 */

/** Revalidate when a store's program is switched on or off, or its settings change. */
export const affiliateTag = (storeId: string) => `affiliate:${storeId}`;

// ---------------------------------------------------------------------------
// The program: settings, and whether it is on (its own switch and the bonus program's)
// ---------------------------------------------------------------------------

export type AffiliateProgram = {
  settings: AffiliateSettings;
  /** The bonus program, whose credits are the reward and whose currency and rates convert amounts. */
  bonus: BonusProgram;
  /** The store feature `referrals` is on (D178; it needs the bonus feature and the shop). */
  featureOn: boolean;
  /** The feature and both programs' switches are on: the program works (`commerce.affiliate_program_on()`). */
  on: boolean;
};

const toSettings = (row: Row | undefined): AffiliateSettings =>
  row && row.enabled !== null && row.enabled !== undefined
    ? {
        enabled: Boolean(row.enabled),
        rewardBps: Number(row.reward_bps),
        rewardOrders: row.reward_orders === null ? null : Number(row.reward_orders),
        friendPercent: Number(row.friend_percent),
        friendMaxMinor: row.friend_max_minor === null ? null : Number(row.friend_max_minor),
        monthlyCapMinor: row.monthly_cap_minor === null ? null : Number(row.monthly_cap_minor),
        cookieDays: Number(row.cookie_days),
      }
    : { ...AFFILIATE_DEFAULTS };

/** The settings, the bonus program and whether both are on, in one read. */
export async function affiliateProgram(runner: Runner, storeId: string, known?: BonusProgram): Promise<AffiliateProgram> {
  const [row] = await runner.execute<Row>(sql`
    select a.enabled, a.reward_bps, a.reward_orders, a.friend_percent, a.friend_max_minor, a.monthly_cap_minor, a.cookie_days,
           commerce.feature_on(${storeId}::uuid, 'referrals') as feature_on
    from (select 1) one
    left join commerce.affiliate_settings a on a.store_id = ${storeId}::uuid
  `);
  const bonus = known ?? (await bonusProgram(runner, storeId));
  const settings = toSettings(row);
  const featureOn = Boolean(row?.feature_on);
  return { settings, bonus, featureOn, on: featureOn && settings.enabled && bonus.on };
}

/** The store's affiliate settings; the defaults, with the program off, when it has none. */
export async function getAffiliateSettings(storeId: string): Promise<AffiliateSettings & { bonusOn: boolean; currency: string }> {
  const program = await affiliateProgram(db(), storeId);
  return { ...program.settings, bonusOn: program.bonus.on, currency: program.bonus.currency };
}

/**
 * What the storefront's layouts need of the program: whether it works (the store features `referrals` and `bonus` with both programs'
 * switches, D178), and how long its cookie lasts. Cached until the program's or the bonus program's settings or the store's features
 * change (both actions call `updateTag(affiliateTag(storeId))`, and `refreshFeatureTags()` refreshes it).
 */
export async function affiliateSite(storeId: string): Promise<{ on: boolean; cookieDays: number; friendPercent: number }> {
  "use cache";
  cacheLife("hours");
  cacheTag(affiliateTag(storeId));
  const [row] = await readDb().execute<Row>(sql`
    select commerce.affiliate_program_on(${storeId}::uuid) as on, coalesce(a.cookie_days, 30) as cookie_days,
           coalesce(a.friend_percent, 0) as friend_percent
    from (select 1) one
    left join commerce.affiliate_settings a on a.store_id = ${storeId}::uuid
  `);
  return { on: Boolean(row?.on), cookieDays: Number(row?.cookie_days ?? 30), friendPercent: Number(row?.friend_percent ?? 0) };
}

/**
 * Saves the program's settings. Owners only. It cannot be switched on while the bonus program is off, because the
 * reward is bonus credits: the answer says so. What customers have earned is never changed by a setting. Audited.
 */
export async function saveAffiliateSettings(account: Account, storeId: string, raw: unknown): Promise<AffiliateResult> {
  if ((await roleIn(account.id, storeId)) !== "owner")
    return { ok: false, problems: ["Only an owner can change the referral program."] };
  const parsed = affiliateSettingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const s = parsed.data;
  if (!(await affiliateProgram(db(), storeId)).featureOn) {
    return { ok: false, problems: ["The referral program is switched off under Settings, Features. Switch it on there first."] };
  }
  const before = await getAffiliateSettings(storeId);
  if (s.enabled && !before.bonusOn) {
    return {
      ok: false,
      problems: ["Turn on the bonus program first: referrers are rewarded in bonus credits, so the referral program needs it."],
    };
  }
  await db().execute(sql`
    insert into commerce.affiliate_settings (
      store_id, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days, updated_by
    ) values (
      ${storeId}::uuid, ${s.enabled}, ${s.rewardBps}, ${s.rewardOrders}, ${s.friendPercent}, ${s.friendMaxMinor},
      ${s.monthlyCapMinor}, ${s.cookieDays}, ${account.id}::uuid
    )
    on conflict (store_id) do update set
      enabled = excluded.enabled, reward_bps = excluded.reward_bps, reward_orders = excluded.reward_orders,
      friend_percent = excluded.friend_percent, friend_max_minor = excluded.friend_max_minor,
      monthly_cap_minor = excluded.monthly_cap_minor, cookie_days = excluded.cookie_days,
      updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, storeId, "store.affiliate_settings", { before: { ...before, bonusOn: undefined, currency: undefined }, after: s });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// A customer's own code
// ---------------------------------------------------------------------------

/**
 * The customer's referral code in the store: made the first time, with no approval. Null while the program is not on.
 * A blocked customer keeps their code (and is told); nothing new is earned with it.
 */
export async function ensureAffiliate(storeId: string, customerId: string): Promise<{ code: string; blocked: boolean } | null> {
  const program = await affiliateProgram(db(), storeId);
  if (!program.on) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const [found] = await db().execute<Row>(sql`
      select code, blocked_at is not null as blocked from commerce.affiliates
      where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid
    `);
    if (found) return { code: String(found.code), blocked: Boolean(found.blocked) };
    // A code taken meanwhile by another customer, or the same customer twice at once, is tried again.
    await db().execute(sql`
      insert into commerce.affiliates (store_id, customer_id, code)
      select ${storeId}::uuid, c.id, ${makeAffiliateCode()}
      from commerce.customers c where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
      on conflict do nothing
    `);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The code a visitor arrives with
// ---------------------------------------------------------------------------

/** Whether `code` is a live affiliate's of the store (the program on, the affiliate not blocked). */
export async function validAffiliateCode(runner: Runner, storeId: string, code: string | null | undefined): Promise<string | null> {
  const clean = normalizeAffiliateCode(code ?? null);
  if (!clean) return null;
  const [row] = await runner.execute<Row>(sql`
    select a.code from commerce.affiliates a
    where a.store_id = ${storeId}::uuid and a.code = ${clean} and a.blocked_at is null
      and commerce.affiliate_program_on(${storeId}::uuid)
  `);
  return row ? String(row.code) : null;
}

/**
 * A visit to the store's link (D131): the code is checked, and a live one is counted for the day (a number, nothing
 * about the visitor). The answer says whether the code is one, so the browser keeps or drops it. Nothing is set.
 */
export async function captureAffiliate(storeId: string, code: string | null | undefined): Promise<boolean> {
  const clean = normalizeAffiliateCode(code ?? null);
  if (!clean) return false;
  const [row] = await db().execute<Row>(sql`select commerce.affiliate_count_visit(${storeId}::uuid, ${clean}) as counted`);
  return Boolean(row?.counted);
}

/** The store's referral cookie, which exists only if the visitor allowed it; null outside a request. */
async function cookieCode(storeId: string): Promise<string | null> {
  try {
    return normalizeAffiliateCode((await cookies()).get(affiliateCookie(storeId))?.value ?? null);
  } catch {
    return null;
  }
}

/**
 * The code on an open cart of this browser (its `cart_{store}_{market}` cookies), the newest first: what a friend who declined marketing
 * cookies still has once the page's memory is gone (a pay page loads afresh, `PayRouteGuard`), because adding to the cart put the code on
 * the cart. Null outside a request, for no cart or a cart with no code.
 */
async function deviceCartCode(storeId: string): Promise<string | null> {
  try {
    const ids = await deviceCartIds(storeId);
    if (ids.length === 0) return null;
    const [row] = await db().execute<Row>(sql`
      select affiliate_code from commerce.carts
      where store_id = ${storeId}::uuid and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and status = 'open' and affiliate_code is not null
      order by updated_at desc limit 1
    `);
    return row?.affiliate_code ? String(row.affiliate_code) : null;
  } catch {
    return null;
  }
}

/** The code a cart carries, else the consented cookie's: what the cart page counts on. */
export async function codeInPlay(runner: Runner, storeId: string, cartId: string | null): Promise<string | null> {
  if (cartId) {
    const [row] = await runner.execute<Row>(sql`
      select affiliate_code from commerce.carts where store_id = ${storeId}::uuid and id = ${cartId}::uuid
    `);
    if (row?.affiliate_code) return String(row.affiliate_code);
  }
  return cookieCode(storeId);
}

/**
 * Keeps the code on the open cart (last click wins): the one the page passed from memory, else the cookie's, checked
 * against the store's affiliates. Quietly nothing for a code that is not one. Never throws.
 */
export async function rememberAffiliate(shop: Shop, cartId: string, code?: string | null): Promise<void> {
  try {
    const clean = await validAffiliateCode(db(), shop.storeId, code ?? (await cookieCode(shop.storeId)));
    if (!clean) return;
    await db().execute(sql`
      update commerce.carts set affiliate_code = ${clean}, updated_at = now()
      where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
        and affiliate_code is distinct from ${clean}
    `);
  } catch {
    // The cart is still the shopper's: the discount is lost, nothing else.
  }
}

/**
 * A friend who registers with a code in hand (the page's, from memory, else the cookie's) is tied to that referrer, so
 * their later orders earn too. Only for a customer made within the last hour who has no referrer and no paid order,
 * and never to themselves: the database refuses a referrer that is not an affiliate of the store. Never throws.
 */
export async function attachReferral(storeId: string, customerId: string, code?: string | null): Promise<boolean> {
  try {
    // The page's code, else the consented cookie's, else the one on this browser's open cart (a friend who declined marketing cookies).
    const clean = await validAffiliateCode(db(), storeId, code ?? (await cookieCode(storeId)) ?? (await deviceCartCode(storeId)));
    if (!clean) return false;
    const done = await db().execute<Row>(sql`
      update commerce.customers c set referred_by_customer_id = a.customer_id, updated_at = now()
      from commerce.affiliates a
      where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid and c.referred_by_customer_id is null
        and c.created_at > now() - interval '1 hour' and c.copied_from is null
        and a.store_id = c.store_id and a.code = ${clean} and a.customer_id <> c.id and a.blocked_at is null
        and not commerce.affiliate_has_paid(c.store_id, c.id, null)
        and lower((select x.email from commerce.customers x where x.store_id = a.store_id and x.id = a.customer_id)) <> lower(c.email)
      returning c.id
    `);
    return done.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The friend's welcome discount: one calculation for the cart page and `placeOrder()`
// ---------------------------------------------------------------------------

export type FriendState = {
  program: AffiliateProgram;
  /** The code in play, as checked against the store's affiliates (null: none or not a live one). */
  code: string | null;
  verdict: AffiliateVerdict;
  affiliateCustomerId: string | null;
  /** The order is the friend's first, so the welcome discount applies. */
  welcome: boolean;
};

/** What the database says of this customer and code (`commerce.affiliate_resolve`); the program off says `off` without asking. */
export async function friendState(
  runner: Runner,
  storeId: string,
  customerId: string | null,
  code: string | null,
  known?: BonusProgram,
  exceptOrder: string | null = null,
): Promise<FriendState> {
  const program = await affiliateProgram(runner, storeId, known);
  const none = (verdict: AffiliateVerdict): FriendState => ({ program, code: null, verdict, affiliateCustomerId: null, welcome: false });
  if (!program.on) return none("off");
  const [row] = await runner.execute<Row>(sql`
    select affiliate_customer_id, code, verdict, welcome
    from commerce.affiliate_resolve(${storeId}::uuid, ${customerId}::uuid, ${normalizeAffiliateCode(code)}, ${exceptOrder}::uuid)
  `);
  if (!row) return none("none");
  return {
    program,
    code: row.code ? String(row.code) : null,
    verdict: row.verdict as AffiliateVerdict,
    affiliateCustomerId: row.affiliate_customer_id ? String(row.affiliate_customer_id) : null,
    welcome: Boolean(row.welcome),
  };
}

/**
 * The most the welcome discount takes off, in the market's currency: the owner's amount is in the credits' currency
 * (the store's main one), converted at the store's rates and rounded down. No rate: no discount, never one without a cap.
 */
export function welcomeCap(program: AffiliateProgram, market: Pick<Market, "currency">): number | null {
  const max = program.settings.friendMaxMinor;
  if (max === null) return null;
  return convertCredits(max, program.bonus.currency, market.currency, program.bonus.rates, "down") ?? 0;
}

/** The discount on each line (`eligibleMinor`: goods bought once after campaigns and the group's discount), all in the market's currency. */
export function welcomeFor(state: FriendState, market: Pick<Market, "currency">, eligibleMinor: readonly number[]) {
  if (state.verdict !== "ok" || !state.welcome) return { totalMinor: 0, lines: eligibleMinor.map(() => 0) };
  return planWelcome(eligibleMinor, state.program.settings, welcomeCap(state.program, market));
}

/** What the cart or checkout says of it. */
export function cartAffiliateOf(state: FriendState, discountMinor: number): CartAffiliate {
  const percent = state.program.settings.friendPercent;
  if (state.verdict === "ok" && discountMinor > 0) return { state: "applied", percent, discountMinor };
  if (state.verdict === "guest" && percent > 0) return { state: "guest", percent, discountMinor: 0 };
  return { ...NO_CART_AFFILIATE };
}

// ---------------------------------------------------------------------------
// The shopper's page: Refer a friend
// ---------------------------------------------------------------------------

const toStatus = (value: unknown): AffiliateStatus => (["pending", "rewarded", "reversed", "rejected"].includes(String(value)) ? (String(value) as AffiliateStatus) : "pending");

/**
 * What Refer a friend shows the signed-in customer, amounts in the market's currency (converted at the store's rates and
 * rounded down; in the credits' own when there is no rate). A neutral label for each friend (a first name at most), the
 * date, the status and the credits: never an email, an order or what the friend bought. Makes the customer's code the
 * first time. `enabled` is false while the program is off, and then nothing else is read.
 */
export async function shopperReferrals(shop: Shop, customerId: string): Promise<ShopperReferrals> {
  const { storeId, market } = shop;
  const program = await affiliateProgram(db(), storeId);
  const empty: ShopperReferrals = {
    enabled: false,
    code: null,
    blocked: false,
    settings: program.settings,
    pendingDays: program.bonus.settings.pendingDays,
    currency: program.bonus.currency,
    visits: 0,
    friends: [],
    earnedMinor: 0,
    pendingMinor: 0,
  };
  if (!program.on) return empty;
  const mine = await ensureAffiliate(storeId, customerId);
  if (!mine) return empty;
  const rate = (minor: number) => convertCredits(minor, program.bonus.currency, market.currency, program.bonus.rates, "down");
  const convertible = rate(1_000_000) !== null;
  const inShown = (minor: number) => (convertible ? (rate(minor) ?? 0) : minor);
  const currency = convertible ? market.currency : program.bonus.currency;

  const [visits] = await db().execute<Row>(sql`
    select coalesce(sum(visits), 0)::bigint as n from commerce.referral_visits where store_id = ${storeId}::uuid and code = ${mine.code}
  `);
  const friends = await db().execute<Row>(sql`
    select a.created_at, a.status, a.reward_minor, f.name, e.available_at
    from commerce.affiliate_attributions a
    left join commerce.customers f on f.store_id = a.store_id and f.id = a.friend_customer_id
    left join commerce.bonus_entries e on e.store_id = a.store_id and e.idempotency_key = 'referral:' || a.order_id::text
    join commerce.orders o on o.store_id = a.store_id and o.id = a.order_id
    where a.store_id = ${storeId}::uuid and a.affiliate_customer_id = ${customerId}::uuid
      and not (a.status = 'rejected' and a.reject_reason = 'self')
      -- An order that was never paid and is cancelled is not a friend's order yet.
      and not (a.status = 'pending' and o.status = 'cancelled')
    order by a.created_at desc
    limit 100
  `);
  const now = Date.now();
  let earned = 0;
  let pending = 0;
  for (const row of friends) {
    if (toStatus(row.status) !== "rewarded") continue;
    const at = row.available_at ? new Date(String(row.available_at)).getTime() : 0;
    if (at > now) pending += Number(row.reward_minor);
    else earned += Number(row.reward_minor);
  }
  return {
    enabled: true,
    code: mine.code,
    blocked: mine.blocked,
    // The owner's amounts are in the credits' currency; the page shows them in the market's.
    settings: {
      ...program.settings,
      friendMaxMinor: program.settings.friendMaxMinor === null ? null : inShown(program.settings.friendMaxMinor),
      monthlyCapMinor: program.settings.monthlyCapMinor === null ? null : inShown(program.settings.monthlyCapMinor),
    },
    pendingDays: program.bonus.settings.pendingDays,
    currency,
    visits: Number(visits?.n ?? 0),
    friends: friends.map((row) => ({
      label: friendLabel(row.name ? String(row.name) : null) ?? "",
      at: new Date(String(row.created_at)).toISOString(),
      status: toStatus(row.status),
      rewardMinor: inShown(Number(row.reward_minor)),
    })),
    earnedMinor: inShown(earned),
    pendingMinor: inShown(pending),
  };
}

// ---------------------------------------------------------------------------
// The owner's side
// ---------------------------------------------------------------------------

/** What the program did lately, in the credits' currency. */
export async function affiliateOverview(storeId: string): Promise<AffiliateOverview> {
  const program = await affiliateProgram(db(), storeId);
  const [row] = await db().execute<Row>(sql`
    select
      (select count(*) from commerce.affiliates where store_id = ${storeId}::uuid)::int as affiliates,
      (select coalesce(sum(visits), 0) from commerce.referral_visits
        where store_id = ${storeId}::uuid and day > (now() at time zone 'UTC')::date - 30)::int as visits,
      (select count(*) from commerce.affiliate_attributions where store_id = ${storeId}::uuid and created_at > now() - interval '30 days' and status <> 'rejected')::int as orders,
      (select coalesce(sum(reward_minor), 0) from commerce.affiliate_attributions
        where store_id = ${storeId}::uuid and status = 'rewarded' and rewarded_at > now() - interval '30 days')::bigint as rewarded,
      (select count(*) from commerce.affiliate_attributions where store_id = ${storeId}::uuid and status = 'rejected' and created_at > now() - interval '30 days')::int as rejected,
      (select coalesce(sum(l.remaining) filter (where l.available_at <= now()), 0) from commerce.bonus_entries e
         cross join lateral commerce.bonus_lots(e.store_id, e.customer_id) l
        where e.store_id = ${storeId}::uuid and e.kind = 'referral' and l.id = e.id and (l.expires_at is null or l.expires_at > now()))::bigint as outstanding,
      (select coalesce(sum(l.remaining) filter (where l.available_at > now()), 0) from commerce.bonus_entries e
         cross join lateral commerce.bonus_lots(e.store_id, e.customer_id) l
        where e.store_id = ${storeId}::uuid and e.kind = 'referral' and l.id = e.id and (l.expires_at is null or l.expires_at > now()))::bigint as pending
  `);
  return {
    currency: program.bonus.currency,
    affiliates: Number(row?.affiliates ?? 0),
    visits30d: Number(row?.visits ?? 0),
    orders30d: Number(row?.orders ?? 0),
    rewarded30dMinor: Number(row?.rewarded ?? 0),
    outstandingMinor: Number(row?.outstanding ?? 0),
    pendingMinor: Number(row?.pending ?? 0),
    rejected30d: Number(row?.rejected ?? 0),
  };
}

/** The store's referrers, the ones with the most earned first (staff may see names and emails). */
export async function listAffiliates(storeId: string, limit = 200): Promise<AffiliateRow[]> {
  const rows = await db().execute<Row>(sql`
    select a.customer_id, a.code, a.blocked_at, c.name, c.email,
      (select count(distinct x.friend_customer_id) from commerce.affiliate_attributions x
        where x.store_id = a.store_id and x.affiliate_customer_id = a.customer_id and x.status in ('pending', 'rewarded', 'reversed'))::int as friends,
      (select coalesce(sum(x.reward_minor), 0) from commerce.affiliate_attributions x
        where x.store_id = a.store_id and x.affiliate_customer_id = a.customer_id and x.status = 'rewarded')::bigint as earned
    from commerce.affiliates a
    join commerce.customers c on c.store_id = a.store_id and c.id = a.customer_id
    where a.store_id = ${storeId}::uuid
    order by earned desc, a.created_at desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    customerId: String(row.customer_id),
    name: String(row.name ?? ""),
    email: String(row.email),
    code: String(row.code),
    blocked: row.blocked_at !== null,
    friends: Number(row.friends),
    earnedMinor: Number(row.earned),
  }));
}

const toAttribution = (row: Row): AffiliateAttributionRow => ({
  id: String(row.id),
  at: new Date(String(row.created_at)).toISOString(),
  orderId: String(row.order_id),
  orderNumber: String(row.number),
  friendId: row.friend_customer_id ? String(row.friend_customer_id) : null,
  friendName: String(row.friend_name ?? ""),
  friendEmail: String(row.friend_email ?? ""),
  affiliateId: String(row.affiliate_customer_id),
  affiliateName: String(row.affiliate_name ?? "") || String(row.affiliate_email ?? ""),
  code: String(row.code),
  status: statusOf(toStatus(row.status), row.order_status === "cancelled"),
  reason: row.reject_reason ? (String(row.reject_reason) as AffiliateRejection) : null,
  discountMinor: Number(row.discount_minor),
  orderCurrency: String(row.currency).trim(),
  rewardMinor: Number(row.reward_minor),
  creditsCurrency: String(row.credits_currency).trim(),
});

const attributionSelect = sql`
  select a.id, a.created_at, a.order_id, o.number, o.status as order_status, o.currency, a.friend_customer_id,
    f.name as friend_name, f.email as friend_email, a.affiliate_customer_id, r.name as affiliate_name,
    r.email as affiliate_email, a.code, a.status, a.reject_reason, a.discount_minor, a.reward_minor,
    commerce.bonus_currency(a.store_id) as credits_currency
  from commerce.affiliate_attributions a
  join commerce.orders o on o.store_id = a.store_id and o.id = a.order_id
  join commerce.customers r on r.store_id = a.store_id and r.id = a.affiliate_customer_id
  left join commerce.customers f on f.store_id = a.store_id and f.id = a.friend_customer_id
`;

/** The newest attributed orders of the store, rewarded or not, with the reason when a guard stopped the reward. */
export async function listAttributions(storeId: string, limit = 100): Promise<AffiliateAttributionRow[]> {
  const rows = await db().execute<Row>(sql`${attributionSelect} where a.store_id = ${storeId}::uuid order by a.created_at desc limit ${limit}`);
  return rows.map(toAttribution);
}

/** What an order's attribution is, for the order page; null for an order no link led to. */
export async function orderAttribution(storeId: string, orderId: string): Promise<AffiliateAttributionRow | null> {
  const [row] = await db().execute<Row>(sql`${attributionSelect} where a.store_id = ${storeId}::uuid and a.order_id = ${orderId}::uuid`);
  return row ? toAttribution(row) : null;
}

/** A customer in the program, for their page in the admin: their own link, who referred them and the orders it led to. */
export async function customerAffiliate(storeId: string, customerId: string): Promise<CustomerAffiliate> {
  const program = await affiliateProgram(db(), storeId);
  const [mine] = await db().execute<Row>(sql`
    select a.code, a.blocked_at, a.blocked_reason,
      (select count(distinct x.friend_customer_id) from commerce.affiliate_attributions x
        where x.store_id = a.store_id and x.affiliate_customer_id = a.customer_id and x.status in ('pending', 'rewarded', 'reversed'))::int as friends,
      (select coalesce(sum(x.reward_minor), 0) from commerce.affiliate_attributions x
        where x.store_id = a.store_id and x.affiliate_customer_id = a.customer_id and x.status = 'rewarded')::bigint as earned
    from commerce.affiliates a where a.store_id = ${storeId}::uuid and a.customer_id = ${customerId}::uuid
  `);
  const [by] = await db().execute<Row>(sql`
    select r.id, r.name, r.email, a.code from commerce.customers c
    join commerce.customers r on r.store_id = c.store_id and r.id = c.referred_by_customer_id
    join commerce.affiliates a on a.store_id = r.store_id and a.customer_id = r.id
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
  `);
  const rows = await db().execute<Row>(sql`
    ${attributionSelect}
    where a.store_id = ${storeId}::uuid and (a.friend_customer_id = ${customerId}::uuid or a.affiliate_customer_id = ${customerId}::uuid)
    order by a.created_at desc limit 50
  `);
  return {
    code: mine ? String(mine.code) : null,
    blocked: Boolean(mine?.blocked_at),
    blockedReason: String(mine?.blocked_reason ?? ""),
    friends: Number(mine?.friends ?? 0),
    earnedMinor: Number(mine?.earned ?? 0),
    currency: program.bonus.currency,
    referredBy: by ? { customerId: String(by.id), name: String(by.name ?? ""), email: String(by.email), code: String(by.code) } : null,
    attributions: rows.map(toAttribution),
  };
}

/**
 * Stops a customer earning referral credits, or lets them again, with a reason (3 to 200 characters). Owners and admins
 * of the store both may. What they have earned stays; a blocked referrer's pending orders earn nothing when they are
 * paid, and their link is not counted. Audited.
 */
export async function setAffiliateBlocked(
  account: Account,
  storeId: string,
  customerId: string,
  blocked: boolean,
  note: string,
): Promise<AffiliateResult> {
  if (!(await roleIn(account.id, storeId))) return { ok: false, problems: ["You do not have access to this store."] };
  const reason = String(note ?? "").trim();
  if (blocked && (reason.length < 3 || reason.length > 200)) return { ok: false, problems: ["Write a reason of 3 to 200 characters."] };
  if (reason.length > 200) return { ok: false, problems: ["Keep the reason to 200 characters."] };
  const updated = await db().execute<Row>(sql`
    update commerce.affiliates set blocked_at = ${blocked ? sql`now()` : sql`null`}, blocked_reason = ${blocked ? reason : ""}
    where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and (blocked_at is not null) is distinct from ${blocked}
    returning customer_id
  `);
  if (updated.length === 0) {
    const [exists] = await db().execute<Row>(sql`select 1 from commerce.affiliates where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid`);
    return exists ? { ok: true } : { ok: false, problems: ["This customer has no referral link."] };
  }
  await audit(account.id, storeId, blocked ? "customer.affiliate_blocked" : "customer.affiliate_unblocked", { customerId, note: reason });
  return { ok: true };
}
