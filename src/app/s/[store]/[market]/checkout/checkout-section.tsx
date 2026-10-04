import Link from "next/link";
import { redirect } from "next/navigation";

import { BonusCredits } from "@/components/bonus-credits";
import { CheckoutButton } from "@/components/checkout-button";
import { CheckoutCodeForm } from "@/components/checkout-code-form";
import { CheckoutForm } from "@/components/checkout-form";
import { CheckoutTerms as CheckoutTermsView } from "@/components/checkout-terms";
import { DeliveryChoice } from "@/components/delivery-choice";
import { LineThumbnail } from "@/components/line-thumbnail";
import { LineUnitPrice } from "@/components/price";
import { VatNotes } from "@/components/vat-notes";
import { creditsNet } from "@/lib/bonus-shopper";
import { discountNote } from "@/lib/customer-tiers";
import { pickupPointLine } from "@/lib/delivery-options";
import { formatWindow } from "@/lib/porterbuddy";
import { bookingWhen, isRange } from "@/lib/booking-text";
import { withoutVat } from "@/lib/b2b";
import { CHECKOUT_MINUTES, stripeLocale } from "@/lib/checkout";
import { checkoutLabels } from "@/lib/checkout-labels";
import { termsTemplate, type TermsDisplay } from "@/lib/checkout-terms";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { IMPORT_NOTICE_REASONS, vatRowsWhenMixed } from "@/lib/order-vat";
import { marketPath } from "@/lib/paths";
import { vatText } from "@/lib/vat-text";
import { readCartId } from "@/server/cart";
import { getOpenCheckout } from "@/server/checkout";
import { termsDisplayFor } from "@/server/checkout-terms";
import { cartRemindersOn, checkoutOptedOut } from "@/server/cart-reminders";
import { getCustomer } from "@/server/customers";
import { deliveryView } from "@/server/delivery-choice";
import { getCartCode } from "@/server/discounts";
import { getOrder } from "@/server/orders";
import { perRequest } from "@/server/request-memo";
import { platformPublishableKey } from "@/server/stripe";
import type { Store } from "@/server/stores";

import { readCartBonus } from "../cart/bonus";
import { checkoutCreditsAction } from "./actions";

type CheckoutView = NonNullable<Awaited<ReturnType<typeof loadCheckoutView>>>;

/** The order waiting for payment and what its pieces need of it, read once for a request whichever pieces a page holds (D117). */
function checkoutView(store: Store, market: Market) {
  return perRequest(`checkout:${store.id}:${market.slug}`, () => loadCheckoutView(store, market));
}

async function loadCheckoutView(store: Store, market: Market) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const cartId = await readCartId({ storeId: store.id, market });
  const open = cartId ? await getOpenCheckout(store.id, cartId) : null;
  const order = open ? await getOrder(store.id, open.orderId) : null;
  if (!cartId || !open || !order) return null;
  const bonus = await readCartBonus(store, market, cartId);
  return { m, base, cartId, open, order, bonus, timeZone: store.timeZone };
}

/** The checkout's view, or back to the cart when no order is waiting for payment. */
async function requireCheckout(store: Store, market: Market) {
  const view = await checkoutView(store, market);
  if (!view) redirect(`${marketPath(store.slug, market.slug)}/cart`);
  return view;
}

const moneyOf = (view: CheckoutView, market: Market) => (minor: number) =>
  formatMoney(minor, view.order.currency, market.locale);

/**
 * Kaizen's checkout (decision D22): the order placed from the cart, paid with
 * Stripe's form on the store's own Stripe account. The cart's checkout button
 * places the order and sends the shopper here; without an order waiting for
 * payment, the shopper is sent back to the cart. The checkout page shows it,
 * and so does a store's own page for it (D113), whole or in pieces (D117:
 * `CheckoutItems`, `CheckoutCode`, `CheckoutTotals`, `CheckoutPayment`,
 * `CheckoutBack`).
 */
export async function Checkout({ store, market, drawTerms = true }: { store: Store; market: Market; drawTerms?: boolean }) {
  const view = await requireCheckout(store, market);
  const { m, base } = view;
  const credits = creditsBlock(store, market, view);
  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-start">
      <section aria-labelledby="summary-heading" className="rounded-lg border border-border p-4 md:sticky md:top-4">
        <h2 id="summary-heading" className="mb-3 font-medium">
          {m.orderSummary}
        </h2>
        {itemsList(view, market)}
        <div className="mt-3 border-t border-border pt-3">
          {codeForm(store, market, view, await cartCodeOf(store, market))}
        </div>
        {credits && <div className="mt-3 border-t border-border pt-3">{credits}</div>}
        <div className="mt-3 border-t border-border pt-3">{totalsList(view, market)}</div>
      </section>
      <div className="flex flex-col gap-6 md:order-first">
        {await deliveryBlock(store, market, view)}
        {await paymentForm(store, market, view, drawTerms)}
        <Link href={`${base}/cart`} className="text-sm underline">
          {m.backToCart}
        </Link>
      </div>
    </div>
  );
}

const cartCodeOf = (store: Store, market: Market) => getCartCode({ storeId: store.id, market });

/** The order's lines, as the shopper is about to pay for them (D117). */
export async function CheckoutItems({ store, market }: { store: Store; market: Market }) {
  return itemsList(await requireCheckout(store, market), market);
}

/** The field for a discount code at the checkout (D117). */
export async function CheckoutCode({ store, market }: { store: Store; market: Market }) {
  const [view, code] = await Promise.all([requireCheckout(store, market), cartCodeOf(store, market)]);
  return codeForm(store, market, view, code);
}

/** The bonus credits at the checkout (D130, D117): use them, or what this order earns; nothing in a store without the program. */
export async function CheckoutCredits({ store, market }: { store: Store; market: Market }) {
  return creditsBlock(store, market, await requireCheckout(store, market));
}

/** How the order is delivered (D135, D117): the flat rate and a carrier's services to choose from. Nothing when there is nothing to choose. */
export async function CheckoutDelivery({ store, market }: { store: Store; market: Market }) {
  return deliveryBlock(store, market, await requireCheckout(store, market));
}

/** The order's subtotal, shipping, discounts and total, with the company and a subscription's terms (D117). */
export async function CheckoutTotals({ store, market }: { store: Store; market: Market }) {
  return totalsList(await requireCheckout(store, market), market);
}

/**
 * Contact, delivery and payment, or the button to start over when the checkout has expired (D117). It draws the terms sentence
 * above its pay button itself unless the page holds the terms piece (`drawTerms` false), so no store's checkout is without it.
 */
export async function CheckoutPayment({ store, market, drawTerms = true }: { store: Store; market: Market; drawTerms?: boolean }) {
  return paymentForm(store, market, await requireCheckout(store, market), drawTerms);
}

/**
 * The sentence by the pay button, with or without a tick box (wave 1, 1e, `stores.terms_at_checkout`): the store's terms and privacy
 * statement as links. Nothing when the store shows none, has chosen no page, or the checkout starts over (nothing to pay).
 */
export async function CheckoutTerms({ store, market }: { store: Store; market: Market }) {
  const view = await requireCheckout(store, market);
  const publishableKey = platformPublishableKey(view.open.mode);
  if (view.open.expired || view.open.changed || !publishableKey) return null;
  return termsNode(store, market, view, await termsDisplayFor(store, market));
}

function termsNode(store: Store, market: Market, view: CheckoutView, display: TermsDisplay | null) {
  if (!display) return null;
  const words = view.m.terms;
  return <CheckoutTermsView store={store.slug} market={market.slug} display={display} template={termsTemplate(words, display)} newTab={words.newTab} />;
}

/** A link back to the cart (D117). */
export async function CheckoutBack({ store, market }: { store: Store; market: Market }) {
  const { m, base } = await requireCheckout(store, market);
  return (
    <Link href={`${base}/cart`} className="text-sm underline">
      {m.backToCart}
    </Link>
  );
}

function itemsList(view: CheckoutView, market: Market) {
  const { m, order } = view;
  const money = moneyOf(view, market);
  // A business sees amounts without VAT, and the VAT on its own line (B2B).
  const business = order.company !== null;
  // Each line at its own VAT rate, shipping at the standard one (D65).
  const net = (minor: number, rate: number) => money(business ? withoutVat(minor, rate) : minor);
  return (
    <ul className="divide-y divide-border">
      {order.lines.map((line) => (
        <li key={line.id} className="flex items-center gap-3 py-2 text-sm">
          <LineThumbnail src={line.image} size={40} />
          <span className="min-w-0 flex-1">
            {isRange(line.booking) ? line.title : `${line.quantity} × ${line.title}`}
            {line.booking && <span className="block">{bookingWhen(line.booking, order.locale, m)}</span>}
            {/* The price per kg, litre or metre from the order line's own price and the content it was sold with (D160), as the line shows its amount. */}
            <LineUnitPrice
              shownMinor={business ? withoutVat(line.unitPriceMinor, line.taxRate) : line.unitPriceMinor}
              measure={line.measure}
              gift={line.gift}
              currency={order.currency}
              locale={market.locale}
              m={m}
            />
          </span>
          <span className="whitespace-nowrap">
            {line.gift ? (
              <>
                <span className="text-muted line-through">
                  {net(line.unitPriceMinor * line.quantity, line.taxRate)}
                </span>{" "}
                {m.freeGift}
              </>
            ) : (
              net(line.unitPriceMinor * line.quantity, line.taxRate)
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function codeForm(store: Store, market: Market, view: CheckoutView, cartCode: string | null) {
  const { m } = view;
  return (
    <CheckoutCodeForm
      store={store.slug}
      market={market.slug}
      code={cartCode}
      labels={{
        label: m.haveCode,
        code: m.discountCode,
        apply: m.applyCode,
        remove: m.removeCode,
        applying: m.savingChange,
      }}
    />
  );
}

function creditsBlock(store: Store, market: Market, view: CheckoutView) {
  if (!view.bonus) return null;
  return (
    <BonusCredits
      bonus={view.bonus}
      m={view.m}
      currency={market.currency}
      locale={market.locale}
      signInHref={marketPath(store.slug, market.slug, "/account")}
      action={checkoutCreditsAction.bind(null, store.slug, market.slug)}
    />
  );
}

function totalsList(view: CheckoutView, market: Market) {
  const { m, order, open } = view;
  const money = moneyOf(view, market);
  // A subscription's terms, repeated where the shopper pays (D25).
  const renewal = open.subscription
    ? m.renewsEvery(
        m.planEvery(open.subscription.interval, open.subscription.intervalCount),
        money(open.subscription.totalMinor),
      )
    : null;
  const business = order.company !== null;
  const net = (minor: number, rate: number) => money(business ? withoutVat(minor, rate) : minor);
  const linesNet = order.lines.reduce(
    (sum, line) => sum + withoutVat(line.unitPriceMinor * line.quantity, line.taxRate),
    0,
  );
  const shippingNet = withoutVat(order.shippingMinor, order.shippingVatRate);
  const bonusMinor = order.bonus?.usedMinor ?? 0;
  // Bonus credits (D130) are a line of their own, so a business's discount, worked out from the total, leaves them out.
  const bonusNet = business
    ? creditsNet(
        bonusMinor,
        order.lines.filter((line) => !line.gift).map((line) => ({ minor: line.unitPriceMinor * line.quantity, rate: line.taxRate })),
      )
    : bonusMinor;
  // So is the friend's welcome discount (D131).
  const referralMinor = order.referralDiscountMinor;
  const referralNet = business
    ? creditsNet(
        referralMinor,
        order.lines.filter((line) => !line.gift).map((line) => ({ minor: line.unitPriceMinor * line.quantity, rate: line.taxRate })),
      )
    : referralMinor;
  const vatWords = vatText(market.lang);
  const reverse = order.vatKind === "reverse_charge";
  const discountNet = linesNet + shippingNet - (order.totalMinor - order.taxMinor) - (business ? bonusNet + referralNet : 0);
  return (
    <>
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <dt>{m.subtotal}</dt>
          <dd>{money(business ? linesNet : order.subtotalMinor)}</dd>
        </div>
        {order.ships && (
          <div className="flex justify-between">
            <dt>{order.delivery?.label ?? m.shipping}</dt>
            <dd>{order.shippingMinor === 0 ? m.freeShipping : net(order.shippingMinor, order.shippingVatRate)}</dd>
          </div>
        )}
        {order.ships && order.delivery?.pickupPoint && (
          <p className="text-muted">{m.deliveryChoice.pickupAt(pickupPointLine(order.delivery.pickupPoint))}</p>
        )}
        {order.ships && order.delivery?.window && (
          <p className="text-muted">{m.deliveryChoice.windowLine(formatWindow(order.delivery.window, order.locale, view.timeZone))}</p>
        )}
        {order.discountMinor > 0 && (
          <div className="flex justify-between">
            <dt>
              {m.discount}
              {discountNote(order) && <span className="text-sm text-muted"> ({discountNote(order)})</span>}
            </dt>
            <dd>−{money(business ? discountNet : order.discountMinor)}</dd>
          </div>
        )}
        {referralMinor > 0 && (
          <div className="flex justify-between">
            <dt>{m.affiliate.discountRow}</dt>
            <dd>−{money(referralNet)}</dd>
          </div>
        )}
        {bonusMinor > 0 && (
          <div className="flex justify-between">
            <dt>{m.bonus.discountRow}</dt>
            <dd>−{money(bonusNet)}</dd>
          </div>
        )}
        {business ? (
          <>
            <div className="flex justify-between border-t border-border pt-1">
              <dt>{m.totalExclVat}</dt>
              <dd>{money(order.totalMinor - order.taxMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{reverse ? vatWords.vatLineReverse : m.vatLine}</dt>
              <dd>{money(order.taxMinor)}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>{m.toPay}</dt>
              <dd>{money(order.totalMinor)}</dd>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-base font-semibold">
              <dt>{m.total}</dt>
              <dd>{money(order.totalMinor)}</dd>
            </div>
            {vatRowsWhenMixed(order).length > 0 ? (
              // More than one rate: each on its own row (D157).
              vatRowsWhenMixed(order).map((row) => (
                <div key={row.rate} className="flex justify-between text-muted">
                  <dt>{vatWords.vatAtRate(row.rate)}</dt>
                  <dd>{money(row.taxMinor)}</dd>
                </div>
              ))
            ) : (
              <div className="flex justify-between text-muted">
                <dt>{m.vatAmount}</dt>
                <dd>{money(order.taxMinor)}</dd>
              </div>
            )}
          </>
        )}
        {order.balanceMinor > 0 && (
          <>
            <div className="flex justify-between">
              <dt>{m.booking.dueNow}</dt>
              <dd>{money(order.totalMinor - order.balanceMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{m.booking.atVenue}</dt>
              <dd>{money(order.balanceMinor)}</dd>
            </div>
          </>
        )}
      </dl>
      <VatNotes
        text={vatWords}
        reverseCharge={reverse}
        sellerNumber={order.vat?.sellerVatNumber ?? null}
        buyerNumber={order.vat?.buyerVatNumber ?? null}
        iossNumber={null}
        importNotice={order.vat !== null && IMPORT_NOTICE_REASONS.includes(order.vat.reason)}
      />
      {order.company && (
        <p className="mt-3 border-t border-border pt-3 text-sm">
          {order.company.name}
          <span className="block text-muted">
            {m.company.number}: {order.company.number}
          </span>
        </p>
      )}
      {renewal && <p className="mt-3 border-t border-border pt-3 text-sm">{renewal}</p>}
    </>
  );
}

async function deliveryBlock(store: Store, market: Market, view: CheckoutView) {
  const { m, cartId, open, order } = view;
  // Not while the checkout is over and starts again: there is no order to change.
  if (open.expired || open.changed || open.subscription) return null;
  const options = await deliveryView({ storeId: store.id, market }, cartId, m.shipping);
  if (!options) return null;
  const d = m.deliveryChoice;
  return (
    <DeliveryChoice
      store={store.slug}
      market={market.slug}
      initial={options}
      currency={order.currency}
      locale={market.locale}
      business={order.company !== null}
      vatRate={order.shippingVatRate}
      timeZone={store.timeZone}
      labels={{
        heading: d.heading,
        postalCode: d.postalCode,
        lookUp: d.lookUp,
        looking: d.looking,
        intro: d.intro,
        problems: d.problems,
        free: m.freeShipping,
        workingDays: d.workingDays("{range}"),
        pickupHeading: d.pickupHeading,
        choose: d.choose,
        choosing: d.choosing,
      }}
    />
  );
}

async function paymentForm(store: Store, market: Market, view: CheckoutView, drawTerms: boolean) {
  const { m, base, cartId, open, order } = view;
  const publishableKey = platformPublishableKey(open.mode);
  const [customer, reminders, display] = await Promise.all([getCustomer(store.id), cartRemindersOn(store.id), termsDisplayFor(store, market)]);
  const optedOut = reminders && !customer ? await checkoutOptedOut(store.id, cartId) : false;
  const money = moneyOf(view, market);
  const restart = open.expired || open.changed || !publishableKey;
  return (
    <>
      {restart ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <p role="status">
            {!publishableKey ? m.checkoutUnavailable : open.changed ? m.checkoutChanged : m.checkoutExpired}
          </p>
          {publishableKey && (
            <CheckoutButton
              store={store.slug}
              market={market.slug}
              disabled={false}
              labels={checkoutLabels(m, m.restartCheckout)}
              consents={{
                digital: open.digital ? m.digitalConsent : undefined,
                subscription: open.subscription
                  ? m.subscriptionConsent(
                      m.planEvery(open.subscription.interval, open.subscription.intervalCount),
                      money(open.subscription.totalMinor),
                    )
                  : undefined,
              }}
            />
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">{m.heldFor(CHECKOUT_MINUTES)}</p>
          <CheckoutForm
            publishableKey={publishableKey}
            stripeAccount={open.accountId}
            clientSecret={open.clientSecret}
            locale={stripeLocale(market.lang)}
            ships={open.ships}
            labels={{
              contact: m.contact,
              delivery: m.delivery,
              payment: m.payment,
              // What Stripe takes now; a part paid at the appointment is not in it (D66).
              pay: m.pay(money(order.totalMinor - order.balanceMinor)),
              paying: m.paying,
              loading: m.loadingPayment,
              unavailable: m.paymentUnavailable,
              secure: m.securePayment,
              expired: m.checkoutExpired,
              backToCart: m.backToCart,
              seeOrder: m.seeOrder,
            }}
            account={
              customer
                ? null
                : {
                    store: store.slug,
                    market: market.slug,
                    labels: {
                      create: m.account.checkoutAccount,
                      hint: m.account.checkoutAccountHint,
                      password: m.account.password,
                      rule: m.account.passwordRule,
                    },
                  }
            }
            reminders={
              reminders && !customer
                ? {
                    store: store.slug,
                    market: market.slug,
                    optedOut,
                    labels: {
                      notice: m.cartReminderNotice,
                      optOut: m.cartReminderOptOut,
                      optedOut: m.cartReminderOptedOut,
                      undo: m.cartReminderUndo,
                    },
                  }
                : null
            }
            // The terms (wave 1, 1e): drawn by the pay button unless the page has its own piece for them.
            termsSlot={drawTerms ? termsNode(store, market, view, display) : null}
            terms={display ? { store: store.slug, market: market.slug, display, labels: { hint: m.terms.hint, failed: m.terms.failed } } : null}
            links={{
              cart: `${base}/cart`,
              order: `${base}/order/${open.orderId}?session_id=${encodeURIComponent(open.sessionId)}`,
            }}
          />
        </>
      )}
    </>
  );
}
