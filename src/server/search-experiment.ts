import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { keywordArm, rate, type Rate } from "@/lib/experiment-stats";
import { callRates, splitP, UNITS, type Call } from "@/lib/experiment-units";

import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * The search test (Phase 2, S5, D77). While one runs, each search is given
 * hybrid search or keyword search alone at random (the unit is the search:
 * no cookie or identifier is set or read), and its log row keeps the
 * experiment and arm. Result links go through a redirect that records
 * which result was opened. The results compare the arms on the share of
 * searches that find nothing, the share where a result is opened, and how
 * far down the first opened result was.
 */

export type Arm = "hybrid" | "keyword";

export type Experiment = { id: string; keywordShare: number; startedAt: string; endedAt: string | null };

const toExperiment = (row: Row): Experiment => ({
  id: String(row.id),
  keywordShare: Number(row.keyword_share),
  startedAt: new Date(String(row.started_at)).toISOString(),
  endedAt: row.ended_at ? new Date(String(row.ended_at)).toISOString() : null,
});

/** The test running now, if one is. */
export async function runningExperiment(): Promise<Experiment | null> {
  const [row] = await readDb().execute<Row>(sql`select * from commerce.search_experiments where ended_at is null`);
  return row ? toExperiment(row) : null;
}

/** Tests, newest first. */
export async function listExperiments(): Promise<Experiment[]> {
  const rows = await readDb().execute<Row>(sql`select * from commerce.search_experiments order by started_at desc limit 20`);
  return rows.map(toExperiment);
}

/** The arm for one search, by a fresh random draw. */
export function drawArm(experiment: Experiment, draw = Math.random()): Arm {
  return keywordArm(draw, experiment.keywordShare) ? "keyword" : "hybrid";
}

export async function startExperiment(accountId: string, keywordShare: number): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!(keywordShare >= 0.05 && keywordShare <= 0.95)) return { ok: false, problem: "The keyword share is from 5 to 95 %." };
  try {
    await db().execute(sql`
      insert into commerce.search_experiments (keyword_share, started_by) values (${keywordShare}, ${accountId}::uuid)
    `);
  } catch {
    return { ok: false, problem: "A test is already running. Stop it first." };
  }
  await audit(accountId, null, "search_test.started", { keywordShare });
  return { ok: true };
}

export async function stopExperiment(accountId: string): Promise<void> {
  const rows = await db().execute<Row>(sql`
    update commerce.search_experiments set ended_at = now(), ended_by = ${accountId}::uuid where ended_at is null returning id
  `);
  if (rows.length > 0) await audit(accountId, null, "search_test.stopped", { experimentId: String(rows[0].id) });
}

/**
 * Records that a search's result was opened, if the search is the store's
 * and the product is too; anything else is ignored, as links can be typed.
 */
export async function recordClick(storeId: string, searchId: string, handle: string, position: number): Promise<string | null> {
  const rows = await db().execute<Row>(sql`
    with product as (
      select id from commerce.products where store_id = ${storeId}::uuid and handle = ${handle}
    ), recorded as (
      insert into commerce.search_clicks (store_id, search_id, product_id, position)
      select ${storeId}::uuid, q.id, product.id, ${position}
      from commerce.search_queries q, product
      where q.id = ${searchId}::uuid and q.store_id = ${storeId}::uuid and ${position} between 1 and 100
      returning 1
    )
    select (select id from product) as product_id, (select count(*) from recorded) as recorded
  `);
  return rows[0]?.product_id ? String(rows[0].product_id) : null;
}

export type ArmResult = {
  searches: number;
  zero: number;
  /** Searches with results where one was opened. */
  opened: number;
  withResults: number;
  /** The first opened result's place, on average, among searches where one was opened. */
  firstPosition: number | null;
};

/** The same five calls the engine makes for a page test, by its arithmetic (D148, phase 7): the unit is still the search. */
export type Verdict = Call;

export type Comparison = { keyword: Rate; hybrid: Rate; diff: { diff: number; low: number; high: number } | null; verdict: Verdict };

export type ExperimentResults = {
  experiment: Experiment;
  arms: Record<Arm, ArmResult>;
  /** Sample-ratio check: below 0.001, the split cannot be trusted. */
  srmP: number;
  /** Searches that found nothing: fewer is better. */
  zeroRate: Comparison;
  /** Searches with results where one was opened: more is better. */
  openRate: Comparison;
  weeks: { week: string; arms: Record<Arm, { searches: number; openRate: number; zeroRate: number }> }[];
};

const empty = (): ArmResult => ({ searches: 0, zero: 0, opened: 0, withResults: 0, firstPosition: null });

/** How the arms of a test compare, overall and week by week. */
export async function experimentResults(experiment: Experiment): Promise<ExperimentResults> {
  const [armRows, weekRows] = await Promise.all([
    readDb().execute<Row>(sql`
      with s as (
        select q.id, q.arm, q.results,
          (select min(c.position) from commerce.search_clicks c where c.search_id = q.id) as first_position
        from commerce.search_queries q where q.experiment_id = ${experiment.id}::uuid
      )
      select arm, count(*)::int as searches, count(*) filter (where results = 0)::int as zero,
        count(*) filter (where results > 0)::int as with_results,
        count(*) filter (where first_position is not null)::int as opened,
        avg(first_position)::float as first_position
      from s group by arm
    `),
    readDb().execute<Row>(sql`
      with s as (
        select q.arm, q.results, date_trunc('week', q.created_at) as week,
          exists (select 1 from commerce.search_clicks c where c.search_id = q.id) as opened
        from commerce.search_queries q where q.experiment_id = ${experiment.id}::uuid
      )
      select to_char(week, 'IYYY-"W"IW') as week, arm, count(*)::int as searches,
        count(*) filter (where results = 0)::int as zero,
        count(*) filter (where results > 0)::int as with_results,
        count(*) filter (where opened)::int as opened
      from s group by week, arm order by week
    `),
  ]);
  const arms: Record<Arm, ArmResult> = { hybrid: empty(), keyword: empty() };
  for (const row of armRows) {
    arms[row.arm as Arm] = {
      searches: Number(row.searches),
      zero: Number(row.zero),
      opened: Number(row.opened),
      withResults: Number(row.with_results),
      firstPosition: row.first_position === null ? null : Number(row.first_position),
    };
  }
  const srmP = splitP(arms.keyword.searches, arms.hybrid.searches, experiment.keywordShare);
  // Keyword search is the control and hybrid the treatment, as in the old test; the numbers and the call are the engine's.
  const compare = (keyword: Rate, hybrid: Rate, lowerIsBetter: boolean): Comparison => {
    const called = callRates(keyword, hybrid, { rule: "interval", floor: UNITS.search.floor, splitChance: srmP, lowerIsBetter });
    return {
      keyword,
      hybrid,
      diff: called.diff === null || called.low === null || called.high === null ? null : { diff: called.diff, low: called.low, high: called.high },
      verdict: called.call,
    };
  };
  const weeks = new Map<string, ExperimentResults["weeks"][number]>();
  for (const row of weekRows) {
    const key = String(row.week);
    const week = weeks.get(key) ?? { week: key, arms: { hybrid: { searches: 0, openRate: 0, zeroRate: 0 }, keyword: { searches: 0, openRate: 0, zeroRate: 0 } } };
    week.arms[row.arm as Arm] = {
      searches: Number(row.searches),
      zeroRate: rate({ hits: Number(row.zero), of: Number(row.searches) }),
      openRate: rate({ hits: Number(row.opened), of: Number(row.with_results) }),
    };
    weeks.set(key, week);
  }
  return {
    experiment,
    arms,
    srmP,
    zeroRate: compare({ hits: arms.keyword.zero, of: arms.keyword.searches }, { hits: arms.hybrid.zero, of: arms.hybrid.searches }, true),
    openRate: compare(
      { hits: arms.keyword.opened, of: arms.keyword.withResults },
      { hits: arms.hybrid.opened, of: arms.hybrid.withResults },
      false,
    ),
    weeks: [...weeks.values()],
  };
}
