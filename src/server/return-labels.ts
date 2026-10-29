import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { BRING_RETURN_DEFAULT, isBringUrl } from "@/lib/bring";
import { LABEL_FETCHES_PER_HOUR, LABEL_TRIES, LABEL_TRY_AFTER_MINUTES } from "@/lib/exchange-limits";
import { addressComplete, labelBlock, labelCostIn, LABEL_PROBLEMS, type LabelAddress, type LabelProblemCode } from "@/lib/return-label";
import { carrierInfo, type CarrierContext, type CarrierId, type ShippingAddress } from "@/lib/shipping-carriers";

import { audit } from "./auth";
import { adapterFor } from "./carriers";
import { fetchBringLabel } from "./carriers/bring";
import { log } from "./log";
import type { OrderActor } from "./order-actor";
import { writeOrderEvent } from "./order-actor";
import { getExchangeLabelSettings, getReturnSettings } from "./return-settings";
import { carrierContext, listCarriers } from "./shipping-carriers";
import { storeById } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * Return labels (wave 3, D239, `docs/wave-3-exchanges.md` 2.3, 2.4, 4.7, 4.8): a carrier booking from the shopper's address to the store's return address,
 * made through the store's own agreement and the carrier adapter's `bookReturn()` (Bring only today). The booking is kept on the return (`returns.label_*`,
 * the carrier's own label address private), the label reaches the shopper only through Kaizen's route `/returns/{token}/label`, which fetches it from the
 * carrier's own host with the store's keys and never stores it, and its cost becomes the return shipping taken off the refund only when the shopper pays it,
 * never above the cost, never for a test label, and only when staff confirm at refund time that the parcel came with it (`labelDeduction()` in
 * `refundReturn()`). A booking that fails leaves the return as it was and the pasted path working. The carrier is never called while a shopper confirms a
 * withdrawal: a withdrawal return's label is booked by the five-minute job (`bookPendingLabels()`) when the owner turned it on.
 */

export type LabelRefused = { ok: false; problem: LabelProblemCode | "not_found" | "carrier" | "limit"; message: string };

const refuse = (problem: LabelRefused["problem"], message?: string): LabelRefused => ({
  ok: false,
  problem,
  message: message ?? (problem in LABEL_PROBLEMS ? LABEL_PROBLEMS[problem as LabelProblemCode] : problem === "not_found" ? "That return no longer exists." : "The carrier could not book the label."),
});

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Loaded = {
  ret: Row;
  orderId: string;
  currency: string;
  payer: "shopper" | "store" | null;
  from: ShippingAddress | null;
  to: ShippingAddress | null;
  carrier: { id: CarrierId; complete: boolean; checkOk: boolean } | null;
  service: string;
  storeOpen: boolean;
};

/** The order's shipping address as a party of the booking (the shopper sends the parcel). */
function party(address: Record<string, unknown> | null, email: string | null): ShippingAddress | null {
  if (!address) return null;
  const a = address as Record<string, string | null | undefined>;
  const street = [a.line1 ?? a.street, a.line2].filter(Boolean).join(", ");
  const p: LabelAddress = { name: a.name, street, postalCode: a.postalCode, city: a.city, country: a.country };
  if (!addressComplete(p)) return null;
  return {
    name: String(p.name).trim(),
    street: street.trim(),
    postalCode: String(p.postalCode).trim(),
    city: String(p.city).trim(),
    country: String(p.country).trim().toUpperCase(),
    ...(a.phone ? { phone: String(a.phone) } : {}),
    ...(email ? { email } : {}),
  };
}

/** The carrier return labels are booked with: the one chosen in the settings, else the first connected one that books returns. */
async function chosenCarrier(storeId: string): Promise<{ id: CarrierId; complete: boolean; checkOk: boolean; service: string } | null> {
  const [settings, carriers] = await Promise.all([getExchangeLabelSettings(storeId), listCarriers(storeId)]);
  const able = carriers.filter((c) => carrierInfo(c.carrier)?.available.includes("return_labels"));
  const found = settings.labelCarrier ? able.find((c) => c.carrier === settings.labelCarrier) : able[0];
  if (!found) return null;
  return { id: found.carrier, complete: found.complete, checkOk: Boolean(found.check?.ok), service: settings.labelService ?? (found.carrier === "bring" ? BRING_RETURN_DEFAULT : "") };
}

async function load(storeId: string, returnId: string): Promise<Loaded | null> {
  if (!isUuid(storeId) || !isUuid(returnId)) return null;
  const [ret] = await db().execute<Row>(sql`
    select r.*, r.status::text as status_text, o.shipping_address, o.email, o.currency, o.return_cost_payer,
      (o.restricted_at is not null or o.anonymised_at is not null) as restricted, commerce.store_is_active(r.store_id) as open
    from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
  `);
  if (!ret) return null;
  const [settings, carrier, store] = await Promise.all([getReturnSettings(storeId), chosenCarrier(storeId), storeById(storeId)]);
  const returnAddress = settings.returnAddress;
  const to: ShippingAddress | null =
    returnAddress && addressComplete(returnAddress)
      ? {
          ...returnAddress,
          country: returnAddress.country.trim().toUpperCase(),
          ...(store?.details.contactEmail ? { email: store.details.contactEmail } : {}),
        }
      : null;
  return {
    ret,
    orderId: String(ret.order_id),
    currency: String(ret.currency).trim(),
    payer: ret.return_cost_payer === "shopper" ? "shopper" : ret.return_cost_payer === "store" ? "store" : null,
    from: party(ret.shipping_address as Record<string, unknown> | null, ret.email ? String(ret.email) : null),
    to,
    carrier: carrier ? { id: carrier.id, complete: carrier.complete, checkOk: carrier.checkOk } : null,
    service: carrier?.service ?? "",
    storeOpen: Boolean(ret.open),
  };
}

const blockOf = (l: Loaded): LabelProblemCode | null =>
  labelBlock({
    returnStatus: String(l.ret.status_text) as Parameters<typeof labelBlock>[0]["returnStatus"],
    restricted: Boolean(l.ret.restricted),
    storeOpen: l.storeOpen,
    carrier: l.carrier,
    from: l.from,
    to: l.to,
    // A test label or none can be booked again; a real one is the return's.
    booked: l.ret.label_source === "carrier" && !l.ret.label_test,
  });

/** The weight of the returned goods, in grams, from the variants' weights (the D134 estimate); 0 when none has a weight. */
export async function estimateReturnWeight(storeId: string, returnId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(rl.quantity * v.weight_grams), 0)::bigint as grams
    from commerce.return_lines rl
    join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
    join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
    where rl.store_id = ${storeId}::uuid and rl.return_id = ${returnId}::uuid and rl.decision = 'accept' and v.weight_grams is not null
  `);
  return Number(row?.grams ?? 0);
}

export type LabelOptions = {
  /** Why *Book a return label* is not offered, or null when it is. */
  block: LabelProblemCode | null;
  carrier: { id: CarrierId; name: string } | null;
  service: string;
  weightGrams: number;
  /** Who pays return shipping, as the order was sold. */
  payer: "shopper" | "store" | null;
};

/** What the return page's *Return shipping* field offers. */
export async function labelOptions(storeId: string, returnId: string): Promise<LabelOptions | null> {
  const l = await load(storeId, returnId);
  if (!l) return null;
  return {
    block: blockOf(l),
    carrier: l.carrier ? { id: l.carrier.id, name: carrierInfo(l.carrier.id)?.name ?? l.carrier.id } : null,
    service: l.service,
    weightGrams: await estimateReturnWeight(storeId, returnId),
    payer: l.payer,
  };
}

export type BookLabelResult = { ok: true; trackingNumber: string; test: boolean; costMinor: number | null; emailed: string | null } | LabelRefused;

/** The price of the return service, asked first; null when the carrier did not answer or price it (which never stops a booking). */
async function priceOf(context: CarrierContext, carrier: CarrierId, service: string, from: ShippingAddress, to: ShippingAddress, weightGrams: number) {
  const adapter = adapterFor(carrier);
  if (!adapter?.rates) return null;
  try {
    const options = await adapter.rates(context, { from, to, parcels: [{ weightGrams }], currency: "NOK", products: [service] });
    const found = options.find((o) => o.serviceId === service);
    return found ? { amountMinor: found.priceMinor, currency: found.currency, vatIncluded: Boolean(found.includesVat) } : null;
  } catch {
    return null;
  }
}

/** The label's cost with VAT (the store's actual direct cost, 4.8) in the order's currency, converted once at the store's rates; null when not known. */
async function costInOrderCurrency(storeId: string, price: { amountMinor: number; currency: string; vatIncluded: boolean } | null, currency: string, from: string): Promise<number | null> {
  if (!price) return null;
  let amount = price.amountMinor;
  if (!price.vatIncluded) {
    const [vat] = await db().execute<Row>(sql`select commerce.vat_rate(${from}, 'standard') as rate`);
    amount = Math.floor(amount * (1 + Number(vat?.rate ?? 0)) + 0.5);
  }
  const store = await storeById(storeId);
  if (!store) return null;
  return labelCostIn({ amountMinor: amount, currency: price.currency }, currency, store.localization.rates);
}

/**
 * *Book a return label* (staff, or the job for a withdrawal return): the return is approved or in transit, the store's carrier books returns and its agreement
 * is complete and checked, the order's shipping address and the return address are complete and in a country it books returns in (`labelBlock()`). The price
 * is asked first, then `bookReturn()`. The booking is kept on the return (carrier, service, numbers, tracking link, the carrier's label address, the cost,
 * test or not). **Nothing is taken off the refund here**: whether the parcel comes back with the label is known only when it arrives, so the cost is a
 * suggestion on the refund form that staff apply when they confirm it did (`labelDeduction()` in `refundReturn()`), and a test label is never taken off. A
 * refusal by the carrier changes nothing but the count of tries, and says the carrier's sentence; pasting a label still works.
 *
 * One booking at a time per return: the whole booking runs under a transaction-scoped advisory lock (`return-label:{id}`) taken without waiting, and the state
 * is read again under it, so a double press, two tabs, or staff and the five-minute job together make one carrier shipment (the second is `busy` or
 * `booked`). The final write also requires that no real label was written meanwhile.
 */
export async function bookReturnLabel(storeId: string, returnId: string, input: { weightGrams?: number | null } = {}, actor: OrderActor = { accountId: null, kind: "system" }): Promise<BookLabelResult> {
  if (!isUuid(storeId) || !isUuid(returnId)) return refuse("not_found");
  let acquired = false;
  let result: BookLabelResult = refuse("busy");
  await db().transaction(async (tx) => {
    const [lock] = await tx.execute<Row>(sql`select pg_try_advisory_xact_lock(hashtextextended(${`return-label:${returnId}`}, 0)) as ok`);
    acquired = lock?.ok === true;
    if (acquired) result = await bookUnderLock(storeId, returnId, input, actor);
  });
  if (!acquired) return refuse("busy");
  const done = result as BookLabelResult;
  if (!done.ok) return done;
  // Sent once the lock is released (the booking is committed: every write above went through its own statement).
  const { sendLabelReady } = await import("./exchange-emails");
  const emailed = await sendLabelReady(storeId, returnId).catch(() => "failed" as const);
  return { ...done, emailed };
}

async function bookUnderLock(storeId: string, returnId: string, input: { weightGrams?: number | null }, actor: OrderActor): Promise<BookLabelResult> {
  const l = await load(storeId, returnId);
  if (!l) return refuse("not_found");
  const block = blockOf(l);
  if (block) return refuse(block);
  const carrier = l.carrier!.id;
  const weightGrams = input.weightGrams && input.weightGrams > 0 ? Math.trunc(input.weightGrams) : await estimateReturnWeight(storeId, returnId);
  if (!(weightGrams > 0) || weightGrams > 35_000) return refuse("weight");
  const context = await carrierContext(storeId, carrier);
  const adapter = adapterFor(carrier);
  if (!context || !adapter?.bookReturn) return refuse("no_carrier");
  const price = await priceOf(context, carrier, l.service, l.from!, l.to!, weightGrams);
  let booked: Awaited<ReturnType<NonNullable<typeof adapter.bookReturn>>>;
  try {
    booked = await adapter.bookReturn(context, { returnReference: String(l.ret.number), serviceId: l.service, from: l.from!, to: l.to!, parcels: [{ weightGrams }] });
  } catch (error) {
    const said = error instanceof Error && error.message ? error.message : "The carrier could not book the label. Paste a label address instead, or try again.";
    await db().execute(sql`update commerce.returns set label_tries = label_tries + 1 where store_id = ${storeId}::uuid and id = ${returnId}::uuid`);
    await writeOrderEvent(db(), storeId, l.orderId, "return.label_failed", { returnId, number: String(l.ret.number), carrier, ...(actor.accountId ? { by: actor.accountId } : {}) }, actor.kind);
    return refuse("carrier", said);
  }
  const carrierUrl = booked.labelUrl && (carrier !== "bring" || isBringUrl(booked.labelUrl)) ? booked.labelUrl : null;
  const fromCountry = l.to!.country;
  const costMinor = await costInOrderCurrency(storeId, price ?? booked.price ?? null, l.currency, fromCountry);
  const trackingUrl = booked.trackingUrl && /^https:\/\//.test(booked.trackingUrl) ? booked.trackingUrl : null;
  // return_shipping_minor is not touched: the label's cost is taken off only at refund time, by staff, and never for a test label (4.8, As built).
  const updated = await db().execute<Row>(sql`
    update commerce.returns set label_url = null, label_source = 'carrier', label_carrier_id = ${carrier}, label_service = ${l.service},
      label_consignment_number = ${booked.consignmentNumber ?? null}, label_tracking_number = ${booked.trackingNumber || null},
      label_tracking_url = ${trackingUrl}, label_carrier_url = ${carrierUrl}, label_cost_minor = ${costMinor},
      label_cost_carrier = ${price ?? booked.price ? JSON.stringify(price ?? booked.price) : null}::jsonb, label_test = ${booked.test}, label_booked_at = now(),
      label_tries = label_tries + 1
    where store_id = ${storeId}::uuid and id = ${returnId}::uuid and status::text in ('approved', 'in_transit')
      and (label_source is distinct from 'carrier' or label_test)
    returning id
  `);
  if (updated.length === 0) return refuse("state");
  await writeOrderEvent(
    db(),
    storeId,
    l.orderId,
    "return.label_booked",
    { returnId, number: String(l.ret.number), carrier, service: l.service, test: booked.test, costMinor, ...(actor.accountId ? { by: actor.accountId } : {}) },
    actor.kind,
  );
  await audit(actor.accountId, storeId, "return.label_booked", { returnId, carrier, test: booked.test, costMinor }, { target: { type: "return", id: returnId } });
  return { ok: true, trackingNumber: booked.trackingNumber, test: booked.test, costMinor, emailed: null };
}

/** The label of a carrier, fetched with the agreement's keys from the carrier's own host only; null for any other host or a carrier that did not answer. */
async function fetchFromCarrier(storeId: string, carrier: string, url: string): Promise<Uint8Array | null> {
  if (carrier !== "bring" || !isBringUrl(url)) return null;
  const context = await carrierContext(storeId, "bring");
  if (!context) return null;
  return fetchBringLabel(context, url);
}

export type LabelFetch =
  | { ok: true; pdf: Uint8Array; filename: string }
  | { ok: false; status: 404 | 429 | 503; reason: "not_found" | "limit" | "carrier" };

/** One fetch of a return's label an hour counted (`chat_usage` bucket `label:{returnId}`, taken atomically). */
async function takeFetch(storeId: string, returnId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${`label:${returnId}`}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= LABEL_FETCHES_PER_HOUR;
}

async function fetchFor(storeId: string, where: { token: string } | { returnId: string }): Promise<LabelFetch> {
  const [r] = await db().execute<Row>(
    "token" in where
      ? sql`select id, number, status::text as status, label_source, label_carrier_id, label_carrier_url from commerce.returns where store_id = ${storeId}::uuid and public_token = ${where.token}`
      : sql`select id, number, status::text as status, label_source, label_carrier_id, label_carrier_url from commerce.returns where store_id = ${storeId}::uuid and id = ${where.returnId}::uuid`,
  );
  if (!r || r.label_source !== "carrier" || !r.label_carrier_url || ["closed", "declined", "cancelled"].includes(String(r.status))) return { ok: false, status: 404, reason: "not_found" };
  const url = String(r.label_carrier_url);
  const carrier = String(r.label_carrier_id);
  // An address on any host the carrier's module does not name is never fetched.
  if (carrier !== "bring" || !isBringUrl(url)) return { ok: false, status: 404, reason: "not_found" };
  if (!(await takeFetch(storeId, String(r.id)))) return { ok: false, status: 429, reason: "limit" };
  const pdf = await fetchFromCarrier(storeId, carrier, url);
  if (!pdf) return { ok: false, status: 503, reason: "carrier" };
  return { ok: true, pdf, filename: `return-${String(r.number).replace(/[^A-Za-z0-9-]/g, "")}.pdf` };
}

/**
 * The label route's fetch (`/s/{store}/{market}/returns/{token}/label`): the return is found by its token among the store's own (an unknown or another store's
 * token is a 404), ended returns and returns with no booked label are a 404, at most `LABEL_FETCHES_PER_HOUR` an hour (429), the carrier failing is a 503.
 * The bytes are given to the caller to answer and never kept.
 */
export async function returnLabel(storeId: string, token: string): Promise<LabelFetch> {
  if (!/^[0-9a-f]{32,128}$/.test(token) || !isUuid(storeId)) return { ok: false, status: 404, reason: "not_found" };
  return fetchFor(storeId, { token });
}

/** *Print label* on the return's page (staff, `orders:read`): the same fetch, by the return's id. */
export async function staffReturnLabel(storeId: string, returnId: string): Promise<LabelFetch> {
  if (!isUuid(storeId) || !isUuid(returnId)) return { ok: false, status: 404, reason: "not_found" };
  return fetchFor(storeId, { returnId });
}

export type PendingLabelsRun = { booked: number; failed: number; given_up: number };

/**
 * The five-minute job's part (`runReturnJobs()`): withdrawal returns of open stores with *automatic labels* on, approved, with no label yet, are booked, at most
 * `LABEL_TRIES` times (5, 20 and 60 minutes after the return was made). After the last failed try the order's history says `return.label_given_up` once
 * (staff see it on the return). Never throws.
 */
export async function bookPendingLabels(now: Date = new Date(), options: { limit?: number } = {}): Promise<PendingLabelsRun> {
  const run: PendingLabelsRun = { booked: 0, failed: 0, given_up: 0 };
  const due = await db().execute<Row>(sql`
    select r.store_id, r.id, r.order_id, r.label_tries, r.created_at from commerce.returns r
    join commerce.return_settings rs on rs.store_id = r.store_id and rs.label_auto
    where r.kind = 'withdrawal' and r.label_source is null and r.status::text = 'approved' and r.label_tries < ${LABEL_TRIES}
      and commerce.store_is_active(r.store_id)
    order by r.created_at limit ${options.limit ?? 50}
  `);
  for (const row of due) {
    const tries = Number(row.label_tries);
    const after = LABEL_TRY_AFTER_MINUTES[Math.min(tries, LABEL_TRY_AFTER_MINUTES.length - 1)] ?? 60;
    if (now.getTime() - new Date(String(row.created_at)).getTime() < after * 60_000) continue;
    try {
      const done = await bookReturnLabel(String(row.store_id), String(row.id));
      if (done.ok) run.booked += 1;
      // Another run (or staff) is booking it, or booked it meanwhile: not a try of this run.
      else if (done.problem === "busy" || done.problem === "booked") continue;
      else {
        run.failed += 1;
        // A reason no try can change (no carrier, no address) is counted as a try too, so the job stops asking.
        if (done.problem !== "carrier") {
          await db().execute(sql`update commerce.returns set label_tries = label_tries + 1 where store_id = ${String(row.store_id)}::uuid and id = ${String(row.id)}::uuid`);
        }
        if (tries + 1 >= LABEL_TRIES) {
          run.given_up += 1;
          await writeOrderEvent(db(), String(row.store_id), String(row.order_id), "return.label_given_up", { returnId: String(row.id), problem: done.problem }, "system");
        }
      }
    } catch (error) {
      run.failed += 1;
      log("error", "return_labels.book_failed", { returnId: String(row.id) }, error);
    }
  }
  return run;
}
