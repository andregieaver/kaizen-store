import { z } from "zod";

import { openingHoursInput } from "./opening-hours-schema";
import { END_AFTER_MINUTES, NOTIFY_AFTER_MINUTES, SUPPORT_MODES, TRANSCRIPT_DAYS } from "./support-rules";

/**
 * A desk's settings as the settings page sends them (D216, `docs/support.md` 2.10, step 5), as form fields. `transcriptDays` is the
 * owner's alone: a form without it (anyone else's) keeps what the desk has. The AI helpers (partner, tone, summaries) and what the AI
 * may do for customers come with the steps that build them.
 */
export const deskSettingsInput = z.object({
  mode: z.enum(SUPPORT_MODES, "Choose who answers your customers."),
  emailFollowup: z.literal(["on", "off"]).default("off").transform((value) => value === "on"),
  hours: z
    .string()
    .default("")
    .transform((text, ctx) => {
      if (!text.trim()) return null;
      try {
        const parsed = openingHoursInput.safeParse(JSON.parse(text));
        if (parsed.success) return parsed.data;
        ctx.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "The opening hours could not be read." });
      } catch {
        ctx.addIssue({ code: "custom", message: "The opening hours could not be read." });
      }
      return z.NEVER;
    }),
  endAfterMinutes: z.coerce
    .number("Write the minutes as a number.")
    .int()
    .min(END_AFTER_MINUTES.min, `End a quiet conversation with the assistant after ${END_AFTER_MINUTES.min} to ${END_AFTER_MINUTES.max} minutes.`)
    .max(END_AFTER_MINUTES.max, `End a quiet conversation with the assistant after ${END_AFTER_MINUTES.min} to ${END_AFTER_MINUTES.max} minutes.`),
  notifyAfterMinutes: z.coerce
    .number("Write the minutes as a number.")
    .int()
    .min(NOTIFY_AFTER_MINUTES.min, `Email your people after ${NOTIFY_AFTER_MINUTES.min} to ${NOTIFY_AFTER_MINUTES.max} minutes.`)
    .max(NOTIFY_AFTER_MINUTES.max, `Email your people after ${NOTIFY_AFTER_MINUTES.min} to ${NOTIFY_AFTER_MINUTES.max} minutes.`),
  agentNaming: z.enum(["first_name", "desk"], "Choose how your people are named to customers."),
  transcriptDays: z.coerce
    .number()
    .int()
    .refine((days) => (TRANSCRIPT_DAYS as readonly number[]).includes(days), "Keep transcripts for 30, 60 or 90 days.")
    .optional(),
});

export type DeskSettingsInput = z.infer<typeof deskSettingsInput>;
