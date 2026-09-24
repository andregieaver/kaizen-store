import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { checkoutSignInAction } from "@/app/s/[store]/[market]/account/actions";
import { PasswordReset } from "@/components/account-sign-in";
import { RefreshOnce, RefreshWhile } from "@/components/refresh-while";
import { t, type Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { fileSize } from "@/lib/file-size";
import { getCheckoutAccount, type CheckoutAccount } from "@/server/customers";
import { getOrderDownloads, getShopperOrder, type OrderDownload } from "@/server/orders";
import { resolveShop } from "@/server/shop";
import { getSubscriptionForOrder } from "@/server/subscriptions";

type Props = PageProps<"/s/[store]/[market]/order/[orderId]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Everything here depends on the order in the address, so it all renders per request. */
export default function OrderPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <OrderDetails params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function OrderDetails({
  params,
  searchParams,
}: {
  params: Props["params"];
  searchParams: Props["searchParams"];
}) {
  const { store: storeSlug, market: marketSlug, orderId } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const sessionId = (await searchParams).session_id;
  if (!z.uuid().safeParse(orderId).success || typeof sessionId !== "string") notFound();
  const order = await getShopperOrder(store.id, orderId, sessionId);
  if (!order) notFound();
  const m: Messages = t(market.lang);
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const address = order.shippingAddress;
  const digital = order.lines.some((line) => line.delivery === "digital" && line.variantId !== null);
  const paid = order.status === "paid" || order.status === "fulfilled" || order.status === "closed";
  const [downloads, subscription, account] = await Promise.all([
    digital && paid ? getOrderDownloads(store.id, order.id) : [],
    order.subscriptionId ? getSubscriptionForOrder(store.id, order.id) : null,
    getCheckoutAccount(store.id, order.id),
  ]);
  const downloadBase = marketPath(store.slug, market.slug, "/download");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <RefreshWhile waiting={order.status === "pending_payment"} />
      {/* The paid order has emptied the cart; show the header without it. */}
      {order.status !== "pending_payment" && <RefreshOnce id={`order:${order.id}:${order.status}`} />}
      <div role="status" aria-live="polite">
        <h1 className="text-3xl font-semibold tracking-tight">
          {order.status === "cancelled" ? m.orderCancelled : m.thanks}
        </h1>
        {order.status === "pending_payment" && <p className="mt-2">{m.paymentPending}</p>}
      </div>
      <p>
        {m.orderNumber}: <strong>{order.number}</strong>. {order.status !== "cancelled" && m.keepNumber}
      </p>

      {account?.outcome && (
        <AccountOutcome
          account={account}
          store={store.slug}
          market={market.slug}
          m={m}
          signIn={checkoutSignInAction.bind(null, store.slug, market.slug, order.id, sessionId)}
          accountUrl={marketPath(store.slug, market.slug, "/account")}
        />
      )}

      <section aria-label={m.cart} className="rounded-lg border border-border p-4">
        <ul className="divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.sku} className="flex justify-between gap-4 py-2">
              <span>
                {line.quantity} × {line.title}
              </span>
              <span>{money(line.unitPriceMinor * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          {order.ships && (
            <div className="flex justify-between">
              <dt>{m.shipping}</dt>
              <dd>{order.shippingMinor === 0 ? m.freeShipping : money(order.shippingMinor)}</dd>
            </div>
          )}
          {order.discountMinor > 0 && (
            <div className="flex justify-between">
              <dt>
                {m.discount}
                {order.discountCode && <span className="text-sm text-muted"> ({order.discountCode})</span>}
              </dt>
              <dd>−{money(order.discountMinor)}</dd>
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
        </dl>
      </section>

      {subscription && subscription.status !== "pending" && subscription.status !== "expired" && (
        <section aria-labelledby="subscription-heading" className="rounded-lg border border-border p-4">
          <h2 id="subscription-heading" className="mb-1 font-medium">
            {m.subscription}
          </h2>
          <p>
            {m.planEvery(subscription.interval, subscription.intervalCount)} ·{" "}
            {m.subscriptionStatus[subscription.status]}
          </p>
          <Link
            href={marketPath(store.slug, market.slug, `/subscription/${subscription.manageToken}`)}
            className="mt-2 inline-block underline"
          >
            {m.manageSubscription}
          </Link>
        </section>
      )}

      {digital && order.status !== "cancelled" && (
        <section aria-labelledby="downloads-heading" className="rounded-lg border border-border p-4">
          <h2 id="downloads-heading" className="mb-2 font-medium">
            {m.downloads}
          </h2>
          {paid ? (
            <Downloads downloads={downloads} base={downloadBase} m={m} locale={market.locale} />
          ) : (
            <p className="text-sm text-muted">{m.downloadsAfterPayment}</p>
          )}
        </section>
      )}

      {order.ships && address.line1 && (
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
      )}

      <Link href={marketPath(store.slug, market.slug)} className="underline">
        {m.continueShopping}
      </Link>
    </div>
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
              className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background"
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
      <section aria-labelledby="account-heading" className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h2 id="account-heading" className="font-medium">
          {a.accountCreated}
        </h2>
        <p>{a.accountCreatedIntro(account.email)}</p>
        {account.canSignIn ? (
          <form action={signIn}>
            <button type="submit" className="min-h-11 rounded-full bg-foreground px-5 font-medium text-background">
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
    <section aria-labelledby="account-heading" className="flex flex-col gap-3 rounded-lg border border-border p-4">
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
