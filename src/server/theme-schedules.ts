import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { ScheduleFacts, ScheduleFailure } from "@/lib/page-schedules";

import { audit, passMembership, type Account } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { log } from "./log";
import { memberCan } from "./permissions";
import { switchToInstall } from "./theme-installs";
import { themeCharge } from "./theme-prices";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's installed theme made live at a set time, and the theme that was live put back at another (wave 7 unit F, D340,
 * `docs/wave-7-storefront.md` F): the only writer of `commerce.theme_schedules`. The switch is `switchToInstall()`, the Design page's own,
 * in the name of whoever planned it, read again when it runs (`passMembership()`, `website:write`); a store that is not open waits. A plan
 * never spends money: a premium theme the store does not own is refused when planned, and a charge the database refuses when it runs fails
 * the plan. The way back only while the planned theme is still the live one, so a person's later switch is never undone by a clock.
 */

export type ThemeScheduleState = {
  waiting: { id: string; installId: string | null; at: string; revertAt: string | null } | null;
  reverting: { id: string; installId: string | null; beforeInstallId: string | null; at: string } | null;
  lastFailure: { leg: "publish" | "revert"; installId: string | null; at: string; problem: string } | null;
};

const ROW = z.object({
  id: col.uuid,
  install_id: col.uuid.nullable(),
  before_install_id: col.uuid.nullable(),
  live_at: col.timestamp,
  status: col.text,
  problem: col.textOrNull,
  done_at: col.timestampOrNull,
  revert_at: col.timestampOrNull,
  revert_status: col.textOrNull,
  revert_problem: col.textOrNull,
  reverted_at: col.timestampOrNull,
});

/** The store's newest plan, as the Design page and the theme's page read it. */
export async function themeScheduleOf(storeId: string): Promise<ThemeScheduleState> {
  const [newest] = await typedRows(
    ROW,
    sql`
      select id, install_id, before_install_id, live_at, status, problem, done_at, revert_at, revert_status, revert_problem, reverted_at
      from commerce.theme_schedules where store_id = ${storeId}::uuid
      order by created_at desc, id desc limit 1
    `,
  );
  const state: ThemeScheduleState = { waiting: null, reverting: null, lastFailure: null };
  if (!newest) return state;
  if (newest.status === "waiting") {
    state.waiting = { id: newest.id, installId: newest.install_id, at: newest.live_at, revertAt: newest.revert_status === "waiting" ? newest.revert_at : null };
  } else if (newest.revert_status === "waiting" && newest.revert_at) {
    state.reverting = { id: newest.id, installId: newest.install_id, beforeInstallId: newest.before_install_id, at: newest.revert_at };
  } else if (newest.status === "failed") {
    state.lastFailure = { leg: "publish", installId: newest.install_id, at: newest.done_at ?? newest.live_at, problem: newest.problem ?? "" };
  } else if (newest.revert_status === "failed") {
    state.lastFailure = { leg: "revert", installId: newest.install_id, at: newest.reverted_at ?? newest.revert_at ?? newest.live_at, problem: newest.revert_problem ?? "" };
  }
  return state;
}

/** The facts a theme's chip is drawn from: what waits or failed for that install (the planned one, or the one the way back makes live). */
export function themeFactsFor(state: ThemeScheduleState, installId: string): ScheduleFacts | null {
  if (state.waiting?.installId === installId) return { publishAt: state.waiting.at, revertAt: state.waiting.revertAt, failure: null };
  if (state.reverting && (state.reverting.installId === installId || state.reverting.beforeInstallId === installId)) {
    return { publishAt: null, revertAt: state.reverting.at, failure: null };
  }
  if (state.lastFailure?.installId === installId) return { publishAt: null, revertAt: null, failure: state.lastFailure };
  return null;
}

export type ThemeScheduleProblem = "missing" | "live" | "costs" | "ab_test" | "closed";
export type ThemeScheduleResult = { ok: true; id: string } | { ok: false; problem: ThemeScheduleProblem };

/** Why a theme cannot be planned now (the plan would fail when it runs): none when it can. */
export async function themeScheduleProblem(storeId: string, installId: string): Promise<ThemeScheduleProblem | null> {
  const install = await typedRow(
    z.object({ live: col.bool, preset_id: col.uuid.nullable(), header_id: col.uuid.nullable(), footer_id: col.uuid.nullable(), status: col.text }),
    sql`
      select i.live, i.preset_id, s.header_id, s.footer_id, s.status from commerce.store_theme_installs i
      join commerce.stores s on s.id = i.store_id
      where i.id = ${installId}::uuid and i.store_id = ${storeId}::uuid
    `,
  );
  if (!install) return "missing";
  if (install.status !== "active") return "closed";
  if (install.live) return "live";
  // A plan never spends money: a premium theme the store does not have yet is made live by a person, who agrees to its price.
  if (install.preset_id) {
    const charge = await themeCharge(storeId, install.preset_id);
    if (charge.kind === "now" || charge.kind === "at_opening") return "costs";
  }
  // Switching takes the store's header and footer with it, which a running test holds (`stores_experiment_guard`).
  for (const page of [install.header_id, install.footer_id]) if (page && (await runningTestOf(storeId, page))) return "ab_test";
  return null;
}

/**
 * Plans an installed theme to go live at `at` (`scheduleInstant()`), and with `revertAt` (`revertInstant()`) the theme live then put back,
 * in place of any plan the store had.
 */
export async function scheduleTheme(account: Account, storeId: string, installId: string, at: Date, revertAt: Date | null = null): Promise<ThemeScheduleResult> {
  if (!/^[0-9a-f-]{36}$/i.test(installId) || (revertAt && revertAt.getTime() <= at.getTime())) return { ok: false, problem: "missing" };
  const problem = await themeScheduleProblem(storeId, installId);
  if (problem) return { ok: false, problem };
  const id = await db().transaction(async (tx) => {
    await cancelThemeWaiting(tx, storeId);
    const row = await typedRow(z.object({ id: col.uuid }), sql`
      insert into commerce.theme_schedules (store_id, install_id, live_at, revert_at, revert_status, scheduled_by)
      values (${storeId}::uuid, ${installId}::uuid, ${at.toISOString()}::timestamptz, ${revertAt?.toISOString() ?? null}::timestamptz,
        ${revertAt ? "waiting" : null}, ${account.id}::uuid)
      returning id
    `, tx);
    return row!.id;
  });
  await audit(account.id, storeId, "store.theme_scheduled", { install: installId, at: at.toISOString(), back: revertAt?.toISOString() ?? null }, {
    area: "website",
    target: { type: "theme_install", id: installId },
  });
  return { ok: true, id };
}

type Exec = { execute: ReturnType<typeof db>["execute"] };

async function cancelThemeWaiting(tx: Exec, storeId: string): Promise<number> {
  const rows = await tx.execute(sql`
    update commerce.theme_schedules set
      status = case when status = 'waiting' then 'cancelled' else status end,
      done_at = case when status = 'waiting' then now() else done_at end,
      revert_status = case when revert_status = 'waiting' then 'cancelled' else revert_status end,
      reverted_at = case when revert_status = 'waiting' then now() else reverted_at end
    where store_id = ${storeId}::uuid and (status = 'waiting' or revert_status = 'waiting')
    returning id
  `);
  return rows.length;
}

/** Takes the store's waiting plan and way back away; the live theme stays live. */
export async function cancelThemeSchedule(account: Account, storeId: string): Promise<boolean> {
  const cancelled = await cancelThemeWaiting(db(), storeId);
  if (cancelled === 0) return false;
  await audit(account.id, storeId, "store.theme_schedule_cancelled", {}, { area: "website" });
  return true;
}

const FAILURE_WORDS: Record<ScheduleFailure, string> = {
  gone: "The theme is no longer installed.",
  not_allowed: "The person who planned it may no longer change the store's look.",
  store_closed: "The store is not open.",
  ab_test: "A running A/B test holds the store's header or footer: stop the test, then switch.",
  refused: "Switching was refused.",
  expired: "The time to put the theme before back had passed before it could go live, so it was not switched.",
  changed: "Someone switched the store to another theme since, so it was left as it is.",
  costs: "The theme costs money the store has not agreed to pay: make it live by hand to agree to its price.",
};

const PER_RUN = 10;

const DUE = z.object({
  id: col.uuid,
  store_id: col.uuid,
  slug: col.text,
  install_id: col.uuid.nullable(),
  before_install_id: col.uuid.nullable(),
  scheduled_by: col.uuid.nullable(),
  revert_due: col.bool,
  live_install: col.uuid.nullable(),
});

export type ThemeScheduleRun = { switched: number; reverted: number; failed: number; stores: { id: string; slug: string }[] };

/**
 * The plans whose time has come (from `runSchedules()`): first the switches, then the ways back, each claimed `for update skip locked`
 * and settled once. Returns the stores whose look changed, for `designTags()`.
 */
export async function runThemeSchedules(now: Date = new Date()): Promise<ThemeScheduleRun> {
  const run: ThemeScheduleRun = { switched: 0, reverted: 0, failed: 0, stores: [] };
  for (const leg of ["publish", "revert"] as const) {
    for (let i = 0; i < PER_RUN; i++) {
      const outcome = await runOne(leg, now);
      if (outcome === null) break;
      run[outcome.kind]++;
      if (outcome.kind !== "failed" && !run.stores.some((s) => s.id === outcome.store.id)) run.stores.push(outcome.store);
    }
  }
  return run;
}

async function runOne(leg: "publish" | "revert", now: Date): Promise<{ kind: "switched" | "reverted" | "failed"; store: { id: string; slug: string } } | null> {
  return db().transaction(async (tx) => {
    const when = sql`${now.toISOString()}::timestamptz`;
    const due = await typedRow(
      DUE,
      sql`
        select ts.id, ts.store_id, s.slug, ts.install_id, ts.before_install_id, ts.scheduled_by,
          coalesce(ts.revert_at <= ${when}, false) as revert_due,
          (select i.id from commerce.store_theme_installs i where i.store_id = ts.store_id and i.live) as live_install
        from commerce.theme_schedules ts
        join commerce.stores s on s.id = ts.store_id
        where ${leg === "publish" ? sql`ts.status = 'waiting' and ts.live_at <= ${when}` : sql`ts.status = 'done' and ts.revert_status = 'waiting' and ts.revert_at <= ${when}`}
          and commerce.store_is_active(ts.store_id)
        order by ${leg === "publish" ? sql`ts.live_at` : sql`ts.revert_at`}, ts.id
        limit 1
        for update of ts skip locked
      `,
      tx,
    );
    if (!due) return null;
    const fail = async (failure: ScheduleFailure, detail = "") => {
      const words = `${FAILURE_WORDS[failure]}${detail ? ` ${detail}` : ""}`.slice(0, 500);
      if (leg === "publish") {
        await tx.execute(sql`
          update commerce.theme_schedules set status = 'failed', problem = ${words}, done_at = now(),
            revert_status = case when revert_status = 'waiting' then 'cancelled' else revert_status end
          where id = ${due.id}::uuid
        `);
      } else {
        await tx.execute(sql`update commerce.theme_schedules set revert_status = 'failed', revert_problem = ${words}, reverted_at = now() where id = ${due.id}::uuid`);
      }
      await audit(due.scheduled_by, due.store_id, leg === "publish" ? "store.theme_schedule_failed" : "store.theme_revert_failed", { schedule: due.id, reason: failure }, {
        area: "website",
        target: { type: "theme_install", id: due.install_id ?? due.id },
      });
      log("warn", leg === "publish" ? "theme_schedule.failed" : "theme_schedule.revert_failed", { store: due.store_id, reason: failure });
      return { kind: "failed" as const, store: { id: due.store_id, slug: due.slug } };
    };
    if (leg === "publish" && due.revert_due) return fail("expired");
    const member = due.scheduled_by ? await passMembership(due.slug, due.scheduled_by) : null;
    if (!member || !memberCan(member, "website:write")) return fail("not_allowed");
    // The theme to make live: the planned one, or (going back) the one that was live, while the planned one still is.
    let target: string | null;
    if (leg === "publish") {
      target = due.install_id;
      if (!target) return fail("gone");
    } else {
      if (!due.install_id || due.live_install !== due.install_id) return fail("changed");
      target = due.before_install_id;
      if (!target) return fail("gone");
    }
    if (target === due.live_install) {
      // Already live: nothing to switch, and nothing to fail.
    } else {
      const switched = await switchToInstall(due.store_id, target, member.account.id, null);
      if (!switched.ok) {
        const text = switched.problems.join(" ");
        if (/price/i.test(text)) return fail("costs");
        if (/A\/B test/i.test(text)) return fail("ab_test");
        if (/not installed/i.test(text)) return fail("gone");
        return fail("refused", text);
      }
    }
    if (leg === "publish") {
      await tx.execute(sql`
        update commerce.theme_schedules set status = 'done', problem = null, done_at = now(), before_install_id = ${due.live_install}::uuid
        where id = ${due.id}::uuid
      `);
    } else {
      await tx.execute(sql`update commerce.theme_schedules set revert_status = 'done', revert_problem = null, reverted_at = now() where id = ${due.id}::uuid`);
      await audit(member.account.id, due.store_id, "store.theme_reverted", { schedule: due.id, install: target }, { area: "website", target: { type: "theme_install", id: target } });
    }
    log("info", leg === "publish" ? "theme_schedule.switched" : "theme_schedule.reverted", { store: due.store_id });
    return { kind: leg === "publish" ? ("switched" as const) : ("reverted" as const), store: { id: due.store_id, slug: due.slug } };
  });
}
