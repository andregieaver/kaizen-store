import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { copyDone, copyFailed, copyStateOf } from "@/lib/shopify-copy";
import {
  EMPTY_MOVE,
  LEFT_CARDS_MAX,
  WATCH_DAYS,
  closeReady,
  moveDue,
  moveStateOf,
  nextMoveStep,
  readiness,
  scheduleProblem,
  watchDay,
  watchDue,
  watchShown,
  type MoveState,
  type ReadyCheck,
} from "@/lib/shopify-move";
import { toInstant } from "@/lib/tracking-phases";

import { passMembership, type Membership } from "./auth";
import { log } from "./log";
import { fixOldShop, oldShopCheck, readOldShop } from "./old-shop";
import { memberCan } from "./permissions";
import { setPrivateMode } from "./private-mode";
import { getSetupProgress } from "./setup";
import { shopifyConnection } from "./shopify-connect";
import { moverGet, wooConnection } from "./woocommerce-connect";
import { giftCardLinesOf } from "@/lib/woocommerce-mover";
import type { GiftCardLine } from "@/lib/shopify-settings";
import { advanceCopy, startCatchUp, type CopyDeps } from "./shopify-copy";
import { makersView } from "./shopify-makers";
import { issueLeftGiftCard, issueReadGiftCard, lowerSpentOnShopify, lowerSpentOnWoo, moveGiftCards, readShopifyGiftCards } from "./shopify-gift-cards";
import { addressView, type AddressDeps } from "./shopify-address";
import { col, typedRow, typedRows } from "./typed-rows";
import { db } from "@/db/client";

/**
 * Move day, part 1 (D445 step 7a, `docs/moving-from-shopify.md` 4.6, the steps in `src/lib/shopify-move.ts`): *Ready to move?*, then
 * *Move my shop* now or at a chosen time. The move is `shop_moves.move` (this module is its writer), moved on under a short lease by the
 * open page and by the five-minute job (`runDueMoves()`), which acts as the owner who pressed (`passMembership()`, checked again each
 * time). Each step goes through the writer that owns its table: the copy's imports, `fixOldShop()`, `setPrivateMode()`. The owner's.
 */

const OWNER = "owner" as const;
const LEASE_SECONDS = 90;

export type MoveDeps = CopyDeps & {
  now?: () => Date;
  /** Reads the old shop's links (the real one fetches its sitemap). */
  readOld?: (member: Membership, address: string) => Promise<{ ok: boolean }>;
};

const MOVE_ROW = z.object({ move: z.unknown(), copy: z.unknown(), source: z.string() });

/** The connected shop's move, of whichever platform (one at a time, D446). */
async function rowOf(storeId: string): Promise<{ move: MoveState; copy: ReturnType<typeof copyStateOf>; source: "shopify" | "woocommerce" } | null> {
  const row = await typedRow(MOVE_ROW, sql`select move, copy, source from commerce.shop_moves where store_id = ${storeId}::uuid and status = 'connected' order by connected_at desc nulls last limit 1`);
  return row ? { move: moveStateOf(row.move), copy: copyStateOf(row.copy), source: row.source === "woocommerce" ? "woocommerce" : "shopify" } : null;
}

async function saveMove(storeId: string, state: MoveState): Promise<void> {
  await db().execute(sql`
    update commerce.shop_moves set move = ${JSON.stringify(state)}::jsonb, updated_at = now()
     where store_id = ${storeId}::uuid and status = 'connected'
  `);
}

/** Takes the move's lease, or null when another tick holds it or nothing is connected. */
async function lease(storeId: string): Promise<MoveState | null> {
  const row = await typedRow(
    z.object({ move: z.unknown() }),
    sql`
      update commerce.shop_moves
         set move = jsonb_set(move, '{lease}', to_jsonb((now() + make_interval(secs => ${LEASE_SECONDS}))::text))
       where store_id = ${storeId}::uuid and status = 'connected'
         and (move->>'lease' is null or (move->>'lease')::timestamptz < now())
      returning move
    `,
  );
  return row ? moveStateOf(row.move) : null;
}

/**
 * A WooCommerce shop's gift cards with money left now (D446 step 5), read again through our plugin just before they are made; none without
 * the plugin (its cards could not be read). Null when the plugin would not answer.
 */
async function readWooGiftCards(storeId: string, deps: MoveDeps): Promise<GiftCardLine[] | null> {
  const today = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const lines: GiftCardLine[] = [];
  for (let page = 1; page <= 40; page += 1) {
    const got = await moverGet(storeId, "gift_cards", { page }, deps);
    if (!got.ok) return got.problem === "none" ? lines : page === 1 ? null : lines;
    const read = giftCardLinesOf(got.data, today);
    lines.push(...read.lines);
    if (!read.more) break;
  }
  return lines;
}

/** The move as it stands (owner only), without *Ready to move?*'s checks: for the copy's own panel. */
export async function moveStatus(member: Membership): Promise<MoveState | null> {
  if (!memberCan(member, OWNER)) return null;
  return (await rowOf(member.store.id))?.move ?? null;
}

export type MoveView = { state: MoveState; checks: ReadyCheck[]; canMove: boolean; timeZone: string };

/** What the page shows (owner only): the move as it stands and, before it, *Ready to move?*. Null when no shop is connected. */
export async function moveView(member: Membership, deps: MoveDeps = {}): Promise<MoveView | null> {
  if (!memberCan(member, OWNER)) return null;
  const row = await rowOf(member.store.id);
  if (!row) return null;
  const [progress, links, makers] = await Promise.all([getSetupProgress(member.store), oldShopCheck(member), makersView(member, deps)]);
  const { checks, canMove } = readiness({
    payments: progress.payments && progress.paymentsOn,
    copyDone: row.copy.apply && copyDone(row.copy),
    copyFailed: copyFailed(row.copy),
    links: links ? { total: links.total, working: links.working } : null,
    makersLeft: (makers?.groups ?? []).reduce((n, g) => n + g.count, 0),
  });
  return { state: row.move, checks, canMove, timeZone: member.store.timeZone };
}

export type MoveProblem = "not_ready" | "busy" | "invalid" | "past" | "far" | "gone";

/** *Move my shop* now: refused unless the shop is ready and no move is running; then its first step. */
export async function startMove(member: Membership, deps: MoveDeps = {}): Promise<{ ok: true } | { ok: false; problem: MoveProblem }> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "gone" };
  const view = await moveView(member, deps);
  if (!view) return { ok: false, problem: "gone" };
  if (view.state.status === "moving" || view.state.status === "moved") return { ok: false, problem: "busy" };
  if (!view.canMove) return { ok: false, problem: "not_ready" };
  const now = (deps.now ?? (() => new Date()))();
  await saveMove(member.store.id, { ...EMPTY_MOVE, status: "moving", by: member.account.id, startedAt: now.toISOString() });
  log("info", "shopify.move_started", { storeId: member.store.id, scheduled: false });
  await advanceMove(member, deps);
  return { ok: true };
}

/** *Choose a time*: the move starts by itself then (a wall-clock time in the store's time zone), if the shop is ready by then. */
export async function scheduleMove(member: Membership, local: string, deps: MoveDeps = {}): Promise<{ ok: true; at: string } | { ok: false; problem: MoveProblem }> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "gone" };
  const row = await rowOf(member.store.id);
  if (!row) return { ok: false, problem: "gone" };
  if (row.move.status === "moving" || row.move.status === "moved") return { ok: false, problem: "busy" };
  const at = toInstant(String(local ?? "").slice(0, 40), member.store.timeZone);
  const problem = scheduleProblem(at, (deps.now ?? (() => new Date()))());
  if (problem || !at) return { ok: false, problem: problem ?? "invalid" };
  await saveMove(member.store.id, { ...EMPTY_MOVE, status: "scheduled", at, by: member.account.id });
  log("info", "shopify.move_scheduled", { storeId: member.store.id });
  return { ok: true, at };
}

/** Takes back a scheduled move (a running one goes on: its steps are safe to finish). */
export async function cancelMove(member: Membership): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const row = await rowOf(member.store.id);
  if (!row || row.move.status !== "scheduled") return { ok: false };
  await saveMove(member.store.id, EMPTY_MOVE);
  return { ok: true };
}

/**
 * One step of a running move (the page's tick, or the five-minute job): the step in hand advanced once, under the lease. Returns the move as
 * it is after, or null for someone who is not the owner. Every step is safe to repeat.
 */
export async function advanceMove(member: Membership, deps: MoveDeps = {}): Promise<MoveState | null> {
  if (!memberCan(member, OWNER)) return null;
  const storeId = member.store.id;
  const leased = await lease(storeId);
  if (!leased) return (await rowOf(storeId))?.move ?? null;
  const state: MoveState = { ...leased, steps: { ...leased.steps } };
  try {
    if (state.status !== "moving") return state;
    const step = nextMoveStep(state);
    if (step === "catch_up") {
      const copy = (await rowOf(storeId))?.copy;
      if (!copy) state.steps.catch_up = { stage: "failed", problem: "shopify" };
      else if (state.steps.catch_up.stage === "waiting") {
        // Everything Shopify made since the copy that was brought over began.
        const since = copy.since ?? copy.startedAt ?? state.startedAt ?? new Date().toISOString();
        const started = await startCatchUp(member, since);
        state.steps.catch_up = started.ok ? { stage: "running" } : { stage: "failed", problem: "shopify" };
      } else {
        const after = await advanceCopy(member, deps);
        if (after && copyDone(after)) {
          const brought = (["products", "customers", "orders"] as const).reduce((n, f) => n + (after.feeds[f].stage === "done" ? (after.feeds[f].count ?? 0) : 0), 0);
          state.steps.catch_up = { stage: "done", done: brought, failed: copyFailed(after) };
        }
      }
    } else if (step === "links" && (await rowOf(storeId))?.source === "woocommerce" && (await rowOf(storeId))?.copy.options?.wordpress === "keep") {
      // WordPress keeps its address and its pages (D446 4.6): its old shop links lead on through the plugin's own switch, not here.
      state.steps.links = { stage: "done", done: 0, failed: 0 };
    } else if (step === "links") {
      let read = await oldShopCheck(member);
      if (!read) {
        const connection = await shopifyConnection(member);
        const woo = connection ? null : await wooConnection(member);
        const address = connection ? (connection.primaryDomain ?? connection.shop) : woo ? woo.site : null;
        const reader = deps.readOld ?? ((m: Membership, a: string) => readOldShop(m, a));
        if (address) await reader(member, address).catch(() => ({ ok: false }));
        read = await oldShopCheck(member);
      }
      if (!read) state.steps.links = { stage: "failed", problem: "links_unread" };
      else {
        const fixed = await fixOldShop(member);
        state.steps.links = fixed.ok ? { stage: "done", done: fixed.written, failed: fixed.refused } : { stage: "failed", problem: "not_allowed" };
      }
    } else if (step === "gift_cards") {
      // Read again now, just before they are made: a balance spent on the old shop since the copy is not given twice.
      const lines = (await rowOf(storeId))?.source === "woocommerce" ? await readWooGiftCards(storeId, deps) : await readShopifyGiftCards(storeId, deps);
      if (lines === null) state.steps.gift_cards = { stage: "failed", problem: "shopify" };
      else {
        const moved = await moveGiftCards(member, lines);
        state.steps.gift_cards = { stage: "done", done: moved.issued, failed: moved.left.length, ...(moved.left.length > 0 ? { left: moved.left.slice(0, LEFT_CARDS_MAX).map(({ id, last4, amount, currency, expiresOn }) => ({ id, last4, amount, currency, expiresOn })) } : {}) };
      }
    } else if (step === "open") {
      if (!member.store.setupCompletedAt) state.steps.open = { stage: "failed", problem: "setup" };
      else {
        const opened = await setPrivateMode(member, false);
        state.steps.open = opened.ok ? { stage: "done" } : { stage: "failed", problem: opened.problem === "trial_ended" ? "trial_ended" : "not_allowed" };
      }
    }
    if (nextMoveStep(state) === null) {
      state.status = "moved";
      state.finishedAt = (deps.now ?? (() => new Date()))().toISOString();
      log("info", "shopify.moved", { storeId, failed: Object.values(state.steps).filter((s) => s.stage === "failed").length });
    }
    return state;
  } catch (error) {
    log("error", "shopify.move_step_failed", { storeId }, error);
    return state;
  } finally {
    await saveMove(storeId, state);
  }
}

/**
 * The five-minute job's part (`runJobs()`): a scheduled move that is due starts, and a running one is moved on for up to a minute, each as
 * the owner who asked (an owner who is no longer one, or a disabled account, ends it untouched). One store never stops the others.
 */
export async function runDueMoves(deps: MoveDeps = {}): Promise<{ started: number; moved: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const rows = await typedRows(
    z.object({ store_id: col.uuid, slug: col.text, move: z.unknown() }),
    sql`
      select m.store_id, s.slug, m.move from commerce.shop_moves m join commerce.stores s on s.id = m.store_id
       where m.status = 'connected' and m.move->>'status' in ('scheduled', 'moving', 'moved')
       limit 20
    `,
  );
  const totals = { started: 0, moved: 0 };
  for (const row of rows) {
    try {
      let state = moveStateOf(row.move);
      if (state.status === "scheduled" && !moveDue(state, now)) continue;
      // A moved shop: only its daily look at Shopify (step 7c), when due or running.
      if (state.status === "moved" && !(state.watch.running || watchDue(state, now))) continue;
      const member = state.by ? await passMembership(row.slug, state.by) : null;
      if (!member || !memberCan(member, OWNER)) {
        await saveMove(row.store_id, EMPTY_MOVE);
        log("warn", "shopify.move_owner_gone", { storeId: row.store_id });
        continue;
      }
      if (state.status === "scheduled") {
        const view = await moveView(member, deps);
        if (!view?.canMove) {
          await saveMove(row.store_id, { ...EMPTY_MOVE, missed: state.at });
          log("warn", "shopify.move_not_ready", { storeId: row.store_id });
          continue;
        }
        state = { ...EMPTY_MOVE, status: "moving", by: state.by, startedAt: now.toISOString() };
        await saveMove(row.store_id, state);
        totals.started += 1;
      }
      const until = Date.now() + 60_000;
      if (state.status === "moved") {
        // One step each run: its imports run in the same job (`runDataJobs()`), and Shopify's read is asked about again next time.
        await advanceWatch(member, deps);
        continue;
      }
      while (Date.now() < until) {
        const after = await advanceMove(member, deps);
        if (!after || after.status !== "moving" || after.steps.catch_up.stage === "running") break;
      }
      if ((await rowOf(row.store_id))?.move.status === "moved") totals.moved += 1;
    } catch (error) {
      log("error", "shopify.move_run_failed", { storeId: row.store_id }, error);
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// The 14 days after (D445 step 7c, `docs/moving-from-shopify.md` 4.8)
// ---------------------------------------------------------------------------

/** What the daily look reads from Shopify: new customers first, so an order is tied to its customer by email. */
const WATCH_FEEDS = ["customers", "orders"] as const;

/**
 * One step of the daily look at Shopify (the five-minute job): when due, a catch-up of the customers and orders made there since the last
 * look; while it runs, moved on; when done, how many orders it brought, said on the card. Under the move's lease. Safe to repeat.
 */
export async function advanceWatch(member: Membership, deps: MoveDeps = {}): Promise<MoveState | null> {
  if (!memberCan(member, OWNER)) return null;
  const storeId = member.store.id;
  const leased = await lease(storeId);
  if (!leased) return (await rowOf(storeId))?.move ?? null;
  const state: MoveState = { ...leased, watch: { ...leased.watch } };
  const now = (deps.now ?? (() => new Date()))();
  try {
    if (!watchShown(state)) return state;
    if (state.watch.running) {
      const after = await advanceCopy(member, deps);
      if (after && copyDone(after)) {
        const found = after.feeds.orders.stage === "done" ? (after.feeds.orders.count ?? 0) : 0;
        // A moved gift card's old code spent on Shopify since: taken off its card here.
        const lowered = await ((await rowOf(storeId))?.source === "woocommerce"
          ? lowerSpentOnWoo(member, (page) => moverGet(storeId, "gift_cards", { page, all: 1 }, deps))
          : lowerSpentOnShopify(member, deps)
        ).catch((error: unknown) => {
          log("error", "shopify.gift_cards_lower_failed", { storeId }, error);
          return 0;
        });
        state.watch = { ...state.watch, running: false, checkedAt: now.toISOString(), found: state.watch.found + found, lastFound: found, cardsLowered: state.watch.cardsLowered + lowered };
        log("info", "shopify.watch_checked", { storeId, found });
      }
    } else if (watchDue(state, now)) {
      const since = state.watch.checkedAt ?? state.finishedAt ?? now.toISOString();
      const started = await startCatchUp(member, since, WATCH_FEEDS);
      // A look that could not start is tried again tomorrow, not every five minutes.
      state.watch = started.ok ? { ...state.watch, running: true } : { ...state.watch, checkedAt: now.toISOString(), lastFound: 0 };
    }
    return state;
  } catch (error) {
    log("error", "shopify.watch_failed", { storeId }, error);
    return state;
  } finally {
    await saveMove(storeId, state);
  }
}

export type WatchView = {
  day: number;
  days: number;
  /** The address leads here; null when the Shopify shop had none of its own. */
  addressDone: boolean | null;
  /** Old addresses leading nowhere, and how many of them have a sure counterpart (one press fixes those). */
  linksMissing: number;
  linksSure: number;
  /** Orders that came in on Shopify after the move, copied here by the daily look; null before the first look. */
  found: number | null;
  /** Moved gift cards whose old code was used on Shopify since, lowered here to match. */
  cardsLowered: number;
  /** Gift cards came over: the owner switches them off on Shopify too. */
  cardsMoved: boolean;
  canClose: boolean;
  /** The platform it moved from, and for WooCommerce the owner's *What moves?* (the closing steps differ). */
  source: "shopify" | "woocommerce";
  wordpress: "move" | "keep" | null;
};

/** The card of the 14 days after (owner only): null when there is no moved shop, or the owner said Shopify is closed. */
export async function watchView(member: Membership, deps: MoveDeps & AddressDeps = {}): Promise<WatchView | null> {
  if (!memberCan(member, OWNER)) return null;
  const row = await rowOf(member.store.id);
  if (!row || !watchShown(row.move)) return null;
  const now = (deps.now ?? (() => new Date()))();
  const [address, links] = await Promise.all([addressView(member, deps), oldShopCheck(member)]);
  const facts = { addressDone: address && address.primary ? address.done : null, linksMissing: links?.needing.length ?? 0 };
  return {
    day: Math.min(watchDay(row.move, now) ?? 1, WATCH_DAYS),
    days: WATCH_DAYS,
    ...facts,
    linksSure: links?.sure ?? 0,
    found: row.move.watch.checkedAt ? row.move.watch.found : null,
    cardsLowered: row.move.watch.cardsLowered,
    cardsMoved: (row.move.steps.gift_cards.done ?? 0) > 0,
    canClose: closeReady(row.move, facts, now),
    source: row.source,
    wordpress: row.copy.options?.wordpress ?? null,
  };
}

/** *Done, I've closed it*: the owner says Shopify is closed; the card goes. */
export async function shopifyClosed(member: Membership, deps: MoveDeps = {}): Promise<{ ok: boolean }> {
  if (!memberCan(member, OWNER)) return { ok: false };
  const row = await rowOf(member.store.id);
  if (!row || row.move.status !== "moved") return { ok: false };
  await saveMove(member.store.id, { ...row.move, watch: { ...row.move.watch, running: false, closedAt: (deps.now ?? (() => new Date()))().toISOString() } });
  log("info", "shopify.closed_said", { storeId: member.store.id });
  return { ok: true };
}

/** *Issue it* on a gift card that had no email (owner only): made now, its code shown once; it leaves the list. */
export async function issueLeftCard(member: Membership, shopifyId: string, deps: MoveDeps = {}): Promise<Awaited<ReturnType<typeof issueLeftGiftCard>>> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "gone" };
  // A WooCommerce card (D446 step 5) is read again through our plugin; a Shopify one from Shopify.
  let result: Awaited<ReturnType<typeof issueLeftGiftCard>>;
  if (shopifyId.startsWith("woo:")) {
    const line = (await readWooGiftCards(member.store.id, deps))?.find((l) => l.id === shopifyId) ?? null;
    result = line ? await issueReadGiftCard(member, line) : { ok: false, problem: "gone" };
  } else result = await issueLeftGiftCard(member, shopifyId, deps);
  if (result.ok || result.problem === "made" || result.problem === "gone") {
    const row = await rowOf(member.store.id);
    if (row) {
      const step = row.move.steps.gift_cards;
      const left = (step.left ?? []).filter((c) => c.id !== shopifyId);
      await saveMove(member.store.id, { ...row.move, steps: { ...row.move.steps, gift_cards: { ...step, left, failed: left.length, done: (step.done ?? 0) + (result.ok ? 1 : 0) } } });
    }
  }
  return result;
}
