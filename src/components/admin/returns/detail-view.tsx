import Link from "next/link";
import type { ReactNode } from "react";

import { formatMoney } from "@/lib/money";
import { formatPriceInput } from "@/lib/product-input";
import {
  CONDITION_LABELS,
  declineReasonText,
  eventSentence,
  exclusionLabel,
  KIND_HINTS,
  OUTCOME_LABELS,
  REASON_LABELS,
  STATUS_HINTS,
  STATUS_LABELS,
  timeText,
  type RefundPreviewData,
} from "@/lib/return-admin";
import { closeWithoutRefundNeedsConfirm, isEnded, type ReturnStatus } from "@/lib/return-status";
import { formatStoreDay } from "@/lib/return-time";
import { sendBackDay, type ReturnReason } from "@/lib/withdrawal";
import type { ReturnDetail } from "@/server/returns";

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
}) {
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
    valueLabel: l.valueMinor === null ? "the value of the goods" : money(l.valueMinor),
  }));
  const refundLines: RefundLine[] = accepted
    .filter((l) => l.delivery === "physical")
    .map((l) => ({ lineId: l.lineId, title: l.title, quantity: l.quantity, restock: l.restock ? l.quantity : 0 }));
  const orderHref = `${base}/orders/${detail.orderId}`;
  const inspecting = can("inspect") || (detail.status === "inspected" && !refunded);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={`${base}/returns`} className="text-sm underline">
          Returns
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Return {detail.number}</h1>
          <StatusBadge status={detail.status} />
          <KindBadge kind={detail.kind} />
        </div>
        <p className="text-sm text-muted">
          <Link href={orderHref} className="underline">
            Order #{detail.orderNumber}
          </Link>{" "}
          · {request?.email ?? detail.orderEmail} · made <time dateTime={detail.createdAt}>{timeText(detail.createdAt, timeZone)}</time>
        </p>
        <p className="text-sm">{detail.nothingSent && detail.status === "approved" ? "Nothing was sent, so there are no goods to wait for. The refund is due." : STATUS_HINTS[detail.status]}</p>
        <DueMark due={detail.due} timeZone={timeZone} />
        <p className="text-sm text-muted">{KIND_HINTS[detail.kind]}</p>
      </div>

      {request && confirmedAt && request.acknowledgement === "not_sent" && (
        <section role="alert" aria-labelledby="ack-problem" className="flex flex-col gap-3 rounded-lg border border-red-700 bg-background p-5 dark:border-red-400">
          <h2 id="ack-problem" className="font-medium">
            The acknowledgement was not sent
          </h2>
          <p className="text-sm">
            The withdrawal stands: it counts from the moment the customer confirmed it. The law also asks you to confirm that you received it, on a
            durable medium such as an email. The email did not go out, so send it again.
          </p>
          <AcknowledgementForm action={actions.acknowledge} />
        </section>
      )}

      {detail.order.subscription && (
        <p role="note" className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This order is part of a subscription. The withdrawal is recorded here, but it does not end the subscription: end that separately on its{" "}
          <Link href={`${base}/subscriptions`} className="underline">
            page
          </Link>
          .
        </p>
      )}

      <ol aria-label="Where the return is" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {detail.steps.map(({ step, state }) => (
          <li key={step} aria-current={state === "current" ? "step" : undefined} className={state === "upcoming" || state === "skipped" ? "text-muted" : state === "current" ? "font-semibold" : ""}>
            <span aria-hidden="true">{STEP_MARK[state]} </span>
            {STATUS_LABELS[step as ReturnStatus]}
            <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (now)" : state === "skipped" ? " (not reached)" : " (to come)"}</span>
          </li>
        ))}
        {(detail.status === "declined" || detail.status === "cancelled") && <li className="font-semibold">{STATUS_LABELS[detail.status as ReturnStatus]}</li>}
      </ol>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card id="statement" title={request ? "The customer's withdrawal" : "The customer's request"}>
            <dl className="flex flex-col gap-2 text-sm">
              {request ? (
                <>
                  <Fact label="Name">{request.name}</Fact>
                  <Fact label="Email">
                    <a href={`mailto:${request.email}`} className="underline">
                      {request.email}
                    </a>
                  </Fact>
                  <Fact label="Statement made">{timeText(request.submittedAt, timeZone)}</Fact>
                  <Fact label="Confirmed">{confirmedAt ? timeText(confirmedAt, timeZone) : "Not confirmed"}</Fact>
                  <Fact label="Acknowledgement">
                    {request.acknowledgement === "sent" && request.acknowledgedAt ? (
                      <>
                        Sent {timeText(request.acknowledgedAt, timeZone)}
                        {request.acknowledgementReference && <span className="block font-mono text-xs text-muted">Reference {request.acknowledgementReference}</span>}
                      </>
                    ) : (
                      <span className="font-medium text-red-700 dark:text-red-400">Not sent</span>
                    )}
                  </Fact>
                  {confirmedAt && <Fact label="Goods to be sent back by">{formatStoreDay(sendBackDay(confirmedAt, timeZone), locale)} (14 days from the declaration)</Fact>}
                  {detail.refundDeadline && <Fact label="Refund due by">{timeText(detail.refundDeadline, timeZone)} (14 days from the declaration)</Fact>}
                </>
              ) : (
                <>
                  <Fact label="Requested">{timeText(detail.createdAt, timeZone)}</Fact>
                  <Fact label="Email">{detail.orderEmail || "–"}</Fact>
                </>
              )}
              {detail.reason && <Fact label="Reason">{REASON_LABELS[detail.reason as ReturnReason] ?? detail.reason}</Fact>}
              {detail.reasonNote && (
                <Fact label="Their note">
                  <span className="whitespace-pre-wrap">{detail.reasonNote}</span>
                </Fact>
              )}
              {detail.decisionNote && (
                <Fact label={detail.status === "declined" ? "Why it was declined" : "Your note to them"}>
                  <span className="whitespace-pre-wrap">{detail.decisionNote}</span>
                </Fact>
              )}
              {detail.outcome && <Fact label="Outcome">{OUTCOME_LABELS[detail.outcome as keyof typeof OUTCOME_LABELS] ?? detail.outcome}</Fact>}
            </dl>
          </Card>

          <Card id="lines" title="Goods">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 font-medium">Product</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Returned</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Condition</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Stock</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Deduction</th>
                    <th scope="col" className="py-2 text-right font-medium">Worth</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => {
                    const declined = line.decision === "decline";
                    const canDecline = !ended && !refunded && !declined && (detail.kind === "return" || line.withdrawalExclusion !== "none");
                    return (
                      <tr key={line.lineId} className="border-b border-border align-top last:border-0">
                        <td className="py-2 pr-3">
                          {line.title}
                          <span className="block font-mono text-xs text-muted">{line.sku}</span>
                          {line.withdrawalExclusion !== "none" && <span className="block text-xs text-muted">{exclusionLabel(line.withdrawalExclusion)}</span>}
                          {line.reason && <span className="block text-xs text-muted">Reason: {REASON_LABELS[line.reason as ReturnReason] ?? line.reason}</span>}
                          {declined && <span className="block text-xs font-medium">Declined: {declineReasonText(line.declineReason)}</span>}
                          {canDecline && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs underline">
                                {line.withdrawalExclusion !== "none" ? "Decline: the law excludes it" : "Decline this line"}
                              </summary>
                              <div className="mt-2">
                                <DeclineLineForm action={actions.declineLine} lineId={line.lineId} />
                              </div>
                            </details>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {declined ? "–" : line.quantity} <span className="text-muted">of {line.orderedQuantity}</span>
                        </td>
                        <td className="py-2 pr-3">{line.condition ? CONDITION_LABELS[line.condition] : "–"}</td>
                        <td className="py-2 pr-3">{declined || line.condition === null ? "–" : line.restock ? "Back in stock" : "Not restocked"}</td>
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
                      Deduction on {l.title}: {l.deductionNote}
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          {can("approve") && (
            <Card id="approve" title="Approve or decline" hint="This is a request inside your own return window. You may approve it or decline it with a reason, and the customer is emailed either way.">
              <div className="flex flex-col gap-5">
                <ApproveForm action={actions.approve} defaults={instructionsDefaults} />
                {can("decline") && (
                  <details className="border-t border-border pt-4">
                    <summary className="cursor-pointer text-sm underline">Decline instead</summary>
                    <div className="mt-3">
                      <DeclineForm action={actions.decline} />
                    </div>
                  </details>
                )}
              </div>
            </Card>
          )}

          {detail.nothingSent && !isEnded(detail.status) && (
            <Card id="goods" title="Nothing was sent">
              <p className="text-sm">
                The customer withdrew before the goods were sent, so there is nothing for them to send back and no refund to hold back for the goods. The
                refund is due as soon as you have checked it. Do not send the parcel: if it is already packed, leave out what was withdrawn.
              </p>
            </Card>
          )}

          {!detail.nothingSent && (can("mark_in_transit") || can("mark_received")) && (
            <Card
              id="goods"
              title="The goods"
              hint={
                detail.refund.recorded
                  ? undefined
                  : detail.settings.refundWhen === "received"
                    ? "You may hold the refund until the goods are back or the customer shows proof of sending (Art. 13(3)), but never past the deadline."
                    : "This store refunds without waiting for the goods."
              }
            >
              <div className="flex flex-col gap-5">
                {can("mark_in_transit") && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">The customer has sent them</h3>
                    <DayStepForm action={actions.markInTransit} button="Mark as on their way" help="the day they were sent; today if left empty" today={today} successMessage="Marked as on their way." />
                  </div>
                )}
                {can("mark_received") && (
                  <div className={can("mark_in_transit") ? "border-t border-border pt-4" : ""}>
                    <h3 className="mb-2 text-sm font-medium">The goods have arrived</h3>
                    <DayStepForm action={actions.markReceived} button="Mark as received" help="the day they arrived; today if left empty" today={today} successMessage="Marked as received. The customer has been told." />
                  </div>
                )}
              </div>
            </Card>
          )}

          {can("set_instructions") && !can("approve") && (
            <Card id="instructions" title="Return instructions" hint="What the customer is told about sending the goods back. You can change it until the goods arrive.">
              <InstructionsForm action={actions.instructions} defaults={instructionsDefaults} />
            </Card>
          )}

          {inspecting && inspectLines.length > 0 && (
            <Card id="inspect" title={detail.status === "inspected" ? "Change the inspection" : "Inspect the goods"} hint="Say what condition each line came back in. This sets the deduction, if any, and what goes back in stock.">
              <InspectForm action={actions.inspect} lines={inspectLines} currency={detail.currency} changing={detail.status === "inspected"} />
            </Card>
          )}

          {can("refund") && preview && (
            <Card
              id="refund"
              title="Refund"
              hint={
                detail.kind === "withdrawal"
                  ? `The law gives you until ${detail.refundDeadline ? timeText(detail.refundDeadline, timeZone) : "14 days after you were told"} to refund. Nothing is refunded until you press the button.`
                  : "Nothing is refunded until you press the button."
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
              />
            </Card>
          )}

          {refunded && (
            <Card id="refunded" title="Refund">
              <dl className="flex flex-col gap-2 text-sm">
                <Fact label="Refunded">
                  {money(detail.refund.amountMinor ?? 0)}
                  {detail.refund.at && <span className="text-muted"> on {timeText(detail.refund.at, timeZone)}</span>}
                </Fact>
                <Fact label="How">{detail.refund.outside ? "Outside Kaizen's Stripe: recorded only" : "Through Stripe, on the store's account"}</Fact>
                {detail.refund.computedMinor !== null && detail.refund.computedMinor !== detail.refund.amountMinor && (
                  <Fact label="Changed from">
                    {money(detail.refund.computedMinor)}
                    {detail.refund.note && <span className="block text-muted">{detail.refund.note}</span>}
                  </Fact>
                )}
                {detail.refund.returnShippingMinor > 0 && <Fact label="Return shipping taken off">{money(detail.refund.returnShippingMinor)}</Fact>}
              </dl>
            </Card>
          )}

          {(can("close") || can("cancel")) && (
            <Card
              id="end"
              title="End the return"
              hint={
                can("close")
                  ? detail.kind === "withdrawal"
                    ? "Close it when it is done: refunded, or with nothing to refund. A withdrawal is effective when the customer says so, so it is closed, never cancelled: if the goods never come back, close it without a refund and say why in the note."
                    : "Close it when it is done: refunded, or with nothing to refund. Cancel it if the customer no longer wants to send the goods."
                  : undefined
              }
            >
              <div className="flex flex-col gap-4">
                {can("close") && (
                  <details open={refunded}>
                    <summary className="cursor-pointer text-sm underline">Close</summary>
                    <div className="mt-3">
                      <CloseForm action={actions.close} needsConfirm={closeWithoutRefundNeedsConfirm(detail.kind, refunded)} />
                    </div>
                  </details>
                )}
                {can("cancel") && (
                  <details>
                    <summary className="cursor-pointer text-sm underline">Cancel</summary>
                    <div className="mt-3">
                      <p className="mb-2 text-sm text-muted">The customer is not told.</p>
                      <CancelForm action={actions.cancel} />
                    </div>
                  </details>
                )}
              </div>
            </Card>
          )}

          <Card id="note" title="Note">
            <NoteForm action={actions.note} note={detail.staffNote ?? ""} />
          </Card>

          <Card id="history" title="History">
            {detail.events.length === 0 ? (
              <p className="text-sm text-muted">Nothing is recorded yet.</p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm">
                {detail.events.map((event, index) => (
                  <li key={index} className="flex flex-col sm:flex-row sm:gap-3">
                    <time dateTime={event.at} className="shrink-0 text-muted sm:w-40">
                      {timeText(event.at, timeZone)}
                    </time>
                    <span className="min-w-0">{eventSentence(event.type, event.data, detail.currency, locale)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card id="order" title="The order">
            <dl className="flex flex-col gap-1 text-sm">
              <Side label="Order">
                <Link href={orderHref} className="underline">
                  #{detail.orderNumber}
                </Link>
              </Side>
              <Side label="Paid">{money(detail.order.paidMinor)}</Side>
              <Side label="Refunded so far">{money(detail.order.refundedMinor)}</Side>
              <Side label="Left to refund">{money(detail.order.refundableMinor)}</Side>
              {detail.order.business && <Side label="Customer">A company: no statutory right of withdrawal</Side>}
            </dl>
          </Card>
          <Card id="rules" title="Store rules">
            <dl className="flex flex-col gap-1 text-sm">
              <Side label="Return shipping, as sold">{detail.whoPaysReturn === "shopper" ? "The customer pays" : "The store pays"}</Side>
              <Side label="Refund">{detail.settings.refundWhen === "received" ? "When the goods are back" : "When asked"}</Side>
            </dl>
            <p className="mt-2 text-sm">
              <Link href={`${base}/settings/returns`} className="underline">
                Change the rules
              </Link>
            </p>
          </Card>
          {(detail.returnAddress || detail.instructions || detail.labelUrl) && (
            <Card id="told" title="What the customer is told">
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
                    Return label
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
