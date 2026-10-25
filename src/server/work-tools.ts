import "server-only";

import { formatMoney } from "@/lib/money";
import { todayIn } from "@/lib/work-dates";
import { workBase } from "@/lib/work-paths";

import { audit, passMembership, type Account, type Membership } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { memberCan } from "./permissions";
import type { Store } from "./stores";
import { listAssignments, listClients } from "./work";
import { sendInvoiceEmail } from "./work-emails";
import { invoiceReadiness, issueInvoice, listWorkInvoices } from "./work-invoices";
import { getWorkOverview } from "./work-overview";
import { logTime } from "./work-time";

/**
 * The AI manager's Work tools (PSI AGT-01; D122, `docs/work.md`): what is unbilled, overdue and waiting, the clients' assignments, logging time
 * and issuing a draft invoice, each through Work's own functions (`getWorkOverview()`, `logTime()`, `issueInvoice()`, `sendInvoiceEmail()`),
 * only while the store has Work on and with the person's membership read again. Money is written per currency, never added across
 * currencies; an issued invoice is a legal document and is emailed to the client, so issuing waits for the owner's yes (`send`).
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const locale = (store: Store) => store.markets[0]?.locale ?? "en";
const money = (store: Store, minor: number, currency: string) => formatMoney(minor, currency, locale(store));
const hours = (minutes: number) => `${Math.floor(minutes / 60)} h ${minutes % 60} min`;

function workOn(ctx: Ctx): void {
  if (!ctx.store.workOn) fail("Work is not switched on for this store: the owner switches it on in Work's settings.");
}

/** The person's membership now, for a change: Work's screens ask `settings:write`. */
async function writer(ctx: Ctx): Promise<Membership> {
  workOn(ctx);
  const member = await passMembership(ctx.store.slug, ctx.account.id);
  if (!member || !memberCan(member, "settings:write")) return fail("You may not change this store's Work.");
  return member;
}

/** `work_overview`: unbilled time by client, overdue invoices, drafts and what needs a look, per currency. */
export async function workOverviewTool(ctx: Ctx) {
  workOn(ctx);
  const view = await getWorkOverview(ctx.store);
  const o = view.overview;
  const client = (id: string) => view.clientNames[id] ?? "a client";
  return {
    unbilled_by_client: o.unbilledByClient.map((u) => ({ client: client(u.clientId), time: hours(u.minutes), amount: money(ctx.store, u.amountMinor, u.currency) })),
    overdue_invoices: o.overdueInvoices.map((i) => ({
      invoice: view.invoiceNumbers[i.invoiceId] ?? null,
      client: client(i.clientId),
      days_overdue: i.daysOverdue,
      outstanding: money(ctx.store, i.outstandingMinor, i.currency),
    })),
    drafts: o.counts.drafts,
    recurring_ready: o.counts.recurringReady,
    running_timers: o.runningTimers.map((t) => ({ assignment: view.assignmentNames[t.assignmentId]?.name ?? null, by: view.people[t.accountId] ?? null, running: hours(t.elapsedMinutes) })),
    note: "Amounts are in each client's own currency and never added across currencies.",
    link: workBase(ctx.store.slug),
  };
}

/** `list_work_assignments`: the clients' open assignments by name, with their unbilled time and draft invoice. */
export async function listWorkAssignmentsTool(ctx: Ctx) {
  workOn(ctx);
  const [assignments, drafts] = await Promise.all([listAssignments(ctx.store.id), listWorkInvoices(ctx.store.id, { status: "draft", pageSize: 100 })]);
  return {
    assignments: assignments.map((a) => ({
      id: a.id,
      client: a.clientName,
      name: a.name,
      status: a.status,
      billing: a.billingType,
      currency: a.currency,
      draft_invoice: a.draftInvoiceId,
    })),
    draft_invoices: drafts.rows.map((d) => ({ id: d.id, client: d.clientName, assignment: d.assignmentName, total: money(ctx.store, d.totalMinor, d.currency) })),
    link: `${workBase(ctx.store.slug)}/assignments`,
  };
}

/** An open assignment by its id or its name (with the client's name when two share one). */
async function assignmentOf(ctx: Ctx, ref: string) {
  const wanted = ref.trim().toLowerCase();
  const open = await listAssignments(ctx.store.id);
  const found = open.filter((a) => a.id === ref.trim() || a.name.toLowerCase() === wanted || `${a.clientName} ${a.name}`.toLowerCase() === wanted);
  if (found.length === 1) return found[0];
  return fail(found.length > 1 ? `Several assignments are called "${ref}": give its id from list_work_assignments.` : `No open assignment "${ref}". Look with list_work_assignments.`);
}

type LogInput = { assignment: string; minutes: number; date?: string; billable: boolean; note?: string };

/** `log_time`: an entry in the person's name through `logTime()`, on today's date in the store's time zone unless given. */
export async function logTimeTool(ctx: Ctx, input: LogInput) {
  const member = await writer(ctx);
  const assignment = await assignmentOf(ctx, input.assignment);
  const workDate = input.date ?? todayIn(ctx.store.timeZone);
  const result = await logTime(member, { assignmentId: assignment.id, workDate, minutes: input.minutes, billable: input.billable, ...(input.note ? { note: input.note } : {}) });
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `Logged ${hours(input.minutes)} on ${assignment.clientName}: ${assignment.name} for ${workDate}${input.billable ? "" : " (not billable)"}.`, link: `${workBase(ctx.store.slug)}/time` };
}

/** A draft invoice by its id, or by its client's name when the client has one draft. */
async function draftOf(ctx: Ctx, ref: string) {
  const drafts = (await listWorkInvoices(ctx.store.id, { status: "draft", pageSize: 100 })).rows;
  const wanted = ref.trim().toLowerCase();
  const found = drafts.filter((d) => d.id === ref.trim() || d.clientName.toLowerCase() === wanted);
  if (found.length === 1) return found[0];
  return fail(found.length > 1 ? `${ref} has several drafts: give the draft's id from list_work_assignments.` : `No draft invoice "${ref}". Look with list_work_assignments.`);
}

export async function preflightIssueWorkInvoice(ctx: Ctx, { invoice }: { invoice: string }): Promise<void> {
  await writer(ctx);
  const draft = await draftOf(ctx, invoice);
  const readiness = await invoiceReadiness(ctx.store.id, draft.id);
  if (!readiness?.ready) fail(readiness?.problems.filter((p) => p.severity === "error").map((p) => p.message).join(" ") || "The draft is not ready to issue: open it in Work.");
}

export async function issueWorkInvoiceSummary(ctx: Ctx, { invoice, email }: { invoice: string; email: boolean }): Promise<string | null> {
  try {
    const draft = await draftOf(ctx, invoice);
    return `Issue the draft invoice to ${draft.clientName}${draft.assignmentName ? ` (${draft.assignmentName})` : ""} for ${money(ctx.store, draft.totalMinor, draft.currency)} today${email ? " and email it to the client" : ""}. An issued invoice cannot be changed, only credited.`;
  } catch {
    return null;
  }
}

/** `issue_work_invoice`: the draft issued today by `commerce.issue_work_invoice()` (through `issueInvoice()`), then emailed unless said. */
export async function issueWorkInvoiceTool(ctx: Ctx, { invoice, email }: { invoice: string; email: boolean }) {
  const member = await writer(ctx);
  const draft = await draftOf(ctx, invoice);
  const result = await issueInvoice(member, { invoiceId: draft.id });
  if (!result.ok) return fail(result.problems.join(" "));
  const issued = result.invoice;
  await audit(member.account.id, ctx.store.id, "work.invoice.issued", { invoiceId: issued.invoiceId, documentNumber: issued.documentNumber, totalMinor: issued.totalMinor, currency: issued.currency });
  const sent = email ? await sendInvoiceEmail(ctx.store.id, issued.invoiceId, { by: member.account.id }) : null;
  const emailWords = !sent ? "" : sent.sent ? " and emailed to the client" : `, but the email could not go (${sent.reason ?? "no address"}): send it from the invoice's page`;
  return {
    done: `Invoice ${issued.documentNumber} to ${draft.clientName} for ${money(ctx.store, issued.totalMinor, issued.currency)} is issued${emailWords}.`,
    link: `${workBase(ctx.store.slug)}/invoices/${issued.invoiceId}`,
  };
}

/** `list_work_clients`: the clients with their unbilled time. */
export async function listWorkClientsTool(ctx: Ctx) {
  workOn(ctx);
  const clients = await listClients(ctx.store.id);
  return {
    clients: clients.map((c) => ({ name: c.name, currency: c.currency, active_assignments: c.activeAssignments, unbilled: hours(c.unbilledMinutes) })),
    link: `${workBase(ctx.store.slug)}/clients`,
  };
}
