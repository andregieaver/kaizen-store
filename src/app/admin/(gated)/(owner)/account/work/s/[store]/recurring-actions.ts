"use server";

import { refresh } from "next/cache";

import type { z } from "zod";

import type { recurringInvoiceInput } from "@/lib/work-input";
import { audit, requireMember, type Membership } from "@/server/auth";
import { problem, type WorkResult } from "@/server/work-errors";
import {
  createRecurring,
  deleteRecurring,
  generateRecurringNow,
  issueRecurringNow,
  restoreRecurringPeriod,
  setRecurringActive,
  skipRecurringPeriod,
  updateRecurring,
} from "@/server/work-recurring";

/**
 * Work's actions for repeating invoices (docs/work.md 7.2 WP8), on a client's page. Each is bound to
 * the store's slug as its first argument and asks `requireMember()` itself, then hands what the
 * browser sent to the server function, which checks it again with `recurringInvoiceInput`. Owners
 * and admins may do everything here except switch automatic issuing on or off (the server function
 * refuses an admin), which is an owner's decision and is kept in the audit log. The templates'
 * history (`work_events`) is written by the server functions. Nothing is cached, so `refresh()` is all
 * that is needed. They answer `{ ok: true, … }` or `{ ok: false, problems }`.
 */

const OFF = "Work is switched off for this store.";

async function change<T extends object>(
  storeSlug: string,
  run: (member: Membership) => Promise<WorkResult<T>>,
): Promise<WorkResult<T>> {
  const member = await requireMember(storeSlug);
  if (!member.store.workOn) return problem(OFF);
  const result = await run(member);
  if (result.ok) refresh();
  return result;
}

export async function createRecurringAction(storeSlug: string, input: z.input<typeof recurringInvoiceInput>) {
  return change(storeSlug, async (member) => {
    const result = await createRecurring(member, input);
    if (result.ok && input.autoIssue) {
      await audit(member.account.id, member.store.id, "work.recurring.auto_issue_on", { templateId: result.id });
    }
    return result;
  });
}

export async function updateRecurringAction(
  storeSlug: string,
  templateId: string,
  input: z.input<typeof recurringInvoiceInput>,
) {
  return change(storeSlug, async (member) => {
    const result = await updateRecurring(member, templateId, input);
    if (result.ok) {
      await audit(member.account.id, member.store.id, "work.recurring.saved", {
        templateId,
        autoIssue: Boolean(input.autoIssue),
      });
    }
    return result;
  });
}

/** Pauses a template (its invoices stay) or starts it again. */
export async function setRecurringActiveAction(storeSlug: string, templateId: string, active: boolean) {
  return change(storeSlug, (member) => setRecurringActive(member, templateId, active));
}

/** Deletes a template that never made an invoice. */
export async function deleteRecurringAction(storeSlug: string, templateId: string) {
  return change(storeSlug, (member) => deleteRecurring(member, templateId));
}

/** "Generate now": the draft of the given period, or of the oldest due period that has none. */
export async function generateRecurringNowAction(storeSlug: string, templateId: string, period: string | null = null) {
  return change(storeSlug, (member) => generateRecurringNow(member, templateId, period));
}

/** "Skip this period": never made (its draft is deleted if there is one). */
export async function skipRecurringPeriodAction(storeSlug: string, templateId: string, period: string) {
  return change(storeSlug, (member) => skipRecurringPeriod(member, templateId, period));
}

/** Takes a period off the skip list. */
export async function restoreRecurringPeriodAction(storeSlug: string, templateId: string, period: string) {
  return change(storeSlug, (member) => restoreRecurringPeriod(member, templateId, period));
}

/** "Issue now": issues the period's draft (making it first if needed) and emails it unless told not to. */
export async function issueRecurringNowAction(
  storeSlug: string,
  templateId: string,
  period: string,
  email: boolean = true,
) {
  return change(storeSlug, async (member) => {
    const result = await issueRecurringNow(member, templateId, period, { email });
    if (result.ok) {
      await audit(member.account.id, member.store.id, "work.invoice.issued", {
        invoiceId: result.invoiceId,
        documentNumber: result.documentNumber,
        recurringInvoiceId: templateId,
        period,
      });
    } else {
      // A draft may have been made before the checklist stopped the issue: show it.
      refresh();
    }
    return result;
  });
}
