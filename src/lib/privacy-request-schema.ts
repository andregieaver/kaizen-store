import { z } from "zod";

import { PRIVACY_KINDS, REFUSAL_REASONS } from "./privacy-request";

/**
 * The schemas of privacy-request.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; privacy-request.ts imports it as a type alone.
 */

const text = (max: number) => z.string().trim().max(max);

/** Logging a request that arrived by email, post or phone. `receivedOn` is the day it arrived (not in the future). */
export const logRequestInput = z.object({
  kind: z.enum(PRIVACY_KINDS, "Choose export or erasure."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Enter the email address the person wrote from.")),
  receivedOn: z.iso.date("Enter the date the request was received."),
  note: text(1000).default(""),
});

export const extendInput = z.object({ reason: text(1000).min(1, "Say why the request is extended.") });
export const refuseInput = z.object({
  reason: z.enum(REFUSAL_REASONS, "Choose a reason."),
  note: text(1000).default(""),
});
