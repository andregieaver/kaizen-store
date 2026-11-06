import type { PlanInterval } from "./plans";

/**
 * Analytics of Kaizena Flow's plans (C2 of `docs/platform-parity-plan.md`, D470): what the platform earns every month from its stores' plans,
 * how that moved, and the way from an application to a paying store. The store's Subscriptions analytics (D152) is the model; Kaizena Flow's
 * business is its plans, so these are its own. Pure: `src/server/plan-analytics.ts` reads the rows.
 */

/** A plan's price as a month's worth, in minor units: a yearly price is a twelfth, rounded to the nearest minor unit. */
export const monthlyMinor = (amountMinor: number, interval: PlanInterval): number => (interval === "year" ? Math.round(amountMinor / 12) : amountMinor);

/** A Stripe subscription that counts towards what is earned every month: running and paid for, or running and late. A trial is not yet. */
export const COUNTS_AS_RECURRING: readonly string[] = ["active", "past_due"];

export type BillingLine = { status: string | null; planName: string | null; currency: string | null; interval: PlanInterval | null; amountMinor: number | null; cancelling: boolean };

export type CurrencyFigure = { currency: string; mrrMinor: number; stores: number };

export type PlanFigure = { plan: string; stores: number; mrr: CurrencyFigure[] };

export type PlanSummary = {
  /** Monthly recurring revenue per currency, largest first. */
  mrr: CurrencyFigure[];
  paying: number;
  trialing: number;
  late: number;
  cancelling: number;
  /** Per plan, the stores on it (paying or trying) and what it earns per currency. */
  byPlan: PlanFigure[];
};

function addTo(list: CurrencyFigure[], currency: string, minor: number) {
  const at = list.find((f) => f.currency === currency);
  if (at) {
    at.mrrMinor += minor;
    at.stores += 1;
  } else list.push({ currency, mrrMinor: minor, stores: 1 });
}

const byMoney = (a: CurrencyFigure, b: CurrencyFigure) => b.mrrMinor - a.mrrMinor || a.currency.localeCompare(b.currency);

/** What the stores' plans earn every month, and how many stores are paying, trying, late or leaving. */
export function planSummary(lines: readonly BillingLine[]): PlanSummary {
  const mrr: CurrencyFigure[] = [];
  const plans = new Map<string, PlanFigure>();
  let paying = 0;
  let trialing = 0;
  let late = 0;
  let cancelling = 0;
  for (const line of lines) {
    const running = line.status !== null && ["active", "past_due", "trialing"].includes(line.status);
    if (!running) continue;
    if (line.status === "trialing") trialing += 1;
    else paying += 1;
    if (line.status === "past_due") late += 1;
    if (line.cancelling) cancelling += 1;
    const name = line.planName ?? "—";
    const plan = plans.get(name) ?? { plan: name, stores: 0, mrr: [] };
    plan.stores += 1;
    plans.set(name, plan);
    if (COUNTS_AS_RECURRING.includes(line.status!) && line.currency && line.interval && line.amountMinor !== null) {
      const minor = monthlyMinor(line.amountMinor, line.interval);
      addTo(mrr, line.currency, minor);
      addTo(plan.mrr, line.currency, minor);
    }
  }
  const byPlan = [...plans.values()].map((p) => ({ ...p, mrr: p.mrr.sort(byMoney) })).sort((a, b) => b.stores - a.stores || a.plan.localeCompare(b.plan));
  return { mrr: mrr.sort(byMoney), paying, trialing, late, cancelling, byPlan };
}

/** A change of a store's plan, as `commerce.plan_moves` keeps it. */
export type PlanMove = { kind: "started" | "upgraded" | "downgraded" | "cancelled" | "paused" | "resumed"; currency: string | null; deltaMinor: number };

export type MovementFigure = { kind: PlanMove["kind"]; count: number; byCurrency: { currency: string; deltaMinor: number }[] };

/** The moves of a period, counted by kind, with what each kind added to or took from the monthly revenue per currency. */
export function movements(moves: readonly PlanMove[]): MovementFigure[] {
  const order: PlanMove["kind"][] = ["started", "upgraded", "downgraded", "cancelled", "paused", "resumed"];
  return order.map((kind) => {
    const of = moves.filter((m) => m.kind === kind);
    const byCurrency: { currency: string; deltaMinor: number }[] = [];
    for (const m of of) {
      if (!m.currency || m.deltaMinor === 0) continue;
      const at = byCurrency.find((c) => c.currency === m.currency);
      if (at) at.deltaMinor += m.deltaMinor;
      else byCurrency.push({ currency: m.currency, deltaMinor: m.deltaMinor });
    }
    return { kind, count: of.length, byCurrency: byCurrency.sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor)) };
  });
}

/** The way from an application to a paying store, each step a number of the period's applications. */
export type Funnel = { asked: number; approved: number; opened: number; paying: number };

/** A step's share of the applications, as a whole percentage; none when nobody asked. */
export const share = (n: number, of: number): number | null => (of > 0 ? Math.round((n / of) * 100) : null);
