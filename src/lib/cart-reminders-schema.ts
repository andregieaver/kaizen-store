import { z } from "zod";

import { MAX_DELAY_MINUTES, MIN_DELAY_MINUTES } from "./cart-reminders";

/**
 * The schemas of cart-reminders.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; cart-reminders.ts imports it as a type alone.
 */

const text = z.object({
  subject: z.string().trim().min(1, "Give each language a subject.").max(150),
  heading: z.string().trim().min(1, "Give each language a heading.").max(150),
  body: z.string().trim().min(1, "Give each language a message.").max(3000),
  button: z.string().trim().min(1, "Give each language a button text.").max(60),
});

/** A reminder as the admin sends it. */
export const reminderStepInput = z.object({
  delayMinutes: z.coerce
    .number()
    .int()
    .min(MIN_DELAY_MINUTES, "Wait at least 30 minutes: the shopper may still be paying.")
    .max(MAX_DELAY_MINUTES, "Send it within 30 days."),
  active: z.boolean().default(true),
  discountCodeId: z.uuid().nullable().default(null),
  content: z.record(z.string(), text),
});

export type ReminderStepInput = z.input<typeof reminderStepInput>;
