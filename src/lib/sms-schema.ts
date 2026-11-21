import { z } from "zod";

import { QUIET_DEFAULT, QUIET_EARLIEST, QUIET_LATEST, SENDER_PATTERN, SMS_TEXT_MAX } from "./sms";

/**
 * The schemas of sms.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; sms.ts imports it as a type alone.
 */

export const smsSettingsInput = z.object({
  sender: z.string().trim().regex(SENDER_PATTERN, "A sender name is 1 to 11 letters and digits, starting with a letter, without spaces."),
  /** The store's 46elks number (E.164) to receive STOP replies on; empty for a sender name only (the stop link in every text still works). */
  replyNumber: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\+[1-9]\d{7,14}$/.test(v), "Write the number as +46 and its digits, with no spaces.")
    .default(""),
  quietFrom: z.coerce.number().int().min(QUIET_EARLIEST, `From ${QUIET_EARLIEST} at the earliest.`).max(QUIET_LATEST - 1).default(QUIET_DEFAULT.from),
  quietUntil: z.coerce.number().int().min(QUIET_EARLIEST + 1).max(QUIET_LATEST, `Until ${QUIET_LATEST} at the latest.`).default(QUIET_DEFAULT.until),
  /** The most a calendar month's texts may cost, in the 46elks account's currency (whole units). */
  monthlyCap: z.coerce.number().int().min(0, "The cap is 0 or more.").max(1_000_000, "The cap is at most 1 000 000.").default(500),
});

export const smsCampaignInput = z.object({
  title: z.string().trim().min(1, "Give the text message a name.").max(120, "A name is at most 120 characters."),
  text: z.string().trim().min(1, "Write the message.").max(SMS_TEXT_MAX, `A message is at most ${SMS_TEXT_MAX} characters.`),
  /** `all`: every SMS subscriber; else a saved segment's people who are SMS subscribers. */
  segmentId: z.string().uuid().nullable().default(null),
});
