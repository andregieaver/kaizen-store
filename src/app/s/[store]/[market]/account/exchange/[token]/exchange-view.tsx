import type { ReactNode } from "react";

import { StepFocus } from "@/components/exchange/step-focus";
import type { TermsDisplay } from "@/lib/checkout-terms";
import { termsTemplate } from "@/lib/checkout-terms";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import type { WorkingRow } from "@/lib/return-refund";
import type { ExchangePage } from "@/server/exchange-pay";
import type { Store } from "@/server/stores";

import { ConfirmForm, ExchangePayForm, type ExchangeProblemWords } from "./exchange-form";

/** The exchange page as the server found it, without the 404: what `ExchangeView` draws. */
export type ExchangePageFound = Exclude<ExchangePage, { state: "not_found" }>;

/**
 * The exchange page (wave 3, D239, `docs/wave-3-exchanges.md` 2.1), in the original order's market's language. Presentational: the page loads everything and
 * hands it in, so a test can draw each state.
 *
 * Before the customer agrees: who sells (the page has no site footer), the return's number and what is sent back, the credit with its working as the refund
 * would show it, what the new order holds (each line, its price each and its total), the shipping and the new order's total, and the outcome in one sentence
 * (*We refund you …*, *Nothing more to pay or refund*, *You pay …*); then that confirming is the agreement to be paid back by the exchange instead of to the
 * way they paid, at no cost (CRD Art. 13(1)), that the new goods are a purchase of their own with their own right of withdrawal, the date after which the
 * money comes back as usual, the store's terms as the checkout draws them, and the two answers. Every other state is one plain sentence (with the pay button
 * for the pay step). Every sentence is hand-written text that needs legal review (`m.exchange`, section 8 items 1 to 5). No cookie, no tracking, no Stripe.js.
 */
export function ExchangeView({
  page,
  store,
  market,
  token,
  terms,
  withdrawalHref,
}: {
  page: ExchangePageFound;
  store: Store;
  market: Market;
  token: string;
  /** The store's terms as the checkout shows them, or null when it shows none. */
  terms: TermsDisplay | null;
  /** The store's published withdrawal-information page, or null when it has none. */
  withdrawalHref: string | null;
}) {
  const m = t(market.lang);
  const x = m.exchange;
  const { exchange } = page;
  // The exchange is in the original order's own currency (D109: never converted again).
  const money = (minor: number) => formatMoney(minor, exchange.currency, market.locale);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(market.locale, { dateStyle: "long", timeStyle: "short", timeZone: store.timeZone }) : null);
  const storeName = store.details.legalName ?? store.name;
  const contact = store.details.contactEmail;
  const contactLine = contact ? <p>{x.contact(store.name, contact)}</p> : null;
  const heading = `${x.title} · ${x.returnNumber(exchange.returnNumber)}`;
  const outcome = exchange.outcome;
  const problems: ExchangeProblemWords = {
    not_found: x.states.cancelled,
    ended: x.states.cancelled,
    terms: m.terms.hint,
    credit_changed: x.creditChanged,
    paid: x.states.done(exchange.exchangeOrderNumber ?? ""),
    payments_off: x.states.paymentsOff,
    too_small: x.tooSmall,
    processing: x.startFailed,
    payment_error: x.startFailed,
    limit: x.tooManyPresses,
  };

  const sentence = (words: string, more?: ReactNode) => (
    <Frame heading={heading}>
      <StepFocus className="flex flex-col gap-2">
        <p className="text-lg" data-exchange-state={page.state}>
          {words}
        </p>
        {more}
      </StepFocus>
      {contactLine}
    </Frame>
  );

  switch (page.state) {
    case "done":
      return sentence(x.states.done(exchange.exchangeOrderNumber ?? ""));
    case "expired":
      return sentence(x.states.expired);
    case "cancelled":
      return sentence(x.states.cancelled);
    case "refunded":
      return sentence(x.states.refunded);
    case "declined":
      return sentence(x.declined);
    case "payments_off":
      return sentence(x.states.paymentsOff);
    case "too_small":
      return sentence(x.tooSmall);
    case "confirmed":
    case "processing":
      return sentence(x.confirmed, outcome.toPayMinor > 0 ? <p>{x.confirmedPay(money(outcome.toPayMinor))}</p> : null);
    case "to_pay":
      return (
        <Frame heading={heading}>
          <StepFocus className="flex flex-col gap-2">
            <p>{x.payIntro}</p>
            <p className="text-lg font-semibold" data-exchange-to-pay>
              {x.toPayNow(money(outcome.toPayMinor))}
            </p>
          </StepFocus>
          <Summary page={page} money={money} m={m} />
          {date(exchange.expiresAt) && <p>{x.payBy(date(exchange.expiresAt)!)}</p>}
          <ExchangePayForm
            store={store.slug}
            market={market.slug}
            token={token}
            labels={{ pay: x.pay(money(outcome.toPayMinor)), paying: m.startingPayment, note: x.payNote }}
            problems={problems}
          />
          {contactLine}
        </Frame>
      );
    case "proposed":
      break;
  }

  const seller = store.details;
  const linkOut = (href: string, words: string) => (
    <a href={href} target="_blank" rel="noopener" className="underline">
      {words}
      <span className="sr-only"> {m.terms.newTab}</span>
    </a>
  );
  return (
    <Frame heading={heading}>
      <p>{x.intro(storeName)}</p>

      {/* The seller: the page has no site footer, so who sells is said here. */}
      <section aria-labelledby="exchange-seller" className="flex flex-col gap-1 rounded-lg border border-border p-4">
        <h2 id="exchange-seller" className="font-medium">
          {x.sellerHeading}
        </h2>
        <p>{storeName}</p>
        {seller.organisationNumber && (
          <p className="text-sm text-muted">
            {m.draftPay.organisationNumber}: {seller.organisationNumber}
          </p>
        )}
        {seller.postalAddress && (
          <p className="text-sm text-muted whitespace-pre-line">
            {m.draftPay.address}: {seller.postalAddress}
          </p>
        )}
        {contact && (
          <p className="text-sm text-muted">
            {m.draftPay.contact}: {contact}
          </p>
        )}
      </section>

      {page.ret && page.ret.lines.some((line) => line.decision === "accept") && (
        <section aria-labelledby="exchange-back" className="flex flex-col gap-2">
          <h2 id="exchange-back" className="font-medium">
            {x.sendBack}
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border px-4" data-exchange-back>
            {page.ret.lines
              .filter((line) => line.decision === "accept")
              .map((line, i) => (
                <li key={`${line.title}-${i}`} className="flex justify-between gap-4 py-2">
                  <span className="min-w-0 break-words">{line.title}</span>
                  <span className="whitespace-nowrap">× {line.quantity}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <Summary page={page} money={money} m={m} />

      <p className="text-lg font-semibold" data-exchange-outcome={outcome.kind}>
        {outcome.kind === "refund_due" ? x.outcomeRefund(money(outcome.refundMinor)) : outcome.kind === "even" ? x.outcomeEven : x.outcomePay(money(outcome.toPayMinor))}
      </p>

      <p>{x.agreement}</p>
      {/* The fee-free sentence is about the refund's way only; a difference to pay is said plainly beside it (review finding, Art. 22). */}
      {outcome.kind === "to_pay" && <p data-exchange-to-pay>{x.agreementToPay(money(outcome.toPayMinor))}</p>}
      {/* The new goods carry the right of withdrawal as any purchase, but a business buyer has none and excluded goods have none (D174's rule): then only the store's own information. */}
      {page.withdrawalRight ? (
        <p className="text-sm" data-exchange-withdrawal>
          {x.newPurchase}
          {withdrawalHref && <> {linkOut(withdrawalHref, m.orderChange.withdrawalLink)}</>}
        </p>
      ) : (
        withdrawalHref && <p className="text-sm">{linkOut(withdrawalHref, m.orderChange.withdrawalLink)}</p>
      )}
      {date(exchange.expiresAt) && <p>{x.confirmBy(date(exchange.expiresAt)!)}</p>}

      <ConfirmForm
        store={store.slug}
        market={market.slug}
        token={token}
        display={terms}
        template={terms ? termsTemplate(m.terms, terms) : ""}
        newTab={m.terms.newTab}
        labels={{ confirm: x.confirm, decline: x.decline, working: x.working }}
        problems={problems}
      />
      {contactLine}
    </Frame>
  );
}

/** The credit with its working (while it is shown as proposed), what the new order holds, its shipping and its total. */
function Summary({ page, money, m }: { page: ExchangePageFound; money: (minor: number) => string; m: ReturnType<typeof t> }) {
  const x = m.exchange;
  const { exchange, credit } = page;
  const rowWords: Record<WorkingRow["key"], string> = {
    goods: x.rowGoods,
    deductions: x.rowDeductions,
    shipping: x.rowShipping,
    return_shipping: x.rowReturnShipping,
  };
  const creditMinor = exchange.creditAtProcessingMinor ?? credit?.amountMinor ?? exchange.creditMinor;
  const working = credit?.working.filter((row) => row.key === "goods" || row.amountMinor !== 0) ?? [];
  return (
    <section aria-label={x.title} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="font-medium">{x.credit}</h2>
        {working.length > 0 && (
          <dl className="flex flex-col gap-1 py-2 text-sm" data-exchange-working>
            {working.map((row) => (
              <div key={row.key} className="flex justify-between gap-4">
                <dt>{rowWords[row.key]}</dt>
                <dd className="whitespace-nowrap">{row.amountMinor < 0 ? `−${money(-row.amountMinor)}` : money(row.amountMinor)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="flex justify-between gap-4 font-medium" data-exchange-credit>
          <span>{x.credit}</span>
          <span className="whitespace-nowrap">{money(creditMinor)}</span>
        </p>
        {credit && !credit.final && <p className="mt-1 text-sm text-muted">{x.creditStillChanging}</p>}
      </div>
      <div>
        <h2 className="font-medium">{x.youGet}</h2>
        <ul className="divide-y divide-border" data-exchange-lines>
          {exchange.lines.map((line) => (
            <li key={line.n} className="flex justify-between gap-4 py-2">
              <span className="min-w-0 break-words">
                {`${line.quantity} × ${line.title}`}
                {line.quantity > 1 && <span className="block text-sm text-muted">{x.each(money(line.unitPriceMinor))}</span>}
              </span>
              <span className="whitespace-nowrap">{money(line.totalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 border-t border-border pt-3">
          <div className="flex justify-between gap-4">
            <dt>{x.shipping}</dt>
            <dd>{exchange.shippingMinor === 0 ? x.shippingFree : money(exchange.shippingMinor)}</dd>
          </div>
          <div className="flex justify-between gap-4 font-semibold">
            <dt>{x.total}</dt>
            <dd data-exchange-total>{money(exchange.totalMinor)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function Frame({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" data-exchange-page>
      <h1 className="text-3xl font-heading tracking-tight">{heading}</h1>
      {children}
    </div>
  );
}
