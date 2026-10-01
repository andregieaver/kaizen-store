import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { checkoutSignInAction } from "@/app/s/[store]/[market]/account/actions";
import { OwnBookings } from "@/components/own-bookings";
import { PasswordReset } from "@/components/account-sign-in";
import { LineThumbnail } from "@/components/line-thumbnail";
import { RefreshOnce, RefreshWhile } from "@/components/refresh-while";
import { earnedText } from "@/lib/bonus-shopper";
import { discountNote } from "@/lib/customer-tiers";
import { pickupPointLine } from "@/lib/delivery-options";
import { bookingWhen, isRange } from "@/lib/booking-text";
import { t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { StoreQuery } from "@/lib/store-parts";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { fileSize } from "@/lib/file-size";
import { getCheckoutAccount, type CheckoutAccount } from "@/server/customers";
import { getOrderDownloads, getShopperOrder, type OrderDownload } from "@/server/orders";
import { perRequest } from "@/server/request-memo";
import type { Store } from "@/server/stores";
import { getSubscriptionForOrder } from "@/server/subscriptions";

type Shop = { store: Store; market: Market; orderId: string; query: Promise<StoreQuery> };
type OrderView = Awaited<ReturnType<typeof loadOrderView>>;

/** The order and what its pieces show of it, read once for a request whichever pieces a page holds (D117). */
function orderView({ store, market, orderId, query }: Shop) {
  return perRequest(`order:${store.id}:${orderId}`, () => loadOrderView(store, market, orderId, query));
}

async function loadOrderView(store: Store, market: Market, orderId: string, query: Promise<StoreQuery>) {
  const sessionId = (await query).session_id;
  if (!z.uuid().safeParse(orderId).success || typeof sessionId !== "string") notFound();
  const order = await getShopperOrder(store.id, orderId, sessionId);
  if (!order) notFound();
  const m: Messages = t(market.lang);
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const digital = order.lines.some((line) => line.delivery === "digital" && line.variantId !== null);
  const paid = order.status === "paid" || order.status === "fulfilled" || order.status === "closed";
  const [downloads, subscription, account] = await Promise.all([
    digital && paid ? getOrderDownloads(store.id, order.id) : [],
    order.subscriptionId ? getSubscriptionForOrder(store.id, order.id) : null,
    getCheckoutAccount(store.id, order.id),
  ]);
  return { store, market, order, sessionId, m, money, digital, paid, downloads, subscription, account };
}

const FRAME = "rounded-lg border border-border p-4";

/**
 * The order's page (D22): what the shopper sees after paying and when they
 * open the order from an email. Everything here depends on the order in the
 * address, so it all renders per request. The order page shows it, and so
 * does a store's own page for it (D113), whole or in pieces (D117:
 * `OrderStatus`, `OrderAccount`, `OrderBookings`, `OrderLines`,
 * `OrderTotals`, `OrderSubscription`, `OrderDownloads`, `OrderAddress`,
 * `OrderContinue`).
 */
export async function OrderDetails(shop: Shop) {
  const view = await orderView(shop);
  const { m } = view;
  const [account, subscription, downloads] = [accountBlock(view), subscriptionBlock(view), downloadsBlock(view)];
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {statusBlock(view)}
      {account && <div className={FRAME}>{account}</div>}
      {bookingsBlock(view)}
      <section aria-label={m.cart} className={FRAME}>
        {linesList(view)}
        <div className="mt-3 border-t border-border pt-3">
          {totalsList(view)}
          {earnedNote(view)}
        </div>
      </section>
      {subscription && <div className={FRAME}>{subscription}</div>}
      {downloads && <div className={FRAME}>{downloads}</div>}
      {addressBlock(view)}
      {continueLink(view)}
    </div>
  );
}

/** The thank-you heading, the order number and the payment being confirmed (D117). It also keeps the page current while the payment is confirmed. */
export async function OrderStatus(shop: Shop) {
  return statusBlock(await orderView(shop));
}

/** What became of the account asked for at checkout (D117); nothing when none was asked for. */
export async function OrderAccount(shop: Shop) {
  return accountBlock(await orderView(shop));
}

/** The order's appointments, stays and rentals (D117). */
export async function OrderBookings(shop: Shop) {
  return bookingsBlock(await orderView(shop));
}

/** The lines the shopper bought (D117). */
export async function OrderLines(shop: Shop) {
  return linesList(await orderView(shop));
}

/** The order's shipping, discounts, total and VAT (D117). */
export async function OrderTotals(shop: Shop) {
  const view = await orderView(shop);
  return (
    <>
      {totalsList(view)}
      {earnedNote(view)}
    </>
  );
}

/** The subscription the order started (D117); nothing for an order without one. */
export async function OrderSubscription(shop: Shop) {
  return subscriptionBlock(await orderView(shop));
}

/** The files bought (D117); nothing for an order without any. */
export async function OrderDownloads(shop: Shop) {
  return downloadsBlock(await orderView(shop));
}

/** Where the order is delivered (D117); nothing for an order that is not shipped. */
export async function OrderAddress(shop: Shop) {
  return addressBlock(await orderView(shop));
}

/** A link back to the store (D117). The order's address is checked first: it is the shopper's own order. */
export async function OrderContinue(shop: Shop) {
  return continueLink(await orderView(shop));
}

function statusBlock({ order, m }: OrderView) {
  return (
    <>
      <RefreshWhile waiting={order.status === "pending_payment"} />
      {/* The paid order has emptied the cart; show the header without it. */}
      {order.status !== "pending_payment" && <RefreshOnce id={`order:${order.id}:${order.status}`} />}
      <div className="flex flex-col gap-6">
        <div role="status" aria-live="polite">
          <h1 className="text-3xl font-heading tracking-tight">
            {order.status === "cancelled" ? (order.wasPaid ? m.orderCancelledPaid : m.orderCancelled) : m.thanks}
          </h1>
          {order.status === "pending_payment" && <p className="mt-2">{m.paymentPending}</p>}
        </div>
        <p>
          {m.orderNumber}: <strong>{order.number}</strong>. {order.status !== "cancelled" && m.keepNumber}
        </p>
      </div>
    </>
  );
}

function accountBlock({ store, market, order, sessionId, m, account }: OrderView) {
  if (!account?.outcome) return null;
  return (
    <AccountOutcome
      account={account}
      store={store.slug}
      market={market.slug}
      m={m}
      signIn={checkoutSignInAction.bind(null, store.slug, market.slug, order.id, sessionId)}
      accountUrl={marketPath(store.slug, market.slug, "/account")}
    />
  );
}

function bookingsBlock({ store, market, order, sessionId, m }: OrderView) {
  return <OwnBookings order={order} store={store.slug} market={market} m={m} sessionId={sessionId} />;
}

function linesList({ market, order, m, money }: OrderView) {
  return (
    <ul className="divide-y divide-border">
      {order.lines.map((line) => (
        <li key={line.id} className="flex items-center gap-3 py-2">
          <LineThumbnail src={line.image} />
          <span className="min-w-0 flex-1">
            {isRange(line.booking) ? line.title : `${line.quantity} × ${line.title}`}
            {line.booking && <span className="block text-sm">{bookingWhen(line.booking, market.locale, m)}</span>}
          </span>
          <span className="whitespace-nowrap">
            {line.gift ? (
              <>
                <span className="text-muted line-through">{money(line.unitPriceMinor * line.quantity)}</span>{" "}
                {m.freeGift}
              </>
            ) : (
              money(line.unitPriceMinor * line.quantity)
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function totalsList({ order, m, money }: OrderView) {
  return (
    <dl className="flex flex-col gap-1">
      {order.ships && (
        <div className="flex justify-between">
          <dt>{order.delivery?.label ?? m.shipping}</dt>
          <dd>{order.shippingMinor === 0 ? m.freeShipping : money(order.shippingMinor)}</dd>
        </div>
      )}
      {order.ships && order.delivery?.pickupPoint && (
        <p className="text-sm text-muted">{m.deliveryChoice.pickupAt(pickupPointLine(order.delivery.pickupPoint))}</p>
      )}
      {order.discountMinor > 0 && (
        <div className="flex justify-between">
          <dt>
            {m.discount}
            {discountNote(order) && <span className="text-sm text-muted"> ({discountNote(order)})</span>}
          </dt>
          <dd>−{money(order.discountMinor)}</dd>
        </div>
      )}
      {order.referralDiscountMinor > 0 && (
        // The friend's welcome discount (D131).
        <div className="flex justify-between">
          <dt>{m.affiliate.discountRow}</dt>
          <dd>−{money(order.referralDiscountMinor)}</dd>
        </div>
      )}
      {order.bonus && order.bonus.usedMinor > 0 && (
        // Bonus credits used (D130).
        <div className="flex justify-between">
          <dt>{m.bonus.usedRow}</dt>
          <dd>−{money(order.bonus.usedMinor)}</dd>
        </div>
      )}
      <div className="flex justify-between font-semibold">
        <dt>{m.total}</dt>
        <dd>{money(order.totalMinor)}</dd>
      </div>
      <div className="flex justify-between text-sm text-muted">
        <dt>{m.vatAmount}</dt>
        <dd>{money(order.taxMinor)}</dd>
      </div>
      {order.balanceMinor > 0 && (
        // Paid at the appointment (D66): what is still to pay there.
        <div className="flex justify-between">
          <dt>{m.booking.atVenue}</dt>
          <dd>{money(order.balanceMinor)}</dd>
        </div>
      )}
      {order.company && (
        // Bought for a business (B2B): the total without VAT, and whom for.
        <>
          <div className="flex justify-between text-sm text-muted">
            <dt>{m.totalExclVat}</dt>
            <dd>{money(order.totalMinor - order.taxMinor)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-sm">
            <dt>{order.company.name}</dt>
            <dd>
              {m.company.number}: {order.company.number}
            </dd>
          </div>
        </>
      )}
    </dl>
  );
}

/** What the order earned in bonus credits (D130) and from when they can be used; nothing for an order that earned none. */
function earnedNote({ market, order, m, money }: OrderView) {
  const earned = earnedText(order.bonus, {
    money,
    date: (iso) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "long" }),
    line: m.bonus.earnedLine,
    ready: m.bonus.earnedNow,
  });
  return earned && <p className="mt-3 text-sm">{earned}</p>;
}

function subscriptionBlock({ store, market, m, subscription }: OrderView) {
  if (!subscription || subscription.status === "pending" || subscription.status === "expired") return null;
  return (
    <section aria-labelledby="subscription-heading">
      <h2 id="subscription-heading" className="mb-1 font-medium">
        {m.subscription}
      </h2>
      <p>
        {m.planEvery(subscription.interval, subscription.intervalCount)} · {m.subscriptionStatus[subscription.status]}
      </p>
      <Link
        href={marketPath(store.slug, market.slug, `/subscription/${subscription.manageToken}`)}
        className="mt-2 inline-block underline"
      >
        {m.manageSubscription}
      </Link>
    </section>
  );
}

function downloadsBlock({ store, market, order, m, digital, paid, downloads }: OrderView) {
  if (!digital || order.status === "cancelled") return null;
  return (
    <section aria-labelledby="downloads-heading">
      <h2 id="downloads-heading" className="mb-2 font-medium">
        {m.downloads}
      </h2>
      {paid ? (
        <Downloads
          downloads={downloads}
          base={marketPath(store.slug, market.slug, "/download")}
          m={m}
          locale={market.locale}
        />
      ) : (
        <p className="text-sm text-muted">{m.downloadsAfterPayment}</p>
      )}
    </section>
  );
}

function addressBlock({ order, m }: OrderView) {
  const address = order.shippingAddress;
  if (!order.ships || !address.line1) return null;
  return (
    <section>
      <h2 className="mb-1 font-medium">{m.deliverTo}</h2>
      <address className="not-italic">
        {[address.name, address.line1, address.line2, `${address.postalCode ?? ""} ${address.city ?? ""}`]
          .filter((part) => part && part.trim())
          .map((part) => (
            <span key={part} className="block">
              {part}
            </span>
          ))}
      </address>
    </section>
  );
}

function continueLink({ store, market, m }: OrderView) {
  return (
    <Link href={marketPath(store.slug, market.slug)} className="underline">
      {m.continueShopping}
    </Link>
  );
}

/** Each file with its link; a plain link, so nothing fetches it ahead of a click. */
function Downloads({
  downloads,
  base,
  m,
  locale,
}: {
  downloads: OrderDownload[];
  base: string;
  m: Messages;
  locale: string;
}) {
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "long" });
  return (
    <ul className="divide-y divide-border">
      {downloads.map((file) => (
        <li key={file.token} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-muted">
              {[
                fileSize(file.sizeBytes),
                !file.gone && file.left !== null && m.downloadsLeft(file.left),
                !file.gone && file.expiresAt && m.downloadUntil(date(file.expiresAt)),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {file.gone ? (
            <p className="max-w-sm text-sm">{m.downloadGone}</p>
          ) : (
            <a
              href={`${base}/${file.token}`}
              className="inline-flex min-h-11 items-center button-primary px-5 text-sm font-medium"
            >
              {m.download}
              <span className="sr-only">: {file.name}</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What became of the account asked for at checkout (D32). */
function AccountOutcome({
  account,
  store,
  market,
  m,
  signIn,
  accountUrl,
}: {
  account: CheckoutAccount;
  store: string;
  market: string;
  m: Messages;
  signIn: () => Promise<void>;
  accountUrl: string;
}) {
  const a = m.account;
  if (account.outcome === "created") {
    return (
      <section aria-labelledby="account-heading" className="flex flex-col gap-3">
        <h2 id="account-heading" className="font-medium">
          {a.accountCreated}
        </h2>
        <p>{a.accountCreatedIntro(account.email)}</p>
        {account.canSignIn ? (
          <form action={signIn}>
            <button type="submit" className="min-h-11 button-primary px-5 font-medium">
              {a.goToAccount}
            </button>
          </form>
        ) : (
          <Link href={accountUrl} className="underline">
            {a.goToAccount}
          </Link>
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-3">
      <h2 id="account-heading" className="font-medium">
        {a.accountKnownTitle}
      </h2>
      <p>{a.accountKnown(account.email)}</p>
      <PasswordReset
        store={store}
        market={market}
        email={account.email}
        labels={{
          email: a.email,
          sendCode: a.sendCode,
          sending: a.sending,
          code: a.code,
          newCode: a.newCode,
          resetIntro: a.resetIntro,
          newPassword: a.newPassword,
          passwordRule: a.passwordRule,
          saveAndSignIn: a.saveAndSignIn,
          signingIn: a.signingIn,
        }}
      />
    </section>
  );
}
