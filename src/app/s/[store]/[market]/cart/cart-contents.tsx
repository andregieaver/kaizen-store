import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";

import { BackorderLine } from "@/components/backorder-note";
import { BonusCredits } from "@/components/bonus-credits";
import { CheckoutButton } from "@/components/checkout-button";
import { CartQuantity } from "@/components/cart-quantity";
import { QuoteRequest } from "@/components/quote-request";
import { ExpressArea } from "@/components/express-area";
import { KlarnaMessage } from "@/components/klarna-message";
import { DiscountCodeForm } from "@/components/discount-code-form";
import { GiftCardForm } from "@/components/gift-card-form";
import { shownCartGiftCards } from "@/lib/gift-card-words";
import { codeProblemText } from "@/lib/code-words";
import { LineUnitPrice } from "@/components/price";
import { VatNotes } from "@/components/vat-notes";
import { discountNote } from "@/lib/customer-tiers";
import { deliveryRowLabel, priceLaterFrom } from "@/lib/delivery-words";
import { withoutVat } from "@/lib/b2b";
import { bookingWhen, isRange, rangeLength } from "@/lib/booking-text";
import { creditsNet } from "@/lib/bonus-shopper";
import { nextStepText } from "@/lib/campaign-notices";
import { campaignLabel } from "@/lib/campaigns";
import { ruleWords } from "@/lib/quantity-rules";
import { checkoutLabels } from "@/lib/checkout-labels";
import { cartCustomsSentences, customsText } from "@/lib/customs-text";
import { optionLabel, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath, marketHome } from "@/lib/paths";
import { countryOfVatPrefix } from "@/lib/vat-number";
import { countryName, vatNumberMessage, vatProblemTexts } from "@/lib/vat-text";
import { getRecommendSettings } from "@/server/recommend-settings";
import { CartUpsell } from "@/components/cart-upsell";
import type { Store } from "@/server/stores";

import { applyGiftCardAction, companyPurchaseAction, removeGiftCardAction, setCartCreditsAction, updateCartLine } from "./actions";
import { CompanyPurchase } from "./company-purchase";
import { GiftBox } from "./cart-gift";
import { cartView, type Filled } from "./cart-view";

type Draw = { store: Store; market: Market; m: Messages; view: Filled };

const EMPTY_CART = (home: string, m: Messages) => (
  <div className="flex flex-col items-start gap-4">
    <p>{m.emptyCart}</p>
    <Link href={home || "/"} className="underline">
      {m.continueShopping}
    </Link>
  </div>
);

/**
 * The shopper's cart: its lines, summary and way to checkout. The cart page
 * shows it, and on phones the slide-out cart (`@drawer/(.)cart`) too; a
 * store's own page for the cart (D113) holds it whole, or in pieces (D117:
 * `CartLines`, `CartSummary`, `CartCode`, `CartCheckout`, `CartContinue`).
 */
export async function CartContents({
  store,
  market,
  m,
  drawer = false,
}: {
  store: Store;
  market: Market;
  m: Messages;
  /** In the slide-out cart (D64): narrower, so smaller pictures and the summary without a frame. */
  drawer?: boolean;
}) {
  const view = await cartView(store, market, m);
  if (view.empty) return EMPTY_CART(view.home, m);
  const draw = { store, market, m, view };
  // What goes with the cart (D559): in the standard cart and the slide-out cart while the store's recommendations are on.
  const upsell = (await getRecommendSettings(store.id)).enabled ? (
    <Suspense fallback={null}>
      <CartUpsell store={store} market={market} m={m} compact={drawer} />
    </Suspense>
  ) : null;
  return (
    // minmax(0, …): nothing inside may make a column wider than the screen.
    <div className={`grid grid-cols-[minmax(0,1fr)] ${drawer ? "gap-4" : "gap-8 md:grid-cols-[minmax(0,1fr)_18rem]"}`}>
      <div className="flex min-w-0 flex-col gap-4">
        {linesList(draw, drawer)}
        {giftBox(draw)}
        {!drawer && upsell}
      </div>
      <aside
        aria-label={m.subtotal}
        className={`flex h-fit min-w-0 flex-col gap-3 ${drawer ? "" : "rounded-lg border border-border p-4"}`}
      >
        {summaryList(draw)}
        {codeForm(draw)}
        {creditsForm(draw)}
        {checkoutAction(draw)}
      </aside>
      {drawer && upsell}
    </div>
  );
}

/** The cart's lines and the free gifts, or that it is empty (D117). */
export async function CartLines({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  return view.empty ? EMPTY_CART(view.home, m) : linesList({ store, market, m, view }, false);
}

/** The cart's gift box (wave 3, D173): a tick and To, From and a message; nothing for an empty cart or a store with gift messages switched off. */
export async function CartGift({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  return view.empty ? null : giftBox({ store, market, m, view });
}

/** The cart's subtotal, shipping, discounts and total (D117); nothing for an empty cart. */
export async function CartSummary({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  return view.empty ? null : (
    <div className="flex min-w-0 flex-col gap-3">{summaryList({ store, market, m, view })}</div>
  );
}

/** The cart's field for a discount code (D117); nothing for an empty cart. */
export async function CartCode({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  return view.empty ? null : (
    <div className="flex flex-col gap-3">
      {codeForm({ store, market, m, view })}
      {giftCardForm({ store, market, m, view })}
    </div>
  );
}

/** The cart's bonus credits (D130, D117): use them, or what this order earns; nothing for an empty cart or a store without the program. */
export async function CartCredits({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  return view.empty ? null : creditsForm({ store, market, m, view });
}

/** The cart's checkout button and what it asks first (D117); nothing for an empty cart. */
export async function CartCheckout({ store, market, m, drawGift = false }: { store: Store; market: Market; m: Messages; drawGift?: boolean }) {
  const view = await cartView(store, market, m);
  return view.empty ? null : (
    <div className="flex min-w-0 flex-col gap-3">
      {/* A cart page built before gift messages came has no gift piece: the box is drawn here, above the button, so switching the store's gift messages on still shows it (`drawGift`, as the terms are). */}
      {drawGift && giftBox({ store, market, m, view })}
      {checkoutAction({ store, market, m, view })}
    </div>
  );
}

/** A link back to the store (D117). */
export function CartContinue({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  return (
    <Link href={marketHome(store.slug, market.slug)} className="underline">
      {m.continueShopping}
    </Link>
  );
}

/** The gift box (D173): null for a store with gift messages switched off. */
function giftBox({ store, market, view }: Draw) {
  if (!view.gift.enabled) return null;
  return <GiftBox store={store.slug} market={market.slug} lang={market.lang} initial={view.gift.gift} />;
}

function linesList({ store, market, m, view }: Draw, drawer: boolean) {
  const { cart, summary, net, money } = view;
  const { trial, gifts } = summary;
  const home = view.home;
  return (
    <ul className={`divide-y divide-border border-border ${drawer ? "border-b" : "border-y"}`}>
      {cart.lines.map((line) => (
        <li
          key={`${line.variantId}:${line.plan?.id ?? ""}:${line.booking?.startsAt ?? ""}`}
          className={`flex py-4 ${drawer ? "gap-3" : "gap-4"}`}
        >
          {line.image && (
            <Image
              src={line.image.url}
              alt={line.image.alt}
              width={96}
              height={96}
              unoptimized
              className={`${drawer ? "size-16" : "size-24"} shrink-0 rounded-md bg-surface object-cover`}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex justify-between gap-4">
              <div className="min-w-0">
                <Link href={`${home}/p/${line.handle}`} className="font-medium underline-offset-2 hover:underline">
                  {line.title}
                </Link>
                {/* A gift card (D300) is named by its amount; what is said of it is who it goes to and when, else that it comes to the buyer. */}
                {line.giftCard ? (
                  <p className="text-sm text-muted">
                    {line.giftCard.recipient
                      ? m.giftCardLine.sentTo(
                          line.giftCard.recipient.to,
                          new Date(`${line.giftCard.recipient.sendOn}T12:00:00Z`).toLocaleDateString(market.locale, { dateStyle: "long", timeZone: "UTC" }),
                        )
                      : m.giftCardLine.toYou}
                  </p>
                ) : (
                  <>
                    {Object.keys(line.options).length > 0 && <p className="text-sm text-muted">{optionLabel(m, line.options)}</p>}
                    {line.delivery === "digital" && <p className="text-sm text-muted">{m.digitalDelivery}</p>}
                  </>
                )}
                {/* The price per kg, litre or metre of one unit as this cart shows it (D160): netted for a business buyer, whatever the quantity. */}
                <LineUnitPrice
                  shownMinor={
                    line.unitPriceMinor === null || line.status === "unavailable"
                      ? null
                      : view.business
                        ? withoutVat(line.unitPriceMinor, line.vatRate)
                        : line.unitPriceMinor
                  }
                  measure={line.measure}
                  currency={cart.currency}
                  locale={market.locale}
                  decimals={market.priceStyle?.decimals}
                  m={m}
                />
                {line.booking && (
                  <p className="text-sm">
                    <span className="sr-only">{m.booking.time}: </span>
                    {bookingWhen(line.booking, market.locale, m)}
                    {isRange(line.booking) && (
                      <span className="block text-muted">
                        {rangeLength(line.booking.kind, line.booking.period, line.booking.count, m)}
                        {line.booking.price && line.booking.price.feeMinor > 0 && (
                          <>
                            {" "}
                            {net(line.booking.price.itemsMinor, line.vatRate)} ·{" "}
                            {line.booking.kind === "stay" ? m.stay.cleaningFee : m.stay.bookingFee}{" "}
                            {net(line.booking.price.feeMinor, line.vatRate)}
                          </>
                        )}
                      </span>
                    )}
                  </p>
                )}
                {/* A price break prices the line (D323): the price at this quantity, said as such and never as a reduction. */}
                {line.breakFrom !== null && line.status !== "unavailable" && <p className="text-sm text-muted">{m.priceBreaks.applied(line.breakFrom)}</p>}
                {line.plan && (
                  <p className="text-sm text-muted">
                    {m.subscription}: {m.planEvery(line.plan.interval, line.plan.intervalCount).toLowerCase()}
                    {line.plan.discountPercent > 0 && ` · ${m.planSave(line.plan.discountPercent)}`}
                  </p>
                )}
              </div>
              {line.unitPriceMinor !== null && line.status !== "unavailable" && (
                <p className="shrink-0 text-right font-medium whitespace-nowrap">
                  {trial && line.plan ? (
                    <>
                      {money(0)}
                      <span className="block text-sm font-normal text-muted">
                        {m.planTrial(line.plan.trialDays)}, {net(line.unitPriceMinor * line.quantity, line.vatRate)}
                      </span>
                    </>
                  ) : (
                    net(line.unitPriceMinor * line.quantity, line.vatRate)
                  )}
                </p>
              )}
            </div>

            {line.status === "insufficient" && (
              <p role="alert" className="text-sm">
                {m.onlyAvailable(line.available)}
              </p>
            )}
            {line.status === "unavailable" && (
              <p role="alert" className="text-sm">
                {m.noLongerAvailable}
              </p>
            )}
            {/* Producer responsibility (D342): not sold in this country for want of the seller's registration, as checkout refuses it. */}
            {line.status === "unregistered" && (
              <p role="alert" className="text-sm">
                {m.producer.lineProblem}
              </p>
            )}
            {/* How many at a time (D323): the rule's words, as a problem when the line breaks it (the rule changed after it was added). */}
            {line.status === "quantity" ? (
              <p role="alert" className="text-sm">
                {m.quantityRule.fix(ruleWords(line.rule, m.quantityRule) ?? "")}
              </p>
            ) : (
              line.status !== "unavailable" &&
              ruleWords(line.rule, m.quantityRule) && <p className="text-sm text-muted">{ruleWords(line.rule, m.quantityRule)}</p>
            )}
            {/* Units beyond the stock of a variant that keeps selling (D172): how many, and the days the store states. Not a problem, so not an alert. */}
            <BackorderLine backorder={line.backorder} m={m} locale={market.locale} />

            <div className="flex flex-wrap items-end gap-2">
              {/* An appointment is one place at one time (D65), a stay its nights (D67): nothing to count. */}
              {/* − and + (D430), saved a moment after the last change; the number and Update without a script. */}
              {line.status !== "unavailable" && !line.booking && (
                <CartQuantity
                  action={updateCartLine}
                  fields={{
                    store: store.slug,
                    market: market.slug,
                    variantId: line.variantId,
                    ...(line.plan && { sellingPlanId: line.plan.id }),
                    ...(line.giftCard?.key && { giftCardKey: line.giftCard.key }),
                  }}
                  rule={line.rule}
                  quantity={line.quantity}
                  labels={{ quantity: m.quantity, less: m.quantityLess, more: m.quantityMore, update: m.update, saving: m.quantitySaving }}
                  context={line.title}
                  compact={drawer}
                />
              )}
              <form action={updateCartLine}>
                <input type="hidden" name="store" value={store.slug} />
                <input type="hidden" name="market" value={market.slug} />
                <input type="hidden" name="variantId" value={line.variantId} />
                {line.plan && <input type="hidden" name="sellingPlanId" value={line.plan.id} />}
                {line.booking && <input type="hidden" name="startsAt" value={line.booking.startsAt} />}
                {line.giftCard?.key && <input type="hidden" name="giftCardKey" value={line.giftCard.key} />}
                <input type="hidden" name="quantity" value="0" />
                {/* In the drawer it lines up with the quantity when it wraps under it. */}
                <button type="submit" className={`min-h-11 text-sm underline ${drawer ? "px-1" : "px-3"}`}>
                  {m.remove}
                  <span className="sr-only">: {line.title}</span>
                </button>
              </form>
            </div>
          </div>
        </li>
      ))}
      {/* Free products a campaign gives (D114): nothing to count or remove, and nothing to pay. */}
      {gifts.map((gift) => (
        <li key={`gift:${gift.campaignId}:${gift.variantId}`} className={`flex py-4 ${drawer ? "gap-3" : "gap-4"}`}>
          {gift.image && (
            <Image
              src={gift.image.url}
              alt={gift.image.alt}
              width={96}
              height={96}
              unoptimized
              className={`${drawer ? "size-16" : "size-24"} shrink-0 rounded-md bg-surface object-cover`}
            />
          )}
          <div className="flex min-w-0 flex-1 justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">
                {gift.quantity > 1 && `${gift.quantity} × `}
                {gift.title}
              </p>
              {Object.keys(gift.options).length > 0 && (
                <p className="text-sm text-muted">{optionLabel(m, gift.options)}</p>
              )}
              <p className="text-sm text-muted">{m.giftFrom(gift.campaignName)}</p>
            </div>
            <p className="shrink-0 text-right font-medium whitespace-nowrap">{m.freeGift}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function summaryList({ store, market, m, view }: Draw) {
  const { summary, business, money, net, sumNet, vatWords } = view;
  const { tax } = summary;
  const {
    payable,
    fees,
    feeMinor,
    ships,
    basket,
    shipping,
    code,
    applied,
    discountMinor,
    member,
    memberDiscountMinor,
    campaignDiscountMinor,
    campaignNames,
    today,
    lineDiscount,
    total,
    vat,
    balance,
    bonusMinor,
    referralMinor,
    referral,
  } = summary;
  const { terms } = view;
  const customsWords = customsText(market.lang);
  // The delivery price is chosen at checkout while it depends on a postal code or a pickup place (D237 2.4): *From {price}*, and a sentence saying so.
  const from = ships && shipping !== null ? priceLaterFrom(summary.deliveryState, shipping) : null;
  return (
    <>
      <dl className="flex flex-col gap-2">
        <div className="flex justify-between gap-4">
          <dt>{m.subtotal}</dt>
          <dd>
            {sumNet(
              payable.map((line) => ({
                minor: today(line),
                rate: line.vatRate,
              })),
            )}
          </dd>
        </div>
        {feeMinor > 0 && (
          <div className="flex justify-between gap-4">
            <dt>{m.signupFee}</dt>
            <dd>{sumNet(fees.map((fee) => ({ minor: fee.amount, rate: fee.rate })))}</dd>
          </div>
        )}
        {shipping !== null && ships && (
          <div className="flex justify-between gap-4">
            <dt>
              {deliveryRowLabel(summary.deliveryState?.delivery ?? summary.delivery?.delivery ?? null, m)}
              {basket.renewal > 0 && <span className="text-sm text-muted"> {m.perDelivery}</span>}
            </dt>
            <dd data-delivery-price={from !== null ? "from" : undefined}>
              {from !== null
                ? m.deliveryOptions.priceInfo.from(net(from, tax.shippingRate))
                : shipping === 0
                  ? m.freeShipping
                  : net(shipping, tax.shippingRate)}
            </dd>
          </div>
        )}
        {discountMinor > 0 && (
          <div className="flex justify-between gap-4">
            <dt>
              {m.discount}{" "}
              <span className="text-sm text-muted">
                (
                {discountNote({
                  discountMinor,
                  memberDiscountMinor,
                  memberLabel: member?.label ?? null,
                  memberPercent: member?.percent ?? null,
                  discountCode: applied ? (code?.label ?? null) : null,
                  campaignDiscountMinor,
                  campaignLabel: campaignLabel(campaignNames),
                })}
                )
              </span>
            </dt>
            <dd>
              −
              {sumNet([
                ...payable.map((line, i) => ({
                  minor: lineDiscount(i),
                  rate: line.vatRate,
                })),
                { minor: (applied?.shippingMinor ?? 0) + summary.campaignShippingMinor, rate: tax.shippingRate },
              ])}
            </dd>
          </div>
        )}
        {referralMinor > 0 && (
          // The friend's welcome discount (D131), off goods before codes and credits.
          <div className="flex justify-between gap-4">
            <dt>{m.affiliate.discountRow}</dt>
            <dd>
              −
              {business
                ? money(creditsNet(referralMinor, payable.map((line) => ({ minor: today(line), rate: line.vatRate }))))
                : money(referralMinor)}
            </dd>
          </div>
        )}
        {bonusMinor > 0 && (
          <div className="flex justify-between gap-4">
            <dt>{m.bonus.discountRow}</dt>
            <dd>
              −
              {business
                ? money(creditsNet(bonusMinor, payable.map((line) => ({ minor: today(line), rate: line.vatRate }))))
                : money(bonusMinor)}
            </dd>
          </div>
        )}
        {tax.reverseCharge && !business && (
          // Reverse charge (D157) for a shopper who sees prices with VAT: the VAT not charged comes off before the total.
          <div className="flex justify-between gap-4">
            <dt>{vatWords.reliefRow}</dt>
            <dd>−{money(tax.reliefMinor)}</dd>
          </div>
        )}
        {business && (
          <>
            <div className="flex justify-between gap-4 border-t border-border pt-2">
              <dt>{m.totalExclVat}</dt>
              <dd>{money(total - vat)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{tax.reverseCharge ? vatWords.vatLineReverse : m.vatLine}</dt>
              <dd>{money(vat)}</dd>
            </div>
          </>
        )}
        {summary.customs.collectMinor > 0 && (
          // Duties and import VAT collected at checkout (DDP, D343): an estimate, beside the order's total and paid with it.
          <div className="flex justify-between gap-4" data-customs-row>
            <dt>
              {customsWords.dutiesLine} <span className="text-sm text-muted">({customsWords.estimate})</span>
            </dt>
            <dd>{money(summary.customs.collectMinor)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
          <dt>{business ? m.toPay : m.total}</dt>
          <dd>{money(total + summary.customs.collectMinor)}</dd>
        </div>
        {summary.giftCards.paidMinor > 0 && (
          // Gift cards (D300 F3) pay part of the total: a payment, after the total, never a discount before it.
          <div className="flex justify-between gap-4">
            <dt>{m.giftCardPay.paidWith}</dt>
            <dd>−{money(summary.giftCards.paidMinor)}</dd>
          </div>
        )}
        {(balance > 0 || summary.giftCards.paidMinor > 0) && (
          <div className="flex justify-between gap-4">
            <dt>{m.booking.dueNow}</dt>
            <dd>{money(summary.dueNowMinor)}</dd>
          </div>
        )}
        {balance > 0 && (
          <div className="flex justify-between gap-4">
            <dt>{m.booking.atVenue}</dt>
            <dd>{money(balance)}</dd>
          </div>
        )}
      </dl>
      {summary.giftCards.coverAll && <p className="text-sm">{m.giftCardPay.coverAll}</p>}
      {summary.campaignNext.length > 0 && (
        // How far a campaign's next step is (D299 E3), worked out on the same lines checkout counts.
        <ul className="flex flex-col gap-1 text-sm" data-campaign-next>
          {summary.campaignNext.map((step) => (
            <li key={`${step.campaignId}:${step.kind}`} className="rounded-lg bg-accent px-3 py-2 text-accent-foreground">
              {nextStepText(step, m, money)} <span className="opacity-80">({step.name})</span>
            </li>
          ))}
        </ul>
      )}
      {summary.campaignsLeftOut.length > 0 && (
        // Campaigns a discount code they do not combine with won over (D367): said, so the shopper knows why the offer is not taken off.
        <ul className="flex flex-col gap-1 text-sm text-muted" data-campaign-left-out>
          {summary.campaignsLeftOut.map((campaign) => (
            <li key={campaign.campaignId}>{m.campaignNotWithCode(campaign.name)}</li>
          ))}
        </ul>
      )}
      {from !== null && <p className="text-sm">{m.deliveryOptions.priceInfo.atCheckout}</p>}
      {((!business && !tax.reverseCharge) || shipping === null) && (
        <p className="text-sm text-muted">
          {[!business && !tax.reverseCharge && m.vatIncluded, shipping === null && m.shippingAtCheckout]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <VatNotes
        text={vatWords}
        reverseCharge={tax.reverseCharge}
        sellerNumber={tax.sellerVatNumber}
        buyerNumber={tax.buyerVatNumber}
        iossNumber={null}
        importNotice={tax.importNotice && summary.customs.estimate.kind === "none"}
      />
      {/* Customs and duties (D343): who pays them for this country and the estimate, or what stops a DDP checkout. */}
      {cartCustomsSentences(summary.customs, customsWords, money).map((s) => (
        <p key={s.text} className={s.problem ? "text-sm" : "text-sm text-muted"} role={s.problem ? "alert" : undefined} data-customs-note>
          {s.text}
        </p>
      ))}
      {terms && <p className="text-sm">{terms}</p>}
      {applied && Object.keys(applied.renewalUnits).length > 0 && <p className="text-sm">{m.discountRenews}</p>}
      {referral.state === "guest" && (
        // A friend's link is in play but nobody is signed in: the welcome discount is for a signed-in first order (D131).
        <p className="text-sm text-muted">
          <Link href={marketPath(store.slug, market.slug, "/account")} className="underline">
            {m.affiliate.signInForDiscount(String(referral.percent))}
          </Link>
        </p>
      )}
    </>
  );
}

function giftCardForm({ store, market, m, view }: Draw) {
  const { money, summary } = view;
  return (
    <GiftCardForm
      cards={shownCartGiftCards(summary.giftCards.cards, m, money)}
      full={m.giftCardPay.problems.full}
      apply={applyGiftCardAction.bind(null, store.slug, market.slug)}
      remove={removeGiftCardAction.bind(null, store.slug, market.slug)}
      labels={{ field: m.giftCardPay.field, apply: m.giftCardPay.apply, applying: m.giftCardPay.applying, remove: m.giftCardPay.remove }}
    />
  );
}

function codeForm({ store, market, m, view }: Draw) {
  const { code } = view.summary;
  const { money } = view;
  return (
    <DiscountCodeForm
      store={store.slug}
      market={market.slug}
      codes={(code?.codes ?? []).map((c) => ({ code: c.code, problem: c.ok ? null : codeProblemText(m, c, money) }))}
      full={m.codeProblems.codes_full}
      labels={{
        code: m.discountCode,
        apply: m.applyCode,
        remove: m.removeCode,
        applying: m.savingChange,
      }}
    />
  );
}

/** The bonus credits (D130): null for a store without the program. */
function creditsForm({ store, market, m, view }: Draw) {
  if (!view.bonus) return null;
  return (
    <BonusCredits
      bonus={view.bonus}
      m={m}
      currency={market.currency}
      locale={market.locale}
      signInHref={marketPath(store.slug, market.slug, "/account")}
      action={setCartCreditsAction.bind(null, store.slug, market.slug)}
      decimals={market.priceStyle?.decimals}
    />
  );
}

function checkoutAction({ store, market, m, view }: Draw) {
  const { summary, business, money, saved, addressChoices, companyNeeded, company, every, cart, vatWords, onTerms, cardsPayAll } = view;
  const { checkout, blocked, atVenueOnly, digital, serviceRequest, renewal, plan, tax } = summary;
  const asksCompany = business || companyNeeded;
  // The EU VAT number (D157): offered under the company's fields when the cart could take the VAT off; the sentence under
  // it is what the server worked out for the number on the cart, and a basket with a booking or a subscription says why not.
  const numberTyped = cart.company?.vatNumber ?? "";
  const fieldFor = tax.fieldIfBusiness;
  const vat = !asksCompany
    ? undefined
    : fieldFor.offered
      ? {
          offered: true,
          initial: numberTyped,
          message: vatNumberMessage(
            {
              reason: tax.reason,
              buyerVatNumber: tax.buyerVatNumber,
              numberCountry: countryName(countryOfVatPrefix(numberTyped.slice(0, 2)) ?? "", market.locale),
              deliveryCountry: countryName(market.code, market.locale),
            },
            vatWords,
          ),
          labels: { label: vatWords.label, help: vatWords.help, check: vatWords.check, checking: vatWords.checking },
          problems: vatProblemTexts(vatWords),
        }
      : fieldFor.reason === "has_service" || fieldFor.reason === "has_subscription"
        ? {
            offered: false,
            initial: "",
            message: null,
            labels: { label: "", help: "", check: "", checking: "" },
            problems: {},
            note: fieldFor.reason === "has_service" ? vatWords.basketService : vatWords.basketSubscription,
          }
        : undefined;
  return (
    <>
      {view.companyBuy && (
        <CompanyPurchase {...view.companyBuy} action={companyPurchaseAction.bind(null, store.slug, market.slug)} m={m.companyAccount} />
      )}
      {view.mustSignInFirst ? (
        // A store that requires an account (D365): the shopper signs in first; `placeOrder()` refuses a cart without one.
        <Link href={marketPath(store.slug, market.slug, "/account")} className="button-primary flex min-h-12 items-center justify-center rounded-button px-6 font-medium">
          {m.signInToCheckOut}
        </Link>
      ) : checkout.paymentsOn || onTerms ? (
        <CheckoutButton
          store={store.slug}
          market={market.slug}
          disabled={blocked}
          labels={checkoutLabels(m, atVenueOnly ? m.booking.confirmBooking : undefined, market.lang)}
          contact={
            atVenueOnly
              ? {
                  name: saved?.name ?? "",
                  email: saved?.email ?? "",
                  phone: saved?.phone ?? "",
                  labels: {
                    legend: m.booking.contactHeading,
                    name: m.booking.contactName,
                    email: m.booking.contactEmail,
                    phone: m.booking.contactPhone,
                  },
                }
              : undefined
          }
          payer={
            // Mollie's page asks for no address (D292), and an order gift cards pay in full (D300 F3) has no payment page at all: who pays,
            // and where the goods go, are asked here first.
            (checkout.provider === "mollie" || summary.giftCards.coverAll) && !atVenueOnly
              ? {
                  needs: {
                    address: summary.ships && summary.deliveryState?.method !== "pickup",
                    // A local delivery's driver calls (D237); the store may require a phone of every order (D357).
                    phone: summary.deliveryState?.method === "local" || store.checkoutContact.phone === "required",
                  },
                  name: saved?.name ?? "",
                  email: saved?.email ?? "",
                  phone: saved?.phone ?? "",
                  line1: saved?.address.line1 ?? "",
                  line2: saved?.address.line2 ?? "",
                  postalCode: saved?.address.postalCode ?? "",
                  city: saved?.address.city ?? "",
                  labels: m.payer,
                }
              : undefined
          }
          terms={
            // Payment terms (D293): the company's account chooses between paying now and an invoice; who pays, with the billing address, is asked then.
            onTerms && !atVenueOnly
              ? {
                  onlyWay: !checkout.paymentsOn,
                  note: onTerms.note,
                  payNow: m.paymentTerms.payNow,
                  name: onTerms.customer.name,
                  email: onTerms.customer.email,
                  phone: onTerms.customer.phone,
                  line1: onTerms.customer.address.line1 ?? "",
                  line2: onTerms.customer.address.line2 ?? "",
                  postalCode: onTerms.customer.address.postalCode ?? "",
                  city: onTerms.customer.address.city ?? "",
                  phoneNeeded: summary.deliveryState?.method === "local",
                  // Words only: the catalogue also holds a function (`dueShort`), which cannot reach a client component.
                  labels: {
                    choice: m.paymentTerms.choice,
                    legend: m.paymentTerms.legend,
                    address: m.paymentTerms.address,
                    place: m.paymentTerms.place,
                    note: m.paymentTerms.note,
                  },
                  payerLabels: m.payer,
                  display: onTerms.display,
                  template: onTerms.template,
                  newTab: m.terms.newTab,
                }
              : undefined
          }
          cardsPayAll={cardsPayAll ?? undefined}
          savedAddresses={addressChoices.length ? { choices: addressChoices, label: m.account.addresses.choose, typeNew: m.account.addresses.typeNew } : undefined}
          questions={
            view.questions.fields.length > 0
              ? { fields: view.questions.fields, answers: view.questions.answers, legend: m.checkoutQuestions.legend, required: m.checkoutQuestions.required, consent: m.checkoutQuestions.consent }
              : undefined
          }
          company={{
            // Asked of businesses, and of anyone whose order needs it.
            ask: asksCompany,
            required: companyNeeded,
            name: company.name,
            number: company.number,
            labels: m.company,
          }}
          vat={vat}
          consents={{
            digital: digital ? m.digitalConsent : undefined,
            service: serviceRequest ? m.serviceRequest : undefined,
            subscription:
              renewal !== null && plan
                ? [
                    m.subscriptionConsent(every, money(renewal)),
                    plan.trialDays > 0 && m.trialNote(plan.trialDays),
                    plan.minCycles > 0 && m.commitmentNote(plan.minCycles),
                  ]
                    .filter(Boolean)
                    .join(" ")
                : undefined,
          }}
        />
      ) : (
        // A store template (D175) is a preview: it says so instead of the button.
        <p className="text-sm" role={checkout.starter ? "note" : undefined}>
          {checkout.starter ? m.starterCheckout : m.checkoutUnavailable}
        </p>
      )}
      {!view.mustSignInFirst && view.klarna && <KlarnaMessage {...view.klarna} amountMinor={summary.total} />}
      {/* Express checkout (D373): the wallets over the same order the button places, loaded only when this area is pressed. */}
      {!view.mustSignInFirst && view.express && (
        <ExpressArea store={store.slug} market={market.slug} labels={view.express.labels} terms={view.express.terms} look={view.express.look} />
      )}
      {/* Request a quote for these items (D431), under the ways to pay. */}
      {view.quote && <QuoteRequest store={store.slug} market={market.slug} source={{ kind: "cart", lines: view.quote.lines }} prefill={view.quote.prefill} labels={m.quotes} />}
      {summary.refusal ? (
        // A checkout rule refuses the basket (D357): the owner's own words, in the cart's language.
        <p className="text-sm" role="alert" data-checkout-rule>
          {summary.refusal}
        </p>
      ) : (
        blocked && <p className="text-sm">{m.noLongerAvailable}</p>
      )}
    </>
  );
}
