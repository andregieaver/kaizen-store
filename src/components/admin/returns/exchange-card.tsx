import Link from "next/link";

import { Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
import type { ExchangeBlock } from "@/lib/exchange";
import type { BuilderForm } from "@/lib/exchange-form";
import { formatMoney } from "@/lib/money";
import { exchangeSentence, outcomeSentence, timeText } from "@/lib/return-admin";
import type { ExchangePreview, ExchangeView } from "@/server/exchanges";
import type { ReturnDetail } from "@/server/returns";

import { ExchangeBuilder, type ExchangeBuilderActions } from "./exchange-builder";
import { ExchangeLinkHolder } from "./exchange-link";
import { AgreementForm, ExchangeButtonForm, ExchangePaidOutsideForm, ResendExchangeForm } from "./exchange-forms";
import type { StepAction } from "./step-forms";
import { Card } from "./ui";

/** The steps of the return's current exchange, bound by the page to the store, the return and that exchange. */
export type ExchangeStepActions = {
  resend: StepAction;
  withdraw: StepAction;
  agreement: StepAction;
  process: StepAction;
  paidOutside: StepAction;
  cancel: StepAction;
};

const LIVE = ["draft", "proposed", "confirmed", "processed"];
const TONE: Record<string, "neutral" | "positive" | "warning" | "insight"> = {
  proposed: "insight",
  confirmed: "positive",
  processed: "warning",
  settled: "positive",
};

/**
 * The return page's **Exchange** card (wave 3, D239, `docs/wave-3-exchanges.md` 2.2): the customer's wish first, then the return's current exchange with its state, its
 * replacements and outcome and the steps it can take, or the builder to propose one; while the return cannot be exchanged it says why in words. Everything it offers
 * follows the server's facts (`exchangeBlockFor()`, the return's `actions` from `actionsFor()`); every amount is the server's. Drawn from its data alone.
 */
export function ExchangeCard({
  base,
  detail,
  exchange,
  block,
  canWrite,
  mayRecordOutside,
  builder,
  builderActions,
  stepActions,
  timeZone,
  today,
  locale = "en-GB",
  words: w = returnsEn,
}: {
  /** `/admin/{store}` */
  base: string;
  detail: ReturnDetail;
  /** The return's live exchange, else its newest one; null when it never had one. */
  exchange: ExchangeView | null;
  block: ExchangeBlock | null;
  canWrite: boolean;
  mayRecordOutside: boolean;
  /** What the builder starts from (the order's address, a draft's replacements) and the credit; null when no builder is offered. */
  builder: { initial: BuilderForm; initialPreview: ExchangePreview | null; hasEmail: boolean } | null;
  builderActions: ExchangeBuilderActions | null;
  stepActions: ExchangeStepActions | null;
  timeZone: string;
  today: string;
  locale?: string;
  words?: ReturnsMessages;
}) {
  const x = w.exchange;
  const live = exchange && LIVE.includes(exchange.status) ? exchange : null;
  const shown = exchange && exchange.status !== "draft" ? exchange : null;
  const nothingToSay = !detail.exchangeWish && !exchange && (block === "ended" || block === "refunded" || block === "copied");
  if (nothingToSay) return null;
  const money = (minor: number) => formatMoney(minor, shown?.currency ?? detail.currency, locale);
  const can = (action: ReturnDetail["actions"][number]) => detail.actions.includes(action);
  const offerBuilder = canWrite && block === null && builder !== null && builderActions !== null && (!live || live.status === "draft");
  const steps = canWrite && stepActions !== null && shown !== null && LIVE.includes(shown.status);

  return (
    <Card
      id="exchange"
      title={x.title}
      hint={x.hint}
    >
      <div className="flex flex-col gap-5">
        <ExchangeLinkHolder>
        {detail.exchangeWish && (
          <p className="rounded-panel bg-insight-soft px-3 py-2 text-sm text-insight-text">
            {x.asked} <time dateTime={detail.exchangeWish.at}>{timeText(detail.exchangeWish.at, timeZone, locale)}</time>
            {detail.exchangeWish.note ? (
              <>
                : <q className="whitespace-pre-wrap">{detail.exchangeWish.note}</q>
              </>
            ) : (
              "."
            )}
          </p>
        )}

        {shown && (
          <section aria-labelledby="exchange-now" className="flex flex-col gap-3 text-sm">
            <h3 id="exchange-now" className="flex flex-wrap items-center gap-2 text-body-strong text-ink">
              {fillWords(x.proposal, { seq: shown.seq })}
              <Chip signal={TONE[shown.status] ?? "neutral"}>{w.labels.exchangeStatus[shown.status]}</Chip>
            </h3>
            <p>{exchangeSentence(shown, shown.currency, timeZone, locale, w)}</p>
            {shown.confirmedBy === "staff" && shown.confirmedChannel && <p className="text-muted">{fillWords(x.agreementBy, { channel: (Object.hasOwn(w.labels.channels, shown.confirmedChannel) ? w.labels.channels[shown.confirmedChannel as keyof ReturnsMessages["labels"]["channels"]] : undefined) ?? w.labels.channels.other })}</p>}
            {shown.exchangeOrderId && shown.exchangeOrderNumber && (
              <p>
                {x.newOrder}{" "}
                <Link href={`${base}/orders/${shown.exchangeOrderId}`} className="underline">
                  #{shown.exchangeOrderNumber}
                </Link>
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-1.5 pr-3 font-medium">{x.replacement}</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">{x.quantity}</th>
                    <th scope="col" className="py-1.5 text-right font-medium">{x.lineTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.lines.map((line) => (
                    <tr key={line.n} className="border-b border-line">
                      <td className="py-1.5 pr-3">
                        {line.title}
                        <span className="block font-mono text-xs text-muted">{line.sku}</span>
                        {line.unitPriceMinor < line.listPriceMinor && <span className="block text-xs text-muted">{fillWords(x.loweredEach, { amount: money(line.listPriceMinor) })}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{line.quantity}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(line.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="flex flex-col gap-0.5">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{x.shipping}</dt>
                <dd className="tabular-nums">{shown.shippingMinor === 0 ? x.free : money(shown.shippingMinor)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{x.allReplacements}</dt>
                <dd className="tabular-nums">{money(shown.totalMinor)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{x.credit}{shown.creditAtProcessingMinor !== null ? x.whenProcessed : ""}</dt>
                <dd className="tabular-nums">{money(shown.creditAtProcessingMinor ?? shown.creditMinor)}</dd>
              </div>
            </dl>
            <p className="text-body-strong text-ink">{outcomeSentence(shown.outcome, shown.currency, locale, w)}</p>
          </section>
        )}

        {steps && shown && stepActions && (
          <div className="flex flex-col gap-4 border-t border-line pt-4">
            {shown.status === "proposed" && (
              <>
                <ResendExchangeForm action={stepActions.resend} toPay={false} shareable={detail.kind === "return"} />
                {detail.kind === "return" && (
                  <details>
                    <summary className="cursor-pointer text-sm underline">{x.recordAgreement}</summary>
                    <div className="mt-3">
                      <AgreementForm action={stepActions.agreement} today={today} />
                    </div>
                  </details>
                )}
                <ExchangeButtonForm action={stepActions.withdraw} button={x.withdraw} sentence={x.withdrawSentence} />
              </>
            )}
            {shown.status === "confirmed" && (
              <>
                {can("process_exchange") ? (
                  <ExchangeButtonForm
                    action={stepActions.process}
                    primary
                    button={x.process}
                    sentence={fillWords(x.processSentence, { then: shown.outcome.kind === "to_pay" ? x.thenPay : shown.outcome.kind === "refund_due" ? x.thenRefund : x.thenEven })}
                  />
                ) : (
                  <p className="text-sm text-muted">{x.processLater}</p>
                )}
                <ExchangeButtonForm action={stepActions.withdraw} button={x.withdraw} />
              </>
            )}
            {shown.status === "processed" && shown.outcome.kind === "to_pay" && (
              <>
                <ResendExchangeForm action={stepActions.resend} toPay />
                {mayRecordOutside ? (
                  <details>
                    <summary className="cursor-pointer text-sm underline">{x.recordOutside}</summary>
                    <div className="mt-3">
                      <ExchangePaidOutsideForm action={stepActions.paidOutside} today={today} amount={money(shown.outcome.toPayMinor)} />
                    </div>
                  </details>
                ) : (
                  <p className="text-sm text-muted">{x.ownerOnly}</p>
                )}
              </>
            )}
            {shown.status === "processed" && shown.outcome.kind !== "to_pay" && (
              <ExchangeButtonForm action={stepActions.process} primary button={x.tryAgain} sentence={x.tryAgainSentence} />
            )}
            {can("cancel_exchange") && (
              <ExchangeButtonForm
                action={stepActions.cancel}
                button={x.cancel}
                sentence={shown.status === "processed" ? x.cancelProcessed : x.cancelProposal}
              />
            )}
          </div>
        )}

        {block && !live && <p className="text-sm text-muted">{w.labels.exchangeProblems[block]}</p>}

        {!canWrite && !shown && block === null && <p className="text-sm text-muted">{x.noneProposed}</p>}

        {offerBuilder && builder && builderActions && (
          <section aria-labelledby="exchange-build" className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 id="exchange-build" className="text-body-strong text-ink">
              {live?.status === "draft" ? x.yourDraft : shown ? x.proposeAnother : x.propose}
            </h3>
            <ExchangeBuilder currency={detail.currency} locale={locale} initial={builder.initial} initialPreview={builder.initialPreview} hasEmail={builder.hasEmail} shareable={detail.kind === "return"} actions={builderActions} />
          </section>
        )}
        </ExchangeLinkHolder>
      </div>
    </Card>
  );
}
