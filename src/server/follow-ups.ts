import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { dueFrom, dueWords, FOLLOW_UP_REPEATS, FOLLOW_UPS_MAX } from "@/lib/follow-ups";
import type { ManagerToolInput } from "@/lib/manager-tools";

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

export async function cancelFollowUpTool(ctx: ManagerContext, { follow_up }: ManagerToolInput<"cancel_follow_up">) {
  const rows = await db().execute(sql`
    update commerce.assistant_follow_ups set status = 'cancelled', claimed_until = null
    where id = ${follow_up}::uuid and account_id = ${ctx.account.id}::uuid and ${inArea(ctx)} and status = 'waiting'
    returning 1
  `);
  return rows.length > 0 ? { done: "Cancelled." } : fail("There is no such follow-up waiting.");
}
