/**
 * The numbers of sending in parts, editing an order after purchase and pick lists (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 4.1).
 * One module so a limit is one reviewed change: `fulfilment-limits.test.ts` pins every value, the database rules of `fulfilment_rules` use the
 * same numbers (`src/db/fulfilment.test.ts` holds the two together), and the screens say them out loud.
 * Pure: no server import, no zod (the change pay page, a pay route, reaches these).
 */
import { BULK_PRINT_MAX, DRAFT_PRICE_MAX_MINOR, DRAFT_QUANTITY_MAX } from "./order-limits";

/** How long a pay link for an order change is valid, in days (D173's draft default; Shopify does not say). */
export const EDIT_PAY_DAYS = 7;
/** Added lines in one edit. */
export const EDIT_ADDED_LINES_MAX = 50;
/** Units of one added line (D173's draft limit). */
export const EDIT_QUANTITY_MAX = DRAFT_QUANTITY_MAX;
/** The most one added unit can cost, as a draft's (keeps every sum exact in a JavaScript number). */
export const EDIT_PRICE_MAX_MINOR = DRAFT_PRICE_MAX_MINOR;
/** Edits of one order, whatever became of them (an abuse and sanity brake; the database's `order_edits_rules()` holds it). */
export const EDITS_PER_ORDER_MAX = 20;
/** Staff's note on an edit, in characters (kept only in the history event's `data.note`). */
export const EDIT_NOTE_MAX = 500;
/** Presses of an edit's pay button an hour: per edit and per store (`chat_usage` buckets `edit:pay:{id}` and `edit:pay`). */
export const EDIT_PAY_PRESSES_PER_HOUR = 20;
export const EDIT_PAY_PRESSES_PER_HOUR_STORE = 600;
/** How many times one edit's pay link can be emailed in a day (`edit:send:{id}`). */
export const EDIT_SENDS_PER_DAY = 5;
/** Orders on one pick list, and on one printed document of packing slips (D173's `BULK_PRINT_MAX`; Shopify's Order Printer prints 50). */
export const PICK_LIST_MAX = BULK_PRINT_MAX;
