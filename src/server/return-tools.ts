import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { findClaims } from "@/lib/claims";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { ACTION_LABELS, KIND_HINTS, KIND_LABELS, REASON_LABELS, STATUS_HINTS, STATUS_LABELS, WORKING_LABELS, CAPPED_WORDS, countsSentence, dayText, dueMark, eventSentence } from "@/lib/return-admin";
import { REFUND_ON_SCREEN, approveProblem, declineProblem } from "@/lib/return-tools";
import { isReturnKind, isReturnStatus, type ReturnKind, type ReturnStatus } from "@/lib/return-status";
import { isReturnReason } from "@/lib/withdrawal";

import type { Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { approveReturn, declineReturn, getReturn, listReturns, returnCounts } from "./returns";
import type { Store } from "./stores";

type Row = Record<string, unknown>;
type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void };

/**
 * The AI manager's returns tools (D153). `list_returns` and `explain_return` read the queue and a return as the admin's screens do
 * (`listReturns()`, `getReturn()`): every figure, date and amount is the store's own, amounts written by `formatMoney`, nothing
 * worked out by the model. `approve_return` and `decline_return` answer a voluntary return the store has not answered yet and email
 * the customer, so they are kept for the owner's yes (`send`); the words the model writes for the customer pass the claims filter
 * first. A withdrawal is never declined (the database refuses it too), and nothing here refunds: that stays on the return's page.
 */

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const money = (store: Store, minor: number, currency: string) => formatMoney(minor, currency, mainLocale(store));
const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const day = (store: Store, at: string | null) => (at ? dayText(at, store.timeZone) : null);

type Found = { id: string; number: string; kind: ReturnKind; status: ReturnStatus };

/**
 * A return by its number (such as 1042-R1), its id, or its order's number when the order has one return: the store's only.
 * An order with several returns names them and asks for one.
 */
async function findReturn(store: Store, ref: string): Promise<Found> {
  const clean = ref.trim().replace(/^#/, "");
  const byId = /^[0-9a-f-]{36}$/i.test(clean);
  const rows = await db().execute<Row>(sql`
    select r.id, r.number, r.kind, r.status::text as status
    from commerce.returns r
    join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    where r.store_id = ${store.id}::uuid
      and ${byId ? sql`r.id = ${clean}::uuid` : sql`(upper(r.number) = upper(${clean}) or o.number = ${clean})`}
    order by r.created_at, r.id
    limit 6
  `);
  if (rows.length === 0) return fail(`No return ${ref} in this store. list_returns shows the queue.`);
  if (rows.length > 1) {
    return fail(`Order ${clean} has several returns: ${rows.map((r) => String(r.number)).join(", ")}. Name one by its number.`);
  }
  const row = rows[0];
  const kind = isReturnKind(row.kind) ? row.kind : "return";
  const status = isReturnStatus(row.status) ? row.status : "requested";
  return { id: String(row.id), number: String(row.number), kind, status };
}

const claimsIn = (...texts: string[]): string[] => [...new Set(texts.flatMap((text) => findClaims(text).map((c) => c.phrase)))];
const claimsFail = (claims: string[]): void => {
  if (claims.length > 0) fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
};

// Reading -------------------------------------------------------------------------------------------------------------

const WHICH: Record<string, { status: string; overdue?: boolean }> = {
  open: { status: "open" },
  requested: { status: "requested" },
  overdue: { status: "open", overdue: true },
};

export async function listReturnsTool(ctx: Ctx, { which, kind, search, limit }: OwnerToolInput<"list_returns">) {
  const { store } = ctx;
  const pick = WHICH[which] ?? { status: which };
  const [queue, counts] = await Promise.all([
    listReturns(store.id, { status: pick.status as never, kind, q: search ?? "", overdue: pick.overdue ?? false }, { pageSize: limit }),
    returnCounts(store.id),
  ]);
  return {
    showing: `${queue.rows.length} of ${queue.total}`,
    waiting: {
      open: counts.open,
      to_answer: counts.requested,
      past_refund_deadline: counts.overdue,
      acknowledgement_not_sent: counts.acknowledgementPending,
      summary: countsSentence(counts),
    },
    returns: queue.rows.map((r) => ({
      number: r.number,
      kind: KIND_LABELS[r.kind],
      status: STATUS_LABELS[r.status],
      order: r.orderNumber,
      customer: r.name ? `${r.name} <${r.email}>` : r.email,
      units: r.units,
      made: day(store, r.createdAt),
      refund: r.refundMinor !== null ? `Refunded ${money(store, r.refundMinor, r.currency)}` : (dueMark(r.due, store.timeZone)?.text ?? null),
      past_refund_deadline: r.overdue,
      acknowledgement_not_sent: r.acknowledgementPending || undefined,
      admin: adminLink(store, `/returns/${r.id}`),
    })),
    page: adminLink(store, "/returns"),
    note: queue.rows.length === 0 ? "Nothing matches." : undefined,
  };
}

export async function explainReturnTool(ctx: Ctx, { return: ref }: OwnerToolInput<"explain_return">) {
  const { store } = ctx;
  const found = await findReturn(store, ref);
  const d = await getReturn(store.id, found.id);
  if (!d) return fail(`No return ${ref} in this store.`);
  const m = (minor: number) => money(store, minor, d.currency);
  const next = d.actions.filter((a) => a !== "send_acknowledgement").map((a) => ACTION_LABELS[a]);
  const assistantCan = [
    approveProblem(d) === null ? "approve_return" : null,
    declineProblem(d) === null ? "decline_return" : null,
  ].filter(Boolean);
  return {
    return: d.number,
    kind: KIND_LABELS[d.kind],
    kind_means: KIND_HINTS[d.kind],
    status: STATUS_LABELS[d.status],
    status_means: d.nothingSent && d.status === "approved" ? "Nothing was sent, so there are no goods to wait for. The refund is due." : STATUS_HINTS[d.status],
    order: d.orderNumber,
    customer: d.request ? `${d.request.name} <${d.request.email}>` : d.orderEmail,
    made: day(store, d.createdAt),
    reason: d.reason && isReturnReason(d.reason) ? REASON_LABELS[d.reason] : d.reason ? "Other" : "None given (a withdrawal needs no reason)",
    reason_note: d.reasonNote ?? undefined,
    subscription_order: d.order.subscription ? "The order is a subscription's: the withdrawal is recorded, the subscription itself is ended separately." : undefined,
    lines: d.lines.map((l) => ({
      item: l.title,
      sku: l.sku,
      quantity: l.quantity,
      of_ordered: l.orderedQuantity,
      decision: l.decision === "accept" ? "Accepted" : `Declined${l.declineReason ? `: ${l.declineReason}` : ""}`,
      condition: l.condition ?? undefined,
      deduction: l.deductionMinor > 0 ? m(l.deductionMinor) : undefined,
      goes_back_in_stock: l.restock || undefined,
    })),
    refund: d.refund.recorded
      ? {
          refunded: m(d.refund.amountMinor ?? 0),
          on: day(store, d.refund.at),
          how: d.refund.outside ? "Outside Kaizen's Stripe (recorded here)" : "Through Stripe",
          note: d.refund.note ?? undefined,
        }
      : d.working
        ? {
            would_be_now: m(d.working.amountMinor),
            working: d.working.working.map((row) => `${WORKING_LABELS[row.key]}: ${m(row.amountMinor)}`),
            held_back: d.working.cappedBy ? CAPPED_WORDS[d.working.cappedBy] : undefined,
            left_to_refund_on_the_order: m(d.order.refundableMinor),
          }
        : null,
    refund_due: dueMark(d.due, store.timeZone)?.text ?? null,
    past_refund_deadline: d.due.state === "overdue" || d.due.state === "waiting_late",
    refund_deadline: day(store, d.refundDeadline),
    acknowledgement: d.request ? (d.request.acknowledgement === "sent" ? `Sent ${day(store, d.request.acknowledgedAt)}` : "Not sent: send it again on the return's page") : undefined,
    history: d.events.slice(-12).map((e) => `${day(store, e.at)}: ${eventSentence(e.type, e.data, d.currency, mainLocale(store))}`),
    next_steps_on_the_page: next,
    you_can_do_here: assistantCan,
    note: REFUND_ON_SCREEN,
    admin: adminLink(store, `/returns/${d.id}`),
  };
}

// Answering -----------------------------------------------------------------------------------------------------------

export async function approveReturnTool(ctx: Ctx, input: OwnerToolInput<"approve_return">) {
  const { store, account } = ctx;
  const found = await findReturn(store, input.return);
  const problem = approveProblem(found);
  if (problem) return fail(problem);
  claimsFail(claimsIn(...[input.instructions, input.note].filter((t): t is string => Boolean(t))));
  const done = await approveReturn(store.id, { returnId: found.id, instructions: input.instructions, note: input.note }, account.id);
  if (!done.ok) return fail(done.problem);
  return {
    done: `Return ${found.number} is approved, and the customer is emailed how to send the goods back.`,
    next: "When the goods arrive, receive, inspect and refund the return on its page: the assistant does not refund returns.",
    admin: adminLink(store, `/returns/${found.id}`),
  };
}

export async function declineReturnTool(ctx: Ctx, input: OwnerToolInput<"decline_return">) {
  const { store, account } = ctx;
  const found = await findReturn(store, input.return);
  const problem = declineProblem(found);
  if (problem) return fail(problem);
  claimsFail(claimsIn(input.reason));
  const done = await declineReturn(store.id, { returnId: found.id, reason: input.reason }, account.id);
  if (!done.ok) return fail(done.problem);
  return {
    done: `Return ${found.number} is declined, and the customer is emailed why.`,
    admin: adminLink(store, `/returns/${found.id}`),
  };
}

/**
 * Checks an answer before it is kept for the owner's yes: the return must be the store's and be in a state the answer is allowed in,
 * and the words the customer is sent must pass the claims filter, so the owner is never asked to approve what could not be done. A
 * withdrawal is refused here, at once, with the reason.
 */
export async function preflightReturnTool(ctx: Ctx, name: "approve_return" | "decline_return", input: Record<string, unknown>): Promise<void> {
  const found = await findReturn(ctx.store, String(input.return ?? ""));
  const problem = name === "approve_return" ? approveProblem(found) : declineProblem(found);
  if (problem) return fail(problem);
  const words = name === "approve_return" ? [input.instructions, input.note] : [input.reason];
  claimsFail(claimsIn(...words.filter((t): t is string => typeof t === "string" && t !== "")));
}
