import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { copyDone, copyFailed, copyStateOf } from "@/lib/shopify-copy";
import { EMPTY_MOVE, moveDue, moveStateOf, nextMoveStep, readiness, scheduleProblem, type MoveState, type ReadyCheck } from "@/lib/shopify-move";
import { toInstant } from "@/lib/tracking-phases";

import { passMembership, type Membership } from "./auth";
import { log } from "./log";
import { fixOldShop, oldShopCheck, readOldShop } from "./old-shop";
import { memberCan } from "./permissions";
import { setPrivateMode } from "./private-mode";
import { getSetupProgress } from "./setup";
import { shopifyConnection } from "./shopify-connect";
import { advanceCopy, startCatchUp, type CopyDeps } from "./shopify-copy";
import { makersView } from "./shopify-makers";
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

const MOVE_ROW = z.object({ move: z.unknown(), copy: z.unknown() });

async function rowOf(storeId: string): Promise<{ move: MoveState; copy: ReturnType<typeof copyStateOf> } | null> {
  const row = await typedRow(MOVE_ROW, sql`select move, copy from commerce.shop_moves where store_id = ${storeId}::uuid and source = 'shopify' and status = 'connected'`);
  return row ? { move: moveStateOf(row.move), copy: copyStateOf(row.copy) } : null;
}

async function saveMove(storeId: string, state: MoveState): Promise<void> {
  await db().execute(sql`
    update commerce.shop_moves set move = ${JSON.stringify(state)}::jsonb, updated_at = now()
     where store_id = ${storeId}::uuid and source = 'shopify'
  `);
}

/** Takes the move's lease, or null when another tick holds it or nothing is connected. */
async function lease(storeId: string): Promise<MoveState | null> {
  const row = await typedRow(
    z.object({ move: z.unknown() }),
    sql`
      update commerce.shop_moves
         set move = jsonb_set(move, '{lease}', to_jsonb((now() + make_interval(secs => ${LEASE_SECONDS}))::text))
       where store_id = ${storeId}::uuid and source = 'shopify' and status = 'connected'
         and (move->>'lease' is null or (move->>'lease')::timestamptz < now())
      returning move
    `,
  );
  return row ? moveStateOf(row.move) : null;
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
    } else if (step === "links") {
      let read = await oldShopCheck(member);
      if (!read) {
        const connection = await shopifyConnection(member);
        const address = connection ? (connection.primaryDomain ?? connection.shop) : null;
        const reader = deps.readOld ?? ((m: Membership, a: string) => readOldShop(m, a));
        if (address) await reader(member, address).catch(() => ({ ok: false }));
        read = await oldShopCheck(member);
      }
      if (!read) state.steps.links = { stage: "failed", problem: "links_unread" };
      else {
        const fixed = await fixOldShop(member);
        state.steps.links = fixed.ok ? { stage: "done", done: fixed.written, failed: fixed.refused } : { stage: "failed", problem: "not_allowed" };
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
       where m.source = 'shopify' and m.status = 'connected' and m.move->>'status' in ('scheduled', 'moving')
       limit 20
    `,
  );
  const totals = { started: 0, moved: 0 };
  for (const row of rows) {
    try {
      let state = moveStateOf(row.move);
      if (state.status === "scheduled" && !moveDue(state, now)) continue;
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
