import "server-only";

import type { GoalTargetInput } from "@/lib/autopilot-goals";
import type { StepInput } from "@/lib/autopilot-plans";
import { can, type PermissionHolder } from "@/lib/permissions";

import type { Account } from "./auth";
import { dropGoal, goalsWithProgress, setGoal } from "./autopilot-goals";
import {
  answerQuestion,
  listPlans,
  loadPlan,
  loadSteps,
  makePlan,
  pausePlan,
  planWords,
  preflightPlanStart,
  revisePlan,
  stopPlan,
} from "./autopilot-plans";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's goal and plan tools (D309, `docs/ai-autopilot.md` 7.1, 7.2), for a store and for Kaizena Flow's own site. Goals are the
 * owner's (an owner of the store, or a platform admin); anyone who uses the AI manager may make a plan, which runs in their name and
 * with their role. Starting and resuming are gated (`plan`) and run from the person's yes; nothing here decides for them in a turn
 * nobody is in.
 */

type Ctx = { account: Account; store: Store | null; holder?: PermissionHolder; scheduled?: boolean; turn?: unknown };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const ownerOnly = (ctx: Ctx) => {
  if (ctx.store && ctx.holder && !can(ctx.holder, "owner")) fail("Goals are the owner's: ask an owner of the store to set them.");
};

const autopilotLink = (ctx: Ctx) => (ctx.store ? `/admin/${ctx.store.slug}/autopilot` : "/admin/platform/autopilot");

export async function setGoalTool(ctx: Ctx, input: { goal?: string; title: string; vision?: string; targets: GoalTargetInput[]; due_on?: string }) {
  ownerOnly(ctx);
  const goal = await setGoal(ctx, input);
  const [withProgress] = (await goalsWithProgress(ctx, { all: true })).filter((g) => g.id === goal.id);
  return {
    done: input.goal ? `The goal "${goal.title}" is changed.` : `The goal "${goal.title}" is kept.`,
    goal: { id: goal.id, title: goal.title, progress: withProgress?.progress ?? [] },
    note: "Offer a plan to reach it (make_autopilot_plan) if they want one.",
  };
}

export async function listGoalsTool(ctx: Ctx, { all }: { all: boolean }) {
  const goals = await goalsWithProgress(ctx, { all });
  return {
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      vision: g.vision || null,
      status: g.status,
      due_on: g.dueOn,
      targets: g.progress.map((p) => ({ target: p.target, now: p.now, met: p.met, ...(p.missing && { not_measured_because: p.missing }) })),
    })),
    note: goals.length ? "Progress is worked out from the store's own figures: repeat it as written." : "No goals yet: ask what they want to achieve.",
    link: `${autopilotLink(ctx)}/goals`,
  };
}

export async function dropGoalTool(ctx: Ctx, { goal }: { goal: string }) {
  ownerOnly(ctx);
  await dropGoal(ctx, goal);
  return { done: "The goal is dropped." };
}

export async function makePlanTool(ctx: Ctx, input: { title: string; summary: string; goal?: string; steps: StepInput[] }) {
  const { plan, steps } = await makePlan(ctx, input);
  return {
    plan: planWords(plan, steps),
    note: "It is a draft: tell them its steps in a few lines and ask whether to start it; on their go, call start_autopilot_plan.",
    link: `${autopilotLink(ctx)}/plans/${plan.id}`,
  };
}

export async function revisePlanTool(ctx: Ctx, input: { plan: string; title?: string; summary?: string; steps: StepInput[] }) {
  const { plan, steps } = await revisePlan(ctx, input);
  return { plan: planWords(plan, steps), note: "It is a draft again: ask whether to start it." };
}

export async function getPlanTool(ctx: Ctx, { plan: id }: { plan: string }) {
  const plan = (await loadPlan(ctx.store, id)) ?? fail("There is no such plan here. Look with list_autopilot_plans.");
  return { plan: planWords(plan, await loadSteps(plan.id)), link: `${autopilotLink(ctx)}/plans/${plan.id}` };
}

export async function listPlansTool(ctx: Ctx, { finished }: { finished: boolean }) {
  const plans = await listPlans(ctx.store, { finished });
  const out = [];
  for (const plan of plans) {
    const steps = await loadSteps(plan.id);
    out.push({
      id: plan.id,
      title: plan.title,
      status: plan.status,
      ...(plan.pauseReason && { paused_because: plan.pauseReason }),
      steps_done: steps.filter((s) => s.status === "done").length,
      steps: steps.length,
      waiting_for_the_owner: steps.filter((s) => s.status === "asking" || s.status === "waiting").map((s) => s.title),
    });
  }
  return { plans: out, link: `${autopilotLink(ctx)}/plans` };
}

export async function pausePlanTool(ctx: Ctx, { plan }: { plan: string }) {
  return pausePlan(ctx, plan);
}

export async function stopPlanTool(ctx: Ctx, { plan }: { plan: string }) {
  return stopPlan(ctx, plan);
}

/** Only in a turn the person is in: a scheduled or autopilot turn's words are not their choice. */
export async function answerQuestionTool(ctx: Ctx, input: { plan: string; step: string; answer: string }) {
  if (!ctx.turn || ctx.scheduled) return fail("They are not here: the question waits for their own answer.");
  return answerQuestion(ctx, input);
}

/** Checked before a start or resume is kept for the person's yes. */
export async function preflightAutopilotTool(ctx: Ctx, name: string, args: unknown): Promise<void> {
  if (name !== "start_autopilot_plan" && name !== "resume_autopilot_plan") return;
  const plan = (args as { plan?: unknown } | null)?.plan;
  await preflightPlanStart(ctx, name, typeof plan === "string" ? plan : "");
}
