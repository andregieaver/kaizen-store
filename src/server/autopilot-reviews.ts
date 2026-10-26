import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  FAILED_REVIEW_HOURS,
  REVIEW_CLAIM_MINUTES,
  REVIEW_GAP_HOURS,
  REVIEW_PLAN_TOOLS,
  REVIEW_PLANS_SHOWN,
  REVIEW_READ_TOOLS,
  REVIEWS_PER_DAY,
  REVIEWS_PER_RUN,
  reviewMessage,
  startDecision,
  type ReviewPlan,
} from "@/lib/autopilot-reviews";
import { can } from "@/lib/permissions";

import { actingAs } from "./actor";
import { aiFor, type AiConnection } from "./ai";
import { goalsWithProgress } from "./autopilot-goals";
import { loadSteps, startPlanByAutopilot, stopPlanIn, type PlanActor } from "./autopilot-plans";
import { principalOf } from "./autopilot-runner";
import { aiBudgetSpent, autonomyFor } from "./autopilot-settings";
import { log } from "./log";
import { holderOfPrincipal, keepForApproval, runTurn, type Principal, type TurnInput } from "./owner-assistant";
import { refreshTag } from "./refresh";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The autopilot keeps going (D328, `docs/ai-autopilot.md` 12), the only writer of `commerce.autopilot_reviews`: from
 * `/api/cron/autopilot`, after the steps, the active goals of stores that keep working toward their goals are looked at again when a plan
 * for them ended and on a schedule. A review is a headless turn that may only look and make one plan; code then ties the plan to its goal
 * and starts it, or keeps its start for the owner's yes, as their settings say.
 */

/** The longest a review's turn may take. */
const TURN_MS = 120_000;

export type ReviewDeps = {
  /** The turn; `runTurn()` unless given (tests). */
  turn?: (input: TurnInput) => Promise<void>;
  /** The AI connection the turn uses; the store's for the feature `autopilot` unless given (tests). */
  connection?: AiConnection | null;
  /** No review is started after this. */
  deadline?: number;
};

export type ReviewRun = { planned: number; started: number; nothing: number; skipped: number; failed: number };

const DUE = z.object({
  goal_id: col.uuid,
  store_id: col.uuid.nullable(),
  store_slug: col.textOrNull,
  store_active: col.bool.nullable(),
  created_by: col.uuid,
  conversation_id: col.uuid.nullable(),
});
type Due = z.output<typeof DUE>;

/** The goals whose review is due, oldest review first (12.2); the settings are read again in code before each. */
export async function dueReviews(): Promise<Due[]> {
  return typedRows(
    DUE,
    sql`
      with last as (
        select distinct on (r.goal_id) r.goal_id, r.status, r.finished_at, r.conversation_id
        from commerce.autopilot_reviews r
        order by r.goal_id, r.created_at desc
      ),
      conversation as (
        select distinct on (r.goal_id) r.goal_id, r.conversation_id
        from commerce.autopilot_reviews r where r.conversation_id is not null
        order by r.goal_id, r.created_at desc
      )
      select g.id as goal_id, g.store_id, s.slug as store_slug, commerce.store_is_active(s.id) as store_active, g.created_by, c.conversation_id
      from commerce.assistant_goals g
      join commerce.autopilot_settings a on a.store_id is not distinct from g.store_id
      left join commerce.stores s on s.id = g.store_id
      left join last l on l.goal_id = g.id
      left join conversation c on c.goal_id = g.id
      where g.status = 'active' and g.created_by is not null
        and not a.paused and coalesce((a.planning ->> 'continues')::boolean, false)
        and (g.store_id is null or commerce.store_is_active(g.store_id))
        and not exists (select 1 from commerce.assistant_plans p where p.goal_id = g.id and p.status in ('draft', 'running', 'paused'))
        and not exists (select 1 from commerce.autopilot_reviews r where r.goal_id = g.id and r.status = 'running')
        and (
          select count(*) from commerce.autopilot_reviews r where r.store_id is not distinct from g.store_id and r.created_at > now() - interval '1 day'
        ) < ${REVIEWS_PER_DAY}
        and (
          l.goal_id is null
          or (l.status = 'failed' and l.finished_at < now() - make_interval(hours => ${FAILED_REVIEW_HOURS}))
          or (l.status <> 'failed' and l.finished_at < now() - make_interval(days => coalesce((a.planning ->> 'reviewDays')::int, 7)))
          or (l.status <> 'failed' and l.finished_at < now() - make_interval(hours => ${REVIEW_GAP_HOURS})
              and exists (select 1 from commerce.assistant_plans p where p.goal_id = g.id and p.finished_at > l.finished_at))
        )
      order by l.finished_at nulls first, g.created_at
      limit 20
    `,
  );
}

export async function runGoalReviews(deps: ReviewDeps = {}): Promise<ReviewRun> {
  const result: ReviewRun = { planned: 0, started: 0, nothing: 0, skipped: 0, failed: 0 };
  // A run that died with a review in hand: it failed, and is tried again later.
  await db().execute(sql`
    update commerce.autopilot_reviews set status = 'failed', outcome = 'The review did not finish.', finished_at = now(), claimed_until = null
    where status = 'running' and claimed_until < now()
  `);
  const seen = new Set<string>();
  let taken = 0;
  for (const due of await dueReviews()) {
    if (taken >= REVIEWS_PER_RUN || (deps.deadline && Date.now() > deps.deadline)) break;
    const storeKey = due.store_id ?? "platform";
    if (seen.has(storeKey)) continue;
    // The month's AI budget spent: no review is claimed, so the goal comes up again once there is budget.
    if (await aiBudgetSpent(due.store_id, await autonomyFor(due.store_id))) continue;
    const claimed = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.autopilot_reviews (store_id, goal_id, account_id, conversation_id, status, claimed_until)
        values (${due.store_id}::uuid, ${due.goal_id}::uuid, ${due.created_by}::uuid, ${due.conversation_id}::uuid, 'running',
          now() + make_interval(mins => ${REVIEW_CLAIM_MINUTES}))
        on conflict (goal_id) where status = 'running' do nothing
        returning id
      `,
    );
    if (!claimed) continue;
    seen.add(storeKey);
    taken++;
    try {
      result[await reviewGoal(claimed.id, due, deps)]++;
    } catch (error) {
      log("error", "autopilot.review_failed", { review: claimed.id }, error);
      await finish(claimed.id, "failed", { outcome: "Something went wrong during the review." }).catch(() => undefined);
      result.failed++;
    }
  }
  return result;
}

async function finish(
  reviewId: string,
  status: "done" | "skipped" | "failed",
  fields: { outcome: string; planId?: string; started?: boolean },
): Promise<void> {
  await db().execute(sql`
    update commerce.autopilot_reviews set status = ${status}, outcome = ${fields.outcome.slice(0, 500)}, plan_id = ${fields.planId ?? null}::uuid,
      started = ${fields.started ?? false}, finished_at = now(), claimed_until = null
    where id = ${reviewId}::uuid and status = 'running'
  `);
}

const PLAN_ROW = z.object({ id: col.uuid, title: col.text, status: col.text, version: col.int, finished_at: col.timestampOrNull });

/** The goal's latest plans with their steps, for the review's message. */
async function plansOfGoal(goalId: string): Promise<ReviewPlan[]> {
  const plans = await typedRows(
    PLAN_ROW,
    sql`select id, title, status, version, finished_at from commerce.assistant_plans where goal_id = ${goalId}::uuid order by created_at desc limit ${REVIEW_PLANS_SHOWN}`,
  );
  const out: ReviewPlan[] = [];
  for (const plan of plans) {
    const steps = await loadSteps(plan.id);
    out.push({
      title: plan.title,
      status: plan.status,
      finishedAt: plan.finished_at,
      steps: steps.map((s) => ({ title: s.title, status: s.status, done: s.result?.done, problem: s.result?.problem })),
    });
  }
  return out;
}

async function reviewGoal(reviewId: string, due: Due, deps: ReviewDeps): Promise<keyof ReviewRun> {
  const settings = await autonomyFor(due.store_id);
  if (settings.paused || !settings.planning.continues) {
    await finish(reviewId, "skipped", { outcome: "The autopilot does not keep working toward the goals here now." });
    return "skipped";
  }
  const p = await principalOf({ accountId: due.created_by, storeId: due.store_id, storeSlug: due.store_slug, storeActive: due.store_active });
  if (p === "gone" || p === "closed") {
    await finish(reviewId, "skipped", { outcome: "The person who set this goal can no longer use the AI manager here." });
    return "skipped";
  }
  const holder = holderOfPrincipal(p);
  if (p.store && (!holder || !can(holder, "owner"))) {
    await finish(reviewId, "skipped", { outcome: "The person who set this goal is no longer an owner of the store." });
    return "skipped";
  }
  const actor: PlanActor = { account: p.account, store: p.store, holder };
  // Read with its progress: a goal met by now is marked met here, and needs no review.
  const goal = (await goalsWithProgress(actor)).find((g) => g.id === due.goal_id);
  if (!goal) {
    await finish(reviewId, "skipped", { outcome: "The goal is met or no longer active." });
    return "skipped";
  }
  const conversationId = due.conversation_id ?? (await newConversation(p, reviewId, goal.title));
  const last = await typedRow(
    z.object({ outcome: col.textOrNull }),
    sql`select outcome from commerce.autopilot_reviews where goal_id = ${goal.id}::uuid and id <> ${reviewId}::uuid and status <> 'running' order by created_at desc limit 1`,
  );
  const message = reviewMessage(goal, goal.progress, await plansOfGoal(goal.id), last?.outcome ?? null);
  const startedAt = await typedRow(z.object({ at: col.timestamp }), sql`select now() as at`);

  const connection = deps.connection !== undefined ? deps.connection : await aiFor(due.store_id, { feature: "autopilot", accountId: p.account.id });
  const seen: { error: string | null; answer: string } = { error: null, answer: "" };
  await actingAs("autopilot", () =>
    (deps.turn ?? runTurn)({
      member: p,
      conversationId,
      message,
      emit: (event) => {
        if (event.type === "error") seen.error = event.message;
        if (event.type === "done") seen.answer = event.message.content;
      },
      invalidate: refreshTag,
      signal: AbortSignal.timeout(TURN_MS),
      scheduled: true,
      autopilot: { review: true, tools: [...REVIEW_PLAN_TOOLS, ...REVIEW_READ_TOOLS], settings, told: [] },
      connection,
    }),
  );
  if (seen.error) {
    await finish(reviewId, "failed", { outcome: seen.error });
    return "failed";
  }

  const made = await typedRows(
    PLAN_ROW,
    sql`
      select id, title, status, version, finished_at from commerce.assistant_plans
      where conversation_id = ${conversationId}::uuid and status = 'draft' and created_at >= ${startedAt?.at ?? new Date().toISOString()}::timestamptz
      order by created_at
    `,
  );
  if (made.length === 0) {
    const said = seen.answer.trim();
    await finish(reviewId, "done", { outcome: said ? `Nothing to do now: ${said}` : "Nothing to do now." });
    return "nothing";
  }
  // One plan a review: the last one made, the others stopped.
  const plan = made[made.length - 1];
  for (const extra of made.slice(0, -1)) await stopPlanIn(db(), extra.id, "draft");
  await db().execute(sql`update commerce.assistant_plans set goal_id = ${goal.id}::uuid where id = ${plan.id}::uuid and goal_id is distinct from ${goal.id}::uuid`);

  const week = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.autopilot_reviews
      where store_id is not distinct from ${due.store_id}::uuid and started and created_at > now() - interval '7 days'`,
  );
  const decision = startDecision(settings, week?.n ?? 0);
  if (decision.start && (await startPlanByAutopilot(actor, plan.id, plan.version))) {
    await finish(reviewId, "done", { outcome: `Made and started "${plan.title}".`, planId: plan.id, started: true });
    return "started";
  }
  await keepForApproval({ account: p.account, store: p.store, invalidate: refreshTag }, conversationId, "start_autopilot_plan", "plan", { plan: plan.id });
  const why = decision.start ? "" : ` ${decision.why}`;
  await finish(reviewId, "done", { outcome: `Made "${plan.title}"; it waits for your yes to start.${why}`, planId: plan.id });
  return "planned";
}

/** The goal's own conversation, made on its first review and kept on the review for the next. */
async function newConversation(p: Principal, reviewId: string, title: string): Promise<string> {
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.assistant_conversations (store_id, account_id, title)
      values (${p.store?.id ?? null}::uuid, ${p.account.id}::uuid, ${`Autopilot: ${title}`.slice(0, 80)}) returning id`,
  );
  if (!row) throw new Error("The review's conversation could not be made.");
  await db().execute(sql`update commerce.autopilot_reviews set conversation_id = ${row.id}::uuid where id = ${reviewId}::uuid`);
  return row.id;
}

export type GoalReview = { goalId: string; status: string; outcome: string | null; at: string };

/** Each goal's latest finished review, for the Goals tab (12.4). */
export async function latestReviews(storeId: string | null): Promise<GoalReview[]> {
  const rows = await typedRows(
    z.object({ goal_id: col.uuid, status: col.text, outcome: col.textOrNull, at: col.timestamp }),
    sql`
      select distinct on (goal_id) goal_id, status, outcome, coalesce(finished_at, created_at) as at
      from commerce.autopilot_reviews
      where ${storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`} and status <> 'running'
      order by goal_id, created_at desc
    `,
  );
  return rows.map((r) => ({ goalId: r.goal_id, status: r.status, outcome: r.outcome, at: r.at }));
}
