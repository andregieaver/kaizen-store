import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { customPeriod } from "@/lib/analytics-period";
import { readChallenge, utcDay, type Challenge } from "@/lib/autopilot-challenge";
import { challengeRatios, phaseOf, scoredPeriod, shownDay, type ChallengePhase } from "@/lib/challenge-console";
import type { Stall } from "@/lib/challenge-stalls";
import type { InterventionCounts } from "@/lib/interventions";
import { mainCurrency } from "@/lib/markets";

import { getAnalyticsSettings } from "./analytics-settings";
import { periodFiguresWithVisits } from "./analytics-totals";
import { sessionTotals } from "./analytics-traffic-data";
import { autopilotCostThisMonth } from "./autopilot-settings";
import { findChallengeStalls } from "./challenge-watch";
import { interventionsOf, type Intervention } from "./interventions";
import { log } from "./log";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The challenge console (`docs/100-day-challenge.md` H2): every store with a challenge set, for the platform team. Its phase and day, its
 * stalls (the stall watch's own, A6), what waits on the owner and how long, the autopilot's AI cost this month against the challenge's budget,
 * the people's actions by class since challenge mode came on (A5) and the three ratios since Day 1 (3.3). Counts, ids and figures only, never
 * what a customer wrote.
 */

export type Queue = { count: number; oldestAt: string | null };

export type ChallengeRatioFigures = {
  from: string;
  to: string;
  currency: string;
  netRevenueMinor: number;
  marketingMinor: number;
  orders: number;
  margin: number | null;
  perKrone: number | null;
  perVisitorMinor: number | null;
};

export type ChallengeStore = {
  storeId: string;
  slug: string;
  name: string;
  challenge: Challenge;
  phase: ChallengePhase;
  day: number | null;
  paused: boolean;
  stalls: Stall[];
  queues: { decisions: Queue; escalations: Queue; faults: Queue };
  ai: { spentMicros: number; unpriced: number; budgetUsd: number };
  interventions: InterventionCounts;
  other: Intervention[];
  /** Null before Day 1, or when the store's figures could not be read. */
  ratios: ChallengeRatioFigures | null;
};

const ROW = z.object({ id: col.uuid, slug: col.text, name: col.text, challenge: z.unknown(), paused: col.bool });
const QUEUE = z.object({ n: col.int, oldest: col.timestampOrNull });

const queueOf = (row: z.infer<typeof QUEUE> | null): Queue => ({ count: row?.n ?? 0, oldestAt: row?.oldest ?? null });

/** What waits on the owner: the calls the autopilot kept, escalated customers, and customers queued after a fault. */
async function queuesOf(storeId: string): Promise<ChallengeStore["queues"]> {
  const [decisions, escalations, faults] = await Promise.all([
    typedRow(
      QUEUE,
      sql`
        select count(*)::int as n, min(ap.created_at) as oldest from commerce.assistant_approvals ap
        join commerce.assistant_conversations c on c.id = ap.conversation_id and c.source = 'autopilot'
        where ap.store_id = ${storeId}::uuid and ap.status = 'pending'
      `,
    ),
    typedRow(
      QUEUE,
      sql`
        select count(*)::int as n, min(queued_at) as oldest from commerce.support_conversations
        where store_id = ${storeId}::uuid and status = 'open' and handler = 'queue' and anonymised_at is null and handoff_reason in ('customer', 'ai', 'tone')
      `,
    ),
    typedRow(
      QUEUE,
      sql`
        select count(*)::int as n, min(queued_at) as oldest from commerce.support_conversations
        where store_id = ${storeId}::uuid and status = 'open' and handler = 'queue' and anonymised_at is null and handoff_reason in ('no_ai', 'limit')
      `,
    ),
  ]);
  return { decisions: queueOf(decisions), escalations: queueOf(escalations), faults: queueOf(faults) };
}

/** The three ratios from Day 1 to today or Day 100, from the analytics' own totals (as `profit_overview` reads them). */
async function ratiosOf(slug: string, challenge: Challenge, today: string): Promise<ChallengeRatioFigures | null> {
  const period = scoredPeriod(challenge, today);
  if (!period) return null;
  const store = await getStore(slug);
  if (!store) return null;
  const settings = await getAnalyticsSettings(store.id);
  // With the visits joined in (revenue per visitor needs them), as the overview and `profit_overview` read them.
  const figures = await periodFiguresWithVisits(store, customPeriod(period.from, period.to), (p) => sessionTotals(store, p), settings);
  const totals = figures.totals;
  const d = figures.derived;
  const r = challengeRatios({ netRevenueMinor: d.netRevenue, contributionMinor: d.contributionProfit, marketingMinor: totals.marketingMinor, revenuePerVisitorMinor: d.revenuePerVisitor });
  return {
    from: period.from,
    to: period.to,
    currency: mainCurrency(store),
    netRevenueMinor: d.netRevenue,
    marketingMinor: totals.marketingMinor,
    orders: totals.orders,
    margin: r.margin,
    perKrone: r.perKrone,
    perVisitorMinor: r.perVisitorMinor,
  };
}

/** Every store with a challenge set, those running first, then upcoming, then ended; by name within each. */
export async function challengeStores(now: Date = new Date()): Promise<ChallengeStore[]> {
  const today = utcDay(now);
  const rows = await typedRows(
    ROW,
    sql`select s.id, s.slug, s.name, a.challenge, a.paused from commerce.autopilot_settings a join commerce.stores s on s.id = a.store_id where a.challenge is not null order by s.name`,
  );
  const stalls = await findChallengeStalls(now);
  const order: Record<ChallengePhase, number> = { on: 0, rehearsal: 1, upcoming: 2, ended: 3 };
  const stores = await Promise.all(
    rows.map(async (row): Promise<ChallengeStore | null> => {
      const challenge = readChallenge(row.challenge);
      if (!challenge) return null;
      const [queues, ai, log_, ratios] = await Promise.all([
        queuesOf(row.id),
        autopilotCostThisMonth(row.id),
        interventionsOf(row.id, new Date(`${challenge.startsOn}T00:00:00Z`), now),
        ratiosOf(row.slug, challenge, today).catch((error: unknown) => {
          log("warn", "challenge.ratios_failed", { storeId: row.id }, error);
          return null;
        }),
      ]);
      return {
        storeId: row.id,
        slug: row.slug,
        name: row.name,
        challenge,
        phase: phaseOf(challenge, today),
        day: shownDay(challenge, today),
        paused: row.paused,
        stalls: stalls.filter((s) => s.storeId === row.id),
        queues,
        ai: { spentMicros: ai.micros, unpriced: ai.unpriced, budgetUsd: challenge.aiMonthlyUsd },
        interventions: log_.counts,
        other: log_.other,
        ratios,
      };
    }),
  );
  return stores.filter((s): s is ChallengeStore => s !== null).sort((a, b) => order[a.phase] - order[b.phase]);
}

/** A store's id by its address, for setting a challenge from the console; null when there is none. */
export async function storeIdBySlug(slug: string): Promise<string | null> {
  const row = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.stores where slug = ${slug.trim().toLowerCase()}`);
  return row?.id ?? null;
}
