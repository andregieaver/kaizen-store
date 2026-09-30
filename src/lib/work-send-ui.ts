import { isEmail } from "./forms";
import { MESSAGE_MAX } from "./work-email";

/**
 * What the Send dialog says and checks (docs/work.md 4.7, WP7b): the address and message read before anything
 * is sent, and the server's short reason codes (`sendInvoiceEmail()` and the others) in the admin's English.
 * Pure, so the dialog and its tests share it.
 */

export type SendKind = "invoice" | "reminder";

const REASONS: Record<string, string> = {
  not_found: "This invoice was not found.",
  not_issued: "Only an issued invoice can be sent. Issue it first.",
  imported: "This invoice was imported from Kaizen Life, where it was sent. It is not emailed from here.",
  not_open: "Nothing is left to pay on this invoice, so there is nothing to remind about.",
  no_email: "Give an email address to send it to.",
  invalid_email: "That is not an email address.",
  already_sent: "It has just been sent. Use Send again to send it once more.",
  failed: "The email could not be sent. Try again in a moment.",
  work_off: "Work is switched off for this store.",
};

export const sendReason = (code: string | undefined): string =>
  REASONS[code ?? ""] ?? "The email could not be sent. Try again in a moment.";

/** What a completed send says: sent, or only kept because email is not set up yet. */
export function sentText(kind: SendKind, outcome: string | undefined, to: string): string {
  const what = kind === "reminder" ? "The reminder" : "The invoice";
  return outcome === "logged"
    ? `${what} was saved in the email log for ${to}, but not sent: email sending is not set up yet.`
    : `${what} was sent to ${to}.`;
}

export type SendForm = { to: string; message: string; kind: SendKind };

/** The problems with what was typed (empty when it can be sent). */
export function sendFormProblems(form: SendForm): string[] {
  const problems: string[] = [];
  const to = form.to.trim();
  if (!to) problems.push(REASONS.no_email);
  else if (!isEmail(to)) problems.push(REASONS.invalid_email);
  if (form.message.length > MESSAGE_MAX) problems.push(`Keep the message to ${MESSAGE_MAX} characters.`);
  return problems;
}
