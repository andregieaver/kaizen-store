import Link from "next/link";

import { AccountAccess } from "@/components/account-sign-in";
import { AccountTabs, AvatarPicker, DetailsForm, PasswordForm, SignOutButton } from "@/components/lazy/shop";
import { Avatar } from "@/components/avatar";
import type { IconName } from "@/components/icons";
import { BonusCard } from "@/components/bonus-account-view";
import { PrivacyCard } from "@/components/privacy-account-view";
import { ReferralCard } from "@/components/referrals-account-view";
import { accountTab, accountTabHref, type AccountTabId } from "@/lib/account-tabs";
import { t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { StoreQuery } from "@/lib/store-parts";
import { formatMoney } from "@/lib/money";
import { marketHome, marketPath } from "@/lib/paths";
import { shopperPrivacyText } from "@/lib/privacy-text";
import { renewalState, type PlanInterval } from "@/lib/subscriptions";
import { avatarFor } from "@/server/avatars";
import {
  getCustomer,
  type CustomerOrder,
  type CustomerSubscription,
  lastShippingAddress,
  listCustomerOrders,
  listCustomerSubscriptions,
} from "@/server/customers";
import { affiliateSite } from "@/server/affiliates";
import { creatorProgramOn } from "@/server/creators";
import { shopperBonus } from "@/server/bonus";
import { companyOf } from "@/server/companies";
import { googleSignInOffered, googleStartUrl } from "@/server/google-sign-in";
import { hasBuyerCatalogue } from "@/server/price-lists";
import type { Store } from "@/server/stores";

import { accountSubscription } from "@/server/marketing-subscribers";
import { accountSms } from "@/server/sms";

import { avatarAction, newsAction, smsAction } from "./actions";
import { featureOn } from "@/lib/store-features";

/**
 * My account (D28): signing in, then the customer's account in four tabs (D480): the overview (recent orders, what runs now and what
 * else they have here), the orders, their own details and their settings. The account page shows it, and so does a store's own page
 * for it (D113).
 */
export function AccountSection(props: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Account {...props} />
    </div>
  );
}

async function Account({ store, market, query }: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  const m = t(market.lang);
  const a = m.account;
  const customer = await getCustomer(store.id);

  if (!customer) {
    return (
      <>
        <h1 className="text-3xl font-heading tracking-tight">{a.title}</h1>
        <SignInForm store={store} market={market} query={query} />
      </>
    );
  }

  const [orders, subscriptions, lastAddress, mine, bonus, referrals, news, catalogue, creators, q, sms] = await Promise.all([
    listCustomerOrders(store.id, customer.id),
    // Subscriptions (D178): the list is there while the feature is on; switching it off waits until none runs, and each one's own link
    // from its emails keeps working.
    featureOn(store, "subscriptions") ? listCustomerSubscriptions(store.id, customer.id) : Promise.resolve(null),
    customer.address.line1 ? Promise.resolve(null) : lastShippingAddress(store.id, customer.id),
    companyOf(store.id, customer.id),
    shopperBonus({ storeId: store.id, market }, customer.id),
    affiliateSite(store.id),
    accountSubscription(store.id, customer.id),
    // Products an exclusive price list makes the customer's (D321 C.3).
    hasBuyerCatalogue(store.id, customer.id),
    // The creator programme (D386): a card to apply or to one's own page while it works.
    creatorProgramOn(store.id),
    query,
    // Marketing texts (D565): offered only by a store with SMS on.
    accountSms(store.id, customer.id),
  ]);
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "medium" });
  const base = marketPath(store.slug, market.slug);
  const account = marketPath(store.slug, market.slug, "/account");
  const tabHref = (tab: AccountTabId) => accountTabHref(account, tab);
  // Until the customer saves their own, the address their last order went to.
  const address = lastAddress ?? customer.address;
  const avatar = avatarFor(customer);
  const avatarColours = "bg-accent text-accent-foreground";
  const shopOn = featureOn(store, "shop");

  // What else the customer has here, each a card on the overview: only what this store and this customer have.
  const shortcuts = [
    // A company account is part of selling to businesses (D178): its card is there only while that is on.
    mine && featureOn(store, "business") && (
      <Shortcut
        key="company"
        href={`${base}/account/company`}
        title={`${m.companyAccount.title}: ${mine.company.name}`}
        text={mine.role === "owner" ? m.companyAccount.cardIntroOwner : m.companyAccount.cardIntroEmployee}
      />
    ),
    catalogue && shopOn && <Shortcut key="catalogue" href={`${base}/account/catalogue`} title={m.buyerCatalogue.title} text={m.buyerCatalogue.card} />,
    store.deliveriesOn && <Shortcut key="deliveries" href={`${base}/deliveries`} title={m.deliveries.title} text={m.deliveries.accountCard} />,
    // Product reviews (D301): the buyer's own, from what they received; only while the store has reviews on.
    featureOn(store, "reviews") && <Shortcut key="reviews" href={`${base}/account/reviews`} title={m.reviews.cardTitle} text={m.reviews.cardIntro} />,
    bonus.enabled && <BonusCard key="bonus" bonus={bonus} m={m} locale={market.locale} base={base} decimals={market.priceStyle?.decimals} />,
    referrals.on && <ReferralCard key="referrals" enabled m={m} base={base} />,
    creators && <Shortcut key="creator" href={`${base}/account/creator`} title={m.creator.title} text={m.creator.card} />,
  ].filter(Boolean);

  const orderRows = (shown: CustomerOrder[]) => (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {shown.map((order) => (
        <li key={order.id}>
          <Link
            href={`${base}/account/orders/${order.id}`}
            className="flex items-center justify-between gap-4 p-4 hover:bg-surface"
          >
            {/* A long order number wraps; the total and the state keep to the right. */}
            <span className="min-w-0 break-words">
              <span className="font-medium">{a.order(order.number)}</span>
              <span className="block text-sm text-muted">
                {date(order.placedAt)} · {a.items(order.items)}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-right">
              <span className="font-medium">{formatMoney(order.totalMinor, order.currency, market.locale, market.priceStyle)}</span>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs">{a.status[order.status] ?? order.status}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  // No orders yet: say so, and where to begin.
  const noOrders = (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-border p-4">
      <p className="text-muted">{a.noOrders}</p>
      {shopOn && (
        <Link href={marketHome(store.slug, market.slug)} className="inline-flex min-h-11 items-center button-primary px-5 font-medium">
          {a.toShop}
        </Link>
      )}
    </div>
  );

  const overview = (
    <>
      <section aria-labelledby="recent-orders-heading" className="flex flex-col gap-3">
        <h2 id="recent-orders-heading" className="text-xl font-heading">
          {orders.length === 0 ? a.orders : a.recentOrders}
        </h2>
        {orders.length === 0 ? noOrders : orderRows(orders.slice(0, 3))}
        {orders.length > 3 && (
          // Opens the Orders tab: a plain link, which the tabs open at once (`data-account-tab`), and which works without them too.
          <a href={tabHref("orders")} data-account-tab="orders" className="self-start text-sm underline">
            {a.orderList.seeAll}
          </a>
        )}
      </section>

      {/* Subscriptions (D29): what runs now is part of the overview; nothing is said here of none. */}
      {subscriptions && subscriptions.length > 0 && (
        <section aria-labelledby="subscriptions-heading" className="flex flex-col gap-3">
          <h2 id="subscriptions-heading" className="text-xl font-heading">{a.subscriptions}</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {subscriptions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="font-medium">{s.titles.join(", ")}</span>
                  <span className="block text-sm text-muted">
                    {m.planEvery(s.interval, s.intervalCount)} · {formatMoney(s.totalMinor, s.currency, market.locale, market.priceStyle)} ·{" "}
                    {m.subscriptionStatus[s.status as keyof typeof m.subscriptionStatus] ?? s.status}
                  </span>
                  {s.status !== "cancelled" && <RenewalNote subscription={s} m={m} date={date} />}
                </span>
                <Link
                  href={`${base}/subscription/${s.manageToken}`}
                  className="inline-flex min-h-11 items-center rounded-button border border-border px-5"
                >
                  {a.manage}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shortcuts.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{shortcuts}</div>}
    </>
  );

  const ordersTab = (
    <section aria-labelledby="orders-heading" className="flex flex-col gap-3">
      <h2 id="orders-heading" className="text-xl font-heading">{a.orders}</h2>
      {orders.length === 0 ? noOrders : orderRows(orders.slice(0, ORDERS_SHOWN))}
      {/* The order list of its own (D304 J2) searches and filters them all, and pages through the older ones. */}
      {orders.length > ORDERS_SHOWN ? (
        <Link href={`${base}/account/orders`} className="self-start text-sm underline">
          {a.orderList.more}
        </Link>
      ) : (
        orders.length > 3 && (
          <Link href={`${base}/account/orders`} className="self-start text-sm underline">
            {a.orderList.search}
          </Link>
        )
      )}
    </section>
  );

  const profile = (
    <>
      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
        <h2 id="details-heading" className="text-xl font-heading">{a.details}</h2>
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
          company={
            store.audience === "consumers"
              ? undefined
              : { name: customer.companyName, number: customer.organisationNumber, labels: m.company }
          }
        />
      </section>

      {/* Saved addresses (D304): the places they send to, on a page of their own. */}
      <Shortcut href={`${base}/account/addresses`} title={a.addresses.manage} text={a.addresses.intro} />

      <section aria-labelledby="picture-heading" className="flex flex-col gap-3">
        <h2 id="picture-heading" className="text-xl font-heading">{a.pictureTitle}</h2>
        <AvatarPicker
          avatar={avatar}
          ownPicture={Boolean(customer.avatarPath)}
          action={avatarAction.bind(null, store.slug, market.slug)}
          avatarClassName={avatarColours}
          buttonClassName="min-h-11 rounded-button border border-border px-5 disabled:opacity-40"
          labels={{
            choose: a.pictureChoose,
            change: a.pictureChange,
            remove: a.pictureRemove,
            working: a.pictureWorking,
            hint: a.pictureHint,
            unreadable: a.pictureUnreadable,
          }}
        />
      </section>
    </>
  );

  const settings = (
    <>
      <section aria-labelledby="password-heading" className="flex flex-col gap-3">
        <h2 id="password-heading" className="text-xl font-heading">{a.security}</h2>
        <p className="text-sm text-muted">{customer.hasPassword ? a.passwordSet : a.passwordNone}</p>
        <PasswordForm
          store={store.slug}
          market={market.slug}
          email={customer.email}
          hasPassword={customer.hasPassword}
          labels={{ newPassword: a.newPassword, rule: a.passwordRule, save: a.setPassword, remove: a.removePassword, saving: a.saving }}
        />
      </section>

      {/* Marketing email (D295): the customer's own consent, given or taken back in one press, with the words they agree to. */}
      <section aria-labelledby="news-heading" className="flex flex-col gap-3">
        <h2 id="news-heading" className="text-xl font-heading">{m.news.heading}</h2>
        <p role="status" className="text-sm text-muted">
          {news === "subscribed" ? m.news.on : news === "pending" ? m.news.pending : m.news.off}
        </p>
        <form action={newsAction.bind(null, store.slug, market.slug, news !== "subscribed")} className="flex flex-col gap-3">
          {news !== "subscribed" && <p className="text-sm">{m.news.consent(store.name)}</p>}
          <button type="submit" className="min-h-11 self-start rounded-button border border-border px-5">
            {news === "subscribed" ? m.news.unsubscribe : m.news.subscribe}
          </button>
        </form>
      </section>

      {/* Marketing texts (D565): the customer's own number, agreed to or stopped in one press, with the words they agree to. */}
      {sms.offered && (
        <section aria-labelledby="sms-heading" className="flex flex-col gap-3">
          <h2 id="sms-heading" className="text-xl font-heading">{m.sms.heading}</h2>
          <p role="status" className="text-sm text-muted">
            {sms.status === "subscribed" && sms.phone ? m.sms.on(sms.phone) : m.sms.off}
          </p>
          {q.sms === "number" && sms.status !== "subscribed" && (
            <p role="alert" className="text-sm">
              {m.sms.badPhone}
            </p>
          )}
          <form action={smsAction.bind(null, store.slug, market.slug, sms.status !== "subscribed")} className="flex flex-col gap-3">
            {sms.status !== "subscribed" && (
              <>
                <p className="text-sm">{m.sms.consent(store.name)}</p>
                <label className="flex flex-col gap-1 text-sm">
                  {m.sms.phone}
                  <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={32} defaultValue={customer.phone} className="min-h-11 max-w-xs rounded-md border border-border bg-background px-3" />
                </label>
              </>
            )}
            <button type="submit" className="min-h-11 self-start rounded-button border border-border px-5">
              {sms.status === "subscribed" ? m.sms.unsubscribe : m.sms.subscribe}
            </button>
          </form>
        </section>
      )}

      <PrivacyCard text={shopperPrivacyText(market.lang)} storeName={store.name} href={`${base}/account/privacy`} />
    </>
  );

  const tabs: { id: AccountTabId; icon: IconName }[] = [
    { id: "overview", icon: "grid" },
    { id: "orders", icon: "box" },
    { id: "profile", icon: "user" },
    { id: "settings", icon: "sliders" },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar avatar={avatar} size={56} className={avatarColours} />
          <div className="min-w-0">
            <h1 className="text-3xl font-heading tracking-tight">{a.hello(customer.name.split(" ")[0] ?? "")}</h1>
            <p className="break-words text-sm text-muted">{a.signedInAs(customer.email)}</p>
          </div>
        </div>
        <SignOutButton store={store.slug} market={market.slug} label={a.signOut} />
      </div>

      {/* My account in four tabs (D480): what is going on first, the rest one press away, each tab in the address. */}
      <AccountTabs
        label={a.title}
        initial={accountTab(q.tab)}
        tabs={tabs.map(({ id, icon }) => ({ id, icon, label: a.tabs[id], href: tabHref(id) }))}
        panels={{ overview, orders: ordersTab, profile, settings }}
      />
    </>
  );
}

/** How many orders the Orders tab lists; the order list of its own (`/account/orders`) has the rest. */
const ORDERS_SHOWN = 20;

/** A card in My account that leads to a page of its own: its name, a line on what is there, and an arrow. */
function Shortcut({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 hover:bg-surface">
      <span className="min-w-0">
        <span className="font-medium">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}

/** Signing in or creating an account (D28), where the shopper is not signed in; `?tab=register` opens on Create account, e.g. from a link in the store's menu. */
export async function SignInForm({ store, market, query }: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  const a = t(market.lang).account;
  const q = await query;
  const register = q.tab === "register";
  // Sign in with Google (D375): offered once Kaizena Flow's Google client exists; it signs in an account the store already has, by email.
  const google = googleSignInOffered(store);
  const googleSaid = q.google === "no_account" ? a.googleNoAccount : q.google === "failed" ? a.googleFailed : null;
  return (
    <div className="flex flex-col gap-4">
      {googleSaid && (
        <p role="alert" className="rounded-md border border-border p-3 text-sm">
          {googleSaid}
        </p>
      )}
    <AccountAccess
      store={store.slug}
      market={market.slug}
      initialTab={register ? "register" : "sign-in"}
      // A website (D178 step 5: the online shop off) opens no new accounts; customers it has sign in for their orders and data.
      register={featureOn(store, "shop")}
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
        tabSignIn: a.tabSignIn,
        tabRegister: a.tabRegister,
        registerIntro: a.registerIntro,
        name: a.name,
        register: a.register,
        registering: a.registering,
        forgotPassword: a.forgotPassword,
        chooseNewPassword: a.chooseNewPassword,
        resetIntro: a.resetIntro,
        newPassword: a.newPassword,
        passwordRule: a.passwordRule,
        saveAndSignIn: a.saveAndSignIn,
      }}
    />
      {google && (
        <div className="flex flex-col items-start gap-2">
          <span className="text-sm text-muted">{a.googleOr}</span>
          {/* A full page load: the sign-in passes through Kaizena Flow's own address and Google's. */}
          <a href={googleStartUrl(store.slug, market.slug)} className="inline-flex min-h-11 items-center rounded-button border border-border px-5">
            {a.googleSignIn}
          </a>
        </div>
      )}
    </div>
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
