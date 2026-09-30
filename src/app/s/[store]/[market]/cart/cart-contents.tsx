import Image from "next/image";
import Link from "next/link";

import { BonusCredits } from "@/components/bonus-credits";
import { CheckoutButton } from "@/components/checkout-button";
import { DiscountCodeForm } from "@/components/discount-code-form";
import { discountNote } from "@/lib/customer-tiers";
import { companyRequired, withoutVat } from "@/lib/b2b";
import { bookingWhen, isRange, rangeLength } from "@/lib/booking-text";
import { creditsNet } from "@/lib/bonus-shopper";
import { campaignLabel } from "@/lib/campaigns";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { checkoutLabels } from "@/lib/checkout-labels";
import { optionLabel, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { formatMoney } from "@/lib/money";
import { getBuyer } from "@/server/b2b";
import { getCart } from "@/server/cart";
import { perRequest } from "@/server/request-memo";
import { cartSummary } from "@/server/cart-summary";
import { getCustomer } from "@/server/customers";
import type { Store } from "@/server/stores";

import { setCartCreditsAction, updateCartLine } from "./actions";
import { readCartBonus } from "./bonus";

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

  const [summary, bonus] = await Promise.all([cartSummary({ storeId: store.id, market }, cart), readCartBonus(store, market)]);
  const { plan, checkout, renewal } = summary;
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
    every,
    business,
    money,
    net,
    sumNet,
    saved,
    companyNeeded,
    company,
    terms,
  };
}

type Draw = { store: Store; market: Market; m: Messages; view: Filled };

const EMPTY_CART = (home: string, m: Messages) => (
  <div className="flex flex-col items-start gap-4">
    <p>{m.emptyCart}</p>
    <Link href={home} className="underline">
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
      {linesList(draw, drawer)}
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
export async function CartCheckout({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  return view.empty ? null : (
    <div className="flex min-w-0 flex-col gap-3">{checkoutAction({ store, market, m, view })}</div>
  );
}

/** A link back to the store (D117). */
export function CartContinue({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  return (
    <Link href={marketPath(store.slug, market.slug)} className="underline">
      {m.continueShopping}
    </Link>
  );
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

function summaryList({ m, view }: Draw) {
  const { summary, business, money, net, sumNet } = view;
  const {
    payable,
    checkout,
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
              {m.shipping}
              {basket.renewal > 0 && <span className="text-sm text-muted"> {m.perDelivery}</span>}
            </dt>
            <dd>{shipping === 0 ? m.freeShipping : net(shipping)}</dd>
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
                { minor: applied?.shippingMinor ?? 0, rate: checkout.vatRate },
              ])}
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
        {business && (
          <>
            <div className="flex justify-between gap-4 border-t border-border pt-2">
              <dt>{m.totalExclVat}</dt>
              <dd>{money(total - vat)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{m.vatLine}</dt>
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
      {(!business || shipping === null) && (
        <p className="text-sm text-muted">
          {[!business && m.vatIncluded, shipping === null && m.shippingAtCheckout].filter(Boolean).join(" · ")}
        </p>
      )}
      {terms && <p className="text-sm">{terms}</p>}
      {applied && Object.keys(applied.renewalUnits).length > 0 && <p className="text-sm">{m.discountRenews}</p>}
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
  const { summary, business, money, saved, companyNeeded, company, every } = view;
  const { checkout, blocked, atVenueOnly, digital, renewal, plan } = summary;
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
            ask: business || companyNeeded,
            required: companyNeeded,
            name: company.name,
            number: company.number,
            labels: m.company,
          }}
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
        <p className="text-sm">{m.checkoutUnavailable}</p>
      )}
      {blocked && <p className="text-sm">{m.noLongerAvailable}</p>}
    </>
  );
}
