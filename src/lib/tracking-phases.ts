/**
 * Where a parcel is (wave 3, D238, `docs/wave-3-notifications.md` 4.4 and 4.5): Kaizen's own phases, each carrier's status codes mapped to them, the
 * events kept in `shipment_tracking` and the arithmetic of polling. Pure and without imports (`src/db/schema.ts` reads `TRACKING_PHASES` for a check).
 *
 * **Only a verified code** (one whose meaning was read in the carrier's own documentation, with the address and the date below) sends an email or records
 * a delivery (4.6). An unlisted code is `unknown` and unverified. PostNord's, Helthjem's and Porterbuddy's documentation could not be read for this run,
 * so every code of theirs is unverified: their events are shown, nothing else.
 */

export const TRACKING_PHASES = [
  "info_received",
  "in_transit",
  "out_for_delivery",
  "ready_for_collection",
  "attempted",
  "delivered",
  "returned_to_sender",
  "problem",
  "unknown",
] as const;
export type TrackingPhase = (typeof TRACKING_PHASES)[number];
export const isTrackingPhase = (value: unknown): value is TrackingPhase => (TRACKING_PHASES as readonly unknown[]).includes(value);

/** Why a parcel is no longer polled (`shipment_tracking.stopped`). */
export const TRACKING_STOPS = ["delivered", "returned", "old", "undone", "carrier_failing", "no_agreement"] as const;
export type TrackingStop = (typeof TRACKING_STOPS)[number];

export type PhaseOf = { phase: TrackingPhase; verified: boolean };

/**
 * Posten / Bring Tracking API v2, the table "Events" at https://developer.bring.com/api/tracking/ (read 2026-10-14 and, for COLLECTED, 2026-10-15).
 * `COLLECTED` is described there as "The parcel has been collected at pickup address": Bring collecting a parcel from the sender's pickup address, not
 * the recipient collecting it at a service point (that is `DELIVERED`, after `READY_FOR_PICKUP` "Package has arrived at pickup point"). It is therefore
 * `in_transit`, which never records a delivery. `DELIVERY_CANCELLED` ("Home delivery has been cancelled by the customer") is `problem` as the spec says:
 * the parcel will not come as planned.
 */
const BRING: Record<string, TrackingPhase> = {
  PRE_NOTIFIED: "info_received",
  DELIVERY_ORDERED: "info_received",
  HANDED_IN: "in_transit",
  IN_TRANSIT: "in_transit",
  TERMINAL: "in_transit",
  INTERNATIONAL: "in_transit",
  CUSTOMS: "in_transit",
  DELIVERY_CHANGED: "in_transit",
  NOTIFICATION_SENT: "in_transit",
  COLLECTED: "in_transit",
  TRANSPORT_TO_RECIPIENT: "out_for_delivery",
  READY_FOR_PICKUP: "ready_for_collection",
  ATTEMPTED_DELIVERY: "attempted",
  DELIVERED: "delivered",
  /** Ours, not Bring's: one package of several delivered (`parseTracking()`), so the parcel is still on its way. */
  PACKAGE_DELIVERED: "in_transit",
  RETURN: "returned_to_sender",
  DELIVERED_SENDER: "returned_to_sender",
  DEVIATION: "problem",
  DELIVERY_CANCELLED: "problem",
  UNKNOWN: "unknown",
};

/** PostNord Track and Trace v5: the codes the repository's fixtures use. Unverified: the code list could not be read (spec 1.2). */
const POSTNORD: Record<string, TrackingPhase> = {
  EN_ROUTE: "in_transit",
  DELIVERED: "delivered",
};

/** Helthjem `eventType.apiKey`: the fixture's code. Unverified: no public documentation was found (spec 1.2). */
const HELTHJEM: Record<string, TrackingPhase> = {
  "001": "info_received",
};

/** Porterbuddy `orderStatus`: the fixture's status. Unverified: the status list was not read (spec 1.2). */
const PORTERBUDDY: Record<string, TrackingPhase> = {
  ready: "info_received",
};

/** Each carrier's table and whether its codes were read in the carrier's documentation. A code becomes verified only with its source written above. */
export const CARRIER_PHASES: Record<string, { verified: boolean; codes: Record<string, TrackingPhase> }> = {
  bring: { verified: true, codes: BRING },
  postnord: { verified: false, codes: POSTNORD },
  helthjem: { verified: false, codes: HELTHJEM },
  porterbuddy: { verified: false, codes: PORTERBUDDY },
};

/** The phase of a carrier's status code; an unlisted code (or carrier) is `unknown` and unverified. */
export function phaseOf(carrier: string, code: string): PhaseOf {
  const table = CARRIER_PHASES[carrier];
  const phase = table ? table.codes[code] : undefined;
  if (!table || !phase) return { phase: "unknown", verified: false };
  return { phase, verified: table.verified && phase !== "unknown" };
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** The time zone a carrier's time without a zone is read in, by the delivery country (else the store's). */
export const COUNTRY_ZONES: Record<string, string> = {
  NO: "Europe/Oslo",
  SE: "Europe/Stockholm",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
};

export const zoneFor = (country: string | null | undefined, storeZone: string): string =>
  (country && COUNTRY_ZONES[country.toUpperCase()]) || storeZone;

/** The offset of a zone at an instant, in minutes east of UTC. */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * An event's time as an ISO instant: a time with a zone as it says (Bring's `dateIso`, Helthjem's `eventTimeUtc`), a time without one (PostNord's
 * `eventTime`, Bring's display date and time) read in `timeZone`; null when it is neither.
 */
export function toInstant(at: string, timeZone: string): string | null {
  const text = at.trim();
  if (ZONED.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const m = LOCAL.exec(text);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  if (Number.isNaN(wall)) return null;
  // Two passes: the offset at the guess, then at the corrected instant (right across a change of summer time but for the hour that does not exist).
  let guess = wall - offsetMinutes(wall, timeZone) * 60000;
  guess = wall - offsetMinutes(guess, timeZone) * 60000;
  return new Date(guess).toISOString();
}

// ---------------------------------------------------------------------------
// Stored events
// ---------------------------------------------------------------------------

/** A carrier's event as an adapter gives it (`TrackingEvent` in `shipping-carriers.ts`). */
export type CarrierEvent = { at: string; status: string; description: string; location?: string };

/** An event as `shipment_tracking.events` keeps it: newest first, at most `EVENTS_KEPT`. */
export type StoredEvent = {
  /** ISO instant. */
  at: string;
  code: string;
  phase: TrackingPhase;
  verified: boolean;
  description: string;
  location: string | null;
};

export const EVENTS_KEPT = 30;
/** What the shopper's page shows of them. */
export const EVENTS_SHOWN = 10;
const TEXT_MAX = 300;

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/** The adapter's events as stored ones; an event whose time cannot be read is left out. */
export function storedEvents(carrier: string, events: readonly CarrierEvent[], timeZone: string): StoredEvent[] {
  const out: StoredEvent[] = [];
  for (const e of events) {
    const at = toInstant(e.at, timeZone);
    if (!at) continue;
    const code = clip(e.status.trim(), 60);
    const { phase, verified } = phaseOf(carrier, code);
    out.push({ at, code, phase, verified, description: clip(e.description.trim(), TEXT_MAX), location: e.location ? clip(e.location.trim(), 120) : null });
  }
  return out;
}

const eventKey = (e: Pick<StoredEvent, "at" | "code">) => `${e.at}|${e.code}`;

/** The stored events and the new ones together, one per time and code, newest first, at most 30; `added` counts the new ones kept. */
export function mergeEvents(stored: readonly StoredEvent[], fresh: readonly StoredEvent[], max = EVENTS_KEPT): { events: StoredEvent[]; added: number } {
  const byKey = new Map<string, StoredEvent>();
  for (const e of stored) byKey.set(eventKey(e), e);
  const added = new Set<string>();
  for (const e of fresh) {
    const key = eventKey(e);
    if (!byKey.has(key)) added.add(key);
    // The newest reading of an event wins (a carrier may correct a description), and the mapping of today.
    byKey.set(key, e);
  }
  const events = [...byKey.values()].sort((a, b) => b.at.localeCompare(a.at) || a.code.localeCompare(b.code)).slice(0, max);
  return { events, added: events.filter((e) => added.has(eventKey(e))).length };
}

export type ParcelState = {
  phase: TrackingPhase;
  /** Whether the phase came from a verified code. */
  verified: boolean;
  /** The first verified out-for-delivery event's time. */
  outAt: string | null;
  /** The first verified delivered event's time. */
  deliveredAt: string | null;
  /** The first verified returned-to-sender event's time. */
  returnedAt: string | null;
};

/** Where a parcel is, from its events (newest first): the newest event with a phase decides; `unknown` when none has one. */
export function parcelState(events: readonly StoredEvent[]): ParcelState {
  const newest = events.find((e) => e.phase !== "unknown");
  const first = (phase: TrackingPhase) =>
    events
      .filter((e) => e.verified && e.phase === phase)
      .map((e) => e.at)
      .sort()[0] ?? null;
  return {
    phase: newest?.phase ?? "unknown",
    verified: newest?.verified ?? false,
    outAt: first("out_for_delivery"),
    deliveredAt: first("delivered"),
    returnedAt: first("returned_to_sender"),
  };
}

/** The phase the shopper is shown: `unknown` reads as on its way only when an earlier event had a phase; else null (the description alone). */
export function shownPhase(events: readonly StoredEvent[]): TrackingPhase | null {
  const [newest, ...earlier] = events;
  if (!newest) return null;
  if (newest.phase !== "unknown") return newest.phase;
  return earlier.some((e) => e.phase !== "unknown") ? "in_transit" : null;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/** Parcels are followed for this long after they were sent. */
export const FOLLOW_DAYS = 30;
/** After this many failures in a row a parcel is no longer polled (`carrier_failing`). */
export const FAILURES_MAX = 20;
/** News older than this when the poll first sees it sends no email. */
export const STALE_HOURS = 24;
/** *Check now* at most once a minute per parcel. */
export const CHECK_NOW_SECONDS = 60;

const MINUTE = 60_000;

/**
 * When to check a parcel next (4.5): 30 minutes after a check that found a new event, or while it is out for delivery or ready to collect; after a
 * failure 30 minutes doubling up to 12 hours (`failures` counts this one); otherwise the last wait doubled, from 30 minutes up to 6 hours.
 */
export function nextCheck(input: {
  now: Date;
  failed: boolean;
  failures: number;
  foundNew: boolean;
  phase: TrackingPhase;
  /** The wait before this check, in minutes (null on the first). */
  previousMinutes: number | null;
}): Date {
  let minutes: number;
  if (input.failed) {
    minutes = Math.min(720, 30 * 2 ** Math.max(0, Math.min(10, input.failures - 1)));
  } else if (input.foundNew || input.phase === "out_for_delivery" || input.phase === "ready_for_collection") {
    minutes = 30;
  } else {
    minutes = input.previousMinutes === null ? 30 : Math.min(360, Math.max(30, input.previousMinutes * 2));
  }
  return new Date(input.now.getTime() + minutes * MINUTE);
}

/** Why polling stops now, or null to go on (4.5). A delivery or return stops it only on a verified code. */
export function stopReason(input: {
  state: ParcelState;
  now: Date;
  sentAt: Date;
  undone: boolean;
  agreement: boolean;
  failures: number;
}): TrackingStop | null {
  if (input.undone) return "undone";
  if (input.state.deliveredAt) return "delivered";
  if (input.state.returnedAt) return "returned";
  if (!input.agreement) return "no_agreement";
  if (input.failures >= FAILURES_MAX) return "carrier_failing";
  if (input.now.getTime() - input.sentAt.getTime() > FOLLOW_DAYS * 24 * 60 * MINUTE) return "old";
  return null;
}

/**
 * The carrier-event emails due for a parcel (2.7): delivered once, when a verified code says so; out for delivery once, only while it is not yet
 * delivered (a parcel first seen delivered gets only the delivered email). News older than 24 hours when it is seen sends nothing.
 */
export function trackingEmailsDue(input: {
  state: ParcelState;
  emailedOut: boolean;
  emailedDelivered: boolean;
  now: Date;
}): { out: boolean; delivered: boolean } {
  const fresh = (at: string | null) => at !== null && input.now.getTime() - Date.parse(at) <= STALE_HOURS * 60 * MINUTE;
  const delivered = !input.emailedDelivered && fresh(input.state.deliveredAt);
  const out = !input.emailedOut && input.state.deliveredAt === null && fresh(input.state.outAt);
  return { out, delivered };
}
