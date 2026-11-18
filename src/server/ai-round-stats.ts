import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { col, typedRows } from "./typed-rows";

/**
 * Tokens per call (bloat review step 1.19): what the calls of the last days really sent and received, from the provider's own counts in
 * `commerce.ai_usage` (text calls only, never an estimate or a failed call). Per feature, the median and 90th percentile of input and
 * output tokens per call; for the AI manager (its own rounds and those metered as `analytics_question`) also per turn: the median input,
 * the median number of calls, the share of input read from the provider's cache (in all, and after the first round) and the share of
 * turns with a round that called `load_tools`. One statement; Platform → AI → Usage draws it.
 */

const figure = col.decimal.nullable();

const ROW = z.object({
  scope: z.enum(["feature", "manager"]),
  feature: col.text,
  calls: col.int,
  input_p50: figure,
  input_p90: figure,
  output_p50: figure,
  output_p90: figure,
  turns: col.int.nullable(),
  turn_input_p50: figure,
  turn_calls_p50: figure,
  cached_share: figure,
  cached_share_after_first: figure,
  load_share: figure,
});

export type CallFigures = { feature: string; calls: number; inputP50: number | null; inputP90: number | null; outputP50: number | null; outputP90: number | null };

export type RoundStats = {
  byFeature: CallFigures[];
  manager: CallFigures & {
    turns: number;
    turnInputP50: number | null;
    turnCallsP50: number | null;
    /** Cached input tokens over input tokens, 0 to 1; null with no input. */
    cachedShare: number | null;
    cachedShareAfterFirst: number | null;
    /** Turns with a round that called `load_tools`, over turns. */
    loadShare: number | null;
  };
};

export async function roundStats(days = 30): Promise<RoundStats> {
  const rows = await typedRows(
    ROW,
    sql`
      with calls as (
        select feature, turn_id, round, input_tokens, output_tokens, cached_input_tokens, loaded_tools,
          feature in ('ai_manager', 'analytics_question') as manager
        from commerce.ai_usage
        where kind = 'text' and not estimated and failed = 0 and created_at > now() - make_interval(days => ${Math.max(1, Math.round(days))})
      ),
      turns as (
        select turn_id, sum(input_tokens) as input, count(*) as calls, bool_or(loaded_tools) as loaded
        from calls where manager and turn_id is not null group by turn_id
      )
      select 'feature' as scope, feature, count(*)::int as calls,
        percentile_cont(0.5) within group (order by input_tokens) as input_p50,
        percentile_cont(0.9) within group (order by input_tokens) as input_p90,
        percentile_cont(0.5) within group (order by output_tokens) as output_p50,
        percentile_cont(0.9) within group (order by output_tokens) as output_p90,
        null::int as turns, null::float8 as turn_input_p50, null::float8 as turn_calls_p50,
        null::float8 as cached_share, null::float8 as cached_share_after_first, null::float8 as load_share
      from calls group by feature
      union all
      select 'manager', 'ai_manager', count(*)::int,
        percentile_cont(0.5) within group (order by input_tokens),
        percentile_cont(0.9) within group (order by input_tokens),
        percentile_cont(0.5) within group (order by output_tokens),
        percentile_cont(0.9) within group (order by output_tokens),
        (select count(*)::int from turns),
        (select percentile_cont(0.5) within group (order by input) from turns),
        (select percentile_cont(0.5) within group (order by calls) from turns),
        sum(cached_input_tokens)::float8 / nullif(sum(input_tokens), 0),
        (sum(cached_input_tokens) filter (where round > 0))::float8 / nullif(sum(input_tokens) filter (where round > 0), 0),
        (select (count(*) filter (where loaded))::float8 / nullif(count(*), 0) from turns)
      from calls where manager
      order by 1, 3 desc, 2
    `,
  );
  const figures = (r: z.output<typeof ROW>): CallFigures => ({
    feature: r.feature,
    calls: r.calls,
    inputP50: r.input_p50,
    inputP90: r.input_p90,
    outputP50: r.output_p50,
    outputP90: r.output_p90,
  });
  const m = rows.find((r) => r.scope === "manager");
  return {
    byFeature: rows.filter((r) => r.scope === "feature").map(figures),
    manager: {
      ...(m ? figures(m) : { feature: "ai_manager", calls: 0, inputP50: null, inputP90: null, outputP50: null, outputP90: null }),
      turns: m?.turns ?? 0,
      turnInputP50: m?.turn_input_p50 ?? null,
      turnCallsP50: m?.turn_calls_p50 ?? null,
      cachedShare: m?.cached_share ?? null,
      cachedShareAfterFirst: m?.cached_share_after_first ?? null,
      loadShare: m?.load_share ?? null,
    },
  };
}
