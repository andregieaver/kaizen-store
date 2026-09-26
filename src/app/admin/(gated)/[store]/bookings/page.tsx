import type { Metadata } from "next";
import Link from "next/link";

import { requireMember } from "@/server/auth";
import { listBookings } from "@/server/bookings";

export const metadata: Metadata = { title: "Bookings" };

const DAYS_SHOWN = 14;

/** The store's appointments in the next two weeks, by day, in its time zone (D65). */
export default async function BookingsPage({ params }: PageProps<"/admin/[store]/bookings">) {
  const { store } = await requireMember((await params).store);
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + (DAYS_SHOWN + 1) * 24 * 60 * 60 * 1000);
  const bookings = await listBookings(store.id, from, to);
  const locale = store.markets[0]?.locale ?? "en-GB";
  const day = new Intl.DateTimeFormat(locale, { timeZone: store.timeZone, weekday: "long", day: "numeric", month: "long" });
  const time = new Intl.DateTimeFormat(locale, { timeZone: store.timeZone, hour: "2-digit", minute: "2-digit" });
  const byDay = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const key = day.format(new Date(booking.startsAt));
    byDay.set(key, [...(byDay.get(key) ?? []), booking]);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <p className="text-sm text-muted">
          Appointments in the next two weeks, in {store.timeZone.replace("_", " ")} time.
        </p>
      </div>
      {!store.bookingsOn && (
        <p className="rounded-md border border-border p-3 text-sm">
          Appointments are switched off.{" "}
          <Link href={`/admin/${store.slug}/settings/features`} className="underline">
            Switch them on under Features
          </Link>
          .
        </p>
      )}
      {byDay.size === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">No bookings in the next two weeks.</p>
      ) : (
        [...byDay.entries()].map(([label, list]) => (
          <section key={label} aria-label={label}>
            <h2 className="mb-2 font-medium first-letter:uppercase">{label}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-background">
              {list.map((b) => (
                <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                  <div>
                    <span className="font-medium tabular-nums">
                      {time.format(new Date(b.startsAt))}–{time.format(new Date(b.endsAt))}
                    </span>{" "}
                    {b.service}
                    <span className="block text-muted">
                      {b.staff}
                      {b.customer && ` · ${b.customer}`}
                    </span>
                  </div>
                  <div className="text-right">
                    {b.status === "held" ? (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-xs">Being paid for</span>
                    ) : (
                      b.orderId && (
                        <Link href={`/admin/${store.slug}/orders/${b.orderId}`} className="underline">
                          Order {b.orderNumber}
                        </Link>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
