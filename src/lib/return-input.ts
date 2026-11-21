import type { z } from "zod";

import { DEFAULT_RETURN_SETTINGS } from "./withdrawal";
import type { ReturnSettingsInput } from "./return-input-schema";

export type { ReturnQueueFilter, ReturnSettingsInput } from "./return-input-schema";

/**
 * What the withdrawal function, the return request, the returns queue and the return settings send (D153,
 * `docs/returns.md`), shared by the browser (which builds it) and the server (which checks it again before anything is
 * written, `productInput`-style). Money is integer minor units, never text.
 *
 * The shoppers' inputs (`withdrawalStart`, `withdrawalConfirm`, `returnRequest`) fail with a **code** as the message
 * (`required`, `email`, `too_long`, `lines`, `quantity`, `reason`): the shopper's screens write the sentence in their own
 * language. The staff inputs and the settings fail in plain English (the admin is English only).
 */

// --- The shopper -------------------------------------------------------------

// --- Staff -------------------------------------------------------------------

/** How the consumer told the store, for a withdrawal made outside the withdrawal function (Art. 11: any unequivocal statement counts). */
export const WITHDRAWAL_CHANNELS = ["email", "phone", "letter", "in_person", "other"] as const;

export const RETURN_CONDITIONS = ["as_new", "opened", "used", "damaged"] as const;

export const RETURN_FILTER_STATUSES = ["open", "requested", "approved", "in_transit", "received", "inspected", "closed", "declined", "cancelled", "all"] as const;

// --- Settings ----------------------------------------------------------------

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
