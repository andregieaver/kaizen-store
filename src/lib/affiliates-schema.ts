import { z } from "zod";

import { AFFILIATE_COOKIE_DAYS_MAX, AFFILIATE_FRIEND_PERCENT_MAX, AFFILIATE_REWARD_BPS_MAX } from "./affiliates";

/**
 * The schemas of `affiliates.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

export const affiliateSettingsInput = z.object({
  enabled: z.boolean(),
  rewardBps: z.number().int().min(0, "The reward cannot be below 0%.").max(AFFILIATE_REWARD_BPS_MAX, `Keep the reward at ${AFFILIATE_REWARD_BPS_MAX / 100}% or less.`),
  rewardOrders: z.number().int().min(1).max(100).nullable(),
  friendPercent: z.number().int().min(0).max(AFFILIATE_FRIEND_PERCENT_MAX, `Keep the friend's discount at ${AFFILIATE_FRIEND_PERCENT_MAX}% or less.`),
  friendMaxMinor: z.number().int().min(0).max(100_000_000).nullable(),
  monthlyCapMinor: z.number().int().min(0).max(1_000_000_000).nullable(),
  cookieDays: z.number().int().min(1).max(AFFILIATE_COOKIE_DAYS_MAX),
});
