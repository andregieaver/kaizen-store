import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { PAGE_ISSUE_RULES } from "@/lib/page-a11y";
import { parsePageContent, samePageContent } from "@/lib/page-content";
import { isScheduledType, scheduleChip, type ScheduleChip, type ScheduleChipWords, type ScheduleFacts, type ScheduleFailure, type ScheduledType } from "@/lib/page-schedules";
import { pageTypeKey } from "@/lib/permissions";

import { audit, passMembership, type Account } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { log } from "./log";
import { getPageForEdit, savePage, unpublishPage } from "./pages";
import { memberCan } from "./permissions";
import { runThemeSchedules } from "./theme-schedules";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's pages, articles, headers and footers published at a set time, and put back at another (wave 7 unit G, D341, for pages and
 * articles; unit F, D340, `docs/wave-7-storefront.md` F, for headers, footers and the way back): the only writer of
 * `commerce.page_schedules`. A person schedules a draft (`schedulePage()`, which refuses a page in a running A/B test, as Publish does), with
 * an optional time to put the version before back; `runSchedules()` in the five-minute dispatcher publishes the drafts that are due through
 * `savePage()`, the builder's own Publish, in the name of whoever scheduled, read again then (`passMembership()`), and never for a store
 * that is not open (`commerce.store_is_active()`: such a schedule waits). The way back puts the published content from before back only
 * while the page is still live as the publish left it, so a person's later publish is never undone by a clock. Themes going live are
 * `theme-schedules.ts`, run from here.
 */

export type PageSchedule = { id: string; at: string; by: string | null; revertAt: string | null };
export type ScheduleState = {
  /** The publish that waits, with its way back if it has one. */
  waiting: PageSchedule | null;
  /** A way back that waits after its publish ran. */
  reverting: { id: string; at: string } | null;
  /** The latest leg that failed, while nothing waits after it. */
  lastFailure: { leg: "publish" | "revert"; at: string; problem: string } | null;
};

const ROW = z.object({
  id: col.uuid,
  page_id: col.uuid,
  publish_at: col.timestamp,
  scheduled_by: col.uuid.nullable(),
  status: col.text,
  problem: col.textOrNull,
  done_at: col.timestampOrNull,
  revert_at: col.timestampOrNull,
  revert_status: col.textOrNull,
  revert_problem: col.textOrNull,
  reverted_at: col.timestampOrNull,
});
type Row = z.output<typeof ROW>;

/** A page's newest schedule as the editor and the lists read it: what waits, else the failure it ended in. */
function stateOf(newest: Row | undefined): ScheduleState {
  const state: ScheduleState = { waiting: null, reverting: null, lastFailure: null };
  if (!newest) return state;
  if (newest.status === "waiting") {
    state.waiting = { id: newest.id, at: newest.publish_at, by: newest.scheduled_by, revertAt: newest.revert_status === "waiting" ? newest.revert_at : null };
  } else if (newest.revert_status === "waiting" && newest.revert_at) {
    state.reverting = { id: newest.id, at: newest.revert_at };
  } else if (newest.status === "failed") {
    state.lastFailure = { leg: "publish", at: newest.done_at ?? newest.publish_at, problem: newest.problem ?? "" };
  } else if (newest.revert_status === "failed") {
    state.lastFailure = { leg: "revert", at: newest.reverted_at ?? newest.revert_at ?? newest.publish_at, problem: newest.revert_problem ?? "" };
  }
  return state;
}

/** The facts a list's chip is drawn from (`scheduleChip()`). */
export const factsOf = (state: ScheduleState): ScheduleFacts => ({
  publishAt: state.waiting?.at ?? null,
  revertAt: state.waiting?.revertAt ?? state.reverting?.at ?? null,
  failure: state.lastFailure,
});

/** A page's waiting schedule, its way back, and the last one that failed since it was last published or scheduled. */
export async function scheduleOf(storeId: string, pageId: string): Promise<ScheduleState> {
  const [newest] = await typedRows(
    ROW,
    sql`
      select id, page_id, publish_at, scheduled_by, status, problem, done_at, revert_at, revert_status, revert_problem, reverted_at
      from commerce.page_schedules
      where store_id = ${storeId}::uuid and page_id = ${pageId}::uuid
      order by created_at desc, id desc limit 1
    `,
  );
  return stateOf(newest);
}

/** Every page of one kind with a schedule that waits or failed last (D340): for the lists' chips, by page id. */
export async function scheduleStates(storeId: string, type: ScheduledType): Promise<Map<string, ScheduleState>> {
  const rows = await typedRows(
    ROW,
    sql`
      select distinct on (ps.page_id)
        ps.id, ps.page_id, ps.publish_at, ps.scheduled_by, ps.status, ps.problem, ps.done_at,
        ps.revert_at, ps.revert_status, ps.revert_problem, ps.reverted_at
      from commerce.page_schedules ps
      join commerce.pages p on p.id = ps.page_id and p.store_id = ps.store_id
      where ps.store_id = ${storeId}::uuid and p.type = ${type}
      order by ps.page_id, ps.created_at desc, ps.id desc
    `,
  );
  const out = new Map<string, ScheduleState>();
  for (const row of rows) {
    const state = stateOf(row);
    if (state.waiting || state.reverting || state.lastFailure) out.set(row.page_id, state);
  }
  return out;
}

export type ScheduleResult = { ok: true; id: string; at: string } | { ok: false; problem: "missing" | "ab_test" | "type" };

/**
 * Schedules a page's, article's, header's or footer's draft to be published at `at` (worked out by `scheduleInstant()` from the store's
 * clock), and with `revertAt` (`revertInstant()`) the version it replaces put back then, in place of any schedule or way back it had.
 * `acknowledged`: the checker's blocking issues the person chose to publish with, as the builder's *Publish anyway*.
 */
export async function schedulePage(
  account: Account,
  storeId: string,
  pageId: string,
  type: ScheduledType,
  at: Date,
  acknowledged: readonly string[] = [],
  revertAt: Date | null = null,
): Promise<ScheduleResult> {
  if (!isScheduledType(type)) return { ok: false, problem: "type" };
  if (revertAt && revertAt.getTime() <= at.getTime()) return { ok: false, problem: "type" };
  const page = await getPageForEdit(storeId, pageId, type);
  if (!page) return { ok: false, problem: "missing" };
  if (await runningTestOf(storeId, pageId)) return { ok: false, problem: "ab_test" };
  const id = await db().transaction(async (tx) => {
    await cancelWaiting(tx, storeId, pageId);
    const row = await typedRow(z.object({ id: col.uuid }), sql`
      insert into commerce.page_schedules (store_id, page_id, publish_at, scheduled_by, acknowledged, revert_at, revert_status)
      values (${storeId}::uuid, ${pageId}::uuid, ${at.toISOString()}::timestamptz, ${account.id}::uuid,
        array[${sql.join([...acknowledged].slice(0, 200).map((a) => sql`${a}`), sql`, `)}]::text[],
        ${revertAt?.toISOString() ?? null}::timestamptz, ${revertAt ? "waiting" : null})
      returning id
    `, tx);
    return row!.id;
  });
  await audit(account.id, storeId, `store.${type}_scheduled`, { page: pageId, at: at.toISOString(), back: revertAt?.toISOString() ?? null }, { target: { type, id: pageId } });
  return { ok: true, id, at: at.toISOString() };
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** Cancels whatever waits for a page: a publish (with its way back) and a way back after an earlier publish. Returns how many. */
async function cancelWaiting(tx: Pick<Tx, "execute">, storeId: string, pageId: string): Promise<number> {
  const rows = await tx.execute(sql`
    update commerce.page_schedules set
      status = case when status = 'waiting' then 'cancelled' else status end,
      done_at = case when status = 'waiting' then now() else done_at end,
      revert_status = case when revert_status = 'waiting' then 'cancelled' else revert_status end,
      reverted_at = case when revert_status = 'waiting' then now() else reverted_at end
    where store_id = ${storeId}::uuid and page_id = ${pageId}::uuid and (status = 'waiting' or revert_status = 'waiting')
    returning id
  `);
  return rows.length;
}

/** Takes a page's waiting schedule and way back away; its draft stays a draft, and what is live stays live. */
export async function cancelSchedule(account: Account, storeId: string, pageId: string, type: ScheduledType): Promise<boolean> {
  const cancelled = await cancelWaiting(db(), storeId, pageId);
  if (cancelled === 0) return false;
  await audit(account.id, storeId, `store.${type}_schedule_cancelled`, { page: pageId }, { target: { type, id: pageId } });
  return true;
}

/** How many schedules of each kind one run handles at most; the rest wait for the next. */
export const SCHEDULES_PER_RUN = 25;

const FAILURE_WORDS: Record<ScheduleFailure, string> = {
  gone: "The page is gone.",
  not_allowed: "The person who scheduled it may no longer publish it.",
  store_closed: "The store is not open.",
  ab_test: "The page is in a running A/B test: stop the test, then publish it.",
  refused: "Publishing was refused.",
  expired: "The time to put the version before back had passed before it could be published, so it was not published.",
  changed: "The page was published or taken off the site by someone since, so it was left as it is.",
  costs: "The theme costs money the store has not agreed to pay.",
};

export type ScheduleRun = { published: number; reverted: number; failed: number; stores: string[]; themeStores: { id: string; slug: string }[] };

const DUE = z.object({
  id: col.uuid,
  store_id: col.uuid,
  slug: col.text,
  page_id: col.uuid,
  type: col.text,
  scheduled_by: col.uuid.nullable(),
  acknowledged: z.array(z.string()),
  revert_due: col.bool,
  published_now: z.unknown(),
});

/**
 * Publishes the drafts whose time has come and puts back the versions whose way back is due (the five-minute dispatcher, `runJobs()`),
 * oldest first, each in its own claim (`for update skip locked`, so two runs never run one twice); then the themes' plans
 * (`runThemeSchedules()`). A schedule of a store that is not open waits; one whose maker may no longer publish the page, or whose page is in
 * a running A/B test or refused by Publish's checks, fails with the reason, written down and audited. Returns the stores whose pages and
 * whose looks changed, for their tags.
 */
export async function runSchedules(now: Date = new Date()): Promise<ScheduleRun> {
  const run: ScheduleRun = { published: 0, reverted: 0, failed: 0, stores: [], themeStores: [] };
  const changed = (store: string) => {
    if (!run.stores.includes(store)) run.stores.push(store);
  };
  for (let i = 0; i < SCHEDULES_PER_RUN; i++) {
    const outcome = await publishOne(now);
    if (outcome === null) break;
    run[outcome.kind]++;
    if (outcome.kind === "published") changed(outcome.store);
  }
  for (let i = 0; i < SCHEDULES_PER_RUN; i++) {
    const outcome = await revertOne(now);
    if (outcome === null) break;
    run[outcome.kind]++;
    if (outcome.kind === "reverted") changed(outcome.store);
  }
  const themes = await runThemeSchedules(now);
  run.published += themes.switched;
  run.reverted += themes.reverted;
  run.failed += themes.failed;
  run.themeStores = themes.stores;
  return run;
}

type Outcome = { kind: "published" | "reverted" | "failed"; store: string } | null;

/** One due publish, claimed and settled in its own transaction. */
async function publishOne(now: Date): Promise<Outcome> {
  return db().transaction(async (tx) => {
    const due = await typedRow(
      DUE,
      sql`
        select ps.id, ps.store_id, s.slug, ps.page_id, p.type, ps.scheduled_by, ps.acknowledged,
          coalesce(ps.revert_at <= ${now.toISOString()}::timestamptz, false) as revert_due, p.published as published_now
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
    // A publish that did not happen leaves no way back waiting (`page_schedules_rules()`).
    const fail = async (failure: ScheduleFailure, detail = "") => {
      const words = `${FAILURE_WORDS[failure]}${detail ? ` ${detail}` : ""}`.slice(0, 500);
      await tx.execute(sql`
        update commerce.page_schedules set status = 'failed', problem = ${words}, done_at = now(),
          revert_status = case when revert_status = 'waiting' then 'cancelled' else revert_status end
        where id = ${due.id}::uuid
      `);
      await audit(due.scheduled_by, due.store_id, `store.${isScheduledType(due.type) ? due.type : "page"}_schedule_failed`, { page: due.page_id, reason: failure }, {
        target: { type: due.type, id: due.page_id },
      });
      log("warn", "page_schedule.failed", { store: due.store_id, page: due.page_id, reason: failure });
      return { kind: "failed" as const, store: due.store_id };
    };
    if (!isScheduledType(due.type)) return fail("gone");
    const type = due.type;
    // Never live for a moment after the time it should have been taken back (a store that was not open meanwhile).
    if (due.revert_due) return fail("expired");
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
    // What the way back needs: what was live before, and a fingerprint of what is live now.
    await tx.execute(sql`
      update commerce.page_schedules set status = 'done', problem = null, done_at = now(),
        before_content = ${due.published_now === null || due.published_now === undefined ? null : JSON.stringify(due.published_now)}::jsonb,
        published_hash = (select md5(p.published::text) from commerce.pages p where p.id = ${due.page_id}::uuid)
      where id = ${due.id}::uuid
    `);
    log("info", "page_schedule.published", { store: due.store_id, page: due.page_id });
    return { kind: "published" as const, store: due.store_id };
  });
}

const REVERT_DUE = z.object({
  id: col.uuid,
  store_id: col.uuid,
  slug: col.text,
  page_id: col.uuid,
  type: col.text,
  scheduled_by: col.uuid.nullable(),
  before_content: z.unknown(),
  same: col.bool,
});

/** One due way back, claimed and settled in its own transaction. */
async function revertOne(now: Date): Promise<Outcome> {
  return db().transaction(async (tx) => {
    const due = await typedRow(
      REVERT_DUE,
      sql`
        select ps.id, ps.store_id, s.slug, ps.page_id, p.type, ps.scheduled_by, ps.before_content,
          coalesce(md5(p.published::text) = ps.published_hash, false) as same
        from commerce.page_schedules ps
        join commerce.stores s on s.id = ps.store_id
        join commerce.pages p on p.id = ps.page_id and p.store_id = ps.store_id
        where ps.status = 'done' and ps.revert_status = 'waiting' and ps.revert_at <= ${now.toISOString()}::timestamptz
          and commerce.store_is_active(ps.store_id)
        order by ps.revert_at, ps.id
        limit 1
        for update of ps skip locked
      `,
      tx,
    );
    if (!due) return null;
    const settle = (status: "done" | "failed", problem: string | null) =>
      tx.execute(sql`update commerce.page_schedules set revert_status = ${status}, revert_problem = ${problem}, reverted_at = now() where id = ${due.id}::uuid`);
    const fail = async (failure: ScheduleFailure, detail = "") => {
      await settle("failed", `${FAILURE_WORDS[failure]}${detail ? ` ${detail}` : ""}`.slice(0, 500));
      await audit(due.scheduled_by, due.store_id, `store.${isScheduledType(due.type) ? due.type : "page"}_revert_failed`, { page: due.page_id, reason: failure }, {
        target: { type: due.type, id: due.page_id },
      });
      log("warn", "page_schedule.revert_failed", { store: due.store_id, page: due.page_id, reason: failure });
      return { kind: "failed" as const, store: due.store_id };
    };
    if (!isScheduledType(due.type)) return fail("gone");
    const type = due.type;
    const member = due.scheduled_by ? await passMembership(due.slug, due.scheduled_by) : null;
    const key = pageTypeKey(type, "write");
    if (!member || !key || !memberCan(member, key)) return fail("not_allowed");
    if (await runningTestOf(due.store_id, due.page_id)) return fail("ab_test");
    // Only a page still live as the publish left it: a person's later publish, or taking it off the site, is theirs to keep.
    if (!due.same) return fail("changed");
    const page = await getPageForEdit(due.store_id, due.page_id, type);
    if (!page) return fail("gone");
    try {
      if (due.before_content === null || due.before_content === undefined) {
        await unpublishPage(member.account, due.store_id, due.page_id, type);
      } else {
        const before = parsePageContent(due.before_content);
        if (!before) return fail("refused");
        // The version before was live, so the checker's questions were answered when it went live; going back does not ask them again.
        const back = await savePage(member.account, due.store_id, due.page_id, before, { publish: true, type, acknowledgedIssues: PAGE_ISSUE_RULES });
        if (!back.ok) return fail("refused", back.problems.join(" "));
        // The person's draft stays theirs: saved back as the draft when it is not the version put back.
        if (!samePageContent(page.draft, before)) {
          const kept = await savePage(member.account, due.store_id, due.page_id, page.draft, { publish: false, type });
          if (!kept.ok) log("warn", "page_schedule.draft_not_kept", { store: due.store_id, page: due.page_id });
        }
      }
    } catch (error) {
      log("error", "page_schedule.revert_threw", { store: due.store_id, page: due.page_id }, error);
      return fail("refused");
    }
    await settle("done", null);
    await audit(member.account.id, due.store_id, `store.${type}_reverted`, { page: due.page_id, schedule: due.id }, { target: { type, id: due.page_id } });
    log("info", "page_schedule.reverted", { store: due.store_id, page: due.page_id });
    return { kind: "reverted" as const, store: due.store_id };
  });
}

/** The chips the pages, articles, headers or footers list shows (D340), by page id: what waits next, else the latest failure. */
export async function scheduleChips(
  storeId: string,
  type: ScheduledType,
  words: ScheduleChipWords,
  when: (iso: string) => string,
): Promise<Record<string, ScheduleChip>> {
  const out: Record<string, ScheduleChip> = {};
  for (const [page, state] of await scheduleStates(storeId, type)) {
    const chip = scheduleChip(factsOf(state), words, when);
    if (chip) out[page] = chip;
  }
  return out;
}
