import Link from "next/link";
import type { ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
import { formatMoney } from "@/lib/money";
import { formatPriceInput } from "@/lib/product-input";
import { declineReasonText, eventSentence, exclusionLabel, outcomeLabel, timeText as timeIn, type RefundPreviewData } from "@/lib/return-admin";
import { closeWithoutRefundNeedsConfirm, isEnded, type ReturnStatus } from "@/lib/return-status";
import { formatStoreDay } from "@/lib/return-time";
import { sendBackDay, type ReturnReason } from "@/lib/withdrawal";
import type { ReturnDetail } from "@/server/returns";
import { PageHeader } from "@/components/admin/ui";

import {
  AcknowledgementForm,
  ApproveForm,
  CancelForm,
  CloseForm,
  DayStepForm,
  DeclineForm,
  DeclineLineForm,
  InspectForm,
  InstructionsForm,
  NoteForm,
  RefundPanel,
  type InspectLine,
  type InstructionsDefaults,
  type PreviewAction,
  type RefundLine,
  type StepAction,
} from "./step-forms";
import { Card, DueMark, Fact, KindBadge, StatusBadge } from "./ui";

/** The server actions of one return, already bound to its store and id by the page. */
export type ReturnDetailActions = {
  approve: StepAction;
  decline: StepAction;
  declineLine: StepAction;
  instructions: StepAction;
  markInTransit: StepAction;
  markReceived: StepAction;
  inspect: StepAction;
  refund: StepAction;
  close: StepAction;
  cancel: StepAction;
  note: StepAction;
  acknowledge: StepAction;
  recalculate: PreviewAction;
};

const STEP_MARK: Record<string, string> = { done: "✓", current: "●", upcoming: "○", skipped: "–" };

/**
 * One withdrawal or return, as staff work it (D153): the customer's statement and what was sent back to them, the lines, and
 * the step that is next with the working of the refund before its button. Everything it offers comes from `detail.actions`
 * (`actionsFor()`, the same lifecycle the database enforces), so it never shows a step the return cannot take.
 */
export function ReturnDetailView({
  base,
  detail,
  preview,
  actions,
  timeZone,
  today,
  locale = "en-GB",
  exchangeCard = null,
  labelCard = null,
  words: w = returnsEn,
}: {
  /** `/admin/{store}` */
  base: string;
  detail: ReturnDetail;
  /** The refund's working and its bounds, when the refund can be made. */
  preview: RefundPreviewData | null;
  actions: ReturnDetailActions;
  timeZone: string;
  /** Today in the store's time zone, `YYYY-MM-DD`: the latest day a step can be dated. */
  today: string;
  locale?: string;
  /** The **Exchange** card (D239, `ExchangeCard`), drawn by the page where it applies; placed before the refund. */
  exchangeCard?: ReactNode;
  /** The **Return shipping** card (D239, `LabelCard`); placed after the instructions. */
  labelCard?: ReactNode;
  words?: ReturnsMessages;
}) {
  const d = w.detail;
  const L = w.labels;
  const timeText = (at: Date | string, zone: string) => timeIn(at, zone, locale);
  const reasonText = (reason: string) => (Object.hasOwn(L.reason, reason) ? L.reason[reason as ReturnReason] : reason);
  const money = (minor: number) => formatMoney(minor, detail.currency, locale);
  const can = (action: ReturnDetail["actions"][number]) => detail.actions.includes(action);
  const accepted = detail.lines.filter((l) => l.decision === "accept");
  const refunded = detail.refund.recorded;
  const ended = detail.status === "closed" || detail.status === "declined" || detail.status === "cancelled";
  const request = detail.request;
  const confirmedAt = request?.confirmedAt ?? null;
  const instructionsDefaults: InstructionsDefaults = {
    instructions: detail.instructions ?? "",
    labelUrl: detail.labelUrl ?? "",
    address: detail.returnAddress,
  };
  const inspectLines: InspectLine[] = accepted.map((l) => ({
    lineId: l.lineId,
    title: l.title,
    sku: l.sku,
    quantity: l.quantity,
    condition: l.condition,
    restock: l.restock,
    deduction: l.deductionMinor > 0 ? formatPriceInput(l.deductionMinor, detail.currency) : "",
    deductionNote: l.deductionNote ?? "",
    physical: l.delivery === "physical",
    valueLabel: l.valueMinor === null ? d.valueOfGoods : money(l.valueMinor),
  }));
  const refundLines: RefundLine[] = accepted
    .filter((l) => l.delivery === "physical")
    .map((l) => ({ lineId: l.lineId, title: l.title, quantity: l.quantity, restock: l.restock ? l.quantity : 0 }));
  const orderHref = `${base}/orders/${detail.orderId}`;
  const inspecting = can("inspect") || (detail.status === "inspected" && !refunded);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeader
          back={{ href: `${base}/returns`, label: d.back }}
          title={fillWords(d.title, { number: detail.number })}
          status={
            <>
              <StatusBadge status={detail.status} words={w} />
              <KindBadge kind={detail.kind} words={w} />
            </>
          }
        />
        <p className="text-sm text-muted">
          <Link href={orderHref} className="underline">
            {d.orderLabel} #{detail.orderNumber}
          </Link>{" "}
          · {request?.email ?? detail.orderEmail} · {d.made} <time dateTime={detail.createdAt}>{timeText(detail.createdAt, timeZone)}</time>
        </p>
        <p className="text-sm">{detail.nothingSent && detail.status === "approved" ? d.nothingSentDue : L.statusHints[detail.status]}</p>
        <DueMark due={detail.due} timeZone={timeZone} words={w} locale={locale} />
        <p className="text-sm text-muted">{L.kindHints[detail.kind]}</p>
      </div>

      {request && confirmedAt && request.acknowledgement === "not_sent" && (
        <section role="alert" aria-labelledby="ack-problem" className="flex flex-col gap-3 rounded-lg border border-danger-text bg-card p-5">
          <h2 id="ack-problem" className="text-title text-ink">
            {d.ackProblem}
          </h2>
          <p className="text-sm">{d.ackProblemText}</p>
          <AcknowledgementForm action={actions.acknowledge} />
        </section>
      )}

      {detail.order.subscription && (
        <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-text">
          {d.subscriptionBefore}{" "}
          <Link href={`${base}/subscriptions`} className="underline">
            {d.subscriptionPage}
          </Link>
          .
        </p>
      )}

      <ol aria-label={d.stepsLabel} className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {detail.steps.map(({ step, state }) => (
          <li key={step} aria-current={state === "current" ? "step" : undefined} className={state === "upcoming" || state === "skipped" ? "text-muted" : state === "current" ? "font-medium" : ""}>
            <span aria-hidden="true">{STEP_MARK[state]} </span>
            {L.status[step as ReturnStatus]}
            <span className="sr-only">{state === "done" ? d.stepDone : state === "current" ? d.stepNow : state === "skipped" ? d.stepSkipped : d.stepToCome}</span>
          </li>
        ))}
        {(detail.status === "declined" || detail.status === "cancelled") && <li className="font-medium">{L.status[detail.status as ReturnStatus]}</li>}
      </ol>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card id="statement" title={request ? d.statementWithdrawal : d.statementRequest}>
            <dl className="flex flex-col gap-2 text-sm">
              {request ? (
                <>
                  <Fact label={d.name}>{request.name}</Fact>
                  <Fact label={d.email}>
                    <a href={`mailto:${request.email}`} className="underline">
                      {request.email}
                    </a>
                  </Fact>
                  <Fact label={d.statementMade}>{timeText(request.submittedAt, timeZone)}</Fact>
                  <Fact label={d.confirmed}>{confirmedAt ? timeText(confirmedAt, timeZone) : d.notConfirmed}</Fact>
                  <Fact label={d.acknowledgement}>
                    {request.acknowledgement === "sent" && request.acknowledgedAt ? (
                      <>
                        {fillWords(d.sent, { time: timeText(request.acknowledgedAt, timeZone) })}
                        {request.acknowledgementReference && <span className="block font-mono text-xs text-muted">{fillWords(d.reference, { reference: request.acknowledgementReference })}</span>}
                      </>
                    ) : (
                      <span className="font-medium text-danger-text">{d.notSent}</span>
                    )}
                  </Fact>
                  {confirmedAt && <Fact label={d.sendBackBy}>{fillWords(d.fromDeclaration, { day: formatStoreDay(sendBackDay(confirmedAt, timeZone), locale) })}</Fact>}
                  {detail.refundDeadline && <Fact label={d.refundDueBy}>{fillWords(d.fromDeclaration, { day: timeText(detail.refundDeadline, timeZone) })}</Fact>}
                </>
              ) : (
                <>
                  <Fact label={d.requested}>{timeText(detail.createdAt, timeZone)}</Fact>
                  <Fact label={d.email}>{detail.orderEmail || "–"}</Fact>
                </>
              )}
              {detail.reason && <Fact label={d.reason}>{reasonText(detail.reason)}</Fact>}
              {detail.reasonNote && (
                <Fact label={d.theirNote}>
                  <span className="whitespace-pre-wrap">{detail.reasonNote}</span>
                </Fact>
              )}
              {detail.decisionNote && (
                <Fact label={detail.status === "declined" ? d.whyDeclined : d.yourNote}>
                  <span className="whitespace-pre-wrap">{detail.decisionNote}</span>
                </Fact>
              )}
              {detail.outcome && <Fact label={d.outcome}>{outcomeLabel(detail.outcome, w)}</Fact>}
            </dl>
          </Card>

          <Card id="lines" title={d.goods}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 pr-3 font-medium">{d.product}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{d.returned}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{d.condition}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{d.stock}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{d.deduction}</th>
                    <th scope="col" className="py-2 text-right font-medium">{d.worth}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => {
                    const declined = line.decision === "decline";
                    const canDecline = !ended && !refunded && !declined && (detail.kind === "return" || line.withdrawalExclusion !== "none");
                    return (
                      <tr key={line.lineId} className="border-b border-line align-top last:border-0">
                        <td className="py-2 pr-3">
                          {line.title}
                          <span className="block font-mono text-xs text-muted">{line.sku}</span>
                          {line.withdrawalExclusion !== "none" && <span className="block text-xs text-muted">{exclusionLabel(line.withdrawalExclusion, w)}</span>}
                          {line.reason && <span className="block text-xs text-muted">{fillWords(d.lineReason, { reason: reasonText(line.reason) })}</span>}
                          {declined && <span className="block text-xs font-medium">{fillWords(d.lineDeclined, { reason: declineReasonText(line.declineReason, w) })}</span>}
                          {canDecline && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs underline">
                                {line.withdrawalExclusion !== "none" ? d.declineExcluded : d.declineLine}
                              </summary>
                              <div className="mt-2">
                                <DeclineLineForm action={actions.declineLine} lineId={line.lineId} />
                              </div>
                            </details>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {declined ? "–" : line.quantity} <span className="text-muted">{fillWords(d.of, { n: line.orderedQuantity })}</span>
                        </td>
                        <td className="py-2 pr-3">{line.condition ? L.condition[line.condition] : "–"}</td>
                        <td className="py-2 pr-3">{declined || line.condition === null ? "–" : line.restock ? d.backInStock : d.notRestocked}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{line.deductionMinor > 0 ? `−${money(line.deductionMinor)}` : "–"}</td>
                        <td className="py-2 text-right tabular-nums">{declined || line.valueMinor === null ? "–" : money(line.valueMinor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {detail.lines.some((l) => l.deductionNote) && (
              <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
                {detail.lines
                  .filter((l) => l.deductionNote)
                  .map((l) => (
                    <li key={l.lineId}>
                      {fillWords(d.deductionOn, { title: l.title, note: l.deductionNote ?? "" })}
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          {can("approve") && (
            <Card id="approve" title={d.approveTitle} hint={d.approveHint}>
              <div className="flex flex-col gap-5">
                <ApproveForm action={actions.approve} defaults={instructionsDefaults} />
                {can("decline") && (
                  <details className="border-t border-line pt-4">
                    <summary className="cursor-pointer text-sm underline">{d.declineInstead}</summary>
                    <div className="mt-3">
                      <DeclineForm action={actions.decline} />
                    </div>
                  </details>
                )}
              </div>
            </Card>
          )}

          {detail.nothingSent && !isEnded(detail.status) && (
            <Card id="goods" title={d.nothingSentTitle}>
              <p className="text-sm">{d.nothingSentText}</p>
            </Card>
          )}

          {!detail.nothingSent && (can("mark_in_transit") || can("mark_received")) && (
            <Card
              id="goods"
              title={d.goodsTitle}
              hint={
                detail.refund.recorded
                  ? undefined
                  : detail.settings.refundWhen === "received"
                    ? d.holdHint
                    : d.noWaitHint
              }
            >
              <div className="flex flex-col gap-5">
                {can("mark_in_transit") && (
                  <div>
                    <h3 className="mb-2 text-body-strong text-ink">{d.customerSent}</h3>
                    <DayStepForm action={actions.markInTransit} button={d.markOnWay} help={d.sentHelp} today={today} successMessage={d.markedOnWay} />
                  </div>
                )}
                {can("mark_received") && (
                  <div className={can("mark_in_transit") ? "border-t border-line pt-4" : ""}>
                    <h3 className="mb-2 text-body-strong text-ink">{d.arrived}</h3>
                    <DayStepForm action={actions.markReceived} button={d.markReceived} help={d.arrivedHelp} today={today} successMessage={d.markedReceived} />
                  </div>
                )}
              </div>
            </Card>
          )}

          {can("set_instructions") && !can("approve") && (
            <Card id="instructions" title={d.instructionsTitle} hint={d.instructionsHint}>
              <InstructionsForm action={actions.instructions} defaults={instructionsDefaults} />
            </Card>
          )}

          {labelCard}

          {inspecting && inspectLines.length > 0 && (
            <Card id="inspect" title={detail.status === "inspected" ? d.changeInspection : d.inspectTitle} hint={d.inspectHint}>
              <InspectForm action={actions.inspect} lines={inspectLines} currency={detail.currency} changing={detail.status === "inspected"} />
            </Card>
          )}

          {exchangeCard}

          {can("refund") && preview && (
            <Card
              id="refund"
              title={d.refundTitle}
              hint={
                detail.kind === "withdrawal"
                  ? fillWords(d.refundLawHint, { deadline: detail.refundDeadline ? timeText(detail.refundDeadline, timeZone) : d.fourteenDays })
                  : d.refundHint
              }
            >
              <RefundPanel
                action={actions.refund}
                preview={preview}
                recalculate={actions.recalculate}
                currency={detail.currency}
                locale={locale}
                lines={refundLines}
                whoPays={detail.whoPaysReturn}
                kind={detail.kind}
                bookedLabel={detail.label}
              />
            </Card>
          )}

          {refunded && (
            <Card id="refunded" title={detail.outcome === "exchanged" ? d.credit : d.refundTitle}>
              <dl className="flex flex-col gap-2 text-sm">
                <Fact label={detail.outcome === "exchanged" ? d.creditUsed : d.refunded}>
                  {money(detail.refund.amountMinor ?? 0)}
                  {detail.refund.at && <span className="text-muted">{fillWords(d.on, { time: timeText(detail.refund.at, timeZone) })}</span>}
                </Fact>
                <Fact label={d.how}>{detail.outcome === "exchanged" ? d.howExchange : detail.refund.outside ? d.howOutside : d.howStripe}</Fact>
                {detail.refund.computedMinor !== null && detail.refund.computedMinor !== detail.refund.amountMinor && (
                  <Fact label={d.changedFrom}>
                    {money(detail.refund.computedMinor)}
                    {detail.refund.note && <span className="block text-muted">{detail.refund.note}</span>}
                  </Fact>
                )}
                {detail.refund.returnShippingMinor > 0 && <Fact label={d.shippingTakenOff}>{money(detail.refund.returnShippingMinor)}</Fact>}
              </dl>
            </Card>
          )}

          {(can("close") || can("cancel")) && (
            <Card
              id="end"
              title={d.endTitle}
              hint={
                can("close")
                  ? detail.kind === "withdrawal"
                    ? d.endWithdrawal
                    : d.endReturn
                  : undefined
              }
            >
              <div className="flex flex-col gap-4">
                {can("close") && (
                  <details open={refunded}>
                    <summary className="cursor-pointer text-sm underline">{d.close}</summary>
                    <div className="mt-3">
                      <CloseForm action={actions.close} needsConfirm={closeWithoutRefundNeedsConfirm(detail.kind, refunded)} />
                    </div>
                  </details>
                )}
                {can("cancel") && (
                  <details>
                    <summary className="cursor-pointer text-sm underline">{d.cancel}</summary>
                    <div className="mt-3">
                      <p className="mb-2 text-sm text-muted">{d.notTold}</p>
                      <CancelForm action={actions.cancel} />
                    </div>
                  </details>
                )}
              </div>
            </Card>
          )}

          <Card id="note" title={d.note}>
            <NoteForm action={actions.note} note={detail.staffNote ?? ""} />
          </Card>

          <Card id="history" title={d.history}>
            {detail.events.length === 0 ? (
              <p className="text-sm text-muted">{d.nothingYet}</p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm">
                {detail.events.map((event, index) => (
                  <li key={index} className="flex flex-col sm:flex-row sm:gap-3">
                    <time dateTime={event.at} className="shrink-0 text-muted sm:w-40">
                      {timeText(event.at, timeZone)}
                    </time>
                    <span className="min-w-0">{eventSentence(event.type, event.data, detail.currency, locale, w)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card id="order" title={d.theOrder}>
            <dl className="flex flex-col gap-1 text-sm">
              <Side label={d.orderLabel}>
                <Link href={orderHref} className="underline">
                  #{detail.orderNumber}
                </Link>
              </Side>
              <Side label={d.paid}>{money(detail.order.paidMinor)}</Side>
              <Side label={d.refundedSoFar}>{money(detail.order.refundedMinor)}</Side>
              <Side label={d.leftToRefund}>{money(detail.order.refundableMinor)}</Side>
              {detail.order.business && <Side label={d.customer}>{d.company}</Side>}
            </dl>
          </Card>
          <Card id="rules" title={d.rules}>
            <dl className="flex flex-col gap-1 text-sm">
              <Side label={d.returnShipping}>{detail.whoPaysReturn === "shopper" ? d.customerPays : d.storePays}</Side>
              <Side label={d.refund}>{detail.settings.refundWhen === "received" ? d.whenBack : d.whenAsked}</Side>
            </dl>
            <p className="mt-2 text-sm">
              <Link href={`${base}/settings/returns`} className="underline">
                {d.changeRules}
              </Link>
            </p>
          </Card>
          {(detail.returnAddress || detail.instructions || detail.labelUrl) && (
            <Card id="told" title={d.told}>
              {detail.instructions && <p className="mb-2 text-sm whitespace-pre-wrap">{detail.instructions}</p>}
              {detail.returnAddress && (
                <address className="mb-2 text-sm not-italic">
                  {detail.returnAddress.name}
                  <br />
                  {detail.returnAddress.street}
                  <br />
                  {detail.returnAddress.postalCode} {detail.returnAddress.city}
                  <br />
                  {detail.returnAddress.country}
                </address>
              )}
              {detail.labelUrl && (
                <p className="text-sm">
                  <a href={detail.labelUrl} target="_blank" rel="noreferrer" className="underline">
                    {d.returnLabel}
                  </a>
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Side({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
