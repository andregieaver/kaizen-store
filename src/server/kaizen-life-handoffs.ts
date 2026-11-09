import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  FROM_MAX,
  fromLifeTurnMessage,
  HANDOFF_STATUSES,
  HANDOFFS_PER_DAY,
  isFinal,
  lifeReportMessage,
  noticeOutcome,
  outcomeOfApprovals,
  REPORT_TRIES,
  RESULT_MAX,
  RUN_STALE_MINUTES,
  TASK_MAX,
  TO_LIFE_DAYS,
  type HandoffStatus,
} from "@/lib/kaizen-life-handoffs";
import { siteUrl } from "@/lib/site";
import { kaizenLifeDoor } from "@/lib/work-summary";

import { skipWhilePaused } from "./ai-pause";
import { activeAccount } from "./auth";
import { addNotice, noticeApproval } from "./assistant-notices";
import { accountOfLifeUser, askLife, lifeLinkOf, LifeAssistantError } from "./kaizen-life-accounts";
import { log } from "./log";
import { addMessage, kaizenLifeConversation, runTurn, type Principal, type TurnInput } from "./owner-assistant";
import { refreshTag } from "./refresh";
import { callerOfLink } from "./store-mcp";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Tasks the assistants hand each other over the account link (docs/assistants-together.md, step 2), Kaizena Flow's side. Written only
 * here, in `commerce.kaizen_life_handoffs`, one row per task under the id its sender gave it, and only while the person lets their
 * assistants work together (D517).
 *
 * - **To Kaizen Life** (`to_life`): the AI manager hands Kaizen Life's assistant a task (`handToLife()`), which answers at once that it
 *   took it, does it in its own narrow lane, and reports back through Flow's `handoff-update` door (`takeUpdateFromLife()`): the report is
 *   written into the conversation the task came from, marked as Kaizen Life's, with a notice. Never answered in two days, it is given up.
 * - **From Kaizen Life** (`from_life`): Kaizen Life's assistant hands a store's AI manager a task (`takeHandoffFromLife()`), run as a turn in
 *   the store's "From Kaizen Life" conversation with nobody watching (`runFromLife()`): the same caller as the `tool` door, so the same rules
 *   hold, and changes are kept for the owner's yes. The outcome goes back to Kaizen Life (`reportToLife()`); one that waits for a yes is
 *   reported again once the owner answered every kept change (`settleHandoffAfterApproval()`).
 *
 * A task never starts another: the AI manager's turn for Kaizen Life runs with `fromKaizenLife` (no handing back), and Kaizen Life's run for
 * Flow has no such tool. The five-minute job (`runKaizenLifeHandoffs()`) runs a task whose run never started, tells Kaizen Life what it has
 * not yet heard, and ends what nobody finished.
 */

const ROW = z.object({
  id: col.uuid,
  account_id: col.uuid,
  store_id: col.uuid.nullable(),
  direction: z.enum(["to_life", "from_life"]),
  conversation_id: col.uuid.nullable(),
  task: col.text,
  from_name: col.text.nullable(),
  status: z.enum(HANDOFF_STATUSES),
  result: col.text.nullable(),
  link: col.text.nullable(),
  approval_ids: z.array(col.uuid),
  reported_at: col.timestamp.nullable(),
  report_tries: col.int,
  created_at: col.timestamp,
  updated_at: col.timestamp,
});
type Row = z.output<typeof ROW>;
const COLUMNS = sql`id, account_id, store_id, direction, conversation_id, task, from_name, status, result, link, approval_ids,
  reported_at, report_tries, created_at, updated_at`;

export type Handoff = {
  id: string;
  task: string;
  status: HandoffStatus;
  result: string | null;
  link: string | null;
  createdAt: string;
  updatedAt: string;
};
const toHandoff = (row: Row): Handoff => ({
  id: row.id,
  task: row.task,
  status: row.status,
  result: row.result,
  link: row.link,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** How many tasks the account handed over (or was handed) in the last day, in one direction. */
async function handedToday(accountId: string, direction: Row["direction"]): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.kaizen_life_handoffs
        where account_id = ${accountId}::uuid and direction = ${direction} and created_at > now() - interval '1 day'`,
  );
  return row?.n ?? 0;
}

async function handoffRow(id: string, direction: Row["direction"]): Promise<Row | null> {
  return typedRow(ROW, sql`select ${COLUMNS} from commerce.kaizen_life_handoffs where id = ${id}::uuid and direction = ${direction}`);
}

/** The person's Principal for writing into a conversation of theirs: their account, in the store it belongs to or on the platform. */
async function principalOf(accountId: string, storeId: string | null): Promise<Principal | null> {
  const account = await activeAccount(accountId);
  if (!account) return null;
  if (!storeId) return { account, store: null };
  const found = await typedRow(z.object({ slug: col.text }), sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = found ? await getStore(found.slug) : null;
  return store ? { account, store } : null;
}

// To Kaizen Life ----------------------------------------------------------------------------------------------------------------------

/**
 * The AI manager hands Kaizen Life's assistant a task for the person (`hand_to_kaizen_life`), from the conversation it is in. Kaizen Life
 * answers at once that it took it; its report comes back later. A `LifeAssistantError` says why it was not handed over, in words the
 * model passes on.
 */
export async function handToLife(
  p: Pick<Principal, "account" | "store">,
  conversationId: string | null,
  task: string,
  fetcher: typeof fetch = fetch,
): Promise<Handoff> {
  const clean = task.trim().slice(0, TASK_MAX);
  if (!clean) throw new LifeAssistantError("Say the task in words.");
  const link = await lifeLinkOf(p.account.id);
  if (!link?.assistants) throw new LifeAssistantError("Kaizen Life's assistant is not switched on for this account: the person switches it on under Your account → Connected apps.");
  if ((await handedToday(p.account.id, "to_life")) >= HANDOFFS_PER_DAY) {
    throw new LifeAssistantError(`At most ${HANDOFFS_PER_DAY} tasks a day go to Kaizen Life. Try again tomorrow.`);
  }
  const id = randomUUID();
  const from = (p.store?.name ?? "Kaizena Flow").slice(0, FROM_MAX);
  const row = await typedRow(
    ROW,
    sql`insert into commerce.kaizen_life_handoffs (id, account_id, store_id, direction, conversation_id, task, from_name)
        values (${id}::uuid, ${p.account.id}::uuid, ${p.store?.id ?? null}::uuid, 'to_life', ${conversationId}::uuid, ${clean}, ${from})
        returning ${COLUMNS}`,
  );
  if (!row) throw new LifeAssistantError("The task could not be kept.");
  const answer = z
    .union([z.object({ accepted: z.literal(true) }), z.object({ accepted: z.literal(false), error: z.string() })])
    .safeParse(await askLife("handoff", { handoffId: id, lifeUserId: link.lifeUserId, flowAccountId: p.account.id, task: clean, from }, fetcher));
  if (!answer.success || !answer.data.accepted) {
    await db().execute(sql`delete from commerce.kaizen_life_handoffs where id = ${id}::uuid and direction = 'to_life'`);
    throw new LifeAssistantError(answer.success && !answer.data.accepted ? answer.data.error.slice(0, 500) : "Kaizen Life did not take the task just now.");
  }
  return toHandoff(row);
}

/** The tasks the person handed Kaizen Life lately (`kaizen_life_handoffs`), newest first. */
export async function lifeHandoffsOf(accountId: string, limit = 10): Promise<Handoff[]> {
  const rows = await typedRows(
    ROW,
    sql`select ${COLUMNS} from commerce.kaizen_life_handoffs
        where account_id = ${accountId}::uuid and direction = 'to_life'
        order by created_at desc limit ${Math.min(Math.max(limit, 1), 30)}`,
  );
  return rows.map(toHandoff);
}

export type HandoffListItem = Handoff & {
  direction: Row["direction"];
  /** The store it was for or from; null on the platform. */
  storeName: string | null;
  /** The conversation it lives in, in the admin; null when there is none. */
  href: string | null;
  /** Not ended: a task handed to Kaizen Life can still be taken back. */
  open: boolean;
};

/**
 * *Between your assistants* (docs/assistants-together.md, step 3): the person's latest tasks both ways, newest first, each with the store
 * and the conversation it lives in.
 */
export async function recentHandoffsOf(accountId: string, limit = 8): Promise<HandoffListItem[]> {
  const rows = await typedRows(
    ROW.extend({ slug: col.text.nullable(), store_name: col.text.nullable() }),
    sql`select h.id, h.account_id, h.store_id, h.direction, h.conversation_id, h.task, h.from_name, h.status, h.result, h.link,
          h.approval_ids, h.reported_at, h.report_tries, h.created_at, h.updated_at, s.slug, s.name as store_name
        from commerce.kaizen_life_handoffs h left join commerce.stores s on s.id = h.store_id
        where h.account_id = ${accountId}::uuid
        order by h.created_at desc limit ${Math.min(Math.max(limit, 1), 30)}`,
  );
  return rows.map((row) => ({
    ...toHandoff(row),
    direction: row.direction,
    storeName: row.store_name,
    href: row.conversation_id ? `/admin/${row.slug ?? "platform"}/assistant?c=${row.conversation_id}` : null,
    open: !isFinal(row.status),
  }));
}

/** The person takes back a task handed to Kaizen Life that has not ended: stopped here, and Kaizen Life told. */
export async function cancelToLife(accountId: string, id: string, fetcher: typeof fetch = fetch): Promise<Handoff | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    ROW,
    sql`update commerce.kaizen_life_handoffs set status = 'cancelled', updated_at = now(), finished_at = now()
        where id = ${id}::uuid and account_id = ${accountId}::uuid and direction = 'to_life' and status in ('working', 'waiting_for_you')
        returning ${COLUMNS}`,
  );
  if (!row) return null;
  const link = await lifeLinkOf(accountId);
  if (link) await askLife("handoff", { handoffId: id, lifeUserId: link.lifeUserId, flowAccountId: accountId, cancel: true }, fetcher);
  return toHandoff(row);
}

const UPDATE = z.object({
  handoffId: z.uuid(),
  lifeUserId: z.uuid(),
  status: z.enum(HANDOFF_STATUSES),
  result: z.string().max(RESULT_MAX * 2).nullish(),
  link: z.string().max(2000).nullish(),
});

/** A link Kaizen Life sends with a report: one of its own pages, or nothing. */
function lifeLinkOk(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const life = new URL(process.env.KAIZEN_LIFE_URL?.trim() || "https://kaizenalife.com");
    const url = new URL(link);
    return url.origin === life.origin && url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The `handoff-update` door: Kaizen Life reports on a task the AI manager handed it. Taken only for the linked account's own task while it
 * has not ended; written into the conversation it came from (marked as Kaizen Life's) with a notice. `not_found` for any other.
 */
export async function takeUpdateFromLife(body: unknown): Promise<{ ok: true } | { error: "bad_request" | "not_linked" | "not_found" }> {
  const input = UPDATE.safeParse(body);
  if (!input.success) return { error: "bad_request" };
  const accountId = await accountOfLifeUser(input.data.lifeUserId);
  if (!accountId) return { error: "not_linked" };
  const result = input.data.result?.trim().slice(0, RESULT_MAX) || null;
  const link = lifeLinkOk(input.data.link);
  const row = await typedRow(
    ROW,
    sql`update commerce.kaizen_life_handoffs
           set status = ${input.data.status}, result = ${result}, link = ${link}, updated_at = now(),
               finished_at = case when ${isFinal(input.data.status)} then now() else null end
        where id = ${input.data.handoffId}::uuid and account_id = ${accountId}::uuid and direction = 'to_life'
          and status in ('working', 'waiting_for_you')
        returning ${COLUMNS}`,
  );
  if (!row) return { error: "not_found" };
  await tellPerson(row);
  return { ok: true };
}

/** Writes a report on a task handed to Kaizen Life into its conversation, and a notice, once per status. Never throws. */
async function tellPerson(row: Row): Promise<void> {
  try {
    const p = await principalOf(row.account_id, row.store_id);
    if (!p) return;
    if (row.conversation_id) await addMessage(p, row.conversation_id, "assistant", lifeReportMessage(row.task, row.status, row.result, row.link));
    await addNotice({
      accountId: row.account_id,
      storeId: row.store_id,
      notice: "life_handoff",
      ref: `${row.id}:${row.status}`,
      path: row.conversation_id ? `assistant?c=${row.conversation_id}` : "assistant",
      facts: { task: row.task.slice(0, 120), outcome: noticeOutcome(row.status) },
    });
  } catch (error) {
    log("error", "kaizen_life.handoff_tell_failed", { handoff: row.id }, error);
  }
}

// From Kaizen Life --------------------------------------------------------------------------------------------------------------------

const TAKE = z.object({
  handoffId: z.uuid(),
  lifeUserId: z.uuid(),
  store: z.string().min(1).max(100),
  task: z.string().trim().min(1).max(TASK_MAX * 2),
  from: z.string().max(FROM_MAX * 2).nullish(),
});
const CANCEL = z.object({ handoffId: z.uuid(), lifeUserId: z.uuid(), cancel: z.literal(true) });

export type TakeOutcome =
  | { kind: "accepted"; id: string; fresh: boolean }
  | { kind: "cancelled" }
  | { kind: "refused"; status: number; error: string };

/**
 * The `handoff` door: Kaizen Life's assistant hands a store's AI manager a task (or takes one back, `cancel`). Taken only while the person
 * lets their assistants work together, for a store the linked account owns and reaches at the switch's assurance (`callerOfLink()`, as the
 * `tool` door), within the day's tasks. Taken again under the same id, it answers the task that stands. The caller runs it after the answer.
 */
export async function takeHandoffFromLife(body: unknown): Promise<TakeOutcome> {
  const cancel = CANCEL.safeParse(body);
  if (cancel.success) {
    const accountId = await accountOfLifeUser(cancel.data.lifeUserId);
    if (accountId) await cancelFromLife(accountId, cancel.data.handoffId);
    return { kind: "cancelled" };
  }
  const input = TAKE.safeParse(body);
  if (!input.success) return { kind: "refused", status: 400, error: "bad_request" };
  const accountId = await accountOfLifeUser(input.data.lifeUserId);
  if (!accountId) return { kind: "refused", status: 404, error: "not_linked" };
  const link = await lifeLinkOf(accountId);
  if (!link?.assistants) return { kind: "refused", status: 403, error: "assistants_off" };
  const caller = await callerOfLink(accountId, link.assistants.aal);
  if (!caller) {
    const atSecondStep = link.assistants.aal === "aal1" ? await callerOfLink(accountId, "aal2") : null;
    return { kind: "refused", status: 403, error: atSecondStep ? "two_step" : "no_stores" };
  }
  const store = caller.stores.find((s) => s.slug === input.data.store);
  if (!store) return { kind: "refused", status: 403, error: "store" };
  const standing = await handoffRow(input.data.handoffId, "from_life");
  if (standing) return standing.account_id === accountId ? { kind: "accepted", id: standing.id, fresh: false } : { kind: "refused", status: 409, error: "taken" };
  if ((await handedToday(accountId, "from_life")) >= HANDOFFS_PER_DAY) return { kind: "refused", status: 429, error: "too_many" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.kaizen_life_handoffs (id, account_id, store_id, direction, task, from_name)
        values (${input.data.handoffId}::uuid, ${accountId}::uuid, ${store.id}::uuid, 'from_life', ${input.data.task.slice(0, TASK_MAX)},
                ${input.data.from?.trim().slice(0, FROM_MAX) || null})
        on conflict (id) do nothing
        returning id`,
  );
  if (!row) return { kind: "refused", status: 409, error: "taken" };
  return { kind: "accepted", id: row.id, fresh: true };
}

/** Kaizen Life takes back a task it handed over: stopped, and the changes it kept for a yes declined, so none runs later. */
async function cancelFromLife(accountId: string, id: string): Promise<void> {
  const row = await typedRow(
    ROW,
    sql`update commerce.kaizen_life_handoffs set status = 'cancelled', updated_at = now(), finished_at = now(), reported_at = now()
        where id = ${id}::uuid and account_id = ${accountId}::uuid and direction = 'from_life' and status in ('working', 'waiting_for_you')
        returning ${COLUMNS}`,
  );
  if (!row || row.approval_ids.length === 0) return;
  await db().execute(sql`
    update commerce.assistant_approvals
       set status = 'declined', decided_at = now(), result = ${JSON.stringify({ error: "Kaizen Life took the task back." })}::jsonb
     where id = any(${sql`array[${sql.join(row.approval_ids.map((a) => sql`${a}::uuid`), sql`, `)}]`}) and status = 'pending'
  `);
}

export type FromLifeDeps = { turn?: (input: TurnInput) => Promise<void>; fetcher?: typeof fetch };

/** How long the store's AI manager may take over a task from Kaizen Life. */
const TURN_MS = 150_000;

/**
 * Runs a task Kaizen Life handed a store's AI manager: claimed first (never twice), as the linked owner, a turn in the store's "From Kaizen
 * Life" conversation with nobody watching. What it kept for a yes makes it `waiting_for_you`, with the conversation's link through the
 * door; else `done` with its answer, or `failed`. Kaizen Life is told. Never throws.
 */
export async function runFromLife(id: string, deps: FromLifeDeps = {}): Promise<HandoffStatus | null> {
  const claimed = await typedRow(
    ROW,
    sql`update commerce.kaizen_life_handoffs
           set claimed_until = now() + make_interval(mins => ${RUN_STALE_MINUTES}), started_at = coalesce(started_at, now()), updated_at = now()
        where id = ${id}::uuid and direction = 'from_life' and status = 'working' and started_at is null
          and (claimed_until is null or claimed_until < now())
        returning ${COLUMNS}`,
  );
  if (!claimed) return null;
  let status: HandoffStatus = "failed";
  let result: string | null = null;
  let link: string | null = null;
  let conversationId: string | null = null;
  const approvalIds: string[] = [];
  try {
    const link0 = await lifeLinkOf(claimed.account_id);
    const caller = link0?.assistants ? await callerOfLink(claimed.account_id, link0.assistants.aal) : null;
    const reached = caller?.stores.find((s) => s.id === claimed.store_id);
    const store = reached ? await getStore(reached.slug) : null;
    if (!caller || !store) {
      result = "The store is no longer within reach of Kaizen Life's assistant.";
    } else {
      const member = { account: caller.account, store, role: "owner" as const };
      conversationId = await kaizenLifeConversation(member);
      const seen: { error: string | null; answer: string | null } = { error: null, answer: null };
      const kept: { id: string; summary: string }[] = [];
      await (deps.turn ?? runTurn)({
        member,
        conversationId,
        message: fromLifeTurnMessage(claimed.task, claimed.from_name),
        emit: (event) => {
          if (event.type === "error") seen.error = event.message;
          if (event.type === "approval" && event.approval.status === "pending") kept.push({ id: event.approval.id, summary: event.approval.summary });
          if (event.type === "done") seen.answer = event.message.content;
        },
        invalidate: refreshTag,
        signal: AbortSignal.timeout(TURN_MS),
        fromKaizenLife: true,
        outside: { client: "Kaizen Life", via: "kaizen-life", propose: false },
        scheduled: true,
      });
      approvalIds.push(...kept.map((k) => k.id));
      for (const k of kept) await noticeApproval({ id: k.id, summary: k.summary }, conversationId, caller.account.id, store.id);
      link = kaizenLifeDoor(siteUrl(), `/admin/${store.slug}/assistant?c=${conversationId}`);
      if (seen.error) {
        result = seen.error.slice(0, 500);
      } else {
        status = kept.length > 0 ? "waiting_for_you" : "done";
        result = (seen.answer ?? "").trim().slice(0, RESULT_MAX) || null;
        if (kept.length > 0) {
          const waiting = kept.map((k) => `- ${k.summary}`).join("\n");
          result = `${result ? `${result}\n\n` : ""}Waiting for the owner's yes in Kaizena Flow:\n${waiting}`.slice(0, RESULT_MAX);
        }
      }
    }
  } catch (error) {
    log("error", "kaizen_life.handoff_run_failed", { handoff: id }, error);
    result = "The store's AI manager could not finish it.";
  }
  await db().execute(sql`
    update commerce.kaizen_life_handoffs
       set status = ${status}, result = ${result}, link = ${link}, conversation_id = ${conversationId}::uuid,
           approval_ids = ${approvalIds.length ? sql`array[${sql.join(approvalIds.map((a) => sql`${a}::uuid`), sql`, `)}]` : sql`'{}'::uuid[]`},
           claimed_until = null, reported_at = null, report_tries = 0, updated_at = now(),
           finished_at = case when ${isFinal(status)} then now() else null end
     where id = ${id}::uuid and direction = 'from_life' and status = 'working'
  `);
  await reportToLife(id, deps.fetcher);
  return status;
}

/** Tells Kaizen Life the status of a task it handed over, once per status; a failure is tried again by the five-minute job. */
export async function reportToLife(id: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const row = await handoffRow(id, "from_life");
  if (!row || (row.reported_at && row.reported_at >= row.updated_at)) return false;
  const link = await lifeLinkOf(row.account_id);
  const told = link
    ? z.object({ ok: z.literal(true) }).safeParse(
        await askLife(
          "handoff-update",
          { handoffId: row.id, lifeUserId: link.lifeUserId, flowAccountId: row.account_id, status: row.status, result: row.result, link: row.link },
          fetcher,
        ),
      ).success
    : false;
  await db().execute(sql`
    update commerce.kaizen_life_handoffs
       set ${told ? sql`reported_at = now(), report_tries = 0` : sql`report_tries = report_tries + 1`}
     where id = ${id}::uuid and direction = 'from_life'
  `);
  return told;
}

/**
 * The owner answered a change a task from Kaizen Life kept for a yes (`decideApproval()`, or it ran out): once none of the task's changes
 * waits, the task ends as they came to (`outcomeOfApprovals()`), and Kaizen Life is told. Never throws.
 */
export async function settleHandoffAfterApproval(approvalId: string, fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const row = await typedRow(
      ROW,
      sql`select ${COLUMNS} from commerce.kaizen_life_handoffs
          where direction = 'from_life' and status = 'waiting_for_you' and ${approvalId}::uuid = any(approval_ids)`,
    );
    if (!row) return;
    const approvals = await typedRows(
      z.object({ summary: col.text, status: col.text }),
      sql`select summary, status from commerce.assistant_approvals
          where id = any(${sql`array[${sql.join(row.approval_ids.map((a) => sql`${a}::uuid`), sql`, `)}]`}) order by created_at`,
    );
    const outcome = outcomeOfApprovals(approvals.map((a) => a.status));
    if (!outcome) return;
    const WORD: Record<string, string> = { done: "Done", declined: "Declined", failed: "Failed", expired: "Not answered in time" };
    const summary = approvals.map((a) => `- ${WORD[a.status] ?? a.status}: ${a.summary}`).join("\n");
    const settled = await typedRow(
      z.object({ id: col.uuid }),
      sql`update commerce.kaizen_life_handoffs
             set status = ${outcome}, result = ${`The owner answered in Kaizena Flow:\n${summary}`.slice(0, RESULT_MAX)},
                 reported_at = null, report_tries = 0, updated_at = now(), finished_at = now()
          where id = ${row.id}::uuid and direction = 'from_life' and status = 'waiting_for_you'
          returning id`,
    );
    if (settled) await reportToLife(row.id, fetcher);
  } catch (error) {
    log("error", "kaizen_life.handoff_settle_failed", { approvalId }, error);
  }
}

// The five-minute job ------------------------------------------------------------------------------------------------------------------

export type HandoffsRun = { ran: number; reported: number; givenUp: number };

/**
 * The five-minute job: runs a task from Kaizen Life whose run never started (an answer's `after()` lost) and ends one whose run stopped;
 * tells Kaizen Life a status it has not heard, a few tries each; gives up a task handed to Kaizen Life that it never reported on in
 * `TO_LIFE_DAYS`, telling the person. Tasks wait while a platform admin has paused the AI acting on its own (PSI AST-07).
 */
export async function runKaizenLifeHandoffs(deps: FromLifeDeps = {}): Promise<HandoffsRun> {
  const out: HandoffsRun = { ran: 0, reported: 0, givenUp: 0 };
  if (!(await skipWhilePaused("kaizen_life_handoffs"))) {
    const waiting = await typedRows(
      z.object({ id: col.uuid }),
      sql`select id from commerce.kaizen_life_handoffs
          where direction = 'from_life' and status = 'working' and started_at is null and created_at < now() - interval '1 minute'
            and (claimed_until is null or claimed_until < now())
          order by created_at limit 2`,
    );
    for (const { id } of waiting) if (await runFromLife(id, deps)) out.ran++;
  }
  const stopped = await typedRows(
    z.object({ id: col.uuid }),
    sql`update commerce.kaizen_life_handoffs
           set status = 'failed', result = 'The store''s AI manager stopped before it finished.', claimed_until = null,
               reported_at = null, report_tries = 0, updated_at = now(), finished_at = now()
        where direction = 'from_life' and status = 'working' and started_at is not null
          and started_at < now() - make_interval(mins => ${RUN_STALE_MINUTES}) and (claimed_until is null or claimed_until < now())
        returning id`,
  );
  const unheard = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.kaizen_life_handoffs
        where direction = 'from_life' and status <> 'working' and (reported_at is null or reported_at < updated_at)
          and report_tries < ${REPORT_TRIES}
        order by updated_at limit 10`,
  );
  for (const { id } of [...stopped, ...unheard]) if (await reportToLife(id, deps.fetcher)) out.reported++;
  // Tasks whose kept changes were all answered (or ran out) while the answer's own report was lost: settled here.
  const answered = await typedRows(
    z.object({ approval: col.uuid }),
    sql`select h.approval_ids[1] as approval from commerce.kaizen_life_handoffs h
        where h.direction = 'from_life' and h.status = 'waiting_for_you' and cardinality(h.approval_ids) > 0
          and not exists (select 1 from commerce.assistant_approvals a where a.id = any(h.approval_ids) and a.status = 'pending')
        order by h.updated_at limit 10`,
  );
  for (const { approval } of answered) await settleHandoffAfterApproval(approval, deps.fetcher);
  const givenUp = await typedRows(
    ROW,
    sql`update commerce.kaizen_life_handoffs
           set status = 'expired', result = 'Kaizen Life did not report back.', updated_at = now(), finished_at = now()
        where direction = 'to_life' and status in ('working', 'waiting_for_you')
          and updated_at < now() - make_interval(days => ${TO_LIFE_DAYS})
        returning ${COLUMNS}`,
  );
  for (const row of givenUp) await tellPerson(row);
  out.givenUp = givenUp.length;
  return out;
}
