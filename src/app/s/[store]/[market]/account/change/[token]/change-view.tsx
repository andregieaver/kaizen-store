import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import type { ChangePage } from "@/server/order-edit-pay";
import type { Store } from "@/server/stores";

import { ChangeForm, type ChangeProblemWords } from "./change-form";

/** The change page as the server found it, without the 404: what `ChangeView` draws. */
export type ChangePageFound = Exclude<ChangePage, { state: "not_found" }>;

/**
 * The pay link of a change to a paid order (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4), in the order's market's language. Presentational: the page loads everything and hands it in,
 * so a test can draw each state.
 *
 * What it shows before the customer agrees to pay more (Directive 2011/83/EU Art. 22, express consent to an extra payment): who sells (the page has no site footer), what the change takes off
 * and puts on (quantities and line totals), the shipping when it changed, the order's new total, what was already paid and what is to pay now, until when, the backorder days of added
 * units (D172), the right of withdrawal for the added goods with a link to the store's information, that the terms accepted with the order apply (with a link), and one button with the
 * amount. *Paid* and *ended* (cancelled or expired) are one plain sentence each, and an ended link shows nothing of the order; *payments off* and *too small* show the change without a
 * button. Every sentence here is hand-written text that needs legal review (`m.orderChange`, `docs/wave-3-fulfilment.md` section 8 item 3). No cookie, no tracking and no Stripe.js.
 */
export function ChangeView({
  page,
  store,
  market,
  token,
  termsHref,
  withdrawalHref,
}: {
  page: ChangePageFound;
  store: Store;
  market: Market;
  token: string;
  /** The store's published terms page, or null when it has none. */
  termsHref: string | null;
  /** The store's published withdrawal-information page, or null when it has none. */
  withdrawalHref: string | null;
}) {
  const m = t(market.lang);
  const w = m.orderChange;
  const { order, edit } = page;
  const contact = store.details.contactEmail;
  const heading = w.heading(order.number);

  if (page.state === "ended") {
    return (
      <Frame heading={heading}>
        <p role="status" className="text-lg">
          {w.ended}
        </p>
        {contact && <p>{w.contactStore(contact)}</p>}
      </Frame>
    );
  }
  if (page.state === "paid") {
    return (
      <Frame heading={heading}>
        <p role="status" className="text-lg">
          {w.paid}
        </p>
      </Frame>
    );
  }

  // The change is in the order's own currency (D109: never converted again).
  const money = (minor: number) => formatMoney(minor, edit.currency, market.locale);
  const date = edit.expiresAt ? new Date(edit.expiresAt).toLocaleString(market.locale, { dateStyle: "long", timeStyle: "short", timeZone: store.timeZone }) : null;
  const seller = store.details;
  const removed = edit.lines.filter((line) => line.kind !== "add");
  const added = edit.lines.filter((line) => line.kind === "add");
  const shippingChanged = edit.shippingAfterMinor !== edit.shippingBeforeMinor;
  const problems: ChangeProblemWords = {
    not_found: w.ended,
    ended: w.ended,
    paid: w.paid,
    payments_off: w.paymentsOff,
    too_small: w.tooSmall,
    // An earlier session for this change is still being processed by the bank: nothing new is opened, and trying again later is the advice.
    processing: w.startFailed,
    payment_error: w.startFailed,
    limit: w.startFailed,
  };
  const linkOut = (href: string, words: string) => (
    <a href={href} target="_blank" rel="noopener" className="underline">
      {words}
      <span className="sr-only"> {m.terms.newTab}</span>
    </a>
  );

  return (
    <Frame heading={heading}>
      <p>{w.intro}</p>

      {/* The seller: the page has no site footer, so who sells is said here (the name, the number, the address, a way to write). */}
      <section aria-labelledby="change-seller" className="flex flex-col gap-1 rounded-lg border border-border p-4">
        <h2 id="change-seller" className="font-medium">
          {w.sellerHeading}
        </h2>
        <p>{seller.legalName ?? store.name}</p>
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

      <section aria-label={m.orderSummary} className="flex flex-col gap-4 rounded-lg border border-border p-4">
        {removed.length > 0 && (
          <div>
            <h2 className="font-medium">{w.removed}</h2>
            <ul className="divide-y divide-border" data-change-removed>
              {removed.map((line) => (
                <li key={line.n} className="flex justify-between gap-4 py-2">
                  <span className="min-w-0 break-words">{`${line.quantity} × ${line.title}`}</span>
                  <span className="whitespace-nowrap">−{money(line.totalMinor)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {added.length > 0 && (
          <div>
            <h2 className="font-medium">{w.added}</h2>
            <ul className="divide-y divide-border" data-change-added>
              {added.map((line) => (
                <li key={line.n} className="flex justify-between gap-4 py-2">
                  <span className="min-w-0 break-words">{`${line.quantity} × ${line.title}`}</span>
                  <span className="whitespace-nowrap">{money(line.totalMinor)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="flex flex-col gap-1 border-t border-border pt-3">
          {shippingChanged && (
            <div className="flex justify-between gap-4">
              <dt>{m.shipping}</dt>
              <dd>{edit.shippingAfterMinor === 0 ? m.freeShipping : money(edit.shippingAfterMinor)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 font-semibold">
            <dt>{w.newTotal}</dt>
            <dd>{money(edit.totalAfterMinor)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{w.alreadyPaid}</dt>
            <dd>{money(page.alreadyPaidMinor)}</dd>
          </div>
        </dl>
        <p className="text-lg font-semibold" data-change-to-pay>
          {w.toPayNow(money(page.toPayMinor))}
        </p>
      </section>

      {date && <p>{w.payBy(money(page.toPayMinor), date)}</p>}

      {/* Added units the store's stock does not cover, with the days it states (D172); never a date, never "in stock". */}
      {page.backorders.map((b) =>
        b.days === null ? null : (
          <p key={b.title} className="text-sm" data-backorder>
            {`${b.title}: ${m.backorder.line(b.units, b.days)}`}
          </p>
        ),
      )}

      {/* The right of withdrawal covers the added goods like any goods (D153); a business buyer has no statutory right, and is pointed to the store's own information only. */}
      {added.length > 0 && !order.company ? (
        <p className="text-sm">
          {w.withdrawal}
          {withdrawalHref && <> {linkOut(withdrawalHref, w.withdrawalLink)}</>}
        </p>
      ) : (
        withdrawalHref && <p className="text-sm">{linkOut(withdrawalHref, w.withdrawalLink)}</p>
      )}

      <p className="text-sm">
        {w.terms}
        {termsHref && <> {linkOut(termsHref, w.termsLink)}</>}
      </p>

      {page.state === "ready" ? (
        <ChangeForm
          store={store.slug}
          market={market.slug}
          token={token}
          labels={{ pay: m.pay(money(page.toPayMinor)), paying: m.startingPayment, stripeNote: w.stripeNote }}
          problems={problems}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p role="status">{page.state === "too_small" ? w.tooSmall : w.paymentsOff}</p>
          {contact && <p>{w.contactStore(contact)}</p>}
        </div>
      )}
    </Frame>
  );
}

function Frame({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" data-change-link>
      <h1 className="text-3xl font-heading tracking-tight">{heading}</h1>
      {children}
    </div>
  );
}
