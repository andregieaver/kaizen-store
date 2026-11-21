import { z } from "zod";

import { DOCUMENT_LINES_MAX, DOCUMENT_UNITS_MAX } from "./stock-documents";

/**
 * The schemas of stock-documents.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; stock-documents.ts imports it as a type alone.
 */

const sku = z.string().trim().min(1, "Give each line's SKU.").max(64, "A SKU is at most 64 characters.");
const units = z.coerce.number("Write the number of units.").int("Write whole units.").min(1, "Each line moves at least one unit.").max(DOCUMENT_UNITS_MAX, "That is more units than a line holds.");
const note = z.string().trim().max(500, "A note is at most 500 characters.").optional().transform((v) => (v ? v : null));

const uniqueSkus = <T extends { sku: string }>(lines: T[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const [i, line] of lines.entries()) {
    const key = line.sku.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["lines", i, "sku"], message: `${line.sku} is on two lines: put its units on one.` });
    seen.add(key);
  }
};

export const transferInput = z
  .object({
    origin: z.uuid("Choose where the stock leaves from."),
    destination: z.uuid("Choose where the stock goes."),
    note,
    lines: z.array(z.object({ sku, quantity: units })).min(1, "Add at least one line.").max(DOCUMENT_LINES_MAX, `A transfer holds at most ${DOCUMENT_LINES_MAX} lines.`),
  })
  .superRefine((input, ctx) => {
    if (input.origin === input.destination) ctx.addIssue({ code: "custom", path: ["destination"], message: "Stock moves to another location than the one it leaves." });
    uniqueSkus(input.lines, ctx);
  });

export const purchaseOrderInput = z
  .object({
    supplier: z.string().trim().min(1, "Name the supplier.").max(120, "A supplier's name is at most 120 characters."),
    reference: z.string().trim().max(60, "A reference is at most 60 characters.").optional().transform((v) => (v ? v : null)),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Choose the currency the supplier bills in."),
    location: z.uuid("Choose where the stock arrives."),
    expectedOn: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Write the expected date as a date."),
    note,
    lines: z
      .array(z.object({ sku, quantity: units, unitCost: z.string().trim().min(1, "Give what one unit costs.").max(20) }))
      .min(1, "Add at least one line.")
      .max(DOCUMENT_LINES_MAX, `A purchase order holds at most ${DOCUMENT_LINES_MAX} lines.`),
  })
  .superRefine((input, ctx) => uniqueSkus(input.lines, ctx));

export const receiptInput = z.object({
  lines: z
    .array(z.object({ variantId: z.uuid(), quantity: z.coerce.number().int().min(0).max(DOCUMENT_UNITS_MAX) }))
    .max(DOCUMENT_LINES_MAX),
});
