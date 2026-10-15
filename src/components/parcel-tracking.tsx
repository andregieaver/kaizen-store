import type { Messages } from "@/lib/i18n";
import {
  EVENTS_SHOWN,
  type StoredEvent,
  type TrackingPhase,
} from "@/lib/tracking-phases";
import type { ParcelTracking as ParcelTrackingRow } from "@/server/shipment-tracking";

/** The carriers Kaizen follows, by the name shoppers know them by (`CARRIERS` in `shipping-carriers.ts` holds the same names; that module brings zod, so they are repeated here). */
const CARRIER_NAMES: Record<string, string> = {
  bring: "Posten / Bring",
  postnord: "PostNord",
  porterbuddy: "Porterbuddy",
  helthjem: "Helthjem",
};

/**
 * The phase line the shopper reads (D238 2.7, 4.4): only from a **verified** code, so a carrier whose codes Kaizen could not read in its documentation (PostNord,
 * Helthjem, Porterbuddy) never tells a shopper *Delivered* on Kaizen's guess; its events are still listed in its own words. An unlisted code after a verified one
 * reads as on its way. Null: no line, the events speak for themselves.
 */
export function trackingPhaseLine(
  events: readonly StoredEvent[],
): TrackingPhase | null {
  const [newest, ...earlier] = events;
  if (!newest) return null;
  if (newest.phase !== "unknown") return newest.verified ? newest.phase : null;
  return earlier.some((e) => e.verified && e.phase !== "unknown")
    ? "in_transit"
    : null;
}

/**
 * Where one parcel is, on the shopper's order pages (wave 3, D238, `docs/wave-3-notifications.md` 2.7): drawn inside the parcel of `OrderShipments`, from the
 * events the five-minute poll stored (`parcelTrackingFor()`), never from a carrier call while the page renders. A server component with no script, no map and no
 * carrier picture, so the order page's payment policy (D158) is untouched. The phase as a short line, then up to `EVENTS_SHOWN` of the carrier's events, newest
 * first, each with its date and time in the store's time zone, the carrier's own description and the place. A followed parcel with no events says the carrier has
 * no news yet; a parcel Kaizen does not follow draws nothing here (the parcel's link stays, as before); a last check that failed shows what was last stored and
 * never an error. Every text is drawn as text.
 */
export function ParcelTracking({
  tracking,
  m,
  locale,
  timeZone,
}: {
  tracking: ParcelTrackingRow | undefined;
  m: Pick<Messages, "tracking">;
  locale: string;
  timeZone?: string;
}) {
  if (!tracking || !tracking.followed) return null;
  const w = m.tracking;
  const carrier = CARRIER_NAMES[tracking.followed] ?? tracking.followed;
  const zone = timeZone ? { timeZone } : {};
  const events = [...tracking.events].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted" data-parcel-tracking="no-news">
        {w.noNews(carrier)}
      </p>
    );
  }
  const phase = trackingPhaseLine(events);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      ...zone,
    });
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { dateStyle: "long", ...zone });
  const line = (() => {
    if (!phase) return null;
    if (phase === "delivered")
      return w.deliveredOn(day(tracking.deliveredAt ?? events[0].at));
    if (phase === "ready_for_collection" && events[0].location)
      return w.readyAt(events[0].location);
    return w.phases[phase];
  })();
  const shown = events.slice(0, EVENTS_SHOWN);
  return (
    <div
      className="flex flex-col gap-1"
      data-parcel-tracking={phase ?? "events"}
    >
      {line && <p className="text-sm font-medium">{line}</p>}
      <ol aria-label={w.events} className="flex flex-col gap-1 text-sm">
        {shown.map((event) => (
          <li key={`${event.at}|${event.code}`} data-tracking-event>
            <time dateTime={event.at} className="text-muted">
              {when(event.at)}
            </time>{" "}
            {event.description ||
              (event.verified && event.phase !== "unknown"
                ? w.phases[event.phase]
                : event.code)}
            {event.location && (
              <span className="text-muted">{` · ${event.location}`}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
