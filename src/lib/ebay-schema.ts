import { z } from "zod";

import { isEbayMarketplace } from "./ebay";

/**
 * The schemas of ebay.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; ebay.ts imports it as a type alone.
 */

/** What eBay asks every offer to name, set by the owner from their eBay seller account (Business policies, a location, a category). */
export const ebaySettingsInput = z.object({
  marketplace: z.string().refine(isEbayMarketplace, "Choose a marketplace."),
  fulfillmentPolicyId: z.string().trim().regex(/^\d{3,20}$/, "The shipping policy's number from eBay."),
  paymentPolicyId: z.string().trim().regex(/^\d{3,20}$/, "The payment policy's number from eBay."),
  returnPolicyId: z.string().trim().regex(/^\d{3,20}$/, "The return policy's number from eBay."),
  merchantLocationKey: z.string().trim().regex(/^[A-Za-z0-9_-]{1,36}$/, "The key of your location at eBay (letters, digits, - and _)."),
  categoryId: z.string().trim().regex(/^\d{1,10}$/, "An eBay category number."),
});
export type EbaySettings = z.infer<typeof ebaySettingsInput>;

const amount = z.object({ value: z.string().optional(), currency: z.string().optional() }).partial();

export const ebayOrderSchema = z.object({
  orderId: z.string().min(1).max(100),
  creationDate: z.string(),
  cancelStatus: z.object({ cancelState: z.string().optional() }).partial().optional(),
  pricingSummary: z.object({ total: amount.optional() }).partial().optional(),
  buyer: z.object({ username: z.string().optional(), buyerRegistrationAddress: z.object({ email: z.string().optional(), fullName: z.string().optional() }).partial().optional() }).partial().optional(),
  fulfillmentStartInstructions: z
    .array(
      z.object({
        shippingStep: z
          .object({
            shipTo: z
              .object({
                fullName: z.string().optional(),
                companyName: z.string().optional(),
                email: z.string().optional(),
                primaryPhone: z.object({ phoneNumber: z.string().optional() }).partial().optional(),
                contactAddress: z
                  .object({ addressLine1: z.string(), addressLine2: z.string(), city: z.string(), postalCode: z.string(), countryCode: z.string(), stateOrProvince: z.string() })
                  .partial()
                  .optional(),
              })
              .partial()
              .optional(),
          })
          .partial()
          .optional(),
      }).partial(),
    )
    .optional(),
  lineItems: z.array(z.object({ lineItemId: z.string(), sku: z.string().optional(), title: z.string().optional(), quantity: z.number().int().positive(), total: amount.optional() })).default([]),
});
export type EbayOrder = z.infer<typeof ebayOrderSchema>;
