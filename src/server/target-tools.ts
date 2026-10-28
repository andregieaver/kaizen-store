import "server-only";

import { formatCount, formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { todayIn } from "@/lib/analytics-period";
import type { TargetMetric } from "@/lib/analytics-targets";
import { mainCurrency } from "@/lib/markets";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { runningTargets } from "./analytics-insights";
import { listPeriodTargets, savePeriodTarget } from "./analytics-settings";
import { OwnerToolError } from "./owner-tool-error";
import type { OwnerToolContext } from "./owner-tools";

/**
 * The AI manager's targets (wave 8 unit D, D348): the store's targets with their progress worked out in code by `periodProgress()` (through
 * `runningTargets()`), and a target set through the settings page's own saver. Every figure is written out here; the model repeats them.
 */

const STATUS_WORDS = {
  ahead: "ahead of the expected pace (or reached)",
  on_track: "on track",
  behind: "behind the expected pace",
  upcoming: "not started yet",
  not_known: "not known yet",
  no_target: "no target",
} as const;

const MISSING_WORDS = {
  visits: "Visits were not counted on every day of the period, so the conversion rate is not known: visit counting is turned on in Analytics settings.",
  orders: "Too few paid orders so far to judge the average.",
  sessions: "Too few visits so far to judge the rate.",
} as const;

export async function listTargetsTool({ store }: OwnerToolContext) {
  const now = new Date();
  const today = todayIn(now, store.timeZone);
  const currency = mainCurrency(store);
  const locale = store.markets[0]?.locale ?? "en";
  const write = (metric: TargetMetric, value: number) =>
    metric === "orders" ? formatCount(value) : metric === "conversion" ? formatPercent(value / 10_000, 2) : formatAmount(value, currency, locale);
  const [targets, running] = await Promise.all([listPeriodTargets(store.id, { from: today }), runningTargets(store, now, { withMonth: true })]);
  const byId = new Map(running.map((r) => [r.target.id, r]));
  return {
    targets: targets.map((t) => {
      const card = byId.get(t.id);
      const p = card?.progress;
      return {
        metric: t.metric,
        period: t.period,
        from: t.startsOn,
        to: t.endsOn,
        target: write(t.metric, t.targetValue),
        status: p ? STATUS_WORDS[p.status] : t.startsOn > today ? STATUS_WORDS.upcoming : STATUS_WORDS.not_known,
        ...(p && p.actual !== null ? { so_far: write(t.metric, p.actual) } : {}),
        ...(p && p.expected !== null && p.metric !== "conversion" && p.metric !== "aov" ? { expected_by_now: write(t.metric, p.expected) } : {}),
        ...(p && p.projected !== null ? { if_the_pace_holds: `${write(t.metric, p.projected)} (an estimate)` } : {}),
        ...(p ? { days_left: p.daysLeft } : {}),
        ...(p?.missing ? { missing: MISSING_WORDS[p.missing] } : {}),
        ...(p?.tooEarly && !p.missing ? { verdict: "Too early in the period for a verdict on the pace." } : {}),
        ...(card && card.unconverted > 0 ? { left_out: `${card.unconverted} paid order(s) in ${card.missingCurrencies.join(", ")} are left out: no exchange rate.` } : {}),
      };
    }),
    basis: `Net sales and the average order value are without VAT in ${currency}, from paid orders; conversion counts the orders from a shopper's checkout over visits.`,
    page: `/admin/${store.slug}/analytics/settings#targets-more`,
  };
}

export async function setTargetTool({ store, account }: OwnerToolContext, input: OwnerToolInput<"set_target">) {
  const result = await savePeriodTarget({ account, store }, input);
  if (!result.ok) throw new OwnerToolError(result.problems.join(" "));
  const t = result.target;
  return {
    saved: { metric: t.metric, period: t.period, from: t.startsOn, to: t.endsOn },
    replaced: result.replaced,
    page: `/admin/${store.slug}/analytics`,
  };
}
