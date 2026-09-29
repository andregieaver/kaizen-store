import { z } from "zod";

import { memberLineOff } from "./customer-tiers";
import { planPrice } from "./subscriptions";

/**
 * Campaigns (D114): offers a store runs for a time, that shoppers need no
 * code for. Three kinds: a percentage off, "buy N pay for M" (3 for 2), and a
 * free product once the basket comes to an amount. Each can be limited to
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

export const CAMPAIGN_KINDS = ["percent", "multi_buy", "gift"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

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
  /** What it applies to: these products and every product in these categories and tags; with neither, everything. */
  productIds: string[];
  termIds: string[];
  /** Only customers in one of these customer groups (D108, their company's too); none for everyone. */
  tierIds: string[];
  /** Orders that may get it in all; null for no limit. */
  usageLimit: number | null;
  /** A percentage that also applies on top of other campaigns, instead of competing with them. */
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
};

/** Whether a campaign is on now: switched on and within its dates. */
export function campaignRunning(campaign: Pick<Campaign, "active" | "startsAt" | "endsAt">, now: Date): boolean {
  if (!campaign.active) return false;
  if (campaign.startsAt && new Date(campaign.startsAt) > now) return false;
  if (campaign.endsAt && new Date(campaign.endsAt) <= now) return false;
  return true;
}

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

/** What "buy N pay for M" makes free: in every full group of N units, the cheapest N − M, over all the lines it reaches together. */
export function multiBuyOff(lines: Pick<CampaignLine, "key" | "unitMinor" | "quantity">[], buy: number, pay: number): Record<string, number> {
  const units = lines
    .flatMap((line) => Array.from({ length: line.quantity }, () => ({ key: line.key, price: line.unitMinor })))
    .sort((a, b) => b.price - a.price);
  const off: Record<string, number> = {};
  const free = buy - pay;
  if (free <= 0 || buy < 2) return off;
  for (let start = 0; start + buy <= units.length; start += buy) {
    // Cheapest last: the group's last `free` units are the free ones.
    for (const unit of units.slice(start + buy - free, start + buy)) {
      if (unit.price > 0) off[unit.key] = (off[unit.key] ?? 0) + unit.price;
    }
  }
  return off;
}

function priceOff(campaign: Campaign, lines: CampaignLine[]): Record<string, number> {
  const reached = lines.filter((line) => line.discountable && line.unitMinor > 0 && reaches(campaign, line));
  if (campaign.kind === "percent") {
    const off: Record<string, number> = {};
    for (const line of reached) {
      const amount = percentOff(line.unitMinor, line.quantity, campaign.percent);
      if (amount > 0) off[line.key] = amount;
    }
    return off;
  }
  return multiBuyOff(reached, campaign.buyQuantity, campaign.payQuantity);
}

/**
 * What the running campaigns do to a basket. Price campaigns first, each
 * line by at most one, the one giving most to the lines still free winning
 * (ties go to the older campaign); then gifts, for the amount the lines come
 * to after the reductions.
 */
export function applyCampaigns(campaigns: Campaign[], lines: CampaignLine[], marketCode: string): CampaignResult {
  const result: CampaignResult = { lineOff: {}, lineBy: {}, lineParts: {}, applied: [], gifts: [], valueMinor: 0 };
  const ordered = [...campaigns].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let pending = ordered.filter((c) => c.kind !== "gift" && !c.stacks);
  let free = lines;
  while (pending.length > 0) {
    let best: { campaign: Campaign; off: Record<string, number>; total: number } | null = null;
    for (const campaign of pending) {
      const off = priceOff(campaign, free);
      const total = Object.values(off).reduce((sum, amount) => sum + amount, 0);
      if (total > 0 && (!best || total > best.total)) best = { campaign, off, total };
    }
    if (!best) break;
    // A pool of lines share a "3 for 2", so all it reached is used up, whether or not a unit of each was free.
    const taken = new Set(
      best.campaign.kind === "percent"
        ? Object.keys(best.off)
        : free.filter((line) => line.discountable && line.unitMinor > 0 && reaches(best!.campaign, line)).map((line) => line.key),
    );
    for (const [key, amount] of Object.entries(best.off)) {
      result.lineOff[key] = amount;
      result.lineBy[key] = best.campaign.id;
      result.lineParts[key] = [{ campaignId: best.campaign.id, name: best.campaign.name, minor: amount }];
    }
    result.applied.push({ campaignId: best.campaign.id, name: best.campaign.name, kind: best.campaign.kind, offMinor: best.total });
    free = free.filter((line) => !taken.has(line.key));
    pending = pending.filter((campaign) => campaign !== best!.campaign);
  }

  // A percentage that stacks comes off what is left of each line it reaches, one campaign after another.
  for (const campaign of ordered.filter((c) => c.kind === "percent" && c.stacks)) {
    let total = 0;
    for (const line of lines.filter((l) => l.discountable && l.unitMinor > 0 && reaches(campaign, l))) {
      const left = line.unitMinor * line.quantity - (result.lineOff[line.key] ?? 0);
      const off = left > 0 ? left - planPrice(left, campaign.percent) : 0;
      if (off <= 0) continue;
      result.lineOff[line.key] = (result.lineOff[line.key] ?? 0) + off;
      result.lineBy[line.key] ??= campaign.id;
      (result.lineParts[line.key] ??= []).push({ campaignId: campaign.id, name: campaign.name, minor: off });
      total += off;
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
  return result;
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
  campaign: Pick<Campaign, "kind" | "percent" | "buyQuantity" | "payQuantity" | "thresholds">,
  money: (minor: number, marketCode: string) => string,
): string {
  if (campaign.kind === "percent") return `${campaign.percent} % off`;
  if (campaign.kind === "multi_buy") return `${campaign.buyQuantity} for ${campaign.payQuantity}`;
  const over = Object.entries(campaign.thresholds).map(([market, minor]) => money(minor, market));
  return `Free product over ${over.join(" / ") || "an amount"}`;
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
    /** "all": everything in the store; "some": only the chosen products and the products in the chosen categories and tags. */
    scope: z.enum(["all", "some"]).default("all"),
    productIds: z.array(z.uuid()).default([]),
    termIds: z.array(z.uuid()).default([]),
    /** Customer groups it is for (D108); none for everyone. */
    tierIds: z.array(z.uuid()).default([]),
    /** Orders that may get it in all; empty for no limit. */
    usageLimit: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole orders, please.").min(1, "Allow at least one order, or no limit.").max(1_000_000).nullable()).default(null),
    /** A percentage also applied on top of other campaigns. */
    stacks: z.boolean().default(false),
    startsAt: z.string().trim().nullable().default(null),
    endsAt: z.string().trim().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((input) => input.kind !== "multi_buy" || input.payQuantity < input.buyQuantity, {
    message: "Shoppers must pay for fewer items than they buy: 3 for 2, not 2 for 3.",
  })
  .refine((input) => !input.stacks || input.kind === "percent", { message: "Only a percentage off can be added on top of other campaigns." })
  .refine((input) => input.kind !== "gift" || input.giftVariantId !== null, { message: "Choose the product to give." })
  .refine((input) => input.scope === "all" || input.productIds.length + input.termIds.length > 0, {
    message: "Choose at least one product, category or tag, or let the campaign apply to everything.",
  })
  .refine((input) => !input.startsAt || !input.endsAt || new Date(input.startsAt) < new Date(input.endsAt), {
    message: "The campaign must end after it starts.",
  });

export type CampaignInput = z.input<typeof campaignInput>;
