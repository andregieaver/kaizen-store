import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "./auth";
import { log } from "./log";
import { pauseAfterTrial, reopenAfterPlan } from "./private-mode";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's free trial and its end (D359, D420). Self-serve sign-up and every Dream Factory store start with `TRIAL_DAYS` days: the owner
 * may look, change and open the store without a plan, and a plan chosen before the end is free until then (Stripe's `trial_end`). When the
 * trial ends with no plan, an open store is made private again (`settleTrials()`, the five-minute dispatcher's `trials`): kept, with a
 * banner saying to choose a plan; once a plan starts it is made public again. Only a store the job made private is ever made public by it.
 * A store that began on a trial and later cancels its plan is made private the same way when the plan ends (decided 5 November 2026): it
 * needs a running plan to be public, so one month paid cannot keep it public for good; Billing says so while the plan is ending, and the
 * banner says the plan ended (`pausedAfter()`). A store that never had a trial (one a platform admin approved) is left as it is.
 */

export const TRIAL_DAYS = 14;

// On a plan: Stripe's subscription is trialing, active or past due, as the setup checklist reads it (`getSetupProgress()`).

/**
 * Starts the trial for a store that has none and is on no plan: a store that had one, or is on a plan, is left as it is, so starting the
 * Dream Factory again never gives a store a second trial. Returns whether a trial was started; audited as `store.trial_started`.
 */
export async function grantTrial(storeId: string, accountId: string | null, via: "dream_factory" | "self_signup" | "workspace"): Promise<boolean> {
  const started = await writeTrial(storeId);
  if (started) await audit(accountId, storeId, "store.trial_started", { days: TRIAL_DAYS, via }, { area: "settings", target: { type: "store", id: storeId } });
  return started;
}

/**
 * Writes a trial where the store's plan is kept: on the store's own row while extensions are not sold, and on its account's row once they
 * are (D748 E5: an account made after the launch is billed through its account from its first day), never for Kaizena Flow's own. Either
 * row is left alone once it had a trial or is on a plan.
 */
export async function writeTrial(storeId: string): Promise<boolean> {
  const placed = await typedRow(
    z.object({ organisation_id: col.uuid.nullable(), launched: col.bool }),
    sql`
      select s.organisation_id,
             coalesce((select ps.extensions_launched_at <= now() from commerce.platform_settings ps), false)
               and not coalesce((select o.platform from commerce.organisations o where o.id = s.organisation_id), true) as launched
        from commerce.stores s where s.id = ${storeId}::uuid
    `,
  );
  if (placed?.launched && placed.organisation_id) {
    const started = await typedRow(
      z.object({ organisation_id: col.uuid }),
      sql`
        insert into commerce.organisation_billing (organisation_id, trial_ends_at) values (${placed.organisation_id}::uuid, now() + make_interval(days => ${TRIAL_DAYS}))
        on conflict (organisation_id) do update set trial_ends_at = excluded.trial_ends_at, updated_at = now()
          where organisation_billing.trial_ends_at is null and coalesce(organisation_billing.status, '') not in ('trialing', 'active', 'past_due')
        returning organisation_id
      `,
    );
    return Boolean(started);
  }
  const started = await typedRow(
    z.object({ store_id: col.uuid }),
    sql`
      insert into commerce.store_billing (store_id, trial_ends_at) values (${storeId}::uuid, now() + make_interval(days => ${TRIAL_DAYS}))
      on conflict (store_id) do update set trial_ends_at = excluded.trial_ends_at
        where store_billing.trial_ends_at is null and coalesce(store_billing.status, '') not in ('trialing', 'active', 'past_due')
      returning store_id
    `,
  );
  return Boolean(started);
}

/** A store's trial end, or null when it never had one. */
export async function trialEndOf(storeId: string): Promise<Date | null> {
  const row = await typedRow(z.object({ trial_ends_at: col.timestampOrNull }), sql`select trial_ends_at from commerce.store_plans where store_id = ${storeId}::uuid`);
  return row?.trial_ends_at ? new Date(row.trial_ends_at) : null;
}

/** Whether the trial's end made the store private (for the banner and the private-mode switch); null when it did not. */
export async function trialPausedAt(storeId: string): Promise<Date | null> {
  const row = await typedRow(
    z.object({ trial_paused_at: col.timestampOrNull }),
    sql`select trial_paused_at from commerce.store_billing where store_id = ${storeId}::uuid`,
  );
  return row?.trial_paused_at ? new Date(row.trial_paused_at) : null;
}

/**
 * Why the trial's end job made the store private (D420), for its banner: `plan` when it had a plan that has since ended (a store that
 * began on a trial needs a running plan to be public, its trial or a cancelled plan ending alike), `trial` when it never had one; null
 * when the job did not make it private.
 */
export async function pausedAfter(storeId: string): Promise<"trial" | "plan" | null> {
  const row = await typedRow(
    z.object({ trial_paused_at: col.timestampOrNull, had_plan: col.bool }),
    sql`select trial_paused_at, subscription_id is not null as had_plan from commerce.store_plans where store_id = ${storeId}::uuid`,
  );
  if (!row?.trial_paused_at) return null;
  return row.had_plan ? "plan" : "trial";
}

/** An open store the trial's end may make private: never a store template or a demo store. */
const OPEN_STORE = sql`s.setup_completed_at is not null and s.status = 'active' and not s.private_mode and not (s.is_template or s.starter)`;

/** At most this many stores each way a run: the dispatcher comes back in five minutes. */
const PER_RUN = 50;

/**
 * The trials' ends (the five-minute dispatcher): an open store whose trial has ended with no plan is made private, and one the job made
 * private whose plan has started is made public again. A store template or demo store is never touched.
 */
export async function settleTrials(): Promise<{ paused: number; reopened: number }> {
  const ended = await typedRows(
    z.object({ id: col.uuid, slug: col.text }),
    // The two kinds of billing asked apart (D748 E4), each from its own small table: through `store_plans` every store would be read.
    sql`
      select x.id, x.slug from (
        select s.id, s.slug, b.trial_ends_at from commerce.store_billing b join commerce.stores s on s.id = b.store_id
        where b.trial_ends_at <= now() and coalesce(b.status, '') not in ('trialing', 'active', 'past_due')
          and not exists (select 1 from commerce.organisation_billing ob where ob.organisation_id = s.organisation_id)
          and ${OPEN_STORE}
        union all
        select s.id, s.slug, ob.trial_ends_at from commerce.organisation_billing ob join commerce.stores s on s.organisation_id = ob.organisation_id
        where ob.trial_ends_at <= now() and coalesce(ob.status, '') not in ('trialing', 'active', 'past_due') and ${OPEN_STORE}
      ) x
      order by x.trial_ends_at limit ${PER_RUN}
    `,
  );
  let paused = 0;
  for (const store of ended) if (await pauseAfterTrial(store)) paused += 1;

  const planned = await typedRows(
    z.object({ id: col.uuid, slug: col.text }),
    sql`
      select s.id, s.slug from commerce.store_billing b join commerce.stores s on s.id = b.store_id
        join commerce.store_plans p on p.store_id = b.store_id
      where b.trial_paused_at is not null and p.status in ('trialing', 'active', 'past_due')
      order by b.trial_paused_at limit ${PER_RUN}
    `,
  );
  let reopened = 0;
  for (const store of planned) if (await reopenAfterPlan(store)) reopened += 1;
  if (paused > 0 || reopened > 0) log("info", "store_trial.settled", { paused, reopened });
  return { paused, reopened };
}
