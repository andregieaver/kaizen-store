/**
 * The words of the email templates, in English (D312 A8, bloat review step 2.50): what each placeholder is and what a template's problems
 * say, beside `email-template.ts`, which re-exports them, so the admin's `notifications` catalogue takes them from here and imports no code.
 * Imports nothing but types and the claims' names (`claims.ts`, which imports nothing).
 */
import { CLAIM_LABELS, type ClaimKind } from "./claims";
import type { TemplateSlot } from "./email-template";
import type { PlaceholderName } from "./notifications";

/** What each placeholder becomes, for the chips beside the editor. */
export const PLACEHOLDERS: Record<PlaceholderName, { label: string }> = {
  store_name: { label: "The store's name" },
  order_number: { label: "The order's number" },
  customer_first_name: { label: "The customer's first name (left out when it is not known)" },
  order_total: { label: "The order's total, in its own currency" },
  carrier: { label: "The carrier's name" },
  tracking_number: { label: "The parcel's tracking number" },
  refund_amount: { label: "The amount refunded, in the order's currency" },
  return_number: { label: "The return's number" },
  pickup_place: { label: "The place to collect from" },
  change_number: { label: "The change's number" },
  due_date: { label: "The day the payment is due, in the customer's language" },
};

/** The words of `templateProblems()` (D312 A8): English here, as the server and the AI read them; the admin passes its own language's. */
export const TEMPLATE_PROBLEM_EN = {
  slots: { subject: "The subject", heading: "The heading", body: "The text" } as Record<TemplateSlot, string>,
  locked: "This email cannot be changed.",
  tooLong: "{slot} is {length} characters long; at most {max}.",
  oneLine: "{slot} must be one line.",
  bodyLines: "The text has {lines} lines; at most {max}.",
  control: "{slot} holds a character that cannot be shown. Type it again.",
  unknownPlaceholder: "{name} is not a placeholder of this email.",
  strayBrace: "{slot} has a { or } that is not part of a placeholder. Placeholders are written {name}.",
  address: "{slot} holds a web address ({address}). Links are added by Kaizena Flow as buttons; leave addresses out.",
  emptyAfterFill: "{slot} would be empty when its placeholders have no value. Add some words.",
  claim: '{slot} says "{phrase}": {kind}. Order emails state facts; offers and claims are marketing.',
  claimKinds: { ...CLAIM_LABELS } as Record<ClaimKind, string>,
};
