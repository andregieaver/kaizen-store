import type { AutonomySettings } from "./autopilot-autonomy";

/**
 * The autopilot keeps going (D328, `docs/ai-autopilot.md` 12): each active goal is looked at again when a plan for it ends and on a
 * schedule, and the review makes the next plan, which starts by itself where the owner allows. Pure: the limits, the start rule and the
 * review turn's message; when a review is due is read in SQL (`src/server/autopilot-reviews.ts`).
 */

/** Reviews taken in one run of the loop, at most one per store. */
export const REVIEWS_PER_RUN = 2;
/** Reviews a store may have in 24 hours, whatever brings them up. */
export const REVIEWS_PER_DAY = 6;
/** A finished plan brings its goal up again only this long after the last review. */
export const REVIEW_GAP_HOURS = 1;
/** A failed review is tried again after this long. */
export const FAILED_REVIEW_HOURS = 6;
/** How long a run holds a review before it counts as failed. */
export const REVIEW_CLAIM_MINUTES = 10;
/** The plans of the goal a review is told about, newest first. */
export const REVIEW_PLANS_SHOWN = 3;

/** The manager's own tools a review's turn has: reading goals and plans and making one, never starting or deciding anything. */
export const REVIEW_PLAN_TOOLS = ["make_autopilot_plan", "list_goals", "list_autopilot_plans", "get_autopilot_plan"] as const;

/**
 * The read-only tools a review may look with, where the person's role and the store's features offer them (names a scope does not have
 * are left out). None changes the store: a review only plans.
 */
export const REVIEW_READ_TOOLS = [
  "store_overview",
  "store_checkup",
  "setup_progress",
  "analytics_overview",
  "analytics_alerts",
  "explain_change",
  "sales_summary",
  "sales_trend",
  "sales_funnel",
  "product_performance",
  "customer_insights",
  "search_insights",
  "list_products",
  "list_pages",
  "list_experiments",
  "explain_results",
  "suggest_experiments",
  "support_overview",
  "reviews_overview",
  "list_campaigns",
  "list_discounts",
  "list_broadcasts",
  "list_email_automations",
  "list_themes",
  "legal_pages_status",
  "list_features",
  "platform_overview",
] as const;

export type StartDecision = { start: true } | { start: false; why: string };

/** Whether a plan a review made starts at once: the owner's choice, within the plans a week they allow. */
export function startDecision(settings: AutonomySettings, startedThisWeek: number): StartDecision {
  const p = settings.planning;
  if (p.starts !== "auto") return { start: false, why: "Your setting is to ask before a new plan starts." };
  if (startedThisWeek >= p.plansPerWeek) {
    return { start: false, why: `The autopilot already started ${startedThisWeek} plan${startedThisWeek === 1 ? "" : "s"} this week, your limit.` };
  }
  return { start: true };
}

export type ReviewGoal = { id: string; title: string; vision: string; dueOn: string | null };
export type ReviewProgress = { target: string; now: string; met: boolean | null; missing?: string };
export type ReviewPlan = {
  title: string;
  status: string;
  finishedAt: string | null;
  steps: { title: string; status: string; done?: string; problem?: string }[];
};

/** The review turn's message: the goal, its progress (written by code), its last plans and the last review, as data. */
export function reviewMessage(goal: ReviewGoal, progress: readonly ReviewProgress[], plans: readonly ReviewPlan[], lastOutcome: string | null): string {
  const targets = progress.map((t) => `- ${t.target}: ${t.met === null ? `not measured${t.missing ? ` (${t.missing})` : ""}` : `${t.now}${t.met ? " (met)" : ""}`}`);
  const planLines = plans.slice(0, REVIEW_PLANS_SHOWN).flatMap((plan) => [
    `- "${plan.title}": ${plan.status}${plan.finishedAt ? ` (${plan.finishedAt.slice(0, 10)})` : ""}`,
    ...plan.steps.map((s) => `  - ${s.title}: ${s.status}${s.done ? `: ${clip(s.done)}` : s.problem ? `: ${clip(s.problem)}` : ""}`),
  ]);
  return [
    `Autopilot: review of the goal "${goal.title}" (id ${goal.id}).`,
    ...(goal.vision ? [`The owner's vision: ${goal.vision}`] : []),
    ...(goal.dueOn ? [`Due: ${goal.dueOn}`] : []),
    "",
    "Progress, worked out from the store's own figures:",
    ...(targets.length ? targets : ["- No targets."]),
    "",
    ...(planLines.length ? ["The latest plans for this goal:", ...planLines] : ["No plan has been made for this goal yet."]),
    ...(lastOutcome ? ["", `Your last review said: ${lastOutcome}`] : []),
    "",
    `Look with your tools at what matters most for this goal now, then make the one plan that moves it forward most with make_autopilot_plan (goal ${goal.id}), or say in one sentence why nothing should be done now.`,
  ].join("\n");
}

const clip = (text: string) => (text.length > 200 ? `${text.slice(0, 199)}…` : text);
