import { z } from "zod";

import { parsePrice } from "./product-input";

/**
 * Stock transfers and purchase orders (wave 11 unit D, D383): what a person sends to make one, and the rules that hold whatever writes them.
 * The database moves a document only forward (`stock_documents_rules()`) and its lines only as a draft or, once out, their received count
 * up (`stock_document_lines_rules()`); the stock itself moves only through `src/server/stock-transfers.ts` and `src/server/purchase-orders.ts`.
 */

export const DOCUMENT_LINES_MAX = 200;
export const DOCUMENT_UNITS_MAX = 1_000_000;

export const TRANSFER_STATUSES = ["draft", "sent", "received", "cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const PURCHASE_ORDER_STATUSES = ["draft", "ordered", "received", "cancelled"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** What a list shows: a document out of draft that has had some, not all, of its units in is partly received. */
export type DocumentState = "draft" | "open" | "partly_received" | "received" | "cancelled";

export type DocumentLine = { quantity: number; received: number };

export function documentState(status: TransferStatus | PurchaseOrderStatus, lines: readonly DocumentLine[]): DocumentState {
  if (status === "draft" || status === "received" || status === "cancelled") return status;
  return lines.some((l) => l.received > 0) ? "partly_received" : "open";
}

/** Units still to come in: what was sent or ordered and not received. */
export const unitsToCome = (lines: readonly DocumentLine[]): number => lines.reduce((sum, l) => sum + Math.max(0, l.quantity - l.received), 0);

/** Every line received in full. */
export const allIn = (lines: readonly DocumentLine[]): boolean => lines.length > 0 && lines.every((l) => l.received >= l.quantity);

/**
 * What a receipt takes: for each line asked, at most what is still to come (a figure above it is cut to it, never refused, as a count of
 * a parcel that holds what was sent), lines not on the document and zeros left out.
 */
export function receiptPlan(lines: readonly (DocumentLine & { variantId: string })[], asked: readonly { variantId: string; quantity: number }[]): { variantId: string; quantity: number }[] {
  const left = new Map(lines.map((l) => [l.variantId, Math.max(0, l.quantity - l.received)]));
  const plan = new Map<string, number>();
  for (const a of asked) {
    const room = (left.get(a.variantId) ?? 0) - (plan.get(a.variantId) ?? 0);
    const take = Math.min(Math.max(0, Math.floor(a.quantity)), room);
    if (take > 0) plan.set(a.variantId, (plan.get(a.variantId) ?? 0) + take);
  }
  return [...plan].map(([variantId, quantity]) => ({ variantId, quantity }));
}

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
export type TransferInput = z.infer<typeof transferInput>;

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
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInput>;

/** A unit cost as typed, in minor units of the order's currency; null when it cannot be read or is out of range. */
export function unitCostMinor(text: string, currency: string): number | null {
  const minor = parsePrice(text, currency);
  return minor === null || minor < 0 || minor > 100_000_000_000 ? null : minor;
}

export const receiptInput = z.object({
  lines: z
    .array(z.object({ variantId: z.uuid(), quantity: z.coerce.number().int().min(0).max(DOCUMENT_UNITS_MAX) }))
    .max(DOCUMENT_LINES_MAX),
});
