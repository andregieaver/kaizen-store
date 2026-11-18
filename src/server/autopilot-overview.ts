import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { todayIn } from "@/lib/analytics-period";
import type { AutonomySettings } from "@/lib/autopilot-autonomy";
import { previousMonth, type EffectsMonth } from "@/lib/autopilot-effects";
import { aimsAtSignups } from "@/lib/autopilot-goals";
import { HOUSE_SLUG } from "@/lib/house-routing";
import { can, type PermissionHolder } from "@/lib/permissions";

import type { Account } from "./auth";
import { effectsOfMonth, recentEffects, type MeasuredEffect } from "./autopilot-effects";
import { goalsWithProgress, scopeKind, type GoalWithProgress } from "./autopilot-goals";
import { listPlans, loadSteps, type Plan, type PlanStep, type StepQuestion } from "./autopilot-plans";
import { latestReport } from "./autopilot-reports";
import { latestEvents, type ReactedEvent } from "./autopilot-events";
import { latestReviews, type GoalReview } from "./autopilot-reviews";
import { autonomyFor, autopilotCostThisMonth } from "./autopilot-settings";
import { autopilotTestsOf, type AutopilotTest } from "./autopilot-tests";
import { waitingFollowUps, type WaitingFollowUp } from "./follow-ups";
import { houseStoreId } from "./house-customers";
import { houseSignupRate, type SignupRate } from "./house-signups";
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
  /** The autopilot's calls this month no price covers: its budget cannot be kept while there are any (`aiBudgetProblem()`). */
  unpricedCalls: number;
  /** The person's latest weekly report here. */
  report: Awaited<ReturnType<typeof latestReport>>;
  /** What the person asked the AI manager to come back to, waiting (PSI AGT-04): listed with Cancel, not only in the chat. */
  followUps: WaitingFollowUp[];
  /** What the autopilot's changes moved (D418): this month and last, and the latest changes measured; a store's only. */
  effects: { thisMonth: EffectsMonth; lastMonth: EffectsMonth; recent: MeasuredEffect[]; locale: string } | null;
  /**
   * Its tests of its own page changes (E4.1, D729): running, waiting for a yes, or decided lately; a store's only (Kaizena Flow's site is its
   * house store's, D484). An owner sees the store's; anyone else those made in their name.
   */
  tests: AutopilotTest[] | null;
  /**
   * Kaizena Flow's sign-ups per visit (ecosystem plan E5.3, D757) where this autopilot can aim at them (Kaizena Flow's own, and its own
   * store's) and no active goal does yet: today's share of visits signing up, or why it is not counted, for the Goals tab's one goal to set.
   */
  signups: { percent: number | null; reason: Extract<SignupRate, { percent: null }>["reason"] | null } | null;
  /**
   * On Kaizena Flow's own Autopilot: the store that serves its site (D484), whose autopilot tests the site's page changes on sign-ups, with
   * those tests; their switch is that store's (D757). Null on a store's page, or on a database without that store.
   */
  site: { slug: string; tests: AutopilotTest[] } | null;
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
  // A store's owner also sees what the autopilot kept in the store in anyone's name (`docs/100-day-challenge.md` A3): the refunds of the
  // challenge reach them whoever its plans, reviews and events run for. Anyone else sees their own.
  const ownerOfStore = Boolean(a.store) && (!a.holder || can(a.holder, "owner"));
  const whose = ownerOfStore
    ? sql`(ap.account_id = ${a.account.id}::uuid or exists (select 1 from commerce.assistant_conversations c where c.id = ap.conversation_id and c.source = 'autopilot'))`
    : sql`ap.account_id = ${a.account.id}::uuid`;
  const [callRows, plansAll, goals, settings, cost, progress, report, reviews, events, followUps, effects, tests, site] = await Promise.all([
    typedRows(
      CALL,
      sql`
        select ap.id, ap.summary, ap.category, ap.created_at, p.id as plan_id, p.title as plan_title
        from commerce.assistant_approvals ap
        left join commerce.assistant_plan_steps s on s.id = ap.plan_step_id
        left join commerce.assistant_plans p on p.id = s.plan_id
        where ${scope} and ${whose} and ap.status = 'pending' and ap.expires_at > now()
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
    waitingFollowUps(a),
    a.store ? effectsFor(a.store) : Promise.resolve(null),
    a.store ? autopilotTestsOf(a.store.id, ownerOfStore ? {} : { accountId: a.account.id }) : Promise.resolve(null),
    a.store ? Promise.resolve(null) : siteOfPlatform(),
  ]);
  const signups = await signupsToAim(a.store, goals);
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
    costMicros: cost.micros,
    unpricedCalls: cost.unpriced,
    report,
    followUps,
    effects,
    tests,
    signups,
    site,
  };
}

/** Kaizena Flow's site's store (D484) and its autopilot's tests, for the platform's Autopilot: its members are the platform's admins (D466). */
async function siteOfPlatform(): Promise<AutopilotOverview["site"]> {
  const house = await houseStoreId();
  return house ? { slug: HOUSE_SLUG, tests: await autopilotTestsOf(house) } : null;
}

/** Today's sign-ups per visit, where the scope can aim at them and no active goal does yet (D757). */
async function signupsToAim(store: Store | null, goals: readonly GoalWithProgress[]): Promise<AutopilotOverview["signups"]> {
  if (!aimsAtSignups(scopeKind(store))) return null;
  if (goals.some((g) => g.status === "active" && g.targets.some((t) => t.kind === "signup_rate_30d"))) return null;
  const rate = await houseSignupRate(new Date(), store ?? undefined);
  return rate.percent === null ? { percent: null, reason: rate.reason } : { percent: rate.percent, reason: null };
}

async function effectsFor(store: Store): Promise<NonNullable<AutopilotOverview["effects"]>> {
  const month = todayIn(new Date(), store.timeZone).slice(0, 7);
  const [thisMonth, lastMonth, recent] = await Promise.all([effectsOfMonth(store, month), effectsOfMonth(store, previousMonth(month)), recentEffects(store.id, 20)]);
  return { thisMonth: thisMonth.summary, lastMonth: lastMonth.summary, recent, locale: store.markets[0]?.locale ?? "en-GB" };
}
