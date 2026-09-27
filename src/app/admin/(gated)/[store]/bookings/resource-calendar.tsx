import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { addDays } from "@/lib/booking-slots";
import { exportDates } from "@/lib/calendar-sync";
import { siteUrl } from "@/lib/site";
import type { ResourceKind } from "@/server/bookings";
import { calendarPath, listBlocks, listFeeds } from "@/server/calendar-sync";

import {
  addBlockAction,
  addFeedAction,
  removeBlockAction,
  removeFeedAction,
  resetCalendarAction,
  syncFeedAction,
} from "./actions";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const small = "min-h-10 rounded-md border border-border px-3 text-sm";

/**
 * A resource's blocked dates and calendar sync (D67): dates the store closes
 * it, other sites' calendars read in (rooms and items), and the address of
 * its own calendar for those sites to read.
 */
export async function ResourceCalendar({
  storeSlug,
  storeId,
  timeZone,
  resource,
}: {
  storeSlug: string;
  storeId: string;
  timeZone: string;
  resource: { id: string; kind: ResourceKind; name: string; calendarToken: string | null };
}) {
  const [blocks, feeds] = await Promise.all([listBlocks(storeId, resource.id), listFeeds(storeId, resource.id)]);
  const unit = resource.kind === "unit";
  const staff = resource.kind === "staff";
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  const noon = (date: string) => new Date(`${date}T12:00:00Z`);
  const span = (startsAt: string, endsAt: string) => {
    const { start, end } = exportDates(resource.kind, Date.parse(startsAt), Date.parse(endsAt), timeZone);
    const last = addDays(end, -1);
    const count = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
    const length = unit ? (count === 1 ? "1 night" : `${count} nights`) : count === 1 ? "1 day" : `${count} days`;
    return `${day.formatRange(noon(start), noon(last))} (${length})`;
  };
  const address = resource.calendarToken ? `${siteUrl()}${calendarPath(resource.calendarToken)}` : null;

  return (
    <>
      <section aria-labelledby="blocks-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <div>
          <h2 id="blocks-heading" className="font-medium">
            {staff ? "Time off" : "Blocked dates"}
          </h2>
          <p className="text-sm text-muted">
            {staff
              ? "Days they take no appointments, such as holidays."
              : unit
                ? "Nights it cannot be booked here: your own use, repairs, or bookings made elsewhere."
                : "Days it cannot be rented here: repairs, or rentals made elsewhere."}
          </p>
        </div>
        {blocks.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                <div>
                  <span className="font-medium tabular-nums">{span(b.startsAt, b.endsAt)}</span>
                  <span className="block text-muted">{[b.feed && `From ${b.feed}`, b.note].filter(Boolean).join(" · ")}</span>
                  {b.clashes > 0 && (
                    <span role="alert" className="block text-red-700 dark:text-red-400">
                      Overlaps {b.clashes === 1 ? "a booking" : `${b.clashes} bookings`} here: booked twice. Cancel one of them.
                    </span>
                  )}
                </div>
                {b.feed ? (
                  <span className="text-xs text-muted">Goes when {b.feed} drops it</span>
                ) : (
                  <form action={removeBlockAction.bind(null, storeSlug, b.id)}>
                    <button type="submit" className={small}>
                      Open again <span className="sr-only">{span(b.startsAt, b.endsAt)}</span>
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addBlockAction.bind(null, storeSlug, resource.id)} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className={field}>
              {unit ? "First night" : "First day"}
              <input type="date" name="from" required className={control} />
            </label>
            <label className={field}>
              {unit ? "Last night" : "Last day"}
              <input type="date" name="to" required className={control} />
            </label>
            <label className={`${field} min-w-48 flex-1`}>
              Note <span className="font-normal text-muted">(only you see it)</span>
              <input name="note" maxLength={200} className={control} />
            </label>
          </div>
          <div>
            <SubmitButton>Block</SubmitButton>
          </div>
        </ActionForm>
      </section>

      {!staff && (
        <section aria-labelledby="sync-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
          <div>
            <h2 id="sync-heading" className="font-medium">
              Calendar sync
            </h2>
            <p className="text-sm text-muted">
              Listed on Airbnb, Booking.com or another site too? Give each site this {unit ? "room's" : "item's"} calendar
              address, and add theirs below, so a booking made on one closes the dates on the others. Other sites are read
              every 15 minutes.
            </p>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <h3 className="font-medium">This {unit ? "room's" : "item's"} calendar</h3>
            {address ? (
              <>
                <label className={field}>
                  <span className="sr-only">Calendar address</span>
                  <input readOnly value={address} className={`${control} font-mono text-xs`} />
                </label>
                <p className="text-muted">
                  Paste it where the other site imports a calendar. It shows only which days are taken, never who booked.
                </p>
                <form action={resetCalendarAction.bind(null, storeSlug, resource.id)}>
                  <button type="submit" className={small}>
                    Make a new address (the old one stops working)
                  </button>
                </form>
              </>
            ) : (
              <form action={resetCalendarAction.bind(null, storeSlug, resource.id)}>
                <button type="submit" className={small}>
                  Make a calendar address
                </button>
              </form>
            )}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <h3 className="font-medium">Other sites&apos; calendars</h3>
            {feeds.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {feeds.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <span className="font-medium">{f.name}</span>
                      <span className="block truncate font-mono text-xs text-muted">{f.url}</span>
                      <span className="block text-muted">
                        {f.syncedAt ? `Read ${when.format(new Date(f.syncedAt))}` : "Not read yet"}
                        {!f.error && f.syncedAt && ` · ${f.events === 1 ? "1 event" : `${f.events} events`}`}
                      </span>
                      {f.error && (
                        <span role="alert" className="block text-red-700 dark:text-red-400">
                          {f.error}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <form action={syncFeedAction.bind(null, storeSlug, f.id)}>
                        <button type="submit" className={small}>
                          Read now <span className="sr-only">{f.name}</span>
                        </button>
                      </form>
                      <form action={removeFeedAction.bind(null, storeSlug, f.id)}>
                        <button type="submit" className={small}>
                          Remove <span className="sr-only">{f.name}</span>
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={addFeedAction.bind(null, storeSlug, resource.id)} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <label className={`${field} w-40`}>
                  Site
                  <input name="name" required maxLength={80} placeholder="Airbnb" className={control} />
                </label>
                <label className={`${field} min-w-64 flex-1`}>
                  Its calendar address
                  <input name="url" type="url" required maxLength={2000} placeholder="https://…" className={control} />
                </label>
              </div>
              <div>
                <SubmitButton>Add calendar</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
