import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import type { CarrierId } from "@/lib/shipping-carriers";
import {
  CHECK_NOW_SECONDS,
  FOLLOW_DAYS,
  mergeEvents,
  nextCheck,
  parcelState,
  stopReason,
  storedEvents,
  trackingEmailsDue,
  zoneFor,
  isTrackingPhase,
  type StoredEvent,
  type TrackingPhase,
  type TrackingStop,
} from "@/lib/tracking-phases";

import { fetchCarrierEvents, type CarrierAnswer } from "./carrier-tracking";
import type { SendOutcome } from "./email";
import { sendParcelEvent } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * Following parcels (wave 3, D238, `docs/wave-3-notifications.md` 2.3, 2.7, 4.5 and 4.6): the five-minute poll asks each tracked parcel's carrier on the
 * store's own agreement and keeps the events in `shipment_tracking` (this module is its only writer besides `undo_shipment()` and `anonymise_order()`).
 * Pages read the stored rows (`parcelTrackingFor()`), never the carrier, so a shopper's order page (a pay route) makes no call.
 *
 * A **tracked parcel** is a `shipments` row of method `parcel`, standing (not undone), with a tracking number, of an order that is not copied, whose carrier
 * `trackedCarrier()`'s rule recognises (the SQL `TRACKED` below is the same rule) and whose store has that carrier's agreement saved and complete, in an open
 * store with the shop on, sent within the last 30 days.
 *
 * A check claims the parcel first (its row's `next_check_at` moved ten minutes on, or the row made), so two runs never ask about one parcel together; then
 * the carrier is asked (4 s), the events merged (newest 30), the phase and the first verified out-for-delivery and delivered times kept, the next check
 * planned (`nextCheck()`) or polling stopped (`stopReason()`). Then, in the same run, the emails of 2.7 (only when switched on; `emailed_*` set once the
 * email is kept) and `commerce.record_carrier_delivery()` when the parcel became delivered by a verified code. A carrier that fails leaves what was stored;
 * nothing throws out of `pollTracking()`.
 */

/** The carrier a shipment is followed with, in SQL: the booked carrier, else the name staff gave it (the rule of `trackedCarrier()`). */
const TRACKED: SQL = sql`(case
  when sh.carrier_id in ('bring', 'postnord', 'porterbuddy', 'helthjem') then sh.carrier_id
  when lower(sh.carrier) like '%postnord%' then 'postnord'
  when lower(sh.carrier) like '%porterbuddy%' then 'porterbuddy'
  when lower(sh.carrier) like '%helthjem%' then 'helthjem'
  when lower(sh.carrier) like '%bring%' then 'bring'
  else null end)`;

/** At most this many parcels a run, this many of one carrier, and this many carrier calls at once (4.5). */
export const POLL_LIMITS = { perRun: 60, perCarrier: 15, concurrent: 4 } as const;
/** How long a claimed check holds the parcel (another run skips it meanwhile). */
const CLAIM_MINUTES = 10;

type Parcel = {
  storeId: string;
  shipmentId: string;
  orderId: string;
  carrier: CarrierId;
  trackingNumber: string;
  sentAt: Date;
  lang: string;
  country: string | null;
  storeZone: string;
};

type TrackingRow = {
  events: StoredEvent[];
  checkedAt: Date | null;
  nextCheckAt: Date;
  failures: number;
  outAt: string | null;
  deliveredAt: string | null;
  emailedOut: boolean;
  emailedDelivered: boolean;
};

export type FetchEvents = (parcel: Parcel) => Promise<CarrierAnswer>;

const defaultFetch: FetchEvents = (p) => fetchCarrierEvents(p.storeId, p.carrier, p.trackingNumber, { lang: p.lang });

/** The events kept in a row, as stored events (anything that is not one is left out). */
function readEvents(value: unknown): StoredEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((e): StoredEvent[] => {
    if (!e || typeof e !== "object") return [];
    const x = e as Record<string, unknown>;
    if (typeof x.at !== "string" || typeof x.code !== "string" || !isTrackingPhase(x.phase)) return [];
    return [{ at: x.at, code: x.code, phase: x.phase, verified: x.verified === true, description: String(x.description ?? ""), location: x.location ? String(x.location) : null }];
  });
}

const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);

const parcelOf = (row: Row): Parcel => ({
  storeId: String(row.store_id),
  shipmentId: String(row.shipment_id),
  orderId: String(row.order_id),
  carrier: String(row.tracked) as CarrierId,
  trackingNumber: String(row.tracking_number),
  sentAt: new Date(String(row.sent_at)),
  lang: String(row.locale ?? "en").split("-")[0] || "en",
  country: row.country ? String(row.country) : null,
  storeZone: String(row.time_zone ?? "Europe/Oslo"),
});

/** The columns of a parcel the check needs (`sh`, `o`, `s` in the query). */
const PARCEL_COLUMNS = sql`sh.store_id, sh.id as shipment_id, sh.order_id, ${TRACKED} as tracked, sh.tracking_number, sh.created_at as sent_at,
  o.locale, coalesce(nullif(upper(o.shipping_address ->> 'country'), ''), o.market_code) as country, s.time_zone`;

/** The condition every tracked parcel meets (1.3, 4.5); `t` is its tracking row when it has one. */
const TRACKABLE = sql`sh.method = 'parcel' and sh.undone_at is null and sh.tracking_number <> '' and o.copied_from is null
  and ${TRACKED} is not null
  and commerce.store_is_active(sh.store_id) and commerce.feature_on(sh.store_id, 'shop')`;

/** Parcels due a check now, oldest due first, within the run's limits (the per-carrier limit in code). */
async function dueParcels(now: Date, limit: number): Promise<Parcel[]> {
  const rows = await db().execute<Row>(sql`
    select ${PARCEL_COLUMNS}
    from commerce.shipments sh
    join commerce.orders o on o.store_id = sh.store_id and o.id = sh.order_id
    join commerce.stores s on s.id = sh.store_id
    left join commerce.shipment_tracking t on t.store_id = sh.store_id and t.shipment_id = sh.id
    where ${TRACKABLE}
      and sh.created_at > ${now.toISOString()}::timestamptz - make_interval(days => ${FOLLOW_DAYS})
      and (t.shipment_id is null or (t.stopped is null and t.next_check_at <= ${now.toISOString()}::timestamptz))
      and exists (select 1 from commerce.shipping_carriers c where c.store_id = sh.store_id and c.carrier = ${TRACKED} and c.complete)
    order by coalesce(t.next_check_at, sh.created_at)
    limit ${limit}
  `);
  return rows.map(parcelOf);
}

/**
 * Parcels sent more than `FOLLOW_DAYS` ago are no longer picked by `dueParcels()`, so a check never writes their `old` stop: this does, for every
 * row still followed, so the 90 days of `pruneTrackingEvents()` start (a parcel no verified code ever closed, as every PostNord, Helthjem and
 * Porterbuddy one, or a Bring parcel lost). Returns how many it stopped.
 */
async function stopOldParcels(now: Date): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.shipment_tracking t set stopped = 'old', stopped_at = ${now.toISOString()}::timestamptz, updated_at = now()
    from commerce.shipments sh
    where sh.store_id = t.store_id and sh.id = t.shipment_id and t.stopped is null
      and sh.created_at <= ${now.toISOString()}::timestamptz - make_interval(days => ${FOLLOW_DAYS})
    returning t.shipment_id
  `);
  return rows.length;
}

/** Claims a parcel for one check: its row made, or its due check moved on; false when another run has it (or it is not due and `force` is off). */
async function claim(p: Parcel, now: Date, force: boolean): Promise<TrackingRow | null> {
  const until = new Date(now.getTime() + CLAIM_MINUTES * 60_000).toISOString();
  const [made] = await db().execute<Row>(sql`
    insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, next_check_at)
    values (${p.storeId}::uuid, ${p.shipmentId}::uuid, ${p.orderId}::uuid, ${p.carrier}, ${until}::timestamptz)
    on conflict (store_id, shipment_id) do nothing
    returning shipment_id
  `);
  if (made) return { events: [], checkedAt: null, nextCheckAt: now, failures: 0, outAt: null, deliveredAt: null, emailedOut: false, emailedDelivered: false };
  // The wait before this check is kept from the row as it was (returned before the update moves it), for the doubling of `nextCheck()`.
  const [row] = await db().execute<Row>(sql`
    update commerce.shipment_tracking t set next_check_at = ${until}::timestamptz
    from (select next_check_at from commerce.shipment_tracking where store_id = ${p.storeId}::uuid and shipment_id = ${p.shipmentId}::uuid) before
    where t.store_id = ${p.storeId}::uuid and t.shipment_id = ${p.shipmentId}::uuid
      and (${force} or (t.stopped is null and t.next_check_at <= ${now.toISOString()}::timestamptz))
      and t.stopped is distinct from 'undone'
    returning t.events, t.checked_at, before.next_check_at as was_next, t.failures, t.out_at, t.delivered_at, t.emailed_out, t.emailed_delivered
  `);
  if (!row) return null;
  return {
    events: readEvents(row.events),
    checkedAt: row.checked_at ? new Date(String(row.checked_at)) : null,
    nextCheckAt: new Date(String(row.was_next)),
    failures: Number(row.failures ?? 0),
    outAt: iso(row.out_at),
    deliveredAt: iso(row.delivered_at),
    emailedOut: Boolean(row.emailed_out),
    emailedDelivered: Boolean(row.emailed_delivered),
  };
}

export type CheckResult = {
  shipmentId: string;
  outcome: "checked" | "failed" | "no_agreement" | "skipped";
  added: number;
  phase: TrackingPhase;
  stopped: TrackingStop | null;
  emails: { out: SendOutcome | null; delivered: SendOutcome | null };
  delivered: boolean;
};

/** An email counts as done once it is kept (or will never go: held back for an erased person or a store template). */
const emailDone = (outcome: SendOutcome | null): boolean => outcome === "sent" || outcome === "logged" || outcome === "duplicate" || outcome === "suppressed";

/** One check of one claimed parcel (4.5). Never throws for a carrier's failure. */
async function checkClaimed(p: Parcel, before: TrackingRow, now: Date, fetchEvents: FetchEvents): Promise<CheckResult> {
  const answer = await fetchEvents(p).catch((): CarrierAnswer => ({ ok: false, reason: "failed" }));
  const previousMinutes = before.checkedAt ? Math.max(0, Math.round((before.nextCheckAt.getTime() - before.checkedAt.getTime()) / 60_000)) : null;
  const result: CheckResult = { shipmentId: p.shipmentId, outcome: "checked", added: 0, phase: "unknown", stopped: null, emails: { out: null, delivered: null }, delivered: false };

  if (!answer.ok && answer.reason === "no_agreement") {
    await db().execute(sql`
      update commerce.shipment_tracking set stopped = 'no_agreement', stopped_at = now(), checked_at = now(), updated_at = now()
      where store_id = ${p.storeId}::uuid and shipment_id = ${p.shipmentId}::uuid
    `);
    return { ...result, outcome: "no_agreement", stopped: "no_agreement", phase: parcelState(before.events).phase };
  }

  let events = before.events;
  let failures = 0;
  let added = 0;
  if (answer.ok) {
    const merged = mergeEvents(before.events, storedEvents(p.carrier, answer.events, zoneFor(p.country, p.storeZone)));
    events = merged.events;
    added = merged.added;
  } else {
    failures = before.failures + 1;
  }
  const state = parcelState(events);
  const outAt = before.outAt ?? state.outAt;
  const deliveredAt = before.deliveredAt ?? state.deliveredAt;
  const stop = stopReason({ state: { ...state, outAt, deliveredAt }, now, sentAt: p.sentAt, undone: false, agreement: true, failures });
  const next = nextCheck({ now, failed: !answer.ok, failures, foundNew: added > 0, phase: state.phase, previousMinutes });
  await db().execute(sql`
    update commerce.shipment_tracking set
      events = ${JSON.stringify(events)}::jsonb, phase = ${state.phase}, phase_verified = ${state.verified},
      checked_at = now(), next_check_at = ${next.toISOString()}::timestamptz, failures = ${failures},
      out_at = ${outAt}::timestamptz, delivered_at = ${deliveredAt}::timestamptz,
      stopped = ${stop}, stopped_at = ${stop ? sql`now()` : sql`null`}, updated_at = now()
    where store_id = ${p.storeId}::uuid and shipment_id = ${p.shipmentId}::uuid
  `);
  Object.assign(result, { outcome: answer.ok ? "checked" : "failed", added, phase: state.phase, stopped: stop });

  // The carrier-event emails (2.7): each once, only when switched on (the sender asks), only for news at most a day old.
  const due = trackingEmailsDue({ state: { ...state, outAt, deliveredAt }, emailedOut: before.emailedOut, emailedDelivered: before.emailedDelivered, now });
  if (due.out) {
    result.emails.out = await sendParcelEvent(p.storeId, p.orderId, p.shipmentId, "out").catch(() => "failed" as const);
    if (emailDone(result.emails.out)) await markEmailed(p, "out");
  }
  if (due.delivered) {
    result.emails.delivered = await sendParcelEvent(p.storeId, p.orderId, p.shipmentId, "delivered").catch(() => "failed" as const);
    if (emailDone(result.emails.delivered)) await markEmailed(p, "delivered");
  }
  // The receipt (4.6): only when the parcel was delivered by a verified code; the database decides whether the whole order is.
  if (deliveredAt) result.delivered = await recordCarrierDelivery(p.storeId, p.orderId, deliveredAt);
  return result;
}

async function markEmailed(p: Parcel, which: "out" | "delivered") {
  await db().execute(sql`
    update commerce.shipment_tracking set ${which === "out" ? sql`emailed_out = true` : sql`emailed_delivered = true`}, updated_at = now()
    where store_id = ${p.storeId}::uuid and shipment_id = ${p.shipmentId}::uuid
  `);
}

/** `commerce.record_carrier_delivery()`: whether it recorded the order's receipt now (false when it was not due or already recorded). Never throws. */
export async function recordCarrierDelivery(storeId: string, orderId: string, at: string): Promise<boolean> {
  try {
    const [row] = await db().execute<Row>(sql`select commerce.record_carrier_delivery(${storeId}::uuid, ${orderId}::uuid, ${at}::timestamptz) as wrote`);
    return Boolean(row?.wrote);
  } catch {
    return false;
  }
}

/** Runs `work` over `items`, at most `limit` at once. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

export type PollSummary = { checked: number; failed: number; stopped: number; emails: number; delivered: number };

/**
 * The five-minute poll (4.5): parcels due, at most 60 a run and 15 of one carrier, 4 carrier calls at once. Never throws; a parcel whose check fails is
 * counted and planned again.
 */
export async function pollTracking(options: { now?: Date; fetchEvents?: FetchEvents; limits?: Partial<Record<keyof typeof POLL_LIMITS, number>> } = {}): Promise<PollSummary> {
  const now = options.now ?? new Date();
  const limits = { ...POLL_LIMITS, ...options.limits };
  const summary: PollSummary = { checked: 0, failed: 0, stopped: 0, emails: 0, delivered: 0 };
  let candidates: Parcel[];
  try {
    summary.stopped += await stopOldParcels(now);
    candidates = await dueParcels(now, limits.perRun * 4);
  } catch {
    return summary;
  }
  const perCarrier = new Map<string, number>();
  const chosen: Parcel[] = [];
  for (const p of candidates) {
    if (chosen.length >= limits.perRun) break;
    const n = perCarrier.get(p.carrier) ?? 0;
    if (n >= limits.perCarrier) continue;
    perCarrier.set(p.carrier, n + 1);
    chosen.push(p);
  }
  const results = await pool(chosen, limits.concurrent, async (p) => {
    try {
      const before = await claim(p, now, false);
      if (!before) return null;
      return await checkClaimed(p, before, now, options.fetchEvents ?? defaultFetch);
    } catch {
      return null;
    }
  });
  for (const r of results) {
    if (!r) continue;
    if (r.outcome === "failed") summary.failed++;
    else summary.checked++;
    if (r.stopped) summary.stopped++;
    summary.emails += [r.emails.out, r.emails.delivered].filter((o) => o === "sent" || o === "logged").length;
    if (r.delivered) summary.delivered++;
  }
  return summary;
}

export type CheckNowResult = { ok: true; result: CheckResult } | { ok: false; problem: "not_found" | "not_tracked" | "too_soon"; message: string };

/**
 * *Check now* on the staff order page (2.3, `orders:read`): the same check for one parcel at once, at most once a minute a parcel. A parcel stopped
 * because its carrier kept failing or its agreement was missing is tried again (it is followed again when the check goes through); an undone one is not.
 */
export async function checkParcelNow(storeId: string, orderId: string, shipmentId: string, options: { now?: Date; fetchEvents?: FetchEvents } = {}): Promise<CheckNowResult> {
  const now = options.now ?? new Date();
  const [row] = await db().execute<Row>(sql`
    select ${PARCEL_COLUMNS}, t.checked_at, t.stopped
    from commerce.shipments sh
    join commerce.orders o on o.store_id = sh.store_id and o.id = sh.order_id
    join commerce.stores s on s.id = sh.store_id
    left join commerce.shipment_tracking t on t.store_id = sh.store_id and t.shipment_id = sh.id
    where sh.store_id = ${storeId}::uuid and sh.order_id = ${orderId}::uuid and sh.id = ${shipmentId}::uuid
  `);
  if (!row) return { ok: false, problem: "not_found", message: "The parcel was not found." };
  const [trackable] = await db().execute<Row>(sql`
    select 1 from commerce.shipments sh join commerce.orders o on o.store_id = sh.store_id and o.id = sh.order_id
    where sh.store_id = ${storeId}::uuid and sh.id = ${shipmentId}::uuid and ${TRACKABLE}
  `);
  if (!trackable) return { ok: false, problem: "not_tracked", message: "Kaizena Flow does not follow this parcel: it has no tracking number, or its carrier is not one you connect under Shipping." };
  if (row.checked_at && now.getTime() - new Date(String(row.checked_at)).getTime() < CHECK_NOW_SECONDS * 1000) {
    return { ok: false, problem: "too_soon", message: "This parcel was checked less than a minute ago. Try again in a moment." };
  }
  const p = parcelOf(row);
  if (row.stopped === "carrier_failing" || row.stopped === "no_agreement") {
    await db().execute(sql`
      update commerce.shipment_tracking set stopped = null, stopped_at = null, failures = 0, updated_at = now()
      where store_id = ${storeId}::uuid and shipment_id = ${shipmentId}::uuid
    `);
  }
  const before = await claim(p, now, true);
  if (!before) return { ok: false, problem: "too_soon", message: "This parcel is being checked just now. Try again in a moment." };
  return { ok: true, result: await checkClaimed(p, before, now, options.fetchEvents ?? defaultFetch) };
}

export type ParcelTracking = {
  shipmentId: string;
  /** The carrier Kaizen follows it with, when it does (a carrier the store connected), else null: then only the link is shown. */
  followed: CarrierId | null;
  /** Null while the parcel was never checked. */
  phase: TrackingPhase | null;
  phaseVerified: boolean;
  /** Newest first, at most 30 (the shopper's page shows 10). */
  events: StoredEvent[];
  checkedAt: string | null;
  /** The last check failed (the stored events are what was last seen). */
  lastCheckFailed: boolean;
  failures: number;
  stopped: TrackingStop | null;
  outAt: string | null;
  deliveredAt: string | null;
};

/**
 * The stored tracking of an order's standing parcels, for the order pages (the shopper's and staff's): one indexed read, no carrier call. Empty for a copied
 * order or an order that is not the store's.
 */
export async function parcelTrackingFor(storeId: string, orderId: string): Promise<ParcelTracking[]> {
  const rows = await db().execute<Row>(sql`
    select sh.id as shipment_id, ${TRACKED} as tracked,
      exists (select 1 from commerce.shipping_carriers c where c.store_id = sh.store_id and c.carrier = ${TRACKED} and c.complete) as connected,
      t.shipment_id is not null as has_row, t.phase, t.phase_verified, t.events, t.checked_at, t.failures, t.stopped, t.out_at, t.delivered_at
    from commerce.shipments sh
    join commerce.orders o on o.store_id = sh.store_id and o.id = sh.order_id
    left join commerce.shipment_tracking t on t.store_id = sh.store_id and t.shipment_id = sh.id
    where sh.store_id = ${storeId}::uuid and sh.order_id = ${orderId}::uuid and sh.method = 'parcel' and sh.undone_at is null
      and o.copied_from is null
    order by sh.created_at, sh.id
  `);
  return rows.map((row) => {
    const followed = row.tracked && (row.connected || row.has_row) ? (String(row.tracked) as CarrierId) : null;
    const failures = Number(row.failures ?? 0);
    return {
      shipmentId: String(row.shipment_id),
      followed,
      phase: row.has_row && isTrackingPhase(row.phase) && row.checked_at ? row.phase : null,
      phaseVerified: Boolean(row.phase_verified),
      events: readEvents(row.events),
      checkedAt: iso(row.checked_at),
      lastCheckFailed: failures > 0,
      failures,
      stopped: (row.stopped as TrackingStop | null) ?? null,
      outAt: iso(row.out_at),
      deliveredAt: iso(row.delivered_at),
    };
  });
}

/** Clears the carrier events of parcels whose following stopped more than 90 days ago (3.5; the phase, times and flags stay). Returns how many. */
export async function pruneTrackingEvents(now = new Date()): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.shipment_tracking t set events = '[]'::jsonb, updated_at = now()
    where t.events <> '[]'::jsonb
      and (t.stopped_at < ${now.toISOString()}::timestamptz - interval '90 days'
           -- A row whose following ended by age with no stop written (the store closed, its carrier disconnected, the job not run): 90 days after
           -- the last day it could have been followed.
           or exists (select 1 from commerce.shipments sh where sh.store_id = t.store_id and sh.id = t.shipment_id
                      and sh.created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${FOLLOW_DAYS + 90})))
    returning t.shipment_id
  `);
  return rows.length;
}
