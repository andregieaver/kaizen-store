import type { ReactNode } from "react";

import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { formatDeclaration, formatStoreDay } from "@/lib/return-time";
import { isEnded, type ReturnStatus } from "@/lib/return-status";
import type { ShopperReturn } from "@/server/returns";

import { declinedReason, type R } from "./withdraw-parts";

/**
 * What the status page adds for exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md` 2.1 and 2.4): the market's words, the label route of a
 * booked label (`/returns/{token}/label`, built with `marketPath()`), the carrier's name, and the wish form when the return can be exchanged (the page decides,
 * `wishOfferedFor()`). Left out, the page shows what D153 showed.
 */
export type StatusExtras = {
  words: Pick<Messages, "exchange" | "returnLabel" | "exchangeWish">;
  labelRoute: string | null;
  carrierName: string | null;
  wishForm: ReactNode | null;
};

type Props = { m: R; ret: ShopperReturn; locale: string; extras?: StatusExtras };

/** A web address only when it is one the shopper's browser may open: the store pastes it, and a page does not trust it. */
const safeHref = (value: string | null): string | null => (value && /^https:\/\/\S+$/.test(value) ? value : null);

/**
 * The status of one return for the shopper (D153, `docs/returns.md`): where it stands, what to do next and what came of it.
 * Read only. It shows the order number and the goods, never the shopper's email or address. Drawn from `getShopperReturn()`;
 * the page, and the tests, give it the same data.
 */
export function ReturnStatusView({ m, ret, locale, extras }: Props) {
  const status = ret.status as ReturnStatus;
  const open = !isEnded(status);
  const day = (iso: string) => new Intl.DateTimeFormat(safeLocale(locale), { dateStyle: "long", timeZone: ret.timeZone }).format(new Date(iso));
  const labelHref = safeHref(ret.labelUrl);
  const refunded = ret.outcome === "refunded" && ret.refundMinor !== null && ret.refundedAt !== null;
  const stateWords: Record<string, string> = { done: m.stepDone, current: m.stepCurrent, skipped: m.stepSkipped };
  const where = ret.returnAddress;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-heading tracking-tight">{m.statusTitle(ret.number)}</h1>
        <p className="text-muted">
          {m.statusOrder(ret.orderNumber)} · {m.kind[ret.kind]}
        </p>
        <p className="text-sm text-muted">{m.statusMade(formatDeclaration(ret.createdAt, locale, ret.timeZone))}</p>
      </div>

      <p className="text-xl font-medium">{ret.nothingSent && status === "approved" ? m.nothingToSend : m.status[status]}</p>

      <ol aria-label={m.stepsLabel} className="flex flex-col gap-2 rounded-lg border border-border p-4">
        {ret.steps.map((step) => (
          <li key={step.step} aria-current={step.state === "current" ? "step" : undefined} className={step.state === "upcoming" || step.state === "skipped" ? "text-muted" : "font-medium"}>
            {m.steps[step.step as keyof typeof m.steps]}
            {stateWords[step.state] && <span className="sr-only">: {stateWords[step.state]}</span>}
          </li>
        ))}
      </ol>

      <section aria-labelledby="items-heading" className="flex flex-col gap-2">
        <h2 id="items-heading" className="font-medium">
          {m.itemsHeading}
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border px-4">
          {ret.lines.map((line, i) => (
            <li key={`${line.title}-${i}`} className="flex flex-col gap-0.5 py-3">
              <span className="flex flex-wrap justify-between gap-3">
                <span className="min-w-0 break-words">{line.title}</span>
                <span className="whitespace-nowrap">× {line.quantity}</span>
              </span>
              {line.decision === "decline" && <span className="text-sm text-muted">{m.declinedLine(declinedReason(m, line.declineReason))}</span>}
            </li>
          ))}
        </ul>
      </section>

      {status === "declined" && ret.decisionNote && (
        <section aria-labelledby="declined-heading" className="flex flex-col gap-1">
          <h2 id="declined-heading" className="font-medium">
            {m.declinedHeading}
          </h2>
          <p className="whitespace-pre-line break-words">{ret.decisionNote}</p>
        </section>
      )}

      {open && !ret.nothingSent && (status === "approved" || status === "in_transit") && (
        <section aria-labelledby="how-heading" className="flex flex-col gap-3">
          <h2 id="how-heading" className="font-medium">
            {m.howHeading}
          </h2>
          {ret.sendBackBy && <p>{m.done.sendBack(formatStoreDay(ret.sendBackBy, locale))}</p>}
          {ret.instructions && (
            <div>
              <h3 className="text-sm font-medium">{m.instructionsHeading}</h3>
              <p className="whitespace-pre-line break-words">{ret.instructions}</p>
            </div>
          )}
          {where && (
            <div>
              <h3 className="text-sm font-medium">{m.addressHeading}</h3>
              <address className="not-italic">
                {[where.name, where.street, `${where.postalCode} ${where.city}`, where.country].map((part) => (
                  <span key={part} className="block">
                    {part}
                  </span>
                ))}
              </address>
            </div>
          )}
          {ret.label.source === "carrier" && extras ? (
            <BookedLabel ret={ret} extras={extras} locale={locale} />
          ) : (
            labelHref && (
              <p>
                <a href={labelHref} target="_blank" rel="noreferrer" className="underline">
                  {m.labelLink}
                </a>
              </p>
            )
          )}
          <p className="text-sm text-muted">{m.whoPays[ret.whoPaysReturn]}</p>
        </section>
      )}

      {ret.kind === "withdrawal" && open && ret.refundBy && (
        <section className="flex flex-col gap-1">
          <p>{m.done.refundBy(day(ret.refundBy))}</p>
          {ret.nothingSent ? <p className="text-sm text-muted">{m.done.nothingSent}</p> : <p className="text-sm text-muted">{m.done.refundWait}</p>}
        </section>
      )}

      {extras && <ExchangeState ret={ret} extras={extras} locale={locale} />}

      {refunded && <p role="status">{m.refunded(formatMoney(ret.refundMinor!, ret.currency, locale), day(ret.refundedAt!))}</p>}
      {ret.outcome === "no_refund" && <p>{m.noRefund}</p>}
      {ret.acknowledgementReference && (
        <p className="text-sm text-muted">
          {m.done.reference}: <span className="font-mono">{ret.acknowledgementReference}</span>
        </p>
      )}
    </>
  );
}

/**
 * A label booked with the store's carrier (D239 2.4): *Print your return label* through Kaizen's label route (never the carrier's own address, which needs the
 * store's keys), the carrier, the tracking number with its link, whether it is a test label, and who pays (`LabelCost`), or that it is free for the shopper
 * when the store pays.
 */
function BookedLabel({ ret, extras, locale }: { ret: ShopperReturn; extras: StatusExtras; locale: string }) {
  const l = extras.words.returnLabel;
  const trackingHref = safeHref(ret.label.trackingUrl);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" data-return-label>
      <h3 className="font-medium">{l.heading}</h3>
      {ret.label.test && (
        <p role="note" className="text-sm font-medium" data-label-test>
          {l.test}
        </p>
      )}
      {extras.labelRoute && (
        <p>
          <a href={extras.labelRoute} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center button-primary rounded-button px-5 font-medium">
            {l.print}
          </a>
        </p>
      )}
      {extras.carrierName && <p className="text-sm">{l.carrier(extras.carrierName)}</p>}
      {ret.label.trackingNumber && (
        <p className="text-sm">
          {l.tracking}: <span className="font-mono">{ret.label.trackingNumber}</span>
          {trackingHref && (
            <>
              {" · "}
              <a href={trackingHref} target="_blank" rel="noreferrer" className="underline">
                {l.track}
              </a>
            </>
          )}
        </p>
      )}
      {ret.whoPaysReturn === "store" ? (
        <p className="text-sm">{l.freeForYou}</p>
      ) : (
        <LabelCost ret={ret} words={l} locale={locale} />
      )}
    </div>
  );
}

/**
 * What the label takes off the refund, for a shopper who pays return shipping (4.8, As built): once refunded, what was taken off; before, the label's cost
 * only *if* the parcel is sent with it (nothing is taken off at booking, staff confirm at refund time). A test label cannot be used and is never taken off.
 */
function LabelCost({ ret, words: l, locale }: { ret: ShopperReturn; words: StatusExtras["words"]["returnLabel"]; locale: string }) {
  if (ret.label.test) return null;
  if (ret.refundMinor !== null) return ret.returnShippingMinor > 0 ? <p className="text-sm">{l.costOff(formatMoney(ret.returnShippingMinor, ret.currency, locale))}</p> : null;
  return ret.label.costMinor !== null && ret.label.costMinor > 0 ? <p className="text-sm">{l.costIfUsed(formatMoney(ret.label.costMinor, ret.currency, locale))}</p> : null;
}

/**
 * The exchange beside the return's steps (D239 2.1): the customer's wish (the form while it can be made, or that it was sent), then the newest proposal's
 * state in plain words. The proposal's own page is reached from the store's email only: its token is kept as a hash, so this page cannot link to it.
 */
function ExchangeState({ ret, extras, locale }: { ret: ShopperReturn; extras: StatusExtras; locale: string }) {
  const x = extras.words.exchange;
  const money = (minor: number) => formatMoney(minor, ret.currency, locale);
  const when = (iso: string) => new Date(iso).toLocaleString(safeLocale(locale), { dateStyle: "long", timeStyle: "short", timeZone: ret.timeZone });
  const ex = ret.exchange;
  if (!ex) {
    if (extras.wishForm) return <>{extras.wishForm}</>;
    if (ret.exchangeWishAt) {
      return (
        <p role="status" className="rounded-lg border border-border p-4" data-exchange-wish-sent>
          {extras.words.exchangeWish.sent}
        </p>
      );
    }
    return null;
  }
  const difference = ex.differenceMinor;
  const outcome = difference < 0 ? x.outcomeRefund(money(-difference)) : difference === 0 ? x.outcomeEven : x.outcomePay(money(difference));
  let body: ReactNode;
  switch (ex.status) {
    case "proposed":
      body = (
        <>
          <p className="font-medium">{x.status.proposed}</p>
          <p>{outcome}</p>
          <p className="text-sm">{x.status.inEmail}</p>
          {ex.expiresAt && <p className="text-sm text-muted">{x.confirmBy(when(ex.expiresAt))}</p>}
        </>
      );
      break;
    case "confirmed":
      body = (
        <>
          <p className="font-medium">{x.status.confirmed}</p>
          <p>{outcome}</p>
        </>
      );
      break;
    case "processed":
      body =
        difference > 0 ? (
          <>
            <p className="font-medium">{x.states.toPay}</p>
            <p>{x.toPayNow(money(difference))}</p>
            <p className="text-sm">{x.status.payInEmail}</p>
            {ex.expiresAt && <p className="text-sm text-muted">{x.payBy(when(ex.expiresAt))}</p>}
          </>
        ) : (
          <p className="font-medium">{x.status.confirmed}</p>
        );
      break;
    case "settled":
      body = <p className="font-medium">{x.status.exchanged(ex.exchangeOrderNumber ?? "")}</p>;
      break;
    case "declined_by_customer":
      body = <p>{x.declined}</p>;
      break;
    case "superseded":
      body = <p>{x.states.refunded}</p>;
      break;
    default:
      // Cancelled or expired: the money comes back as usual.
      body = <p>{x.status.lapsed}</p>;
  }
  return (
    <section aria-labelledby="exchange-heading" className="flex flex-col gap-1 rounded-lg border border-border p-4" data-exchange-status={ex.status}>
      <h2 id="exchange-heading" className="font-medium">
        {x.title}
      </h2>
      {body}
    </section>
  );
}

function safeLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0 ? locale : "en";
  } catch {
    return "en";
  }
}

