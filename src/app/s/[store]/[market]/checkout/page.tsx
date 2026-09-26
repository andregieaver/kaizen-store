import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { CheckoutButton } from "@/components/checkout-button";
import { CheckoutCodeForm } from "@/components/checkout-code-form";
import { CheckoutForm } from "@/components/checkout-form";
import { withoutVat } from "@/lib/b2b";
import { CHECKOUT_MINUTES, stripeLocale } from "@/lib/checkout";
import { checkoutLabels } from "@/lib/checkout-labels";
import { t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { readCartId } from "@/server/cart";
import { getOpenCheckout } from "@/server/checkout";
import { cartRemindersOn, checkoutOptedOut } from "@/server/cart-reminders";
import { getCustomer } from "@/server/customers";
import { getCartCode } from "@/server/discounts";
import { getOrder, type OrderView } from "@/server/orders";
import { resolveShop } from "@/server/shop";
import { platformPublishableKey } from "@/server/stripe";
import type { Store } from "@/server/stores";

type Props = PageProps<"/s/[store]/[market]/checkout">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, market } = await params;
  const shop = await resolveShop(store, market);
  return shop ? { title: t(shop.market.lang).checkoutTitle, robots: { index: false, follow: false } } : {};
}

/**
 * Kaizen's checkout page (decision D22): the order placed from the cart,
 * paid with Stripe's form on the store's own Stripe account. The cart's
 * checkout button places the order and sends the shopper here; without an
 * order waiting for payment, the shopper is sent back to the cart.
 */
export default async function CheckoutPage({ params }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const m = t(shop.market.lang);
  return (
    <>
      <h1 className="mb-6 text-3xl font-heading tracking-tight">{m.checkoutTitle}</h1>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-surface" />}>
        <Checkout store={shop.store} market={shop.market} m={m} />
      </Suspense>
    </>
  );
}

async function Checkout({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const base = marketPath(store.slug, market.slug);
  const cartId = await readCartId({ storeId: store.id, market });
  const open = cartId ? await getOpenCheckout(store.id, cartId) : null;
  const order = open ? await getOrder(store.id, open.orderId) : null;
  if (!open || !order) redirect(`${base}/cart`);
  const publishableKey = platformPublishableKey(open.mode);
  const [customer, reminders, cartCode] = await Promise.all([
    getCustomer(store.id),
    cartRemindersOn(store.id),
    getCartCode({ storeId: store.id, market }),
  ]);
  const optedOut = reminders && !customer ? await checkoutOptedOut(store.id, cartId!) : false;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const restart = open.expired || open.changed || !publishableKey;

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-start">
      <Summary
        order={order}
        m={m}
        money={money}
        renewal={
          open.subscription
            ? m.renewsEvery(
                m.planEvery(open.subscription.interval, open.subscription.intervalCount),
                money(open.subscription.totalMinor),
              )
            : null
        }
        code={
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
        }
      />
      <div className="flex flex-col gap-6 md:order-first">
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
                pay: m.pay(money(order.totalMinor)),
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
              links={{
                cart: `${base}/cart`,
                order: `${base}/order/${open.orderId}?session_id=${encodeURIComponent(open.sessionId)}`,
              }}
            />
          </>
        )}
        <Link href={`${base}/cart`} className="text-sm underline">
          {m.backToCart}
        </Link>
      </div>
    </div>
  );
}

/** The order as placed: what the shopper pays for, from Kaizen's own figures. */
function Summary({
  order,
  m,
  money,
  renewal,
  code,
}: {
  order: OrderView;
  m: Messages;
  money: (minor: number) => string;
  /** A subscription's terms, repeated where the shopper pays (D25). */
  renewal: string | null;
  /** The field for a discount code (D38). */
  code: ReactNode;
}) {
  // A business sees amounts without VAT, and the VAT on its own line (B2B).
  const business = order.company !== null;
  const net = (minor: number) => money(business ? withoutVat(minor, order.vatRate) : minor);
  return (
    <section aria-labelledby="summary-heading" className="rounded-lg border border-border p-4 md:sticky md:top-4">
      <h2 id="summary-heading" className="mb-3 font-medium">
        {m.orderSummary}
      </h2>
      <ul className="divide-y divide-border">
        {order.lines.map((line) => (
          <li key={line.sku} className="flex justify-between gap-4 py-2 text-sm">
            <span>
              {line.quantity} × {line.title}
            </span>
            <span className="whitespace-nowrap">{net(line.unitPriceMinor * line.quantity)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-border pt-3">{code}</div>
      <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <dt>{m.subtotal}</dt>
          <dd>{net(order.subtotalMinor)}</dd>
        </div>
        {order.ships && (
          <div className="flex justify-between">
            <dt>{m.shipping}</dt>
            <dd>{order.shippingMinor === 0 ? m.freeShipping : net(order.shippingMinor)}</dd>
          </div>
        )}
        {order.discountMinor > 0 && (
          <div className="flex justify-between">
            <dt>
              {m.discount}
              {order.discountCode && <span className="text-sm text-muted"> ({order.discountCode})</span>}
            </dt>
            <dd>−{net(order.discountMinor)}</dd>
          </div>
        )}
        {business ? (
          <>
            <div className="flex justify-between border-t border-border pt-1">
              <dt>{m.totalExclVat}</dt>
              <dd>{money(order.totalMinor - order.taxMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{m.vatLine}</dt>
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
            <div className="flex justify-between text-muted">
              <dt>{m.vatAmount}</dt>
              <dd>{money(order.taxMinor)}</dd>
            </div>
          </>
        )}
      </dl>
      {order.company && (
        <p className="mt-3 border-t border-border pt-3 text-sm">
          {order.company.name}
          <span className="block text-muted">
            {m.company.number}: {order.company.number}
          </span>
        </p>
      )}
      {renewal && <p className="mt-3 border-t border-border pt-3 text-sm">{renewal}</p>}
    </section>
  );
}
