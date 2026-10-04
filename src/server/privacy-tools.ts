import "server-only";

import { z } from "zod";

import { labelOf, type PlanAction, type PlanSummary } from "@/lib/erasure-plan";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { DUE_SOON_DAYS, REFUSAL_REASON_LABELS } from "@/lib/privacy-request";
import { KIND_MEANS, OUTCOME_MEANS, STATUS_MEANS, clockSentence, kindLabel, nextSteps, statusLabel, waitingSentence } from "@/lib/privacy-tools";
import { dayText } from "@/lib/return-admin";

import type { Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { dueCounts, getRequest, listRequests, type RequestView } from "./privacy-requests";
import type { Store } from "./stores";

type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void };

/**
 * The AI manager's privacy tools (wave 1, 1g, D162). `list_privacy_requests` and `explain_privacy_request` read the log exactly as the
 * Privacy requests page does (`listRequests()`, `getRequest()`, `dueCounts()`): every date and count is the log's own, nothing is worked out
 * by the model, and nothing here names a person (no email, name, note or refusal text: they are on the request's page, for the staff who
 * may open it). The tools never export, erase, extend or refuse: those are done on the pages, behind their confirmations, and a person's
 * record never enters a model's context.
 */

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const day = (store: Store, at: Date | null) => (at ? dayText(at, store.timeZone) : null);

const ACTION_WORDS: Record<PlanAction, string> = { deleted: "deleted", anonymised: "made anonymous", restricted: "kept restricted", kept: "kept" };

function summaryOf(value: unknown): PlanSummary | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as PlanSummary).rows)) return null;
  return value as PlanSummary;
}

function overview(store: Store, r: RequestView) {
  return {
    id: r.id,
    kind: kindLabel(r.kind),
    arrived: r.channel === "shopper" ? "From the person's own account page" : "Logged by staff",
    status: statusLabel(r.status),
    received: day(store, r.receivedAt),
    due: r.status === "open" ? day(store, r.extendedUntil ?? r.dueAt) : undefined,
    clock: r.status === "open" ? clockSentence(r.daysLeft, r.overdue) : undefined,
    past_deadline: r.overdue || undefined,
    extended: r.extendedUntil ? true : undefined,
    has_customer_account: r.subjectCustomerId !== null || undefined,
    admin: adminLink(store, `/privacy/${r.id}`),
  };
}

export async function listPrivacyRequestsTool({ store }: Ctx, { which, limit }: OwnerToolInput<"list_privacy_requests">) {
  const [all, counts] = await Promise.all([listRequests(store.id, { status: "all", limit: 200 }), dueCounts(store.id)]);
  const picked = all.filter((r) => {
    switch (which) {
      case "open":
        return r.status === "open";
      case "overdue":
        return r.status === "open" && r.overdue;
      case "due_soon":
        return r.status === "open" && !r.overdue && r.daysLeft !== null && r.daysLeft <= DUE_SOON_DAYS;
      case "answered":
        return r.status !== "open";
      default:
        return true;
    }
  });
  const shown = picked.slice(0, limit);
  return {
    showing: `${shown.length} of ${picked.length}`,
    waiting: {
      open: counts.open,
      past_deadline: counts.overdue,
      due_within_a_week: counts.dueSoon,
      summary: waitingSentence(counts),
    },
    requests: shown.map((r) => overview(store, r)),
    page: adminLink(store, "/privacy"),
    note: shown.length === 0 ? "Nothing matches." : "These name no person: the person, the notes and the data are on each request's page. Exporting and erasing are done there, not here.",
  };
}

export async function explainPrivacyRequestTool({ store }: Ctx, { request }: OwnerToolInput<"explain_privacy_request">) {
  if (!z.uuid().safeParse(request).success) return fail(`"${request}" is not a privacy request id. list_privacy_requests gives the ids.`);
  const r = await getRequest(store.id, request.toLowerCase());
  if (!r) return fail(`No privacy request ${request} in this store. list_privacy_requests shows the log.`);
  const summary = summaryOf(r.planSummary);
  const kept = summary?.keptUntil;
  return {
    request: r.id,
    kind: kindLabel(r.kind),
    kind_means: KIND_MEANS[r.kind],
    status: statusLabel(r.status),
    status_means: STATUS_MEANS[r.status],
    outcome: r.outcome ? OUTCOME_MEANS[r.outcome] : undefined,
    arrived: r.channel === "shopper" ? "From the person's own account page" : "Logged by staff from a request that came by email, post or phone",
    clock: {
      received: day(store, r.receivedAt),
      due: day(store, r.dueAt),
      extended_until: day(store, r.extendedUntil),
      now: r.status === "open" ? clockSentence(r.daysLeft, r.overdue) : "Answered",
      past_deadline: r.overdue || undefined,
      rule: "One month from receipt, extendable once by up to two further months with reasons, told to the person within the first month.",
    },
    identity_in_doubt_since: day(store, r.identityDoubtAt) ?? undefined,
    refusal_reason: r.refusalReason ? REFUSAL_REASON_LABELS[r.refusalReason] : undefined,
    answered_on: day(store, r.completedAt) ?? undefined,
    what_was_done: summary
      ? {
          rows: summary.rows
            .filter((row) => row.count > 0)
            .map((row) => `${row.count} ${labelOf(row.table)}: ${ACTION_WORDS[row.action]}`),
          kept_until: kept ? (kept.first === kept.last ? kept.first : `${kept.first} to ${kept.last}`) : undefined,
          why_kept: kept ? "The accounts for sales must be kept for the bookkeeping period of the store's country; the person is removed from them, and they are made anonymous when it ends." : undefined,
          subscriptions_cancelled: summary.subscriptionsCancelled || undefined,
          saved_cards_detached: summary.savedCardsDetached || undefined,
        }
      : r.kind === "erasure" && r.status === "open"
        ? "The plan (what goes, what is kept and until when) is shown on the erase page before anything happens."
        : undefined,
    what_can_be_done: nextSteps(r, r.kind, new Date()),
    assistant_cannot: "Export, erase, extend or refuse: they are done on the pages, behind a confirmation, so a person's record never passes through the assistant.",
    admin: adminLink(store, `/privacy/${r.id}`),
    note: "Names, emails and notes are on the request's page, not here.",
  };
}
