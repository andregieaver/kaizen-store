import { z } from "zod";

import { CREATOR_CATEGORIES_MAX, CREATOR_MAX_BPS } from "./creators";

/** The programme's settings as the owner saves them (D386); the category ids are checked against the store's on the server. */
export const creatorSettingsInput = z.object({
  enabled: z.boolean(),
  commissionBps: z.int().min(0).max(CREATOR_MAX_BPS),
  categoryBps: z
    .record(z.uuid(), z.int().min(0).max(CREATOR_MAX_BPS))
    .refine((value) => Object.keys(value).length <= CREATOR_CATEGORIES_MAX, `At most ${CREATOR_CATEGORIES_MAX} categories.`),
  cookieDays: z.int().min(1).max(90),
});

/** An application from a signed-in customer: their public name, their channel and the consent, ticked. */
export const creatorApplicationInput = z.object({
  name: z.string().trim().min(1).max(80),
  channelUrl: z.string().trim().min(1).max(300),
  consent: z.literal(true),
});

/** A payout the owner made outside Kaizena Flow, recorded in the currency it was owed in. */
export const creatorPayoutInput = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: z.int().min(1).max(10_000_000_000),
  paidOn: z.iso.date(),
  reference: z.string().trim().max(120),
});
