import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { labelOf, type PlanSummary } from "@/lib/erasure-plan";
import { PRIVACY_KIND_LABELS, PRIVACY_STATUS_LABELS, REFUSAL_REASON_LABELS } from "@/lib/privacy-request";
import { STAFF_TEXT } from "@/lib/privacy-text";
import type { RequestView } from "@/server/privacy-requests";

import { ACTION_WORDS } from "./plan-view";
import { ExtendForm, NoDataHint, RefuseForm, StepForm } from "./request-actions";
import { alertText, buttonPrimary, buttonSecondary, card, clockWords, dayText } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const OUTCOME_WORDS: Record<string, string> = {
  exported: "A file was downloaded for the person.",
  erased: "The person's data was erased.",
  no_data: "The store held no data about the person.",
  refused: "The request was refused.",
  cancelled: "Logged by mistake and cancelled.",
};

/** What the log keeps of an answered erasure's plan: counts per kind and what happened, never a value. */
function summaryOf(value: unknown): PlanSummary | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as PlanSummary).rows)) return null;
  return value as PlanSummary;
}

/**
 * One privacy request (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 4): the person's address and the one-month clock, then what staff
 * may do with it while it is open (download, erase, extend once, refuse with a reason, close as "no data held", cancel) and, once
 * answered, what was done. A request is never deleted from here. The actions are bound by the page, which has checked the permission.
 */
export function RequestDetail({
  base,
  request,
  canWrite,
  timeZone,
  subjectKey,
  holdsData,
  actions,
  problem,
}: {
  /** `/admin/{store}` */
  base: string;
  request: RequestView;
  /** `customers:write`. */
  canWrite: boolean;
  timeZone?: string;
  /** The customer page's key for this person (an account, an order or a subscription), or null when the store holds nothing. */
  subjectKey: string | null;
  /** The store holds something about the person (the erasure preview is not empty). */
  holdsData: boolean;
  actions: { extend: Action; refuse: Action; closeNoData: Action; cancel: Action; identity: Action };
  /** A refused download's fixed sentence (from `?export=`), never text from the address. */
  problem?: string | null;
}) {
  const open = request.status === "open";
  const plan = summaryOf(request.planSummary);
  const exportAction = subjectKey ? `${base}/customers/${subjectKey}/export` : null;
  const eraseHref = subjectKey ? `${base}/customers/${subjectKey}/erase?request=${request.id}` : null;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`${base}/privacy`} className="text-sm underline">
          Privacy requests
        </Link>
        <h1 className="text-2xl font-semibold">{PRIVACY_KIND_LABELS[request.kind]} request</h1>
        <p className="text-sm text-muted">
          {PRIVACY_STATUS_LABELS[request.status]} · {request.channel === "shopper" ? "asked on the site" : "logged by staff"}
        </p>
      </div>

      {problem && (
        <p role="alert" className="rounded-md border border-red-700 bg-background p-3 text-sm dark:border-red-400">
          {problem}
        </p>
      )}

      {open && request.overdue && (
        <p role="alert" className="rounded-md border border-red-700 bg-background p-3 text-sm dark:border-red-400">
          <span className={`font-medium ${alertText}`}>This request is {clockWords(request.daysLeft, true)}.</span> The law asks for an answer within one month of receiving it.
        </p>
      )}

      <section aria-labelledby="request-facts" className={`${card} text-sm`}>
        <h2 id="request-facts" className="font-medium">
          The request
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">Person</dt>
          <dd className="break-all">{request.subjectEmail ?? (request.outcome === "erased" ? "Erased: the address was removed when the data was" : "No address")}</dd>
          <dt className="text-muted">Received</dt>
          <dd>{dayText(request.receivedAt, timeZone)}</dd>
          <dt className="text-muted">Due</dt>
          <dd>
            {dayText(request.dueAt, timeZone)}
            {request.extendedUntil && <span> · extended to {dayText(request.extendedUntil, timeZone)}</span>}
            {open && <span className={`block ${request.overdue ? `font-medium ${alertText}` : "text-muted"}`}>{clockWords(request.daysLeft, request.overdue)}</span>}
          </dd>
          {request.extensionReason && (
            <>
              <dt className="text-muted">Why extended</dt>
              <dd className="whitespace-pre-wrap">{request.extensionReason}</dd>
            </>
          )}
          {request.identityDoubtAt && (
            <>
              <dt className="text-muted">Waiting for identity</dt>
              <dd>Since {dayText(request.identityDoubtAt, timeZone)}</dd>
            </>
          )}
          {request.note && (
            <>
              <dt className="text-muted">Note</dt>
              <dd className="whitespace-pre-wrap">{request.note}</dd>
            </>
          )}
          {request.completedAt && (
            <>
              <dt className="text-muted">Answered</dt>
              <dd>
                {dayText(request.completedAt, timeZone)}
                {request.outcome && <span className="block text-muted">{OUTCOME_WORDS[request.outcome] ?? request.outcome}</span>}
              </dd>
            </>
          )}
          {request.refusalReason && (
            <>
              <dt className="text-muted">Reason for refusing</dt>
              <dd>
                {REFUSAL_REASON_LABELS[request.refusalReason]}
                {request.refusalNote && <span className="block whitespace-pre-wrap text-muted">{request.refusalNote}</span>}
              </dd>
            </>
          )}
        </dl>
      </section>

      {open && canWrite && (
        <section aria-labelledby="request-answer" className={card}>
          <h2 id="request-answer" className="font-medium">
            Answer it
          </h2>
          {subjectKey && holdsData ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted">{STAFF_TEXT.downloadWarning}</p>
              <div className="flex flex-wrap items-start gap-2">
                <form method="post" action={exportAction ?? undefined}>
                  <input type="hidden" name="request" value={request.id} />
                  <button type="submit" className={request.kind === "export" ? buttonPrimary : buttonSecondary}>
                    Download data
                  </button>
                </form>
                <Link href={eraseHref ?? "#"} className={request.kind === "erasure" ? buttonPrimary : buttonSecondary}>
                  Erase personal data
                </Link>
              </div>
              <p className="text-xs text-muted">
                {STAFF_TEXT.exportHelp} {request.kind === "export" ? "Downloading answers this request." : "Erasing answers this request; it shows what will happen first."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <NoDataHint />
              <StepForm action={actions.closeNoData} successMessage="Closed as no data held.">
                Close as &quot;no data held&quot;
              </StepForm>
            </div>
          )}
          <p className="text-sm text-muted">{STAFF_TEXT.identity}</p>
        </section>
      )}

      {open && canWrite && (
        <section aria-labelledby="request-other" className={card}>
          <h2 id="request-other" className="font-medium">
            Other ways to deal with it
          </h2>
          <div className="flex flex-col gap-4">
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Extend the answer</summary>
              <div className="mt-3">
                <ExtendForm action={actions.extend} />
              </div>
            </details>
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Refuse the request</summary>
              <div className="mt-3">
                <RefuseForm action={actions.refuse} />
              </div>
            </details>
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Waiting for identity</summary>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                <p className="text-muted">{STAFF_TEXT.identityNote}</p>
                <StepForm action={actions.identity} successMessage="The date is noted.">
                  Note that we are waiting
                </StepForm>
              </div>
            </details>
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Logged by mistake</summary>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                <p className="text-muted">The request stays in the log as cancelled; a request is never deleted.</p>
                <StepForm action={actions.cancel} successMessage="The request is cancelled.">
                  Cancel the request
                </StepForm>
              </div>
            </details>
          </div>
        </section>
      )}

      {open && !canWrite && <p className="text-sm text-muted">Answering a request needs permission to change customers.</p>}

      {plan && (
        <section aria-labelledby="request-done" className={`${card} text-sm`}>
          <h2 id="request-done" className="font-medium">
            What was done
          </h2>
          {plan.rows.length === 0 ? (
            <p className="text-muted">Nothing was held about the person.</p>
          ) : (
            <ul className="list-disc pl-5">
              {plan.rows.map((row) => (
                <li key={`${row.table}:${row.action}`}>
                  {row.count} × {labelOf(row.table)}: {ACTION_WORDS[row.action].toLowerCase()}
                </li>
              ))}
            </ul>
          )}
          {plan.keptUntil && (
            <p className="text-muted">
              Sales under the bookkeeping rules are kept restricted until {dayText(plan.keptUntil.first)}
              {plan.keptUntil.first !== plan.keptUntil.last ? ` to ${dayText(plan.keptUntil.last)}` : ""}, then made anonymous.
            </p>
          )}
          {(plan.subscriptionsCancelled > 0 || plan.savedCardsDetached > 0) && (
            <p className="text-muted">
              {plan.subscriptionsCancelled} subscriptions cancelled, {plan.savedCardsDetached} saved cards detached.
            </p>
          )}
        </section>
      )}

      {open && subjectKey && (
        <p className="text-sm">
          <Link href={`${base}/customers/${subjectKey}`} className={buttonSecondary}>
            Open the customer
          </Link>
        </p>
      )}
    </div>
  );
}
