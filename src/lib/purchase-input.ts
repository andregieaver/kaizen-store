import { z } from "zod";

/**
 * What the AI manager asks to buy with the AI wallet (D599, `docs/agent-spending.md` 5): the arguments of `request_purchase`, apart from
 * `card-wallet.ts` so the tool catalogue needs no server module. Pure.
 */

/** What the AI asks to buy, as the tool takes it. The amount is typed in the wallet's currency; the owner reads every word before a yes. */
export const purchaseInput = z.object({
  what: z.string().trim().min(3).max(200).describe("What is bought, in a few words, such as 'Stock photo licence, 10 pictures'."),
  merchant: z.string().trim().min(2).max(120).describe("Who sells it, by name."),
  url: z
    .string()
    .trim()
    .max(500)
    .regex(/^https:\/\/[^\s]+$/, "Give the merchant's page as an https:// address.")
    .optional()
    .describe("The merchant's page for it (https://), so the owner can look before saying yes."),
  amount: z.string().trim().min(1).max(20).describe("The most it may cost, VAT, shipping and fees included, in the wallet's currency, such as 249 or 249.50."),
  why: z.string().trim().max(500).default("").describe("Why it is needed, in a sentence the owner reads."),
});
export type PurchaseInput = z.output<typeof purchaseInput>;
