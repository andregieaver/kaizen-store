import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import {
  applyCampaigns,
  campaignInput,
  campaignRunning,
  runsIn,
  type Campaign,
  type CampaignLine,
  type CampaignResult,
} from "@/lib/campaigns";
import { shown, type Market } from "@/lib/markets";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { parsePrice } from "@/lib/product-input";

import { audit, type Membership } from "./auth";
import { customerTierIds } from "./customer-tiers";
import { segmentsOfBuyer } from "./segment-membership";
import { osloTime } from "./discounts";
import type { SaveResult } from "./settings";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * A store's campaigns (D114): what the admin makes, and what the cart and
 * checkout look up. Orders keep what a campaign gave them (its name and the
 * amounts), so changing or deleting a campaign never changes an order.
 */

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

function toCampaign(row: Row): Campaign {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as Campaign["kind"],
    active: Boolean(row.active),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    percent: Number(row.percent),
    buyQuantity: Number(row.buy_quantity),
    payQuantity: Number(row.pay_quantity),
    giftVariantId: row.gift_variant_id ? String(row.gift_variant_id) : null,
    giftQuantity: Number(row.gift_quantity),
    thresholds: (row.thresholds ?? {}) as Record<string, number>,
    amounts: (row.amounts ?? {}) as Record<string, number>,
    tierBasis: row.tier_basis === "quantity" || row.tier_basis === "spend" ? row.tier_basis : null,
    tiers: Array.isArray(row.tiers)
      ? (row.tiers as Record<string, unknown>[]).map((tier) => ({
          quantity: tier.quantity === null || tier.quantity === undefined ? null : Number(tier.quantity),
          amounts: (tier.amounts ?? {}) as Record<string, number>,
          percent: Number(tier.percent ?? 0),
          ...(tier.off && typeof tier.off === "object" && Object.keys(tier.off).length > 0 ? { off: tier.off as Record<string, number> } : {}),
        }))
      : [],
    buyMinQuantity: row.buy_min_quantity === null || row.buy_min_quantity === undefined ? null : Number(row.buy_min_quantity),
    buyMinAmounts: (row.buy_min_amounts ?? {}) as Record<string, number>,
    getProductIds: ids(row.get_product_ids),
    getTermIds: ids(row.get_term_ids),
    getQuantity: Number(row.get_quantity ?? 0),
    getKind: row.get_kind === "free" || row.get_kind === "percent" || row.get_kind === "amount" ? row.get_kind : null,
    getPercent: row.get_percent === null || row.get_percent === undefined ? null : Number(row.get_percent),
    getAmounts: (row.get_amounts ?? {}) as Record<string, number>,
    usesPerOrder: row.uses_per_order === null || row.uses_per_order === undefined ? null : Number(row.uses_per_order),
    productIds: ids(row.product_ids),
    termIds: ids(row.term_ids),
    tierIds: ids(row.tier_ids),
    usageLimit: row.usage_limit === null || row.usage_limit === undefined ? null : Number(row.usage_limit),
    perCustomerLimit: row.per_customer_limit === null || row.per_customer_limit === undefined ? null : Number(row.per_customer_limit),
    markets: ids(row.markets),
    stacks: Boolean(row.stacks),
    // Older rows and reads without the column combine, as every campaign did before D367.
    combinesWithCodes: row.combines_with_codes !== false,
    segmentId: row.segment_id ? String(row.segment_id) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export type CampaignListRow = Campaign & {
  /** The gift's product, for the list. */
  giftTitle: string | null;
  /** Orders that got a discount from it, and what it gave on paid ones per currency. */
  orders: number;
  given: Record<string, number>;
};

/** Whether an order line got something from the campaign with this id (an SQL expression), through its parts (D115). */
const partText = (id: string) => `ol.campaign_parts @> jsonb_build_array(jsonb_build_object('id', ${id}::text))`;

/**
 * How many orders (alias `o`) the campaign with this id (an SQL expression) gave something: on a line, or the order's free shipping
 * (D299 E3). Not cancelled, not copied (D129); `extra` narrows them.
 */
const ordersOf = (id: string, extra: SQL = sql`true`) => sql`(
  select count(*)::int from commerce.orders o
  where o.store_id = c.store_id and o.status <> 'cancelled' and o.copied_from is null and ${extra}
    and (o.campaign_shipping ->> 'id' = ${sql.raw(id)}::text or exists (
      select 1 from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id and ${sql.raw(partText(id))}
    ))
)`;

export async function listCampaigns(storeId: string): Promise<CampaignListRow[]> {
  const rows = await db().execute<Row>(sql`
    select c.*,
      (select coalesce((select title from commerce.product_translations where product_id = p.id order by locale limit 1), p.handle)
         from commerce.product_variants v
         join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
         where v.store_id = c.store_id and v.id = c.gift_variant_id) as gift_title,
      ${ordersOf("c.id")} as orders,
      (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) from (
         select currency, sum(minor)::bigint as total from (
           select o.currency, (part ->> 'minor')::bigint as minor
           from commerce.order_lines ol
           join commerce.orders o on o.store_id = ol.store_id and o.id = ol.order_id
           cross join lateral jsonb_array_elements(ol.campaign_parts) part
           where ol.store_id = c.store_id and part ->> 'id' = c.id::text and o.copied_from is null and o.status not in ('cancelled', 'pending_payment')
           union all
           -- The free shipping it gave (D299 E3).
           select o.currency, (o.campaign_shipping ->> 'minor')::bigint
           from commerce.orders o
           where o.store_id = c.store_id and o.campaign_shipping ->> 'id' = c.id::text and o.copied_from is null and o.status not in ('cancelled', 'pending_payment')
         ) parts
         group by currency) g) as given
    from commerce.campaigns c
    where c.store_id = ${storeId}::uuid
    order by c.active desc, c.created_at desc
  `);
  return rows.map((row) => ({
    ...toCampaign(row),
    giftTitle: row.gift_title ? String(row.gift_title) : null,
    orders: Number(row.orders),
    given: Object.fromEntries(Object.entries((row.given ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)])),
  }));
}

export async function getCampaign(storeId: string, id: string): Promise<Campaign | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.campaigns where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  return row ? toCampaign(row) : null;
}

/**
 * Creates or changes a campaign. Amounts are typed per market in its
 * currency. Orders already placed keep what they got: a change only applies
 * to orders from now on.
 */
export async function saveCampaign({ account, store }: Membership, id: string | null, input: unknown): Promise<SaveResult & { id?: string }> {
  const parsed = campaignInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const c = parsed.data;
  const problems: string[] = [];
  const existing = id ? await getCampaign(store.id, id) : null;
  if (id && !existing) return { ok: false, problems: ["The campaign no longer exists."] };
  // A country the store keeps but does not offer now (Several countries off, D178) is not in the editor: what the campaign says of it is kept.
  const hidden = (code: string) => !store.markets.some((m) => m.code === code) && store.keptMarkets.some((m) => m.code === code);

  /** Amounts typed per country in its currency, keeping what a hidden country had; `what` names them in a problem. */
  const perMarket = (typed: Record<string, string>, kept: Record<string, number> | undefined, what: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [code, minor] of Object.entries(kept ?? {})) if (hidden(code)) out[code] = minor;
    for (const market of store.markets) {
      const text = typed[market.code] ?? "";
      if (!text) continue;
      const minor = parsePrice(text, market.currency);
      if (minor === null || minor <= 0) problems.push(`${what} for ${market.name} is not a valid amount.`);
      else out[market.code] = minor;
    }
    return out;
  };
  const someMarket = (values: Record<string, number>) => store.markets.some((m) => values[m.code] !== undefined);
  // A gift needs its amount; an amount off and free shipping may have one (D299 E3).
  const thresholds = c.kind === "gift" || c.kind === "amount" || c.kind === "free_shipping" ? perMarket(c.thresholds, existing?.thresholds, "The amount") : {};
  if (c.kind === "gift" && !someMarket(thresholds) && problems.length === 0) problems.push("Say what the basket must come to, in at least one country's currency.");
  const amounts = c.kind === "amount" ? perMarket(c.amounts, existing?.amounts, "The amount off") : {};
  if (c.kind === "amount" && !someMarket(amounts) && problems.length === 0) problems.push("Say how much is taken off, in at least one country's currency.");
  // A tiered campaign's steps: each asking for more than the one before and giving more (D299 E3).
  const tiers: Campaign["tiers"] =
    c.kind === "tiered"
      ? c.tiers.map((tier, i) => {
          const step: Campaign["tiers"][number] = {
            quantity: c.tierBasis === "quantity" ? tier.quantity : null,
            amounts: c.tierBasis === "spend" ? perMarket(tier.amounts, existing?.tierBasis === "spend" ? existing.tiers[i]?.amounts : undefined, `Step ${i + 1}'s amount`) : {},
            percent: c.tierGive === "amount" ? 0 : tier.percent,
          };
          // An amount step (D392): what it takes off per market, kept for countries the editor does not show.
          if (c.tierGive === "amount") step.off = perMarket(tier.off, existing?.tiers[i]?.off, `Step ${i + 1}'s amount off`);
          return step;
        })
      : [];
  if (c.kind === "tiered" && problems.length === 0) {
    for (let i = 1; i < tiers.length; i++) {
      const before = tiers[i - 1];
      const now = tiers[i];
      if (c.tierGive === "amount") {
        for (const market of store.markets) {
          const a = before.off?.[market.code];
          const b = now.off?.[market.code];
          if (a !== undefined && b !== undefined && b <= a) problems.push(`Step ${i + 1} must take more off than step ${i} in ${market.name}.`);
        }
      } else if (now.percent <= before.percent) problems.push(`Step ${i + 1} must give more than step ${i}.`);
      if (c.tierBasis === "quantity" && (now.quantity ?? 0) <= (before.quantity ?? 0)) problems.push(`Step ${i + 1} must ask for more items than step ${i}.`);
      if (c.tierBasis === "spend") {
        for (const market of store.markets) {
          const a = before.amounts[market.code];
          const b = now.amounts[market.code];
          if (a !== undefined && b !== undefined && b <= a) problems.push(`Step ${i + 1} must ask for more than step ${i} in ${market.name}.`);
        }
      }
    }
    if (c.tierBasis === "spend" && !tiers.some((tier) => someMarket(tier.amounts))) problems.push("Say what each step asks the basket to come to, in at least one country's currency.");
    if (c.tierGive === "amount" && !tiers.every((tier) => someMarket(tier.off ?? {}))) problems.push("Say what each step takes off, in at least one country's currency.");
  }
  // Buy X get Y (D299 E4): what one use asks for, what shoppers get and what each given unit takes off.
  const bxgy = c.kind === "bxgy";
  const buyMinAmounts = bxgy && c.buyBasis === "spend" ? perMarket(c.buyMinAmounts, existing?.buyMinAmounts, "What they spend") : {};
  if (bxgy && c.buyBasis === "spend" && !someMarket(buyMinAmounts) && problems.length === 0) problems.push("Say what shoppers spend, in at least one country's currency.");
  const getAmounts = bxgy && c.getKind === "amount" ? perMarket(c.getAmounts, existing?.getAmounts, "The amount off each") : {};
  if (bxgy && c.getKind === "amount" && !someMarket(getAmounts) && problems.length === 0) problems.push("Say how much comes off each item, in at least one country's currency.");
  const getProductIds = bxgy && c.getScope === "some" ? [...new Set(c.getProductIds)] : [];
  const getTermIds = bxgy && c.getScope === "some" ? [...new Set(c.getTermIds)] : [];
  const startsAt = osloTime(c.startsAt);
  const endsAt = osloTime(c.endsAt);
  if (startsAt && endsAt && startsAt >= endsAt) problems.push("The campaign must end after it starts.");

  const productIds = c.scope === "all" ? [] : [...new Set(c.productIds)];
  const termIds = c.scope === "all" ? [] : [...new Set(c.termIds)];
  // Only the countries offered (D178: the store's own alone with Several countries off), and those the campaign already named that are kept.
  const markets = [...new Set(c.markets)];
  const unknown = markets.filter((code) => !store.markets.some((m) => m.code === code) && !(hidden(code) && existing?.markets.includes(code)));
  if (unknown.length > 0) problems.push(`The store does not sell to ${unknown.join(", ")}.`);
  const tierIds = [...new Set(c.tierIds)];
  if (tierIds.length > 0) {
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.customer_tiers
      where store_id = ${store.id}::uuid and id in (${sql.join(tierIds.map((t) => sql`${t}::uuid`), sql`, `)})
    `);
    if (Number(row.n) !== tierIds.length) problems.push("A chosen customer group no longer exists.");
  }
  if (c.segmentId) {
    const [row] = await db().execute<Row>(sql`select 1 from commerce.segments where store_id = ${store.id}::uuid and id = ${c.segmentId}::uuid`);
    if (!row) problems.push("The chosen segment no longer exists.");
  }
  // What it reaches and what it gives must be the store's own.
  const chosenProducts = [...new Set([...productIds, ...getProductIds])];
  const chosenTerms = [...new Set([...termIds, ...getTermIds])];
  if (chosenProducts.length > 0) {
    const chosen = chosenProducts;
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.products
      where store_id = ${store.id}::uuid and id in (${sql.join(chosen.map((p) => sql`${p}::uuid`), sql`, `)})
    `);
    if (Number(row.n) !== chosen.length) problems.push("A chosen product no longer exists.");
  }
  if (chosenTerms.length > 0) {
    const chosen = chosenTerms;
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.terms
      where store_id = ${store.id}::uuid and content_type = 'product' and id in (${sql.join(chosen.map((t) => sql`${t}::uuid`), sql`, `)})
    `);
    if (Number(row.n) !== chosen.length) problems.push("A chosen category or tag no longer exists.");
  }
  if (c.kind === "gift" && c.giftVariantId) {
    const [gift] = await db().execute<Row>(sql`
      select v.delivery, p.kind, p.host_id, p.subscription_only
      from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id}::uuid and v.id = ${c.giftVariantId}::uuid
    `);
    if (!gift) problems.push("The product to give no longer exists.");
    else if (gift.delivery !== "physical" || gift.kind !== "goods" || gift.host_id || gift.subscription_only) {
      problems.push("Only goods you ship yourself can be given: not downloads, appointments, stays, rentals, subscriptions or a host's listings.");
    }
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const values = {
    percent: c.kind === "percent" ? c.percent : 0,
    buy: c.kind === "multi_buy" ? c.buyQuantity : 0,
    pay: c.kind === "multi_buy" ? c.payQuantity : 0,
    gift: c.kind === "gift" ? c.giftVariantId : null,
    giftQuantity: c.kind === "gift" ? c.giftQuantity : 1,
    thresholds: JSON.stringify(thresholds),
    amounts: JSON.stringify(amounts),
    tierBasis: c.kind === "tiered" ? c.tierBasis : null,
    tiers: JSON.stringify(tiers),
    buyMinQuantity: bxgy && c.buyBasis === "items" ? c.buyMinQuantity : null,
    buyMinAmounts: JSON.stringify(buyMinAmounts),
    getProductIds: JSON.stringify(getProductIds),
    getTermIds: JSON.stringify(getTermIds),
    getQuantity: bxgy ? c.getQuantity : 0,
    getKind: bxgy ? c.getKind : null,
    getPercent: bxgy && c.getKind === "percent" ? c.getPercent : null,
    getAmounts: JSON.stringify(getAmounts),
    usesPerOrder: bxgy ? c.usesPerOrder : null,
    productIds: JSON.stringify(productIds),
    termIds: JSON.stringify(termIds),
    tierIds: JSON.stringify(tierIds),
    // Every country the store keeps is everywhere: an empty list. A list of the countries offered while others are kept stays a list (D178).
    markets: JSON.stringify(store.keptMarkets.every((m) => markets.includes(m.code)) ? [] : markets),
    stacks: (c.kind === "percent" || c.kind === "multi_buy" || c.kind === "tiered") && c.stacks,
  };
  const [row] = id
    ? await db().execute<Row>(sql`
        update commerce.campaigns set
          name = ${c.name}, kind = ${c.kind}, percent = ${values.percent}, buy_quantity = ${values.buy}, pay_quantity = ${values.pay},
          gift_variant_id = ${values.gift}::uuid, gift_quantity = ${values.giftQuantity}, thresholds = ${values.thresholds}::jsonb,
          amounts = ${values.amounts}::jsonb, tier_basis = ${values.tierBasis}, tiers = ${values.tiers}::jsonb,
          buy_min_quantity = ${values.buyMinQuantity}, buy_min_amounts = ${values.buyMinAmounts}::jsonb,
          get_product_ids = ${values.getProductIds}::jsonb, get_term_ids = ${values.getTermIds}::jsonb, get_quantity = ${values.getQuantity},
          get_kind = ${values.getKind}, get_percent = ${values.getPercent}, get_amounts = ${values.getAmounts}::jsonb, uses_per_order = ${values.usesPerOrder},
          product_ids = ${values.productIds}::jsonb, term_ids = ${values.termIds}::jsonb,
          tier_ids = ${values.tierIds}::jsonb, usage_limit = ${c.usageLimit}, per_customer_limit = ${c.perCustomerLimit},
          markets = ${values.markets}::jsonb, stacks = ${values.stacks}, combines_with_codes = ${c.combinesWithCodes},
          segment_id = ${c.segmentId}::uuid,
          starts_at = ${startsAt}::timestamptz, ends_at = ${endsAt}::timestamptz, active = ${c.active}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${id}::uuid
        returning id
      `)
    : await db().execute<Row>(sql`
        insert into commerce.campaigns (
          store_id, name, kind, percent, buy_quantity, pay_quantity, gift_variant_id, gift_quantity, thresholds, amounts, tier_basis, tiers,
          buy_min_quantity, buy_min_amounts, get_product_ids, get_term_ids, get_quantity, get_kind, get_percent, get_amounts, uses_per_order,
          product_ids, term_ids, tier_ids, usage_limit, per_customer_limit, markets, stacks, combines_with_codes, starts_at, ends_at, active,
          segment_id
        ) values (
          ${store.id}::uuid, ${c.name}, ${c.kind}, ${values.percent}, ${values.buy}, ${values.pay}, ${values.gift}::uuid,
          ${values.giftQuantity}, ${values.thresholds}::jsonb, ${values.amounts}::jsonb, ${values.tierBasis}, ${values.tiers}::jsonb,
          ${values.buyMinQuantity}, ${values.buyMinAmounts}::jsonb, ${values.getProductIds}::jsonb, ${values.getTermIds}::jsonb, ${values.getQuantity},
          ${values.getKind}, ${values.getPercent}, ${values.getAmounts}::jsonb, ${values.usesPerOrder}, ${values.productIds}::jsonb, ${values.termIds}::jsonb,
          ${values.tierIds}::jsonb, ${c.usageLimit}, ${c.perCustomerLimit}, ${values.markets}::jsonb, ${values.stacks}, ${c.combinesWithCodes}, ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${c.active},
          ${c.segmentId}::uuid
        )
        returning id
      `);
  await audit(account.id, store.id, id ? "campaign.updated" : "campaign.created", { name: c.name, kind: c.kind });
  return { ok: true, id: String(row.id) };
}

/** Deletes a campaign; orders that got something from it keep it. */
export async function deleteCampaign({ account, store }: Membership, id: string): Promise<SaveResult> {
  const current = await getCampaign(store.id, id);
  if (!current) return { ok: true };
  await db().execute(sql`delete from commerce.campaigns where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await audit(account.id, store.id, "campaign.deleted", { name: current.name });
  return { ok: true };
}

/** Switches a campaign on or off, keeping the rest. */
export async function setCampaignActive({ account, store }: Membership, id: string, active: boolean): Promise<SaveResult> {
  const rows = await db().execute<Row>(sql`
    update commerce.campaigns set active = ${active}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${id}::uuid returning name
  `);
  if (rows.length === 0) return { ok: false, problems: ["The campaign no longer exists."] };
  await audit(account.id, store.id, active ? "campaign.switched_on" : "campaign.switched_off", { name: String(rows[0].name) });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// In the cart and checkout
// ---------------------------------------------------------------------------

/**
 * The campaigns running now that this customer may have, their amounts in
 * the currency shown (D109): switched on, within their dates, for everyone or
 * a customer group the customer is in (D108), and with uses left (D115). In
 * checkout, pass the transaction and `lock`: a campaign with a limit is then
 * locked while the order is placed, so two checkouts cannot both take its last
 * use.
 */
export async function runningCampaigns(
  runner: Runner,
  storeId: string,
  market: Market,
  { customerId = null, lock = false, now = new Date() }: { customerId?: string | null; lock?: boolean; now?: Date } = {},
): Promise<Campaign[]> {
  // Only a campaign with a limit is locked, so checkouts that use none do not wait for each other.
  if (lock) {
    await runner.execute(sql`
      select 1 from commerce.campaigns where store_id = ${storeId}::uuid and active and (usage_limit is not null or per_customer_limit is not null)
      order by id for update
    `);
  }
  const rows = await runner.execute<Row>(sql`
    select c.*, case when c.usage_limit is null then 0 else ${ordersOf("c.id")} end as used,
    case when c.per_customer_limit is null or ${customerId}::uuid is null then 0 else ${ordersOf("c.id", sql`o.customer_id = ${customerId}::uuid`)} end as used_by_customer
    from commerce.campaigns c
    where c.store_id = ${storeId}::uuid and c.active
  `);
  const tiers = rows.some((row) => ids(row.tier_ids).length > 0) ? await customerTierIds(runner, storeId, customerId) : [];
  // Campaigns for a segment's people (D380): whether this buyer is one of them now, asked once for every segment named.
  const named = rows.filter((row) => row.segment_id).map((row) => String(row.segment_id));
  const inSegments = named.length > 0 ? await segmentsOfBuyer(runner, storeId, customerId, named, now) : new Set<string>();
  return rows
    .filter((row) => {
      const campaign = toCampaign(row);
      if (!campaignRunning(campaign, now) || !runsIn(campaign, market.code)) return false;
      // One for each customer needs to know who the customer is: signed in, and not yet at the limit.
      if (campaign.perCustomerLimit !== null && (customerId === null || Number(row.used_by_customer) >= campaign.perCustomerLimit)) return false;
      // For some customers only: a group they are in, or the segment they are in (either lets them in).
      if (campaign.tierIds.length > 0 || campaign.segmentId) {
        const inTier = campaign.tierIds.some((id) => tiers.includes(id));
        const inSegment = campaign.segmentId !== null && inSegments.has(campaign.segmentId);
        if (!inTier && !inSegment) return false;
      }
      return campaign.usageLimit === null || Number(row.used) < campaign.usageLimit;
    })
    .map((row) => shownIn(toCampaign(row), market));
}

/** A campaign's amounts for this market in the currency shown (D109): its threshold, an amount off and a tier's spend (D299 E3). */
export function shownIn(c: Campaign, market: Market): Campaign {
  const one = (values: Record<string, number>) => (values[market.code] === undefined ? values : { ...values, [market.code]: shown(market, values[market.code]) });
  return {
    ...c,
    thresholds: one(c.thresholds),
    amounts: one(c.amounts),
    tiers: c.tiers.map((tier) => ({ ...tier, amounts: one(tier.amounts), ...(tier.off ? { off: one(tier.off) } : {}) })),
    buyMinAmounts: one(c.buyMinAmounts),
    getAmounts: one(c.getAmounts),
  };
}

/**
 * Each product's categories, their parents and its tags, so a campaign for "Shoes" reaches what is in "Sneakers"; and the collections filled by
 * rules it meets (D319), so a campaign or code for one reaches what its page lists.
 */
export async function termsOfProducts(runner: Runner, storeId: string, productIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (productIds.length === 0) return out;
  const rows = await runner.execute<Row>(sql`
    with recursive t (product_id, term_id) as (
      select pt.product_id, pt.term_id from commerce.product_terms pt
      where pt.store_id = ${storeId}::uuid and pt.product_id in (${sql.join(productIds.map((p) => sql`${p}::uuid`), sql`, `)})
      union
      select p.id, rt.id from commerce.products p join commerce.terms rt on rt.store_id = p.store_id and rt.rules is not null
      where p.store_id = ${storeId}::uuid and p.id in (${sql.join(productIds.map((p) => sql`${p}::uuid`), sql`, `)})
        and commerce.product_matches_rules(p.store_id, p.id, rt.rules)
      union
      select t.product_id, tm.parent_id from t join commerce.terms tm on tm.id = t.term_id where tm.parent_id is not null
    )
    select product_id, term_id from t
  `);
  for (const row of rows) {
    const key = String(row.product_id);
    out.set(key, [...(out.get(key) ?? []), String(row.term_id)]);
  }
  return out;
}

/** What the cart and checkout give the rules for one line. */
export type BasketLine = Omit<CampaignLine, "termIds">;

/** A free product a basket has earned, as the cart shows it and checkout adds it. */
export type GiftItem = {
  campaignId: string;
  campaignName: string;
  variantId: string;
  productId: string;
  quantity: number;
  title: string;
  options: Record<string, string>;
  image: { url: string; alt: string } | null;
  /** What it would cost, at the price in the market shown (D109): the discount is all of it. */
  unitPriceMinor: number;
  vatRate: number;
};

export type CampaignOutcome = {
  result: CampaignResult;
  gifts: GiftItem[];
  /** The campaigns that were weighed (running, for this customer, not left out), with whether each combines with codes (D367). */
  weighed: Pick<Campaign, "id" | "name" | "combinesWithCodes">[];
};

const none: CampaignOutcome = { result: { lineOff: {}, lineBy: {}, lineParts: {}, applied: [], gifts: [], valueMinor: 0, freeShipping: null, next: [] }, gifts: [], weighed: [] };

/**
 * What the running campaigns do to a basket: the reductions per line, and
 * the free products it has earned that can be given (goods the store ships,
 * in stock, only when the order ships anyway). The cart and `placeOrder()`
 * both use it, so they cannot disagree. `leaveOut` names campaigns the basket
 * does not take because a discount code won over them (D367,
 * `campaignsAndCodes()`).
 */
export async function evaluateCampaigns(
  runner: Runner,
  { storeId, market }: { storeId: string; market: Market },
  lines: BasketLine[],
  {
    ships,
    customerId = null,
    lock = false,
    leaveOut,
  }: { ships: boolean; customerId?: string | null; lock?: boolean; leaveOut?: ReadonlySet<string> },
): Promise<CampaignOutcome> {
  if (lines.length === 0) return none;
  const campaigns = (await runningCampaigns(runner, storeId, market, { customerId, lock })).filter((c) => !leaveOut?.has(c.id));
  if (campaigns.length === 0) return none;
  const terms = await termsOfProducts(runner, storeId, [...new Set(lines.map((l) => l.productId))]);
  const result = applyCampaigns(
    campaigns,
    lines.map((l) => ({ ...l, termIds: terms.get(l.productId) ?? [] })),
    market.code,
  );
  // A host's listings are paid to the host on their own (D71): no free product from the store goes with them.
  const hosted = result.gifts.length > 0 && ships ? await hasHostListings(runner, storeId, [...new Set(lines.map((l) => l.productId))]) : false;
  const gifts = ships && !hosted ? await giftItems(runner, storeId, market, result.gifts) : [];
  return { result, gifts, weighed: campaigns.map((c) => ({ id: c.id, name: c.name, combinesWithCodes: c.combinesWithCodes })) };
}

async function hasHostListings(runner: Runner, storeId: string, productIds: string[]): Promise<boolean> {
  const [row] = await runner.execute<Row>(sql`
    select exists (
      select 1 from commerce.products where store_id = ${storeId}::uuid and host_id is not null
        and id in (${sql.join(productIds.map((p) => sql`${p}::uuid`), sql`, `)})
    ) as hosted
  `);
  return Boolean(row?.hosted);
}

/** The gifts that can be given now: sold by the store, shipped, active, priced in the market and in stock (physically: a gift is never backordered, D172). */
async function giftItems(runner: Runner, storeId: string, market: Market, earned: CampaignResult["gifts"]): Promise<GiftItem[]> {
  if (earned.length === 0) return [];
  const rows = await runner.execute<Row>(sql`
    select v.id, v.product_id, v.options, coalesce(tl.title, tf.title, p.handle) as title, cp.amount_minor,
      commerce.vat_rate(${market.code}, p.vat_category) as vat_rate,
      coalesce(m.thumbnail_url, m.url) as image_url, coalesce(commerce.media_alt(m.url, ${market.locale}), '') as image_alt,
      (select coalesce(va.in_stock, 0)::int from commerce.variant_availability va
         where va.store_id = v.store_id and va.variant_id = v.id) as available
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join lateral (select url, thumbnail_url from commerce.product_media where product_id = p.id order by position limit 1) m on true
    left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    where v.store_id = ${storeId}::uuid and v.id in (${sql.join([...new Set(earned.map((g) => g.variantId))].map((id) => sql`${id}::uuid`), sql`, `)})
      and v.active and v.delivery = 'physical'
      and p.status = 'active' and p.kind = 'goods' and p.host_id is null and not p.subscription_only
      and cp.amount_minor is not null
  `);
  const byVariant = new Map(rows.map((row) => [String(row.id), row]));
  // Two campaigns can give the same product: one stock, counted once.
  const left = new Map(rows.map((row) => [String(row.id), Number(row.available)]));
  const items: GiftItem[] = [];
  for (const gift of earned) {
    const row = byVariant.get(gift.variantId);
    if (!row) continue;
    const quantity = Math.min(gift.quantity, MAX_LINE_QUANTITY);
    if ((left.get(gift.variantId) ?? 0) < quantity) continue;
    left.set(gift.variantId, (left.get(gift.variantId) ?? 0) - quantity);
    items.push({
      campaignId: gift.campaignId,
      campaignName: gift.name,
      variantId: gift.variantId,
      productId: String(row.product_id),
      quantity,
      title: String(row.title),
      options: (row.options ?? {}) as Record<string, string>,
      image: row.image_url ? { url: String(row.image_url), alt: String(row.image_alt || row.title) } : null,
      unitPriceMinor: shown(market, Number(row.amount_minor)),
      vatRate: Number(row.vat_rate ?? 0),
    });
  }
  return items;
}

/** The products a store can give, one row per variant: goods it ships, on sale, with what each variant is. */
export async function listGiftChoices(storeId: string, locale: string): Promise<{ variantId: string; label: string }[]> {
  const rows = await db().execute<Row>(sql`
    select v.id, v.options, coalesce(tl.title, tf.title, p.handle) as title
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical'
      and p.status <> 'archived' and p.kind = 'goods' and p.host_id is null and not p.subscription_only
    order by 3, v.sku
  `);
  return rows.map((row) => {
    const options = Object.values((row.options ?? {}) as Record<string, string>).join(", ");
    return { variantId: String(row.id), label: options ? `${row.title} (${options})` : String(row.title) };
  });
}
