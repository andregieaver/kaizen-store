import { z } from "zod";

/**
 * One contact policy across a store's email and texts (email plan M1.5, D764): at most `perWeek` marketing messages to one person in any
 * 7 days, and none within `spacingHours` of the last. Broadcasts, automation emails and texts all count, and so do cart reminders; order
 * emails never do. A message the person set off themselves (a welcome on joining, a cart reminder, back in stock) goes anyway (it is what
 * they asked for, and it comes first); any other that would break the policy is suppressed, with its reason, and never sent later.
 * Quiet hours keep automation emails to the reader's daytime, as texts already are (`nextSendTime()` in `src/lib/sms.ts`). Pure.
 */

export const POLICY_DEFAULT = { perWeek: 3, spacingHours: 20, quietHours: true } as const;
export const PER_WEEK_MAX = 14;
export const SPACING_MAX = 72;

export const contactPolicySchema = z.object({
  perWeek: z.coerce.number().int().min(1, "At least one a week.").max(PER_WEEK_MAX, `At most ${PER_WEEK_MAX} a week.`),
  spacingHours: z.coerce.number().int().min(0).max(SPACING_MAX, `At most ${SPACING_MAX} hours.`),
  /** A form's checkbox: present is on. */
  quietHours: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
});
export type ContactPolicy = z.infer<typeof contactPolicySchema>;

/** Why a message was not sent: the week's cap was reached, or the last message was too recent. */
export type PolicyReason = "cap" | "spacing";

/** `first`: the person set it off themselves and it goes whatever came before; `normal`: it waits its turn under the policy. */
export type ContactPriority = "first" | "normal";

const WEEK_MS = 7 * 86_400_000;

/**
 * Whether one more marketing message may reach a person who was sent `sent` (instants, any order, any age) before `now`: null when it may,
 * else why not. A `first` message always may.
 */
export function policyVerdict(sent: readonly string[], now: Date, policy: ContactPolicy, priority: ContactPriority): PolicyReason | null {
  if (priority === "first") return null;
  const at = now.getTime();
  const recent = sent.map((s) => Date.parse(s)).filter((t) => Number.isFinite(t) && t <= at && at - t < WEEK_MS);
  if (recent.length >= policy.perWeek) return "cap";
  if (policy.spacingHours > 0 && recent.some((t) => at - t < policy.spacingHours * 3_600_000)) return "spacing";
  return null;
}

/** The automation kind a person sets off themselves by joining: it comes first. Every other kind (a browse email too) waits its turn. */
export const FIRST_KINDS: ReadonlySet<string> = new Set(["welcome"]);
