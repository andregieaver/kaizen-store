import Link from "next/link";
import { redirect } from "next/navigation";

import { BonusCredits } from "@/components/bonus-credits";
import { CheckoutButton } from "@/components/checkout-button";
import { CheckoutCodeForm } from "@/components/checkout-code-form";
import { DeliveryChoice } from "@/components/delivery-choice";
import { CheckoutForm } from "@/components/lazy/shop";
import { CheckoutTerms as CheckoutTermsView } from "@/components/checkout-terms";
import { GiftCardForm } from "@/components/gift-card-form";
import { GiftNote } from "@/components/gift-note";
import { HoldClock } from "@/components/hold-clock";
import { BackorderLine } from "@/components/backorder-note";
import { LineThumbnail } from "@/components/line-thumbnail";
import { LogoPicture } from "@/components/logo-picture";
import { LineUnitPrice } from "@/components/price";
import { VatNotes } from "@/components/vat-notes";
import { offersAccountAtCheckout } from "@/lib/customer-accounts";
import { creditsNet } from "@/lib/bonus-shopper";
import { discountNote } from "@/lib/customer-tiers";
import { pickupPointLine } from "@/lib/delivery-options";
import { deliveryRowLabel, withDeliveryWords } from "@/lib/delivery-words";
import { formatWindow } from "@/lib/porterbuddy";
import { bookingWhen, isRange } from "@/lib/booking-text";
import { withoutVat } from "@/lib/b2b";
import { CHECKOUT_MINUTES, stripeLocale } from "@/lib/checkout";
import { checkoutLabels } from "@/lib/checkout-labels";
import { customsText, orderCustomsSentence } from "@/lib/customs-text";
import { checkoutAppearanceFor, checkoutLookOf } from "@/lib/checkout-look";
import { fontStack } from "@/lib/fonts";
import { darkBehindLogo, isDarkColor } from "@/lib/theme";
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
import { findFont } from "@/server/fonts";
import { deliveryView } from "@/server/delivery-choice";
import { orderCodeOutcomes, type CodeOutcome } from "@/server/discounts";
import { codeProblemText } from "@/lib/code-words";
import { shownCartGiftCards } from "@/lib/gift-card-words";
import { checkoutGiftCards } from "@/server/gift-card-cart";
import { getOrder } from "@/server/orders";
import { perRequest } from "@/server/request-memo";
import { platformPublishableKey } from "@/server/stripe";
import type { Store } from "@/server/stores";

import { readCartBonus } from "../cart/bonus";
import { checkoutCreditsAction, checkoutGiftCardAction, checkoutRemoveGiftCardAction } from "./actions";

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
  // The gift cards the order is paid with (D300 F3), as the order holds them.
  const giftCards = await checkoutGiftCards(store.id, cartId, open.orderId, market.currency);
  return { m, base, cartId, open, order, bonus, giftCards, timeZone: store.timeZone };
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
          {codeForm(store, market, view, await cartCodesOf(store, market, view))}
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

/** The cart's codes and what became of each on the order (D299 E2). */
const cartCodesOf = (store: Store, market: Market, view: CheckoutView) => orderCodeOutcomes({ storeId: store.id, market }, view.open.orderId);

/** The order's lines, as the shopper is about to pay for them (D117). */
export async function CheckoutItems({ store, market }: { store: Store; market: Market }) {
  return itemsList(await requireCheckout(store, market), market);
}

/** The field for a discount code at the checkout (D117). */
export async function CheckoutCode({ store, market }: { store: Store; market: Market }) {
  const view = await requireCheckout(store, market);
  return codeForm(store, market, view, await cartCodesOf(store, market, view));
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
    <>
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
            {/* What is on backorder (D172): the order's own figure, provisional until it is paid. */}
            <BackorderLine backorder={line.backorder} m={m} locale={market.locale} />
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
    {/* The buyer's own gift message as the order holds it, read-only (D173); changing it starts the checkout again, from the cart. */}
    <GiftNote gift={order.gift} m={m} size="small" />
    </>
  );
}

function codeForm(store: Store, market: Market, view: CheckoutView, codes: CodeOutcome[] | null) {
  const { m } = view;
  const money = moneyOf(view, market);
  return (
    <div className="flex flex-col gap-3">
      <CheckoutCodeForm
      store={store.slug}
      market={market.slug}
      codes={(codes ?? []).map((c) => ({ code: c.code, problem: c.ok ? null : codeProblemText(m, c, money) }))}
      full={m.codeProblems.codes_full}
      labels={{
        label: m.haveCode,
        code: m.discountCode,
        apply: m.applyCode,
        remove: m.removeCode,
        applying: m.savingChange,
      }}
    />
      <GiftCardForm
        cards={shownCartGiftCards(view.giftCards, m, money)}
        full={m.giftCardPay.problems.full}
        apply={checkoutGiftCardAction.bind(null, store.slug, market.slug)}
        remove={checkoutRemoveGiftCardAction.bind(null, store.slug, market.slug)}
        labels={{ field: m.giftCardPay.field, apply: m.giftCardPay.apply, applying: m.giftCardPay.applying, remove: m.giftCardPay.remove }}
      />
    </div>
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
  // What the order's gift cards pay (D300 F3), as it holds them.
  const cardsPaid = view.giftCards.reduce((sum, card) => sum + card.amountMinor, 0);
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
            <dt>{deliveryRowLabel(order.deliveryKept ?? order.delivery, m)}</dt>
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
        {(order.dutiesMinor ?? 0) > 0 && (
          // Duties and import VAT collected at checkout (DDP, D343): an estimate, beside the total and paid with it.
          <>
            <div className="flex justify-between" data-customs-row>
              <dt>
                {customsText(market.lang).dutiesLine} <span className="text-sm text-muted">({customsText(market.lang).estimate})</span>
              </dt>
              <dd>{money(order.dutiesMinor)}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>{m.toPay}</dt>
              <dd>{money(order.totalMinor + order.dutiesMinor)}</dd>
            </div>
          </>
        )}
        {cardsPaid > 0 && (
          // Gift cards (D300 F3): a payment after the total, never a discount before it.
          <div className="flex justify-between">
            <dt>{m.giftCardPay.paidWith}</dt>
            <dd>−{money(cardsPaid)}</dd>
          </div>
        )}
        {(order.balanceMinor > 0 || cardsPaid > 0) && (
          <div className="flex justify-between">
            <dt>{m.booking.dueNow}</dt>
            <dd>{money(order.totalMinor - order.balanceMinor - cardsPaid + (order.dutiesMinor ?? 0))}</dd>
          </div>
        )}
        {order.balanceMinor > 0 && (
          <div className="flex justify-between">
            <dt>{m.booking.atVenue}</dt>
            <dd>{money(order.balanceMinor)}</dd>
          </div>
        )}
      </dl>
      <VatNotes
        text={vatWords}
        reverseCharge={reverse}
        sellerNumber={order.vat?.sellerVatNumber ?? null}
        buyerNumber={order.vat?.buyerVatNumber ?? null}
        iossNumber={null}
        importNotice={order.vat !== null && IMPORT_NOTICE_REASONS.includes(order.vat.reason) && !order.customs}
      />
      {/* Customs and duties (D343): who pays them, and the estimate. */}
      {orderCustomsSentence(order.customs ?? null, customsText(market.lang), money) && (
        <p className="mt-2 text-sm text-muted" data-customs-note>
          {orderCustomsSentence(order.customs ?? null, customsText(market.lang), money)}
        </p>
      )}
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
  const found = await deliveryView({ storeId: store.id, market }, cartId, m.shipping);
  if (!found) return null;
  // A pickup place's ready time and today's hours as sentences (D237): the client component gets words, never functions.
  const options = withDeliveryWords(found, m, { locale: market.locale, timeZone: store.timeZone });
  const d = m.deliveryChoice;
  const o = m.deliveryOptions;
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
        shipGroup: o.shipGroup,
        localGroup: o.localGroup,
        collectGroup: o.collectGroup,
        noteLabel: o.noteLabel,
        noteHint: o.noteHint,
        instructions: o.instructions,
        // Templates the component fills in: the minimum as it shows prices, the postal code typed.
        localFrom: o.localFrom("{minimum}"),
        noShipping: o.noShipping("{code}"),
        noShippingAnywhere: o.noShippingAnywhere,
        needCode: o.priceInfo.needCode,
        changed: o.priceInfo.changed,
        noteProblem: o.problems.note,
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
  // The checkout's look (D337): Stripe's form in the theme's colours, body font and corners, and the owner's *Checkout look* choices.
  const theme = store.theme.settings;
  const look = checkoutLookOf(theme);
  const bodyFont = theme.fonts.body ? findFont(theme.fonts.body) : null;
  const panel = look.background === "surface";
  return (
    <div data-checkout-look={look.background} className={`checkout-look flex flex-col gap-6 ${panel ? "rounded-lg bg-surface p-4 md:p-6" : ""}`}>
      {look.mark && store.navigation.logo && (
        <LogoPicture
          logo={store.navigation.logo}
          logoDark={store.navigation.logoDark}
          darkBehind={panel ? { light: isDarkColor(theme.light.surface), dark: isDarkColor(theme.dark.surface) } : darkBehindLogo(theme, "page")}
          alt={store.name}
          className="h-10 w-auto max-w-56 min-w-0 object-contain object-left"
        />
      )}
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
              labels={checkoutLabels(m, m.restartCheckout, market.lang)}
              consents={{
                digital: open.digital ? m.digitalConsent : undefined,
                service: open.serviceRequest ? m.serviceRequest : undefined,
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
          <HoldClock secondsLeft={open.secondsLeft} held={m.heldFor(CHECKOUT_MINUTES)} ending={m.holdEnding} />
          <CheckoutForm
            look={checkoutAppearanceFor(theme, bodyFont ? fontStack(bodyFont.family, bodyFont.category) : null)}
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
              // Opening an account with the order is offered only where accounts are optional (D365).
              customer || !offersAccountAtCheckout(store)
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
            // Marketing email (D295): an unticked box; its words are what the shopper agrees to.
            news={{ store: store.slug, market: market.slug, labels: { consent: m.news.consent(store.name) } }}
            // The terms (wave 1, 1e): drawn by the pay button unless the page has its own piece for them.
            termsSlot={drawTerms ? termsNode(store, market, view, display) : null}
            terms={display ? { store: store.slug, market: market.slug, display, labels: { hint: m.terms.hint, failed: m.terms.failed } } : null}
            // The delivery settled before paying (D237 2.4 point 4): a postal code where the price needs one, something that delivers, no stale choice.
            delivery={
              order.ships
                ? {
                    store: store.slug,
                    market: market.slug,
                    labels: {
                      postal_code: m.deliveryOptions.priceInfo.needCode,
                      changed: m.deliveryOptions.priceInfo.changed,
                      no_shipping: m.deliveryOptions.noShippingAnywhere,
                      seeNewPrice: m.deliveryOptions.seeNewPrice,
                      checkFailed: m.deliveryOptions.checkFailed,
                    },
                  }
                : null
            }
            links={{
              cart: `${base}/cart`,
              order: `${base}/order/${open.orderId}?session_id=${encodeURIComponent(open.sessionId)}`,
            }}
          />
        </>
      )}
    </div>
  );
}
