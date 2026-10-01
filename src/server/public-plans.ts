import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import type { PlanInterval } from "@/lib/plans";
import type { PublicPlans } from "@/lib/plan-offer";

type Row = Record<string, unknown>;

/** The tag every change to plans, their prices or their features refreshes (D142). */
export const PLANS_TAG = "plans";

/**
 * Kaizen's active plans with their active prices and the features each includes, for the Plans block on
 * Kaizen's pages (D142). Cached under `PLANS_TAG`: the platform's plan editor and comparison refresh it.
 * Nothing about stores or Stripe is read, only what a visitor may see.
 */
export async function getPublicPlans(): Promise<PublicPlans> {
  "use cache";
  cacheLife("hours");
  cacheTag(PLANS_TAG);
  const [plans, prices, features, grants] = await Promise.all([
    readDb().execute<Row>(sql`
      select id, name, description, sale_fee_bps, position from commerce.plans where active order by position, lower(name)
    `),
    readDb().execute<Row>(sql`
      select plan_id, currency::text as currency, interval, amount_minor from commerce.plan_prices where active
    `),
    readDb().execute<Row>(sql`select id, category, name, description, position from commerce.plan_features order by position, lower(name)`),
    readDb().execute<Row>(sql`select feature_id, plan_id from commerce.plan_feature_grants`),
  ]);
  return {
    plans: plans.map((plan) => ({
      id: String(plan.id),
      name: String(plan.name),
      description: String(plan.description ?? ""),
      saleFeeBps: Number(plan.sale_fee_bps),
      position: Number(plan.position),
      prices: prices
        .filter((price) => price.plan_id === plan.id)
        .map((price) => ({ currency: String(price.currency).trim(), interval: String(price.interval) as PlanInterval, amountMinor: Number(price.amount_minor) })),
      featureIds: grants.filter((grant) => grant.plan_id === plan.id).map((grant) => String(grant.feature_id)),
    })),
    features: features.map((f) => ({
      id: String(f.id),
      category: String(f.category),
      name: String(f.name),
      description: String(f.description ?? ""),
      position: Number(f.position),
    })),
  };
}
