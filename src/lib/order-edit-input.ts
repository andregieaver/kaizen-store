/**
 * What the order editor sends (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): the new quantities of the order's lines, the products added (a
 * price only when staff typed one: absent means the market's list price as shown), the shipping, the reason and its note, and the switches. Checked here
 * and again by the server, which prices it with `priceOrderEdit()` (`src/lib/order-edit.ts`) and refuses what the order cannot take. Shared with the admin's
 * editor (not with any pay route, so zod is fine here).
 */
import { z } from "zod";

import { MANUAL_PAYMENT_METHODS } from "./draft-input";
import { EDIT_ADDED_LINES_MAX, EDIT_NOTE_MAX, EDIT_PRICE_MAX_MINOR, EDIT_QUANTITY_MAX } from "./fulfilment-limits";
import { ORDER_EDIT_REASONS } from "./order-edit-status";

const minor = z.number().int().min(0).max(EDIT_PRICE_MAX_MINOR);

export const orderEditInput = z.object({
  /** New quantities of lines of the order, by line id (absent: unchanged; 0: taken off). A kept line only goes down (`priceOrderEdit()` refuses more). */
  quantities: z.record(z.uuid(), z.number().int().min(0).max(EDIT_QUANTITY_MAX)).default({}),
  added: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.number().int().min(1).max(EDIT_QUANTITY_MAX),
        /** A custom price staff typed for one unit, VAT included, in the order's currency; null or absent is the market's list price as shown. */
        unitPriceMinor: minor.nullish(),
      }),
    )
    .max(EDIT_ADDED_LINES_MAX)
    .default([]),
  shipping: z.discriminatedUnion("kind", [z.object({ kind: z.literal("keep") }), z.object({ kind: z.literal("set"), amountMinor: minor })]).default({ kind: "keep" }),
  reason: z.enum(ORDER_EDIT_REASONS),
  /** Staff's note: kept only in the history event's `data.note` (the erasure removes it); never shown to the customer. */
  note: z.string().trim().max(EDIT_NOTE_MAX).optional(),
  /** Tell the customer (it cannot be off for a change that asks for money or takes units off: the server turns it on then). */
  notify: z.boolean().default(true),
  /** Put the units taken off back in stock (where they came from). */
  restock: z.boolean().default(true),
  /** Variants whose units taken off are NOT put back (damaged goods), when `restock` is on. */
  noRestock: z.array(z.uuid()).max(EDIT_ADDED_LINES_MAX * 4).default([]),
  /** The order as the preview read it (`PricedEditPreview.base`): applying refuses `changed` when the order moved since. */
  base: z.unknown().optional(),
});
export type OrderEditInput = z.infer<typeof orderEditInput>;

/** Recording a change's difference as paid outside Kaizen (D173's rule and fields). */
export const editPaidOutsideInput = z.object({
  method: z.enum(MANUAL_PAYMENT_METHODS),
  receivedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v))
    .optional(),
  reference: z.string().trim().max(200).optional(),
});
export type EditPaidOutsideInput = z.infer<typeof editPaidOutsideInput>;
