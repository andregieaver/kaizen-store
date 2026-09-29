"use server";

import { refresh } from "next/cache";

import { requireMember, type Membership } from "@/server/auth";
import { problem, type WorkResult } from "@/server/work-errors";
import { newInvoiceChoices, type NewInvoiceChoices } from "@/server/work-invoice-screens";
import {
  createDraftInvoice,
  deleteDraft,
  generateLinesFromTime,
  listWorkInvoices,
  unbilledTime,
  type InvoiceResult,
  type UnbilledGroup,
} from "@/server/work-invoices";

/**
 * What the invoice screens ask beyond `invoice-actions.ts` (docs/work.md 7.2 WP6): the unbilled time an invoice
 * could take, and making or finding the draft for a client's or an assignment's unbilled time in one step (the
 * "Bill unbilled time" button on the client and assignment pages). Each is bound to the store's slug, checks
 * membership and that Work is on itself, and only reads or calls the invoice server's own functions.
 */

const OFF = "Work is switched off for this store.";

async function workMember(storeSlug: string): Promise<Membership | null> {
  const member = await requireMember(storeSlug);
  return member.store.workOn ? member : null;
}

/** The clients and assignments the new-invoice dialog offers: read when it is opened from a page that did not load them. */
export async function newInvoiceChoicesAction(storeSlug: string): Promise<WorkResult<{ choices: NewInvoiceChoices }>> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  return { ok: true, choices: await newInvoiceChoices(member.store.id) };
}

/** Billable time no invoice has taken, by assignment and task, for an invoice's client (and assignment). */
export async function unbilledTimeAction(
  storeSlug: string,
  filter: { clientId?: string; assignmentId?: string; from?: string; to?: string },
): Promise<WorkResult<{ groups: UnbilledGroup[] }>> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  return { ok: true, groups: await unbilledTime(member.store.id, filter) };
}

/** The draft an assignment already has, so a second one is never started (there is one at a time). */
export async function findAssignmentDraftAction(
  storeSlug: string,
  assignmentId: string,
): Promise<WorkResult<{ invoiceId: string | null }>> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  const list = await listWorkInvoices(member.store.id, { assignmentId, status: "draft", pageSize: 1 });
  return { ok: true, invoiceId: list.rows[0]?.id ?? null };
}

export type BilledUnbilled = {
  invoiceId: string;
  /** A new draft was started (rather than the assignment's existing one opened). */
  created: boolean;
  added: number;
  updated: number;
  attachedEntries: number;
  notes: string[];
};

/**
 * Opens (or starts) the draft for an assignment, or starts one for a client on its own, and makes its lines from
 * the unbilled time, in one step. When nothing was to be billed and the draft was just started, it is taken away
 * again and the answer says so, so pressing the button never leaves an empty draft behind.
 */
export async function billUnbilledAction(
  storeSlug: string,
  target: { clientId?: string | null; assignmentId?: string | null },
): Promise<InvoiceResult<BilledUnbilled>> {
  const member = await workMember(storeSlug);
  if (!member) return problem(OFF);
  const storeId = member.store.id;
  const assignmentId = target.assignmentId || null;
  const clientId = target.clientId || null;
  if (!assignmentId && !clientId) return problem("Choose a client or an assignment to bill.");

  let invoiceId: string | null = null;
  let created = false;
  if (assignmentId) {
    const existing = await listWorkInvoices(storeId, { assignmentId, status: "draft", pageSize: 1 });
    invoiceId = existing.rows[0]?.id ?? null;
  }
  if (!invoiceId) {
    const made = await createDraftInvoice(member, { clientId, assignmentId });
    if (made.ok) {
      invoiceId = made.invoiceId;
      created = true;
    } else if (made.code === "draft_exists" && assignmentId) {
      // Somebody started it a moment ago.
      invoiceId = (await listWorkInvoices(storeId, { assignmentId, status: "draft", pageSize: 1 })).rows[0]?.id ?? null;
      if (!invoiceId) return made;
    } else {
      return made;
    }
  }

  const generated = await generateLinesFromTime(member, invoiceId, {});
  if (!generated.ok) {
    if (created) await deleteDraft(member, invoiceId);
    return generated;
  }
  if (created && generated.added === 0 && generated.updated === 0 && generated.attachedEntries === 0) {
    await deleteDraft(member, invoiceId);
    return problem(...(generated.notes.length > 0 ? generated.notes : ["There is no unbilled time to invoice."]));
  }
  refresh();
  return {
    ok: true,
    invoiceId,
    created,
    added: generated.added,
    updated: generated.updated,
    attachedEntries: generated.attachedEntries,
    notes: generated.notes,
  };
}
