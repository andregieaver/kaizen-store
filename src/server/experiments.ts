import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import { decodeConsent, consentCookieName } from "@/lib/cookie-consent";
import { PREVIEW_COOKIE } from "@/lib/ab-preview";
import { readPreviewCookie } from "@/lib/ab-preview-sign";
import {
  dataCookieName,
  decodeAssignments,
  isUuid,
  OUTSIDE,
  type Assignments,
  type Device,
} from "@/lib/experiments";

import { log } from "./log";
import { col, typedRows } from "./typed-rows";
import { unlockSecret } from "./private-secret";

type Row = Record<string, unknown>;

/**
 * A/B tests of pages, as the storefront reads and writes them (D148, docs/ab-testing.md): which tests run for a store,
 * what a visitor was assigned, and the exposures and events that follow. Everything here treats the browser's cookies
 * as claims to check, and nothing records anyone who has not accepted statistics cookies.
 */

export { forgetRunning, runningExperiments, storeIdOfSlug, type RunningExperiment } from "./experiments-running";

// ---------------------------------------------------------------------------
// The visitor
// ---------------------------------------------------------------------------

/** Whether this browser has accepted statistics cookies for the store: the only way anyone is enrolled. */
export async function acceptedStatistics(storeId: string): Promise<boolean> {
  const stored = decodeConsent((await cookies()).get(consentCookieName(storeId))?.value);
  return stored?.choices.statistics === true;
}

/**
 * What this browser holds for the store, read from its cookie; null when it holds nothing valid, and while it holds a good preview link of the
 * store (D148 phase 20): a browser looking through a preview is never counted, for that test or any other of the store's.
 */
export async function readAssignments(storeId: string): Promise<Assignments | null> {
  const jar = await cookies();
  if (readPreviewCookie(unlockSecret(), jar.get(PREVIEW_COOKIE)?.value)?.storeId === storeId) return null;
  return decodeAssignments(jar.get(dataCookieName(storeId))?.value);
}

export type Visit = { market: string; device: Device };

/**
 * Records that a visitor was shown a version (D148): once per visitor and test (the first sight counts), only for a
 * running test, a version the visitor's own cookie says they have, and only if they accepted statistics cookies.
 */
export async function recordExposure(storeId: string, experimentId: string, variant: string, visit: Visit): Promise<boolean> {
  if (!isUuid(experimentId) || variant === OUTSIDE || !/^[a-z0-9-]{0,24}$/.test(visit.market)) return false;
  if (!(await acceptedStatistics(storeId))) return false;
  const mine = await readAssignments(storeId);
  if (!mine || mine.versions[experimentId] !== variant) return false;
  try {
    const rows = await db().execute<Row>(sql`
      insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant, market, device)
      select ${storeId}::uuid, e.id, ${mine.visitor}, v.key, ${visit.market}, ${visit.device}
      from commerce.experiments e join commerce.experiment_variants v on v.experiment_id = e.id and v.key = ${variant}
      where e.id = ${experimentId}::uuid and e.store_id = ${storeId}::uuid and e.status = 'running'
      on conflict (experiment_id, visitor) do nothing
      returning 1
    `);
    return rows.length > 0;
  } catch (error) {
    log("error", "experiments.exposure_record_failed", {}, error);
    return false;
  }
}

/** A click on the block a test counts: only from an exposed visitor, once, and only for the test's own block. */
export async function recordClick(storeId: string, experimentId: string, block: string): Promise<boolean> {
  if (!isUuid(experimentId) || block.length > 80) return false;
  if (!(await acceptedStatistics(storeId))) return false;
  const mine = await readAssignments(storeId);
  if (!mine || !mine.versions[experimentId] || mine.versions[experimentId] === OUTSIDE) return false;
  try {
    const rows = await db().execute<Row>(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select x.store_id, x.experiment_id, x.visitor, x.variant, 'click', ${block}
      from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
      where x.experiment_id = ${experimentId}::uuid and x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor}
        and e.primary_goal = 'click' and e.goal_params ->> 'block' = ${block}
      on conflict do nothing
      returning 1
    `);
    return rows.length > 0;
  } catch (error) {
    log("error", "experiments.click_record_failed", {}, error);
    return false;
  }
}

/**
 * A visitor in a test who then opened the page its goal names (D148 phase 20): only from an exposed visitor (so after they saw the version, in the
 * version they saw), once, only for the test's own page and while it runs.
 */
export async function recordPageGoal(storeId: string, experimentId: string, pageId: string): Promise<boolean> {
  if (!isUuid(experimentId) || !isUuid(pageId)) return false;
  if (!(await acceptedStatistics(storeId))) return false;
  const mine = await readAssignments(storeId);
  if (!mine || !mine.versions[experimentId] || mine.versions[experimentId] === OUTSIDE) return false;
  try {
    const rows = await typedRows(
      z.object({ one: col.int }),
      sql`
        insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
        select x.store_id, x.experiment_id, x.visitor, x.variant, 'page', ${pageId}
        from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
        where x.experiment_id = ${experimentId}::uuid and x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor}
          and e.primary_goal = 'page' and e.goal_params ->> 'page' = ${pageId}
        on conflict do nothing
        returning 1 as one
      `,
    );
    return rows.length > 0;
  } catch (error) {
    log("error", "experiments.page_goal_record_failed", {}, error);
    return false;
  }
}

/**
 * A form sent by an enrolled visitor (D148, phase 11): called by the form endpoint after the site has accepted the answer (a robot's, a
 * repeat of the day's and a refused one never get here), for every running test whose goal is this form and that the visitor was exposed
 * to. Once per visitor and form; never fails what it rides on, and says nothing when there is no cookie.
 */
export async function recordFormSent(storeId: string, block: string): Promise<void> {
  try {
    if (block.length > 80) return;
    const mine = await readAssignments(storeId);
    if (!mine) return;
    if (!(await acceptedStatistics(storeId))) return;
    await db().execute(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select x.store_id, x.experiment_id, x.visitor, x.variant, 'form', ${block}
      from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
      where x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor}
        and e.primary_goal = 'form' and e.goal_params ->> 'block' = ${block}
      on conflict do nothing
    `);
  } catch (error) {
    log("error", "experiments.form_record_failed", {}, error);
  }
}

/**
 * A sign-up to Kaizena Flow by an enrolled visitor of its own store (D148 phase 19): called by the sign-up form once the request is accepted
 * (a robot's and an invalid one never get here), for every running test of that store whose goal is a sign-up and that the visitor was
 * exposed to. Read from the store's own A/B cookie, which the sign-up page on kaizenaflow.com receives while the site is served from the
 * store (D484); the request itself is never tied to the visitor. Once per visitor; never fails what it rides on.
 */
export async function recordSignup(storeId: string): Promise<void> {
  try {
    const mine = await readAssignments(storeId);
    if (!mine) return;
    if (!(await acceptedStatistics(storeId))) return;
    await db().execute(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select x.store_id, x.experiment_id, x.visitor, x.variant, 'signup', ''
      from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
      where x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor} and e.primary_goal = 'signup'
      on conflict do nothing
    `);
  } catch (error) {
    log("error", "experiments.signup_record_failed", {}, error);
  }
}

/**
 * A cart or a checkout of an enrolled visitor (D148): the cart is tied to the visitor so a paid order can be traced
 * back, and a cart or checkout event is kept for every running test the visitor was exposed to. Never fails what it
 * rides on: it is called after the cart or the checkout has done its work, and says nothing when there is no cookie.
 */
export async function recordExperimentCart(storeId: string, cartId: string, goal: "cart" | "checkout"): Promise<void> {
  try {
    const mine = await readAssignments(storeId);
    if (!mine || !isUuid(cartId)) return;
    if (!(await acceptedStatistics(storeId))) return;
    await db().execute(sql`
      insert into commerce.experiment_carts (store_id, cart_id, visitor)
      values (${storeId}::uuid, ${cartId}::uuid, ${mine.visitor})
      on conflict (store_id, cart_id) do nothing
    `);
    await db().execute(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select x.store_id, x.experiment_id, x.visitor, x.variant, ${goal}, ''
      from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
      where x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor}
      on conflict do nothing
    `);
  } catch (error) {
    log("error", "experiments.cart_record_failed", {}, error);
  }
}

/** Counts a visitor's requests so a script cannot fill the tables: false past the limit (the same window as the chat's). */
export async function takeExperimentRequest(storeId: string, visitor: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${`ab:${visitor}`}, date_bin('10 minutes', now(), '2000-01-01'), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row.count) <= 120;
}

/** Forgets old carts' visitors (90 days) and the exposures of tests that ended over a year ago (the daily job). */
export async function pruneExperimentData(): Promise<number> {
  const carts = await db().execute<Row>(sql`delete from commerce.experiment_carts where created_at < now() - interval '90 days' returning 1`);
  return carts.length;
}
