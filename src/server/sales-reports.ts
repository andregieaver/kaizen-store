import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { byPerson, forecast, forecastCurrencies, stageConversion, timeToWin, type ClosedDeal, type ForecastBucket, type PersonRow, type StageStep } from "@/lib/sales-reports";

import { col, typedRows } from "./typed-rows";

/**
 * Sales reports (S6, D520, `src/lib/sales-reports.ts`): what Analytics → Sales reads from the store's deals (D464). The forecast is of every
 * open deal now; the stages, the people and the time to win are of the period, by the store's day: deals made in it for the stages, deals won
 * or lost in it for the people and the time to win. Counts and sums only; a deal's title or customer is never read here.
 */

export type SalesReport = {
  pipelines: { id: string; name: string }[];
  pipelineId: string | null;
  currency: string;
  /** The currencies open deals are in, the main one first; the forecast is of `currency`. */
  currencies: string[];
  forecast: ForecastBucket[];
  open: { deals: number; valueMinor: number; weightedMinor: number };
  stages: { names: Record<string, string>; steps: StageStep[]; won: number; lost: number; open: number };
  people: (PersonRow & { name: string | null })[];
  timeToWin: { median: number | null; mean: number | null; deals: number };
};

export async function salesReport(
  storeId: string,
  input: { main: string; currency?: string | null; pipelineId?: string | null; from: string; to: string; today: string },
): Promise<SalesReport> {
  const pipelines = await typedRows(
    z.object({ id: col.uuid, name: col.text }),
    sql`select id, name from commerce.deal_pipelines where store_id = ${storeId}::uuid order by sort, created_at`,
  );
  const pipelineId = pipelines.find((p) => p.id === input.pipelineId)?.id ?? pipelines[0]?.id ?? null;
  const inPipeline = pipelineId ? sql`and d.pipeline_id = ${pipelineId}::uuid` : sql``;

  const [openDeals, stages, journeys, closed] = await Promise.all([
    typedRows(
      z.object({ estimate_minor: col.minorOrNull, currency: col.currency, expected_close_on: col.textOrNull, probability: col.int.nullable() }),
      sql`
        select d.estimate_minor, d.currency, d.expected_close_on::text, s.probability
        from commerce.deals d join commerce.deal_stages s on s.store_id = d.store_id and s.id = d.stage_id
        where d.store_id = ${storeId}::uuid and d.status = 'open' ${inPipeline}
      `,
    ),
    pipelineId
      ? typedRows(
          z.object({ id: col.uuid, name: col.text }),
          sql`select id, name from commerce.deal_stages where store_id = ${storeId}::uuid and pipeline_id = ${pipelineId}::uuid order by position, created_at`,
        )
      : Promise.resolve([]),
    // Deals made in the period, each with every stage it has been in (its moves, and the stage it is in now).
    typedRows(
      z.object({ status: z.enum(["open", "won", "lost"]), stages: z.array(z.string()) }),
      sql`
        select d.status, array(
          select distinct m.stage_id::text from commerce.deal_moves m where m.store_id = d.store_id and m.deal_id = d.id and m.stage_id is not null
          union select d.stage_id::text
        ) as stages
        from commerce.deals d
        where d.store_id = ${storeId}::uuid ${inPipeline}
          and commerce.store_day(d.store_id, d.created_at) >= ${input.from}::date and commerce.store_day(d.store_id, d.created_at) < ${input.to}::date
      `,
    ),
    // Deals won or lost in the period, with who owned them.
    typedRows(
      z.object({
        owner_id: col.uuid.nullable(),
        owner_name: col.textOrNull,
        status: z.enum(["won", "lost"]),
        estimate_minor: col.minorOrNull,
        currency: col.currency,
        created_at: col.timestamp,
        closed_at: col.timestamp,
      }),
      sql`
        select d.owner_id, coalesce(nullif(a.name, ''), a.email) as owner_name, d.status, d.estimate_minor, d.currency, d.created_at, d.closed_at
        from commerce.deals d left join commerce.accounts a on a.id = d.owner_id
        where d.store_id = ${storeId}::uuid ${inPipeline} and d.status in ('won', 'lost')
          and commerce.store_day(d.store_id, d.closed_at) >= ${input.from}::date and commerce.store_day(d.store_id, d.closed_at) < ${input.to}::date
      `,
    ),
  ]);

  const open = openDeals.map((d) => ({ estimateMinor: d.estimate_minor, currency: d.currency, expectedCloseOn: d.expected_close_on, probability: d.probability }));
  const currencies = forecastCurrencies(open, input.main);
  const currency = input.currency && currencies.includes(input.currency) ? input.currency : (currencies[0] ?? input.main);
  const buckets = forecast(open, currency, input.today);
  const closedDeals: ClosedDeal[] = closed.map((d) => ({ ownerId: d.owner_id, status: d.status, estimateMinor: d.estimate_minor, currency: d.currency, createdAt: d.created_at, closedAt: d.closed_at }));
  const names = new Map(closed.map((d) => [d.owner_id, d.owner_name]));
  const conversion = stageConversion(
    stages.map((s) => s.id),
    journeys.map((j) => ({ status: j.status, stages: j.stages })),
  );
  return {
    pipelines,
    pipelineId,
    currency,
    currencies,
    forecast: buckets,
    open: {
      deals: buckets.reduce((s, b) => s + b.deals, 0),
      valueMinor: buckets.reduce((s, b) => s + b.valueMinor, 0),
      weightedMinor: buckets.reduce((s, b) => s + b.weightedMinor, 0),
    },
    stages: { names: Object.fromEntries(stages.map((s) => [s.id, s.name])), ...conversion },
    people: byPerson(closedDeals, currency).map((row) => ({ ...row, name: names.get(row.ownerId) ?? null })),
    timeToWin: timeToWin(closedDeals),
  };
}
