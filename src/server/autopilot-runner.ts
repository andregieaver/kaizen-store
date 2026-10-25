import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { MANAGER_TOOLS_BY_NAME, PLATFORM_TOOLS_BY_NAME } from "@/lib/manager-tools";
import { OWNER_TOOLS_BY_NAME, readToolInput, type GateCategory } from "@/lib/owner-tools";
import type { AutonomySettings } from "@/lib/autopilot-autonomy";

import { actingAs } from "./actor";
import { aiFor, type AiConnection } from "./ai";
import { activeAccount, passMembership } from "./auth";
import { checkStep } from "./autopilot-checks";
import { autopilotDecision } from "./autopilot-gate";
import { completeStep, failStep, loadSteps, stopPlanIn, type PlanStep, type StepResult } from "./autopilot-plans";
import { aiBudgetSpent, autonomyFor } from "./autopilot-settings";
import { log } from "./log";
import { platformGateNeeded, preflightPlatformTool, runPlatformTool } from "./manager-tools";
import { holderOfPrincipal, keepForApproval, runTurn, type Principal, type TurnInput } from "./owner-assistant";
import { gateNeeded, OwnerToolError, preflightOwnerTool, runOwnerTool } from "./owner-tools";
import { refreshTag } from "./refresh";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The autopilot's loop (D309, `docs/ai-autopilot.md` 7.3): from `/api/cron/autopilot` every minute, a few steps at a time and at most one per
 * store (a store's advisory lock, then a claim with an expiry), each in the name of the person who made its plan with what their role may do
 * today (read again: an account disabled or a member removed pauses the plan, a closed store stops it). A tool step is one call run by code; a
 * task is a headless turn limited to its tools; gated calls in either meet the owner's autonomy levels and budgets, and those kept wait under
 * the step. What a step did is checked by code (`checkStep()`); a failed try waits, and the third becomes a question for the owner.
 */

/** Steps taken in one run. */
const PER_RUN = 3;
/** How long a run holds a step before another may take it. */
const CLAIM_MINUTES = 10;
/** The longest a task step's turn may take. */
const TURN_MS = 120_000;

export type AutopilotDeps = {
  /** The turn; `runTurn()` unless given (tests). */
  turn?: (input: TurnInput) => Promise<void>;
  /** The AI connection a task's turn uses; the store's for the feature `autopilot` unless given (tests). */
  connection?: AiConnection | null;
  /** No step is started after this. */
  deadline?: number;
};

export type AutopilotRun = { done: number; waiting: number; asking: number; retried: number; paused: number };

const CANDIDATE = z.object({ store_key: col.text, store_id: col.uuid.nullable() });

export async function runAutopilot(deps: AutopilotDeps = {}): Promise<AutopilotRun> {
  const result: AutopilotRun = { done: 0, waiting: 0, asking: 0, retried: 0, paused: 0 };
  // A run that died with a step in hand: the step goes back to be tried again (a try counted).
  await db().execute(sql`
    update commerce.assistant_plan_steps set status = 'pending', tries = tries + 1, claimed_until = null, not_before = now()
    where status = 'running' and claimed_until < now()
  `);
  const stores = await typedRows(
    CANDIDATE,
    sql`
      select distinct coalesce(st.store_id::text, 'platform') as store_key, st.store_id
      from commerce.assistant_plan_steps st
      join commerce.assistant_plans p on p.id = st.plan_id and p.status = 'running'
      left join commerce.autopilot_settings a on a.store_id is not distinct from st.store_id
      where st.status = 'pending' and (st.not_before is null or st.not_before <= now()) and not coalesce(a.paused, false)
        and (st.store_id is null or commerce.store_is_active(st.store_id))
      limit 50
    `,
  );
  let taken = 0;
  for (const candidate of stores) {
    if (taken >= PER_RUN || (deps.deadline && Date.now() > deps.deadline)) break;
    const step = await claimFor(candidate.store_id);
    if (!step) continue;
    taken++;
    try {
      result[await runStep(step.id, deps)]++;
    } catch (error) {
      log("error", "autopilot.step_failed", { step: step.id }, error);
      await failStep(step.id, "Something went wrong while running it.").catch(() => undefined);
      result.retried++;
    }
  }
  return result;
}

/** One runnable step of a store (or the platform), claimed under the store's lock so two runs never take two of its steps. */
async function claimFor(storeId: string | null): Promise<{ id: string } | null> {
  return db().transaction(async (tx) => {
    const lock = await typedRow(z.object({ locked: col.bool }), sql`select pg_try_advisory_xact_lock(hashtextextended(${`autopilot:${storeId ?? "platform"}`}, 0)) as locked`, tx);
    if (!lock?.locked) return null;
    const same = storeId ? sql`st.store_id = ${storeId}::uuid` : sql`st.store_id is null`;
    const busy = await typedRow(
      z.object({ n: col.int }),
      sql`select count(*)::int as n from commerce.assistant_plan_steps st where ${same} and st.status = 'running' and st.claimed_until > now()`,
      tx,
    );
    if ((busy?.n ?? 0) > 0) return null;
    return typedRow(
      z.object({ id: col.uuid }),
      sql`
        update commerce.assistant_plan_steps set status = 'running', claimed_until = now() + make_interval(mins => ${CLAIM_MINUTES})
        where id = (
          select st.id from commerce.assistant_plan_steps st
          join commerce.assistant_plans p on p.id = st.plan_id and p.status = 'running'
          where ${same} and st.status = 'pending' and (st.not_before is null or st.not_before <= now())
            and not exists (
              select 1 from commerce.assistant_plan_steps d
              where d.plan_id = st.plan_id and d.key = any(st.after_keys) and d.status not in ('done', 'skipped')
            )
          order by p.started_at, p.id, st.position
          limit 1
          for update of st skip locked
        )
        returning id
      `,
      tx,
    );
  });
}

const PLAN = z.object({
  id: col.uuid,
  title: col.text,
  account_id: col.uuid,
  conversation_id: col.uuid,
  store_id: col.uuid.nullable(),
  status: col.text,
  store_slug: col.textOrNull,
  store_active: col.bool.nullable(),
});

/** Who a plan runs for today, or why it no longer runs. */
async function principalFor(plan: z.output<typeof PLAN>): Promise<Principal | "gone" | "closed"> {
  const account = await activeAccount(plan.account_id);
  if (!account) return "gone";
  if (!plan.store_id) return account.platformAdmin ? { account, store: null } : "gone";
  if (!plan.store_slug || !plan.store_active) return "closed";
  const member = await passMembership(plan.store_slug, account.id);
  if (!member) return "gone";
  return { account: member.account, store: member.store, role: member.role, kind: member.kind, permissions: member.permissions };
}

/** Sets a claimed step back to be run later, as it was. */
async function release(stepId: string, at: Date | null = null): Promise<void> {
  await db().execute(sql`
    update commerce.assistant_plan_steps set status = 'pending', claimed_until = null, not_before = ${at?.toISOString() ?? null}::timestamptz
    where id = ${stepId}::uuid and status = 'running'
  `);
}

async function pausePlanFor(planId: string, stepId: string, reason: string): Promise<void> {
  await release(stepId);
  await db().execute(sql`update commerce.assistant_plans set status = 'paused', pause_reason = ${reason.slice(0, 500)} where id = ${planId}::uuid and status = 'running'`);
}

async function runStep(stepId: string, deps: AutopilotDeps): Promise<keyof AutopilotRun> {
  const stepRow = (await db().execute(sql`select plan_id from commerce.assistant_plan_steps where id = ${stepId}::uuid`))[0] as { plan_id: string } | undefined;
  const plan = stepRow
    ? await typedRow(
        PLAN,
        sql`select p.id, p.title, p.account_id, p.conversation_id, p.store_id, p.status, s.slug as store_slug, commerce.store_is_active(s.id) as store_active
          from commerce.assistant_plans p left join commerce.stores s on s.id = p.store_id where p.id = ${stepRow.plan_id}::uuid`,
      )
    : null;
  if (!plan || plan.status !== "running") {
    if (plan) await release(stepId);
    return "paused";
  }
  const principal = await principalFor(plan);
  if (principal === "closed") {
    await db().transaction((tx) => stopPlanIn(tx, plan.id, "running"));
    return "paused";
  }
  if (principal === "gone") {
    await pausePlanFor(plan.id, stepId, "The person this plan runs for can no longer use the AI manager here.");
    return "paused";
  }
  const steps = await loadSteps(plan.id);
  const step = steps.find((s) => s.id === stepId);
  if (!step) return "paused";
  const settings = await autonomyFor(plan.store_id);

  switch (step.spec.kind) {
    case "question": {
      await db().execute(sql`
        update commerce.assistant_plan_steps set status = 'asking', question = ${JSON.stringify({ text: step.spec.text, options: step.spec.options })}::jsonb, claimed_until = null
        where id = ${stepId}::uuid and status = 'running'
      `);
      return "asking";
    }
    case "wait": {
      const until = new Date(step.spec.until);
      if (until.getTime() > Date.now()) {
        await release(stepId, until);
        return "waiting";
      }
      await completeStep(stepId, plan.id, { done: "The time came." });
      return "done";
    }
    case "tool":
      return runToolStep(plan, principal, step, settings);
    case "task": {
      if (await aiBudgetSpent(plan.store_id, settings)) {
        await pausePlanFor(plan.id, stepId, "The autopilot's AI budget for this month is spent: raise it under Autopilot, Settings, or wait for next month.");
        return "paused";
      }
      return runTaskStep(plan, principal, step, steps, settings, deps);
    }
  }
}

type PlanFacts = z.output<typeof PLAN>;

/** A tool step: the stored call run by code, or kept for the owner's yes when their level or budgets say so. */
async function runToolStep(plan: PlanFacts, p: Principal, step: PlanStep, settings: AutonomySettings): Promise<keyof AutopilotRun> {
  if (step.spec.kind !== "tool") return "paused";
  const { tool: name, args } = step.spec;
  const tool = (p.store ? OWNER_TOOLS_BY_NAME[name] : PLATFORM_TOOLS_BY_NAME[name]) ?? null;
  if (!tool || MANAGER_TOOLS_BY_NAME[name]) return (await failStep(step.id, `There is no tool ${name} here.`)) === "asking" ? "asking" : "retried";
  const read = readToolInput(tool, args);
  if (!read.ok) return (await failStep(step.id, `The arguments could not be read: ${read.problem}`)) === "asking" ? "asking" : "retried";
  const holder = holderOfPrincipal(p);
  const ownerCtx = p.store ? { account: p.account, store: p.store, invalidate: refreshTag, holder } : null;
  const managerCtx = { account: p.account, store: null, flags: {}, connection: null, navigate: () => {}, invalidate: refreshTag };
  const told: string[] = [];
  try {
    if (tool.gate && (p.store ? await gateNeeded(p.store, name, args) : await platformGateNeeded(name, args))) {
      const decision = await autopilotDecision(p, settings, name, tool.gate as GateCategory, read.input as Record<string, unknown>);
      if (!decision.run) {
        if (ownerCtx) await preflightOwnerTool(ownerCtx, name, args);
        else await preflightPlatformTool(managerCtx, name, args);
        const kept = await keepForApproval({ account: p.account, store: p.store, invalidate: refreshTag }, plan.conversation_id, name, tool.gate, read.input as Record<string, unknown>, step.id);
        await db().execute(sql`
          update commerce.assistant_plan_steps set status = 'waiting', claimed_until = null, result = ${JSON.stringify({ done: `Waiting for your yes: ${kept.summary}` })}::jsonb
          where id = ${step.id}::uuid and status = 'running'
        `);
        return "waiting";
      }
      if (decision.tell) told.push(tool.name);
    }
    const answer = (await actingAs("autopilot", async () => (ownerCtx ? runOwnerTool(ownerCtx, name, args) : runPlatformTool(managerCtx, name, args)))) as { done?: string } | null;
    const outcome = await checkStep(p.store, step.check);
    if (!outcome.ok) return (await failStep(step.id, outcome.problem)) === "asking" ? "asking" : "retried";
    const done = typeof answer?.done === "string" ? answer.done : `Ran ${name}.`;
    await completeStep(step.id, plan.id, { done: done.slice(0, 1000), tools: [name], ...(told.length && { told: [done.slice(0, 300)] }) });
    return "done";
  } catch (error) {
    if (!(error instanceof OwnerToolError)) log("error", "autopilot.tool_failed", { step: step.id, tool: name }, error);
    const problem = error instanceof OwnerToolError ? error.message : "The tool failed.";
    return (await failStep(step.id, problem)) === "asking" ? "asking" : "retried";
  }
}

/** The brief, the plan and what earlier steps did and the owner answered, as the task turn's message (data the code wrote, and the owner's words). */
export function taskMessage(planTitle: string, step: PlanStep, steps: readonly PlanStep[]): string {
  if (step.spec.kind !== "task") return "";
  const earlier = steps
    .filter((s) => s.status === "done" || s.status === "skipped")
    .map((s) => `- ${s.key} (${s.title}): ${s.status}${s.answer ? `, the owner answered "${s.answer}"` : ""}${s.result?.done ? `: ${s.result.done}` : s.result?.problem ? `: ${s.result.problem}` : ""}`);
  return [
    `Autopilot: plan "${planTitle}", step ${step.key} "${step.title}".`,
    `Brief: ${step.spec.brief}`,
    ...(earlier.length ? ["", "Earlier steps:", ...earlier] : []),
    "",
    "Do the brief now with your tools, then say in one or two sentences what you did.",
  ].join("\n");
}

/** A task step: a headless turn in the plan's conversation, limited to the step's tools, checked by code afterwards. */
async function runTaskStep(
  plan: PlanFacts,
  p: Principal,
  step: PlanStep,
  steps: readonly PlanStep[],
  settings: AutonomySettings,
  deps: AutopilotDeps,
): Promise<keyof AutopilotRun> {
  if (step.spec.kind !== "task") return "paused";
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(plan.store_id, { feature: "autopilot", accountId: p.account.id });
  const seen: { error: string | null; kept: string[]; answer: string; tools: string[] } = { error: null, kept: [], answer: "", tools: [] };
  const told: string[] = [];
  await actingAs("autopilot", () =>
    (deps.turn ?? runTurn)({
      member: p,
      conversationId: plan.conversation_id,
      message: taskMessage(plan.title, step, steps),
      emit: (event) => {
        if (event.type === "error") seen.error = event.message;
        if (event.type === "approval" && event.approval.status === "pending") seen.kept.push(event.approval.id);
        if (event.type === "done") {
          seen.answer = event.message.content;
          seen.tools = event.message.tools.map((t) => t.name);
        }
      },
      invalidate: refreshTag,
      signal: AbortSignal.timeout(TURN_MS),
      scheduled: true,
      autopilot: { stepId: step.id, tools: step.spec.kind === "task" ? step.spec.tools : [], settings, told },
      connection,
    }),
  );
  if (seen.error) return (await failStep(step.id, seen.error)) === "asking" ? "asking" : "retried";
  const result: StepResult = { done: seen.answer.slice(0, 1000) || "Done.", tools: [...new Set(seen.tools)], ...(told.length && { told: told.map((t) => t.slice(0, 300)) }) };
  if (seen.kept.length > 0) {
    await db().execute(sql`
      update commerce.assistant_plan_steps set status = 'waiting', claimed_until = null, result = ${JSON.stringify(result)}::jsonb
      where id = ${step.id}::uuid and status = 'running'
    `);
    return "waiting";
  }
  const outcome = await checkStep(p.store, step.check);
  if (!outcome.ok) return (await failStep(step.id, outcome.problem)) === "asking" ? "asking" : "retried";
  await completeStep(step.id, plan.id, result);
  return "done";
}
