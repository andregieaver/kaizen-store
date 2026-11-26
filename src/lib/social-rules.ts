/**
 * *Post on its own within my rules* (D870 S3.3, `docs/social-manager.md` 6): the owner's switch and limits, and the one rule that says whether a
 * post may go out without a person's yes. Off by default. While it is on, the posting queue approves and queues each Instagram, Facebook and
 * Pinterest post whose picture passed the vision check, that no person held back, and whose product is still on sale and in stock, at most
 * `postsPerDay` a day on a channel and never in the quiet hours. Switching it off hands every post the rules queued back to a person. Pure; the
 * server is `src/server/social-rules.ts`.
 */

import { z } from "zod";

import { addDays } from "./analytics-period";
import { zonedTime } from "./booking-slots";
import { checkFailed } from "./social-vision";

/** The most posts a day on one channel the rules may put out (the queue's own cap, `DAY_POSTS_MAX`, holds everything). */
export const RULE_POSTS_MAX = 10;

const hour = z.number().int().min(0).max(23);

/** What the owner's form sends. */
export const socialRulesInput = z.object({
  on: z.boolean(),
  postsPerDay: z.number().int().min(1).max(RULE_POSTS_MAX).default(1),
  quietFrom: hour.default(21),
  quietTo: hour.default(8),
});

export const socialRulesSchema = socialRulesInput.extend({
  on: z.boolean().default(false),
  /** Who switched it on: the queue posts as them, while they are still the store's owner. */
  by: z.uuid().nullable().default(null),
});
export type SocialRules = z.output<typeof socialRulesSchema>;

export const DEFAULT_SOCIAL_RULES: SocialRules = socialRulesSchema.parse({});

/** The rules as stored, read safely: anything unreadable is off. */
export function readSocialRules(raw: unknown): SocialRules {
  const parsed = socialRulesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_SOCIAL_RULES;
}

/** The hour of the day in the store's time. */
export function localHour(now: Date, timeZone: string): number {
  return Number(now.toLocaleString("en-GB", { timeZone, hour: "2-digit", hour12: false })) % 24;
}

/** Whether an hour falls in the quiet hours (from `quietFrom` up to `quietTo`, across midnight when it is earlier); equal hours: none. */
export function inQuietHours(h: number, rules: Pick<SocialRules, "quietFrom" | "quietTo">): boolean {
  const { quietFrom: from, quietTo: to } = rules;
  if (from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** When the quiet hours end, in the store's time: the next `quietTo` o'clock; null when it is not quiet now. */
export function quietEnds(now: Date, timeZone: string, rules: Pick<SocialRules, "quietFrom" | "quietTo">): Date | null {
  if (!inQuietHours(localHour(now, timeZone), rules)) return null;
  const at = `${String(rules.quietTo).padStart(2, "0")}:00`;
  const today = now.toLocaleDateString("sv-SE", { timeZone });
  const end = new Date(zonedTime(today, at, timeZone));
  return end.getTime() > now.getTime() ? end : new Date(zonedTime(addDays(today, 1), at, timeZone));
}

/** What the rules read of a post: its vision check, whether a person held it back, and its product's state (null: it has none). */
export type RulePost = {
  checked: boolean;
  problems: readonly string[];
  held: boolean;
  product: { active: boolean; canBuy: boolean } | null;
};

/** Why a post may not go out by the rules, in words, or null when it may. */
export function rulesProblem(post: RulePost): string | null {
  if (post.held) return "A person took it off the queue: it waits for their yes.";
  if (!post.checked) return "Its picture has not been checked yet.";
  if (checkFailed(post.problems)) return "The picture check found a problem with it.";
  if (post.product && !post.product.active) return "Its product is not on sale in the shop.";
  if (post.product && !post.product.canBuy) return "Its product is sold out.";
  return null;
}
