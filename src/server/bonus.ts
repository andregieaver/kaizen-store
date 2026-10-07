import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  BONUS_DEFAULTS,
  BONUS_EXPIRY_REMINDER_DAYS,
  BONUS_HISTORY_LIMIT,
  bonusSettingsInput,
  convertCredits,
  earnAmount,
  minChargeMinor,
  planCredit,
  type BonusBalance,
  type BonusEntry,
  type BonusEntryKind,
  type BonusExpiryReminder,
  type BonusOverview,
  type BonusResult,
  type BonusSettings,
  type CartBonus,
  type CreditPlan,
  type ShopperBonus,
} from "@/lib/bonus";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";

import { audit, type Account } from "./auth";
import type { Shop } from "./cart";

type Row = Record<string, unknown>;
export type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * The bonus program (D130, `docs/bonus.md`): a store's signed-in customers earn credits on what they pay and use them
 * as a price reduction. The rules live in SQL (`commerce.bonus_*`: the ledger, lots, redemption under a lock, earning
 * when an order is paid, taking back and returning on refunds and cancellations, expiry); this module reads and
 * drives them, converts between the credits' currency and what a shopper sees, and works out what credits may do to
 * a basket, the same way for the cart page and for `placeOrder()`.
 */

// ---------------------------------------------------------------------------
// The program: settings, the credits' currency and the store's rates
// ---------------------------------------------------------------------------

export type BonusProgram = {
  settings: BonusSettings;
  /** The credits' currency: pinned when the program was first saved, else the store's main currency. */
  currency: string;
  /** The store's rates (units per 1 EUR), which convert the credits into what a market shows. */
  rates: Map<string, { rate: number | null }>;
  /** The store feature `bonus` is on (D178, with the shop). */
  featureOn: boolean;
  /**
   * The program works: the feature is on and its own switch (`settings.enabled`) is on (`commerce.bonus_program_on()`). Everything a
   * shopper sees or does with credits asks this; `settings.enabled` alone is only the owner's switch on the Bonus page.
   */
  on: boolean;
};

const toSettings = (row: Row | undefined): BonusSettings =>
  row && row.enabled !== null && row.enabled !== undefined
    ? {
        enabled: Boolean(row.enabled),
        earnBps: Number(row.earn_bps),
        pendingDays: Number(row.pending_days),
        maxRedeemPercent: Number(row.max_redeem_percent),
        minRedeemMinor: Number(row.min_redeem_minor),
        expiresMonths: row.expires_months === null ? null : Number(row.expires_months),
      }
    : { ...BONUS_DEFAULTS };

/** The store's bonus settings; the defaults, with the program off, when it has none. */
export async function getBonusSettings(storeId: string): Promise<BonusSettings> {
  return (await bonusProgram(db(), storeId)).settings;
}

/** Settings, credits' currency and rates in one read: what every calculation starts from. */
export async function bonusProgram(runner: Runner, storeId: string): Promise<BonusProgram> {
  const [row] = await runner.execute<Row>(sql`
    select b.enabled, b.earn_bps, b.pending_days, b.max_redeem_percent, b.min_redeem_minor, b.expires_months,
           commerce.bonus_currency(${storeId}::uuid) as currency, commerce.feature_on(${storeId}::uuid, 'bonus') as feature_on
    from (select 1) one
    left join commerce.bonus_settings b on b.store_id = ${storeId}::uuid
  `);
  const rates = await runner.execute<Row>(sql`
    select currency, rate from commerce.store_currencies where store_id = ${storeId}::uuid
  `);
  const settings = toSettings(row);
  const featureOn = Boolean(row?.feature_on);
  return {
    settings,
    currency: String(row?.currency ?? "EUR").trim(),
    rates: new Map(rates.map((r) => [String(r.currency).trim(), { rate: r.rate === null ? null : Number(r.rate) }])),
    featureOn,
    on: featureOn && settings.enabled,
  };
}

/** The answer to a change of the program while its store feature is off (D178): the Bonus page is hidden then, and so is every change. */
export const BONUS_FEATURE_OFF = "The bonus program is switched off under Settings, Features. Switch it on there first.";

/** Who may change what: the account's role in the store (an owner, or an admin), or null. */
export async function roleIn(accountId: string, storeId: string): Promise<"owner" | "admin" | null> {
  const [row] = await db().execute<Row>(sql`
    select role from commerce.store_members
    where store_id = ${storeId}::uuid and account_id = ${accountId}::uuid and disabled_at is null
      and (expires_at is null or expires_at > now())
  `);
  return row ? (row.role as "owner" | "admin") : null;
}

/**
 * Saves the program's settings. Owners only (the page checks, and so does this). What customers have earned is not
 * changed by any setting: a grant keeps the dates it was given. Turning the program off keeps every balance, and stops
 * earning and using. The credits' currency is pinned the first time, so a balance never changes currency.
 */
export async function saveBonusSettings(account: Account, storeId: string, raw: unknown): Promise<BonusResult> {
  if ((await roleIn(account.id, storeId)) !== "owner")
    return { ok: false, problems: ["Only an owner can change the bonus program."] };
  if (!(await bonusProgram(db(), storeId)).featureOn) return { ok: false, problems: [BONUS_FEATURE_OFF] };
  const parsed = bonusSettingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const s = parsed.data;
  const before = await getBonusSettings(storeId);
  await db().execute(sql`
    insert into commerce.bonus_settings (
      store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, updated_by
    ) values (
      ${storeId}::uuid, ${s.enabled}, ${s.earnBps}, ${s.pendingDays}, ${s.maxRedeemPercent}, ${s.minRedeemMinor},
      ${s.expiresMonths}, commerce.bonus_currency(${storeId}::uuid), ${account.id}::uuid
    )
    on conflict (store_id) do update set
      enabled = excluded.enabled, earn_bps = excluded.earn_bps, pending_days = excluded.pending_days,
      max_redeem_percent = excluded.max_redeem_percent, min_redeem_minor = excluded.min_redeem_minor,
      expires_months = excluded.expires_months, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, storeId, "store.bonus_settings", { before, after: s });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Balances and history
// ---------------------------------------------------------------------------

type RawBalance = {
  available: number;
  pending: number;
  pendingAt: string | null;
  expiringMinor: number;
  expiringAt: string | null;
};

async function readBalance(runner: Runner, storeId: string, customerId: string): Promise<RawBalance> {
  const [row] = await runner.execute<Row>(sql`
    select available_minor, pending_minor, expiring_minor, expiring_at, pending_at
    from commerce.bonus_balance(${storeId}::uuid, ${customerId}::uuid)
  `);
  return {
    available: Number(row?.available_minor ?? 0),
    pending: Number(row?.pending_minor ?? 0),
    pendingAt: row?.pending_at ? new Date(String(row.pending_at)).toISOString() : null,
    expiringMinor: Number(row?.expiring_minor ?? 0),
    expiringAt: row?.expiring_at ? new Date(String(row.expiring_at)).toISOString() : null,
  };
}

const toBalance = (raw: RawBalance, currency: string): BonusBalance => ({
  currency,
  availableMinor: raw.available,
  pendingMinor: raw.pending,
  pendingAvailableAt: raw.pending > 0 ? raw.pendingAt : null,
  expiringSoon: raw.expiringAt && raw.expiringMinor > 0 ? { amountMinor: raw.expiringMinor, at: raw.expiringAt } : null,
});

async function readEntries(storeId: string, customerId: string): Promise<BonusEntry[]> {
  const rows = await db().execute<Row>(sql`
    select e.id, e.kind, e.amount_minor, e.created_at, e.available_at, e.expires_at, e.note, e.order_id, o.number
    from commerce.bonus_entries e
    left join commerce.orders o on o.store_id = e.store_id and o.id = e.order_id
    where e.store_id = ${storeId}::uuid and e.customer_id = ${customerId}::uuid
    order by e.created_at desc, e.id desc
    limit ${BONUS_HISTORY_LIMIT}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as BonusEntryKind,
    amountMinor: Number(row.amount_minor),
    at: new Date(String(row.created_at)).toISOString(),
    availableAt: row.available_at ? new Date(String(row.available_at)).toISOString() : null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    orderNumber: row.number ? String(row.number) : null,
    orderId: row.order_id ? String(row.order_id) : null,
    note: String(row.note ?? ""),
  }));
}

/** A customer's balance and history (newest first, at most 200 entries), in the credits' currency. */
export async function customerBonus(
  storeId: string,
  customerId: string,
): Promise<{ balance: BonusBalance; entries: BonusEntry[] }> {
  const program = await bonusProgram(db(), storeId);
  const [balance, entries] = await Promise.all([
    readBalance(db(), storeId, customerId),
    readEntries(storeId, customerId),
  ]);
  return { balance: toBalance(balance, program.currency), entries };
}

/** What the program owes and did lately, in the credits' currency. */
export async function bonusOverview(storeId: string): Promise<BonusOverview> {
  const program = await bonusProgram(db(), storeId);
  const [row] = await db().execute<Row>(sql`
    with lots as (
      select e.customer_id, e.available_at, e.expires_at,
             e.amount_minor - coalesce((select sum(a.amount_minor) from commerce.bonus_allocations a
                                         where a.store_id = e.store_id and a.lot_id = e.id), 0) as remaining
      from commerce.bonus_entries e
      where e.store_id = ${storeId}::uuid and e.amount_minor > 0
    ), live as (
      select * from lots where remaining > 0 and (expires_at is null or expires_at > now())
    )
    select
      (select coalesce(sum(remaining) filter (where available_at <= now()), 0) from live)::bigint as outstanding,
      (select coalesce(sum(remaining) filter (where available_at > now()), 0) from live)::bigint as pending,
      (select count(distinct customer_id) from live)::int as customers,
      (select coalesce(sum(amount_minor) filter (where kind in ('earn', 'referral')), 0) from commerce.bonus_entries
        where store_id = ${storeId}::uuid and created_at > now() - interval '30 days')::bigint as earned,
      (select coalesce(-sum(amount_minor) filter (where kind = 'redeem'), 0) from commerce.bonus_entries
        where store_id = ${storeId}::uuid and created_at > now() - interval '30 days')::bigint as redeemed,
      -- Credits moved when the program came back on after a pause (D178, commerce.bonus_resume()) did not expire: they were granted again.
      (select coalesce(-sum(amount_minor) filter (where kind = 'expire' and idempotency_key not like 'expire-paused:%'), 0) from commerce.bonus_entries
        where store_id = ${storeId}::uuid and created_at > now() - interval '30 days')::bigint as expired
  `);
  return {
    currency: program.currency,
    outstandingMinor: Number(row?.outstanding ?? 0),
    pendingMinor: Number(row?.pending ?? 0),
    earned30dMinor: Number(row?.earned ?? 0),
    redeemed30dMinor: Number(row?.redeemed ?? 0),
    expired30dMinor: Number(row?.expired ?? 0),
    customersWithCredits: Number(row?.customers ?? 0),
  };
}

/**
 * Staff add credits to a customer or take some away, with a reason the history keeps (3–200 characters). Owners and
 * admins of the store both may. Adding is usable at once and follows the store's expiry; taking away never goes below
 * zero (usable credits first, then the pending). Audited.
 */
export async function adjustBonus(
  account: Account,
  storeId: string,
  customerId: string,
  amountMinor: number,
  note: string,
): Promise<BonusResult> {
  if (!(await roleIn(account.id, storeId))) return { ok: false, problems: ["You do not have access to this store."] };
  if (!(await bonusProgram(db(), storeId)).featureOn) return { ok: false, problems: [BONUS_FEATURE_OFF] };
  const reason = String(note ?? "").trim();
  if (reason.length < 3 || reason.length > 200)
    return { ok: false, problems: ["Write a reason of 3 to 200 characters."] };
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0 || Math.abs(amountMinor) > 100_000_000) {
    return { ok: false, problems: ["The amount must be a whole number of minor units, not 0, and at most 1 000 000."] };
  }
  const [customer] = await db().execute<Row>(sql`
    select 1 from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  if (!customer) return { ok: false, problems: ["This customer does not exist."] };
  try {
    await db().execute(sql`
      select commerce.bonus_adjust(${storeId}::uuid, ${customerId}::uuid, ${amountMinor}, ${reason}, ${account.id}::uuid,
                                   ${`adjust:${randomUUID()}`})
    `);
  } catch (error) {
    if (failedWith(error, "bonus.insufficient"))
      return { ok: false, problems: ["The customer has fewer credits than that to take away."] };
    throw error;
  }
  await audit(account.id, storeId, "customer.bonus_adjusted", { customerId, amountMinor, note: reason });
  return { ok: true };
}

/** Whether a database error (or what caused it) is one of the ledger's own refusals. */
export function failedWith(error: unknown, code: string): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof (e as { message?: unknown }).message === "string" && (e as { message: string }).message.includes(code))
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The shopper's side: credits in the market's currency
// ---------------------------------------------------------------------------

/** What credits can do for one customer in one market, worked out the same way at the cart and at checkout. */
export type CreditState = {
  program: BonusProgram;
  customerId: string;
  /** The customer's balance in the credits' currency. */
  availableCredits: number;
  pendingCredits: number;
  pendingAt: string | null;
  expiring: { amountMinor: number; at: string } | null;
  /** Usable and pending as the market shows them; 0 when the store has no rate between the two currencies. */
  availableMinor: number;
  pendingMinor: number;
  /** What the shopper asked to use (the cart's request, in the market's currency). */
  requestMinor: number;
  /** The owner's minimum, and the payment provider's smallest charge, in the market's currency. */
  minRedeemMinor: number;
  minPayableMinor: number;
};

/**
 * The credit state for a signed-in customer buying in `shop.market`, or null for a guest or while the program is off.
 * Reads inside `runner`, so checkout sees the same under its lock.
 */
export async function creditState(
  runner: Runner,
  shop: Shop,
  customerId: string | null,
  cartId: string | null,
  known?: BonusProgram,
): Promise<CreditState | null> {
  if (!customerId) return null;
  const program = known ?? (await bonusProgram(runner, shop.storeId));
  if (!program.on) return null;
  const market = shop.market;
  const balance = await readBalance(runner, shop.storeId, customerId);
  const inMarket = (minor: number, rounding: "down" | "up" = "down") =>
    convertCredits(minor, program.currency, market.currency, program.rates, rounding);
  let requestMinor = 0;
  if (cartId) {
    const [cart] = await runner.execute<Row>(sql`
      select bonus_request_minor, bonus_request_currency from commerce.carts
      where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid
    `);
    // A request made in another currency than the one shown now is not carried over: the shopper asks again.
    if (cart && cart.bonus_request_currency && String(cart.bonus_request_currency).trim() === market.currency) {
      requestMinor = Number(cart.bonus_request_minor);
    }
  }
  return {
    program,
    customerId,
    availableCredits: balance.available,
    pendingCredits: balance.pending,
    pendingAt: balance.pending > 0 ? balance.pendingAt : null,
    expiring:
      balance.expiringAt && balance.expiringMinor > 0
        ? { amountMinor: balance.expiringMinor, at: balance.expiringAt }
        : null,
    availableMinor: inMarket(balance.available) ?? 0,
    pendingMinor: inMarket(balance.pending) ?? 0,
    requestMinor,
    minRedeemMinor: inMarket(program.settings.minRedeemMinor, "up") ?? 0,
    minPayableMinor: minChargeMinor(market.currency),
  };
}

/**
 * What the credits do to a basket: `eligibleMinor` per line (goods bought once, after campaigns, the group's discount
 * and codes, due online), `dueMinor` everything due online before credits. Zero for a guest or with the program off.
 */
export function planFor(state: CreditState | null, eligibleMinor: readonly number[], dueMinor: number): CreditPlan {
  if (!state) return { maxUsableMinor: 0, usingMinor: 0, lines: eligibleMinor.map(() => 0) };
  return planCredit({
    eligibleMinor,
    dueMinor,
    balanceMinor: state.availableMinor,
    requestMinor: state.requestMinor,
    maxPercent: state.program.settings.maxRedeemPercent,
    minRedeemMinor: state.minRedeemMinor,
    minPayableMinor: state.minPayableMinor,
  });
}

/**
 * The credits (in the credits' currency) a use of `usingMinor` (the market's) takes: rounded up, never more than the
 * customer has, so the ledger never promises what the balance cannot cover.
 */
export function debitFor(state: CreditState, market: Pick<Market, "currency">, usingMinor: number): number {
  if (usingMinor <= 0) return 0;
  const credits = convertCredits(usingMinor, market.currency, state.program.currency, state.program.rates, "up");
  return Math.min(state.availableCredits, credits ?? 0);
}

/** The credits as the cart and checkout show them. `paidOnlineMinor` is what this order pays online for goods and fees. */
export function cartBonusOf(
  market: Pick<Market, "currency">,
  program: BonusProgram,
  state: CreditState | null,
  plan: CreditPlan,
  signedIn: boolean,
  paidOnlineMinor: number,
  earns: boolean,
): CartBonus {
  const settings = program.settings;
  if (!program.on) {
    return {
      enabled: false,
      signedIn,
      availableMinor: 0,
      pendingMinor: 0,
      pendingAvailableAt: null,
      maxUsableMinor: 0,
      usingMinor: 0,
      willEarnMinor: 0,
      earnPercent: 0,
      pendingDays: 0,
    };
  }
  return {
    enabled: true,
    signedIn,
    availableMinor: state?.availableMinor ?? 0,
    pendingMinor: state?.pendingMinor ?? 0,
    pendingAvailableAt: state?.pendingMinor ? state.pendingAt : null,
    maxUsableMinor: plan.maxUsableMinor,
    usingMinor: plan.usingMinor,
    willEarnMinor: state && earns ? earnAmount(paidOnlineMinor, settings.earnBps) : 0,
    earnPercent: settings.earnBps / 100,
    pendingDays: settings.pendingDays,
  };
}

/**
 * The credits in the shopper's cart, as the cart page shows them (the market's currency): what they have, how much
 * they may use on this basket, what they are using and what it will earn. A guest has none.
 */
export async function cartBonus(shop: Shop, cartId: string | null, customerId: string | null): Promise<CartBonus> {
  const { getCart } = await import("./cart");
  const { cartSummary } = await import("./cart-summary");
  const summary = await cartSummary(shop, await getCart(shop), { customerId, cartId });
  return summary.bonus;
}

/**
 * Asks to use `amountMinor` (the market's currency; 0 to stop) of the customer's credits on the cart. Only a request:
 * it is brought down to what `redeemLimit()` allows now, and checkout works it out again under lock. Refused for a
 * guest or while the program is off.
 */
export async function setCartCredits(
  shop: Shop,
  cartId: string,
  customerId: string | null,
  amountMinor: number,
): Promise<BonusResult<{ usingMinor: number }>> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    return { ok: false, problems: ["Enter an amount of credits to use."] };
  if (!customerId) return { ok: false, problems: ["Sign in to use credits."] };
  const program = await bonusProgram(db(), shop.storeId);
  if (!program.on) return { ok: false, problems: ["The store's bonus program is off."] };
  let using = 0;
  if (amountMinor > 0) {
    const bonus = await cartBonus(shop, cartId, customerId);
    if (bonus.maxUsableMinor <= 0) return { ok: false, problems: ["There are no credits to use on this order."] };
    using = Math.min(amountMinor, bonus.maxUsableMinor);
    // The owner's minimum: less than it is refused with the reason, not quietly ignored at checkout.
    const least = (await creditState(db(), shop, customerId, cartId, program))?.minRedeemMinor ?? 0;
    if (using < least) {
      return {
        ok: false,
        problems: [`The least you can use at once is ${formatMoney(least, shop.market.currency, shop.market.locale)}.`],
      };
    }
  }
  await db().execute(sql`
    update commerce.carts
    set bonus_request_minor = ${using}, bonus_request_currency = ${shop.market.currency}, updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and market_code = ${shop.market.code} and status = 'open'
  `);
  return { ok: true, usingMinor: using };
}

/**
 * A customer's credits on My account, in the market's currency (balance and history converted at the store's rates,
 * rounded down); in the credits' own currency when the store has no rate to the one shown.
 */
export async function shopperBonus(shop: Shop, customerId: string): Promise<ShopperBonus> {
  const program = await bonusProgram(db(), shop.storeId);
  const [raw, entries] = await Promise.all([
    readBalance(db(), shop.storeId, customerId),
    readEntries(shop.storeId, customerId),
  ]);
  const rate = (minor: number) => convertCredits(minor, program.currency, shop.market.currency, program.rates, "down");
  const convertible = rate(1_000_000) !== null;
  const currency = convertible ? shop.market.currency : program.currency;
  const inShown = (minor: number) => (convertible ? (minor < 0 ? -(rate(-minor) ?? 0) : (rate(minor) ?? 0)) : minor);
  const balance = toBalance(raw, currency);
  return {
    enabled: program.on,
    currency,
    balance: {
      currency,
      availableMinor: inShown(balance.availableMinor),
      pendingMinor: inShown(balance.pendingMinor),
      pendingAvailableAt: balance.pendingAvailableAt ?? null,
      expiringSoon: balance.expiringSoon
        ? { ...balance.expiringSoon, amountMinor: inShown(balance.expiringSoon.amountMinor) }
        : null,
    },
    entries: entries.map((entry) => ({ ...entry, amountMinor: inShown(entry.amountMinor) })),
    earnPercent: program.settings.earnBps / 100,
    pendingDays: program.settings.pendingDays,
    expiresMonths: program.settings.expiresMonths,
  };
}

// ---------------------------------------------------------------------------
// The five-minute job
// ---------------------------------------------------------------------------

/** Credits held by an order that never got paid are given back after this long (Stripe's checkout lasts half an hour). */
const HELD_HOURS = 2;
/** At most this many customers are reminded, and this many orders released, per run. */
const BATCH = 200;

/**
 * Every five minutes: credits past their expiry are written off (oldest first); customers whose credits expire within
 * 14 days get one reminder per expiry date (neither for a store whose program is off, D178: its credits do not expire
 * while it is, and `commerce.bonus_resume()` moves the dates that passed when it comes back on); and credits held by unpaid orders that lapsed without the payment provider
 * telling us are given back (a payment that arrives later is still accepted: the credits are taken again). Never
 * throws: a failing step is left for the next run.
 */
export async function runBonusJobs(): Promise<{ expired: number; reminded: number; released: number }> {
  const out = { expired: 0, reminded: 0, released: 0 };
  try {
    const [row] = await db().execute<Row>(sql`select commerce.bonus_expire_due(2000) as expired`);
    out.expired = Number(row?.expired ?? 0);
  } catch {
    // Left for the next run.
  }
  try {
    out.released = await releaseHeldCredits();
  } catch {
    // Left for the next run.
  }
  try {
    out.reminded = await remindExpiring();
  } catch {
    // Left for the next run.
  }
  return out;
}

/** Unpaid orders that hold credits and have lapsed are cancelled, which gives their credits back. */
async function releaseHeldCredits(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    select id from commerce.orders
    where status = 'pending_payment' and credit_minor > 0 and copied_from is null
      and placed_at < now() - make_interval(hours => ${HELD_HOURS})
    order by placed_at
    limit ${BATCH}
  `);
  if (rows.length === 0) return 0;
  const { cancelUnpaidOrder } = await import("./checkout");
  let released = 0;
  for (const row of rows) {
    if (await cancelUnpaidOrder(String(row.id), "the credits were held too long without a payment")) released++;
  }
  return released;
}

/** The customers to remind, one row each: credits expiring within the window, and the date the first of them does. */
export async function expiringReminders(days = BONUS_EXPIRY_REMINDER_DAYS): Promise<BonusExpiryReminder[]> {
  const rows = await db().execute<Row>(sql`
    select x.store_id, x.customer_id, x.first_at, x.amount_minor, commerce.bonus_currency(x.store_id) as currency
    from commerce.bonus_expiring(${days}) x
    where commerce.store_is_active(x.store_id) and commerce.bonus_program_on(x.store_id)
    order by x.first_at
    limit ${BATCH}
  `);
  return rows.map((row) => ({
    storeId: String(row.store_id),
    customerId: String(row.customer_id),
    firstExpiresAt: new Date(String(row.first_at)).toISOString(),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency).trim(),
  }));
}

async function remindExpiring(): Promise<number> {
  const due = await expiringReminders();
  if (due.length === 0) return 0;
  const { sendBonusExpiryEmail } = await import("./bonus-emails");
  let reminded = 0;
  for (const reminder of due) {
    const outcome = await sendBonusExpiryEmail(reminder);
    if (outcome === "sent" || outcome === "logged") reminded++;
  }
  return reminded;
}
