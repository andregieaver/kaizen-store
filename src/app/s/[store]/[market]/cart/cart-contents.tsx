import Image from "next/image";
import Link from "next/link";

import { BackorderLine } from "@/components/backorder-note";
import { BonusCredits } from "@/components/bonus-credits";
import { CheckoutButton } from "@/components/checkout-button";
import { DiscountCodeForm } from "@/components/discount-code-form";
import { LineUnitPrice } from "@/components/price";
import { VatNotes } from "@/components/vat-notes";
import { discountNote } from "@/lib/customer-tiers";
import { companyRequired, withoutVat } from "@/lib/b2b";
import { bookingWhen, isRange, rangeLength } from "@/lib/booking-text";
import { creditsNet } from "@/lib/bonus-shopper";
import { campaignLabel } from "@/lib/campaigns";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { checkoutLabels } from "@/lib/checkout-labels";
import { optionLabel, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath, marketHome } from "@/lib/paths";
import { formatMoney } from "@/lib/money";
import { countryOfVatPrefix } from "@/lib/vat-number";
import { countryName, vatNumberMessage, vatProblemTexts, vatText } from "@/lib/vat-text";
import { getBuyer } from "@/server/b2b";
import { getCart, getCartGift } from "@/server/cart";
import { perRequest } from "@/server/request-memo";
import { cartSummary } from "@/server/cart-summary";
import { getCustomer } from "@/server/customers";
import type { Store } from "@/server/stores";

import { setCartCreditsAction, updateCartLine } from "./actions";
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
  // A signed-in customer's saved company and details fill the fields in.
  const saved = (business && !cart.company) || summary.atVenueOnly ? await getCustomer(store.id) : null;
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
    companyNeeded,
    company,
    terms,
    vatWords,
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
  return view.empty ? null : codeForm({ store, market, m, view });
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
                {Object.keys(line.options).length > 0 && (
                  <p className="text-sm text-muted">{optionLabel(m, line.options)}</p>
                )}
                {line.delivery === "digital" && <p className="text-sm text-muted">{m.digitalDelivery}</p>}
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
                  <label className="flex flex-col text-sm">
                    {m.quantity}
                    <input
                      type="number"
                      name="quantity"
                      min={0}
                      max={MAX_LINE_QUANTITY}
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
              {summary.delivery?.delivery.label ?? m.shipping}
              {basket.renewal > 0 && <span className="text-sm text-muted"> {m.perDelivery}</span>}
            </dt>
            <dd>{shipping === 0 ? m.freeShipping : net(shipping, tax.shippingRate)}</dd>
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
                  discountCode: applied ? (code?.code ?? null) : null,
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
                { minor: applied?.shippingMinor ?? 0, rate: tax.shippingRate },
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
        <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
          <dt>{business ? m.toPay : m.total}</dt>
          <dd>{money(total)}</dd>
        </div>
        {balance > 0 && (
          <>
            <div className="flex justify-between gap-4">
              <dt>{m.booking.dueNow}</dt>
              <dd>{money(total - balance)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{m.booking.atVenue}</dt>
              <dd>{money(balance)}</dd>
            </div>
          </>
        )}
      </dl>
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
        importNotice={tax.importNotice}
      />
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

function codeForm({ store, market, m, view }: Draw) {
  const { code } = view.summary;
  const { money } = view;
  return (
    <DiscountCodeForm
      store={store.slug}
      market={market.slug}
      code={code?.code ?? null}
      problem={
        code && !code.ok
          ? code.problem === "minimum" && code.minimumMinor
            ? `${m.minimumFor} ${money(code.minimumMinor)}.`
            : m.codeProblems[code.problem]
          : null
      }
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
  const { summary, business, money, saved, companyNeeded, company, every, cart, vatWords } = view;
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
      {checkout.paymentsOn ? (
        <CheckoutButton
          store={store.slug}
          market={market.slug}
          disabled={blocked}
          labels={checkoutLabels(m, atVenueOnly ? m.booking.confirmBooking : undefined)}
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
      {blocked && <p className="text-sm">{m.noLongerAvailable}</p>}
    </>
  );
}
