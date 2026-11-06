import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { movements, planSummary, type BillingLine, type Funnel, type MovementFigure, type PlanMove, type PlanSummary } from "@/lib/plan-analytics";

import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Analytics of Kaizena Flow's plans (C2 of `docs/platform-parity-plan.md`, D470), for Platform → Plans → Analytics: what the stores' plans earn
 * every month now, in Stripe's live mode and apart in its test mode; how that moved in the period (`commerce.plan_moves`, kept from the day
 * it began); and the way from an application to a paying store. Only customers' stores count: never a template, a demo store, a sandbox or
 * Kaizena Flow's own.
 */

export type PlanAnalytics = {
  days: number;
  live: PlanSummary;
  test: PlanSummary;
  moves: { live: MovementFigure[]; test: MovementFigure[] };
  funnel: Funnel;
  /** When the history of moves begins (the day it was first kept), or null with none yet. */
  since: string | null;
};

const lineRow = z.object({
  status: col.textOrNull,
  mode: col.textOrNull,
  plan_name: col.textOrNull,
  currency: col.textOrNull,
  interval: z.enum(["month", "year"]).nullable(),
  amount_minor: col.int.nullable(),
  cancelling: col.bool,
});

const moveRow = z.object({
  kind: z.enum(["started", "upgraded", "downgraded", "cancelled", "paused", "resumed"]),
  mode: col.textOrNull,
  currency: col.textOrNull,
  delta: col.int,
});

export async function planAnalytics(days = 30): Promise<PlanAnalytics> {
  const period = Math.max(1, Math.min(365, Math.round(days)));
  const [lines, moves, funnel, since] = await Promise.all([
    typedRows(
      lineRow,
      sql`
        select b.status, b.mode::text as mode, p.name as plan_name, pp.currency, pp.interval, pp.amount_minor::int as amount_minor,
               coalesce(b.cancel_at_period_end, false) as cancelling
        from commerce.store_billing b
        join commerce.stores s on s.id = b.store_id and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)
        left join commerce.plans p on p.id = b.plan_id
        left join commerce.plan_prices pp on pp.id = b.price_id
      `,
    ),
    typedRows(
      moveRow,
      sql`
        select m.kind, m.mode, m.currency, (m.mrr_after_minor - m.mrr_before_minor)::int as delta
        from commerce.plan_moves m
        join commerce.stores s on s.id = m.store_id and not (s.is_template or s.starter or s.sandbox or s.house)
        where m.at >= now() - make_interval(days => ${period})
      `,
    ),
    typedRow(
      z.object({ asked: col.int, approved: col.int, opened: col.int, paying: col.int }),
      sql`
        select count(*)::int as asked,
               count(*) filter (where r.status = 'approved')::int as approved,
               count(*) filter (where s.setup_completed_at is not null)::int as opened,
               count(*) filter (where b.status in ('active', 'past_due'))::int as paying
        from commerce.access_requests r
        left join commerce.stores s on s.id = r.store_id
        left join commerce.store_billing b on b.store_id = r.store_id
        where r.created_at >= now() - make_interval(days => ${period})
          and (not r.self_serve or r.confirmed_at is not null) and r.email not like '%.invalid'
      `,
    ),
    typedRow(z.object({ since: col.timestampOrNull }), sql`select min(at) as since from commerce.plan_moves`),
  ]);
  const toLine = (r: z.infer<typeof lineRow>): BillingLine => ({
    status: r.status,
    planName: r.plan_name,
    currency: r.currency,
    interval: r.interval,
    amountMinor: r.amount_minor,
    cancelling: r.cancelling,
  });
  const toMove = (r: z.infer<typeof moveRow>): PlanMove => ({ kind: r.kind, currency: r.currency, deltaMinor: r.delta });
  return {
    days: period,
    live: planSummary(lines.filter((l) => l.mode === "live").map(toLine)),
    test: planSummary(lines.filter((l) => l.mode !== "live").map(toLine)),
    moves: { live: movements(moves.filter((m) => m.mode === "live").map(toMove)), test: movements(moves.filter((m) => m.mode !== "live").map(toMove)) },
    funnel: funnel ?? { asked: 0, approved: 0, opened: 0, paying: 0 },
    since: since?.since ? new Date(since.since).toISOString() : null,
  };
}
