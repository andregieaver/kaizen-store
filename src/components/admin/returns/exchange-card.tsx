import Link from "next/link";

import { Chip } from "@/components/admin/ui";
import { EXCHANGE_STATUS_LABELS, exchangeProblemText, type ExchangeBlock } from "@/lib/exchange";
import type { BuilderForm } from "@/lib/exchange-form";
import { formatMoney } from "@/lib/money";
import { CHANNEL_LABELS, exchangeSentence, outcomeSentence, timeText } from "@/lib/return-admin";
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
}) {
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
      title="Exchange"
      hint="Instead of money back, the customer can get other goods: the return's credit pays for a new order. Nothing is held or charged until you process it, and until the customer confirms, they are refunded as usual."
    >
      <div className="flex flex-col gap-5">
        <ExchangeLinkHolder>
        {detail.exchangeWish && (
          <p className="rounded-panel bg-insight-soft px-3 py-2 text-sm text-insight-text">
            Customer asked for an exchange on <time dateTime={detail.exchangeWish.at}>{timeText(detail.exchangeWish.at, timeZone)}</time>
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
              Proposal {shown.seq}
              <Chip signal={TONE[shown.status] ?? "neutral"}>{EXCHANGE_STATUS_LABELS[shown.status]}</Chip>
            </h3>
            <p>{exchangeSentence(shown, shown.currency, timeZone, locale)}</p>
            {shown.confirmedBy === "staff" && shown.confirmedChannel && <p className="text-muted">Agreement recorded by staff, {CHANNEL_LABELS[shown.confirmedChannel] ?? "another way"}.</p>}
            {shown.exchangeOrderId && shown.exchangeOrderNumber && (
              <p>
                New order:{" "}
                <Link href={`${base}/orders/${shown.exchangeOrderId}`} className="underline">
                  #{shown.exchangeOrderNumber}
                </Link>
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Replacement</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Quantity</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.lines.map((line) => (
                    <tr key={line.n} className="border-b border-line">
                      <td className="py-1.5 pr-3">
                        {line.title}
                        <span className="block font-mono text-xs text-muted">{line.sku}</span>
                        {line.unitPriceMinor < line.listPriceMinor && <span className="block text-xs text-muted">Lowered from {money(line.listPriceMinor)} each</span>}
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
                <dt className="text-muted">Shipping</dt>
                <dd className="tabular-nums">{shown.shippingMinor === 0 ? "Free" : money(shown.shippingMinor)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Replacements in all</dt>
                <dd className="tabular-nums">{money(shown.totalMinor)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Credit{shown.creditAtProcessingMinor !== null ? " (when processed)" : ""}</dt>
                <dd className="tabular-nums">{money(shown.creditAtProcessingMinor ?? shown.creditMinor)}</dd>
              </div>
            </dl>
            <p className="text-body-strong text-ink">{outcomeSentence(shown.outcome, shown.currency, locale)}</p>
          </section>
        )}

        {steps && shown && stepActions && (
          <div className="flex flex-col gap-4 border-t border-line pt-4">
            {shown.status === "proposed" && (
              <>
                <ResendExchangeForm action={stepActions.resend} toPay={false} shareable={detail.kind === "return"} />
                {detail.kind === "return" && (
                  <details>
                    <summary className="cursor-pointer text-sm underline">Record the customer&apos;s agreement</summary>
                    <div className="mt-3">
                      <AgreementForm action={stepActions.agreement} today={today} />
                    </div>
                  </details>
                )}
                <ExchangeButtonForm action={stepActions.withdraw} button="Withdraw the proposal" sentence="The customer's page then says the proposal no longer works, and the return is refunded as usual." />
              </>
            )}
            {shown.status === "confirmed" && (
              <>
                {can("process_exchange") ? (
                  <ExchangeButtonForm
                    action={stepActions.process}
                    primary
                    button="Process the exchange"
                    sentence={`The new order is made and its stock held. ${shown.outcome.kind === "to_pay" ? "The customer is then emailed a link to pay the difference." : shown.outcome.kind === "refund_due" ? "The rest of the credit is refunded to the customer's payment at once." : "The credit pays it in full."}`}
                  />
                ) : (
                  <p className="text-sm text-muted">Process it when the refund would be due: this store refunds when the goods are back or on their way, so mark them first.</p>
                )}
                <ExchangeButtonForm action={stepActions.withdraw} button="Withdraw the proposal" />
              </>
            )}
            {shown.status === "processed" && shown.outcome.kind === "to_pay" && (
              <>
                <ResendExchangeForm action={stepActions.resend} toPay />
                {mayRecordOutside ? (
                  <details>
                    <summary className="cursor-pointer text-sm underline">Record as paid outside Kaizen</summary>
                    <div className="mt-3">
                      <ExchangePaidOutsideForm action={stepActions.paidOutside} today={today} amount={money(shown.outcome.toPayMinor)} />
                    </div>
                  </details>
                ) : (
                  <p className="text-sm text-muted">Only the owner can record a payment taken outside Kaizen, unless the owner allows staff to (Settings, Orders).</p>
                )}
              </>
            )}
            {shown.status === "processed" && shown.outcome.kind !== "to_pay" && (
              <ExchangeButtonForm action={stepActions.process} primary button="Try again" sentence="The refund of the rest of the credit did not go through, so the exchange is not settled. The new order keeps its stock meanwhile." />
            )}
            {can("cancel_exchange") && (
              <ExchangeButtonForm
                action={stepActions.cancel}
                button="Cancel the exchange and refund instead"
                sentence={shown.status === "processed" ? "The new order is cancelled and its stock released; then refund the return as usual." : "The proposal ends; then refund the return as usual."}
              />
            )}
          </div>
        )}

        {block && !live && <p className="text-sm text-muted">{exchangeProblemText(block)}</p>}

        {!canWrite && !shown && block === null && <p className="text-sm text-muted">No exchange has been proposed. Staff who may change orders can propose one here.</p>}

        {offerBuilder && builder && builderActions && (
          <section aria-labelledby="exchange-build" className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 id="exchange-build" className="text-body-strong text-ink">
              {live?.status === "draft" ? "Your draft" : shown ? "Propose another exchange" : "Propose an exchange"}
            </h3>
            <ExchangeBuilder currency={detail.currency} locale={locale} initial={builder.initial} initialPreview={builder.initialPreview} hasEmail={builder.hasEmail} shareable={detail.kind === "return"} actions={builderActions} />
          </section>
        )}
        </ExchangeLinkHolder>
      </div>
    </Card>
  );
}
