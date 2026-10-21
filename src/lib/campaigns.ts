import { z } from "zod";

import { memberLineOff } from "./customer-tiers";
import { planPrice } from "./subscriptions";

/**
 * Campaigns (D114): offers a store runs for a time, that shoppers need no
 * code for: a percentage off, "buy N pay for M" (3 for 2), a free product once
 * the basket comes to an amount, and (D299 E3) an amount off, free shipping and
 * a percentage that grows with what is bought (tiers). Each can be limited to
 * chosen products and categories or tags, and to a time. The rules here need
 * no database, so the cart shows what checkout will charge.
 *
 * Campaigns take a reduction off goods bought once (not appointments, stays,
 * rentals or subscriptions), before the buyer's group discount (D108) and
 * any code (D31), which count what is left. A unit gets at most one
 * campaign: where several apply to the same products, the one that gives the
 * shopper most is used; except a percentage set to stack, which also comes off
 * what the others left, one after the other.
 */

export const CAMPAIGN_KINDS = ["percent", "multi_buy", "gift", "amount", "free_shipping", "tiered"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

/** What a tiered campaign's steps count (D299 E3): units, or what the lines come to. */
export const TIER_BASES = ["quantity", "spend"] as const;
export type TierBasis = (typeof TIER_BASES)[number];
/** A tiered campaign has two to five steps. */
export const TIERS_MIN = 2;
export const TIERS_MAX = 5;
/** Most units a quantity step can ask for. */
export const TIER_QUANTITY_MAX = 1000;

/** A step of a tiered campaign: so many units, or what the lines come to per market (in the currency shown), for a percentage off. */
export type CampaignTier = { quantity: number | null; amounts: Record<string, number>; percent: number };

export const CAMPAIGN_NAME_MAX = 80;
/** Most units a "buy N" offer can ask for. */
export const MULTI_BUY_MAX = 20;
/** Most free units of a gift. */
export const GIFT_QUANTITY_MAX = 5;

export type Campaign = {
  id: string;
  name: string;
  kind: CampaignKind;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Percent off, for `percent`. */
  percent: number;
  /** "3 for 2": buy 3 (`buyQuantity`), pay for 2 (`payQuantity`). */
  buyQuantity: number;
  payQuantity: number;
  /** The free product, its quantity, and what the basket must come to in each market (in the currency shown). */
  giftVariantId: string | null;
  giftQuantity: number;
  thresholds: Record<string, number>;
  /** What an `amount` campaign takes off, per market (in the currency shown). */
  amounts: Record<string, number>;
  /** A `tiered` campaign's basis and steps, lowest first. */
  tierBasis: TierBasis | null;
  tiers: CampaignTier[];
  /** What it applies to: these products and every product in these categories and tags; with neither, everything. */
  productIds: string[];
  termIds: string[];
  /** Only customers in one of these customer groups (D108, their company's too); none for everyone. */
  tierIds: string[];
  /** Orders that may get it in all; null for no limit. */
  usageLimit: number | null;
  /** Orders one signed-in customer may get it on; null for no limit. */
  perCustomerLimit: number | null;
  /** The countries (market codes) it runs in; none for all of the store's. */
  markets: string[];
  /** A percentage or a "buy N pay for M" that also applies on top of other campaigns, instead of competing with them. */
  stacks: boolean;
  createdAt: string;
};

/** A basket line as the rules see it. */
export type CampaignLine = {
  key: string;
  productId: string;
  /** The product's categories (with their parents, if the campaign should reach them) and tags. */
  termIds: string[];
  unitMinor: number;
  quantity: number;
  /** Goods bought once: what a price campaign may reduce. */
  discountable: boolean;
  /** What the line costs today before any campaign: what counts towards a gift's amount. */
  valueMinor: number;
};

export type AppliedCampaign = { campaignId: string; name: string; kind: CampaignKind; offMinor: number };

export type CampaignResult = {
  /** Off each line, by key. */
  lineOff: Record<string, number>;
  /** Which campaign gave it first, by key. */
  lineBy: Record<string, string>;
  /** Every campaign that gave something on a line, in the order they were taken, by key. */
  lineParts: Record<string, { campaignId: string; name: string; minor: number }[]>;
  applied: AppliedCampaign[];
  /** Gifts the basket has earned; whether one is in stock is for the caller to say. */
  gifts: { campaignId: string; name: string; variantId: string; quantity: number }[];
  /** What the lines count after the reductions, for a gift's amount. */
  valueMinor: number;
  /** The campaign that makes the order's shipping free (D299 E3), if any; whether the order ships is for the caller to say. */
  freeShipping: { campaignId: string; name: string } | null;
  /** How far the next step of a campaign is (D299 E3), for the cart to say. */
  next: CampaignNext[];
};

/** How far a campaign's next step is: units or an amount (in the currency shown) still to add, and what it then gives. */
export type CampaignNext = {
  campaignId: string;
  name: string;
  kind: "tiered" | "amount" | "free_shipping";
  missingUnits: number | null;
  missingMinor: number | null;
  /** The percentage the next step gives (tiered). */
  percent: number | null;
  /** The amount it then takes off (amount). */
  offMinor: number | null;
};

/** Whether a campaign is on now: switched on and within its dates. */
export function campaignRunning(campaign: Pick<Campaign, "active" | "startsAt" | "endsAt">, now: Date): boolean {
  if (!campaign.active) return false;
  if (campaign.startsAt && new Date(campaign.startsAt) > now) return false;
  if (campaign.endsAt && new Date(campaign.endsAt) <= now) return false;
  return true;
}

/** Whether a campaign runs in a country: the ones it names, or every one when it names none. */
export const runsIn = (campaign: Pick<Campaign, "markets">, marketCode: string) => campaign.markets.length === 0 || campaign.markets.includes(marketCode);

/** Where a campaign stands today, for the admin's list. */
export function campaignStatus(campaign: Pick<Campaign, "active" | "startsAt" | "endsAt">, now = new Date()): "active" | "off" | "scheduled" | "ended" {
  if (!campaign.active) return "off";
  if (campaign.endsAt && new Date(campaign.endsAt) <= now) return "ended";
  if (campaign.startsAt && new Date(campaign.startsAt) > now) return "scheduled";
  return "active";
}

/** Whether a campaign reaches a line: its product is chosen, or is in a chosen category or tag; a campaign with no choice reaches everything. */
export function reaches(campaign: Pick<Campaign, "productIds" | "termIds">, line: Pick<CampaignLine, "productId" | "termIds">): boolean {
  if (campaign.productIds.length === 0 && campaign.termIds.length === 0) return true;
  return campaign.productIds.includes(line.productId) || line.termIds.some((id) => campaign.termIds.includes(id));
}

/** What a percentage off takes off a line: the lowered unit price, as a group's discount and a subscription's are, times the quantity. */
export function percentOff(unitMinor: number, quantity: number, percent: number): number {
  return (unitMinor - planPrice(unitMinor, percent)) * quantity;
}

/**
 * What "buy N pay for M" makes free: in every full group of N units, the
 * cheapest N − M, over all the lines it reaches together; and how many units
 * of each line that is.
 */
export function multiBuyFree(lines: Pick<CampaignLine, "key" | "unitMinor" | "quantity">[], buy: number, pay: number): { off: Record<string, number>; freed: Record<string, number> } {
  const units = lines
    .flatMap((line) => Array.from({ length: line.quantity }, () => ({ key: line.key, price: line.unitMinor })))
    .sort((a, b) => b.price - a.price);
  const off: Record<string, number> = {};
  const freed: Record<string, number> = {};
  const free = buy - pay;
  if (free <= 0 || buy < 2) return { off, freed };
  for (let start = 0; start + buy <= units.length; start += buy) {
    // Cheapest last: the group's last `free` units are the free ones.
    for (const unit of units.slice(start + buy - free, start + buy)) {
      if (unit.price > 0) {
        off[unit.key] = (off[unit.key] ?? 0) + unit.price;
        freed[unit.key] = (freed[unit.key] ?? 0) + 1;
      }
    }
  }
  return { off, freed };
}

/** What "buy N pay for M" makes free, per line. */
export const multiBuyOff = (lines: Pick<CampaignLine, "key" | "unitMinor" | "quantity">[], buy: number, pay: number): Record<string, number> => multiBuyFree(lines, buy, pay).off;

/** The steps of a tiered campaign a market has, lowest first: quantity steps everywhere, spend steps where they have an amount. */
export function tiersIn(campaign: Pick<Campaign, "tierBasis" | "tiers">, marketCode: string): { at: number; percent: number }[] {
  return campaign.tiers
    .map((tier) => ({ at: campaign.tierBasis === "quantity" ? (tier.quantity ?? 0) : (tier.amounts[marketCode] ?? 0), percent: tier.percent }))
    .filter((tier) => tier.at > 0)
    .sort((a, b) => a.at - b.at);
}

/** What a tiered campaign's steps count on these lines: their units, or what they come to before any reduction. */
export const tierCount = (campaign: Pick<Campaign, "tierBasis">, lines: Pick<CampaignLine, "unitMinor" | "quantity">[]): number =>
  lines.reduce((sum, line) => sum + (campaign.tierBasis === "quantity" ? line.quantity : line.unitMinor * line.quantity), 0);

/** The percentage the highest step reached gives (0 for none). */
export function tierPercent(campaign: Pick<Campaign, "tierBasis" | "tiers">, lines: Pick<CampaignLine, "unitMinor" | "quantity">[], marketCode: string): number {
  const count = tierCount(campaign, lines);
  return tiersIn(campaign, marketCode).reduce((best, tier) => (count >= tier.at ? Math.max(best, tier.percent) : best), 0);
}

/**
 * An amount split over lines by what each costs (D299 E3): the largest remainder rounding, an earlier line first on a tie, never
 * more than a line costs and never more in all than the lines come to.
 */
export function splitAmount(lines: Pick<CampaignLine, "key" | "unitMinor" | "quantity">[], amount: number): Record<string, number> {
  const worth = lines.map((line) => ({ key: line.key, value: line.unitMinor * line.quantity })).filter((line) => line.value > 0);
  const total = worth.reduce((sum, line) => sum + line.value, 0);
  const off: Record<string, number> = {};
  const take = Math.min(Math.max(0, Math.floor(amount)), total);
  if (take === 0) return off;
  const shares = worth.map((line, i) => {
    const exact = (take * line.value) / total;
    return { ...line, i, base: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = take - shares.reduce((sum, share) => sum + share.base, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (left <= 0) break;
    if (share.base < share.value) {
      share.base += 1;
      left -= 1;
    }
  }
  for (const share of shares) if (share.base > 0) off[share.key] = share.base;
  return off;
}

/** What the lines a campaign reaches come to, before any reduction. */
const worthOf = (lines: Pick<CampaignLine, "unitMinor" | "quantity">[]) => lines.reduce((sum, line) => sum + line.unitMinor * line.quantity, 0);

function priceOff(campaign: Campaign, lines: CampaignLine[], marketCode: string): Record<string, number> {
  const reached = lines.filter((line) => line.discountable && line.unitMinor > 0 && reaches(campaign, line));
  if (campaign.kind === "percent" || campaign.kind === "tiered") {
    const percent = campaign.kind === "percent" ? campaign.percent : tierPercent(campaign, reached, marketCode);
    const off: Record<string, number> = {};
    if (percent <= 0) return off;
    for (const line of reached) {
      const amount = percentOff(line.unitMinor, line.quantity, percent);
      if (amount > 0) off[line.key] = amount;
    }
    return off;
  }
  if (campaign.kind === "amount") {
    const amount = campaign.amounts[marketCode] ?? 0;
    const threshold = campaign.thresholds[marketCode] ?? 0;
    if (amount <= 0 || worthOf(reached) < threshold) return {};
    return splitAmount(reached, amount);
  }
  if (campaign.kind === "multi_buy") return multiBuyOff(reached, campaign.buyQuantity, campaign.payQuantity);
  return {};
}

/** Kinds that reduce prices, competing with each other for lines unless they stack. */
const PRICE_KINDS: readonly CampaignKind[] = ["percent", "multi_buy", "amount", "tiered"];

/**
 * What the running campaigns do to a basket. Price campaigns first, each
 * line by at most one, the one giving most to the lines still free winning
 * (ties go to the older campaign); then gifts, for the amount the lines come
 * to after the reductions.
 */
export function applyCampaigns(campaigns: Campaign[], lines: CampaignLine[], marketCode: string): CampaignResult {
  const result: CampaignResult = { lineOff: {}, lineBy: {}, lineParts: {}, applied: [], gifts: [], valueMinor: 0, freeShipping: null, next: [] };
  const ordered = [...campaigns].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let pending = ordered.filter((c) => PRICE_KINDS.includes(c.kind) && !c.stacks);
  let free = lines;
  // Units a "buy N pay for M" has made free, per line: a stacking one takes only what is left to pay for.
  const freed: Record<string, number> = {};
  while (pending.length > 0) {
    let best: { campaign: Campaign; off: Record<string, number>; total: number } | null = null;
    for (const campaign of pending) {
      const off = priceOff(campaign, free, marketCode);
      const total = Object.values(off).reduce((sum, amount) => sum + amount, 0);
      if (total > 0 && (!best || total > best.total)) best = { campaign, off, total };
    }
    if (!best) break;
    // A pool of lines share a "3 for 2", so all it reached is used up, whether or not a unit of each was free.
    const taken = new Set(
      best.campaign.kind !== "multi_buy"
        ? Object.keys(best.off)
        : free.filter((line) => line.discountable && line.unitMinor > 0 && reaches(best!.campaign, line)).map((line) => line.key),
    );
    if (best.campaign.kind === "multi_buy") {
      const reached = free.filter((line) => line.discountable && line.unitMinor > 0 && reaches(best!.campaign, line));
      Object.assign(freed, multiBuyFree(reached, best.campaign.buyQuantity, best.campaign.payQuantity).freed);
    }
    for (const [key, amount] of Object.entries(best.off)) {
      result.lineOff[key] = amount;
      result.lineBy[key] = best.campaign.id;
      result.lineParts[key] = [{ campaignId: best.campaign.id, name: best.campaign.name, minor: amount }];
    }
    result.applied.push({ campaignId: best.campaign.id, name: best.campaign.name, kind: best.campaign.kind, offMinor: best.total });
    free = free.filter((line) => !taken.has(line.key));
    pending = pending.filter((campaign) => campaign !== best!.campaign);
  }

  // What stacks comes off what is left, one campaign after another in the order they were made: a percentage
  // off the rest of each line it reaches, a "buy N pay for M" over the units still to be paid for.
  const take = (campaign: Campaign, line: CampaignLine, off: number) => {
    result.lineOff[line.key] = (result.lineOff[line.key] ?? 0) + off;
    result.lineBy[line.key] ??= campaign.id;
    (result.lineParts[line.key] ??= []).push({ campaignId: campaign.id, name: campaign.name, minor: off });
  };
  for (const campaign of ordered.filter((c) => c.stacks && (c.kind === "percent" || c.kind === "multi_buy" || c.kind === "tiered"))) {
    let total = 0;
    const reached = lines.filter((l) => l.discountable && l.unitMinor > 0 && reaches(campaign, l));
    if (campaign.kind === "percent" || campaign.kind === "tiered") {
      // A stacking tier counts the lines it reaches before any reduction.
      const percent = campaign.kind === "percent" ? campaign.percent : tierPercent(campaign, reached, marketCode);
      for (const line of reached) {
        const left = line.unitMinor * line.quantity - (result.lineOff[line.key] ?? 0);
        const off = left > 0 && percent > 0 ? left - planPrice(left, percent) : 0;
        if (off <= 0) continue;
        take(campaign, line, off);
        total += off;
      }
    } else {
      // Each unit still to be paid for costs what is left of its line, evenly.
      const pool = reached
        .map((line) => {
          const paying = line.quantity - (freed[line.key] ?? 0);
          const left = line.unitMinor * line.quantity - (result.lineOff[line.key] ?? 0);
          return { line, paying, left, price: paying > 0 ? left / paying : 0 };
        })
        .filter((entry) => entry.paying > 0 && entry.left > 0);
      const { freed: more } = multiBuyFree(
        pool.map((entry) => ({ key: entry.line.key, unitMinor: entry.price, quantity: entry.paying })),
        campaign.buyQuantity,
        campaign.payQuantity,
      );
      for (const entry of pool) {
        const n = more[entry.line.key] ?? 0;
        const off = n > 0 ? Math.round((entry.left * n) / entry.paying) : 0;
        if (off <= 0) continue;
        freed[entry.line.key] = (freed[entry.line.key] ?? 0) + n;
        take(campaign, entry.line, off);
        total += off;
      }
    }
    if (total > 0) result.applied.push({ campaignId: campaign.id, name: campaign.name, kind: campaign.kind, offMinor: total });
  }

  result.valueMinor = lines.reduce((sum, line) => sum + line.valueMinor - (result.lineOff[line.key] ?? 0), 0);
  for (const campaign of ordered.filter((c) => c.kind === "gift" && c.giftVariantId)) {
    const threshold = campaign.thresholds[marketCode];
    if (!(threshold > 0)) continue;
    const counted = lines.filter((line) => reaches(campaign, line)).reduce((sum, line) => sum + line.valueMinor - (result.lineOff[line.key] ?? 0), 0);
    if (counted >= threshold) {
      result.gifts.push({ campaignId: campaign.id, name: campaign.name, variantId: campaign.giftVariantId!, quantity: campaign.giftQuantity });
    }
  }
  // Free shipping (D299 E3): the oldest whose lines, after the reductions, come to its amount in this market (none asked: any basket).
  const counted = (campaign: Campaign) => lines.filter((line) => reaches(campaign, line)).reduce((sum, line) => sum + line.valueMinor - (result.lineOff[line.key] ?? 0), 0);
  for (const campaign of ordered.filter((c) => c.kind === "free_shipping")) {
    const reachedAny = lines.some((line) => reaches(campaign, line));
    if (reachedAny && counted(campaign) >= (campaign.thresholds[marketCode] ?? 0)) {
      result.freeShipping = { campaignId: campaign.id, name: campaign.name };
      break;
    }
  }
  result.next = nextSteps(ordered, lines, marketCode, result, counted);
  return result;
}

/**
 * How far each campaign's next step is (D299 E3): a tiered campaign's next step, an amount's or free shipping's threshold not yet
 * reached. Only where the basket has lines the campaign reaches and no other campaign holds them, so adding to them would give it.
 */
function nextSteps(campaigns: Campaign[], lines: CampaignLine[], marketCode: string, result: CampaignResult, counted: (c: Campaign) => number): CampaignNext[] {
  const next: CampaignNext[] = [];
  const own = (campaign: Campaign) => {
    const reached = lines.filter((line) => line.discountable && line.unitMinor > 0 && reaches(campaign, line));
    const free = reached.length > 0 && reached.every((line) => !result.lineBy[line.key] || result.lineBy[line.key] === campaign.id || campaign.stacks);
    return free ? reached : [];
  };
  for (const campaign of campaigns) {
    if (campaign.kind === "tiered") {
      const reached = own(campaign);
      if (reached.length === 0) continue;
      const count = tierCount(campaign, reached);
      const step = tiersIn(campaign, marketCode).find((tier) => tier.at > count);
      if (!step) continue;
      const quantity = campaign.tierBasis === "quantity";
      next.push({ campaignId: campaign.id, name: campaign.name, kind: "tiered", missingUnits: quantity ? step.at - count : null, missingMinor: quantity ? null : step.at - count, percent: step.percent, offMinor: null });
    } else if (campaign.kind === "amount") {
      const reached = own(campaign);
      const threshold = campaign.thresholds[marketCode] ?? 0;
      const amount = campaign.amounts[marketCode] ?? 0;
      if (reached.length === 0 || amount <= 0 || worthOf(reached) >= threshold) continue;
      next.push({ campaignId: campaign.id, name: campaign.name, kind: "amount", missingUnits: null, missingMinor: threshold - worthOf(reached), percent: null, offMinor: amount });
    }
  }
  if (!result.freeShipping) {
    // The nearest free shipping only: one row is enough.
    const near = campaigns
      .filter((c) => c.kind === "free_shipping" && (c.thresholds[marketCode] ?? 0) > 0 && lines.some((line) => reaches(c, line)))
      .map((c) => ({ campaign: c, missing: c.thresholds[marketCode] - counted(c) }))
      .filter((x) => x.missing > 0)
      .sort((a, b) => a.missing - b.missing)[0];
    if (near) next.push({ campaignId: near.campaign.id, name: near.campaign.name, kind: "free_shipping", missingUnits: null, missingMinor: near.missing, percent: null, offMinor: null });
  }
  return next;
}

/**
 * The buyer's group or company discount (D108) on a line a campaign has
 * already reduced: a percentage of what is left. A line without a campaign
 * is worked as before, from its unit price.
 */
export function memberOffAfterCampaign(unitMinor: number, quantity: number, campaignOff: number, percent: number): number {
  if (campaignOff === 0) return memberLineOff(unitMinor, quantity, percent);
  const left = unitMinor * quantity - campaignOff;
  return left - planPrice(left, percent);
}

/** What a campaign gives, in English for the admin: "20 % off", "3 for 2", "Free product over NOK 500.00". */
export function describeCampaign(
  campaign: Pick<Campaign, "kind" | "percent" | "buyQuantity" | "payQuantity" | "thresholds"> & Partial<Pick<Campaign, "amounts" | "tierBasis" | "tiers">>,
  money: (minor: number, marketCode: string) => string,
): string {
  const per = (values: Record<string, number>) => Object.entries(values).map(([market, minor]) => money(minor, market)).join(" / ");
  const over = per(campaign.thresholds);
  if (campaign.kind === "percent") return `${campaign.percent} % off`;
  if (campaign.kind === "multi_buy") return `${campaign.buyQuantity} for ${campaign.payQuantity}`;
  if (campaign.kind === "amount") return `${per(campaign.amounts ?? {}) || "An amount"} off${over ? ` over ${over}` : ""}`;
  if (campaign.kind === "free_shipping") return over ? `Free shipping over ${over}` : "Free shipping";
  if (campaign.kind === "tiered") {
    const steps = (campaign.tiers ?? []).map((tier) => `${tier.percent} % from ${campaign.tierBasis === "quantity" ? `${tier.quantity} items` : per(tier.amounts)}`);
    return steps.join(", ") || "Tiers";
  }
  return `Free product over ${over || "an amount"}`;
}

/** What shoppers read on a line of the cart for a campaign: its name. */
export const campaignLabel = (names: readonly string[]) => [...new Set(names)].join(", ");

// ---------------------------------------------------------------------------
// The admin's form
// ---------------------------------------------------------------------------

const whole = (min: number, max: number, message: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().int(message).min(min, message).max(max, message));

/** A campaign as the admin sends it; amounts are typed text, converted per market. */
export const campaignInput = z
  .object({
    name: z.string().trim().min(1, "Give the campaign a name shoppers will recognise.").max(CAMPAIGN_NAME_MAX, `Keep the name to ${CAMPAIGN_NAME_MAX} characters.`),
    kind: z.enum(CAMPAIGN_KINDS),
    percent: whole(1, 100, "Take off between 1 and 100 %.").default(10),
    buyQuantity: whole(2, MULTI_BUY_MAX, `Buy between 2 and ${MULTI_BUY_MAX} items.`).default(3),
    payQuantity: whole(1, MULTI_BUY_MAX, "Pay for at least 1 item.").default(2),
    giftVariantId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).default(null),
    giftQuantity: whole(1, GIFT_QUANTITY_MAX, `Give between 1 and ${GIFT_QUANTITY_MAX} of the product.`).default(1),
    thresholds: z.record(z.string(), z.string().trim()).default({}),
    /** What an amount campaign takes off, typed per market (D299 E3). */
    amounts: z.record(z.string(), z.string().trim()).default({}),
    /** A tiered campaign's basis and its steps, amounts typed per market. */
    tierBasis: z.enum(TIER_BASES).default("quantity"),
    tiers: z
      .array(
        z.object({
          quantity: z.preprocess((v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole items, please.").min(1, "A step asks for at least 1 item.").max(TIER_QUANTITY_MAX, `A step asks for at most ${TIER_QUANTITY_MAX} items.`).nullable()).default(null),
          amounts: z.record(z.string(), z.string().trim()).default({}),
          percent: whole(1, 100, "Each step takes off between 1 and 100 %."),
        }),
      )
      .max(TIERS_MAX, `Give at most ${TIERS_MAX} steps.`)
      .default([]),
    /** "all": everything in the store; "some": only the chosen products and the products in the chosen categories and tags. */
    scope: z.enum(["all", "some"]).default("all"),
    productIds: z.array(z.uuid()).default([]),
    termIds: z.array(z.uuid()).default([]),
    /** Customer groups it is for (D108); none for everyone. */
    tierIds: z.array(z.uuid()).default([]),
    /** Orders that may get it in all; empty for no limit. */
    usageLimit: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole orders, please.").min(1, "Allow at least one order, or no limit.").max(1_000_000).nullable()).default(null),
    /** Orders one signed-in customer may get it on; empty for no limit. */
    perCustomerLimit: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole orders, please.").min(1, "Allow at least one order each, or no limit.").max(1000).nullable()).default(null),
    /** The countries (market codes) it runs in; none for all. */
    markets: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
    /** A percentage or "buy N pay for M" also applied on top of other campaigns. */
    stacks: z.boolean().default(false),
    startsAt: z.string().trim().nullable().default(null),
    endsAt: z.string().trim().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((input) => input.kind !== "multi_buy" || input.payQuantity < input.buyQuantity, {
    message: "Shoppers must pay for fewer items than they buy: 3 for 2, not 2 for 3.",
  })
  .refine((input) => !input.stacks || input.kind !== "gift", { message: "A free product cannot be added on top of other campaigns: it is given whatever else applies." })
  .refine((input) => !input.stacks || (input.kind !== "amount" && input.kind !== "free_shipping"), {
    message: "An amount off or free shipping cannot be added on top of other campaigns.",
  })
  .refine((input) => input.kind !== "tiered" || input.tiers.length >= TIERS_MIN, { message: `Give at least ${TIERS_MIN} steps.` })
  .refine((input) => input.kind !== "tiered" || input.tierBasis !== "quantity" || input.tiers.every((tier) => tier.quantity !== null), {
    message: "Say how many items each step asks for.",
  })
  .refine((input) => input.kind !== "gift" || input.giftVariantId !== null, { message: "Choose the product to give." })
  .refine((input) => input.scope === "all" || input.productIds.length + input.termIds.length > 0, {
    message: "Choose at least one product, category or tag, or let the campaign apply to everything.",
  })
  .refine((input) => !input.startsAt || !input.endsAt || new Date(input.startsAt) < new Date(input.endsAt), {
    message: "The campaign must end after it starts.",
  });

export type CampaignInput = z.input<typeof campaignInput>;
