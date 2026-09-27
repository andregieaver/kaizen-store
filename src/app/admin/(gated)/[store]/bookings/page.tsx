import type { Metadata } from "next";
import Link from "next/link";

import { layoutDay, minuteOfDay, weekStart } from "@/lib/booking-calendar";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { formatMoney } from "@/lib/money";
import { hoursOn } from "@/lib/opening-hours";
import { requireMember } from "@/server/auth";
import { NoShowForm } from "@/components/admin/no-show-form";
import { listBookings, listResources, type StoreBooking } from "@/server/bookings";

import { CancelBookingForm } from "./cancel-booking-form";

export const metadata: Metadata = { title: "Bookings" };

/** Height of an hour in the week grid, in pixels. */
const HOUR = 48;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Now, for which bookings have started: the page is rendered per request. */
const nowMs = () => Date.now();

/** Today's date where the store is: the page is rendered per request. */
const todayIn = (timeZone: string) => zonedDate(Date.now(), timeZone);

/**
 * The store's appointments a week at a time, in its time zone (D65): a
 * grid of the week on larger screens, and every booking by day below it,
 * where one can be cancelled.
 */
export default async function BookingsPage({ params, searchParams }: PageProps<"/admin/[store]/bookings">) {
  const { store } = await requireMember((await params).store);
  const query = await searchParams;
  const tz = store.timeZone;
  const today = todayIn(tz);
  const now = nowMs();
  const monday = weekStart(typeof query.week === "string" && DATE.test(query.week) ? query.week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [all, staff] = await Promise.all([
    listBookings(store.id, new Date(zonedTime(monday, "00:00", tz)), new Date(zonedTime(addDays(monday, 7), "00:00", tz))),
    listResources(store.id),
  ]);
  const staffId = typeof query.staff === "string" && staff.some((s) => s.id === query.staff) ? query.staff : null;
  const bookings = staffId ? all.filter((b) => b.resourceId === staffId) : all;
  const dayOf = (b: StoreBooking) => zonedDate(Date.parse(b.startsAt), tz);

  // The hours shown: the staff's working hours this week and every booking, at least 08–18.
  let first = 8 * 60;
  let last = 18 * 60;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  for (const member of staff.filter((s) => s.active && (!staffId || s.id === staffId))) {
    for (const day of days) {
      const hours = hoursOn(member.hours, day);
      if (hours) {
        first = Math.min(first, minutes(hours.open));
        last = Math.max(last, minutes(hours.close));
      }
    }
  }
  for (const b of bookings) {
    first = Math.min(first, minuteOfDay(b.startsAt, tz));
    // Past midnight: to the end of the day.
    const end = dayOf(b) === zonedDate(Date.parse(b.endsAt), tz) ? minuteOfDay(b.endsAt, tz) : 24 * 60;
    last = Math.max(last, end);
  }
  const startHour = Math.floor(first / 60);
  const endHour = Math.min(24, Math.ceil(last / 60));
  const height = (endHour - startHour) * HOUR;

  const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const noon = (date: string) => new Date(`${date}T12:00:00Z`);
  const href = (week: string, who: string | null = staffId) =>
    `/admin/${store.slug}/bookings?week=${week}${who ? `&staff=${who}` : ""}`;
  const span = (b: StoreBooking) => `${time.format(new Date(b.startsAt))}–${time.format(new Date(b.endsAt))}`;
  const chip = "rounded-full border border-border px-3 py-1 text-sm";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted">
            Week of {longDay.format(noon(monday))}, in {tz.replace("_", " ")} time.
          </p>
        </div>
        <nav aria-label="Weeks" className="flex flex-wrap gap-2 text-sm">
          <Link href={href(addDays(monday, -7))} className={chip}>
            ← Previous
          </Link>
          <Link href={href(today)} className={chip} aria-current={monday === weekStart(today) ? "page" : undefined}>
            This week
          </Link>
          <Link href={href(addDays(monday, 7))} className={chip}>
            Next →
          </Link>
        </nav>
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

      {staff.length > 1 && (
        <nav aria-label="Staff" className="flex flex-wrap gap-2">
          <Link href={href(monday, null)} className={`${chip} ${staffId ? "" : "bg-foreground text-background"}`}>
            Everyone
          </Link>
          {staff.map((member) => (
            <Link
              key={member.id}
              href={href(monday, member.id)}
              className={`${chip} ${staffId === member.id ? "bg-foreground text-background" : ""}`}
            >
              {member.name}
            </Link>
          ))}
        </nav>
      )}

      {/* The week as a grid, on screens wide enough for seven columns. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-background md:block" data-week-grid>
        <div className="grid min-w-[48rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          <div className="border-b border-border" />
          {days.map((day) => (
            <div
              key={day}
              className={`border-b border-l border-border p-2 text-center text-sm ${day === today ? "font-semibold" : ""}`}
            >
              {dayLabel.format(noon(day))}
            </div>
          ))}
          <div className="relative" style={{ height }}>
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <span key={i} className="absolute right-2 -translate-y-1/2 text-xs text-muted tabular-nums" style={{ top: i * HOUR }}>
                {i === 0 ? "" : `${String(startHour + i).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const list = bookings.filter((b) => dayOf(b) === day);
            const placed = layoutDay(
              list.map((b) => ({
                id: b.id,
                start: minuteOfDay(b.startsAt, tz),
                end: zonedDate(Date.parse(b.endsAt), tz) === day ? minuteOfDay(b.endsAt, tz) : 24 * 60,
              })),
            );
            return (
              <div key={day} className={`relative border-l border-border ${day === today ? "bg-surface/60" : ""}`} style={{ height }}>
                {Array.from({ length: endHour - startHour - 1 }, (_, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ top: (i + 1) * HOUR }} />
                ))}
                {placed.map((item) => {
                  const b = list.find((x) => x.id === item.id)!;
                  const top = ((item.start - startHour * 60) / 60) * HOUR;
                  return (
                    <a
                      key={b.id}
                      href={`#booking-${b.id}`}
                      title={`${span(b)} ${b.service} · ${b.staff}${b.customer ? ` · ${b.customer}` : ""}`}
                      className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-xs leading-tight hover:z-10 hover:shadow ${
                        b.status === "held"
                          ? "border-dashed border-border bg-background text-muted"
                          : "border-foreground/20 bg-surface"
                      }`}
                      style={{
                        top,
                        height: Math.max(20, ((item.end - item.start) / 60) * HOUR - 2),
                        left: `calc(${(item.lane / item.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / item.lanes}% - 4px)`,
                      }}
                    >
                      <span className="font-medium tabular-nums">{time.format(new Date(b.startsAt))}</span> {b.service}
                      <span className="block truncate text-muted">{b.staff}</span>
                    </a>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Every booking this week by day, with what can be done about it. */}
      {bookings.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">No bookings this week.</p>
      ) : (
        <div className="flex max-w-3xl flex-col gap-6">
          {days
            .filter((day) => bookings.some((b) => dayOf(b) === day))
            .map((day) => (
              <section key={day} aria-label={longDay.format(noon(day))}>
                <h2 className="mb-2 font-medium">{longDay.format(noon(day))}</h2>
                <ul className="divide-y divide-border rounded-lg border border-border bg-background">
                  {bookings
                    .filter((b) => dayOf(b) === day)
                    .map((b) => (
                      <li key={b.id} id={`booking-${b.id}`} className="flex scroll-mt-4 flex-wrap items-start justify-between gap-3 p-3 text-sm target:bg-surface">
                        <div>
                          <span className="font-medium tabular-nums">{span(b)}</span> {b.service}
                          <span className="block text-muted">
                            {b.staff}
                            {b.customer && ` · ${b.customer}`}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1 text-right">
                          {b.status === "held" ? (
                            <span className="rounded bg-surface px-1.5 py-0.5 text-xs">Being paid for</span>
                          ) : (
                            b.orderId && (
                              <Link href={`/admin/${store.slug}/orders/${b.orderId}`} className="underline">
                                Order {b.orderNumber}
                              </Link>
                            )
                          )}
                          {b.noShowAt && <span className="rounded bg-surface px-1.5 py-0.5 text-xs">No-show</span>}
                          {b.status === "confirmed" && !b.noShowAt && Date.parse(b.startsAt) <= now && (
                            <details className="text-left">
                              <summary className="cursor-pointer text-right text-muted underline">No-show…</summary>
                              <NoShowForm
                                storeSlug={store.slug}
                                bookingId={b.id}
                                feeLabel={
                                  b.noShowFeeMinor > 0 && b.currency
                                    ? formatMoney(b.noShowFeeMinor, b.currency, store.markets[0]?.locale ?? "en-GB")
                                    : null
                                }
                              />
                            </details>
                          )}
                          {b.status === "confirmed" && Date.parse(b.startsAt) > now && (
                            <CancelBookingForm storeSlug={store.slug} bookingId={b.id} />
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
