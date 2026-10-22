import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { privacyEn, type PrivacyMessages } from "@/lib/admin-messages/privacy.en";
import { labelOf, type PlanSummary } from "@/lib/erasure-plan";
import type { RequestView } from "@/server/privacy-requests";
import { PageHeader } from "@/components/admin/ui";

import { ExtendForm, NoDataHint, RefuseForm, StepForm } from "./request-actions";
import { alertText, buttonPrimary, buttonSecondary, card, clockWords, dayText } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

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
  words = privacyEn,
  locale = "en-GB",
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
  /** The privacy screens' words in the admin's language, and its date locale. */
  words?: PrivacyMessages;
  locale?: string;
}) {
  const w = words.detail;
  const c = words.common;
  const staff = words.staff;
  const day = (value: Date | string | null | undefined) => dayText(value, timeZone, locale);
  const outcomes: Record<string, string> = w.outcomes;
  const open = request.status === "open";
  const plan = summaryOf(request.planSummary);
  const exportAction = subjectKey ? `${base}/customers/${subjectKey}/export` : null;
  const eraseHref = subjectKey ? `${base}/customers/${subjectKey}/erase?request=${request.id}` : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/privacy`, label: c.privacyRequests }}
        title={<>{fillWords(w.title, { kind: c.kinds[request.kind] })}</>}
        description={
          <>
            {c.statuses[request.status]} · {request.channel === "shopper" ? w.askedOnSite : w.loggedByStaff}
          </>
        }
      />

      {problem && (
        <p role="alert" className="rounded-md border border-danger-text bg-card p-3 text-sm">
          {problem}
        </p>
      )}

      {open && request.overdue && (
        <p role="alert" className="rounded-md border border-danger-text bg-card p-3 text-sm">
          <span className={`font-medium ${alertText}`}>{fillWords(w.overdue, { clock: clockWords(request.daysLeft, true, c.clock) })}</span> {w.lawAsks}
        </p>
      )}

      <section aria-labelledby="request-facts" className={`${card} text-sm`}>
        <h2 id="request-facts" className="text-title text-ink">
          {w.facts}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">{w.person}</dt>
          <dd className="break-all">{request.subjectEmail ?? (request.outcome === "erased" ? w.erasedAddress : w.noAddress)}</dd>
          <dt className="text-muted">{w.received}</dt>
          <dd>{day(request.receivedAt)}</dd>
          <dt className="text-muted">{w.due}</dt>
          <dd>
            {day(request.dueAt)}
            {request.extendedUntil && <span>{fillWords(w.extendedTo, { date: day(request.extendedUntil) })}</span>}
            {open && (
              <span className={`block ${request.overdue ? `font-medium ${alertText}` : "text-muted"}`}>
                {clockWords(request.daysLeft, request.overdue, c.clock)}
              </span>
            )}
          </dd>
          {request.extensionReason && (
            <>
              <dt className="text-muted">{w.whyExtended}</dt>
              <dd className="whitespace-pre-wrap">{request.extensionReason}</dd>
            </>
          )}
          {request.identityDoubtAt && (
            <>
              <dt className="text-muted">{w.waitingForIdentity}</dt>
              <dd>{fillWords(w.since, { date: day(request.identityDoubtAt) })}</dd>
            </>
          )}
          {request.note && (
            <>
              <dt className="text-muted">{c.note}</dt>
              <dd className="whitespace-pre-wrap">{request.note}</dd>
            </>
          )}
          {request.completedAt && (
            <>
              <dt className="text-muted">{w.answered}</dt>
              <dd>
                {day(request.completedAt)}
                {request.outcome && <span className="block text-muted">{outcomes[request.outcome] ?? request.outcome}</span>}
              </dd>
            </>
          )}
          {request.refusalReason && (
            <>
              <dt className="text-muted">{w.refusalReason}</dt>
              <dd>
                {c.refusalReasons[request.refusalReason]}
                {request.refusalNote && <span className="block whitespace-pre-wrap text-muted">{request.refusalNote}</span>}
              </dd>
            </>
          )}
        </dl>
      </section>

      {open && canWrite && (
        <section aria-labelledby="request-answer" className={card}>
          <h2 id="request-answer" className="text-title text-ink">
            {w.answerIt}
          </h2>
          {subjectKey && holdsData ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted">{staff.downloadWarning}</p>
              <div className="flex flex-wrap items-start gap-2">
                <form method="post" action={exportAction ?? undefined}>
                  <input type="hidden" name="request" value={request.id} />
                  <button type="submit" className={request.kind === "export" ? buttonPrimary : buttonSecondary}>
                    {c.downloadData}
                  </button>
                </form>
                <Link href={eraseHref ?? "#"} className={request.kind === "erasure" ? buttonPrimary : buttonSecondary}>
                  {c.eraseData}
                </Link>
              </div>
              <p className="text-xs text-muted">
                {staff.exportHelp} {request.kind === "export" ? w.downloadAnswers : w.eraseAnswers}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <NoDataHint text={staff.noData} />
              <StepForm action={actions.closeNoData} successMessage={w.closedNoData}>
                {w.closeNoData}
              </StepForm>
            </div>
          )}
          <p className="text-sm text-muted">{staff.identity}</p>
        </section>
      )}

      {open && canWrite && (
        <section aria-labelledby="request-other" className={card}>
          <h2 id="request-other" className="text-title text-ink">
            {w.otherWays}
          </h2>
          <div className="flex flex-col gap-4">
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">{w.extend}</summary>
              <div className="mt-3">
                <ExtendForm action={actions.extend} />
              </div>
            </details>
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">{w.refuse}</summary>
              <div className="mt-3">
                <RefuseForm action={actions.refuse} />
              </div>
            </details>
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">{w.waitingForIdentity}</summary>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                <p className="text-muted">{staff.identityNote}</p>
                <StepForm action={actions.identity} successMessage={w.noteDate}>
                  {w.noteWaiting}
                </StepForm>
              </div>
            </details>
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">{w.loggedByMistake}</summary>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                <p className="text-muted">{w.staysInLog}</p>
                <StepForm action={actions.cancel} successMessage={w.cancelled}>
                  {w.cancel}
                </StepForm>
              </div>
            </details>
          </div>
        </section>
      )}

      {open && !canWrite && <p className="text-sm text-muted">{w.needsWrite}</p>}

      {plan && (
        <section aria-labelledby="request-done" className={`${card} text-sm`}>
          <h2 id="request-done" className="text-title text-ink">
            {w.whatWasDone}
          </h2>
          {plan.rows.length === 0 ? (
            <p className="text-muted">{w.nothingHeld}</p>
          ) : (
            <ul className="list-disc pl-5">
              {plan.rows.map((row) => (
                <li key={`${row.table}:${row.action}`}>
                  {row.count} × {words.plan.tables[row.table] ?? labelOf(row.table)}: {words.plan.actions[row.action].toLowerCase()}
                </li>
              ))}
            </ul>
          )}
          {plan.keptUntil && (
            <p className="text-muted">
              {plan.keptUntil.first !== plan.keptUntil.last
                ? fillWords(w.keptBetween, { first: day(plan.keptUntil.first), last: day(plan.keptUntil.last) })
                : fillWords(w.keptUntil, { date: day(plan.keptUntil.first) })}
            </p>
          )}
          {(plan.subscriptionsCancelled > 0 || plan.savedCardsDetached > 0) && (
            <p className="text-muted">{fillWords(w.cancelledAndDetached, { subscriptions: plan.subscriptionsCancelled, cards: plan.savedCardsDetached })}</p>
          )}
        </section>
      )}

      {open && subjectKey && (
        <p className="text-sm">
          <Link href={`${base}/customers/${subjectKey}`} className={buttonSecondary}>
            {w.openCustomer}
          </Link>
        </p>
      )}
    </div>
  );
}
