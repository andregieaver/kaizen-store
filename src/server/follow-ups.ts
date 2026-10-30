import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, type Db } from "@/db/client";
import { dueFrom, dueWords, FOLLOW_UP_REPEATS, FOLLOW_UPS_MAX, TASK_MAX } from "@/lib/follow-ups";
import { RULE_LIMITS } from "@/lib/order-rules";
import { can } from "@/lib/permissions";
import type { ManagerToolInput } from "@/lib/manager-tools";

import { holderOf, passMembership } from "./auth";
import type { ManagerContext } from "./manager-tools";
import { OwnerToolError } from "./owner-tools";
import { col, typedRows } from "./typed-rows";

/**
 * The AI manager's follow-up tools (PSI AGT-04, AGT-11; `src/lib/follow-ups.ts`): keep, list and cancel the person's follow-ups in the
 * store (or the platform) they are working in. The only writer of `commerce.assistant_follow_ups` besides the runner
 * (`src/server/follow-up-runner.ts`), which gives each back to the AI manager when it is due.
 */

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const timeZoneOf = (ctx: Pick<ManagerContext, "store">) => ctx.store?.timeZone ?? "Europe/Oslo";
const inArea = (ctx: Pick<ManagerContext, "store">) => (ctx.store ? sql`store_id = ${ctx.store.id}::uuid` : sql`store_id is null`);

const WAITING_ROW = z.object({ id: col.uuid, task: col.text, due_at: col.timestamp, repeat: z.enum(FOLLOW_UP_REPEATS) });

export async function followUpTool(ctx: ManagerContext, input: ManagerToolInput<"follow_up">) {
  if (ctx.scheduled) return fail("A follow-up cannot set another: say in your answer what they could ask for next.");
  const conversationId = ctx.turn?.conversationId;
  if (!conversationId) return fail("Follow-ups are kept in a conversation with the person.");
  const timeZone = timeZoneOf(ctx);
  const due = dueFrom({ at: input.at, inHours: input.in_hours }, timeZone, new Date());
  if (!due.ok) return fail(due.problem);
  const kept = await db().transaction(async (tx) => {
    // One person's follow-ups in one place are counted under a lock of their own, so two at once cannot pass the limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`follow-ups:${ctx.account.id}:${ctx.store?.id ?? "platform"}`}))`);
    const [count] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from commerce.assistant_follow_ups
      where account_id = ${ctx.account.id}::uuid and ${inArea(ctx)} and status = 'waiting'
    `);
    if (Number(count.n) >= FOLLOW_UPS_MAX) return null;
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.assistant_follow_ups (store_id, account_id, conversation_id, task, due_at, repeat, time_zone)
      values (${ctx.store?.id ?? null}::uuid, ${ctx.account.id}::uuid, ${conversationId}::uuid, ${input.task}, ${due.due.toISOString()}::timestamptz,
        ${input.repeat}, ${timeZone})
      returning id
    `);
    return String(row.id);
  });
  if (!kept) return fail(`They already have ${FOLLOW_UPS_MAX} follow-ups waiting here: cancel one first (list_follow_ups).`);
  return {
    done: `Kept: you will follow up ${dueWords(due.due, input.repeat, timeZone)} (${timeZone}), and they get an email when your answer is there.`,
    id: kept,
  };
}

export async function listFollowUpsTool(ctx: ManagerContext) {
  const timeZone = timeZoneOf(ctx);
  const rows = await typedRows(
    WAITING_ROW,
    sql`
      select id, task, due_at, repeat from commerce.assistant_follow_ups
      where account_id = ${ctx.account.id}::uuid and ${inArea(ctx)} and status = 'waiting'
      order by due_at limit ${FOLLOW_UPS_MAX}
    `,
  );
  if (rows.length === 0) return { follow_ups: [], note: "Nothing is waiting." };
  return { follow_ups: rows.map((row) => ({ id: row.id, task: row.task, when: dueWords(new Date(row.due_at), row.repeat, timeZone) })) };
}

/** A waiting follow-up as the Autopilot page lists it (PSI AGT-04): what, when it is next due, and whether it comes back. */
export type WaitingFollowUp = { id: string; task: string; dueAt: string; repeat: (typeof FOLLOW_UP_REPEATS)[number]; timeZone: string };

/** The person's follow-ups waiting here, soonest first: the Autopilot page lists them, each with Cancel, outside the chat (PSI AGT-04). */
export async function waitingFollowUps(ctx: Pick<ManagerContext, "account" | "store">): Promise<WaitingFollowUp[]> {
  const rows = await typedRows(
    WAITING_ROW,
    sql`
      select id, task, due_at, repeat from commerce.assistant_follow_ups
      where account_id = ${ctx.account.id}::uuid and ${inArea(ctx)} and status = 'waiting'
      order by due_at limit ${FOLLOW_UPS_MAX}
    `,
  );
  return rows.map((row) => ({ id: row.id, task: row.task, dueAt: row.due_at, repeat: row.repeat, timeZone: timeZoneOf(ctx) }));
}

/** Cancels one of the person's waiting follow-ups here; false when there is none such (done, cancelled, or not theirs). */
export async function cancelFollowUp(ctx: Pick<ManagerContext, "account" | "store">, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db().execute(sql`
    update commerce.assistant_follow_ups set status = 'cancelled', claimed_until = null
    where id = ${id}::uuid and account_id = ${ctx.account.id}::uuid and ${inArea(ctx)} and status = 'waiting'
    returning 1
  `);
  return rows.length > 0;
}

export async function cancelFollowUpTool(ctx: ManagerContext, { follow_up }: ManagerToolInput<"cancel_follow_up">) {
  return (await cancelFollowUp(ctx, follow_up)) ? { done: "Cancelled." } : fail("There is no such follow-up waiting.");
}

export type AskOutcome = "ok" | "ask_limit" | "no_owner" | "not_found";

/**
 * An order rule's *Ask the AI manager* (PSI AGT-04, `docs/wave-3-notifications.md` rules): a follow-up due at once, in a conversation of its own, in
 * the name of whoever last saved the rule while they are an owner of the store (the AI manager is the owners'). The runner gives it to the AI manager
 * within five minutes and emails them. At most `RULE_LIMITS.asksPerDay` in a store in 24 hours, counted under the store's lock in the rule's own
 * transaction, so a busy day cannot run up the store's AI.
 */
/**
 * A workflow's *Ask the AI manager* (D356): as an order rule's ask, in the name of whoever last saved the workflow while an owner, counted
 * against the same `RULE_LIMITS.asksPerDay` (origin `rule`, the order's id), in the run's transaction.
 */
export async function askFromWorkflow(
  tx: Db,
  input: { storeId: string; workflowId: string; name: string; question: string; orderId: string; orderNumber: string },
): Promise<AskOutcome> {
  const [flow] = await tx.execute<{ account: string | null; slug: string; time_zone: string }>(sql`
    select coalesce(w.updated_by, w.created_by) as account, s.slug, s.time_zone from commerce.workflows w join commerce.stores s on s.id = w.store_id
    where w.id = ${input.workflowId}::uuid and w.store_id = ${input.storeId}::uuid
  `);
  if (!flow) return "not_found";
  if (!flow.account) return "no_owner";
  const member = await passMembership(flow.slug, flow.account);
  if (!member || !can(holderOf(member), "owner")) return "no_owner";
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`follow-ups:rule:${input.storeId}`}))`);
  const [asked] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from commerce.assistant_follow_ups
    where store_id = ${input.storeId}::uuid and origin = 'rule' and created_at > now() - interval '24 hours'
  `);
  if (Number(asked.n) >= RULE_LIMITS.asksPerDay) return "ask_limit";
  const [conversation] = await tx.execute<{ id: string }>(sql`
    insert into commerce.assistant_conversations (store_id, account_id, title)
    values (${input.storeId}::uuid, ${flow.account}::uuid, ${`${input.name}: order ${input.orderNumber}`.slice(0, 80)})
    returning id
  `);
  const task = `The workflow "${input.name}" ran for order ${input.orderNumber} and asks you: ${input.question} Read the order with your tools first.`;
  await tx.execute(sql`
    insert into commerce.assistant_follow_ups (store_id, account_id, conversation_id, task, due_at, time_zone, origin, order_id)
    values (${input.storeId}::uuid, ${flow.account}::uuid, ${String(conversation.id)}::uuid, ${task.slice(0, TASK_MAX)}, now(), ${flow.time_zone}, 'rule',
      ${input.orderId}::uuid)
  `);
  return "ok";
}

export async function askAiManager(
  tx: Db,
  input: { storeId: string; orderId: string; ruleId: string; ruleName: string; question: string; orderNumber: string },
): Promise<AskOutcome> {
  const [rule] = await tx.execute<{ account: string | null; slug: string; time_zone: string }>(sql`
    select coalesce(r.updated_by, r.created_by) as account, s.slug, s.time_zone from commerce.order_rules r join commerce.stores s on s.id = r.store_id
    where r.id = ${input.ruleId}::uuid and r.store_id = ${input.storeId}::uuid
  `);
  if (!rule) return "not_found";
  if (!rule.account) return "no_owner";
  const member = await passMembership(rule.slug, rule.account);
  if (!member || !can(holderOf(member), "owner")) return "no_owner";
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`follow-ups:rule:${input.storeId}`}))`);
  const [asked] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from commerce.assistant_follow_ups
    where store_id = ${input.storeId}::uuid and origin = 'rule' and created_at > now() - interval '24 hours'
  `);
  if (Number(asked.n) >= RULE_LIMITS.asksPerDay) return "ask_limit";
  const [conversation] = await tx.execute<{ id: string }>(sql`
    insert into commerce.assistant_conversations (store_id, account_id, title)
    values (${input.storeId}::uuid, ${rule.account}::uuid, ${`${input.ruleName}: order ${input.orderNumber}`.slice(0, 80)})
    returning id
  `);
  const task = `Order ${input.orderNumber} was paid, and the automation rule "${input.ruleName}" asks you: ${input.question} Read the order with your tools first.`;
  await tx.execute(sql`
    insert into commerce.assistant_follow_ups (store_id, account_id, conversation_id, task, due_at, time_zone, origin, order_id)
    values (${input.storeId}::uuid, ${rule.account}::uuid, ${String(conversation.id)}::uuid, ${task.slice(0, TASK_MAX)}, now(), ${rule.time_zone}, 'rule',
      ${input.orderId}::uuid)
  `);
  return "ok";
}
