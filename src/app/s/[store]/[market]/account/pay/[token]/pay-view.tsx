import { BackorderOrderLine } from "@/components/backorder-note";
import { LineThumbnail } from "@/components/line-thumbnail";
import { OrderVatNotes, OrderVatRelief, OrderVatRows } from "@/components/order-vat";
import { LineUnitPrice } from "@/components/price";
import { StaffDiscountRow } from "@/components/staff-discount-row";
import { type TermsDisplay, termsTemplate } from "@/lib/checkout-terms";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { vatText } from "@/lib/vat-text";
import type { PayPage } from "@/server/draft-pay";
import type { Store } from "@/server/stores";

import { PayForm, type PayProblemWords } from "./pay-form";

/** The pay page as the server found it, without the 404: what `PayView` draws. */
export type PayPageFound = Exclude<PayPage, { state: "not_found" }>;

/**
 * A draft order's pay link (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1), in the order's language. Presentational: the page loads everything and hands it in, so a test can draw each state.
 *
 * What it shows is what the checkout shows before a buyer is bound (Directive 2011/83/EU, as the wave 1 specs read it): the seller (the page has no site footer), the lines with what they cost, the
 * shipping, the staff discount under the name staff gave it, the VAT, the total, the store's note, how long the link is valid, the right of withdrawal in one sentence with a link to the store's
 * information page where it has one, the store's terms exactly as the checkout draws them, and one button that states the amount to pay. A custom price is shown as the price agreed, never with a "was" price.
 * Four more states are each one plain sentence: paid, expired (or replaced, or cancelled), and payments off. Every state here is hand-written text that needs legal review (`m.draftPay`).
 * No cookie, no tracking and no Stripe.js: the button hands the buyer to Stripe's own page.
 */
export function PayView({
  page,
  store,
  market,
  token,
  terms,
  withdrawalHref,
}: {
  page: PayPageFound;
  store: Store;
  market: Market;
  token: string;
  /** The store's terms at checkout, as the checkout draws them; null when it shows none. */
  terms: TermsDisplay | null;
  /** The store's published withdrawal-information page, or null when it has none. */
  withdrawalHref: string | null;
}) {
  const m = t(market.lang);
  const w = m.draftPay;
  const contact = store.details.contactEmail;
  const sentence = (text: string) => (
    <p role="status" className="text-lg">
      {text}
    </p>
  );
  const after = (text: string) => (
    <div className="flex flex-col gap-3">
      {sentence(text)}
      {contact && <p>{w.contactStore(contact)}</p>}
    </div>
  );
  const order = page.order;
  if (page.state === "expired" || !order) return <Frame heading={store.name}>{after(w.expired)}</Frame>;
  if (page.state === "paid") {
    return (
      <Frame heading={w.heading(order.number)}>
        <p role="status" className="text-lg">
          {w.paid}
        </p>
      </Frame>
    );
  }

  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const vatWords = vatText(market.lang);
  const date = new Date(page.draft.expiresAt).toLocaleString(market.locale, { dateStyle: "long", timeStyle: "short", timeZone: store.timeZone });
  const seller = store.details;
  const problems: PayProblemWords = {
    not_found: w.expired,
    expired: w.expired,
    paid: w.paid,
    payments_off: w.paymentsOff,
    terms: w.termsRequired,
    processing: m.problemProcessing,
    payment_error: w.startFailed,
    limit: w.startFailed,
  };
  return (
    <Frame heading={w.heading(order.number)}>
      <p>{w.intro}</p>

      {/* The seller: the page has no site footer, so who sells is said here (the name, the number, the address, a way to write). */}
      <section aria-labelledby="pay-seller" className="flex flex-col gap-1 rounded-lg border border-border p-4">
        <h2 id="pay-seller" className="font-medium">
          {w.sellerHeading}
        </h2>
        <p>{seller.legalName ?? store.name}</p>
        {seller.organisationNumber && (
          <p className="text-sm text-muted">
            {w.organisationNumber}: {seller.organisationNumber}
          </p>
        )}
        {seller.postalAddress && (
          <p className="text-sm text-muted whitespace-pre-line">
            {w.address}: {seller.postalAddress}
          </p>
        )}
        {contact && (
          <p className="text-sm text-muted">
            {w.contact}: {contact}
          </p>
        )}
      </section>

      <section aria-label={m.orderSummary} className="rounded-lg border border-border p-4">
        <ul className="divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.id} className="flex items-center gap-3 py-2">
              <LineThumbnail src={line.image} />
              <span className="min-w-0 flex-1 break-words">
                {`${line.quantity} × ${line.title}`}
                {/* The price per kg, litre or metre of what was priced (D160). A custom item has none. */}
                <LineUnitPrice shownMinor={line.unitPriceMinor} measure={line.measure} currency={order.currency} locale={market.locale} m={m} />
                {/* Units on backorder and the days the store states (D172). */}
                <BackorderOrderLine backorder={line.backorder} quantity={line.quantity} m={m} />
              </span>
              <span className="whitespace-nowrap">{money(line.unitPriceMinor * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          {order.ships && (
            <div className="flex justify-between gap-4">
              <dt>{order.delivery?.label ?? m.shipping}</dt>
              <dd>{order.shippingMinor === 0 ? m.freeShipping : money(order.shippingMinor)}</dd>
            </div>
          )}
          {order.discountMinor > 0 && (
            <div className="flex justify-between gap-4">
              <dt>{m.discount}</dt>
              <dd>−{money(order.discountMinor)}</dd>
            </div>
          )}
          {/* The discount staff gave, under the name they gave it. */}
          <StaffDiscountRow order={order} fallback={m.discount} money={money} />
          <OrderVatRelief order={order} text={vatWords} money={money} />
          <div className="flex justify-between gap-4 font-semibold">
            <dt>{m.total}</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
          <OrderVatRows order={order} text={vatWords} money={money} label={m.vatAmount} />
          {order.company && (
            // Bought for a business: the total without VAT, and whom for.
            <>
              <div className="flex justify-between gap-4 text-sm text-muted">
                <dt>{m.totalExclVat}</dt>
                <dd>{money(order.totalMinor - order.taxMinor)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-border pt-2 text-sm">
                <dt>{order.company.name}</dt>
                <dd>
                  {m.company.number}: {order.company.number}
                </dd>
              </div>
            </>
          )}
        </dl>
        <OrderVatNotes order={order} text={vatWords} />
      </section>

      {page.draft.noteToBuyer && (
        <section aria-labelledby="pay-note" className="flex flex-col gap-1 rounded-lg border border-border p-4">
          <h2 id="pay-note" className="font-medium">
            {w.noteHeading}
          </h2>
          {/* The store's own words, as text: line breaks kept, nothing else. */}
          <p className="whitespace-pre-line break-words">{page.draft.noteToBuyer}</p>
        </section>
      )}

      <p className="text-sm text-muted">{w.validUntil(date)}</p>

      {/* The sentence is the order email's rule (`withdrawBlocks()`): goods sent to a private buyer. A business has no statutory right, and a service's period runs from another day and can be lost by performance, so
          neither is told a goods-receipt period here. Their terms are the store's own, linked below where it has them. */}
      {order.ships && !order.company ? (
        <p className="text-sm">
          {w.withdrawal}
          {withdrawalHref && (
            <>
              {" "}
              <a href={withdrawalHref} target="_blank" rel="noopener" className="underline">
                {w.withdrawalLink}
                <span className="sr-only"> {m.terms.newTab}</span>
              </a>
            </>
          )}
        </p>
      ) : (
        withdrawalHref && (
          <p className="text-sm">
            <a href={withdrawalHref} target="_blank" rel="noopener" className="underline">
              {w.withdrawalLink}
              <span className="sr-only"> {m.terms.newTab}</span>
            </a>
          </p>
        )
      )}

      {page.state === "ready" ? (
        <PayForm
          store={store.slug}
          market={market.slug}
          token={token}
          display={terms}
          template={terms ? termsTemplate(m.terms, terms) : ""}
          newTab={m.terms.newTab}
          labels={{ pay: m.pay(money(order.totalMinor)), paying: m.startingPayment, stripeNote: w.stripeNote }}
          problems={problems}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p role="status">{w.paymentsOff}</p>
          {contact && <p>{w.contactStore(contact)}</p>}
        </div>
      )}
    </Frame>
  );
}

function Frame({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" data-pay-link>
      <h1 className="text-3xl font-heading tracking-tight">{heading}</h1>
      {children}
    </div>
  );
}
