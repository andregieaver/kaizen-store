import { z } from "zod";

import { REFERRAL_COMMISSION_BPS_MAX, REFERRAL_COOKIE_DAYS_MAX, REFERRAL_MONTHS_MAX, REFERRAL_PENDING_DAYS_MAX } from "./referrals";

/**
 * The schemas of `referrals.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

export const referralSettingsInput = z.object({
  enabled: z.boolean(),
  commissionBps: z.number().int().min(0, "Commission cannot be below 0%.").max(REFERRAL_COMMISSION_BPS_MAX, `Keep commission at ${REFERRAL_COMMISSION_BPS_MAX / 100}% or less.`),
  months: z.number().int().min(1, "At least 1 month.").max(REFERRAL_MONTHS_MAX, `Keep it at ${REFERRAL_MONTHS_MAX} months or less.`),
  pendingDays: z.number().int().min(0).max(REFERRAL_PENDING_DAYS_MAX),
  cookieDays: z.number().int().min(1).max(REFERRAL_COOKIE_DAYS_MAX),
});
