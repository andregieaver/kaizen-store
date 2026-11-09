import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import type { PlanInterval } from "@/lib/plans";
import { LIMIT_KEYS } from "@/lib/limits";
import type { PublicPlans } from "@/lib/plan-offer";
import { publicCampaign, type PlanCampaign } from "@/lib/plan-campaigns";

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
  cacheTag(PLANS_TAG);
  const [plans, prices, features, grants, limits, rates, campaigns] = await Promise.all([
    readDb().execute<Row>(sql`
      select id, name, description, sale_fee_bps, position from commerce.plans where active order by position, lower(name)
    `),
    readDb().execute<Row>(sql`
      select plan_id, currency::text as currency, interval, amount_minor from commerce.plan_prices where active
    `),
    readDb().execute<Row>(sql`select id, category, name, description, position from commerce.plan_features order by position, lower(name)`),
    readDb().execute<Row>(sql`select feature_id, plan_id from commerce.plan_feature_grants`),
    // What each plan includes of its limits (D314); a plan without a row of its own shows nothing for that limit.
    readDb().execute<Row>(sql`select plan_id, key, value from commerce.plan_limits where plan_id is not null`),
    // The ECB's latest rate of each currency (D481): the AI a plan includes is in euros, shown in the page's currency.
    readDb().execute<Row>(sql`select distinct on (currency) currency::text as currency, rate::text as rate from commerce.ecb_reference_rates order by currency, rate_date desc`),
    // Campaigns not ended (D524), with how many seconds until each starts and ends: the one running is shown, never its code.
    readDb().execute<Row>(sql`
      select id, code, campaign_name, kind, percent, amounts, duration, duration_months, plan_ids, starts_at, expires_at,
        extract(epoch from starts_at - now())::float8 as starts_in, extract(epoch from expires_at - now())::float8 as ends_in
      from commerce.platform_discount_codes where campaign_name is not null and active and expires_at > now() order by starts_at
    `),
  ]);
  // Read again when a campaign starts or ends within the hour, so its price shows and goes on time; else hourly.
  const nextChange = Math.min(...campaigns.map((c) => (Number(c.starts_in) > 0 ? Number(c.starts_in) : Number(c.ends_in))), Infinity);
  if (nextChange < 3600) cacheLife({ revalidate: Math.max(60, Math.ceil(nextChange)) });
  else cacheLife("hours");
  const running = campaigns.find((c) => Number(c.starts_in) <= 0);
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
      limits: LIMIT_KEYS.flatMap((key) => {
        const row = limits.find((l) => l.plan_id === plan.id && l.key === key);
        return row ? [{ key, value: row.value == null ? null : Number(row.value) }] : [];
      }),
    })),
    features: features.map((f) => ({
      id: String(f.id),
      category: String(f.category),
      name: String(f.name),
      description: String(f.description ?? ""),
      position: Number(f.position),
    })),
    euroRates: Object.fromEntries(rates.map((r) => [String(r.currency).trim(), Number(r.rate)])),
    campaign: running ? publicCampaign(campaignOf(running)) : null,
  };
}

/** A campaign's row as the campaign rules take it (D524). */
function campaignOf(row: Row): PlanCampaign {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.campaign_name),
    kind: row.kind === "fixed" ? "fixed" : "percent",
    percent: Number(row.percent),
    amounts: (row.amounts ?? {}) as Record<string, number>,
    duration: String(row.duration) as PlanCampaign["duration"],
    durationMonths: row.duration_months == null ? null : Number(row.duration_months),
    active: true,
    startsAt: new Date(String(row.starts_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    planIds: ((row.plan_ids as string[] | null) ?? []).map(String),
  };
}
