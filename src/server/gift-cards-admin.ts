import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { cardState, type GiftCardState, type LiabilityLine, liabilityLines, GIFT_CARD_NOTE_MAX } from "@/lib/gift-card-admin";
import { formatGiftCode } from "@/lib/gift-cards";
import { isCurrency } from "@/lib/money";

import type { AnalyticsPeriod } from "@/lib/analytics-period";

import { dayStart } from "./analytics-sql";
import { audit } from "./auth";
import { sendIssuedCard } from "./gift-card-delivery";
import { newGiftCode } from "./gift-card-codes";
import { storePaymentMode } from "./host-payments";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";
import type { Store } from "./stores";

/**
 * The owner's screens over a store's gift cards (D300 F4, `docs/wave-5-marketing.md` 8.4): the list, a card's page, issuing one by hand,
 * changing and deactivating one, the expiry setting, the daily expiry, the liability report and the AI manager's overview. Every change goes
 * through the ledger's SQL functions (`gift_card_issue()`, `gift_card_adjust()`, `gift_card_void()`, `gift_card_expire()`); a balance is only
 * `commerce.gift_card_balance()`. A code is never kept or logged: one issued by hand is shown once to the person who issued it (and emailed to
 * the person it is for when they give an address); audit entries carry ids and amounts.
 */

type Row = Record<string, unknown>;

/** What customers hold in one currency (typed read: money, PSI 2026-10-24 CODE-02). */
const OUTSTANDING_ROW = z.object({ currency: col.currency, amount: col.minor, cards: col.int });
/** One currency's sum of one kind of ledger entry in a period. */
const MOVEMENT_ROW = z.object({ currency: col.currency, kind: col.text, amount: col.minor });

export const GIFT_CARDS_PAGE = 50;

/** The SQL condition for a card's state (`cardState()`'s rules, in the same order). */
const stateWhere = (state: GiftCardState) => {
  switch (state) {
    case "deactivated":
      return sql`g.status = 'deactivated'`;
    case "waiting":
      return sql`g.status = 'active' and g.sent_at is null`;
    case "expired":
      return sql`g.status = 'active' and g.sent_at is not null and g.expires_at is not null and g.expires_at <= now()`;
    case "spent":
      return sql`g.status = 'active' and g.sent_at is not null and (g.expires_at is null or g.expires_at > now()) and commerce.gift_card_balance(g.id) <= 0`;
    case "active":
      return sql`g.status = 'active' and g.sent_at is not null and (g.expires_at is null or g.expires_at > now()) and commerce.gift_card_balance(g.id) > 0`;
  }
};

export type GiftCardRow = {
  id: string;
  last4: string | null;
  currency: string;
  initialMinor: number;
  balanceMinor: number;
  state: GiftCardState;
  testMode: boolean;
  issuedAt: string;
  /** Bought with an order (its number), or issued by staff. */
  source: "order" | "staff";
  orderNumber: string | null;
  /** Who it went to, shown only to staff who may read customers (`people`); else null. */
  to: string | null;
};

const rowOf = (r: Row, people: boolean): GiftCardRow => {
  const balance = Number(r.balance);
  return {
    id: String(r.id),
    last4: r.last4 ? String(r.last4) : null,
    currency: String(r.currency).trim(),
    initialMinor: Number(r.initial_minor),
    balanceMinor: balance,
    state: cardState({ status: String(r.status), sentAt: r.sent_at ? String(r.sent_at) : null, expiresAt: r.expires_at ? String(r.expires_at) : null, balanceMinor: balance }),
    testMode: Boolean(r.test_mode),
    issuedAt: new Date(String(r.issued_at)).toISOString(),
    source: String(r.source) === "staff" ? "staff" : "order",
    orderNumber: r.order_number ? String(r.order_number) : null,
    to: people ? ((r.recipient_name ? String(r.recipient_name) : null) ?? (r.recipient_email ? String(r.recipient_email) : null)) : null,
  };
};

/** The store's cards, newest first, by state and a search (the last four, an order number, or for staff who may read customers the person's name or address). */
export async function listGiftCards(
  storeId: string,
  options: { query?: string; state?: GiftCardState | null; before?: { at: string; id: string } | null; people?: boolean } = {},
): Promise<{ rows: GiftCardRow[]; more: boolean }> {
  const people = options.people === true;
  const words = (options.query ?? "").trim().slice(0, 100);
  const like = `%${words.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const last4 = words.replace(/[\s-]/g, "").toUpperCase().slice(-4);
  const rows = await db().execute<Row>(sql`
    select g.id, g.last4, g.currency, g.initial_minor, g.status, g.sent_at, g.expires_at, g.test_mode, g.issued_at, g.source,
      g.recipient_name, g.recipient_email, o.number as order_number, commerce.gift_card_balance(g.id) as balance
    from commerce.gift_cards g
    left join commerce.orders o on o.store_id = g.store_id and o.id = g.order_id
    where g.store_id = ${storeId}::uuid
      ${options.state ? sql`and ${stateWhere(options.state)}` : sql``}
      and (${words} = ''
        or g.last4 = ${last4}
        or o.number ilike ${like}
        or (${people} and (lower(g.recipient_email) like ${like} or lower(g.recipient_name) like ${like})))
      and (${options.before?.at ?? null}::timestamptz is null or (g.issued_at, g.id) < (${options.before?.at ?? null}::timestamptz, ${options.before?.id ?? null}::uuid))
    order by g.issued_at desc, g.id desc
    limit ${GIFT_CARDS_PAGE + 1}
  `);
  return { rows: rows.slice(0, GIFT_CARDS_PAGE).map((r) => rowOf(r, people)), more: rows.length > GIFT_CARDS_PAGE };
}

/**
 * What customers hold now, per currency, with how many cards hold it: live cards (active, delivered, not expired) of the store's payment mode now,
 * so a store still testing sees its test cards and a live store only its real ones.
 */
export async function giftCardOutstanding(storeId: string): Promise<{ currency: string; amountMinor: number; cards: number }[]> {
  const test = (await storePaymentMode(storeId)) === "test";
  const rows = await typedRows(OUTSTANDING_ROW, sql`
    select trim(currency) as currency, coalesce(sum(balance), 0)::bigint as amount, count(*) filter (where balance > 0)::int as cards
    from (
      select g.currency, commerce.gift_card_balance(g.id) as balance from commerce.gift_cards g
      where g.store_id = ${storeId}::uuid and g.test_mode = ${test} and g.status = 'active' and g.sent_at is not null and (g.expires_at is null or g.expires_at > now())
    ) c
    group by 1 order by 2 desc
  `);
  return rows.map((r) => ({ currency: r.currency, amountMinor: r.amount, cards: r.cards }));
}

/** How many cards are in each state (test cards too: the list shows them). */
export async function giftCardCounts(storeId: string): Promise<Record<GiftCardState, number>> {
  const [r] = await db().execute<Row>(sql`
    select
      count(*) filter (where ${stateWhere("active")})::int as active,
      count(*) filter (where ${stateWhere("waiting")})::int as waiting,
      count(*) filter (where ${stateWhere("spent")})::int as spent,
      count(*) filter (where ${stateWhere("expired")})::int as expired,
      count(*) filter (where ${stateWhere("deactivated")})::int as deactivated
    from commerce.gift_cards g where g.store_id = ${storeId}::uuid
  `);
  return { active: Number(r?.active ?? 0), waiting: Number(r?.waiting ?? 0), spent: Number(r?.spent ?? 0), expired: Number(r?.expired ?? 0), deactivated: Number(r?.deactivated ?? 0) };
}

export type GiftCardEntry = {
  kind: string;
  amountMinor: number;
  at: string;
  orderId: string | null;
  orderNumber: string | null;
  /** The staff member, by name, for staff's own entries. */
  by: string | null;
  note: string;
};

export type GiftCardDetail = GiftCardRow & {
  expiresAt: string | null;
  sentAt: string | null;
  sendAt: string | null;
  orderId: string | null;
  issuedBy: string | null;
  note: string;
  /** Only for staff who may read customers. */
  recipientEmail: string | null;
  recipientName: string | null;
  message: string | null;
  entries: GiftCardEntry[];
  /** The orders it paid for, with what each spent on it (holds less what was given back, then refunds). */
  orders: { id: string; number: string; spentMinor: number; refundedMinor: number; status: string }[];
};

/** One card with its ledger in order and the orders it paid for; null when it is not the store's. */
export async function giftCardDetail(storeId: string, cardId: string, options: { people?: boolean } = {}): Promise<GiftCardDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) return null;
  const people = options.people === true;
  const [card] = await db().execute<Row>(sql`
    select g.*, o.number as order_number, a.name as issued_by_name, commerce.gift_card_balance(g.id) as balance
    from commerce.gift_cards g
    left join commerce.orders o on o.store_id = g.store_id and o.id = g.order_id
    left join commerce.accounts a on a.id = g.issued_by
    where g.store_id = ${storeId}::uuid and g.id = ${cardId}::uuid
  `);
  if (!card) return null;
  const [entries, orders] = await Promise.all([
    db().execute<Row>(sql`
      select e.kind, e.amount_minor, e.created_at, e.order_id, e.note, o.number as order_number, a.name as by_name
      from commerce.gift_card_entries e
      left join commerce.orders o on o.store_id = e.store_id and o.id = e.order_id
      left join commerce.accounts a on a.id = e.account_id
      where e.store_id = ${storeId}::uuid and e.card_id = ${cardId}::uuid
      order by e.created_at, e.id
    `),
    db().execute<Row>(sql`
      select e.order_id, o.number, o.status::text as status,
        coalesce(-sum(e.amount_minor) filter (where e.kind in ('hold', 'release')), 0)::bigint as held,
        coalesce(sum(e.amount_minor) filter (where e.kind = 'refund'), 0)::bigint as refunded,
        bool_or(e.kind = 'spend') as spent, min(e.created_at) as first_at
      from commerce.gift_card_entries e
      join commerce.orders o on o.store_id = e.store_id and o.id = e.order_id
      where e.store_id = ${storeId}::uuid and e.card_id = ${cardId}::uuid and e.kind in ('hold', 'release', 'spend', 'refund')
      group by e.order_id, o.number, o.status
      order by first_at
    `),
  ]);
  return {
    ...rowOf(card, people),
    expiresAt: card.expires_at ? new Date(String(card.expires_at)).toISOString() : null,
    sentAt: card.sent_at ? new Date(String(card.sent_at)).toISOString() : null,
    sendAt: card.send_at ? new Date(String(card.send_at)).toISOString() : null,
    orderId: card.order_id ? String(card.order_id) : null,
    issuedBy: card.issued_by_name ? String(card.issued_by_name) : null,
    note: String(card.note ?? ""),
    recipientEmail: people && card.recipient_email ? String(card.recipient_email) : null,
    recipientName: people && card.recipient_name ? String(card.recipient_name) : null,
    message: people && card.message ? String(card.message) : null,
    entries: entries.map((e) => ({
      kind: String(e.kind),
      amountMinor: Number(e.amount_minor),
      at: new Date(String(e.created_at)).toISOString(),
      orderId: e.order_id ? String(e.order_id) : null,
      orderNumber: e.order_number ? String(e.order_number) : null,
      by: e.by_name ? String(e.by_name) : null,
      note: String(e.note ?? ""),
    })),
    orders: orders
      .filter((o) => o.spent)
      .map((o) => ({ id: String(o.order_id), number: String(o.number), spentMinor: Number(o.held), refundedMinor: Number(o.refunded), status: String(o.status) })),
  };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export type IssueInput = {
  amountMinor: number;
  currency: string;
  recipientEmail: string | null;
  recipientName: string | null;
  message: string | null;
  /** The language its email is written in, one of the store's. */
  lang: string;
  /** Why it was issued, for the store's own record (never shown to the person). */
  note: string;
};

export type IssueOutcome =
  | { ok: true; cardId: string; code: string; emailed: "sent" | "failed" | "not_asked" }
  | { ok: false; problem: "no_codes" | "amount" | "currency" };

/**
 * A card issued by hand: in a currency the store sells in, in the store's payment mode (a test store's cards are test cards, spent only in test
 * mode), its expiry from the settings. Its code is made at once, kept as its hash and returned to be shown once; the card is marked delivered
 * there and then (its code reached a person), and emailed to the person it is for when an address is given. Audited with the id and amount.
 */
export async function issueGiftCard(store: Pick<Store, "id" | "localization">, accountId: string, input: IssueInput): Promise<IssueOutcome> {
  const currency = input.currency.trim().toUpperCase();
  if (!isCurrency(currency) || !store.localization.currencies.some((c) => c.currency === currency)) return { ok: false, problem: "currency" };
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return { ok: false, problem: "amount" };
  const code = newGiftCode();
  if (!code) return { ok: false, problem: "no_codes" };
  const test = (await storePaymentMode(store.id)) === "test";
  const { cardId, expiresAt } = await db().transaction(async (tx) => {
    const [made] = await tx.execute<Row>(sql`
      select commerce.gift_card_issue(${store.id}::uuid, 'staff', ${currency}, ${input.amountMinor}::bigint, null, null, null, ${accountId}::uuid, ${test},
        null, ${input.recipientEmail}, ${input.recipientName}, ${input.message}, null, ${input.note.slice(0, GIFT_CARD_NOTE_MAX)}) as id
    `);
    const id = String(made.id);
    await tx.execute(sql`select commerce.gift_card_set_code(${store.id}::uuid, ${id}::uuid, ${code.hash}, ${code.last4})`);
    await tx.execute(sql`select commerce.gift_card_mark_sent(${store.id}::uuid, ${id}::uuid)`);
    const [row] = await tx.execute<Row>(sql`select expires_at from commerce.gift_cards where store_id = ${store.id}::uuid and id = ${id}::uuid`);
    return { cardId: id, expiresAt: row?.expires_at ? new Date(String(row.expires_at)).toISOString() : null };
  });
  await audit(accountId, store.id, "gift_card.issued", { card: cardId, amount_minor: input.amountMinor, currency, emailed: Boolean(input.recipientEmail), test }, { target: { type: "gift_card", id: cardId } });
  let emailed: "sent" | "failed" | "not_asked" = "not_asked";
  if (input.recipientEmail) {
    const outcome = await sendIssuedCard(store.id, {
      id: cardId,
      code: code.code,
      amountMinor: input.amountMinor,
      currency,
      to: input.recipientEmail,
      lang: input.lang,
      expiresAt,
      message: input.message,
    }).catch(() => "failed" as const);
    emailed = outcome === "sent" || outcome === "logged" ? "sent" : "failed";
  }
  return { ok: true, cardId, code: formatGiftCode(code.code), emailed };
}

export type NewCodeOutcome =
  | { ok: true; code: string; emailed: "sent" | "failed" | "not_asked" }
  | { ok: false; problem: "no_codes" | "unknown" | "not_active" | "not_delivered" | "expired" | "empty" };

/**
 * A new code for a delivered card (wave 11 unit B2, D381): a code lost or seen by someone else. Only `commerce.gift_card_new_code()` changes a
 * delivered card's code, and only for a live card with money on it; the old code stops working at once and the balance is unchanged. The new
 * code is shown once to the staff member and emailed only to the address the card was delivered to (the person it was for, else the order's
 * own address, never one typed here and never for an erased person's order); audited with the card's id, never the code.
 */
export async function sendNewGiftCardCode(storeId: string, accountId: string, cardId: string): Promise<NewCodeOutcome> {
  const code = newGiftCode();
  if (!code) return { ok: false, problem: "no_codes" };
  let answer: string;
  try {
    const [row] = await db().execute<Row>(sql`select commerce.gift_card_new_code(${storeId}::uuid, ${cardId}::uuid, ${code.hash}, ${code.last4}) as answer`);
    answer = String(row?.answer ?? "unknown");
  } catch (error) {
    if (problemOf(error) === "unknown") return { ok: false, problem: "unknown" };
    throw error;
  }
  if (answer !== "ok") return { ok: false, problem: answer as Exclude<NewCodeOutcome, { ok: true }>["problem"] };
  await audit(accountId, storeId, "gift_card.new_code", { card: cardId }, { target: { type: "gift_card", id: cardId } });
  const [card] = await db().execute<Row>(sql`
    select g.id, g.currency, g.expires_at, commerce.gift_card_balance(g.id) as balance,
      coalesce(g.recipient_email, case when o.restricted_at is null and o.anonymised_at is null then nullif(o.email, '') end) as address,
      coalesce(nullif(o.locale, ''), (select s.locales[1] from commerce.stores s where s.id = g.store_id)) as locale
    from commerce.gift_cards g
    left join commerce.orders o on o.store_id = g.store_id and o.id = g.order_id
    where g.store_id = ${storeId}::uuid and g.id = ${cardId}::uuid
  `);
  let emailed: "sent" | "failed" | "not_asked" = "not_asked";
  if (card?.address) {
    const outcome = await sendIssuedCard(
      storeId,
      {
        id: cardId,
        code: code.code,
        amountMinor: Number(card.balance),
        currency: String(card.currency).trim(),
        to: String(card.address),
        lang: String(card.locale ?? "en").slice(0, 2) || "en",
        expiresAt: card.expires_at ? new Date(String(card.expires_at)).toISOString() : null,
        message: null,
      },
      // Each new code is its own email: the one before told a code that no longer works.
      `gift-card:${cardId}:new:${code.hash.slice(0, 16)}`,
    ).catch(() => "failed" as const);
    emailed = outcome === "sent" || outcome === "logged" ? "sent" : "failed";
  }
  return { ok: true, code: formatGiftCode(code.code), emailed };
}

/** Why a change to a card was refused, in words staff read. */
export type ChangeProblem = "unknown" | "inactive" | "below_zero" | "reason" | "amount";

const problemOf = (error: unknown): ChangeProblem => {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: { message?: string } }).cause?.message ?? "")}` : String(error);
  if (text.includes("gift_cards.unknown")) return "unknown";
  if (text.includes("gift_cards.inactive")) return "inactive";
  if (text.includes("gift_card_entries.balance")) return "below_zero";
  if (text.includes("gift_card_entries_note")) return "reason";
  throw error;
};

/** Staff's change to an active card's balance, up or down, with a reason; never below zero (the ledger refuses). */
export async function adjustGiftCard(storeId: string, accountId: string, cardId: string, amountMinor: number, reason: string): Promise<{ ok: true } | { ok: false; problem: ChangeProblem }> {
  const note = reason.trim().slice(0, GIFT_CARD_NOTE_MAX);
  if (!note) return { ok: false, problem: "reason" };
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) return { ok: false, problem: "amount" };
  try {
    await db().execute(sql`select commerce.gift_card_adjust(${storeId}::uuid, ${cardId}::uuid, ${accountId}::uuid, ${amountMinor}::bigint, ${note}, ${`adjust:${crypto.randomUUID()}`})`);
  } catch (error) {
    return { ok: false, problem: problemOf(error) };
  }
  await audit(accountId, storeId, "gift_card.adjusted", { card: cardId, amount_minor: amountMinor }, { target: { type: "gift_card", id: cardId } });
  return { ok: true };
}

/** A card deactivated: what is left on it goes, and it is never spent again (orders it already paid keep their money). */
export async function deactivateGiftCard(storeId: string, accountId: string, cardId: string, reason: string): Promise<{ ok: true } | { ok: false; problem: ChangeProblem }> {
  try {
    await db().execute(sql`select commerce.gift_card_void(${storeId}::uuid, ${cardId}::uuid, ${accountId}::uuid, ${reason.trim().slice(0, GIFT_CARD_NOTE_MAX)})`);
  } catch (error) {
    return { ok: false, problem: problemOf(error) };
  }
  await audit(accountId, storeId, "gift_card.deactivated", { card: cardId }, { target: { type: "gift_card", id: cardId } });
  return { ok: true };
}

/** The store's expiry for cards issued from now on (cards already issued keep theirs): 12 to 120 months, or none. */
export async function giftCardSettings(storeId: string): Promise<{ expiryMonths: number | null }> {
  const [row] = await db().execute<Row>(sql`select expiry_months from commerce.gift_card_settings where store_id = ${storeId}::uuid`);
  return { expiryMonths: row ? (row.expiry_months === null ? null : Number(row.expiry_months)) : 36 };
}

export async function saveGiftCardSettings(storeId: string, accountId: string, expiryMonths: number | null): Promise<boolean> {
  if (expiryMonths !== null && !(Number.isInteger(expiryMonths) && expiryMonths >= 12 && expiryMonths <= 120)) return false;
  await db().execute(sql`
    insert into commerce.gift_card_settings (store_id, expiry_months, updated_at) values (${storeId}::uuid, ${expiryMonths}, now())
    on conflict (store_id) do update set expiry_months = excluded.expiry_months, updated_at = now()
  `);
  await audit(accountId, storeId, "gift_card.settings_saved", { expiry_months: expiryMonths });
  return true;
}

/**
 * The daily expiry (`/api/cron/daily`): what is left on each card past its date goes, once (`gift_card_expire()` writes nothing for a card with
 * nothing left or one expired before). A refund to a card after it expired is expired again by the next run. Never throws.
 */
export async function expireGiftCards(limit = 500): Promise<number> {
  try {
    const due = await db().execute<Row>(sql`
      select g.store_id, g.id from commerce.gift_cards g
      where g.expires_at is not null and g.expires_at <= now() and g.status = 'active' and commerce.gift_card_balance(g.id) > 0
      order by g.expires_at limit ${limit}
    `);
    let n = 0;
    for (const card of due) {
      const [done] = await db().execute<Row>(sql`select commerce.gift_card_expire(${String(card.store_id)}::uuid, ${String(card.id)}::uuid) as id`);
      if (done?.id) n += 1;
    }
    return n;
  } catch (error) {
    log("error", "gift_cards.expiry_run_failed", {}, error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// The liability report (docs/analytics.md "Gift cards")
// ---------------------------------------------------------------------------

export type GiftCardLiability = { lines: LiabilityLine[] };

/**
 * What customers hold on the store's cards now, and the period's movements, per currency (never converted or added across currencies): issued,
 * spent (an order's hold on the day it was paid, less what it gave back), refunded back, changed by staff, expired and deactivated. Only cards of
 * the store's payment mode now (`giftCardOutstanding()`). Days are the store's.
 */
export async function giftCardLiability(store: Store, period: AnalyticsPeriod): Promise<GiftCardLiability> {
  const test = (await storePaymentMode(store.id)) === "test";
  const [movements, outstanding] = await Promise.all([
    typedRows(MOVEMENT_ROW, sql`
      select trim(g.currency) as currency, e.kind,
        coalesce(sum(case when e.kind = 'spend' then commerce.gift_card_order_held(e.card_id, e.order_id) else e.amount_minor end), 0)::bigint as amount
      from commerce.gift_card_entries e
      join commerce.gift_cards g on g.store_id = e.store_id and g.id = e.card_id
      where e.store_id = ${store.id}::uuid and g.test_mode = ${test} and e.kind in ('issue', 'spend', 'refund', 'adjust', 'expire', 'void')
        and e.created_at >= ${dayStart(store, period.from)} and e.created_at < ${dayStart(store, period.to)}
      group by 1, 2
    `),
    giftCardOutstanding(store.id),
  ]);
  return { lines: liabilityLines(movements.map((m) => ({ currency: m.currency, kind: m.kind, amountMinor: m.amount })), outstanding) };
}

/** The AI manager's read-only overview: how many cards are in each state and what customers hold per currency; never a code or a person. */
export async function giftCardOverview(storeId: string): Promise<{ counts: Record<GiftCardState, number>; outstanding: { currency: string; amountMinor: number; cards: number }[] }> {
  const [counts, outstanding] = await Promise.all([giftCardCounts(storeId), giftCardOutstanding(storeId)]);
  return { counts, outstanding };
}
