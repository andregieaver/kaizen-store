import { z } from "zod";

import type { DocumentLanguage } from "./invoice-text";
import { ORDER_LANGUAGES, ORDER_METHODS, isCountryCode } from "./drop-shipping";

/**
 * The schemas of drop-shipping.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; drop-shipping.ts imports it as a type alone.
 */

const trimmed = (max: number, words: string) => z.string().trim().max(max, words);

export const supplierInput = z.object({
  name: z.string().trim().min(1, "Give the supplier a name.").max(120, "A name is at most 120 characters."),
  orderEmail: z.string().trim().toLowerCase().max(254, "Check the email address.").regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Check the email address."),
  shipsFrom: z.string().trim().toUpperCase().refine(isCountryCode, "Choose the country it ships from."),
  orderLanguage: z.enum(ORDER_LANGUAGES as [DocumentLanguage, ...DocumentLanguage[]]).default("en"),
  dispatchDays: z.coerce.number().int("Whole days.").min(1, "Between 1 and 30 days.").max(30, "Between 1 and 30 days.").default(2),
  orderMethod: z.enum(ORDER_METHODS).default("email"),
  /** Where returns of its goods go (D562): all five parts, so a carrier can make the label, or none for the store's own address. */
  returnName: trimmed(120, "A name is at most 120 characters.").default(""),
  returnStreet: trimmed(200, "A street is at most 200 characters.").default(""),
  returnPostalCode: trimmed(20, "A postal code is at most 20 characters.").default(""),
  returnCity: trimmed(100, "A city is at most 100 characters.").default(""),
  returnCountry: z.string().trim().toUpperCase().default(""),
  orderNote: trimmed(500, "A note is at most 500 characters.").default(""),
  /** Its stock is kept topped up (D553): for a supplier that always has the goods. */
  alwaysAvailable: z.union([z.boolean(), z.literal("on"), z.literal("")]).transform((v) => v === true || v === "on").default(false),
})
  .superRefine((v, ctx) => {
    const parts = [v.returnName, v.returnStreet, v.returnPostalCode, v.returnCity, v.returnCountry];
    if (parts.every((p) => p === "")) return;
    if (parts.some((p) => p === "")) ctx.addIssue({ code: "custom", path: ["returnStreet"], message: "Fill in the whole return address, or leave all of it empty." });
    else if (!isCountryCode(v.returnCountry)) ctx.addIssue({ code: "custom", path: ["returnCountry"], message: "Choose the return address's country." });
  })
  .transform(({ returnName, returnStreet, returnPostalCode, returnCity, returnCountry, ...rest }) => ({
    ...rest,
    returnTo: returnStreet ? { name: returnName, street: returnStreet, postalCode: returnPostalCode, city: returnCity, country: returnCountry } : null,
  }));
