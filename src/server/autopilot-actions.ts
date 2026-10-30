import "server-only";

import type { FormState } from "@/components/admin/action-form";
import { AUTONOMY_AREAS, AUTONOMY_LEVELS, PLAN_STARTS, type AutonomyLevel, type PlanStarts } from "@/lib/autopilot-autonomy";

import { dropGoal } from "./autopilot-goals";
import { answerQuestion, pausePlan, startPlanNow, stopPlan, type PlanActor } from "./autopilot-plans";
import { saveAutonomy } from "./autopilot-settings";
import { cancelFollowUp } from "./follow-ups";
import { log } from "./log";
import { decideApproval, holderOfPrincipal, type Principal } from "./owner-assistant";
import { OwnerToolError } from "./owner-tool-error";

/**
 * What the Autopilot page's buttons do (D309, `docs/ai-autopilot.md` 7.5), for the store's route and the platform's alike: each takes the
 * person the route made sure of and the form, and answers in a `FormState`. A press on Start or Resume is the person's own yes, for the
 * version the page showed (the form sends it).
 */

const ok: FormState = { status: "ok", messages: [] };
const refused = (message: string): FormState => ({ status: "error", messages: [message] });
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

async function guarded(name: string, run: () => Promise<FormState>): Promise<FormState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OwnerToolError) return refused(error.message);
    log("error", "autopilot.page_action_failed", { action: name }, error);
    return refused("It could not be done. Try again.");
  }
}

const actorOf = (p: Principal): PlanActor => ({ account: p.account, store: p.store, holder: holderOfPrincipal(p) });

/** Approve or decline a call kept for the person's yes. */
export function decideCall(p: Principal, form: FormData, invalidate: (tag: string) => void): Promise<FormState> {
  return guarded("decide", async () => {
    const decided = await decideApproval(p, text(form, "approval"), text(form, "approve") === "yes", invalidate);
    if (!decided) return refused("That change was already decided.");
    if (decided.status === "failed") return refused(decided.outcome ?? "It could not be done.");
    return ok;
  });
}

export function answerStep(p: Principal, form: FormData): Promise<FormState> {
  return guarded("answer", async () => {
    await answerQuestion(actorOf(p), { plan: text(form, "plan"), step: text(form, "step"), answer: text(form, "answer") });
    return ok;
  });
}

/** Start, resume, pause or stop a plan from its card. */
export function changePlan(p: Principal, form: FormData): Promise<FormState> {
  return guarded("plan", async () => {
    const a = actorOf(p);
    const plan = text(form, "plan");
    const what = text(form, "do");
    if (what === "start" || what === "resume") {
      await startPlanNow(a, what === "start" ? "start_autopilot_plan" : "resume_autopilot_plan", { plan, approved_version: Number(text(form, "version")) });
    } else if (what === "pause") await pausePlan(a, plan);
    else if (what === "stop") await stopPlan(a, plan);
    else return refused("Choose what to do with the plan.");
    return ok;
  });
}

/** Drop a goal (the page is the owner's, as goals are). */
/** Cancel on a follow-up the page lists (PSI AGT-04): the person's own, waiting here; one already gone says so. */
export function cancelFollowUpFrom(p: Principal, form: FormData): Promise<FormState> {
  return guarded("cancel_follow_up", async () => ((await cancelFollowUp(p, text(form, "followUp"))) ? ok : refused("It is no longer waiting.")));
}

export function dropGoalFrom(p: Principal, form: FormData): Promise<FormState> {
  return guarded("drop_goal", async () => {
    await dropGoal(p, text(form, "goal"));
    return ok;
  });
}

const number = (value: string): number | null => (value === "" ? null : Number(value.replace(",", ".")));

/** The settings form read into `saveAutonomy()`'s input: the switch, a level per area, the limits and keeping going (D328). */
export function saveSettings(p: Principal, form: FormData): Promise<FormState> {
  return guarded("settings", async () => {
    const levels: Record<string, AutonomyLevel> = {};
    for (const area of AUTONOMY_AREAS) {
      const level = text(form, `level_${area}`);
      if ((AUTONOMY_LEVELS as readonly string[]).includes(level)) levels[area] = level as AutonomyLevel;
    }
    const ai = number(text(form, "ai_monthly"));
    await saveAutonomy(actorOf(p), {
      paused: text(form, "running") !== "on",
      levels,
      budgets: {
        aiMonthlyUsd: ai === null || Number.isNaN(ai) ? null : ai,
        discountPercent: Number(text(form, "discount_percent") || 0),
        priceChangePercent: Number(text(form, "price_change_percent") || 0),
        customerEmailsPerWeek: Number(text(form, "customer_emails") || 0),
      },
      planning: {
        continues: text(form, "keep_going") === "on",
        starts: (PLAN_STARTS as readonly string[]).includes(text(form, "plan_starts")) ? (text(form, "plan_starts") as PlanStarts) : "ask",
        reviewDays: Number(text(form, "review_days") || 7),
        plansPerWeek: Number(text(form, "plans_per_week") || 3),
        reacts: text(form, "reacts") === "on",
        waitMinutes: Number(text(form, "wait_minutes") || 15),
      },
    });
    return ok;
  });
}
