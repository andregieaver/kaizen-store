import { z } from "zod";

import { COPY_IDS_MAX, COPY_NAME_MAX } from "./store-copy";

/**
 * The schemas of store-copy.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; store-copy.ts imports it as a type alone.
 */

const selection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("selected"), ids: z.array(z.uuid()).max(COPY_IDS_MAX) }),
]);

export const storeCopyOptions = z
  .object({
    pages: selection,
    products: selection,
    posts: selection,
    customers: z.boolean(),
    orders: z.boolean(),
    confirmDataUse: z.boolean(),
    emailTexts: z.boolean().optional(),
  })
  .superRefine((options, ctx) => {
    if ((options.customers || options.orders) && !options.confirmDataUse) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmDataUse"],
        message: "Confirm that you may use this customer data in the new store.",
      });
    }
  });

/** What the wizard sends to start a copy. */
export const storeCopyInput = z.object({
  /** The store copied, by address; the account must own it. */
  source: z.string().min(1).max(60),
  name: z.string().trim().min(1, "Enter a store name.").max(COPY_NAME_MAX),
  /** The new store's address; made from the name when empty. */
  slug: z.string().trim().max(40).default(""),
  options: storeCopyOptions,
});
export type StoreCopyInput = z.infer<typeof storeCopyInput>;
