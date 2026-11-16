import { z } from "zod";

import { DELAY_RANGES, FOLLOW_UP_DAYS, type AutomationKind, type LifecycleKind } from "./automation-kinds";
import { broadcastContentSchema, type BroadcastContent } from "./broadcasts";

export * from "./automation-kinds";

/**
 * Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6): the owner's settings as the editor sends them, and the staff's words for
 * each kind. Server and admin only (zod); the shopper's form has its own plain check (`isRequestAddress()` in `stock-request-check.ts`).
 */

/** How far back a moment may be and still start an email (6.2): an older one is old news. */
export const CATCH_UP_DAYS = 7;
/** Emails per kind per run (6.2). */
export const AUTOMATION_BATCH = 200;
/** An order this many days after an automation's email counts as following it (D4 of `docs/100-day-challenge.md`). */
export const ORDER_AFTER_DAYS = 7;
/** How long sends are kept (6.7): longer than any key needs. */
export const SENDS_KEEP_DAYS = 90;

/** A back-in-stock request (6.4 and 6.5). */
export const STOCK_CONFIRM_DAYS = 7;
export const STOCK_WAITING_DAYS = 180;
export const STOCK_ENDED_DAYS = 30;
/** Requests a visitor key makes per store and day, and open confirmations an address has per store. */
export const STOCK_VISITOR_DAY = 10;
export const STOCK_PENDING_MAX = 5;

export const isLifecycle = (kind: string): kind is LifecycleKind => kind in DELAY_RANGES;

/** A lifecycle automation as the editor saves it: its days within the kind's range and its words (a broadcast's shape). */
export function automationInput(kind: LifecycleKind) {
  const range = DELAY_RANGES[kind];
  return z.object({
    delayDays: z.number().int().min(range.min).max(range.max),
    content: broadcastContentSchema,
  });
}

/** A follow-up as the editor saves it (D653): its days after the email before and its words. */
export const followUpInput = z.object({
  delayDays: z.number().int().min(FOLLOW_UP_DAYS.min).max(FOLLOW_UP_DAYS.max),
  content: broadcastContentSchema,
});

/** Products shown to each reader of a cross-sell or restock email (D653), and how many are read to find them. */
export const PICKS_SHOWN = 3;

/** What each kind is, in the staff's words (6.6): what the owner gets, then what the days mean. */
export const AUTOMATION_WORDS: Record<AutomationKind, { title: string; does: string; days?: (n: number) => string; daysLabel?: string }> = {
  welcome: {
    title: "Welcome",
    does: "Welcomes people who join your list.",
    daysLabel: "Days after they join",
    days: (n) => (n === 0 ? "Sent as soon as they join." : `Sent ${n} ${n === 1 ? "day" : "days"} after they join.`),
  },
  after_purchase: {
    title: "After a purchase",
    does: "Thanks people on your list after their order is delivered.",
    daysLabel: "Days after delivery",
    days: (n) => `Sent ${n} ${n === 1 ? "day" : "days"} after the order is delivered.`,
  },
  win_back: {
    title: "Win-back",
    does: "Writes to people on your list who have not ordered for a while.",
    daysLabel: "Days without an order",
    days: (n) => `Sent when ${n} days have passed since their last order.`,
  },
  cross_sell: {
    title: "Goes well with",
    does: "Shows people on your list products that go well with what they bought, chosen for each from what other customers bought together.",
    daysLabel: "Days after delivery",
    days: (n) => `Sent ${n} ${n === 1 ? "day" : "days"} after the order is delivered.`,
  },
  replenish: {
    title: "Time to restock",
    does: "Reminds people on your list to order again the products customers buy more than once.",
    daysLabel: "Days after delivery",
    days: (n) => `Sent ${n} ${n === 1 ? "day" : "days"} after the order is delivered.`,
  },
  browse: {
    title: "Still thinking about it?",
    does: "Shows signed-in customers on your list the products they looked at and did not buy, only for those who allowed marketing cookies (D691).",
    daysLabel: "Days after they looked",
    days: (n) => `Sent ${n} ${n === 1 ? "day" : "days"} after they last looked.`,
  },
  back_in_stock: {
    title: "Back in stock",
    does: "Lets shoppers ask to hear when a sold-out product is back, and emails them once when it is.",
  },
};

/** A product chosen for one reader (D653): its id and address, as the email's product block takes them. */
export type ProductPick = { id: string; handle: string };

/**
 * The words with one reader's products in them (D653): a product block for each pick, in every language, before the first button (else at
 * the end). Code draws each product's title, picture and price in the reader's market when the email is made (`EmailFacts`); a product the
 * market no longer offers is left out there.
 */
export function withPicks(content: BroadcastContent, picks: readonly ProductPick[]): BroadcastContent {
  if (picks.length === 0) return content;
  const blocks = picks.map((p) => ({ type: "product" as const, product: p.id, handle: p.handle, label: "" }));
  return Object.fromEntries(
    Object.entries(content).map(([locale, c]) => {
      const at = c.blocks.findIndex((b) => b.type === "button");
      const where = at === -1 ? c.blocks.length : at;
      return [locale, { ...c, blocks: [...c.blocks.slice(0, where), ...blocks, ...c.blocks.slice(where)] }];
    }),
  );
}

/** A send's key for one of an automation's emails (D653): the first's key as it was, a follow-up's with `#{step}`. */
export const stepKey = (firstKey: string, step: number): string => (step === 1 ? firstKey : `${firstKey}#${step}`);
