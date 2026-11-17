import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { CUSTOMERS_FEATURE } from "@/lib/store-nav";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CustomerForm, CustomerNotes, EMPTY_CUSTOMER_FORM } from "@/components/admin/customer-staff";
import { CustomerAffiliateSection, showsAffiliate } from "@/components/admin/customer-affiliate";
import { CustomerBonus, showsBonus } from "@/components/admin/customer-bonus";
import { CustomerMarketing } from "@/components/admin/customer-marketing";
import { CustomerTimeline } from "@/components/admin/customer-timeline";
import { StaffFieldsSection } from "@/components/admin/staff-fields-section";
import { accountLabel, moneyByCurrency } from "@/components/admin/customer-bar";
import { PrivacyBanner, PrivacyCard } from "@/components/admin/privacy/privacy-card";
import { Avatar } from "@/components/avatar";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import { DealsCard } from "@/components/admin/deals/deals-card";
import { ActivitiesCard } from "@/components/admin/activities/activities-card";
import { activityViews, newActivityValues } from "@/components/admin/activities/activity-view";
import { activitiesOf } from "@/server/activities";
import { activityActions, activityTeam } from "../../deals/activity-actions-of";
import { listDeals } from "@/server/deals";
import { TIMELINE_KINDS, askedKind } from "@/lib/customer-timeline";
import { exportProblemOf } from "@/lib/privacy-admin";
import { ORDER_STATUS_SIGNAL } from "@/lib/order-status";
import { canOpenPath } from "@/lib/permissions";
import { featureOn } from "@/lib/store-features";
import { customerAffiliate } from "@/server/affiliates";
import { holderOf } from "@/server/auth";
import { personSubscription } from "@/server/marketing-subscribers";
import { segmentsOfPerson } from "@/server/segment-membership";
import { personSms } from "@/server/sms";
import { customerReturns } from "@/server/dispute-evidence";
import { memberCan, requirePermission } from "@/server/permissions";
import { avatarFor } from "@/server/avatars";
import { getBonusSettings, customerBonus } from "@/server/bonus";
import { findCustomer, getCustomerDetail } from "@/server/customer-admin";
import { customerAccess, listTiers } from "@/server/customer-tiers";
import { notesOf, staffFormValues } from "@/server/customer-staff";
import { readTimeline } from "@/server/customer-timeline";
import { privacyCard } from "@/server/privacy-admin";
import { tagsOf } from "@/server/segments";
import { AdminLink, CARD_CLASS, Chip, PageHeader } from "@/components/admin/ui";
import { DotChip, Pictures } from "@/components/admin/home/home-parts";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { orderPreviews } from "@/server/home";
import { Mail } from "lucide-react";

import { blockAffiliateAction } from "../../affiliates/actions";
import { setCustomerGroupAction } from "../../customer-groups/actions";
import { addCustomerTagAction, addGuestAction, addNoteAction, adjustBonusAction, deleteNoteAction, removeCustomerTagAction, saveCustomerFieldsAction, updateCustomerAction } from "./actions";

/** How many orders a customer's page shows on a phone before *All orders* (round 20). */
const PHONE_ORDERS = 5;

export const metadata: Metadata = { title: "Customer" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * One customer (D35): who they are and how to reach them, what happened with them
 * as one timeline (D462: orders, quotes, conversations, emails, notes, returns and
 * more, each as the viewer may see it), every order and subscription they have;
 * each links to its own page, which links back here.
 */
export default async function CustomerPage({ params, searchParams }: PageProps<"/admin/[store]/customers/[customerId]">) {
  const { store: slug, customerId } = await params;
  const member = await requirePermission(slug, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, CUSTOMERS_FEATURE);
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "customers");
  const words = all.customer;
  const statuses = adminText(lang, "common").orderStatus;
  const query = await searchParams;
  const exportParam = query.export;
  const merged = query.merged === "1";
  // The timeline's filter and its *Show everything* (D462): plain links, `?show={kind}` and `?full=1`.
  const show = askedKind(query.show, TIMELINE_KINDS);
  const full = query.full === "1";
  if (!z.uuid().safeParse(customerId).success) notFound();
  const ref = await findCustomer(store.id, customerId);
  if (!ref) notFound();
  // An order's or subscription's id finds its customer; the page lives at the customer's own address.
  if (ref.key !== customerId) redirect(`/admin/${store.slug}/customers/${ref.key}`);
  // The store's marketing to them (ecosystem plan E2.4, D713): the list facts for staff who may read marketing, the segments for all.
  const mayMarketing = memberCan(member, "marketing:read");
  const [customer, timeline, groups, privacy, tags, notes, formValues, returns, subscription, sms, segments] = await Promise.all([
    getCustomerDetail(store.id, ref),
    // What happened with them, newest first, as this viewer may see it (D462); the emails they got are part of it.
    readTimeline(member, { kind: "person", email: ref.email, customerId: ref.customerId }, { show, full }),
    listTiers(store.id),
    // What the store holds about the person, and the open privacy request if staff logged one (D162).
    privacyCard(store.id, ref.key),
    tagsOf(store.id, ref.email),
    // Staff's own notes on the person and the details as the edit form starts (wave 10 unit C, D366).
    notesOf(store.id, ref.email, member.account.id),
    ref.customerId ? staffFormValues(store.id, ref.customerId) : Promise.resolve(null),
    // Whether they return a lot (D417): a chip under the name, the same as on their orders.
    customerReturns(store.id, ref),
    mayMarketing ? personSubscription(store.id, ref.email, ref.customerId) : Promise.resolve(null),
    mayMarketing ? personSms(store.id, ref.email, ref.customerId) : Promise.resolve(null),
    segmentsOfPerson(store, ref.email),
  ]);
  const mayTag = memberCan(member, "customers:write");
  if (!customer) notFound();
  const access = customer.customerId ? await customerAccess(store.id, customer.customerId) : null;
  // Bonus credits (D130) belong to the account, so a guest has none; hidden while the bonus program's feature is off (D178).
  const bonusOn = featureOn(store, "bonus");
  const [bonusSettings, bonus] = customer.customerId && bonusOn
    ? await Promise.all([getBonusSettings(store.id), customerBonus(store.id, customer.customerId)])
    : [null, null];
  // Referrals (D131) belong to the account too: their link, who referred them and the orders through links; hidden while the
  // referral program's feature is off (D178).
  const affiliate = customer.customerId && featureOn(store, "referrals") ? await customerAffiliate(store.id, customer.customerId) : null;
  // A company's part in the discount is selling to businesses' (D178): hidden, and not given, while that is off.
  const businessOn = featureOn(store, "business");
  const subscriptionsOn = featureOn(store, "subscriptions");
  const locale = store.markets[0]?.locale ?? "nb-NO";
  // Deals (S2, D464): the person's, while Deals is on.
  const salesOn = featureOn(store, "sales") && customer.customerId !== null;
  const deals = salesOn && customer.customerId ? await listDeals(store, { customerId: customer.customerId }) : [];
  const dealWords = adminText(lang, "deals");
  const [activities, team] =
    salesOn && customer.customerId
      ? await Promise.all([activitiesOf(store.id, { customerId: customer.customerId }), mayTag ? activityTeam(store.id) : Promise.resolve([])])
      : [[], []];
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const base = `/admin/${store.slug}`;
  const spent = moneyByCurrency(customer.spentMinor, locale, { whole: true });

  const address = customer.address;
  // Round 3 (D603): their first name in the page's words, the order still waiting to be sent, pictures of what they bought, new this month.
  const firstName = (customer.name || "").trim().split(/\s+/)[0] || customer.email;
  const waiting = customer.orderList.find((o) => o.status === "paid");
  const previews = await orderPreviews(store.id, customer.orderList.slice(0, 12).map((o) => o.id));
  const linesOf = new Map(previews.map((p) => [p.id, p.lines]));
  const sinceIso = [customer.firstOrderAt, customer.accountCreatedAt].filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  const monthStart = new Date(new Date().toLocaleString("en-US", { timeZone: store.timeZone }));
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const isNew = sinceIso !== null && Date.parse(sinceIso) >= monthStart.getTime() - 86_400_000;
  const menuItem = "flex min-h-10 w-full items-center rounded-panel px-3 text-left text-body text-ink hover:bg-sunken";

  return (
    <AdminTextScope texts={adminTexts(lang, ["customers", "privacy", "loyalty", "builder"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/customers`, label: words.back }}
        title={<span className="flex items-center gap-3"><Avatar avatar={avatarFor(customer)} size={56} /> <span className="min-w-0 break-words">{customer.name || customer.email}</span></span>}
        meta={[
          isNew && (
            <DotChip key="new" tone="positive">
              {words.newThisMonth}
            </DotChip>
          ),
          <DotChip key="account" tone="neutral">{accountLabel(customer.account, all.account)}</DotChip>,
          [address?.city, customer.name ? customer.email : null].filter(Boolean).join(" · ") || null,
          customer.lastSignInAt && fillWords(words.lastSignIn, { date: date(customer.lastSignInAt) }),
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {mayTag && (
              <MoreMenu label={words.moreMenu}>
                {!customer.customerId && (
                  <form action={addGuestAction.bind(null, store.slug, ref.key)}>
                    <button type="submit" className={menuItem}>
                      {all.staff.edit.makeAccount}
                    </button>
                  </form>
                )}
                {customer.customerId && (
                  <AdminLink href={`${base}/customers/${ref.key}/merge`} className={menuItem}>
                    {all.staff.merge.link}
                  </AdminLink>
                )}
                {/* A draft order that starts with this customer's details (ecosystem plan E2.6, D713). */}
                {customer.customerId && featureOn(store, "shop") && memberCan(member, "orders:write") && (
                  <AdminLink href={`${base}/orders/drafts/new?customer=${customer.customerId}`} className={menuItem}>
                    {all.staff.edit.makeDraft}
                  </AdminLink>
                )}
                {privacy && (
                  <>
                    <form method="post" action={`${base}/customers/${ref.key}/export`}>
                      <button type="submit" className={menuItem}>
                        {fillWords(words.downloadTheirs, { name: firstName })}
                      </button>
                    </form>
                    <span aria-hidden className="h-px bg-line" />
                    <AdminLink href={`${base}/customers/${ref.key}/erase${privacy.request ? `?request=${privacy.request.id}` : ""}`} className={`${menuItem} text-danger-text`}>
                      {fillWords(words.eraseTheirs, { name: firstName })}
                    </AdminLink>
                  </>
                )}
              </MoreMenu>
            )}
            <a href={`mailto:${customer.email}`} className="inline-flex h-11 items-center gap-2 rounded-pill border border-edge bg-card px-5 text-body text-ink hover:bg-sunken">
              <Mail aria-hidden className="size-4" />
              {fillWords(words.emailThem, { name: firstName })}
            </a>
          </div>
        }
      />

      {waiting && (
        <AdminLink href={`${base}/orders/${waiting.id}`} className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-panel bg-warning-soft px-5 py-4 text-ink">
          <span aria-hidden className="size-2 rounded-pill bg-warning-solid" />
          <span className="min-w-60 flex-1 text-body">{fillWords(words.waiting, { number: waiting.number })}</span>
          <span className="inline-flex h-10 items-center rounded-pill bg-brand px-4 text-body font-medium text-brand-ink">{words.openOrder} →</span>
        </AdminLink>
      )}

      {returns.often && (
        <p>
          <Chip signal="warning" dot>
            {fillWords(all.bar.returnsOften, { returned: returns.returned, orders: returns.orders })}
          </Chip>
        </p>
      )}

      {merged && <p role="status" className={`p-4 text-sm ${CARD_CLASS}`}>{all.staff.merge.merged}</p>}

      {privacy && <PrivacyBanner base={base} data={privacy} />}

      {/* Round 20 (D671): on a phone the figures share one row, small. */}
      <div className={`grid grid-cols-3 gap-2 sm:gap-3 ${subscriptionsOn ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        {[
          [words.figures.orders, String(customer.orders)],
          [words.figures.spent, spent || "–"],
          [words.since, sinceIso ? date(sinceIso) : "–"],
          // Subscriptions (D178): the figure and the list are there while the feature is on (off, none can be running).
          ...(subscriptionsOn ? [[words.figures.subscriptions, String(customer.liveSubscriptions)]] : []),
        ].map(([label, value]) => (
          <div key={label} className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 sm:p-4 ${CARD_CLASS}`}>
            <span className="truncate text-[11px] text-muted sm:text-sm">{label}</span>
            <span className="truncate text-[17px] tracking-tight tabular-nums sm:text-[26px]">{value}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="orders" className={card}>
            <h2 id="orders" className="mb-4 text-title text-ink">{fillWords(words.bought, { name: firstName })}</h2>
            {customer.orderList.length === 0 ? (
              <p className="text-sm text-muted">{words.noOrders}</p>
            ) : (
              <>
              {/* Round 20 (D671): on a phone each order is one line with a small picture, the newest five, then all of them on Orders. */}
              <ol aria-label={words.orders} className="flex flex-col gap-5 max-sm:gap-3">
                {customer.orderList.map((order, index) => {
                  const lines = linesOf.get(order.id) ?? [];
                  return (
                    <li key={order.id} className={`flex gap-3.5 ${index >= PHONE_ORDERS ? "max-sm:hidden" : ""}`}>
                      <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-pill ${order.status === "paid" ? "bg-warning-solid" : order.status === "cancelled" ? "bg-line" : "bg-insight-solid"}`} />
                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          {lines.length > 0 && (
                            <span className="self-center sm:hidden">
                              <Pictures lines={lines.map(({ title, picture }) => ({ title, picture }))} size={32} max={1} moreWord={(n) => `+${n}`} />
                            </span>
                          )}
                          <AdminLink href={`${base}/orders/${order.id}`} className="text-body text-ink underline-offset-2 hover:underline">
                            #{order.number}
                          </AdminLink>
                          <span className="text-caption text-muted">{date(order.placedAt)}</span>
                          <Chip signal={ORDER_STATUS_SIGNAL[order.status]} dot>
                            {order.status === "cancelled" ? words.cancelledRefunded : statuses[order.status]}
                          </Chip>
                          {order.subscriptionId && (
                            <Link href={`${base}/subscriptions/${order.subscriptionId}`} className="text-caption underline">
                              {words.subscription}
                            </Link>
                          )}
                          {order.refunded && order.status !== "cancelled" && <span className="text-caption text-muted">{words.refundedInPart}</span>}
                          <span className="ml-auto text-body tabular-nums">{formatMoney(order.totalMinor, order.currency, locale)}</span>
                        </div>
                        {lines.length > 0 ? (
                          <span className="max-sm:hidden">
                            <Pictures lines={lines.map(({ title, picture }) => ({ title, picture }))} size={72} max={5} moreWord={(n) => `+${n}`} />
                          </span>
                        ) : (
                          <span className="text-caption text-muted">{countWords(order.items, words.items)}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {customer.orderList.length > PHONE_ORDERS && (
                <AdminLink href={`${base}/orders?q=${encodeURIComponent(customer.email)}`} className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-ink underline underline-offset-2 sm:hidden">
                  {fillWords(words.allOrders, { n: customer.orders })}
                </AdminLink>
              )}
              </>
            )}
          </section>

          <details className={`${card} group`}>
            <summary className="cursor-pointer text-title text-ink">{words.happened}</summary>
            <div className="mt-4">
              <CustomerTimeline
                read={timeline}
                full={full}
                path={`${base}/customers/${ref.key}`}
                words={all.timeline}
                orderStatuses={statuses}
                locale={locale}
                timeZone={store.timeZone}
              />

            </div>
          </details>

          {subscriptionsOn && (
          <section aria-labelledby="subscriptions" className={card}>
            <h2 id="subscriptions" className="mb-3 text-title text-ink">{words.subscriptions}</h2>
            {customer.subscriptionList.length === 0 ? (
              <p className="text-sm text-muted">{words.noSubscriptions}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {customer.subscriptionList.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      <Link href={`${base}/subscriptions/${s.id}`} className="font-medium underline">
                        {fillWords(words.subscriptionNumber, { number: s.number })}
                      </Link>
                      <span className="block text-xs text-muted">
                        {words.subscriptionStatus[s.status]} ·{" "}
                        {countWords(s.intervalCount, words.every[(s.interval in words.every ? s.interval : "month") as keyof typeof words.every])} ·{" "}
                        {countWords(s.orders, all.list.orders)}
                        {s.currentPeriodEnd && ["active", "past_due"].includes(s.status) && fillWords(words.renews, { date: date(s.currentPeriodEnd) })}
                      </span>
                    </span>
                    <span className="whitespace-nowrap">{formatMoney(s.totalMinor, s.currency, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          )}

          {customer.customerId && bonusSettings && bonus && showsBonus(bonusSettings.enabled, bonus.entries) && (
            <CustomerBonus
              enabled={bonusSettings.enabled}
              balance={bonus.balance}
              entries={bonus.entries}
              locale={locale}
              adminBase={base}
              orderIds={Object.fromEntries(customer.orderList.map((o) => [o.number, o.id]))}
              who={customer.name || customer.email}
              adjust={adjustBonusAction.bind(null, store.slug, customer.customerId)}
              words={adminText(lang, "loyalty")}
            />
          )}

          {customer.customerId && affiliate && showsAffiliate(affiliate) && (
            <CustomerAffiliateSection
              data={affiliate}
              storeSlug={store.slug}
              locale={locale}
              who={customer.name || customer.email}
              block={blockAffiliateAction.bind(null, store.slug, customer.customerId)}
              words={adminText(lang, "loyalty")}
            />
          )}

          {/* Custom fields (D120) are kept for the customer's account, so a guest has none. */}
          {customer.customerId && (
            <StaffFieldsSection
              store={store}
              entity="customer"
              id={customer.customerId}
              save={saveCustomerFieldsAction.bind(null, store.slug, customer.customerId)}
            />
          )}

          {/* Staff's own changes to the person's details (wave 10 unit C, D366); a guest is given an account first. */}
          {mayTag && customer.customerId && (
            <details className={card}>
              <summary className="cursor-pointer text-title text-ink">{all.staff.edit.title}</summary>
              <section aria-label={all.staff.edit.title} className="mt-4">
                <CustomerForm
                  action={updateCustomerAction.bind(null, store.slug, customer.customerId)}
                  values={formValues ?? EMPTY_CUSTOMER_FORM}
                  words={all.staff.form}
                  submit={all.staff.form.save}
                  note={all.staff.form.emailChangeNote}
                />
              </section>
            </details>
          )}

        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="contact" className={`${card} text-sm`}>
            <h2 id="contact" className="mb-2 text-title text-ink">{words.contact}</h2>
            <a href={`mailto:${customer.email}`} className="break-all underline">
              {customer.email}
            </a>
            {customer.phone && (
              <p>
                <a href={`tel:${customer.phone}`} className="underline">
                  {customer.phone}
                </a>
              </p>
            )}
            {address && (
              <>
                <h3 className="mt-3 mb-1 text-body-strong text-ink">{words.address}</h3>
                <address className="not-italic">
                  {[address.name, address.line1, address.line2, `${address.postalCode ?? ""} ${address.city ?? ""}`, address.country]
                    .filter((part) => part && String(part).trim())
                    .map((part) => (
                      <span key={String(part)} className="block">
                        {part}
                      </span>
                    ))}
                </address>
              </>
            )}
          </section>
          {/* Staff's tags on the person (D296): words segments can choose people by. */}
          <section aria-labelledby="tags" className={`${card} text-sm`}>
            <h2 id="tags" className="mb-2 text-title text-ink">{words.tags}</h2>
            {tags.length === 0 ? (
              <p className="text-muted">{words.noTags}</p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label={words.tags}>
                {tags.map((tag) => (
                  <li key={tag.key} className="inline-flex items-center gap-1 rounded-pill bg-sunken px-3 py-1">
                    {tag.label}
                    {mayTag && (
                      <form action={removeCustomerTagAction.bind(null, store.slug, ref.key, tag.key)}>
                        <button type="submit" aria-label={fillWords(words.removeTag, { tag: tag.label })} className="rounded-pill px-1 text-muted hover:text-ink">
                          ×
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {mayTag && (
              <form action={addCustomerTagAction.bind(null, store.slug, ref.key)} className="mt-3 flex gap-2">
                <input name="tag" maxLength={40} required aria-label={words.newTag} placeholder={words.addTag} className="min-h-10 min-w-0 flex-1 rounded-md border border-line px-3" />
                <SubmitButton>{words.add}</SubmitButton>
              </form>
            )}
          </section>
          <CustomerMarketing
            lists={sms ? { subscription, sms } : null}
            segments={segments}
            segmentLinks={canOpenPath(holderOf(member), "/segments/[segmentId]")}
            base={base}
            words={words.marketing}
            date={date}
          />
          {salesOn && (
            <DealsCard
              deals={deals.map((d) => ({ id: d.id, title: d.title, status: d.status, value: d.value.minor === null ? null : formatMoney(d.value.minor, mainCurrency(store), locale, { decimals: "hide_whole" }) }))}
              base={base}
              addHref={mayTag ? `${base}/deals/new?customer=${customer.customerId}` : null}
              words={dealWords.card}
              statuses={dealWords.statuses}
            />
          )}
          {/* The calls, meetings and tasks about them (S3, D468), their deals' among them. */}
          {salesOn && customer.customerId && (
            <ActivitiesCard
              items={activityViews(activities, "customer", { now: new Date(), timeZone: store.timeZone, locale: ADMIN_LANG_FACTS[lang].locale, words: dealWords.activities, base, me: member.account.id })}
              words={dealWords.activities}
              actions={mayTag ? activityActions(store.slug) : null}
              team={team}
              me={member.account.id}
              blank={newActivityValues({ customerId: customer.customerId }, member.account.id, new Date(), store.timeZone)}
            />
          )}
          <CustomerNotes
            notes={notes}
            words={all.staff.notes}
            add={mayTag ? addNoteAction.bind(null, store.slug, ref.key) : null}
            remove={mayTag ? (noteId: string) => deleteNoteAction.bind(null, store.slug, ref.key, noteId) : null}
            date={date}
          />
          <details className={card}>
            <summary className="cursor-pointer">
              <span className="text-title text-ink">{words.accountPrivacy}</span>
              <span className="mt-1 block text-caption text-muted">{words.accountPrivacySub}</span>
            </summary>
            <div className="mt-4 flex flex-col gap-4 [&>section]:border-0 [&>section]:p-0">
              {customer.customerId && (
                <section aria-labelledby="discount" className={`${card} text-sm`}>
                  <h2 id="discount" className="mb-2 text-title text-ink">{words.discount}</h2>
                  {businessOn && access?.companyName && (
                    <p className="mb-2">
                      {access.role === "owner" ? words.mainAccountOf : words.employeeOf}
                      <Link href={`${base}/companies/${access.companyId}`} className="underline">
                        {access.companyName}
                      </Link>
                      {words.givesDiscount}
                    </p>
                  )}
                  <ActionForm action={setCustomerGroupAction.bind(null, store.slug, customer.customerId)} className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 font-medium">
                      {words.group}
                      <select name="groupId" defaultValue={access?.tierId ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 font-normal">
                        <option value="">{words.none}</option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name} ({group.percent} %){group.active ? "" : words.switchedOffSuffix}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <SubmitButton variant="secondary">{words.save}</SubmitButton>
                    </div>
                  </ActionForm>
                  <p className="mt-2 text-xs text-muted">
                    {businessOn && words.betterOfTwo}
                    <Link href={`${base}/customer-groups`} className="underline">{words.groupsLink}</Link>
                  </p>
                </section>
              )}

              {privacy && (
                <PrivacyCard
                  base={base}
                  customerKey={ref.key}
                  data={privacy}
                  canWrite={memberCan(member, "customers:write")}
                  timeZone={store.timeZone}
                  exportProblem={exportProblemOf(Array.isArray(exportParam) ? exportParam[0] : exportParam)}
                />
              )}

              <section aria-labelledby="more" className={`${card} text-sm`}>
                <h2 id="more" className="mb-2 text-title text-ink">{words.more}</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted">{words.accountTerm}</dt>
                  <dd>{accountLabel(customer.account, all.account)}</dd>
                  <dt className="text-muted">{words.wishlist}</dt>
                  <dd>
                    {customer.account && customer.customerId && customer.wishlistItems > 0 ? (
                      <Link href={`${base}/wishlists?customer=${customer.customerId}`} className="underline">
                        {countWords(customer.wishlistItems, words.items)}
                      </Link>
                    ) : customer.account ? (
                      words.nothingSaved
                    ) : (
                      "–"
                    )}
                  </dd>
                  <dt className="text-muted">{words.cartReminders}</dt>
                  <dd>{customer.cartRemindersOptedOut ? words.saidNo : words.allowed}</dd>
                </dl>
              </section>
            </div>
          </details>
        </div>
      </div>
    </div>
    </AdminTextScope>
  );
}
