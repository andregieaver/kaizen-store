import { z } from "zod";

import { ACTION_MINUTES } from "./support-rules";

/**
 * What the AI may set in motion for a support conversation (D216, `docs/support.md` 4.4). A **customer action** is self-service
 * the customer could do themselves: the AI only proposes it, and it runs when the customer presses Confirm, with the customer's
 * own authority, through the existing function (which checks everything again). A **staff request** is anything else: a person
 * decides it. Never an action: a withdrawal (the AI links the withdrawal page), a refund, a code or credit, an order edit.
 * Each kind's arguments are checked by its schema here; the server runs it (`src/server/support-actions.ts`, step 10).
 */

const id = z.uuid();
const orderNumber = z.string().trim().min(1).max(64);

export const CUSTOMER_ACTIONS = {
  "booking.cancel": z.object({ bookingId: id }),
  "booking.move": z.object({ bookingId: id, startsAt: z.iso.datetime({ offset: true }) }),
  "subscription.pause": z.object({ subscriptionId: id, periods: z.number().int().min(1).max(3) }),
  "subscription.skip": z.object({ subscriptionId: id }),
  "subscription.cancel": z.object({ subscriptionId: id }),
  "subscription.resume": z.object({ subscriptionId: id }),
  "subscription.unpause": z.object({ subscriptionId: id }),
  "box.skip": z.object({ listId: id, date: z.iso.date() }),
  "box.pause": z.object({ listId: id }),
  "box.resume": z.object({ listId: id }),
  "order.resend_confirmation": z.object({ orderNumber }),
  "order.resend_shipped": z.object({ orderNumber }),
  "return.request": z.object({ orderNumber, lines: z.array(z.object({ lineId: id, quantity: z.number().int().min(1).max(999) })).min(1).max(50) }),
} as const;

export type CustomerActionKind = keyof typeof CUSTOMER_ACTIONS;
export const CUSTOMER_ACTION_KINDS = Object.keys(CUSTOMER_ACTIONS) as CustomerActionKind[];

export const STAFF_REQUESTS = {
  refund: z.object({ orderNumber }),
  cancel_order: z.object({ orderNumber }),
  change_address: z.object({ orderNumber }),
  exception: z.object({ orderNumber: orderNumber.optional() }),
  other: z.object({ orderNumber: orderNumber.optional() }),
} as const;

export type StaffRequestKind = keyof typeof STAFF_REQUESTS;
export const STAFF_REQUEST_KINDS = Object.keys(STAFF_REQUESTS) as StaffRequestKind[];

/** Every kind a `support_actions` row may hold. */
export const ACTION_KINDS = [...CUSTOMER_ACTION_KINDS, ...STAFF_REQUEST_KINDS] as const;

export const isCustomerAction = (kind: string): kind is CustomerActionKind => Object.hasOwn(CUSTOMER_ACTIONS, kind);
export const isStaffRequest = (kind: string): kind is StaffRequestKind => Object.hasOwn(STAFF_REQUESTS, kind);

/** A kind's arguments, checked; null when the kind is unknown or the arguments do not fit it. */
export function readActionArgs(kind: string, args: unknown): Record<string, unknown> | null {
  const schema = isCustomerAction(kind) ? CUSTOMER_ACTIONS[kind] : isStaffRequest(kind) ? STAFF_REQUESTS[kind] : null;
  if (!schema) return null;
  const parsed = schema.safeParse(args);
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

/** When a proposal made at `at` stops being confirmable; staff requests do not expire. */
export const actionExpiry = (kind: string, at: Date): Date | null =>
  isCustomerAction(kind) ? new Date(at.getTime() + ACTION_MINUTES * 60_000) : null;

export const DETAILS_MAX = 500;
