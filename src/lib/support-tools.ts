import { z } from "zod";

import { CUSTOMER_ACTION_KINDS, DETAILS_MAX, STAFF_REQUEST_KINDS } from "./support-actions";
import { AI_REASON_MAX } from "./support-rules";

/**
 * The tools the support AI is given beyond the chat's own (D216, `docs/support.md` 4.3a), as names, descriptions, inputs and
 * what each needs. `needs` is checked by the server before a handler runs (step 9), never by the model. Kaizen's desk has its
 * own list. The handlers are `src/server/support-tools.ts`.
 */

export type ToolNeeds = {
  /** A signed-in customer of the conversation; order tools also check the order is theirs. */
  signedIn?: true;
  /** The shop is on, or the customer has orders (after-sale help goes on). */
  shopOrAfterSale?: true;
  /** The shop is on. */
  shop?: true;
  /** The desk takes an email for follow-up. */
  emailFollowup?: true;
  /** Any of these store features is on, or the customer already has such things. */
  feature?: readonly string[];
};

export type SupportTool<I extends z.ZodType = z.ZodType> = { name: string; description: string; input: I; needs: ToolNeeds };

const supportTool = <I extends z.ZodType>(name: string, description: string, input: I, needs: ToolNeeds = {}): SupportTool<I> => ({
  name,
  description,
  input,
  needs,
});

const nothing = z.object({});
const why = z.object({ why: z.string().trim().min(1).max(200).describe("In a few words, why you ask.") });
const orderNumber = z.string().trim().min(1).max(64).describe("The order's number, as the customer gives it, such as 1042.");

export const SUPPORT_TOOLS = [
  supportTool(
    "handoff_to_human",
    "Hand the conversation to a person from the store. Use it when the customer asks for a person, is upset, or you could not help after two tries. Write your reply first; the hand-over happens after it.",
    z.object({ reason: z.string().trim().min(1).max(AI_REASON_MAX).describe("For the staff: what the customer needs, in one sentence.") }),
  ),
  supportTool("ask_to_sign_in", "Show the customer a sign-in form (an emailed code). Needed before you can look at their orders.", why, { shopOrAfterSale: true }),
  supportTool("ask_for_email", "Show the customer a form to leave their email, so the store can answer later.", why, { emailFollowup: true }),
  supportTool("my_orders", "The signed-in customer's last orders: number, date, status and total.", nothing, { signedIn: true, shopOrAfterSale: true }),
  supportTool(
    "order_details",
    "One of the signed-in customer's orders: lines, totals, payment, parcels and tracking, returns, invoices and bookings.",
    z.object({ number: orderNumber }),
    { signedIn: true, shopOrAfterSale: true },
  ),
  supportTool(
    "return_options",
    "What the signed-in customer can still withdraw from or return in an order, and until when, with the withdrawal page.",
    z.object({ number: orderNumber }),
    { signedIn: true, shopOrAfterSale: true },
  ),
  supportTool("my_bookings", "The signed-in customer's upcoming bookings, and whether each can still be changed.", nothing, {
    signedIn: true,
    feature: ["appointments", "bookings"],
  }),
  supportTool("my_subscriptions", "The signed-in customer's subscriptions, and what can be changed in each.", nothing, {
    signedIn: true,
    feature: ["subscriptions"],
  }),
  supportTool("my_boxes", "The signed-in customer's subscription boxes and their next round.", nothing, { signedIn: true, feature: ["boxes"] }),
  supportTool("bonus_balance", "The signed-in customer's bonus credits.", nothing, { signedIn: true, feature: ["bonus"] }),
  supportTool(
    "check_code",
    "Whether a discount code works for the customer's cart, and what it gives.",
    z.object({ code: z.string().trim().min(1).max(64) }),
    { shop: true },
  ),
  supportTool(
    "propose_action",
    "Propose something the signed-in customer can do themselves; it does nothing until the customer presses Confirm. Use ids from the other tools. Kinds and their args: booking.cancel {bookingId}; booking.move {bookingId, startsAt (ISO time with offset)}; subscription.pause {subscriptionId, periods 1-3}; subscription.skip, subscription.cancel, subscription.resume, subscription.unpause {subscriptionId}; box.skip {listId, date (one of upcomingDates)}; box.pause, box.resume {listId}; order.resend_confirmation, order.resend_shipped {orderNumber}; return.request {orderNumber, lines: [{lineId, quantity}]} for lines whose `can` is return (never a withdrawal: give the withdrawal page).",
    z.object({ kind: z.enum(CUSTOMER_ACTION_KINDS as [string, ...string[]]), args: z.record(z.string(), z.unknown()) }),
    { signedIn: true },
  ),
  supportTool(
    "request_staff_action",
    "Ask a person at the store to decide something you may not do: a refund, cancelling a paid order, changing an address, an exception, or anything else.",
    z.object({
      kind: z.enum(STAFF_REQUEST_KINDS as [string, ...string[]]),
      number: orderNumber.optional(),
      details: z.string().trim().min(1).max(DETAILS_MAX).describe("For the staff: what the customer asks for and why, in their words."),
    }),
  ),
] as const;

/** Kaizen's desk: the first line for Kaizen's visitors, and for owners and staff asking from the admin. */
export const KAIZEN_SUPPORT_TOOLS = [
  SUPPORT_TOOLS[0],
  supportTool("my_stores", "The stores of the person asking (only in a conversation from the admin): name, open or not, plan.", nothing),
  supportTool(
    "store_status",
    "The state of one of the asker's stores: open or not, plan, card payments ready, setup steps left, features on.",
    z.object({ store: z.string().trim().min(1).max(64).describe("The store's address name (slug).") }),
  ),
  supportTool("find_admin_page", "Find the admin page that does something, as a link.", z.object({ query: z.string().trim().min(1).max(200) })),
] as const;

export type SupportToolName = (typeof SUPPORT_TOOLS)[number]["name"];

/**
 * A return's exchange as the support tools tell the AI (D239, `docs/wave-3-exchanges.md` 2.6): the state only, in words for the model to put in the
 * customer's language. Never a price or a difference (the customer's own exchange page and emails say those), and no action: the AI never proposes,
 * confirms or pays an exchange (no kind in `CUSTOMER_ACTIONS`).
 */
export const EXCHANGE_STATE_WORDS: Record<string, string> = {
  proposed: "The store has proposed an exchange: the customer confirms or declines it from the link in the email the store sent.",
  confirmed: "The customer confirmed the exchange: the store will process it.",
  processed: "The exchange order is made and waits for the customer to pay the difference, from the link in the email the store sent.",
  settled: "Exchanged: the replacement goods are a new order.",
  declined_by_customer: "The customer declined the exchange: the return is refunded instead.",
  cancelled: "The exchange was cancelled: the return is refunded instead.",
  expired: "The exchange was not confirmed in time: the return is refunded instead.",
  superseded: "The return was refunded instead of exchanged.",
};

/** The words for an exchange's status; a draft (staff's own, not sent) or an unknown status says nothing. */
export const exchangeStateWords = (status: string | null | undefined): string | null =>
  status && status !== "draft" && Object.hasOwn(EXCHANGE_STATE_WORDS, status) ? EXCHANGE_STATE_WORDS[status] : null;
