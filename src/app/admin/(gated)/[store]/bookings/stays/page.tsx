import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { occupiedDates } from "@/lib/booking-ranges";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { exportDates } from "@/lib/calendar-sync";
import { requirePermission } from "@/server/permissions";
import { listBookings, listResources, type StoreBooking } from "@/server/bookings";
import { blocksBetween } from "@/server/calendar-sync";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { CancelBookingForm } from "../cancel-booking-form";

export const metadata: Metadata = { title: "Stays and rentals" };

const DAYS = 14;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Now and today where the store is: the page is rendered per request. */
const nowMs = () => Date.now();
const todayIn = (timeZone: string) => zonedDate(Date.now(), timeZone);

/**
 * Stays and rentals two weeks at a time (D67): which rooms and items are
 * taken each night or day, and every booking in those weeks, where one can
 * be cancelled.
 */
export default async function StaysPage({ params, searchParams }: PageProps<"/admin/[store]/bookings/stays">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "bookings");
  if (off) return off;
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const t = adminText(lang, "bookings");
  const w = t.stays;
  const loc = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const query = await searchParams;
  const tz = store.timeZone;
  const today = todayIn(tz);
  const now = nowMs();
  const from = typeof query.from === "string" && DATE.test(query.from) ? query.from : today;
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const start = new Date(zonedTime(from, "00:00", tz));
  const end = new Date(zonedTime(addDays(from, DAYS), "00:00", tz));
  const [bookings, units] = await Promise.all([
    listBookings(store.id, start, end, ["unit", "item"]),
    listResources(store.id, ["unit", "item"]),
  ]);
  const blocks = await blocksBetween(store.id, units.map((u) => u.id), start, end);
  const kindOf = new Map(units.map((u) => [u.id, u.kind]));
  const blocked = new Set<string>();
  for (const k of blocks) {
    const { start: first, end: after } = exportDates(kindOf.get(k.resourceId) ?? "unit", Date.parse(k.startsAt), Date.parse(k.endsAt), tz);
    for (let day = first; day < after; day = addDays(day, 1)) blocked.add(`${k.resourceId}|${day}`);
  }
  const taken = (b: StoreBooking) => occupiedDates(b.kind === "unit" ? "stay" : "rental", b.startsAt, b.endsAt, tz);
  const used = new Map<string, number>();
  for (const b of bookings) for (const day of taken(b)) used.set(`${b.resourceId}|${day}`, (used.get(`${b.resourceId}|${day}`) ?? 0) + 1);

  const noon = (date: string) => new Date(`${date}T12:00:00Z`);
  const dayHead = new Intl.DateTimeFormat(loc, { weekday: "narrow", day: "numeric", timeZone: "UTC" });
  const longDay = new Intl.DateTimeFormat(loc, { day: "numeric", month: "long", timeZone: "UTC" });
  const when = new Intl.DateTimeFormat(loc, { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const href = (date: string) => `/admin/${store.slug}/bookings/stays?from=${date}`;
  const chip = "rounded-full border border-line px-3 py-1 text-sm";

  return (
    <AdminTextScope texts={adminTexts(lang, ["bookings"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title={w.title}
          description={fillWords(w.span, { from: longDay.format(noon(from)), to: longDay.format(noon(addDays(from, DAYS - 1))), zone: tz.replace("_", " ") })}
        />
        <nav aria-label={t.week.weeks} className="flex flex-wrap gap-2 text-sm">
          <Link href={href(addDays(from, -DAYS))} className={chip}>
            {w.earlier}
          </Link>
          <Link href={href(today)} className={chip} aria-current={from === today ? "page" : undefined}>
            {w.today}
          </Link>
          <Link href={href(addDays(from, DAYS))} className={chip}>
            {w.later}
          </Link>
        </nav>
      </div>

      {units.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          {w.noUnits}{" "}
          <Link href={`/admin/${store.slug}/bookings/units`} className="underline">
            {w.addThem}
          </Link>
          {w.thenChoose}
        </p>
      ) : (
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-line p-2 text-left font-medium">
                  {w.unit}
                </th>
                {days.map((day) => (
                  <th
                    key={day}
                    scope="col"
                    className={`border-b border-l border-line p-1 text-center text-xs font-normal tabular-nums ${day === today ? "font-medium" : ""}`}
                  >
                    {dayHead.format(noon(day))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <th scope="row" className="border-b border-line p-2 text-left font-normal">
                    <Link href={`/admin/${store.slug}/bookings/units/${u.id}`} className="underline-offset-2 hover:underline">
                      {u.name}
                    </Link>
                    <span className="block text-xs text-muted">{u.kind === "unit" ? w.stays : w.rentals}</span>
                  </th>
                  {days.map((day) => {
                    const count = used.get(`${u.id}|${day}`) ?? 0;
                    const closed = blocked.has(`${u.id}|${day}`);
                    const full = count >= u.capacity;
                    return (
                      <td
                        key={day}
                        className={`border-b border-l border-line p-1 text-center text-xs tabular-nums ${
                          full ? "bg-inverse/80 text-inverse-ink" : count > 0 ? "bg-sunken" : closed ? "bg-sunken text-muted" : ""
                        }`}
                      >
                        {count > 0 ? (
                          u.capacity > 1 ? `${count}/${u.capacity}` : <span aria-label={w.taken}>●</span>
                        ) : closed ? (
                          <span aria-label={w.blocked}>×</span>
                        ) : (
                          ""
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bookings.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">{w.none}</p>
      ) : (
        <ul className={`flex max-w-3xl flex-col divide-y divide-line ${CARD_CLASS}`}>
          {bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
              <div>
                <span className="font-medium tabular-nums">
                  {when.format(new Date(b.startsAt))} – {when.format(new Date(b.endsAt))}
                </span>
                <span className="block">
                  {b.service} · {b.staff}
                </span>
                {b.customer && <span className="block text-muted">{b.customer}</span>}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                {b.status === "held" ? (
                  <span className="rounded bg-sunken px-1.5 py-0.5 text-xs">{t.week.beingPaid}</span>
                ) : (
                  b.orderId && (
                    <Link href={`/admin/${store.slug}/orders/${b.orderId}`} className="underline">
                      {fillWords(t.week.order, { number: b.orderNumber ?? "" })}
                    </Link>
                  )
                )}
                {b.status === "confirmed" && Date.parse(b.startsAt) > now && (
                  <CancelBookingForm storeSlug={store.slug} bookingId={b.id} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
    </AdminTextScope>
  );
}
