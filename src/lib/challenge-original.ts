import { z } from "zod";

/**
 * One period of the original store's signed P&L in the 100-day challenge (`docs/100-day-challenge.md` 3.3, E7), kept with the challenge
 * (`challengeSchema.original`) and compared on the scoreboard (`src/lib/challenge-scoreboard.ts`). Its own file so the challenge's schema
 * and the scoreboard both read it without importing each other.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.");
const minor = z.number().int().min(0).max(100_000_000_000);

/** One period of the original store's signed P&L, in minor units of its currency, without VAT. */
export const originalPeriodSchema = z
  .object({
    from: day,
    to: day,
    currency: z.string().regex(/^[A-Z]{3}$/, "A currency is three letters."),
    netSalesMinor: minor,
    cogsMinor: minor,
    shippingMinor: minor.default(0),
    paymentFeesMinor: minor.default(0),
    marketingMinor: minor.default(0),
    /** Every other cost that grows with sales (packaging, handling, the platform's fees, apps): one figure. */
    otherMinor: minor.default(0),
    /** Sessions counted the same way as the clone's (visitor-days), null when the original has none to give. */
    sessions: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    orders: z.number().int().min(0).max(100_000_000).nullable().default(null),
    signedBy: z.string().trim().min(1, "Name who signed the P&L.").max(120),
    signedOn: day,
  })
  .refine((p) => p.from <= p.to, { path: ["to"], message: "A period ends on or after it starts." });
export type OriginalPeriod = z.output<typeof originalPeriodSchema>;
