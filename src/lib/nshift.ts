import { minorUnitDigits } from "./money";
import type { BookingRequest, PickupPoint, ReturnBookingRequest, ShippingAddress, ShippingOption, TrackingEvent } from "./shipping-carriers";

/**
 * nShift Delivery (formerly Unifaun Online): what its REST API is sent and how its answers are read, as pure functions so they are tested without the
 * network. The calls are in `src/server/carriers/nshift.ts`. nShift is not a carrier but the booking system many Nordic shops use to book every
 * carrier of their own agreements (PostNord, Bring, DHL Freight, DB Schenker, GLS, Posti, …) from one account; a store connects its nShift account
 * and books through it with the carrier service codes of that account.
 *
 * Written against nShift's own API description, read 2026-11-05: the RAML `https://www.unifaunonline.com/rs-extapi/v1/documentation/root-resource-v1.raml`
 * (the console at https://www.unifaunonline.com/rs-docs/), its JSON schemas beside it (`ShipmentPrint`, `ShipmentInfo`, `FreightCheckout`,
 * `FreightCheckoutOption`, `PickupBookingRequest`, …) and its guides `Intro.md`, `CreatingShipments.md`, `Samples.md`, `AddressLookup.md` and
 * `Alerts.md`. The endpoints are at `api.unifaun.com/rs-extapi/v1`, every call with the store's API key as a bearer token (`{id}-{secret}`).
 *
 * - **Checkout**: the store's own *delivery checkout* (configured in nShift: which carriers' services, at which prices, with which pickup points),
 *   asked for a postal code (`GET /delivery-checkouts/{id}`). Each option names nShift's service code and the store's price for it, and its pickup
 *   points (agents). Whether that price includes VAT is not said in the API description (an option has a `taxRate`); it is read as the price the
 *   shopper pays, which is what a delivery checkout shows (unconfirmed).
 * - **Booking**: `POST /shipments` with the service code, the sender's *quick id* (the sender in the account's address book, which holds the store's
 *   customer numbers with each carrier), the receiver, the chosen agent and the parcels; `test` books a test shipment ("prints TEST on the label
 *   and disables EDI forwarding"), which is how the store's test environment works: nShift has no separate test host.
 * - **Labels**: a shipment's documents are kept by nShift for one hour, so a label is made again when it is printed (`POST /shipments/{id}/pdfs`
 *   with a print configuration, the PDF in the answer) and never kept here.
 * - **Collection** (`POST /pickup-bookings`), **cancelling** (`DELETE /shipments/{id}`: the shipment is discarded and its EDI message not sent),
 *   **status** (`GET /shipments-history`, by parcel number) and **return labels** (a shipment of a return service marked `returnShipment`).
 *
 * Each needs its licence on the store's nShift account (APIConnect: REST API Print, Discard, Delivery checkout, Shipment History, Store); a call
 * the key may not make answers 403, said so plainly.
 */

/** nShift's REST API: the same host for live and test (a test booking is marked `test`, below). */
export const NSHIFT_API = "https://api.unifaun.com/rs-extapi/v1";

/**
 * The one checkout service a store switches on: the options of its own nShift delivery checkout. nShift's options are the store's own (its
 * carriers, services and prices, set up in nShift), so they are not a fixed list here; each option a quote offers carries nShift's service code
 * as its `serviceId`, which is what an order keeps and what is booked.
 */
export const NSHIFT_CHECKOUT_SERVICE = "checkout";
export const NSHIFT_SERVICES: { id: string; name: string; needsPickupPoint: boolean }[] = [
  { id: NSHIFT_CHECKOUT_SERVICE, name: "The options of your nShift delivery checkout", needsPickupPoint: false },
];

/** A carrier service code of an nShift account ("P19", "BPAK", "DHLSP"): letters, digits, `_` and `-`. */
export const isServiceCode = (value: string | undefined | null): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value.trim());

/** The bearer token nShift takes: the key's id and secret joined by a dash (the RAML's custom bearer token). */
export const nshiftHeaders = (apiKeyId: string, apiSecret: string, extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: `Bearer ${apiKeyId}-${apiSecret}`,
  Accept: "application/json",
  ...extra,
});

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value.replace(",", "."))) ? Number(value.replace(",", ".")) : null;

/** Kilograms as nShift takes a parcel's weight, three decimals at most, at least 0.01. */
export const nshiftKilos = (grams: number) => Math.max(0.01, Math.round(grams) / 1000);

/** The additional services (addons) the store sends with every booking, typed as codes separated by commas ("NOTSMS, NOTEMAIL"). */
export const addonCodes = (typed: string | undefined): string[] => [
  ...new Set(
    (typed ?? "")
      .split(/[\s,;]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z0-9_]{1,20}$/.test(c)),
  ),
];

// ---------------------------------------------------------------------------
// The delivery checkout
// ---------------------------------------------------------------------------

/**
 * The store's delivery checkout for a postal code, in a language and currency the checkout is set up for. `fromcountry` and `fromzipcode` are
 * required when the checkout has no sender of its own, so they are always sent; `weight` (kilograms) lets the checkout's weight conditions apply
 * (named in nShift's help centre, not in the RAML: unconfirmed).
 */
export function deliveryCheckoutUrl(input: { checkoutId: string; language: string; currency: string; to: Pick<ShippingAddress, "postalCode" | "city" | "country">; from: Pick<ShippingAddress, "postalCode" | "country">; weightGrams?: number }) {
  const q = new URLSearchParams({
    language: input.language,
    currency: input.currency,
    tocountry: input.to.country.toUpperCase(),
    tozipcode: input.to.postalCode.replace(/\s+/g, ""),
    fromcountry: input.from.country.toUpperCase(),
    fromzipcode: input.from.postalCode.replace(/\s+/g, ""),
  });
  if (input.to.city) q.set("tocity", input.to.city);
  if (input.weightGrams) q.set("weight", String(nshiftKilos(input.weightGrams)));
  return `${NSHIFT_API}/delivery-checkouts/${encodeURIComponent(input.checkoutId)}?${q.toString()}`;
}

/** The language a checkout is asked in: English unless the checkout is set up for the store's own (nShift takes sv, en, fi, da, no). */
const LANGUAGES: Record<string, string> = { SE: "sv", FI: "fi", DK: "da", NO: "no" };
export const checkoutLanguage = (country: string) => LANGUAGES[country.toUpperCase()] ?? "en";

/** A currency's decimals (two for one this module does not know). */
const digitsOf = (currency: string) => {
  try {
    return minorUnitDigits(currency.toUpperCase());
  } catch {
    return 2;
  }
};

const pointOf = (raw: unknown): PickupPoint | null => {
  const a = obj(raw);
  const id = text(a.id);
  if (!id) return null;
  const name = text(a.name) || id;
  const distance = num(a.distance);
  return {
    id,
    name,
    address: { name, street: [text(a.address1), text(a.address2)].filter(Boolean).join(", "), postalCode: text(a.zipCode) || text(a.zipcode), city: text(a.city), country: (text(a.country) || text(a.countryCode)).toUpperCase() },
    ...(text(a.openingHours) ? { openingHours: text(a.openingHours) } : {}),
    // The checkout gives the distance in metres when it gives one (unconfirmed unit).
    ...(distance !== null && distance >= 0 ? { distanceMeters: Math.round(distance) } : {}),
  };
};

/** A checkout option offered, as the shopper sees it, with the agents (pickup points) it delivers to. */
export type NshiftOption = ShippingOption & { optionId: string; partnerId: string | null; pickupPoints: PickupPoint[] };

/**
 * The options of a delivery checkout answer, with a price and a service code: an option with sub-options is a group (its leaves are the choices),
 * and of two choices of one service code the first is kept (nShift's own order). An option without a price or a service code is left out.
 */
export function parseCheckout(json: unknown, currency: string): { checkoutId: string | null; invalidPostalCode: boolean; options: NshiftOption[] } {
  const body = obj(json);
  const options: NshiftOption[] = [];
  const leaves = (raw: unknown): Obj[] => {
    const o = obj(raw);
    const subs = list(o.subOptions);
    return subs.length > 0 ? subs.flatMap(leaves) : [o];
  };
  for (const o of list(body.options).flatMap(leaves)) {
    const serviceId = text(o.serviceId);
    const price = num(o.priceValue);
    if (!isServiceCode(serviceId) || price === null || price < 0 || options.some((x) => x.serviceId === serviceId)) continue;
    const points = list(o.agents)
      .map(pointOf)
      .filter((p): p is PickupPoint => p !== null);
    options.push({
      serviceId,
      carrier: "nshift",
      name: text(o.name) || serviceId,
      priceMinor: Math.round(price * 10 ** digitsOf(currency)),
      currency: currency.toUpperCase(),
      // The price a delivery checkout shows the shopper (unconfirmed: the API gives a `taxRate` beside it without saying).
      includesVat: true,
      needsPickupPoint: points.length > 0,
      optionId: text(o.id),
      partnerId: text(o.partnerId) || text(o.carrierId) || null,
      pickupPoints: points,
    });
  }
  return { checkoutId: text(body.deliveryCheckoutId) || null, invalidPostalCode: body.invalidPostalCode === true, options };
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

/**
 * Documents made as PDFs for printing in the browser: labels on a single A5 page, other papers (waybills, a customs invoice) on A4. Labels and
 * papers each go to the first target that takes them (`CreatingShipments.md`, "Print configuration").
 */
export const PRINT_CONFIG = {
  target1Media: "laser-a5",
  target1Type: "pdf",
  target1XOffset: 0,
  target1YOffset: 0,
  target2Media: "laser-a4",
  target2Type: "pdf",
  target2XOffset: 0,
  target2YOffset: 0,
} as const;

/** The store's nShift details a booking reads. */
export type NshiftAccount = { senderQuickId: string; addons: string[]; test: boolean };

/** What is missing for nShift to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: Pick<BookingRequest, "serviceId" | "to" | "from">, account: Pick<NshiftAccount, "senderQuickId">): string[] {
  const problems: string[] = [];
  if (!account.senderQuickId) problems.push("Add the sender's quick id from your nShift address book on the carrier's page.");
  if (!isServiceCode(request.serviceId)) problems.push("Choose the nShift service to book, or set the service for orders without a choice on the carrier's page.");
  const to = request.to;
  if (!to.name || !to.street || !to.postalCode || !to.city) problems.push("The delivery address needs a name, street, postal code and city.");
  return problems;
}

const party = (a: ShippingAddress, extra: Obj = {}) => {
  const [address1, address2] = a.street
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    ...extra,
    name: a.name.slice(0, 70),
    address1: (address1 ?? a.street).slice(0, 70),
    ...(address2 ? { address2: address2.slice(0, 70) } : {}),
    zipcode: a.postalCode.replace(/\s+/g, ""),
    city: a.city.slice(0, 35),
    country: a.country.toUpperCase(),
    ...(a.phone ? { phone: a.phone, mobile: a.phone } : {}),
    ...(a.email ? { email: a.email } : {}),
  };
};

const major = (minor: number, currency: string) => minor / 10 ** digitsOf(currency);

/** The customs declaration nShift prints with a parcel across a customs border (D343): a commercial invoice with each line. */
function customsOf(request: Pick<BookingRequest, "customs" | "from" | "to">) {
  const customs = request.customs;
  if (!customs) return {};
  return {
    customsDeclaration: {
      printSet: ["proforma"],
      invoiceType: "standard",
      invoiceNo: customs.invoiceNumber.slice(0, 35),
      currencyCode: customs.currency,
      termCode: customs.incoterm,
      importExportType: "permanent",
      sourceCountryCode: request.from.country.toUpperCase(),
      destinationCountryCode: request.to.country.toUpperCase(),
      lines: customs.lines.map((line) => ({
        copies: line.quantity,
        valuesPerItem: false,
        statNo: line.hsCode,
        value: major(line.valueMinor, customs.currency),
        contents: line.description.slice(0, 70),
        netWeight: nshiftKilos(line.weightGrams),
        grossWeight: nshiftKilos(line.weightGrams),
        sourceCountryCode: line.origin,
      })),
    },
  };
}

/**
 * A shipment to print (`POST /shipments`): the sender by its quick id in the store's address book (where its customer numbers with each carrier
 * are) with the address the carrier page holds, the receiver, the agent the shopper chose (its id as the quick id, which nShift completes from
 * the carrier's register), the service with the store's own addons, one parcel row per parcel, the order number, and `test` in the store's test
 * environment. Parcel sizes are not sent: the API description does not give their unit.
 */
export function shipmentBody(request: BookingRequest, account: NshiftAccount) {
  return {
    printConfig: PRINT_CONFIG,
    shipment: {
      sender: party(request.from, { quickId: account.senderQuickId }),
      receiver: party(request.to),
      ...(request.pickupPointId ? { agent: { quickId: request.pickupPointId } } : {}),
      service: { id: request.serviceId.trim(), ...(account.addons.length > 0 ? { addons: account.addons.map((id) => ({ id })) } : {}) },
      parcels: request.parcels.map((p) => ({ copies: 1, weight: nshiftKilos(p.weightGrams), contents: (request.customs?.lines[0]?.description || "Goods").slice(0, 70), valuePerParcel: true })),
      orderNo: request.orderReference.slice(0, 35),
      senderReference: (request.parcelReference ?? request.orderReference).slice(0, 17),
      ...(request.courierInstructions ? { freeText1: request.courierInstructions.slice(0, 30) } : {}),
      ...customsOf(request),
      ...(account.test ? { test: true } : {}),
    },
  };
}

/**
 * A return label (D239): a shipment of the store's return service marked as a return (`service.returnShipment`), from the shopper to the store.
 * Which party nShift wants as the sender of a return is not said in the API description (unconfirmed): the shopper is sent as the sender and
 * the store as the receiver, as the parcel travels.
 */
export function returnShipmentBody(request: ReturnBookingRequest, account: NshiftAccount) {
  return {
    printConfig: PRINT_CONFIG,
    shipment: {
      sender: party(request.from),
      receiver: party(request.to, { quickId: account.senderQuickId }),
      service: { id: request.serviceId.trim(), normalShipment: false, returnShipment: true },
      parcels: request.parcels.map((p) => ({ copies: 1, weight: nshiftKilos(p.weightGrams), contents: "Return", valuePerParcel: true })),
      orderNo: request.returnReference.slice(0, 35),
      senderReference: request.returnReference.slice(0, 17),
      ...(account.test ? { test: true } : {}),
    },
  };
}

export type ParsedShipment = { ok: true; shipmentId: string; trackingNumber: string; shipmentNo: string | null; parcelNos: string[] } | { ok: false; problem: string };

/** The shipment made (the answer is a list of one): nShift's own id (for labels, collection and cancelling) and the parcel numbers. */
export function parseShipment(json: unknown): ParsedShipment {
  const first = obj(list(json)[0] ?? json);
  const shipmentId = text(first.id);
  if (!shipmentId) return { ok: false, problem: "nShift answered without a shipment." };
  const parcelNos = list(first.parcels)
    .map((p) => text(obj(p).parcelNo))
    .filter(Boolean);
  const shipmentNo = text(first.shipmentNo) || null;
  return { ok: true, shipmentId, trackingNumber: parcelNos[0] ?? shipmentNo ?? shipmentId, shipmentNo, parcelNos };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Where a shipment's documents are made again: what its `label_url` holds. */
export const labelUrl = (shipmentId: string) => `${NSHIFT_API}/shipments/${encodeURIComponent(shipmentId)}/pdfs`;

/** Only nShift's own shipment documents are ever asked for with the store's key. */
export const isNshiftUrl = (url: string) => /^https:\/\/api\.unifaun\.com\/rs-extapi\/v1\/shipments\/[A-Za-z0-9_-]{1,40}\/pdfs$/.test(url);

/** The label among a shipment's documents (its description says "Label"), else the first; its PDF bytes, or null when the answer holds none. */
export function parseLabelPdfs(json: unknown): Uint8Array | null {
  const pdfs = list(json).map(obj);
  const label = pdfs.find((p) => /label/i.test(text(p.description)) && text(p.pdf)) ?? pdfs.find((p) => text(p.pdf));
  const data = text(label?.pdf);
  if (!data) return null;
  const bytes = Uint8Array.from(Buffer.from(data, "base64"));
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? bytes : null;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * A collection of a printed shipment from the sender's address (`POST /pickup-bookings`): the day and window, where at the address and whom to call
 * (PostNord needs both).
 */
export function pickupBody(shipmentId: string, collection: NonNullable<BookingRequest["collection"]>, from: ShippingAddress) {
  return {
    shipmentIds: [shipmentId],
    pickupDate: collection.date,
    pickupTimeFrom: collection.readyTime,
    pickupTimeTo: collection.closeTime,
    location: from.street.slice(0, 35),
    contact: { name: from.name.slice(0, 35), ...(from.phone ? { phone: from.phone } : {}), ...(from.email ? { email: from.email } : {}) },
  };
}

/** What the carrier said to the collection: booked (confirmed, or sent to the carrier) with its number, or why not. */
export function parsePickup(json: unknown): { booked: boolean; confirmation: string | null; problem: string | null } {
  const first = obj(list(json)[0]);
  const status = text(first.status).toUpperCase();
  if (status === "CONFIRMED" || status === "SUBMITTED") return { booked: true, confirmation: text(first.bookingNo) || text(first.id) || null, problem: null };
  return { booked: false, confirmation: null, problem: text(first.errorMessage) || "The carrier did not take the collection." };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** A parcel's shipment in nShift's history (at most six months back), by its parcel number, or by the shipment number when it has no parcel number. */
export const historyUrl = (field: "parcelNo" | "shipmentNo", value: string) =>
  `${NSHIFT_API}/shipments-history?page=0&searchField=${field}&searchValue=${encodeURIComponent(value)}`;

/** nShift's statuses of a printed shipment, in its own words (the RAML's "Response" of `/shipments`). */
export const NSHIFT_STATUS_WORDS: Record<string, string> = {
  PRINTED: "Printed",
  DISPATCHING: "On its way",
  OUTFORDELIVERY: "Out for delivery",
  DELIVERING: "Arrived at the pickup point",
  DELIVERED: "Delivered",
  PARTDELIVERED: "Partly delivered",
  RETURNED: "Returned to the sender",
  CANCELLED: "Cancelled",
};

/** The shipment's status as one event (nShift gives the latest status of the shipment, not a trail), when it changed. */
export function parseHistory(json: unknown, trackingNumber: string): TrackingEvent[] {
  const shipments = list(obj(json).shipments).map(obj);
  const found = shipments.find((s) => list(s.parcels).some((p) => text(obj(p).parcelNo) === trackingNumber)) ?? shipments[0];
  if (!found) return [];
  const status = text(found.status).toUpperCase();
  const at = text(found.changed) || text(found.printed) || text(found.created);
  if (!status || !at) return [];
  // nShift writes "2015-06-03T13:18:30.904+0000": the offset gets its colon.
  const iso = at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return [{ at: iso, status, description: NSHIFT_STATUS_WORDS[status] ?? status }];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** What nShift said was wrong: a validation list's errors (`statusList`), or an error's message. */
export function nshiftError(json: unknown): string {
  if (Array.isArray(json)) {
    const errors = json.map(obj).filter((s) => text(s.type).toLowerCase() !== "ignorable" && text(s.message));
    return errors
      .slice(0, 3)
      .map((s) => `${text(s.message)}${text(s.field) ? ` (${text(s.field)})` : ""}`)
      .join("; ")
      .slice(0, 300);
  }
  return text(obj(json).message).slice(0, 300);
}

/** What to tell the owner when nShift answers with a status that is not a success. */
export function nshiftProblem(status: number, json?: unknown): string {
  const said = nshiftError(json);
  if (status === 401) return "nShift did not accept the API key. Check the key's id and secret on this page.";
  if (status === 403) return "nShift accepted the API key, but your nShift account has no licence for this. Ask nShift for the REST API licence it needs (APIConnect).";
  if (status === 404) return "nShift did not find that.";
  if (status === 422) return said ? `nShift did not accept the shipment: ${said}` : "nShift did not accept the shipment.";
  if (status === 429) return "nShift asked us to slow down. Try again in a moment.";
  if (status >= 500) return "nShift is not answering right now. Try again in a moment.";
  return said ? `nShift did not accept the request: ${said}` : `nShift did not accept the request (${status}).`;
}
