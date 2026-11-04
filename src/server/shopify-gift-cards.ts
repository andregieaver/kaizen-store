import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { formatGiftCode } from "@/lib/gift-cards";
import { GIFT_CARD_PAGES_MAX, GIFT_CARDS_QUERY, amountOf, giftCardOf, type GiftCardLine } from "@/lib/shopify-settings";
import { parsePrice } from "@/lib/product-input";

import type { Membership } from "./auth";
import { audit } from "./auth";
import { sendIssuedCard } from "./gift-card-delivery";
import { newGiftCode } from "./gift-card-codes";
import { adjustGiftCard } from "./gift-cards-admin";
import { storePaymentMode } from "./host-payments";
import { log } from "./log";
import { memberCan } from "./permissions";
import { shopifyGraphql, type ShopifyDeps } from "./shopify-connect";
import { col, typedRow, typedRows } from "./typed-rows";
import { db } from "@/db/client";

/**
 * Gift cards on move day (D445 step 8, `docs/moving-from-shopify.md` 6.4, the owner's Decision 2). Shopify never gives a card's full code, so
 * every card with money left becomes a card here with the same balance, currency and expiry, tied to the same customer, made only on move
 * day (until then nobody could spend one balance in both shops), and its holder is emailed the new code, a service message about money they
 * hold. A card with no email waits for the owner: *Issue it* shows its code once. For the 14 days after, a card's old code spent on Shopify
 * is taken off its card here. Cards are made only by `commerce.gift_card_issue_moved()` (one for each Shopify card) and changed only by the
 * ledger's own functions.
 */

const OWNER = "owner" as const;
const MOVED_NOTE = "Moved from Shopify";

type Page = { giftCards?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: unknown[] } };

/** The shop's live cards with money left, read now: every page, up to the cap. Null when Shopify would not answer. */
export async function readShopifyGiftCards(storeId: string, deps: ShopifyDeps & { clock?: () => Date } = {}): Promise<GiftCardLine[] | null> {
  const today = (deps.clock ?? (() => new Date()))().toISOString().slice(0, 10);
  const out: GiftCardLine[] = [];
  let after: string | null = null;
  for (let page = 0; page < GIFT_CARD_PAGES_MAX; page++) {
    const answer: Awaited<ReturnType<typeof shopifyGraphql<Page>>> = await shopifyGraphql<Page>(storeId, GIFT_CARDS_QUERY, { after }, deps);
    if (!answer.ok) return page === 0 ? null : out;
    const conn: Page["giftCards"] = answer.data.giftCards;
    for (const node of conn?.nodes ?? []) {
      const line = giftCardOf(node, today);
      if (line) out.push(line);
    }
    after = conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor ?? null) : null;
    if (!after) return out;
  }
  log("warn", "shopify.gift_cards_capped", { storeId, pages: GIFT_CARD_PAGES_MAX });
  return out;
}

const minorOf = (line: Pick<GiftCardLine, "amount" | "currency">): number | null => parsePrice(line.amount, line.currency);

/** One Shopify card made here (idempotent: the card it replaces names it), its code set; the code returned once, or null when it was made before. */
async function issueOne(member: Membership, line: GiftCardLine): Promise<{ cardId: string; code: string | null; amountMinor: number } | null> {
  const amountMinor = minorOf(line);
  if (amountMinor === null || amountMinor <= 0) return null;
  const storeId = member.store.id;
  const existing = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.gift_cards where store_id = ${storeId}::uuid and moved_from = ${line.id}`);
  if (existing) return { cardId: existing.id, code: null, amountMinor };
  const code = newGiftCode();
  if (!code) return null;
  const test = (await storePaymentMode(storeId)) === "test";
  const customer = line.email
    ? await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.customers where store_id = ${storeId}::uuid and lower(email) = ${line.email} limit 1`)
    : null;
  const expiresAt = line.expiresOn ? `${line.expiresOn}T23:59:59Z` : null;
  const cardId = await db().transaction(async (tx) => {
    const [made] = await tx.execute<Record<string, unknown>>(sql`
      select commerce.gift_card_issue_moved(${storeId}::uuid, ${line.id}, ${line.currency}, ${amountMinor}::bigint, ${member.account.id}::uuid, ${test},
        ${customer?.id ?? null}::uuid, ${line.email}, ${expiresAt}::timestamptz, ${`${MOVED_NOTE} (…${line.last4})`}) as id
    `);
    const id = String(made.id);
    await tx.execute(sql`select commerce.gift_card_set_code(${storeId}::uuid, ${id}::uuid, ${code.hash}, ${code.last4})`);
    await tx.execute(sql`select commerce.gift_card_mark_sent(${storeId}::uuid, ${id}::uuid)`);
    return id;
  });
  await audit(member.account.id, storeId, "gift_card.moved", { card: cardId, amount_minor: amountMinor, currency: line.currency, test }, { target: { type: "gift_card", id: cardId } });
  return { cardId, code: code.code, amountMinor };
}

export type MovedCards = { issued: number; emailed: number; left: GiftCardLine[] };

/**
 * Move day's step: every card with money left on Shopify now (read just before) made here; one with a holder's email is emailed its new code,
 * one without waits for the owner. Safe to run again: a card already made is neither made nor emailed twice.
 */
export async function moveGiftCards(member: Membership, lines: readonly GiftCardLine[]): Promise<MovedCards> {
  const out: MovedCards = { issued: 0, emailed: 0, left: [] };
  if (!memberCan(member, OWNER)) return out;
  const lang = (member.store.localization.locales[0] ?? "en").slice(0, 2);
  for (const line of lines) {
    if (!line.email) {
      const made = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.gift_cards where store_id = ${member.store.id}::uuid and moved_from = ${line.id}`);
      if (!made) out.left.push(line);
      continue;
    }
    const card = await issueOne(member, line);
    if (!card) continue;
    out.issued += 1;
    if (card.code === null) continue;
    const sent = await sendIssuedCard(
      member.store.id,
      { id: card.cardId, code: card.code, amountMinor: card.amountMinor, currency: line.currency, to: line.email, lang, expiresAt: line.expiresOn ? `${line.expiresOn}T23:59:59Z` : null, message: null, movedFrom: line.last4 },
      `gift-card:${card.cardId}:moved`,
    ).catch(() => "failed" as const);
    if (sent === "sent" || sent === "logged") out.emailed += 1;
  }
  return out;
}

const NODE_QUERY = `query KaizenCopyGiftCard($id: ID!) { node(id: $id) { ... on GiftCard { id lastCharacters enabled expiresOn balance { amount currencyCode } customer { defaultEmailAddress { emailAddress } } } } }`;

/**
 * *Issue it* for a card that had no email (owner only): read again from Shopify now, made here, its code returned to be shown once (never
 * kept). Refused when Shopify no longer has money on it, or when it was made here already.
 */
export async function issueLeftGiftCard(member: Membership, shopifyId: string, deps: ShopifyDeps & { clock?: () => Date } = {}): Promise<{ ok: true; code: string; amountMinor: number; currency: string } | { ok: false; problem: "gone" | "made" | "no_codes" }> {
  if (!memberCan(member, OWNER) || !/^gid:\/\/shopify\/GiftCard\/\d+$/.test(shopifyId)) return { ok: false, problem: "gone" };
  const answer = await shopifyGraphql<{ node?: unknown }>(member.store.id, NODE_QUERY, { id: shopifyId }, deps);
  const line = answer.ok ? giftCardOf(answer.data.node, (deps.clock ?? (() => new Date()))().toISOString().slice(0, 10)) : null;
  if (!line) return { ok: false, problem: "gone" };
  const card = await issueOne(member, line);
  if (!card) return { ok: false, problem: "no_codes" };
  if (card.code === null) return { ok: false, problem: "made" };
  return { ok: true, code: formatGiftCode(card.code), amountMinor: card.amountMinor, currency: line.currency };
}

const BALANCES_QUERY = `query KaizenCopyGiftBalances($after: String) { giftCards(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id balance { amount currencyCode } } } }`;

/**
 * The daily look's part for gift cards (step 7c): each card made here from Shopify, its Shopify balance read again (a switched-off card too:
 * its balance still says what was spent). What was spent there since the last look is taken off the card here, never below zero, with the
 * reason in its ledger. Returns how many cards it lowered.
 */
export async function lowerSpentOnShopify(member: Membership, deps: ShopifyDeps = {}): Promise<number> {
  if (!memberCan(member, OWNER)) return 0;
  const storeId = member.store.id;
  const moved = await typedRows(
    z.object({ id: col.uuid, moved_from: col.text, moved_balance_minor: col.minor, currency: col.currency, balance: col.minor }),
    sql`select id, moved_from, moved_balance_minor, currency, commerce.gift_card_balance(id) as balance from commerce.gift_cards
         where store_id = ${storeId}::uuid and moved_from is not null and status = 'active'`,
  );
  if (moved.length === 0) return 0;
  const now = new Map<string, { amount: string; currency: string }>();
  let after: string | null = null;
  for (let page = 0; page < GIFT_CARD_PAGES_MAX; page++) {
    type Balances = { giftCards?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: { id?: string; balance?: { amount?: string; currencyCode?: string } }[] } };
    const answer: Awaited<ReturnType<typeof shopifyGraphql<Balances>>> = await shopifyGraphql<Balances>(storeId, BALANCES_QUERY, { after }, deps);
    if (!answer.ok) return 0;
    for (const n of answer.data.giftCards?.nodes ?? []) {
      const amount = amountOf(n.balance?.amount);
      if (n.id && amount !== null && n.balance?.currencyCode) now.set(n.id, { amount, currency: n.balance.currencyCode });
    }
    after = answer.data.giftCards?.pageInfo?.hasNextPage ? (answer.data.giftCards.pageInfo.endCursor ?? null) : null;
    if (!after) break;
  }
  let lowered = 0;
  for (const card of moved) {
    const there = now.get(card.moved_from);
    if (!there || there.currency !== card.currency) continue;
    const seen = parsePrice(there.amount, card.currency);
    if (seen === null || seen >= card.moved_balance_minor) continue;
    const spent = Math.min(card.moved_balance_minor - seen, card.balance);
    if (spent > 0) {
      const done = await adjustGiftCard(storeId, member.account.id, card.id, -spent, "Spent on Shopify after the move");
      if (done.ok) lowered += 1;
      else log("warn", "shopify.gift_card_lower_refused", { storeId, problem: done.problem });
    }
    await db().execute(sql`select commerce.gift_card_moved_seen(${storeId}::uuid, ${card.id}::uuid, ${seen}::bigint)`);
  }
  return lowered;
}
