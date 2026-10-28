import { choicesFor } from "@/lib/customer-addresses";
import { listAddresses } from "@/server/customer-addresses";
import Image from "next/image";
import Link from "next/link";

import { BackorderLine } from "@/components/backorder-note";
import { BonusCredits } from "@/components/bonus-credits";
import { CheckoutButton } from "@/components/checkout-button";
import { DiscountCodeForm } from "@/components/discount-code-form";
import { GiftCardForm } from "@/components/gift-card-form";
import { shownCartGiftCards } from "@/lib/gift-card-words";
import { codeProblemText } from "@/lib/code-words";
import { LineUnitPrice } from "@/components/price";
import { VatNotes } from "@/components/vat-notes";
import { discountNote } from "@/lib/customer-tiers";
import { deliveryRowLabel, priceLaterFrom } from "@/lib/delivery-words";
import { companyRequired, withoutVat } from "@/lib/b2b";
import { bookingWhen, isRange, rangeLength } from "@/lib/booking-text";
import { creditsNet } from "@/lib/bonus-shopper";
import { nextStepText } from "@/lib/campaign-notices";
import { campaignLabel } from "@/lib/campaigns";
import { lineMax, ruleWords } from "@/lib/quantity-rules";
import { checkoutLabels } from "@/lib/checkout-labels";
import { cartCustomsSentences, customsText } from "@/lib/customs-text";
import { optionLabel, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath, marketHome } from "@/lib/paths";
import { formatMoney } from "@/lib/money";
import { countryOfVatPrefix } from "@/lib/vat-number";
import { countryName, vatNumberMessage, vatProblemTexts, vatText } from "@/lib/vat-text";
import { getBuyer } from "@/server/b2b";
import { getCart, getCartGift, readCartId } from "@/server/cart";
import { checkoutQuestionsFor } from "@/server/checkout-rules";
import { perRequest } from "@/server/request-memo";
import { cartSummary } from "@/server/cart-summary";
import { getCustomer } from "@/server/customers";
import { buyerFacts } from "@/server/company-locations";
import { termsForBasket } from "@/server/payment-terms";
import { termsDisplayFor } from "@/server/checkout-terms";
import { termsTemplate } from "@/lib/checkout-terms";
import { dayWords, TERMS_DAYS } from "@/lib/payment-terms";
import { featureOn } from "@/lib/store-features";
import { accountsMode, signInRequired } from "@/lib/customer-accounts";
import type { Store } from "@/server/stores";

import { applyGiftCardAction, companyPurchaseAction, removeGiftCardAction, setCartCreditsAction, updateCartLine } from "./actions";
import { CompanyPurchase } from "./company-purchase";
import { readCartBonus } from "./bonus";
import { GiftBox } from "./cart-gift";

type CartView = Awaited<ReturnType<typeof loadCartView>>;
type Filled = Extract<CartView, { empty: false }>;

/** The cart and everything its pieces show of it, read once for a request whichever pieces a page holds (D117). */
export function cartView(store: Store, market: Market, m: Messages) {
  return perRequest(`cart:${store.id}:${market.slug}`, () => loadCartView(store, market, m));
}

async function loadCartView(store: Store, market: Market, m: Messages) {
  const [cart, buyer] = await Promise.all([getCart({ storeId: store.id, market }), getBuyer(store)]);
  const home = marketPath(store.slug, market.slug);
  if (cart.lines.length === 0) return { empty: true as const, home };

  const [summary, bonus, gift] = await Promise.all([
    cartSummary({ storeId: store.id, market }, cart),
    readCartBonus(store, market),
    // The gift box (wave 3, D173): whether the store offers gift messages, and what the cart holds of one.
    getCartGift({ storeId: store.id, market }),
  ]);
  const { plan, checkout, renewal } = summary;
  // The VAT wording (D157): hand-written, so apart from the interface texts the AI translates.
  const vatWords = vatText(market.lang);
  const every = plan ? m.planEvery(plan.interval, plan.intervalCount) : "";
  // Businesses see amounts without VAT, and the VAT on its own line (B2B); they pay the total with it.
  const business = buyer === "business";
  const money = (minor: number) => formatMoney(minor, cart.currency, market.locale);
  // Each line at its product's VAT rate, shipping at the standard one, as checkout works it out (D65).
  const net = (minor: number, rate = checkout.vatRate) => money(business ? withoutVat(minor, rate) : minor);
  const sumNet = (parts: { minor: number; rate: number }[]) =>
    money(parts.reduce((sum, part) => sum + (business ? withoutVat(part.minor, part.rate) : part.minor), 0));
  // A signed-in customer's saved company and details fill the fields in. A company's account may also buy on its payment terms (D293).
  const businessOn = featureOn(store, "business");
  // Who pays is asked here when no payment page follows: a booking paid at the venue, Mollie's page, or gift cards that pay it all (D300 F3).
  const asksPayer = summary.atVenueOnly || checkout.provider === "mollie" || summary.giftCards.coverAll;
  const mustSignIn = accountsMode(store) === "required";
  const customer = (business && !cart.company) || asksPayer || businessOn || mustSignIn ? await getCustomer(store.id) : null;
  const saved = (business && !cart.company) || asksPayer ? customer : null;
  // Goods bought once only: no booking, subscription, venue part or host's listing (`placeOrder()` checks the same under the company's lock).
  const goodsOnly = summary.balance === 0 && cart.lines.every((line) => !line.plan && !line.booking && !line.hostId && !line.payment);
  const termsOffer =
    businessOn && customer && !summary.blocked
      ? await termsForBasket(store.id, customer.id, { goodsOnly, totalMinor: summary.total, currency: cart.currency })
      : null;
  // No payment page follows an order on terms: the store's terms of sale (D158) are shown here instead, as the checkout shows them.
  const termsDisplay = termsOffer?.ok || summary.giftCards.coverAll ? await termsDisplayFor(store, market) : null;
  // Gift cards that pay it all (D300 F3): no payment page follows either, so the terms of sale are shown with the button here.
  const cardsPayAll = summary.giftCards.coverAll
    ? { display: termsDisplay, template: termsDisplay ? termsTemplate(m.terms, termsDisplay) : "", newTab: m.terms.newTab, place: m.giftCardPay.place }
    : null;
  const onTerms =
    termsOffer?.ok && customer
      ? {
          note: m.paymentTerms.choiceNote(termsOffer.companyName ?? "", TERMS_DAYS[termsOffer.terms], dayWords(termsOffer.dueOn, market.locale)),
          customer,
          display: termsDisplay,
          template: termsDisplay ? termsTemplate(m.terms, termsDisplay) : "",
        }
      : null;
  // A company member's purchase (D321 C.2): the location and PO number, and whether an order over the company's limit will wait for an approver.
  const companyFacts = businessOn && customer ? await buyerFacts(store.id, customer.id) : null;
  const chosenPlace = companyFacts
    ? companyFacts.places.length === 1
      ? companyFacts.places[0]
      : (companyFacts.places.find((p) => p.id === cart.companyPurchase.locationId) ?? null)
    : null;
  const companyBuy = companyFacts
    ? {
        facts: companyFacts,
        chosen: chosenPlace?.id ?? null,
        poNumber: cart.companyPurchase.poNumber,
        limitText: companyFacts.limit && chosenPlace?.role === "orderer" ? formatMoney(companyFacts.limit.minor, companyFacts.limit.currency, market.locale) : null,
      }
    : null;
  // The store's own questions at checkout (D357), with what the cart holds of the answers.
  const questions = await checkoutQuestionsFor(store.id, market.locale, await readCartId({ storeId: store.id, market }));
  // A signed-in customer's saved addresses in the market's country (D304), offered where this page asks the address itself.
  const addressChoices = customer && (asksPayer || onTerms) ? choicesFor(await listAddresses(store.id, customer.id), market.code) : [];
  const companyNeeded = companyRequired(
    store.audience,
    cart.lines.map((line) => line.audience),
  );
  const company = cart.company ?? {
    name: saved?.companyName ?? "",
    number: saved?.organisationNumber ?? "",
  };
  // The subscription's terms, said the same way in the summary and the consent (D29).
  const terms = plan
    ? [
        m.renewsEvery(every, money(renewal ?? 0)),
        plan.trialDays > 0 && m.trialNote(plan.trialDays),
        plan.minCycles > 0 && m.commitmentNote(plan.minCycles),
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  return {
    empty: false as const,
    home,
    cart,
    summary,
    bonus,
    gift,
    every,
    business,
    money,
    net,
    sumNet,
    saved,
    // A store that requires accounts (D365) asks the shopper to sign in before the checkout button.
    mustSignInFirst: signInRequired(store, Boolean(customer)),
    addressChoices,
    companyNeeded,
    company,
    terms,
    vatWords,
    onTerms,
    cardsPayAll,
    companyBuy,
    questions,
  };
}

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
  return (
    // minmax(0, …): nothing inside may make a column wider than the screen.
    <div className={`grid grid-cols-[minmax(0,1fr)] ${drawer ? "gap-4" : "gap-8 md:grid-cols-[minmax(0,1fr)_18rem]"}`}>
      <div className="flex min-w-0 flex-col gap-4">
        {linesList(draw, drawer)}
        {giftBox(draw)}
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
            <BackorderLine backorder={line.backorder} m={m} />

            <div className="flex flex-wrap items-end gap-2">
              {/* An appointment is one place at one time (D65), a stay its nights (D67): nothing to count. */}
              {line.status !== "unavailable" && !line.booking && (
                <form action={updateCartLine} className="flex items-end gap-2">
                  <input type="hidden" name="store" value={store.slug} />
                  <input type="hidden" name="market" value={market.slug} />
                  <input type="hidden" name="variantId" value={line.variantId} />
                  {line.plan && <input type="hidden" name="sellingPlanId" value={line.plan.id} />}
                  {line.giftCard?.key && <input type="hidden" name="giftCardKey" value={line.giftCard.key} />}
                  <label className="flex flex-col text-sm">
                    {m.quantity}
                    <input
                      type="number"
                      name="quantity"
                      min={line.rule.min}
                      max={lineMax(line.rule)}
                      step={line.rule.step}
                      defaultValue={line.quantity}
                      className={`min-h-11 ${drawer ? "w-16" : "w-20"} rounded-md border border-border bg-background px-2`}
                    />
                  </label>
                  <button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm">
                    {m.update}
                  </button>
                </form>
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
    />
  );
}

function checkoutAction({ store, market, m, view }: Draw) {
  const { summary, business, money, saved, addressChoices, companyNeeded, company, every, cart, vatWords, onTerms, cardsPayAll } = view;
  const { checkout, blocked, atVenueOnly, digital, renewal, plan, tax } = summary;
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
                    phone: summary.deliveryState?.method === "local",
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
                  labels: m.paymentTerms,
                  payerLabels: m.payer,
                  display: onTerms.display,
                  template: onTerms.template,
                  newTab: m.terms.newTab,
                }
              : undefined
          }
          cardsPayAll={cardsPayAll && !atVenueOnly ? cardsPayAll : undefined}
          savedAddresses={addressChoices.length ? { choices: addressChoices, label: m.account.addresses.choose, typeNew: m.account.addresses.typeNew } : undefined}
          questions={
            view.questions.fields.length > 0
              ? { fields: view.questions.fields, answers: view.questions.answers, legend: m.checkoutQuestions.legend, required: m.checkoutQuestions.required }
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
