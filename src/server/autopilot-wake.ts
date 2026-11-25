import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AutopilotReason } from "@/lib/incidents";
import { autopilotWakeEnv } from "@/lib/env";

import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * Waking the autopilot's scheduled Claude Code session (D895, the plan's section 5.1): the app only records that a run is wanted
 * (`requestWake()`, a row of `platform_autopilot_runs` with no `sent_at`), never calls out from a request; the dispatcher's `incidents` job
 * sends it (`sendDueWake()`) once the owner's gap since the last run's start has passed, at once for *Run now*. The call is the scheduled
 * task's API trigger, on the owner's Claude subscription (never API billing), with that task's own token, which can start that task and
 * nothing else. Its body carries only the reason and a count (the fire endpoint is outside the EU: no error text, no person). Without
 * `AUTOPILOT_FIRE_TOKEN` and `AUTOPILOT_TRIGGER_ID` nothing is sent and the nightly run covers everything. A wake not sent within
 * `WAKE_KEEP_MINUTES` is left (the nightly run picks up what it was for).
 */

const WAKE_KEEP_MINUTES = 30;
const FIRE_URL = (trigger: string) => `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(trigger)}/fire`;

type WakeReason = Exclude<AutopilotReason, "nightly" | "manual">;

/**
 * Records that a run is wanted, when the autopilot is on and no wake is already waiting (one statement; never throws). `run_now` always
 * records one, so the owner's press is never lost behind a quieter reason.
 */
export async function requestWake(reason: WakeReason, accountId: string | null = null): Promise<boolean> {
  try {
    const row = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.platform_autopilot_runs (reason, requested_by)
        select ${reason}, ${accountId}::uuid
        where (select autopilot_on from commerce.platform_settings limit 1)
          and (${reason} = 'run_now' or not exists (
            select 1 from commerce.platform_autopilot_runs
             where sent_at is null and started_at is null and requested_at > now() - make_interval(mins => ${WAKE_KEEP_MINUTES})
          ))
        returning id
      `,
    );
    return row !== null;
  } catch (error) {
    log("warn", "autopilot.wake_request_failed", { reason }, error);
    return false;
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sends the waiting wake the job found due (`wakeDue` in its settings read): the newest waiting one, its gap checked again, through the
 * scheduled task's API trigger. Marks it sent with the session's link the trigger answers. Returns whether one went. Never throws.
 */
export async function sendDueWake(fetcher: Fetcher = fetch): Promise<boolean> {
  try {
    const env = autopilotWakeEnv();
    if (!env) return false;
    const wake = await typedRow(
      z.object({ id: col.uuid, reason: col.text, waiting: col.int }),
      sql`
        select w.id, w.reason,
          (select count(*)::int from commerce.platform_incidents where status in ('open', 'approved')) as waiting
        from commerce.platform_autopilot_runs w
        where w.sent_at is null and w.started_at is null and w.requested_at > now() - make_interval(mins => ${WAKE_KEEP_MINUTES})
          and (select autopilot_on from commerce.platform_settings limit 1)
          and (w.reason = 'run_now' or not exists (
            select 1 from commerce.platform_autopilot_runs r
             where greatest(r.sent_at, r.started_at) > now() - make_interval(hours => (select autopilot_gap_hours from commerce.platform_settings limit 1))
          ))
        order by (w.reason = 'run_now') desc, w.requested_at desc
        limit 1
      `,
    );
    if (!wake) return false;
    const response = await fetcher(FIRE_URL(env.triggerId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `Woken by the app: reason ${wake.reason}; ${wake.waiting} entries waiting. Wake id ${wake.id}.` }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) {
      log("warn", "autopilot.wake_refused", { status: response.status });
      return false;
    }
    const answer = z.object({ claude_code_session_url: z.string().url().optional() }).safeParse(await response.json().catch(() => ({})));
    const session = answer.success ? (answer.data.claude_code_session_url ?? null) : null;
    await typedRow(
      z.object({ id: col.uuid }),
      sql`update commerce.platform_autopilot_runs set sent_at = now(), session = ${session?.slice(0, 300) ?? null} where id = ${wake.id}::uuid returning id`,
    );
    log("info", "autopilot.woken", { reason: wake.reason, waiting: wake.waiting });
    return true;
  } catch (error) {
    log("warn", "autopilot.wake_failed", {}, error);
    return false;
  }
}

/** The SQL the job's settings read carries, so an idle tick asks nothing more: whether a waiting wake may be sent now. */
export const WAKE_DUE_SQL = sql`exists (
  select 1 from commerce.platform_autopilot_runs w
   where w.sent_at is null and w.started_at is null and w.requested_at > now() - make_interval(mins => ${WAKE_KEEP_MINUTES})
) and autopilot_on`;
