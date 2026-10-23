import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";

import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { marketPath, storeHref } from "@/lib/paths";
import { listBookings } from "@/server/bookings";
import { requestIp } from "@/server/connect";
import { hostTaxStatus } from "@/server/dac7";
import { ensureHostTestAccount, getHostStripeAccounts, hostEarnings, storePaymentMode } from "@/server/host-payments";
import { hostListings, hostResources, requireHost } from "@/server/hosts";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { HostPayouts } from "./host-payouts";

export const metadata: Metadata = { title: "Hosting" };

const AHEAD_DAYS = 90;
/** Today where the store is: the page is rendered per request. */
const todayIn = (timeZone: string) => zonedDate(Date.now(), timeZone);

/**
 * A host's own area in a store (D71): their listings, the bookings of the
 * next three months, and their rooms and items, whose calendars they keep.
 * Nothing of the store's own or other hosts' is shown.
 */
export default async function HostOverviewPage({ params }: PageProps<"/admin/hosting/[store]">) {
  const { store, host, account } = await requireHost((await params).store);
  const lang = adminLangOf(account.adminLocale);
  const loc = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const t = adminText(lang, "bookings");
  const w = t.hosting;
  const tz = store.timeZone;
  const today = todayIn(tz);
  const [listings, resources, bookings, mode, accounts, earnings, taxes] = await Promise.all([
    hostListings(store.id, host.id),
    hostResources(store.id, host.id),
    listBookings(store.id, new Date(zonedTime(today, "00:00", tz)), new Date(zonedTime(addDays(today, AHEAD_DAYS), "00:00", tz)), ["unit", "item"], host.id),
    storePaymentMode(store.id),
    getHostStripeAccounts(store.id, host.id),
    hostEarnings(store.id, host.id),
    hostTaxStatus(store.id),
  ]);
  const tax = taxes.get(host.id);
  // In test mode Kaizen makes the host's test account, as it does the store's (D20).
  if (mode === "test" && accounts.test?.cardPayments !== "active") {
    const ip = await requestIp();
    after(() => ensureHostTestAccount(store.id, host.id, ip));
  }
  const when = new Intl.DateTimeFormat(loc, { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const base = `/admin/hosting/${store.slug}`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["payments"])}>
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <div>
        <p className="text-sm text-muted">{store.name}</p>
        <PageHeader
          title={<>{host.name}</>}
          description={fillWords(w.keeps, { n: host.commissionBps / 100 })}
        />
        </div>

      {mode && (
        <HostPayouts
          storeSlug={store.slug}
          mode={mode}
          account={accounts[mode]}
          commissionPercent={host.commissionBps / 100}
          earnings={earnings}
          locale={lang === "en" ? (store.markets[0]?.locale ?? "en-GB") : loc}
          words={t.payouts}
          dateLocale={loc}
        />
      )}

      <Card title={w.tax} className="flex flex-col gap-1 text-sm" compact>
        {tax?.details ? (
          <p>{w.taxGiven}</p>
        ) : (
          <p role="alert">{w.taxAsk}</p>
        )}
        {tax && tax.missingAddresses.length > 0 && (
          <p>{fillWords(w.addAddress, { list: tax.missingAddresses.join(", ") })}</p>
        )}
        <Link href={`${base}/tax`} className="underline">
          {tax?.details ? w.changeTax : w.giveTax}
        </Link>
      </Card>

      <section aria-labelledby="bookings-heading" className="flex flex-col gap-2">
        <h2 id="bookings-heading" className="text-title text-ink">
          {w.bookings}
        </h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-muted">{w.noneYet}</p>
        ) : (
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap justify-between gap-2 p-3">
                <span>
                  <span className="font-medium tabular-nums">
                    {when.format(new Date(b.startsAt))} – {when.format(new Date(b.endsAt))}
                  </span>
                  <span className="block">
                    {b.service} · {b.staff}
                  </span>
                </span>
                <span className="text-right text-muted">
                  {b.status === "held" ? t.week.beingPaid : b.customer}
                  {b.orderNumber && <span className="block text-xs">{fillWords(t.week.order, { number: b.orderNumber })}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="calendars-heading" className="flex flex-col gap-2">
        <h2 id="calendars-heading" className="text-title text-ink">
          {w.rooms}
        </h2>
        <p className="text-sm text-muted">{w.roomsHint}</p>
        {resources.length === 0 ? (
          <p className="text-sm text-muted">{w.noRooms}</p>
        ) : (
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {resources.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 p-3">
                <span>{r.name}</span>
                <Link href={`${base}/units/${r.id}`} className="underline">
                  {w.calendar} <span className="sr-only">{fillWords(w.calendarFor, { name: r.name })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="listings-heading" className="flex flex-col gap-2">
        <h2 id="listings-heading" className="text-title text-ink">
          {w.listings}
        </h2>
        {listings.length === 0 ? (
          <p className="text-sm text-muted">{w.noListings}</p>
        ) : (
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {listings.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 p-3">
                <span>{l.title}</span>
                {l.status === "active" && store.markets[0] ? (
                  <a href={storeHref(store.slug, marketPath(store.slug, store.markets[0].slug, `/p/${l.handle}`))} className="underline">
                    {w.seeIt}
                  </a>
                ) : (
                  <span className="text-muted">{w.notForSale}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">{w.askStore}</p>
      </section>
    </div>
    </AdminTextScope>
  );
}
