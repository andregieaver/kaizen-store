import { featureGroups, type PlanFeature } from "./plan-features";
import type { PlanInterval } from "./plans";

/**
 * Kaizen's plans as a visitor's page shows them (D142): the active plans with their prices and what they
 * include, shaped into cards and a comparison table. Pure: `src/server/public-plans.ts` reads the data,
 * `PlansSection` draws what is made here, and the builder's stand-in uses the same shapes.
 */

export type PublicPrice = { currency: string; interval: PlanInterval; amountMinor: number };

export type PublicPlan = {
  id: string;
  name: string;
  description: string;
  saleFeeBps: number;
  position: number;
  /** Active prices only. */
  prices: PublicPrice[];
  /** The ids of the features it includes. */
  featureIds: string[];
};

export type PublicPlans = { plans: PublicPlan[]; features: Omit<PlanFeature, "planIds">[] };

export type PlanCardPrice = { amountMinor: number; currency: string; interval: PlanInterval };

export type PlanCard = {
  id: string;
  name: string;
  description: string;
  saleFeeBps: number;
  /** The price each card leads with, and the other one under it when the block shows both. */
  main: PlanCardPrice;
  other: PlanCardPrice | null;
  /** Whole percent a year's price saves against twelve months, when both exist and it is at least 1. */
  yearlySavingPercent: number | null;
  features: { id: string; name: string; description: string }[];
  highlighted: boolean;
};

/**
 * The currency to show: the one asked for if any plan has a price in it, else the one most plans have a
 * price in (the first alphabetically on a tie), or null when no plan has a price.
 */
export function offerCurrency(plans: PublicPlan[], wanted?: string): string | null {
  const counts = new Map<string, number>();
  for (const plan of plans) {
    for (const currency of new Set(plan.prices.map((price) => price.currency))) counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }
  if (wanted && counts.has(wanted)) return wanted;
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? null;
}

/** Whole percent a yearly price saves against twelve monthly ones; null when it saves under 1 % (or costs more). */
export function yearlySaving(monthlyMinor: number, yearlyMinor: number): number | null {
  if (monthlyMinor <= 0 || yearlyMinor <= 0) return null;
  const percent = Math.round((1 - yearlyMinor / (monthlyMinor * 12)) * 100);
  return percent >= 1 ? percent : null;
}

/**
 * The cards: plans with a price in the currency, in the platform's order. With an interval chosen a card
 * leads with that price (or the other if it has only that); without one it leads with the monthly price and
 * shows the yearly one under it.
 */
export function planCards(
  data: PublicPlans,
  options: { currency?: string; interval?: PlanInterval; highlightId?: string },
): { currency: string | null; cards: PlanCard[] } {
  const ordered = [...data.plans].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const currency = offerCurrency(ordered, options.currency);
  if (!currency) return { currency: null, cards: [] };
  const featuresById = new Map(data.features.map((f) => [f.id, f]));
  const cards: PlanCard[] = [];
  for (const plan of ordered) {
    const monthly = plan.prices.find((p) => p.currency === currency && p.interval === "month");
    const yearly = plan.prices.find((p) => p.currency === currency && p.interval === "year");
    const first = options.interval === "year" ? (yearly ?? monthly) : (monthly ?? yearly);
    if (!first) continue;
    const other = options.interval ? null : first === monthly ? (yearly ?? null) : null;
    cards.push({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      saleFeeBps: plan.saleFeeBps,
      main: first,
      other,
      yearlySavingPercent: monthly && yearly && !options.interval ? yearlySaving(monthly.amountMinor, yearly.amountMinor) : null,
      features: plan.featureIds
        .map((id) => featuresById.get(id))
        .filter((f): f is NonNullable<typeof f> => Boolean(f))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((f) => ({ id: f.id, name: f.name, description: f.description })),
      highlighted: plan.id === options.highlightId,
    });
  }
  return { currency, cards };
}

/** The comparison table: the features by category, and for each whether each shown card's plan includes it. */
export function comparisonTable(
  data: PublicPlans,
  cards: PlanCard[],
): { category: string; rows: { id: string; name: string; description: string; included: boolean[] }[] }[] {
  const granted = new Map(data.plans.map((plan) => [plan.id, new Set(plan.featureIds)]));
  return featureGroups(data.features.map((f) => ({ ...f, planIds: [] }))).map((group) => ({
    category: group.category,
    rows: group.features.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      included: cards.map((card) => granted.get(card.id)?.has(f.id) ?? false),
    })),
  }));
}

/** What the page builder offers to choose among for the Plans component (D142): each active plan and the currencies it has a price in. */
export type PlanChoice = { id: string; name: string; currencies: string[] };

export function planChoices(data: PublicPlans): PlanChoice[] {
  return [...data.plans]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((plan) => ({ id: plan.id, name: plan.name, currencies: [...new Set(plan.prices.map((price) => price.currency))].sort() }));
}

/** Every currency some plan has a price in, sorted. */
export function planCurrencies(choices: PlanChoice[]): string[] {
  return [...new Set(choices.flatMap((choice) => choice.currencies))].sort();
}
