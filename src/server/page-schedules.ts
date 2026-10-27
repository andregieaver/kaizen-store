import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isScheduledType, type ScheduleFailure, type ScheduledType } from "@/lib/page-schedules";
import { pageTypeKey } from "@/lib/permissions";

import { audit, passMembership, type Account } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { log } from "./log";
import { getPageForEdit, savePage } from "./pages";
import { memberCan } from "./permissions";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's pages and articles published at a set time (wave 7 unit G, D341; the start of D340's model, `docs/wave-7-storefront.md` F):
 * the only writer of `commerce.page_schedules`. A person schedules a page's draft (`schedulePage()`, which refuses a page in a running A/B
 * test, as Publish does); `runSchedules()` in the five-minute dispatcher publishes the drafts that are due through `savePage()`, the
 * builder's own Publish, in the name of whoever scheduled, read again then (`passMembership()`), and never for a store that is not open
 * (`commerce.store_is_active()`: such a schedule waits). Before it runs, the page is not published, so it is in no listing, sitemap or feed.
 * F adds a way back (the version before, put back at another time), headers, footers and themes.
 */

export type PageSchedule = { id: string; at: string; by: string | null };
export type ScheduleState = { waiting: PageSchedule | null; lastFailure: { at: string; problem: string } | null };

/** A page's waiting schedule, and the last one that failed since it was last published or scheduled. */
export async function scheduleOf(storeId: string, pageId: string): Promise<ScheduleState> {
  const rows = await typedRows(
    z.object({ id: col.uuid, publish_at: col.timestamp, scheduled_by: col.uuid.nullable(), status: col.text, problem: col.textOrNull, done_at: col.timestampOrNull }),
    sql`
      select id, publish_at, scheduled_by, status, problem, done_at from commerce.page_schedules
      where store_id = ${storeId}::uuid and page_id = ${pageId}::uuid and status in ('waiting', 'failed')
      order by created_at desc limit 2
    `,
  );
  const waiting = rows.find((r) => r.status === "waiting");
  const failed = rows[0]?.status === "failed" ? rows[0] : null;
  return {
    waiting: waiting ? { id: waiting.id, at: waiting.publish_at, by: waiting.scheduled_by } : null,
    lastFailure: failed && !waiting ? { at: failed.done_at ?? failed.publish_at, problem: failed.problem ?? "" } : null,
  };
}

export type ScheduleResult = { ok: true; id: string; at: string } | { ok: false; problem: "missing" | "ab_test" | "type" };

/**
 * Schedules a page's or article's draft to be published at `at` (worked out by `scheduleInstant()` from the store's clock), in place of any
 * schedule it had. `acknowledged`: the checker's blocking issues the person chose to publish with, as the builder's *Publish anyway*.
 */
export async function schedulePage(
  account: Account,
  storeId: string,
  pageId: string,
  type: ScheduledType,
  at: Date,
  acknowledged: readonly string[] = [],
): Promise<ScheduleResult> {
  if (!isScheduledType(type)) return { ok: false, problem: "type" };
  const page = await getPageForEdit(storeId, pageId, type);
  if (!page) return { ok: false, problem: "missing" };
  if (await runningTestOf(storeId, pageId)) return { ok: false, problem: "ab_test" };
  const id = await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.page_schedules set status = 'cancelled', done_at = now()
      where store_id = ${storeId}::uuid and page_id = ${pageId}::uuid and status = 'waiting'
    `);
    const row = await typedRow(z.object({ id: col.uuid }), sql`
      insert into commerce.page_schedules (store_id, page_id, publish_at, scheduled_by, acknowledged)
      values (${storeId}::uuid, ${pageId}::uuid, ${at.toISOString()}::timestamptz, ${account.id}::uuid,
        array[${sql.join([...acknowledged].slice(0, 200).map((a) => sql`${a}`), sql`, `)}]::text[])
      returning id
    `, tx);
    return row!.id;
  });
  await audit(account.id, storeId, `store.${type}_scheduled`, { page: pageId, at: at.toISOString() }, { target: { type, id: pageId } });
  return { ok: true, id, at: at.toISOString() };
}

/** Takes a page's waiting schedule away; its draft stays a draft. */
export async function cancelSchedule(account: Account, storeId: string, pageId: string, type: ScheduledType): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.page_schedules set status = 'cancelled', done_at = now()
    where store_id = ${storeId}::uuid and page_id = ${pageId}::uuid and status = 'waiting'
    returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, storeId, `store.${type}_schedule_cancelled`, { page: pageId }, { target: { type, id: pageId } });
  return true;
}

/** How many schedules one run publishes at most; the rest wait for the next. */
export const SCHEDULES_PER_RUN = 25;

const FAILURE_WORDS: Record<ScheduleFailure, string> = {
  gone: "The page is gone.",
  not_allowed: "The person who scheduled it may no longer publish it.",
  store_closed: "The store is not open.",
  ab_test: "The page is in a running A/B test: stop the test, then publish it.",
  refused: "Publishing was refused.",
};

export type ScheduleRun = { published: number; failed: number; stores: string[] };

/**
 * Publishes the drafts whose time has come (the five-minute dispatcher, `runJobs()`), oldest first, each in its own claim (`for update skip
 * locked`, so two runs never publish one twice). A schedule of a store that is not open waits; one whose maker may no longer publish the
 * page, or whose page is in a running A/B test or refused by Publish's checks, fails with the reason, written down and audited. Returns the
 * stores whose pages changed, for their pages' tags.
 */
export async function runSchedules(now: Date = new Date()): Promise<ScheduleRun> {
  const run: ScheduleRun = { published: 0, failed: 0, stores: [] };
  for (let i = 0; i < SCHEDULES_PER_RUN; i++) {
    const outcome = await db().transaction(async (tx) => {
      const due = await typedRow(
        z.object({
          id: col.uuid,
          store_id: col.uuid,
          slug: col.text,
          page_id: col.uuid,
          type: col.text,
          scheduled_by: col.uuid.nullable(),
          acknowledged: z.array(z.string()),
        }),
        sql`
          select ps.id, ps.store_id, s.slug, ps.page_id, p.type, ps.scheduled_by, ps.acknowledged
          from commerce.page_schedules ps
          join commerce.stores s on s.id = ps.store_id
          join commerce.pages p on p.id = ps.page_id and p.store_id = ps.store_id
          where ps.status = 'waiting' and ps.publish_at <= ${now.toISOString()}::timestamptz and commerce.store_is_active(ps.store_id)
          order by ps.publish_at, ps.id
          limit 1
          for update of ps skip locked
        `,
        tx,
      );
      if (!due) return null;
      const settle = async (status: "done" | "failed", problem: string | null) => {
        await tx.execute(sql`update commerce.page_schedules set status = ${status}, problem = ${problem}, done_at = now() where id = ${due.id}::uuid`);
      };
      const fail = async (failure: ScheduleFailure, detail = "") => {
        const words = `${FAILURE_WORDS[failure]}${detail ? ` ${detail}` : ""}`.slice(0, 500);
        await settle("failed", words);
        await audit(due.scheduled_by, due.store_id, `store.${isScheduledType(due.type) ? due.type : "page"}_schedule_failed`, { page: due.page_id, reason: failure }, {
          target: { type: due.type, id: due.page_id },
        });
        log("warn", "page_schedule.failed", { store: due.store_id, page: due.page_id, reason: failure });
        return { kind: "failed" as const, store: due.store_id };
      };
      if (!isScheduledType(due.type)) return fail("gone");
      const type = due.type;
      const member = due.scheduled_by ? await passMembership(due.slug, due.scheduled_by) : null;
      const key = pageTypeKey(type, "write");
      if (!member || !key || !memberCan(member, key)) return fail("not_allowed");
      if (await runningTestOf(due.store_id, due.page_id)) return fail("ab_test");
      const page = await getPageForEdit(due.store_id, due.page_id, type);
      if (!page) return fail("gone");
      let saved: Awaited<ReturnType<typeof savePage>>;
      try {
        saved = await savePage(member.account, due.store_id, due.page_id, page.draft, { publish: true, type, acknowledgedIssues: due.acknowledged });
      } catch (error) {
        // A save that throws fails this schedule, so the next run does not take it again and again.
        log("error", "page_schedule.save_threw", { store: due.store_id, page: due.page_id }, error);
        return fail("refused");
      }
      if (!saved.ok) return fail("refused", saved.problems.join(" "));
      await settle("done", null);
      log("info", "page_schedule.published", { store: due.store_id, page: due.page_id });
      return { kind: "published" as const, store: due.store_id };
    });
    if (outcome === null) break;
    run[outcome.kind]++;
    if (outcome.kind === "published" && !run.stores.includes(outcome.store)) run.stores.push(outcome.store);
  }
  return run;
}
