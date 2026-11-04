/**
 * Move day, part 1 (D445 step 7a, `docs/moving-from-shopify.md` 4.6), pure: whether the shop is ready to move, and the move itself as a few
 * steps that each run to the end and are safe to repeat. The owner presses *Move my shop*, or chooses a time and the five-minute job starts
 * it; the open page and that job move it on. Nothing here reads or writes.
 *
 * 1. `catch_up`: what Shopify made since the copy began (new products, customers, past orders), read and brought over without asking,
 *    through the same imports as the copy.
 * 2. `links`: the old shop's links read again and every one with a sure counterpart here redirected (D445 step 1).
 * 3. `gift_cards` (step 8): every Shopify gift card with money left, read again now, made here and its new code emailed to its holder; one
 *    without an email waits for the owner (`left`).
 * 4. `open`: the shop opened to everyone (private mode off), as it is on Shopify.
 *
 * Switching the address is part 2 (step 7b). No step sends an email: nothing the copy writes emails anyone, and the store's own emails
 * follow its own orders, as they always do.
 */

export const MOVE_STEPS = ["catch_up", "links", "gift_cards", "open"] as const;
export type MoveStep = (typeof MOVE_STEPS)[number];
export type StepStage = "waiting" | "running" | "done" | "failed";
/** Why a step could not finish, in a code the page words. */
export const STEP_PROBLEMS = ["shopify", "links_unread", "not_allowed", "trial_ended", "setup"] as const;
export type StepProblem = (typeof STEP_PROBLEMS)[number];

export type MoveStatus = "none" | "scheduled" | "moving" | "moved";

/** A Shopify gift card that had no email to send its new code to (step 8): what the owner sees to recognise it, and its id there. */
export type LeftCard = { id: string; last4: string; amount: string; currency: string; expiresOn: string | null };
/** At most this many are kept in the move's state; more are said as a number. */
export const LEFT_CARDS_MAX = 200;

function leftOf(raw: unknown): LeftCard[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, LEFT_CARDS_MAX).flatMap((r) => {
    const c = o(r);
    const ok =
      typeof c.id === "string" && /^gid:\/\/shopify\/GiftCard\/\d+$/.test(c.id) && typeof c.last4 === "string" && /^[A-Z0-9]{0,4}$/.test(c.last4) &&
      typeof c.amount === "string" && /^\d{1,12}(\.\d{1,2})?$/.test(c.amount) && typeof c.currency === "string" && /^[A-Z]{3}$/.test(c.currency);
    return ok ? [{ id: c.id as string, last4: c.last4 as string, amount: c.amount as string, currency: c.currency as string, expiresOn: typeof c.expiresOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.expiresOn) ? c.expiresOn : null }] : [];
  });
}

export type MoveState = {
  status: MoveStatus;
  /** When a scheduled move starts (an ISO instant). */
  at: string | null;
  /** The account that pressed (or scheduled) it: the move runs as that owner. */
  by: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** A scheduled move that did not start because the shop was not ready at its time: the time, said on the page. */
  missed: string | null;
  /** The 14 days after (D445 step 7c): the daily look for orders still arriving on Shopify, and when the owner said Shopify is closed. */
  watch: Watch;
  steps: Record<MoveStep, { stage: StepStage; problem?: StepProblem; done?: number; failed?: number; left?: LeftCard[] }>;
};

export const EMPTY_MOVE: MoveState = {
  status: "none",
  at: null,
  by: null,
  startedAt: null,
  finishedAt: null,
  missed: null,
  watch: { checkedAt: null, running: false, found: 0, lastFound: 0, closedAt: null, cardsLowered: 0 },
  steps: { catch_up: { stage: "waiting" }, links: { stage: "waiting" }, gift_cards: { stage: "waiting" }, open: { stage: "waiting" } },
};

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const instant = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES: readonly StepStage[] = ["waiting", "running", "done", "failed"];
const STATUSES: readonly MoveStatus[] = ["none", "scheduled", "moving", "moved"];
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/** The 14 days after a move: when Shopify was last looked at, whether a look is running, how many orders it found, and when Shopify was closed. */
export type Watch = { checkedAt: string | null; running: boolean; found: number; lastFound: number; closedAt: string | null; cardsLowered: number };

function watchOf(raw: unknown): Watch {
  const w = o(raw);
  return { checkedAt: instant(w.checkedAt), running: w.running === true, found: count(w.found) ?? 0, lastFound: count(w.lastFound) ?? 0, closedAt: instant(w.closedAt), cardsLowered: count(w.cardsLowered) ?? 0 };
}

/** The kept state read back, every field checked (an unknown shape is no move at all). */
export function moveStateOf(raw: unknown): MoveState {
  const r = o(raw);
  const steps = o(r.steps);
  const out: MoveState = {
    status: STATUSES.includes(r.status as MoveStatus) ? (r.status as MoveStatus) : "none",
    at: instant(r.at),
    by: typeof r.by === "string" && UUID.test(r.by) ? r.by : null,
    startedAt: instant(r.startedAt),
    finishedAt: instant(r.finishedAt),
    missed: instant(r.missed),
    watch: watchOf(r.watch),
    steps: { ...EMPTY_MOVE.steps },
  };
  for (const step of MOVE_STEPS) {
    const s = o(steps[step]);
    const state: MoveState["steps"][MoveStep] = { stage: STAGES.includes(s.stage as StepStage) ? (s.stage as StepStage) : "waiting" };
    if (STEP_PROBLEMS.includes(s.problem as StepProblem)) state.problem = s.problem as StepProblem;
    const done = count(s.done);
    const failed = count(s.failed);
    if (done !== undefined) state.done = done;
    if (failed !== undefined) state.failed = failed;
    const left = leftOf(s.left);
    if (left) state.left = left;
    out.steps[step] = state;
  }
  if (out.status === "scheduled" && (out.at === null || out.by === null)) out.status = "none";
  return out;
}

/** The step to run now: the first one not settled, in order. Null when all are. */
export function nextMoveStep(state: MoveState): MoveStep | null {
  return MOVE_STEPS.find((s) => state.steps[s].stage === "waiting" || state.steps[s].stage === "running") ?? null;
}

/** Whether a scheduled move is due at `now`. */
export const moveDue = (state: MoveState, now: Date): boolean => state.status === "scheduled" && state.at !== null && Date.parse(state.at) <= now.getTime();

// ---------------------------------------------------------------------------
// Ready to move?
// ---------------------------------------------------------------------------

/** One line of *Ready to move?*: whether it is so, whether the move waits for it, and figures for its sentence. */
export type ReadyCheck = { key: "payments" | "copy" | "links" | "waiting"; ok: boolean; blocks: boolean; n?: number; of?: number };

export type ReadyFacts = {
  /** Shoppers can pay: card payments on and the live account able to take them. */
  payments: boolean;
  /** The copy was brought over and every part of it settled. */
  copyDone: boolean;
  /** Parts of the copy that could not come over. */
  copyFailed: number;
  /** The old shop's links: how many were read and how many lead somewhere; null when they were never read. */
  links: { total: number; working: number } | null;
  /** Products here still to name a maker for (*Who makes your products?*). */
  makersLeft: number;
};

/**
 * *Ready to move?*: payments and a finished copy hold the move back (a shop that cannot take money, or is half copied, must not open in
 * Shopify's place); old links that lead nowhere and products without a maker are said, and the owner may move anyway.
 */
export function readiness(f: ReadyFacts): { checks: ReadyCheck[]; canMove: boolean } {
  const checks: ReadyCheck[] = [
    { key: "payments", ok: f.payments, blocks: true },
    { key: "copy", ok: f.copyDone, blocks: true, n: f.copyFailed },
    { key: "links", ok: f.links !== null && f.links.working === f.links.total, blocks: false, n: f.links?.working ?? 0, of: f.links?.total ?? 0 },
    { key: "waiting", ok: f.makersLeft === 0, blocks: false, n: f.makersLeft },
  ];
  return { checks, canMove: checks.every((c) => c.ok || !c.blocks) };
}

/** The earliest a move may be scheduled (a few minutes ahead, so the five-minute job meets it), and the latest (30 days). */
export const SCHEDULE_MIN_MS = 5 * 60_000;
export const SCHEDULE_MAX_MS = 30 * 24 * 3_600_000;
export const scheduleProblem = (at: string | null, now: Date): "invalid" | "past" | "far" | null => {
  if (!at) return "invalid";
  const t = Date.parse(at) - now.getTime();
  if (Number.isNaN(t)) return "invalid";
  if (t < SCHEDULE_MIN_MS) return "past";
  return t > SCHEDULE_MAX_MS ? "far" : null;
};

// ---------------------------------------------------------------------------
// The 14 days after (D445 step 7c, `docs/moving-from-shopify.md` 4.8)
// ---------------------------------------------------------------------------

export const WATCH_DAYS = 14;
const DAY_MS = 24 * 3_600_000;

/** The day of the watch a moved shop is on (1 on the day it moved), or null before it moved. */
export function watchDay(state: MoveState, now: Date): number | null {
  if (state.status !== "moved" || !state.finishedAt) return null;
  return Math.max(1, Math.floor((now.getTime() - Date.parse(state.finishedAt)) / DAY_MS) + 1);
}

/** Whether Shopify is due its daily look: within the 14 days, not closed, none running, and a day since the move or the last look. */
export function watchDue(state: MoveState, now: Date): boolean {
  const day = watchDay(state, now);
  if (day === null || day > WATCH_DAYS || state.watch.closedAt || state.watch.running) return false;
  const last = Date.parse(state.watch.checkedAt ?? state.finishedAt!);
  return now.getTime() - last >= DAY_MS;
}

/** What the card weighs: whether the address leads here (null: the shop had none of its own), old links leading nowhere, orders found. */
export type WatchFacts = { addressDone: boolean | null; linksMissing: number };

/**
 * *You can close Shopify now*: on day 14, or before it when every check is green after at least one daily look found nothing new on
 * Shopify (an order on an earlier day does not hold it back once a later look is quiet). Never once the owner said it is closed.
 */
export function closeReady(state: MoveState, facts: WatchFacts, now: Date): boolean {
  const day = watchDay(state, now);
  if (day === null || state.watch.closedAt) return false;
  if (day >= WATCH_DAYS) return true;
  const green = facts.addressDone !== false && facts.linksMissing === 0;
  return green && state.watch.checkedAt !== null && state.watch.lastFound === 0;
}

/** Whether the card shows at all: from the move until the owner says Shopify is closed. */
export const watchShown = (state: MoveState): boolean => state.status === "moved" && state.watch.closedAt === null;
