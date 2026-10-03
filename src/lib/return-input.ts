import { z } from "zod";

import {
  DEFAULT_RETURN_SETTINGS,
  MAX_INSTRUCTIONS,
  MAX_REASON_NOTE,
  MAX_TRANSIT_DAYS,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  RETURN_REASONS,
} from "./withdrawal";

/**
 * What the withdrawal function, the return request, the returns queue and the return settings send (D153,
 * `docs/returns.md`), shared by the browser (which builds it) and the server (which checks it again before anything is
 * written, `productInput`-style). Money is integer minor units, never text.
 *
 * The shoppers' inputs (`withdrawalStart`, `withdrawalConfirm`, `returnRequest`) fail with a **code** as the message
 * (`required`, `email`, `too_long`, `lines`, `quantity`, `reason`): the shopper's screens write the sentence in their own
 * language. The staff inputs and the settings fail in plain English (the admin is English only).
 */

const required = (max: number) => z.string().trim().min(1, "required").max(max, "too_long");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .nullish()
    .transform((value) => value || null);
const quantity = z.number("quantity").int("quantity").min(1, "quantity").max(10_000, "quantity");
const uuid = z.uuid("unknown");

export const reasonInput = z.enum(RETURN_REASONS, "reason");
/** A reason chosen from the list, or none: a withdrawal never needs one. */
const optionalReason = reasonInput.nullish().transform((value) => value ?? null);

// --- The shopper -------------------------------------------------------------

const declaredLine = z.object({ lineId: uuid, quantity });
const declaredLines = z
  .array(declaredLine)
  .min(1, "lines")
  .max(200, "lines")
  .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length, "lines");

/** An order number as typed: spaces and case are the shopper's, the server matches without them. */
const orderNumber = required(40);
const email = z.string().trim().toLowerCase().min(1, "required").max(254, "too_long").pipe(z.email("email"));

/**
 * Step 1 of the withdrawal button: the statement. No reason is asked. `orderKey` is the order page's own key when the
 * shopper came from it (the number alone is never the key); a signed-in customer's own orders need no email.
 */
export const withdrawalStart = z.object({
  orderNumber,
  email,
  name: required(120),
  lines: declaredLines,
  orderKey: optionalText(200),
});
export type WithdrawalStart = z.infer<typeof withdrawalStart>;

/** Step 2: the confirmation of exactly what the first step declared. Nothing is a withdrawal until this is sent. */
export const withdrawalConfirm = z.object({ requestId: uuid });
export type WithdrawalConfirm = z.infer<typeof withdrawalConfirm>;

/** A return request inside the store's own window (kind `return`): a reason from the list and an optional note. */
export const returnRequest = z.object({
  orderNumber,
  email,
  name: required(120),
  lines: z
    .array(declaredLine.extend({ reason: optionalReason }))
    .min(1, "lines")
    .max(200, "lines")
    .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length, "lines"),
  reason: optionalReason,
  note: optionalText(MAX_REASON_NOTE),
  orderKey: optionalText(200),
});
export type ReturnRequest = z.infer<typeof returnRequest>;

// --- Staff -------------------------------------------------------------------

const money = (message: string) => z.number(message).int(message).min(0, message).max(1_000_000_000, message);
const httpsUrl = z
  .string()
  .trim()
  .max(2000, "The address is too long.")
  .refine((value) => /^https:\/\/\S+$/.test(value), "A return label address starts with https://.");
const optionalHttps = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value || null)
  .pipe(httpsUrl.nullable());

const addressPart = (max: number) => z.string().trim().min(1, "Fill in the whole return address.").max(max, "A part of the return address is too long.");
export const returnAddress = z.object({
  name: addressPart(120),
  street: addressPart(200),
  postalCode: addressPart(20),
  city: addressPart(100),
  country: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Use a two-letter country code, such as NO.")),
});

/** How the consumer told the store, for a withdrawal made outside the withdrawal function (Art. 11: any unequivocal statement counts). */
export const WITHDRAWAL_CHANNELS = ["email", "phone", "letter", "in_person", "other"] as const;
export type WithdrawalChannel = (typeof WITHDRAWAL_CHANNELS)[number];

/**
 * Staff register a withdrawal the consumer made outside the function (an email, a letter, a call, a typo in the function):
 * the order, the name, how and on which store day the store was informed (that moment starts the 14 days for the refund and
 * is what the acknowledgement states), the lines. `late` is for a statement that by the records came after the 14 days but
 * that the store accepts as in time (the consumer was not given the information about the right, or received the goods later):
 * it needs its reason.
 */
export const registerWithdrawal = z
  .object({
    orderNumber: z.string().trim().min(1, "Give the order number.").max(40, "The order number is too long."),
    name: z.string().trim().min(1, "Give the customer's name.").max(120, "The name is too long."),
    channel: z.enum(WITHDRAWAL_CHANNELS, "Choose how the customer told you."),
    /** The store day the store was informed; empty is now. */
    informedOn: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day the store was told as year-month-day.")
      .or(z.literal(""))
      .nullish()
      .transform((value) => value || null),
    lines: z
      .array(z.object({ lineId: uuid, quantity }))
      .min(1, "Choose at least one line.")
      .max(200, "Too many lines.")
      .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length, "Each line is chosen once."),
    note: z
      .string()
      .trim()
      .max(500, "Keep the note under 500 characters.")
      .nullish()
      .transform((value) => value || null),
    late: z.boolean().default(false),
    lateReason: z
      .string()
      .trim()
      .max(500, "Keep the reason under 500 characters.")
      .nullish()
      .transform((value) => value || null),
  })
  .refine((v) => !v.late || v.lateReason !== null, { message: "Say why the period is longer than the records show.", path: ["lateReason"] });
export type RegisterWithdrawal = z.infer<typeof registerWithdrawal>;

/** Approve a voluntary return (a withdrawal return starts approved): instructions, address and a label address. */
export const approveReturn = z.object({
  returnId: uuid,
  instructions: optionalText(MAX_INSTRUCTIONS),
  labelUrl: optionalHttps,
  returnAddress: returnAddress.nullish().transform((v) => v ?? null),
  note: optionalText(1000),
});
export type ApproveReturn = z.infer<typeof approveReturn>;

/** Decline a voluntary return, with the reason the shopper is emailed. */
export const declineReturn = z.object({
  returnId: uuid,
  reason: z.string().trim().min(1, "Say why the return is declined.").max(1000, "Keep the reason under 1000 characters."),
});
export type DeclineReturn = z.infer<typeof declineReturn>;

/**
 * Decline one line of a return: a line the law excludes from the right of withdrawal (the only line of a withdrawal
 * return that can be declined), or any line of a voluntary return. A line decision, not a status.
 */
export const declineReturnLine = z.object({
  returnId: uuid,
  lineId: uuid,
  reason: z.string().trim().min(1, "Say why the line is declined.").max(500, "Keep the reason under 500 characters."),
});
export type DeclineReturnLine = z.infer<typeof declineReturnLine>;

/** Instructions, address and label for a return that is approved (they can be changed until it is received). */
export const returnInstructions = z.object({
  returnId: uuid,
  instructions: optionalText(MAX_INSTRUCTIONS),
  labelUrl: optionalHttps,
  returnAddress: returnAddress.nullish().transform((v) => v ?? null),
});
export type ReturnInstructions = z.infer<typeof returnInstructions>;

/** Mark the goods in transit (the shopper's proof of sending, or staff's) or received; `on` is the day, the store's. */
export const returnStep = z.object({
  returnId: uuid,
  on: z.iso.date("Use a date.").nullish().transform((v) => v ?? null),
});
export type ReturnStep = z.infer<typeof returnStep>;

export const RETURN_CONDITIONS = ["as_new", "opened", "used", "damaged"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

/**
 * Inspect the goods, per line: what condition they came back in, whether they go back into stock, and a deduction for
 * diminished value from handling beyond what was needed to establish the goods' nature (CRD Art. 14(2)): a number with a
 * note. The server checks the deduction against the line's value.
 */
export const inspectReturn = z.object({
  returnId: uuid,
  lines: z
    .array(
      z
        .object({
          lineId: uuid,
          condition: z.enum(RETURN_CONDITIONS, "Choose the condition."),
          restock: z.boolean(),
          deductionMinor: money("The deduction is an amount of 0 or more."),
          deductionNote: optionalText(500),
        })
        .refine((line) => line.deductionMinor === 0 || line.deductionNote !== null, {
          message: "Say what the deduction is for.",
          path: ["deductionNote"],
        }),
    )
    .min(1, "Inspect at least one line."),
});
export type InspectReturn = z.infer<typeof inspectReturn>;

/**
 * Refund: the amount (from `refundFor()`, or adjusted with a reason), what the shopper is charged for return shipping,
 * and the units that go back into stock. The server works the sum out again and refuses an amount outside its bounds.
 */
export const refundReturn = z.object({
  returnId: uuid,
  amountMinor: money("The amount is a whole number of minor units, 0 or more."),
  reason: optionalText(500),
  returnShippingMinor: money("Return shipping is an amount of 0 or more.").default(0),
  restock: z.array(z.object({ lineId: uuid, quantity: z.number().int().min(0).max(10_000) })).default([]),
});
export type RefundReturn = z.infer<typeof refundReturn>;

export const closeReturn = z.object({ returnId: uuid, note: optionalText(1000) });
export const cancelReturn = z.object({ returnId: uuid, note: optionalText(1000) });
export const returnNote = z.object({ returnId: uuid, note: optionalText(2000) });

export const RETURN_FILTER_STATUSES = ["open", "requested", "approved", "in_transit", "received", "inspected", "closed", "declined", "cancelled", "all"] as const;
/** The queue's filters (`?status=&kind=&q=&overdue=1`): oldest first. */
export const returnQueueFilter = z.object({
  status: z.enum(RETURN_FILTER_STATUSES).catch("open"),
  kind: z.enum(["withdrawal", "return", "all"]).catch("all"),
  q: z.string().trim().max(100).catch(""),
  overdue: z.coerce.boolean().catch(false),
});
export type ReturnQueueFilter = z.infer<typeof returnQueueFilter>;

// --- Settings ----------------------------------------------------------------

/** The store's rules for returns (`/admin/{store}/settings/returns`); the legal 14 days are never shortened. */
export const returnSettingsInput = z.object({
  windowDays: z
    .number("The window is a number of days.")
    .int("The window is a whole number of days.")
    .min(MIN_WINDOW_DAYS, `The window is at least ${MIN_WINDOW_DAYS} days: the legal period is never shortened.`)
    .max(MAX_WINDOW_DAYS, `The window is at most ${MAX_WINDOW_DAYS} days.`),
  transitDays: z
    .number("Transit allowance is a number of days.")
    .int("Transit allowance is a whole number of days.")
    .min(0, "Transit allowance is 0 or more.")
    .max(MAX_TRANSIT_DAYS, `Transit allowance is at most ${MAX_TRANSIT_DAYS} days.`),
  whoPaysReturn: z.enum(["shopper", "store"], "Choose who pays for return shipping."),
  refundWhen: z.enum(["received", "request"], "Choose when refunds are made."),
  acceptExcluded: z.boolean(),
  instructions: z.string().trim().max(MAX_INSTRUCTIONS, `Instructions are at most ${MAX_INSTRUCTIONS} characters.`),
  returnAddress: returnAddress.nullable(),
  b2bReturns: z.boolean(),
});
export type ReturnSettingsInput = z.infer<typeof returnSettingsInput>;

/** The first error's message of a failed parse, or null: what a form shows under its fields. */
export function firstProblem(error: z.ZodError): { path: string; message: string } {
  const issue = error.issues[0];
  return { path: issue.path.join("."), message: issue.message };
}

/** The settings as the form starts: the legal defaults. */
export const defaultReturnSettingsInput: ReturnSettingsInput = {
  windowDays: DEFAULT_RETURN_SETTINGS.windowDays,
  transitDays: DEFAULT_RETURN_SETTINGS.transitDays,
  whoPaysReturn: DEFAULT_RETURN_SETTINGS.whoPaysReturn,
  refundWhen: DEFAULT_RETURN_SETTINGS.refundWhen,
  acceptExcluded: DEFAULT_RETURN_SETTINGS.acceptExcluded,
  instructions: DEFAULT_RETURN_SETTINGS.instructions,
  returnAddress: DEFAULT_RETURN_SETTINGS.returnAddress,
  b2bReturns: DEFAULT_RETURN_SETTINGS.b2bReturns,
};
