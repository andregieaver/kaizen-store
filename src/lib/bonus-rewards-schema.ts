import { z } from "zod";

import { REWARD_KINDS, REWARD_NAME_MAX } from "./bonus-rewards";

/** The shape a reward is saved in (D401), for the Bonus page's save; apart from `bonus-rewards.ts` so the shopper's pages load no zod (D211). */
export const rewardInput = z
  .object({
    name: z.string().trim().min(1, "Name the reward.").max(REWARD_NAME_MAX, `Keep the name to ${REWARD_NAME_MAX} characters.`),
    names: z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string().trim().max(REWARD_NAME_MAX)).default({}),
    costMinor: z.int().min(1, "A reward costs at least some credits.").max(100_000_000),
    kind: z.enum(REWARD_KINDS),
    productId: z.uuid().nullable().default(null),
    amounts: z.record(z.string().regex(/^[A-Z]{2}$/), z.int().min(1).max(100_000_000)).default({}),
    active: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "product" && !r.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Choose the product given free." });
    if (r.kind === "amount" && Object.keys(r.amounts).length === 0) ctx.addIssue({ code: "custom", path: ["amounts"], message: "Give the amount off in at least one country." });
  });

export type RewardInput = z.infer<typeof rewardInput>;
