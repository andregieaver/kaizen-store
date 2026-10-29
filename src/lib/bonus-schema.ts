import { z } from "zod";

import { BONUS_EARN_BPS_MAX, BONUS_EXPIRY_MONTHS_MAX, BONUS_PENDING_DAYS_MAX, BONUS_REDEEM_PERCENT_MAX } from "./bonus";
import { BONUS_LEVEL_NAME_MAX, BONUS_LEVELS_MAX, BONUS_SIGNUP_MAX_MINOR, levelsProblem } from "./bonus-levels";

/**
 * The schemas of `bonus.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

export const bonusSettingsInput = z.object({
  enabled: z.boolean(),
  earnBps: z.number().int().min(0, "Credits back cannot be below 0%.").max(BONUS_EARN_BPS_MAX, `Keep credits back at ${BONUS_EARN_BPS_MAX / 100}% or less.`),
  pendingDays: z.number().int().min(0).max(BONUS_PENDING_DAYS_MAX, `Keep the wait at ${BONUS_PENDING_DAYS_MAX} days or less.`),
  maxRedeemPercent: z.number().int().min(1, "Allow at least 1% of an order.").max(BONUS_REDEEM_PERCENT_MAX, `Keep the most at ${BONUS_REDEEM_PERCENT_MAX}% so the order still has something to pay.`),
  minRedeemMinor: z.number().int().min(0).max(1_000_000),
  expiresMonths: z.number().int().min(1).max(BONUS_EXPIRY_MONTHS_MAX).nullable(),
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Name each level.").max(BONUS_LEVEL_NAME_MAX, `Keep a level's name to ${BONUS_LEVEL_NAME_MAX} characters.`),
        fromMinor: z.number().int().min(1, "A level starts above nothing spent."),
        earnBps: z.number().int().min(1).max(BONUS_EARN_BPS_MAX, `Keep credits back at ${BONUS_EARN_BPS_MAX / 100}% or less.`),
      }),
    )
    .max(BONUS_LEVELS_MAX, `At most ${BONUS_LEVELS_MAX} levels.`)
    .default([]),
  signupMinor: z.number().int().min(0).max(BONUS_SIGNUP_MAX_MINOR).default(0),
}).superRefine((s, ctx) => {
  const problem = levelsProblem(s.levels, s.earnBps, BONUS_EARN_BPS_MAX);
  if (problem === "order") ctx.addIssue({ code: "custom", path: ["levels"], message: "Each level starts above the one before it." });
  if (problem === "rate_order") ctx.addIssue({ code: "custom", path: ["levels"], message: "Each level gives more back than the program's own rate and the level before it." });
});
