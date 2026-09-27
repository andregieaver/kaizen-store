import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";

import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { marketPath, storeHref } from "@/lib/paths";
import { listBookings } from "@/server/bookings";
import { requestIp } from "@/server/connect";
import { ensureHostTestAccount, getHostStripeAccounts, hostEarnings, storePaymentMode } from "@/server/host-payments";
import { hostListings, hostResources, requireHost } from "@/server/hosts";

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
  const { store, host } = await requireHost((await params).store);
  const tz = store.timeZone;
  const today = todayIn(tz);
  const [listings, resources, bookings, mode, accounts, earnings] = await Promise.all([
    hostListings(store.id, host.id),
    hostResources(store.id, host.id),
    listBookings(store.id, new Date(zonedTime(today, "00:00", tz)), new Date(zonedTime(addDays(today, AHEAD_DAYS), "00:00", tz)), ["unit", "item"], host.id),
    storePaymentMode(store.id),
    getHostStripeAccounts(store.id, host.id),
    hostEarnings(store.id, host.id),
  ]);
  // In test mode Kaizen makes the host's test account, as it does the store's (D20).
  if (mode === "test" && accounts.test?.cardPayments !== "active") {
    const ip = await requestIp();
    after(() => ensureHostTestAccount(store.id, host.id, ip));
  }
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const base = `/admin/hosting/${store.slug}`;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-8">
      <div>
        <p className="text-sm text-muted">{store.name}</p>
        <h1 className="text-2xl font-semibold">{host.name}</h1>
        <p className="text-sm text-muted">
          The store keeps {host.commissionBps / 100} % of each booking; you are paid the rest.
        </p>
      </div>

      {mode && (
        <HostPayouts
          storeSlug={store.slug}
          mode={mode}
          account={accounts[mode]}
          commissionPercent={host.commissionBps / 100}
          earnings={earnings}
          locale={store.markets[0]?.locale ?? "en-GB"}
        />
      )}

      <section aria-labelledby="bookings-heading" className="flex flex-col gap-2">
        <h2 id="bookings-heading" className="font-medium">
          Bookings, the next three months
        </h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
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
                  {b.status === "held" ? "Being paid for" : b.customer}
                  {b.orderNumber && <span className="block text-xs">Order {b.orderNumber}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="calendars-heading" className="flex flex-col gap-2">
        <h2 id="calendars-heading" className="font-medium">
          Your rooms and items
        </h2>
        <p className="text-sm text-muted">Block dates, and link your Airbnb or Booking.com calendars, so nothing is booked twice.</p>
        {resources.length === 0 ? (
          <p className="text-sm text-muted">The store has not given you any yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {resources.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 p-3">
                <span>{r.name}</span>
                <Link href={`${base}/units/${r.id}`} className="underline">
                  Calendar <span className="sr-only">for {r.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="listings-heading" className="flex flex-col gap-2">
        <h2 id="listings-heading" className="font-medium">
          Your listings
        </h2>
        {listings.length === 0 ? (
          <p className="text-sm text-muted">The store has not listed anything for you yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {listings.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 p-3">
                <span>{l.title}</span>
                {l.status === "active" && store.markets[0] ? (
                  <a href={storeHref(store.slug, marketPath(store.slug, store.markets[0].slug, `/p/${l.handle}`))} className="underline">
                    See it in the store
                  </a>
                ) : (
                  <span className="text-muted">Not for sale yet</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">To change a listing&apos;s text, pictures or prices, ask the store.</p>
      </section>
    </main>
  );
}
