import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { adminLangOf, ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { renderEmail } from "@/lib/email-layout";
import { followUpEmail } from "@/lib/follow-up-email";
import { FOLLOW_UP_REPEATS, FOLLOW_UP_TRIES, followUpMessage, nextDue, RETRY_MINUTES } from "@/lib/follow-ups";
import { siteUrl } from "@/lib/site";

import type { AiConnection } from "./ai";
import { activeAccount, passMembership, type Account } from "./auth";
import { addNotice } from "./assistant-notices";
import { sendEmail, type OutgoingEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { runTurn, type Principal, type TurnInput } from "./owner-assistant";
import { refreshTag } from "./refresh";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Gives the AI manager's follow-ups back to it when they are due (PSI AGT-04, AGT-11), from the five-minute dispatcher: a few at a time,
 * each claimed first, each run as a turn in the conversation it was asked in, in the person's name and with what their role may do today
 * (an account disabled, a member removed or a platform admin no longer one cancels it; a store that is not open waits a day). Nobody is
 * there, so nothing is decided in words; gated changes are kept for their yes as ever. They are emailed where to read the answer, never
 * the answer. A turn that fails waits `RETRY_MINUTES` and stops after `FOLLOW_UP_TRIES`; a repeating one then moves to its next time.
 */

/** Follow-ups taken in one run: each is a turn of up to ten model rounds, within the dispatcher's five minutes. */
const PER_RUN = 2;
/** How long a run holds one before another may take it. */
const CLAIM_MINUTES = 10;
/** The longest a follow-up's turn may take. */
const TURN_MS = 90_000;

const DUE_ROW = z.object({
  id: col.uuid,
  store_id: col.uuid.nullable(),
  account_id: col.uuid,
  conversation_id: col.uuid,
  task: col.text,
  due_at: col.timestamp,
  repeat: z.enum(FOLLOW_UP_REPEATS),
  time_zone: col.text,
  tries: col.int,
  created_at: col.timestamp,
});
type Due = z.output<typeof DUE_ROW>;

export type FollowUpDeps = {
  now?: () => Date;
  /** The turn; `runTurn()` unless given (tests). */
  turn?: (input: TurnInput) => Promise<void>;
  /** The AI connection the turn uses; the site's own unless given (tests). */
  connection?: AiConnection | null;
  send?: (message: OutgoingEmail) => Promise<SendOutcome>;
};

export type FollowUpRun = { answered: number; retried: number; failed: number; cancelled: number; waiting: number };

export async function runFollowUps(deps: FollowUpDeps = {}): Promise<FollowUpRun> {
  const now = deps.now ?? (() => new Date());
  const result: FollowUpRun = { answered: 0, retried: 0, failed: 0, cancelled: 0, waiting: 0 };
  const due = await typedRows(
    DUE_ROW,
    sql`
      update commerce.assistant_follow_ups f set claimed_until = now() + make_interval(mins => ${CLAIM_MINUTES})
      where f.id in (
        select id from commerce.assistant_follow_ups
        where status = 'waiting' and due_at <= now() and (claimed_until is null or claimed_until < now())
        order by due_at limit ${PER_RUN} for update skip locked
      )
      returning f.id, f.store_id, f.account_id, f.conversation_id, f.task, f.due_at, f.repeat, f.time_zone, f.tries, f.created_at
    `,
  );
  for (const item of due) {
    try {
      result[await runOne(item, deps, now)]++;
    } catch (error) {
      log("error", "follow_up.failed", { followUp: item.id }, error);
      await db().execute(sql`update commerce.assistant_follow_ups set claimed_until = null where id = ${item.id}::uuid`);
      result.retried++;
    }
  }
  return result;
}

/** Who a follow-up runs for today, or why it no longer runs: the same checks the person's own request would meet. */
async function principalFor(item: Due): Promise<{ principal: Principal; slug: string | null } | "gone" | "closed"> {
  const account = await activeAccount(item.account_id);
  if (!account) return "gone";
  if (!item.store_id) return account.platformAdmin ? { principal: { account, store: null }, slug: null } : "gone";
  const store = await typedRow(
    z.object({ slug: col.text, active: col.bool }),
    sql`select slug, commerce.store_is_active(id) as active from commerce.stores where id = ${item.store_id}::uuid`,
  );
  if (!store) return "gone";
  if (!store.active) return "closed";
  const member = await passMembership(store.slug, account.id);
  if (!member) return "gone";
  return {
    principal: { account: member.account, store: member.store, role: member.role, kind: member.kind, permissions: member.permissions },
    slug: store.slug,
  };
}

async function runOne(item: Due, deps: FollowUpDeps, now: () => Date): Promise<keyof FollowUpRun> {
  const found = await principalFor(item);
  if (found === "gone") {
    await settle(item.id, sql`status = 'cancelled', last_problem = 'The person can no longer use the AI manager here.'`);
    return "cancelled";
  }
  if (found === "closed") {
    await settle(item.id, sql`due_at = now() + interval '1 day'`);
    return "waiting";
  }
  const { principal, slug } = found;
  const seen: { error: string | null; kept: number } = { error: null, kept: 0 };
  await (deps.turn ?? runTurn)({
    member: principal,
    conversationId: item.conversation_id,
    message: followUpMessage(item.task, new Date(item.created_at), item.repeat, item.time_zone),
    emit: (event) => {
      if (event.type === "error") seen.error = event.message;
      if (event.type === "approval") seen.kept++;
    },
    invalidate: refreshTag,
    signal: AbortSignal.timeout(TURN_MS),
    scheduled: true,
    ...(deps.connection !== undefined && { connection: deps.connection }),
  });
  const next = nextDue(new Date(item.due_at), item.repeat, item.time_zone, now());
  const email = async (outcome: "done" | "failed") => {
    // The same news in the admin (D350): the conversation where the answer is, once per run.
    await addNotice({
      accountId: principal.account.id,
      storeId: item.store_id,
      notice: "follow_up",
      ref: `${item.id}:${new Date(item.due_at).toISOString()}`,
      path: `assistant?c=${item.conversation_id}`,
      facts: { task: item.task, outcome },
    });
    await tell(principal.account, item, { outcome, slug, storeName: principal.store?.name ?? null, waiting: seen.kept > 0, next }, deps.send ?? sendEmail);
  };
  if (seen.error === null) {
    await settle(
      item.id,
      next
        ? sql`due_at = ${next.toISOString()}::timestamptz, tries = 0, runs = runs + 1, last_run_at = now(), last_problem = null`
        : sql`status = 'done', tries = 0, runs = runs + 1, last_run_at = now(), last_problem = null`,
    );
    await email("done");
    return "answered";
  }
  const problem = seen.error.slice(0, 500);
  if (item.tries + 1 < FOLLOW_UP_TRIES) {
    await settle(item.id, sql`tries = tries + 1, last_problem = ${problem}, due_at = now() + make_interval(mins => ${RETRY_MINUTES})`);
    return "retried";
  }
  await settle(
    item.id,
    next
      ? sql`due_at = ${next.toISOString()}::timestamptz, tries = 0, last_run_at = now(), last_problem = ${problem}`
      : sql`status = 'failed', tries = tries + 1, last_run_at = now(), last_problem = ${problem}`,
  );
  await email("failed");
  return "failed";
}

async function settle(id: string, changes: ReturnType<typeof sql>): Promise<void> {
  await db().execute(sql`update commerce.assistant_follow_ups set ${changes}, claimed_until = null where id = ${id}::uuid and status = 'waiting'`);
}

/** The email to the person, in their admin language; never throws (a follow-up that ran stays answered). */
async function tell(
  account: Account,
  item: Due,
  facts: { outcome: "done" | "failed"; slug: string | null; storeName: string | null; waiting: boolean; next: Date | null },
  send: (message: OutgoingEmail) => Promise<SendOutcome>,
): Promise<void> {
  if (!account.email) return;
  try {
    const lang: AdminLang = adminLangOf(account.adminLocale ?? null);
    const next = facts.next
      ? new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "full", timeStyle: "short", timeZone: item.time_zone }).format(facts.next)
      : null;
    const url = `${siteUrl()}/admin/${facts.slug ?? "platform"}/assistant?c=${item.conversation_id}`;
    await send({
      storeId: item.store_id,
      kind: "assistant.follow_up",
      to: account.email,
      email: renderEmail(
        followUpEmail(
          { task: item.task, store: facts.storeName, url, outcome: facts.outcome, waiting: facts.waiting, next },
          adminText(lang, "staffEmails"),
          lang,
        ),
      ),
      fromName: "Kaizena Flow",
      idempotencyKey: `assistant.follow_up:${item.id}:${item.due_at}:${facts.outcome}`,
    });
  } catch (error) {
    log("error", "follow_up.email_failed", { followUp: item.id }, error);
  }
}
