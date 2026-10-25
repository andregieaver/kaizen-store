import { z } from "zod";

import type { GateCategory } from "./owner-tools";

/**
 * How far the autopilot may go on its own (D309, `docs/ai-autopilot.md` 7.4): the owner's level per area and their budgets. Only calls that
 * wait for a yes in a person's own turn (gated calls) meet these rules; everything else runs as it does for the person. Pure: the one rule
 * `autonomyDecision()`, with the facts it needs (a price change's size, a discount's depth, the month's AI cost) read first.
 */

export const AUTONOMY_AREAS = ["catalogue", "website", "design", "setup", "marketing", "messages", "money"] as const;
export type AutonomyArea = (typeof AUTONOMY_AREAS)[number];

export const AUTONOMY_LEVELS = ["ask", "tell", "auto"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** The area of every gated call the autopilot may make without a yes, at the owner's level. */
export const TOOL_AREAS: Readonly<Record<string, AutonomyArea>> = {
  // Catalogue
  update_product: "catalogue",
  set_prices: "catalogue",
  set_product_status: "catalogue",
  update_category: "catalogue",
  archive_product: "catalogue",
  set_stock: "catalogue",
  set_backorder: "catalogue",
  create_field_group: "catalogue",
  set_fields: "catalogue",
  // Website
  set_header_footer: "website",
  publish_page: "website",
  set_page_place: "website",
  save_menu: "website",
  unpublish_page: "website",
  add_redirect: "website",
  start_experiment: "website",
  stop_experiment: "website",
  apply_winner: "website",
  set_recommendations: "website",
  add_recommendation_rule: "website",
  remove_recommendation_rule: "website",
  // Design: a theme that costs money always waits (`costsMoney`)
  make_theme_live: "design",
  // Setup
  set_store_details: "setup",
  set_countries: "setup",
  set_languages: "setup",
  set_currencies: "setup",
  set_flat_shipping: "setup",
  save_shipping_method: "setup",
  connect_domain: "setup",
  // Marketing
  create_discount: "marketing",
  set_discount_active: "marketing",
  create_campaign: "marketing",
  set_campaign_active: "marketing",
  set_bonus_program: "marketing",
  set_affiliate_program: "marketing",
  send_broadcast: "marketing",
  switch_email_automation: "marketing",
  // Messages to customers and staff
  mark_order_sent: "messages",
  send_draft_order: "messages",
  cancel_booking: "messages",
  approve_return: "messages",
  decline_return: "messages",
  email_customer: "messages",
  resend_order_email: "messages",
  issue_work_invoice: "messages",
  propose_exchange: "messages",
  reply_to_support: "messages",
  post_to_slack: "messages",
  // Money
  block_affiliate: "money",
};

/**
 * Always kept for a yes, whatever the level: who works in the store, domains and their DNS, refunds and other money out, the plan with
 * Kaizena Flow, features, opening the store, and the platform's access requests and referral program. Every gated tool is here or in
 * `TOOL_AREAS` (`autopilot-autonomy.test.ts`).
 */
export const NEVER_AUTOMATIC: ReadonlySet<string> = new Set([
  "invite_staff",
  "change_staff_role",
  "remove_staff",
  "change_dns",
  "set_up_email",
  "verify_domain_for",
  "undo_dns_change",
  "switch_nameservers",
  "set_domain_renewal",
  "buy_domain",
  "renew_domain",
  "refund_order",
  "change_order",
  "process_exchange",
  "adjust_customer_credits",
  "issue_gift_card",
  "change_plan",
  "end_plan",
  "set_feature",
  "open_store",
  "approve_access_request",
  "decline_access_request",
  "set_referral_program",
  "contact_kaizen_support",
  "start_autopilot_plan",
  "resume_autopilot_plan",
]);

/** Gate categories that are never automatic, for a tool added later without an area. */
const NEVER_CATEGORIES: ReadonlySet<GateCategory> = new Set(["access", "domain", "plan"]);

/** Whether a plan a review made waits for the owner's yes or starts at once (D328). */
export const PLAN_STARTS = ["ask", "auto"] as const;
export type PlanStarts = (typeof PLAN_STARTS)[number];

export const autonomySettingsSchema = z.object({
  paused: z.boolean().default(false),
  levels: z.partialRecord(z.enum(AUTONOMY_AREAS), z.enum(AUTONOMY_LEVELS)).default({}),
  budgets: z
    .object({
      /** The autopilot's AI cost a calendar month (UTC), in US dollars, as D145 prices every call; null: no limit of its own. */
      aiMonthlyUsd: z.number().min(0).max(100_000).nullable().default(5),
      /** The deepest discount or campaign it may make without a yes, in percent. */
      discountPercent: z.number().int().min(0).max(100).default(20),
      /** The largest change of a variant's price it may make without a yes, in percent of the price now. */
      priceChangePercent: z.number().int().min(0).max(1000).default(10),
    })
    .default({ aiMonthlyUsd: 5, discountPercent: 20, priceChangePercent: 10 }),
  /** Whether and how it keeps working toward the goals once a plan ends (D328, `docs/ai-autopilot.md` 12.1). */
  planning: z
    .object({
      /** *Keep working toward my goals*: off, no goal is reviewed and stores behave as before. */
      continues: z.boolean().default(false),
      /** A review's plan waits for the owner's yes (`ask`) or starts at once (`auto`). */
      starts: z.enum(PLAN_STARTS).default("ask"),
      /** Days after its last review a goal is looked at again when nothing else brought it up. */
      reviewDays: z.number().int().min(1).max(30).default(7),
      /** Plans a review may start itself in seven days; past it a plan waits for a yes. */
      plansPerWeek: z.number().int().min(1).max(20).default(3),
    })
    .default({ continues: false, starts: "ask", reviewDays: 7, plansPerWeek: 3 }),
});
export type AutonomySettings = z.output<typeof autonomySettingsSchema>;

export const DEFAULT_AUTONOMY: AutonomySettings = autonomySettingsSchema.parse({});

/** Settings as stored, read safely: anything unreadable falls back to the defaults (ask for everything). */
export function readAutonomy(raw: unknown): AutonomySettings {
  const parsed = autonomySettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_AUTONOMY;
}

export const levelOf = (settings: AutonomySettings, area: AutonomyArea): AutonomyLevel => settings.levels[area] ?? "ask";

/** What the code read for a call before deciding: a price change's size, a discount's depth (percent), whether a theme costs money. */
export type AutonomyFacts = { priceChangePercent?: number | null; discountPercent?: number | null; costsMoney?: boolean | null };

export type AutonomyDecision = { run: true; tell: boolean; area: AutonomyArea } | { run: false; why: string };

/**
 * Whether the autopilot may make a gated call itself (`run`, telling the owner afterwards when their level is *Do it and tell me*) or must
 * keep it for their yes, with the reason in words.
 */
export function autonomyDecision(settings: AutonomySettings, tool: string, gate: GateCategory, facts: AutonomyFacts = {}): AutonomyDecision {
  if (NEVER_AUTOMATIC.has(tool) || NEVER_CATEGORIES.has(gate)) return { run: false, why: "This always waits for your yes." };
  const area = TOOL_AREAS[tool];
  if (!area) return { run: false, why: "This always waits for your yes." };
  const level = levelOf(settings, area);
  if (level === "ask") return { run: false, why: `Your autonomy setting for ${AREA_WORDS[area].toLowerCase()} is Ask me first.` };
  if (tool === "set_prices") {
    if (facts.priceChangePercent === undefined || facts.priceChangePercent === null) return { run: false, why: "The price change could not be measured." };
    if (facts.priceChangePercent > settings.budgets.priceChangePercent) {
      return { run: false, why: `It changes a price by ${round(facts.priceChangePercent)} %, more than your limit of ${settings.budgets.priceChangePercent} %.` };
    }
  }
  // A premium theme the store does not have is money out: never without a yes, whatever the level (D308).
  if (tool === "make_theme_live") {
    if (facts.costsMoney === undefined || facts.costsMoney === null) return { run: false, why: "What the theme costs could not be read." };
    if (facts.costsMoney) return { run: false, why: "This theme costs money, which always waits for your yes." };
  }
  if (tool === "create_discount" || tool === "create_campaign") {
    if (facts.discountPercent === undefined || facts.discountPercent === null) return { run: false, why: "How deep the offer goes could not be measured." };
    if (facts.discountPercent > settings.budgets.discountPercent) {
      return { run: false, why: `It takes ${round(facts.discountPercent)} % off, more than your limit of ${settings.budgets.discountPercent} %.` };
    }
  }
  return { run: true, tell: level === "tell", area };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** How deep a discount or campaign goes, in percent of the price, from its arguments; null when it cannot be said. */
export function discountDepth(tool: string, args: Record<string, unknown>): number | null {
  if (tool === "create_discount") return args.kind === "free_shipping" ? 0 : typeof args.percent === "number" ? args.percent : 10;
  if (tool === "create_campaign") {
    if (args.kind === "percent") return typeof args.percent === "number" ? args.percent : null;
    if (args.kind === "multi_buy" && typeof args.buy_quantity === "number" && typeof args.pay_quantity === "number" && args.buy_quantity > 0) {
      return ((args.buy_quantity - args.pay_quantity) / args.buy_quantity) * 100;
    }
    // A free product over an amount: its worth against the basket is not known here, so it always asks.
    return null;
  }
  return null;
}

/**
 * The largest change of any price, in percent of the price now: each country's new price against the variant's current one (both read
 * with the currency's own minor units). A price taken away counts as 100 %, a new price where none was as no change.
 */
export function largestPriceChange(
  current: readonly { sku: string; prices: Readonly<Record<string, string>> }[],
  changes: readonly { sku: string; prices: Readonly<Record<string, string>> }[],
  currencyOf: (market: string) => string | null,
  parsePrice: (text: string, currency: string) => number | null,
): number | null {
  let largest = 0;
  for (const change of changes) {
    const before = current.find((v) => v.sku.toLowerCase() === change.sku.toLowerCase());
    if (!before) return null;
    for (const [market, text] of Object.entries(change.prices)) {
      const currency = currencyOf(market);
      if (!currency) return null;
      const old = before.prices[market] ? parsePrice(before.prices[market], currency) : null;
      if (text.trim() === "") {
        if (old !== null) largest = Math.max(largest, 100);
        continue;
      }
      const next = parsePrice(text, currency);
      if (next === null) return null;
      if (old === null || old === 0) continue;
      largest = Math.max(largest, (Math.abs(next - old) / old) * 100);
    }
  }
  return largest;
}

export const AREA_WORDS: Record<AutonomyArea, string> = {
  catalogue: "Products",
  website: "Website",
  design: "Design",
  setup: "Store setup",
  marketing: "Marketing",
  messages: "Messages to customers",
  money: "Money",
};

export const LEVEL_WORDS: Record<AutonomyLevel, string> = { ask: "Ask me first", tell: "Do it and tell me", auto: "Just do it" };
