import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DeleteAccountButton, DetailsForm, PasswordForm, SignOutButton } from "@/components/account-forms";
import { AccountSignIn } from "@/components/account-sign-in";
import { t, type Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { renewalState, type PlanInterval } from "@/lib/subscriptions";
import {
  getCustomer,
  type CustomerSubscription,
  lastShippingAddress,
  listCustomerOrders,
  listCustomerSubscriptions,
} from "@/server/customers";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/account">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * My account (D28): signing in, then the customer's orders, subscriptions,
 * details and password in one place.
 */
export default function AccountPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Account params={params} />
      </Suspense>
    </div>
  );
}

async function Account({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const a = m.account;
  const customer = await getCustomer(store.id);

  if (!customer) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight">{a.signInTitle}</h1>
        <AccountSignIn
          store={store.slug}
          market={market.slug}
          labels={{
            intro: a.signInIntro,
            email: a.email,
            sendCode: a.sendCode,
            sending: a.sending,
            code: a.code,
            signIn: a.signIn,
            signingIn: a.signingIn,
            newCode: a.newCode,
            otherEmail: a.otherEmail,
            usePassword: a.usePassword,
            useCode: a.useCode,
            password: a.password,
          }}
        />
      </>
    );
  }

  const [orders, subscriptions, lastAddress] = await Promise.all([
    listCustomerOrders(store.id, customer.id),
    listCustomerSubscriptions(store.id, customer.id),
    customer.address.line1 ? Promise.resolve(null) : lastShippingAddress(store.id, customer.id),
  ]);
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "medium" });
  const base = marketPath(store.slug, market.slug);
  // Until the customer saves their own, the address their last order went to.
  const address = lastAddress ?? customer.address;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{a.hello(customer.name.split(" ")[0] ?? "")}</h1>
          <p className="text-sm text-muted">{a.signedInAs(customer.email)}</p>
        </div>
        <SignOutButton store={store.slug} market={market.slug} label={a.signOut} />
      </div>

      <section aria-labelledby="orders-heading" className="flex flex-col gap-3">
        <h2 id="orders-heading" className="text-xl font-semibold">{a.orders}</h2>
        {orders.length === 0 ? (
          <p className="text-muted">{a.noOrders}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`${base}/account/orders/${order.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 hover:bg-surface"
                >
                  <span>
                    <span className="font-medium">{a.order(order.number)}</span>
                    <span className="block text-sm text-muted">
                      {date(order.placedAt)} · {a.items(order.items)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block">{formatMoney(order.totalMinor, order.currency, market.locale)}</span>
                    <span className="block text-sm text-muted">{a.status[order.status] ?? order.status}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="subscriptions-heading" className="flex flex-col gap-3">
        <h2 id="subscriptions-heading" className="text-xl font-semibold">{a.subscriptions}</h2>
        {subscriptions.length === 0 ? (
          <p className="text-muted">{a.noSubscriptions}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {subscriptions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="font-medium">{s.titles.join(", ")}</span>
                  <span className="block text-sm text-muted">
                    {m.planEvery(s.interval, s.intervalCount)} · {formatMoney(s.totalMinor, s.currency, market.locale)} ·{" "}
                    {m.subscriptionStatus[s.status as keyof typeof m.subscriptionStatus] ?? s.status}
                  </span>
                  {s.status !== "cancelled" && <RenewalNote subscription={s} m={m} date={date} />}
                </span>
                <Link
                  href={`${base}/subscription/${s.manageToken}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-5"
                >
                  {a.manage}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
        <h2 id="details-heading" className="text-xl font-semibold">{a.details}</h2>
        <DetailsForm
          store={store.slug}
          market={market.slug}
          values={{
            name: customer.name,
            phone: customer.phone,
            line1: address.line1 ?? "",
            line2: address.line2 ?? "",
            postalCode: address.postalCode ?? "",
            city: address.city ?? "",
          }}
          labels={{
            name: a.name,
            phone: a.phone,
            address: a.address,
            addressLine2: a.addressLine2,
            postalCode: a.postalCode,
            city: a.city,
            save: a.save,
            saving: a.saving,
          }}
        />
      </section>

      <section aria-labelledby="password-heading" className="flex flex-col gap-3">
        <h2 id="password-heading" className="text-xl font-semibold">{a.security}</h2>
        <p className="text-sm text-muted">{customer.hasPassword ? a.passwordSet : a.passwordNone}</p>
        <PasswordForm
          store={store.slug}
          market={market.slug}
          email={customer.email}
          hasPassword={customer.hasPassword}
          labels={{ newPassword: a.newPassword, rule: a.passwordRule, save: a.setPassword, remove: a.removePassword, saving: a.saving }}
        />
      </section>

      <section aria-labelledby="delete-heading" className="flex flex-col gap-2 border-t border-border pt-6">
        <h2 id="delete-heading" className="font-semibold">{a.deleteTitle}</h2>
        <p className="text-sm text-muted">{a.deleteIntro}</p>
        <DeleteAccountButton store={store.slug} market={market.slug} labels={{ button: a.deleteButton, confirm: a.deleteConfirm }} />
      </section>
    </>
  );
}

/** The next step of a running subscription: it ends, is paused, is in its trial, or renews (D29). */
function RenewalNote({
  subscription,
  m,
  date,
}: {
  subscription: CustomerSubscription;
  m: Messages;
  date: (iso: string) => string;
}) {
  const state = renewalState({ ...subscription, interval: subscription.interval as PlanInterval });
  if (!state) return null;
  const when = date(state.date.toISOString());
  const text =
    state.kind === "ends"
      ? m.endsOn(when)
      : state.kind === "paused"
        ? m.pausedUntil(when)
        : state.kind === "trial"
          ? m.trialUntil(when)
          : m.nextRenewal(when);
  return <span className="block text-sm text-muted">{text}</span>;
}
