import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  cardActiveTo,
  cardAnswerSchema,
  cardRequest,
  chargeOf,
  lastFour,
  purchaseAfter,
  purchaseAmount,
  purchaseWords,
  transactionsSchema,
  walletProblem,
  walletProblemWords,
  type Charge,
  type PurchaseInput,
  type WalletProblem,
} from "@/lib/card-wallet";

import { audit, type Account } from "./auth";
import { getWallet, walletCall, type CardWallet, type WalletDeps } from "./card-wallet";
import { log } from "./log";
import type { Store } from "./stores";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Purchases the owner approved for the AI (D599, step 2 of `docs/agent-spending.md`): the only writer of `commerce.agent_purchases` and
 * `commerce.agent_purchase_charges`. A purchase is made only on the owner's yes (the AI manager's `request_purchase`, gate `spend`, never
 * automatic in this step), checked against the wallet (connected, a cardholder, not paused, a monthly limit and what is left of it) under
 * the wallet row's lock, so two yeses never pass one limit together. Then one single-use virtual card is made in the owner's Airwallex
 * account for it; the owner pays with it in their own app. The five-minute job reads each open card's charges, keeps them, and closes the
 * card once it has been charged or its window is over. Never a card number: its id and last four digits.
 */

export type PurchaseStatus = "issuing" | "card_ready" | "spent" | "closed" | "cancelled" | "failed";

export type AgentPurchase = {
  id: string;
  what: string;
  merchant: string;
  merchantUrl: string | null;
  why: string;
  amountMinor: number;
  currency: string;
  spentMinor: number;
  status: PurchaseStatus;
  cardId: string | null;
  cardLast4: string | null;
  activeTo: string;
  failure: string | null;
  createdAt: string;
  lastMerchant: string | null;
};

const purchaseRow = z.object({
  id: col.uuid,
  what: col.text,
  merchant: col.text,
  merchant_url: col.textOrNull,
  why: col.text,
  amount_minor: col.minor,
  currency: col.currency,
  spent_minor: col.minor,
  status: z.enum(["issuing", "card_ready", "spent", "closed", "cancelled", "failed"]),
  card_id: col.textOrNull,
  card_last4: col.textOrNull,
  active_to: col.timestamp,
  failure: col.textOrNull,
  created_at: col.timestamp,
  last_merchant: col.textOrNull,
});

const toPurchase = (r: z.output<typeof purchaseRow>): AgentPurchase => ({
  id: r.id,
  what: r.what,
  merchant: r.merchant,
  merchantUrl: r.merchant_url,
  why: r.why,
  amountMinor: r.amount_minor,
  currency: r.currency,
  spentMinor: r.spent_minor,
  status: r.status,
  cardId: r.card_id,
  cardLast4: r.card_last4,
  activeTo: r.active_to,
  failure: r.failure,
  createdAt: r.created_at,
  lastMerchant: r.last_merchant,
});

const SELECT = sql`
  select p.id, p.what, p.merchant, p.merchant_url, p.why, p.amount_minor, p.currency, p.spent_minor, p.status, p.card_id, p.card_last4, p.active_to,
         p.failure, p.created_at,
         (select c.merchant_name from commerce.agent_purchase_charges c where c.purchase_id = p.id and c.merchant_name is not null order by c.happened_at desc limit 1) as last_merchant
    from commerce.agent_purchases p`;

/** The store's purchases, newest first. */
export async function listPurchases(storeId: string, limit = 20): Promise<AgentPurchase[]> {
  const rows = await typedRows(purchaseRow, sql`${SELECT} where p.store_id = ${storeId}::uuid order by p.created_at desc limit ${Math.min(Math.max(limit, 1), 100)}`);
  return rows.map(toPurchase);
}

export async function getPurchase(storeId: string, id: string): Promise<AgentPurchase | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await typedRow(purchaseRow, sql`${SELECT} where p.store_id = ${storeId}::uuid and p.id = ${id}::uuid`);
  return row ? toPurchase(row) : null;
}

/**
 * What the wallet's cards have taken this calendar month in the store's time zone, in the wallet's currency: an open purchase's whole
 * amount (it may still be charged that much), a charged or closed one's spend.
 */
export async function monthTaken(storeId: string, currency: string, timeZone: string, executor: Executor = db()): Promise<number> {
  const row = await typedRow(
    z.object({ taken: col.minor }),
    sql`
      select coalesce(sum(case when status in ('issuing', 'card_ready') then amount_minor else spent_minor end), 0) as taken
        from commerce.agent_purchases
       where store_id = ${storeId}::uuid and currency = ${currency}
         and created_at >= (date_trunc('month', now() at time zone ${timeZone}) at time zone ${timeZone})
    `,
    executor,
  );
  return row?.taken ?? 0;
}

export type PurchasePreview =
  | { ok: true; wallet: CardWallet; amountMinor: number; takenMinor: number; words: string }
  | { ok: false; problem: WalletProblem; words: string };

/** Checks a purchase against the wallet as it is now, without making it: the approval's words, the preflight and the tool's refusal. */
export async function previewPurchase(store: Store, input: PurchaseInput): Promise<PurchasePreview> {
  const wallet = await getWallet(store.id);
  const amountMinor = wallet ? purchaseAmount(input.amount, wallet.currency) : null;
  const takenMinor = wallet ? await monthTaken(store.id, wallet.currency, store.timeZone) : 0;
  const problem = walletProblem(wallet, takenMinor, amountMinor);
  if (problem || !wallet || amountMinor === null) {
    const p = problem ?? "not_connected";
    return { ok: false, problem: p, words: walletProblemWords(p, { currency: wallet?.currency, limitMinor: wallet?.limitMinor, takenMinor }) };
  }
  return {
    ok: true,
    wallet,
    amountMinor,
    takenMinor,
    words: purchaseWords({ what: input.what, merchant: input.merchant, amountMinor, currency: wallet.currency, url: input.url ?? null }, wallet.cardholderName),
  };
}

export type MadePurchase = { ok: true; purchase: AgentPurchase } | { ok: false; problem: WalletProblem | "card_refused" | "card_unreachable"; words: string; purchaseId?: string };

/**
 * Makes a purchase on the owner's yes: the wallet checked again under its row's lock and the purchase kept as `issuing` in one transaction,
 * then the card asked of Airwallex (the purchase's id as the request's id, so a retry never makes a second card). A refused card leaves the
 * purchase `failed` with the reason; an unanswered one is settled by the job.
 */
export async function makePurchase(store: Store, actor: Account, input: PurchaseInput, deps: WalletDeps = {}): Promise<MadePurchase> {
  const now = (deps.now ?? (() => new Date()))();
  const kept = await db().transaction(async (tx) => {
    await tx.execute(sql`select 1 from commerce.card_wallets where store_id = ${store.id}::uuid for update`);
    const wallet = await getWallet(store.id);
    const amountMinor = wallet ? purchaseAmount(input.amount, wallet.currency) : null;
    const takenMinor = wallet ? await monthTaken(store.id, wallet.currency, store.timeZone, tx) : 0;
    const problem = walletProblem(wallet, takenMinor, amountMinor);
    if (problem || !wallet || amountMinor === null) {
      const p = problem ?? "not_connected";
      return { ok: false as const, problem: p, words: walletProblemWords(p, { currency: wallet?.currency, limitMinor: wallet?.limitMinor, takenMinor }) };
    }
    const row = await typedRow(
      z.object({ id: col.uuid }),
      sql`
      insert into commerce.agent_purchases (store_id, wallet_id, what, merchant, merchant_url, why, amount_minor, currency, status, active_to, approved_by)
      values (${store.id}::uuid, ${wallet.id}::uuid, ${input.what}, ${input.merchant}, ${input.url ?? null}, ${input.why}, ${amountMinor}, ${wallet.currency}, 'issuing',
              ${cardActiveTo(now).toISOString()}::timestamptz, ${actor.id}::uuid)
      returning id
    `,
      tx,
    );
    return { ok: true as const, id: row!.id, wallet, amountMinor };
  });
  if (!kept.ok) return kept;
  const body = cardRequest({ id: kept.id, what: input.what, amountMinor: kept.amountMinor, currency: kept.wallet.currency }, { cardholderId: kept.wallet.cardholderId! }, actor.name ?? actor.email, now);
  const card = await walletCall(store.id, "POST", "/api/v1/issuing/cards/create", cardAnswerSchema, body, deps);
  if (!card.ok) {
    if (card.problem === "unreachable") {
      // The card may have been made: the job asks again with the same request id before giving up.
      return { ok: false, problem: "card_unreachable", purchaseId: kept.id, words: "Airwallex did not answer. The purchase is kept and checked again within minutes." };
    }
    await db().execute(sql`
      update commerce.agent_purchases set status = 'failed', failure = ${`card_${card.problem}`.slice(0, 40)}, closed_at = now(), updated_at = now()
       where store_id = ${store.id}::uuid and id = ${kept.id}::uuid
    `);
    await audit(actor.id, store.id, "ai.purchase_card_refused", { purchase: kept.id, status: card.status ?? null, code: card.code ?? null });
    return { ok: false, problem: "card_refused", purchaseId: kept.id, words: `Airwallex refused to make the card${card.code ? ` (${card.code})` : ""}. Nothing was charged.` };
  }
  await db().execute(sql`
    update commerce.agent_purchases set status = 'card_ready', card_id = ${card.value.card_id}, card_last4 = ${lastFour(card.value.card_number)}, updated_at = now()
     where store_id = ${store.id}::uuid and id = ${kept.id}::uuid
  `);
  await audit(actor.id, store.id, "ai.purchase_card_made", { purchase: kept.id, amountMinor: kept.amountMinor, currency: kept.wallet.currency }, { target: { type: "agent_purchase", id: kept.id } });
  return { ok: true, purchase: (await getPurchase(store.id, kept.id))! };
}

const anyAnswer = z.unknown();

/** Closes a card in Airwallex; true when Airwallex took it (a card already closed answers so too). */
async function closeCard(storeId: string, cardId: string, deps: WalletDeps): Promise<boolean> {
  const done = await walletCall(storeId, "POST", `/api/v1/issuing/cards/${encodeURIComponent(cardId)}/update`, anyAnswer, { card_status: "CLOSED" }, deps);
  if (!done.ok) log("warn", "agent_purchases.close_failed", { storeId, problem: done.problem, status: done.status ?? null });
  return done.ok;
}

/** The owner calls a purchase off: its card closed, and the purchase `cancelled` unless it was charged already (then only the card closes). */
export async function cancelPurchase(storeId: string, actorId: string, purchaseId: string, deps: WalletDeps = {}): Promise<{ ok: true; charged: boolean } | { ok: false; problem: "unknown" | "over" | "unreachable" }> {
  const p = await getPurchase(storeId, purchaseId);
  if (!p) return { ok: false, problem: "unknown" };
  if (!["issuing", "card_ready", "spent"].includes(p.status)) return { ok: false, problem: "over" };
  if (p.cardId && !(await closeCard(storeId, p.cardId, deps))) return { ok: false, problem: "unreachable" };
  const charged = p.status === "spent";
  await db().execute(sql`
    update commerce.agent_purchases set status = ${charged ? "closed" : "cancelled"}, closed_at = now(), updated_at = now()
     where store_id = ${storeId}::uuid and id = ${purchaseId}::uuid
  `);
  await audit(actorId, storeId, "ai.purchase_cancelled", { purchase: purchaseId, charged }, { target: { type: "agent_purchase", id: purchaseId } });
  return { ok: true, charged };
}

/** The owner's kill switch: every open purchase's card closed now. Returns how many it closed. */
export async function closeOpenCards(storeId: string, actorId: string, deps: WalletDeps = {}): Promise<number> {
  const open = await typedRows(z.object({ id: col.uuid }), sql`select id from commerce.agent_purchases where store_id = ${storeId}::uuid and status in ('issuing', 'card_ready', 'spent')`);
  let closed = 0;
  for (const p of open) if ((await cancelPurchase(storeId, actorId, p.id, deps)).ok) closed++;
  return closed;
}

// ---------------------------------------------------------------------------------------------------------------------
// The five-minute job
// ---------------------------------------------------------------------------------------------------------------------

const openRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  status: z.enum(["issuing", "card_ready", "spent"]),
  card_id: col.textOrNull,
  currency: col.currency,
  amount_minor: col.minor,
  what: col.text,
  active_to: col.timestamp,
  created_at: col.timestamp,
  approved_by: col.uuid,
  cardholder_id: col.textOrNull,
});

/** Purchases looked at in one run, oldest first. */
const PER_RUN = 60;

/**
 * Every open purchase's card read again (D599): its charges kept once each, its spend and state worked out (`purchaseAfter()`), and the card
 * closed once charged or out of time. A purchase still `issuing` (Airwallex did not answer) is asked for again with the same request id, and
 * failed after an hour. Never throws for one purchase; returns counts.
 */
export async function syncAgentPurchases(deps: WalletDeps & { deadline?: number } = {}): Promise<{ looked: number; charged: number; closed: number; failed: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const deadline = deps.deadline ?? Date.now() + 60_000;
  const open = await typedRows(
    openRow,
    sql`
      select p.id, p.store_id, p.status, p.card_id, p.currency, p.amount_minor, p.what, p.active_to, p.created_at, p.approved_by, w.cardholder_id
        from commerce.agent_purchases p left join commerce.card_wallets w on w.store_id = p.store_id
       where p.status in ('issuing', 'card_ready', 'spent') and p.created_at > now() - interval '40 days'
       order by p.updated_at limit ${PER_RUN}
    `,
  );
  const counts = { looked: 0, charged: 0, closed: 0, failed: 0 };
  for (const p of open) {
    if (Date.now() > deadline) break;
    counts.looked++;
    try {
      if (p.status === "issuing" || !p.card_id) {
        counts.failed += (await settleIssuing(p, now, deps)) ? 0 : 1;
        continue;
      }
      const answer = await walletCall(
        p.store_id,
        "GET",
        `/api/v1/issuing/transactions?card_id=${encodeURIComponent(p.card_id)}&from_created_at=${encodeURIComponent(p.created_at)}&page_size=100`,
        transactionsSchema,
        null,
        deps,
      );
      if (!answer.ok) {
        await db().execute(sql`update commerce.agent_purchases set updated_at = now() where store_id = ${p.store_id}::uuid and id = ${p.id}::uuid`);
        continue;
      }
      const charges = answer.value.items.filter((t) => !t.card_id || t.card_id === p.card_id).map((t) => chargeOf(t, p.currency)).filter((c): c is Charge => c !== null);
      for (const c of charges) {
        await db().execute(sql`
          insert into commerce.agent_purchase_charges (store_id, purchase_id, provider_ref, kind, status, amount_minor, currency, merchant_name, merchant_category, happened_at)
          values (${p.store_id}::uuid, ${p.id}::uuid, ${c.ref.slice(0, 120)}, ${c.kind}, ${c.status}, ${c.amountMinor}, ${c.currency}, ${c.merchantName}, ${c.merchantCategory},
                  ${c.at.toISOString()}::timestamptz)
          on conflict (store_id, provider_ref) do update set status = excluded.status, amount_minor = excluded.amount_minor
        `);
      }
      const kept = await typedRows(
        z.object({ kind: z.enum(["authorization", "clearing", "reversal", "refund", "other"]), status: col.text, amount_minor: col.minor }),
        sql`select kind, status, amount_minor from commerce.agent_purchase_charges where store_id = ${p.store_id}::uuid and purchase_id = ${p.id}::uuid`,
      );
      const next = purchaseAfter({ status: p.status, activeTo: new Date(p.active_to) }, kept.map((k) => ({ kind: k.kind, status: k.status, amountMinor: k.amount_minor })), now);
      const closedNow = next.close && (await closeCard(p.store_id, p.card_id, deps));
      const status = next.status === "closed" && !closedNow ? (next.spentMinor > 0 ? "spent" : p.status) : next.status;
      await db().execute(sql`
        update commerce.agent_purchases set status = ${status}, spent_minor = ${Math.min(next.spentMinor, 100_000_000_000)},
               closed_at = ${status === "closed" ? sql`coalesce(closed_at, now())` : sql`closed_at`}, updated_at = now()
         where store_id = ${p.store_id}::uuid and id = ${p.id}::uuid
      `);
      if (next.spentMinor > 0 && p.status === "card_ready") counts.charged++;
      if (status === "closed") counts.closed++;
    } catch (error) {
      log("error", "agent_purchases.sync_failed", { storeId: p.store_id, purchase: p.id }, error);
    }
  }
  return counts;
}

/** A purchase whose card call went unanswered: asked again with the same request id (Airwallex ignores a repeat); failed after an hour. */
async function settleIssuing(p: z.output<typeof openRow>, now: Date, deps: WalletDeps): Promise<boolean> {
  const ageMs = now.getTime() - new Date(p.created_at).getTime();
  if (ageMs > 3_600_000 || !p.cardholder_id) {
    await db().execute(sql`
      update commerce.agent_purchases set status = 'failed', failure = 'card_unanswered', closed_at = now(), updated_at = now()
       where store_id = ${p.store_id}::uuid and id = ${p.id}::uuid and status = 'issuing'
    `);
    return false;
  }
  const body = cardRequest({ id: p.id, what: p.what, amountMinor: p.amount_minor, currency: p.currency }, { cardholderId: p.cardholder_id }, "Kaizena Flow", new Date(p.created_at));
  const card = await walletCall(p.store_id, "POST", "/api/v1/issuing/cards/create", cardAnswerSchema, body, deps);
  if (card.ok) {
    await db().execute(sql`
      update commerce.agent_purchases set status = 'card_ready', card_id = ${card.value.card_id}, card_last4 = ${lastFour(card.value.card_number)}, updated_at = now()
       where store_id = ${p.store_id}::uuid and id = ${p.id}::uuid and status = 'issuing'
    `);
    return true;
  }
  await db().execute(sql`update commerce.agent_purchases set updated_at = now() where store_id = ${p.store_id}::uuid and id = ${p.id}::uuid`);
  return true;
}
