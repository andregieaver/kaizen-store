import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  checkPlan,
  PLAN_STATUSES,
  RETRY_OPTIONS,
  STEP_TRIES,
  skippedBehind,
  STEP_STATUSES,
  stepCheckSchema,
  stepSpecSchema,
  stepWords,
  type PlannedStep,
  type PlanStatus,
  type StepCheck,
  type StepInput,
  type StepSpec,
  type StepStatus,
} from "@/lib/autopilot-plans";
import { can, type PermissionHolder } from "@/lib/permissions";

import { audit, type Account } from "./auth";
import { checkStep } from "./autopilot-checks";
import { auditArea, getGoal } from "./autopilot-goals";
import { offeredToolsByName } from "./offered-tools";
import { OwnerToolError } from "./owner-tool-error";
import { currentStore, type Store } from "./stores";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The autopilot's plans (D309, `docs/ai-autopilot.md` 7.2), the only writer of `commerce.assistant_plans` and its steps outside the loop's
 * runs (`src/server/autopilot-runner.ts`): making a plan (every step checked by `checkPlan()` first), revising it (back to a draft, the
 * steps not yet run replaced), starting and resuming it on the person's yes (the version they were shown), pausing, stopping and
 * answering its questions. A plan runs in the name of whoever made it; an owner (or a platform admin, for Kaizena Flow's) may also
 * pause, stop and answer it. The database holds the life cycles (`autopilot_plans_rules()`, `autopilot_steps_rules()`).
 */

export type PlanActor = { account: Account; store: Store | null; holder?: PermissionHolder };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const inScope = (store: Store | null, column = sql`store_id`) => (store ? sql`${column} = ${store.id}::uuid` : sql`${column} is null`);
const storeIdOf = (store: Store | null) => (store ? sql`${store.id}::uuid` : sql`null`);
/** An owner of the store, or anyone on the platform's (whose AI manager only platform admins reach). */
const isOwner = (a: PlanActor) => !a.store || !a.holder || can(a.holder, "owner");

const PLAN_ROW = z.object({
  id: col.uuid,
  account_id: col.uuid,
  conversation_id: col.uuid,
  goal_id: col.uuid.nullable(),
  title: col.text,
  summary: col.text,
  version: col.int,
  status: z.enum(PLAN_STATUSES),
  pause_reason: col.textOrNull,
  created_at: col.timestamp,
  started_at: col.timestampOrNull,
  finished_at: col.timestampOrNull,
});
type PlanRow = z.output<typeof PLAN_ROW>;

const STEP_ROW = z.object({
  id: col.uuid,
  plan_id: col.uuid,
  position: col.int,
  key: col.text,
  title: col.text,
  kind: col.text,
  spec: z.unknown(),
  after_keys: z.array(z.string()),
  done_check: z.unknown(),
  status: z.enum(STEP_STATUSES),
  tries: col.int,
  result: z.unknown(),
  question: z.unknown(),
  answer: col.textOrNull,
  not_before: col.timestampOrNull,
  finished_at: col.timestampOrNull,
});
type StepRow = z.output<typeof STEP_ROW>;

export type StepQuestion = { text: string; options: string[]; retry?: boolean };
export type StepResult = { done?: string; problem?: string; tools?: string[]; told?: string[] };

export type PlanStep = {
  id: string;
  key: string;
  title: string;
  spec: StepSpec;
  after: string[];
  check: StepCheck;
  status: StepStatus;
  tries: number;
  result: StepResult | null;
  question: StepQuestion | null;
  answer: string | null;
  notBefore: string | null;
  finishedAt: string | null;
};

export type Plan = {
  id: string;
  accountId: string;
  conversationId: string;
  goalId: string | null;
  title: string;
  summary: string;
  version: number;
  status: PlanStatus;
  pauseReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

const PLAN_COLUMNS = sql`id, account_id, conversation_id, goal_id, title, summary, version, status, pause_reason, created_at, started_at, finished_at`;
const STEP_COLUMNS = sql`id, plan_id, position, key, title, kind, spec, after_keys, done_check, status, tries, result, question, answer, not_before, finished_at`;

const toPlan = (r: PlanRow): Plan => ({
  id: r.id,
  accountId: r.account_id,
  conversationId: r.conversation_id,
  goalId: r.goal_id,
  title: r.title,
  summary: r.summary,
  version: r.version,
  status: r.status,
  pauseReason: r.pause_reason,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const questionSchema = z.object({ text: z.string(), options: z.array(z.string()), retry: z.boolean().optional() });
const resultSchema = z.object({ done: z.string().optional(), problem: z.string().optional(), tools: z.array(z.string()).optional(), told: z.array(z.string()).optional() });

export function toStep(r: StepRow): PlanStep {
  const spec = stepSpecSchema.safeParse({ kind: r.kind, ...(r.spec as object) });
  const check = stepCheckSchema.safeParse(r.done_check);
  const question = questionSchema.safeParse(r.question);
  const result = resultSchema.safeParse(r.result);
  return {
    id: r.id,
    key: r.key,
    title: r.title,
    spec: spec.success ? spec.data : { kind: "question", text: "This step could not be read.", options: [] },
    after: r.after_keys,
    check: check.success ? check.data : { kind: "none" },
    status: r.status,
    tries: r.tries,
    result: result.success ? result.data : null,
    question: question.success ? question.data : null,
    answer: r.answer,
    notBefore: r.not_before,
    finishedAt: r.finished_at,
  };
}

export async function loadPlan(store: Store | null, id: string, run: Executor = db()): Promise<Plan | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await typedRow(PLAN_ROW, sql`select ${PLAN_COLUMNS} from commerce.assistant_plans where id = ${id}::uuid and ${inScope(store)}`, run);
  return row ? toPlan(row) : null;
}

export async function loadSteps(planId: string, run: Executor = db()): Promise<PlanStep[]> {
  const rows = await typedRows(STEP_ROW, sql`select ${STEP_COLUMNS} from commerce.assistant_plan_steps where plan_id = ${planId}::uuid order by position, key`, run);
  return rows.map(toStep);
}

export async function listPlans(store: Store | null, { finished = false }: { finished?: boolean } = {}): Promise<Plan[]> {
  const rows = await typedRows(
    PLAN_ROW,
    sql`select ${PLAN_COLUMNS} from commerce.assistant_plans where ${inScope(store)}
      ${finished ? sql`` : sql`and (status not in ('done', 'stopped') or finished_at > now() - interval '30 days')`}
      order by created_at desc limit 50`,
  );
  return rows.map(toPlan);
}

/** The plan by id, in the actor's scope, that the actor may manage: their own, or any as an owner (`owner`: false for start and revise). */
async function planFor(a: PlanActor, id: string, { owner = true }: { owner?: boolean } = {}, run: Executor = db()): Promise<Plan> {
  const plan = await loadPlan(a.store, id, run);
  if (!plan) return fail("There is no such plan here. Look with list_autopilot_plans.");
  if (plan.accountId !== a.account.id && !(owner && isOwner(a))) return fail("That plan is someone else's: only they, or an owner, can do that.");
  return plan;
}

const stepRowsSql = (planId: string, store: Store | null, steps: readonly PlannedStep[], from: number) =>
  steps.map(
    (s, i) => sql`(${planId}::uuid, ${storeIdOf(store)}, ${from + i}, ${s.key}, ${s.title}, ${s.spec.kind},
      ${JSON.stringify(specFields(s.spec))}::jsonb, ${pgArray(s.after)}::text[], ${JSON.stringify(s.check)}::jsonb)`,
  );

/** The spec as stored: the kind is its own column. */
function specFields(spec: StepSpec): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...spec };
  delete fields.kind;
  return fields;
}

const pgArray = (values: readonly string[]) => `{${values.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",")}}`;

export type MakePlanInput = { title: string; summary: string; goal?: string; steps: StepInput[] };

/** A draft plan with its own conversation; every step checked first, the whole plan refused with the first problem. */
export async function makePlan(a: PlanActor, input: MakePlanInput, now = new Date()): Promise<{ plan: Plan; steps: PlanStep[] }> {
  const checked = checkPlan(input.steps, { scope: a.store ? "store" : "platform", tools: offeredToolsByName(a), now });
  if (!checked.ok) return fail(checked.problem);
  if (input.goal && !(await getGoal(a, input.goal))) return fail("There is no such goal here. Look with list_goals.");
  const planId = await db().transaction(async (tx) => {
    const conversation = await typedRow(
      z.object({ id: col.uuid }),
      sql`insert into commerce.assistant_conversations (store_id, account_id, title)
        values (${storeIdOf(a.store)}, ${a.account.id}::uuid, ${`Autopilot: ${input.title}`.slice(0, 80)}) returning id`,
      tx,
    );
    const plan = await typedRow(
      z.object({ id: col.uuid }),
      sql`insert into commerce.assistant_plans (store_id, goal_id, account_id, conversation_id, title, summary)
        values (${storeIdOf(a.store)}, ${input.goal ?? null}::uuid, ${a.account.id}::uuid, ${conversation?.id ?? null}::uuid, ${input.title}, ${input.summary})
        returning id`,
      tx,
    );
    const id = plan?.id ?? fail("The plan could not be kept.");
    await tx.execute(sql`
      insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec, after_keys, done_check)
      values ${sql.join(stepRowsSql(id, a.store, checked.steps, 0), sql`, `)}
    `);
    return id;
  });
  await audit(a.account.id, a.store?.id ?? null, "ai.plan_made", { planId, steps: checked.steps.length }, auditArea(a));
  return { plan: (await loadPlan(a.store, planId)) ?? fail("The plan could not be read."), steps: await loadSteps(planId) };
}

export type RevisePlanInput = { plan: string; title?: string; summary?: string; steps: StepInput[] };

/**
 * The steps not yet done replaced (a running or paused plan goes back to a draft and must be started again): done and skipped steps
 * stay, later steps may wait for them; the calls the replaced steps kept for a yes are declined.
 */
export async function revisePlan(a: PlanActor, input: RevisePlanInput, now = new Date()): Promise<{ plan: Plan; steps: PlanStep[] }> {
  await db().transaction(async (tx) => {
    const plan = await planFor(a, input.plan, { owner: false }, tx);
    await tx.execute(sql`select 1 from commerce.assistant_plans where id = ${plan.id}::uuid for update`);
    if (plan.status === "done" || plan.status === "stopped") return fail(`That plan is ${plan.status}: make a new one.`);
    const steps = await loadSteps(plan.id, tx);
    if (steps.some((s) => s.status === "running")) return fail("A step of that plan is running now: try again in a minute.");
    const kept = steps.filter((s) => s.status === "done" || s.status === "skipped");
    const checked = checkPlan(input.steps, { scope: a.store ? "store" : "platform", tools: offeredToolsByName(a), now }, kept.map((s) => s.key));
    if (!checked.ok) return fail(checked.problem);
    await tx.execute(sql`
      update commerce.assistant_plans set status = 'draft', version = version + 1, title = ${input.title ?? plan.title}, summary = ${input.summary ?? plan.summary}
      where id = ${plan.id}::uuid
    `);
    const replaced = steps.filter((s) => !kept.includes(s)).map((s) => s.id);
    if (replaced.length) {
      await tx.execute(sql`
        update commerce.assistant_approvals set status = 'declined', decided_at = now(), result = ${JSON.stringify({ error: "The plan was changed." })}::jsonb
        where plan_step_id in (${sql.join(replaced.map((id) => sql`${id}::uuid`), sql`, `)}) and status = 'pending'
      `);
      await tx.execute(sql`delete from commerce.assistant_plan_steps where id in (${sql.join(replaced.map((id) => sql`${id}::uuid`), sql`, `)})`);
    }
    for (const [i, s] of kept.entries()) await tx.execute(sql`update commerce.assistant_plan_steps set position = ${i} where id = ${s.id}::uuid`);
    await tx.execute(sql`
      insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec, after_keys, done_check)
      values ${sql.join(stepRowsSql(plan.id, a.store, checked.steps, kept.length), sql`, `)}
    `);
  });
  await audit(a.account.id, a.store?.id ?? null, "ai.plan_revised", { planId: input.plan, steps: input.steps.length }, auditArea(a));
  return { plan: (await loadPlan(a.store, input.plan)) ?? fail("The plan could not be read."), steps: await loadSteps(input.plan) };
}

/** The words of a start's approval, and the version they describe (kept with the call: the yes starts that version or none). */
export async function planApprovalDetails(a: PlanActor, tool: "start_autopilot_plan" | "resume_autopilot_plan", planId: string): Promise<{ summary: string; version: number } | null> {
  const plan = await loadPlan(a.store, planId);
  if (!plan) return null;
  const steps = (await loadSteps(plan.id)).filter((s) => s.status === "pending" || s.status === "asking" || s.status === "waiting");
  const list = steps.slice(0, 8).map((s, i) => `${i + 1}. ${s.title}`).join("; ");
  const more = steps.length > 8 ? `; and ${steps.length - 8} more` : "";
  const verb = tool === "start_autopilot_plan" ? "Start" : "Resume";
  return {
    summary: `${verb} the plan "${plan.title}" with ${steps.length} step${steps.length === 1 ? "" : "s"} to go (${list}${more}). They run in your name, one at a time, and what your autonomy settings say to ask about still waits for your yes.`,
    version: plan.version,
  };
}

/** Before a start or resume is kept for a yes: the plan is theirs and in the state it needs. */
export async function preflightPlanStart(a: PlanActor, tool: "start_autopilot_plan" | "resume_autopilot_plan", planId: string): Promise<void> {
  const plan = await planFor(a, planId, { owner: false });
  if (tool === "start_autopilot_plan" && plan.status !== "draft") return fail(plan.status === "paused" ? "That plan is paused: resume it instead." : `That plan is ${plan.status}.`);
  if (tool === "resume_autopilot_plan" && plan.status !== "paused") return fail(plan.status === "draft" ? "That plan has not started: start it instead." : `That plan is ${plan.status}.`);
}

/** The person's yes to a start or resume (run by `decideApproval()`): exactly the version they were shown, or refused as changed. */
export async function startPlanNow(a: PlanActor, tool: "start_autopilot_plan" | "resume_autopilot_plan", args: Record<string, unknown>): Promise<{ done: string }> {
  const planId = String(args.plan ?? "");
  const version = Number(args.approved_version);
  const plan = await planFor(a, planId, { owner: false });
  if (plan.version !== version) return fail("The plan changed after you saw it: look at it again and start it then.");
  const from = tool === "start_autopilot_plan" ? "draft" : "paused";
  const rows = await db().execute(sql`
    update commerce.assistant_plans set status = 'running' where id = ${plan.id}::uuid and status = ${from} and version = ${version} returning id
  `);
  if (rows.length === 0) return fail(`The plan is no longer ${from === "draft" ? "a draft" : "paused"}.`);
  await audit(a.account.id, a.store?.id ?? null, tool === "start_autopilot_plan" ? "ai.plan_started" : "ai.plan_resumed", { planId: plan.id, version }, auditArea(a));
  return { done: `The plan "${plan.title}" is running. Its steps run one at a time; what needs you comes to your Decisions.` };
}

export async function pausePlan(a: PlanActor, planId: string, reason?: string): Promise<{ done: string }> {
  const plan = await planFor(a, planId);
  if (plan.status !== "running") return fail(`That plan is ${plan.status}, not running.`);
  await db().execute(sql`
    update commerce.assistant_plans set status = 'paused', pause_reason = ${(reason ?? `Paused by ${a.account.name || a.account.email || "a person"}.`).slice(0, 500)}
    where id = ${plan.id}::uuid and status = 'running'
  `);
  await audit(a.account.id, a.store?.id ?? null, "ai.plan_paused", { planId: plan.id }, auditArea(a));
  return { done: `The plan "${plan.title}" is paused. A step already running finishes first.` };
}

/** Stops a plan for good: its unfinished steps cancelled and the calls they kept for a yes declined. Always safe, never gated. */
export async function stopPlan(a: PlanActor, planId: string): Promise<{ done: string }> {
  const plan = await planFor(a, planId);
  await stopPlanIn(db(), plan.id, plan.status);
  await audit(a.account.id, a.store?.id ?? null, "ai.plan_stopped", { planId: plan.id }, auditArea(a));
  return { done: `The plan "${plan.title}" is stopped. What it already did stays; nothing more runs.` };
}

/** Stops a plan in a transaction or not: also the loop's, when the plan's store closed. */
export async function stopPlanIn(run: Executor, planId: string, status: PlanStatus): Promise<void> {
  if (status === "done" || status === "stopped") return fail(`That plan is already ${status}.`);
  await run.execute(sql`
    update commerce.assistant_approvals set status = 'declined', decided_at = now(), result = ${JSON.stringify({ error: "The plan was stopped." })}::jsonb
    where status = 'pending' and plan_step_id in (select id from commerce.assistant_plan_steps where plan_id = ${planId}::uuid)
  `);
  await run.execute(sql`update commerce.assistant_plans set status = 'stopped' where id = ${planId}::uuid and status not in ('done', 'stopped')`);
  await run.execute(sql`
    update commerce.assistant_plan_steps set status = 'cancelled' where plan_id = ${planId}::uuid and status not in ('done', 'skipped', 'cancelled')
  `);
}

/** Skips the steps that wait for a skipped one, further back too (the plan carries on with the rest). */
export async function skipBehind(run: Executor, planId: string): Promise<void> {
  const steps = await loadSteps(planId, run);
  const keys = skippedBehind(steps.map((s) => ({ key: s.key, after: s.after, status: s.status })));
  if (keys.length === 0) return;
  await run.execute(sql`
    update commerce.assistant_plan_steps set status = 'skipped', result = ${JSON.stringify({ problem: "Skipped: a step it waits for was skipped." })}::jsonb
    where plan_id = ${planId}::uuid and status = 'pending' and key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
  `);
}

/** Marks the plan done when nothing is left to run. */
export async function finishIfDone(run: Executor, planId: string): Promise<boolean> {
  const rows = await run.execute(sql`
    update commerce.assistant_plans p set status = 'done' where p.id = ${planId}::uuid and p.status = 'running'
      and not exists (select 1 from commerce.assistant_plan_steps s where s.plan_id = p.id and s.status not in ('done', 'skipped', 'cancelled'))
    returning id
  `);
  return rows.length > 0;
}

/**
 * The owner's answer to a step that asks: one of its options (or their own words when it has none). A step that failed its tries asks
 * *Try again* (tries start again), *Skip this step* (and the steps waiting for it) or *Stop the plan*.
 */
export async function answerQuestion(a: PlanActor, input: { plan: string; step: string; answer: string }): Promise<{ done: string }> {
  const plan = await planFor(a, input.plan);
  if (plan.status === "done" || plan.status === "stopped") return fail(`That plan is ${plan.status}.`);
  const step = (await loadSteps(plan.id)).find((s) => s.key === input.step || s.id === input.step);
  if (!step) return fail("That plan has no such step.");
  if (step.status !== "asking" || !step.question) return fail("That step is not asking anything now.");
  const answer = input.answer.trim();
  const options = step.question.options;
  const chosen = options.length ? options.find((o) => o.toLowerCase() === answer.toLowerCase()) : answer.slice(0, 500);
  if (!chosen) return fail(`Answer with one of: ${options.join(", ")}.`);
  const by = sql`answer = ${chosen}, answered_by = ${a.account.id}::uuid, answered_at = now()`;
  let done: string;
  if (step.question.retry && chosen === RETRY_OPTIONS[2]) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`update commerce.assistant_plan_steps set status = 'cancelled', ${by} where id = ${step.id}::uuid and status = 'asking'`);
      await stopPlanIn(tx, plan.id, plan.status);
    });
    done = `The plan "${plan.title}" is stopped.`;
  } else if (step.question.retry && chosen === RETRY_OPTIONS[0]) {
    await db().execute(sql`update commerce.assistant_plan_steps set status = 'pending', tries = 0, not_before = null, ${by} where id = ${step.id}::uuid and status = 'asking'`);
    done = `"${step.title}" will be tried again.`;
  } else if (step.question.retry) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        update commerce.assistant_plan_steps set status = 'skipped', ${by}, result = ${JSON.stringify({ problem: "Skipped on the owner's word." })}::jsonb
        where id = ${step.id}::uuid and status = 'asking'
      `);
      await skipBehind(tx, plan.id);
      await finishIfDone(tx, plan.id);
    });
    done = `"${step.title}" is skipped, with the steps that wait for it.`;
  } else {
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        update commerce.assistant_plan_steps set status = 'done', ${by}, result = ${JSON.stringify({ done: `Answered: ${chosen}` })}::jsonb
        where id = ${step.id}::uuid and status = 'asking'
      `);
      await finishIfDone(tx, plan.id);
    });
    done = `Noted: "${chosen}". The plan carries on with it.`;
  }
  await audit(a.account.id, a.store?.id ?? null, "ai.plan_answered", { planId: plan.id, step: step.key }, auditArea(a));
  return { done };
}

/** A plan with its steps, written for the model and the page: statuses, results and what waits. */
export function planWords(plan: Plan, steps: readonly PlanStep[]) {
  return {
    id: plan.id,
    title: plan.title,
    summary: plan.summary,
    status: plan.status,
    ...(plan.pauseReason && { paused_because: plan.pauseReason }),
    version: plan.version,
    steps: steps.map((s) => ({
      key: s.key,
      title: s.title,
      what: stepWords(s.spec),
      ...(s.after.length && { after: s.after }),
      status: s.status,
      ...(s.tries && { tries: s.tries }),
      ...(s.result?.done && { result: s.result.done }),
      ...(s.result?.problem && { problem: s.result.problem }),
      ...(s.question && s.status === "asking" && { asks: s.question.text, options: s.question.options }),
      ...(s.answer && { answer: s.answer }),
    })),
  };
}

// Settling a step (the loop's runs and the owner's answers to calls a step kept) -----------------------------------------------------------

/** How long a failed try waits before the next. */
export const RETRY_MINUTES = 10;

/** A step that worked: done with its result, the steps behind skipped steps skipped, the plan finished when nothing is left. */
export async function completeStep(stepId: string, planId: string, result: StepResult): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.assistant_plan_steps set status = 'done', result = ${JSON.stringify(result)}::jsonb, claimed_until = null
      where id = ${stepId}::uuid and status in ('running', 'waiting', 'pending')
    `);
    await finishIfDone(tx, planId);
  });
}

/** A step that did not work: another try in a while, or, after `STEP_TRIES`, a question for the owner with the problem in words. */
export async function failStep(stepId: string, problem: string): Promise<"retry" | "asking"> {
  const row = await typedRow(z.object({ tries: col.int, title: col.text }), sql`select tries, title from commerce.assistant_plan_steps where id = ${stepId}::uuid`);
  const tries = (row?.tries ?? 0) + 1;
  const words = problem.slice(0, 450);
  if (tries >= STEP_TRIES) {
    const question: StepQuestion = { text: `"${row?.title ?? "A step"}" did not work after ${tries} tries: ${words} What should I do?`, options: [...RETRY_OPTIONS], retry: true };
    await db().execute(sql`
      update commerce.assistant_plan_steps set status = 'asking', tries = ${tries}, question = ${JSON.stringify(question)}::jsonb,
        result = ${JSON.stringify({ problem: words })}::jsonb, claimed_until = null
      where id = ${stepId}::uuid and status in ('running', 'waiting', 'pending')
    `);
    return "asking";
  }
  await db().execute(sql`
    update commerce.assistant_plan_steps set status = 'pending', tries = ${tries}, result = ${JSON.stringify({ problem: words })}::jsonb,
      not_before = now() + make_interval(mins => ${RETRY_MINUTES}), claimed_until = null
    where id = ${stepId}::uuid and status in ('running', 'waiting', 'pending')
  `);
  return "retry";
}

/** A step whose calls the owner declined: skipped, with the steps waiting for it. */
export async function skipStep(stepId: string, planId: string, problem: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.assistant_plan_steps set status = 'skipped', result = ${JSON.stringify({ problem })}::jsonb, claimed_until = null
      where id = ${stepId}::uuid and status in ('running', 'waiting', 'pending')
    `);
    await skipBehind(tx, planId);
    await finishIfDone(tx, planId);
  });
}

const WAITING_STEP = z.object({ id: col.uuid, plan_id: col.uuid, store_slug: col.textOrNull, status: z.enum(STEP_STATUSES), done_check: z.unknown(), result: z.unknown() });
const DECIDED = z.object({ status: col.text, summary: col.text, result: z.unknown() });

/**
 * The owner answered a call a step kept (`decideApproval()`): once every call the step kept is answered, the step goes on. Calls done are
 * checked as the step's check says, a failed call is a failed try, and a step whose every call was declined is skipped.
 */
export async function settleStepApproval(stepId: string): Promise<void> {
  const step = await typedRow(
    WAITING_STEP,
    sql`select s.id, s.plan_id, st.slug as store_slug, s.status, s.done_check, s.result
      from commerce.assistant_plan_steps s left join commerce.stores st on st.id = s.store_id where s.id = ${stepId}::uuid`,
  );
  if (!step || step.status !== "waiting") return;
  const calls = await typedRows(DECIDED, sql`select status, summary, result from commerce.assistant_approvals where plan_step_id = ${stepId}::uuid`);
  if (calls.length === 0 || calls.some((c) => c.status === "pending")) return;
  const failed = calls.find((c) => c.status === "failed");
  if (failed) {
    const why = (failed.result as { error?: string } | null)?.error ?? "it could not be done";
    await failStep(stepId, `${failed.summary} ${why}`);
    return;
  }
  if (calls.every((c) => c.status === "declined")) {
    await skipStep(stepId, step.plan_id, `You declined: ${calls.map((c) => c.summary).join(" ")}`.slice(0, 450));
    return;
  }
  const store = step.store_slug ? await currentStore(step.store_slug) : null;
  const check = stepCheckSchema.safeParse(step.done_check);
  const outcome = await checkStep(store, check.success ? check.data : { kind: "none" });
  const before = resultSchema.safeParse(step.result);
  if (outcome.ok) await completeStep(stepId, step.plan_id, { ...(before.success ? before.data : {}), done: `Done on your yes: ${calls.filter((c) => c.status === "done").map((c) => c.summary).join(" ")}`.slice(0, 1000) });
  else await failStep(stepId, outcome.problem);
}
