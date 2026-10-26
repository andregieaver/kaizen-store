import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AutonomySettings } from "@/lib/autopilot-autonomy";
import { can, type PermissionHolder } from "@/lib/permissions";

import type { Account } from "./auth";
import { goalsWithProgress, type GoalWithProgress } from "./autopilot-goals";
import { listPlans, loadSteps, type Plan, type PlanStep, type StepQuestion } from "./autopilot-plans";
import { latestReport } from "./autopilot-reports";
import { latestEvents, type ReactedEvent } from "./autopilot-events";
import { latestReviews, type GoalReview } from "./autopilot-reviews";
import { autonomyFor, autopilotCostThisMonth } from "./autopilot-settings";
import { getSetupProgress } from "./setup";
import type { Store } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * What the Autopilot page shows (D309, `docs/ai-autopilot.md` 7.5): first what waits on the owner (the calls kept for their yes, the plans'
 * questions, what only they can do), then the plans with their steps, the goals with their progress and the settings. Read for one person in
 * one store (or on the platform): their own kept calls, and every plan of the store for an owner.
 */

export type OverviewActor = { account: Account; store: Store | null; holder?: PermissionHolder };

export type WaitingCall = { id: string; summary: string; category: string; createdAt: string; plan: { id: string; title: string } | null };
export type WaitingQuestion = { planId: string; planTitle: string; step: string; stepTitle: string; question: StepQuestion };
/** What only the owner can do, by key; the page words each. */
export type OwnerOnly = "payments" | "plan";

export type AutopilotOverview = {
  calls: WaitingCall[];
  questions: WaitingQuestion[];
  ownerOnly: OwnerOnly[];
  plans: { plan: Plan; steps: PlanStep[] }[];
  goals: GoalWithProgress[];
  /** Each goal's latest review (D328). */
  reviews: GoalReview[];
  /** What the autopilot reacted to lately (D331); a store's only, so the platform has none and no setting for it. */
  events: ReactedEvent[] | null;
  settings: AutonomySettings;
  /** The autopilot's AI cost this month in millionths of a dollar. */
  costMicros: number;
  /** The person's latest weekly report here. */
  report: Awaited<ReturnType<typeof latestReport>>;
};

const CALL = z.object({
  id: col.uuid,
  summary: col.text,
  category: col.text,
  created_at: col.timestamp,
  plan_id: col.uuid.nullable(),
  plan_title: col.textOrNull,
});

export async function autopilotOverview(a: OverviewActor): Promise<AutopilotOverview> {
  const scope = a.store ? sql`ap.store_id = ${a.store.id}::uuid` : sql`ap.store_id is null`;
  const [callRows, plansAll, goals, settings, costMicros, progress, report, reviews, events] = await Promise.all([
    typedRows(
      CALL,
      sql`
        select ap.id, ap.summary, ap.category, ap.created_at, p.id as plan_id, p.title as plan_title
        from commerce.assistant_approvals ap
        left join commerce.assistant_plan_steps s on s.id = ap.plan_step_id
        left join commerce.assistant_plans p on p.id = s.plan_id
        where ${scope} and ap.account_id = ${a.account.id}::uuid and ap.status = 'pending'
        order by ap.created_at
        limit 50
      `,
    ),
    listPlans(a.store),
    goalsWithProgress(a, { all: true }),
    autonomyFor(a.store?.id ?? null),
    autopilotCostThisMonth(a.store?.id ?? null),
    a.store ? getSetupProgress(a.store) : Promise.resolve(null),
    latestReport(a),
    latestReviews(a.store?.id ?? null),
    a.store ? latestEvents(a.store.id) : Promise.resolve(null),
  ]);
  const owner = !a.store || !a.holder || can(a.holder, "owner");
  const mine = plansAll.filter((p) => owner || p.accountId === a.account.id);
  const plans = await Promise.all(mine.map(async (plan) => ({ plan, steps: await loadSteps(plan.id) })));
  const questions: WaitingQuestion[] = plans.flatMap(({ plan, steps }) =>
    plan.status === "done" || plan.status === "stopped"
      ? []
      : steps
          .filter((s) => s.status === "asking" && s.question)
          .map((s) => ({ planId: plan.id, planTitle: plan.title, step: s.key, stepTitle: s.title, question: s.question as StepQuestion })),
  );
  const ownerOnly: OwnerOnly[] = progress && owner ? [...(progress.paymentsOn ? [] : (["payments"] as const)), ...(progress.plan ? [] : (["plan"] as const))] : [];
  return {
    calls: callRows.map((r) => ({
      id: r.id,
      summary: r.summary,
      category: r.category,
      createdAt: r.created_at,
      plan: r.plan_id && r.plan_title ? { id: r.plan_id, title: r.plan_title } : null,
    })),
    questions,
    ownerOnly,
    plans,
    goals,
    reviews,
    events,
    settings,
    costMicros,
    report,
  };
}
