import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { addDays } from "@/lib/booking-slots";
import { exportDates } from "@/lib/calendar-sync";
import { siteUrl } from "@/lib/site";
import type { ResourceKind } from "@/server/bookings";
import { calendarPath, listBlocks, listFeeds } from "@/server/calendar-sync";
import { Card } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

/**
 * What the panel does, as server actions already bound to the store and
 * resource: the store's own (`storeCalendarActions()`), or a host's, which
 * check the resource is theirs (D71).
 */
export type CalendarActions = {
  addBlock: (state: FormState, formData: FormData) => Promise<FormState>;
  removeBlock: (blockId: string) => Promise<void>;
  resetCalendar: () => Promise<void>;
  addFeed: (state: FormState, formData: FormData) => Promise<FormState>;
  syncFeed: (feedId: string) => Promise<void>;
  removeFeed: (feedId: string) => Promise<void>;
};

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const small = "min-h-10 rounded-pill border border-edge px-3 text-sm";

/**
 * A resource's blocked dates and calendar sync (D67): dates the store closes
 * it, other sites' calendars read in (rooms and items), and the address of
 * its own calendar for those sites to read.
 */
export async function ResourceCalendar({
  storeId,
  timeZone,
  resource,
  actions,
  lang = "en",
}: {
  storeId: string;
  timeZone: string;
  resource: { id: string; kind: ResourceKind; name: string; calendarToken: string | null };
  actions: CalendarActions;
  /** The admin's language (D312 A11); English when none is given. */
  lang?: AdminLang;
}) {
  const w = adminText(lang, "bookings").calendar;
  const loc = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const [blocks, feeds] = await Promise.all([listBlocks(storeId, resource.id), listFeeds(storeId, resource.id)]);
  const unit = resource.kind === "unit";
  const staff = resource.kind === "staff";
  const day = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const when = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  const noon = (date: string) => new Date(`${date}T12:00:00Z`);
  const span = (startsAt: string, endsAt: string) => {
    const { start, end } = exportDates(resource.kind, Date.parse(startsAt), Date.parse(endsAt), timeZone);
    const last = addDays(end, -1);
    const count = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
    const length = countWords(count, unit ? w.nights : w.days);
    return `${day.formatRange(noon(start), noon(last))} (${length})`;
  };
  const address = resource.calendarToken ? `${siteUrl()}${calendarPath(resource.calendarToken)}` : null;

  return (
    <>
      <Card title={staff ? w.timeOff : w.blocked} description={staff ? w.timeOffHint : unit ? w.blockedUnitHint : w.blockedItemHint} className="flex flex-col gap-3" compact>
        {blocks.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                <div>
                  <span className="font-medium tabular-nums">{span(b.startsAt, b.endsAt)}</span>
                  <span className="block text-muted">{[b.feed && fillWords(w.from, { site: b.feed }), b.note].filter(Boolean).join(" · ")}</span>
                  {b.clashes > 0 && (
                    <span role="alert" className="block text-danger-text">
                      {countWords(b.clashes, w.overlaps)}
                    </span>
                  )}
                </div>
                {b.feed ? (
                  <span className="text-xs text-muted">{fillWords(w.goesWhen, { site: b.feed })}</span>
                ) : (
                  <form action={actions.removeBlock.bind(null, b.id)}>
                    <button type="submit" className={small}>
                      {w.openAgain} <span className="sr-only">{span(b.startsAt, b.endsAt)}</span>
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={actions.addBlock} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className={field}>
              {unit ? w.firstNight : w.firstDay}
              <input type="date" name="from" required className={control} />
            </label>
            <label className={field}>
              {unit ? w.lastNight : w.lastDay}
              <input type="date" name="to" required className={control} />
            </label>
            <label className={`${field} min-w-48 flex-1`}>
              {w.note} <span className="font-normal text-muted">{w.noteHint}</span>
              <input name="note" maxLength={200} className={control} />
            </label>
          </div>
          <div>
            <SubmitButton>{w.block}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {!staff && (
        <Card title={w.syncTitle} description={unit ? w.syncUnitHint : w.syncItemHint} className="flex flex-col gap-4" compact>
          <div className="flex flex-col gap-2 text-sm">
            <h3 className="text-body-strong text-ink">{unit ? w.thisRoom : w.thisItem}</h3>
            {address ? (
              <>
                <label className={field}>
                  <span className="sr-only">{w.address}</span>
                  <input readOnly value={address} className={`${control} font-mono text-xs`} />
                </label>
                <p className="text-muted">{w.addressHint}</p>
                <form action={actions.resetCalendar}>
                  <button type="submit" className={small}>
                    {w.newAddress}
                  </button>
                </form>
              </>
            ) : (
              <form action={actions.resetCalendar}>
                <button type="submit" className={small}>
                  {w.makeAddress}
                </button>
              </form>
            )}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <h3 className="text-body-strong text-ink">{w.others}</h3>
            {feeds.length > 0 && (
              <ul className="divide-y divide-line rounded-md border border-line">
                {feeds.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <span className="font-medium">{f.name}</span>
                      <span className="block truncate font-mono text-xs text-muted">{f.url}</span>
                      <span className="block text-muted">
                        {f.syncedAt ? fillWords(w.read, { when: when.format(new Date(f.syncedAt)) }) : w.notRead}
                        {!f.error && f.syncedAt && ` · ${countWords(f.events, w.events)}`}
                      </span>
                      {f.error && (
                        <span role="alert" className="block text-danger-text">
                          {f.error}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <form action={actions.syncFeed.bind(null, f.id)}>
                        <button type="submit" className={small}>
                          {w.readNow} <span className="sr-only">{f.name}</span>
                        </button>
                      </form>
                      <form action={actions.removeFeed.bind(null, f.id)}>
                        <button type="submit" className={small}>
                          {w.remove} <span className="sr-only">{f.name}</span>
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={actions.addFeed} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <label className={`${field} w-40`}>
                  {w.site}
                  <input name="name" required maxLength={80} placeholder="Airbnb" className={control} />
                </label>
                <label className={`${field} min-w-64 flex-1`}>
                  {w.siteAddress}
                  <input name="url" type="url" required maxLength={2000} placeholder="https://…" className={control} />
                </label>
              </div>
              <div>
                <SubmitButton>{w.add}</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Card>
      )}
    </>
  );
}
