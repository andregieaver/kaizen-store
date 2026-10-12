import { z } from "zod";

import { BONUS_EARN_BPS_MAX, BONUS_EXPIRY_MONTHS_MAX, BONUS_PENDING_DAYS_MAX, BONUS_REDEEM_PERCENT_MAX } from "./bonus";

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
});
