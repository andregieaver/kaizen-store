"use server";

import { refresh } from "next/cache";

import { z } from "zod";

import { MESSAGE_MAX } from "@/lib/work-email";
import type { Membership } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { problem, zodProblems, type WorkResult } from "@/server/work-errors";
import { hostedInvoiceUrl, sendCreditNoteEmail, sendInvoiceEmail, sendPaymentReminderEmail } from "@/server/work-emails";

import { sendReason } from "@/lib/work-send-ui";

/**
 * Work's actions for sending documents (docs/work.md 4.7, WP7b): an invoice, a payment reminder and a credit note
 * by email, and the hosted link to copy. Each is bound to the store's slug, asks `checkPermission()` itself and
 * checks that Work is on; owners and admins may send. What is sent, to whom and when is decided by
 * `src/server/work-emails.ts` (issued invoices only, the store's own, kept in the email log): a browser only names
 * the document, an address and a note, checked again here. They answer `{ ok: true, … }` or `{ ok: false, problems }`.
 */

const OFF = "Work is switched off for this store, or your role has no access to it.";

async function workMember(storeSlug: string): Promise<Membership | null> {
  const member = await checkPermission(storeSlug, "settings:write");
  return member?.store.workOn ? member : null;
}

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .nullish()
  .transform((value) => value || null);

const sendInput = z.object({
  id: z.uuid("Choose an invoice to send."),
  to: optionalEmail,
  message: z.string().max(MESSAGE_MAX, `Keep the message to ${MESSAGE_MAX} characters.`).nullish(),
  /** Send again although it went out before: the button says "Send again" when it did. */
  again: z.boolean().optional(),
});

export type SendResult = WorkResult<{ to: string; outcome: string | null }>;

async function send(
  storeSlug: string,
  raw: unknown,
  run: (member: Membership, input: z.infer<typeof sendInput>) => ReturnType<typeof sendInvoiceEmail>,
): Promise<SendResult> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  const parsed = sendInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const result = await run(member, parsed.data);
  if (!result.sent) return problem(sendReason(result.reason));
  refresh();
  return { ok: true, to: result.to ?? "", outcome: result.outcome ?? null };
}

/** Emails the issued invoice to its client, or to the address given; `again` makes a new email of one that went out. */
export async function sendInvoiceAction(storeSlug: string, input: z.input<typeof sendInput>): Promise<SendResult> {
  return send(storeSlug, input, (member, data) =>
    sendInvoiceEmail(member.store.id, data.id, {
      by: member.account.id,
      to: data.to,
      message: data.message,
      resend: data.again === true,
    }),
  );
}

/** A payment reminder for an invoice that is still open (once a day at most). */
export async function sendReminderAction(storeSlug: string, input: z.input<typeof sendInput>): Promise<SendResult> {
  return send(storeSlug, input, (member, data) =>
    sendPaymentReminderEmail(member.store.id, data.id, { by: member.account.id, to: data.to, message: data.message }),
  );
}

/** Emails a credit note to the invoice's client. */
export async function sendCreditNoteAction(storeSlug: string, input: z.input<typeof sendInput>): Promise<SendResult> {
  return send(storeSlug, input, (member, data) =>
    sendCreditNoteEmail(member.store.id, data.id, {
      by: member.account.id,
      to: data.to,
      message: data.message,
      resend: data.again === true,
    }),
  );
}

/** The invoice's hosted link, to copy and send another way (made when the invoice has none yet). */
export async function hostedLinkAction(storeSlug: string, invoiceId: string): Promise<WorkResult<{ url: string }>> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  if (!z.uuid().safeParse(invoiceId).success) return problem(sendReason("not_found"));
  const url = await hostedInvoiceUrl(member.store.id, invoiceId);
  return url ? { ok: true, url } : problem(sendReason("not_issued"));
}
