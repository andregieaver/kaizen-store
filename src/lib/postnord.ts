import { COUNTRY_ZONES, toInstant } from "./tracking-phases";
import type { BookingRequest, CustomsLine, PickupPoint, ReturnBookingRequest, ShippingAddress, TrackingEvent } from "./shipping-carriers";

/**
 * PostNord (D136, booking D459): what PostNord's APIs are sent and how their answers are read, as pure functions so they are tested
 * without the network. The calls themselves are in `src/server/carriers/postnord.ts`. PostNord has no price API: what a
 * service costs is in the store's agreement, so the store enters its own prices for checkout (`delivery-options.ts`,
 * pricing "store"). Used here: the service point search (where to collect), Track and Trace v5, a connection check, and the
 * Booking APIs v3: an EDI instruction booked with its PDF label in one call, return labels (Return Drop Off) and pickups.
 * Every call carries the store's own API key as `apikey`.
 *
 * The booking is written against PostNord's own published API guide, the Postman collection "PostNord Developer"
 * (guide.developer.postnord.com, collection 26397436/2s93zE2Keo, read 2026-11-05): its attribute table under *Booking APIs v3*
 * and its examples (MyPack Home 17, Parcel 18, MyPack Collect 19 with a `deliveryParty`, Return Drop Off 24, CN23 customs,
 * PickupBooking). The guide documents no call that cancels a booking, and the label is given only in the booking's answer
 * (`labelPrintout`, base64 PDF) unless PostNord is asked to store it; it is handed on as the booking's `labelPdf`.
 */

/** PostNord's production host and its sandbox, chosen by the store's environment. */
export const POSTNORD_HOSTS = { live: "https://api2.postnord.com", test: "https://atapi2.postnord.com" } as const;

/**
 * The services a store can offer at checkout, by PostNord's own basic service codes: 19 MyPack Collect (to a service point), 17 MyPack Home and
 * 18 Parcel, as PostNord's guide names its examples ("MyPack Collect (19)", "MyPack Home (17)", "Parcel (18)"). D136 had 17 and 19 the other
 * way round; `basicServiceCode()` books an order quoted then by whether it has a service point, whichever code it kept.
 */
export const POSTNORD_SERVICES: { id: string; name: string; needsPickupPoint: boolean }[] = [
  { id: "19", name: "PostNord MyPack Collect", needsPickupPoint: true },
  { id: "17", name: "PostNord MyPack Home", needsPickupPoint: false },
  { id: "18", name: "PostNord Parcel", needsPickupPoint: false },
];

export const postnordService = (id: string) => POSTNORD_SERVICES.find((s) => s.id === id) ?? null;

/** The countries PostNord's own network covers, as the stores' markets are named. */
export const POSTNORD_COUNTRIES = ["SE", "DK", "NO", "FI"];

/** A postal code in each country to ask a harmless question about, for the connection check. */
export const SAMPLE_POSTAL_CODES: Record<string, string> = { SE: "11122", DK: "1050", NO: "0150", FI: "00100" };

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

export const postnordHost = (environment: string) => (environment === "live" ? POSTNORD_HOSTS.live : POSTNORD_HOSTS.test);

// ---------------------------------------------------------------------------
// Service points
// ---------------------------------------------------------------------------

/** The nearest service points to a postal code: Business Location v5, nearest by address. */
export function servicePointsUrl(host: string, apiKey: string, country: string, postalCode: string, count = 5): string {
  const query = new URLSearchParams({
    apikey: apiKey,
    returnType: "json",
    countryCode: country.toUpperCase(),
    postalCode,
    numberOfServicePoints: String(count),
  });
  return `${host}/rest/businesslocation/v5/servicepoints/nearest/byaddress?${query.toString()}`;
}

const DAYS: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const hhmm = (value: string) => (/^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : value);

/** Opening hours as a line ("Mon 09:00–18:00, Tue …") from PostNord's day/from/to entries; empty when not given. */
function openingHours(raw: unknown): string {
  return list(raw)
    .map((entry) => {
      const o = obj(entry);
      const day = DAYS[text(o.day).slice(0, 2).toUpperCase()];
      const from = text(o.from1);
      const to = text(o.to1);
      return day && from && to ? `${day} ${hhmm(from)}–${hhmm(to)}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

/** The service points an answer holds, nearest first as PostNord gave them; points without an id are left out. */
export function parseServicePoints(json: unknown): PickupPoint[] {
  const body = obj(obj(json).servicePointInformationResponse);
  const raw = list(body.servicePoints).length > 0 ? list(body.servicePoints) : list(obj(json).servicePoints);
  const points: PickupPoint[] = [];
  for (const item of raw) {
    const p = obj(item);
    const id = text(p.servicePointId);
    if (!id) continue;
    // The address a parcel is collected at; the delivery address is only a fallback.
    const visiting = obj(p.visitingAddress);
    const address = Object.keys(visiting).length > 0 ? visiting : obj(p.deliveryAddress);
    const street = [text(address.streetName), text(address.streetNumber)].filter(Boolean).join(" ");
    const meters = Number.parseFloat(text(p.routeDistance) || text(p.distance));
    const hours = openingHours(p.openingHours);
    points.push({
      id,
      name: text(p.name) || id,
      address: {
        name: text(p.name) || id,
        street,
        postalCode: text(address.postalCode),
        city: text(address.city),
        country: text(address.countryCode).toUpperCase() || "",
      },
      ...(hours ? { openingHours: hours } : {}),
      ...(Number.isFinite(meters) ? { distanceMeters: Math.round(meters) } : {}),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/** Track and Trace v5, find by identifier. */
export function trackingUrl(host: string, apiKey: string, number: string): string {
  const query = new URLSearchParams({ apikey: apiKey, id: number, locale: "en" });
  return `${host}/rest/shipment/v5/trackandtrace/findByIdentifier.json?${query.toString()}`;
}

/** A parcel's events, newest first; empty when PostNord does not know the number (yet). */
export function parseTracking(json: unknown): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  for (const shipment of list(obj(obj(json).TrackingInformationResponse ?? obj(json).trackingInformationResponse).shipments)) {
    for (const item of list(obj(shipment).items)) {
      for (const raw of list(obj(item).events)) {
        const e = obj(raw);
        const where = obj(e.location);
        const at = text(e.eventTime);
        if (!at) continue;
        events.push({
          at,
          status: text(e.eventCode) || text(e.status),
          description: text(e.eventDescription),
          ...(text(where.displayName) || text(where.city) ? { location: text(where.displayName) || text(where.city) } : {}),
        });
      }
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * What PostNord said was wrong, cut short: a fault's `explanationText` (`compositeFault.faults`, at the top or one level down, as its answers
 * write it), else an `error.message`, else a refused item's message in a booking answer.
 */
export function postnordError(json: unknown): string {
  const body = obj(json);
  const holders = [body, ...Object.values(body).map(obj)];
  for (const holder of holders) {
    const fault = obj(list(obj(holder.compositeFault).faults)[0]);
    const said = text(fault.explanationText) || text(fault.faultCode);
    if (said) return said.slice(0, 300);
  }
  const error = text(obj(body.error).message);
  if (error) return error.slice(0, 300);
  for (const info of list(obj(body.bookingResponse).idInformation).concat(list(body.idInformation))) {
    const o = obj(info);
    if (text(o.status) && text(o.status).toUpperCase() !== "OK") return (text(o.message) || text(obj(list(o.errors)[0]).message) || text(o.status)).slice(0, 300);
  }
  return "";
}

/** What to tell the owner when PostNord answers with a status that is not a success. */
export function postnordProblem(status: number, json?: unknown): string {
  if (status === 401 || status === 403) return "PostNord did not accept the API key. Check it on this page, and that it is for the right environment (test or live).";
  if (status === 404) return "PostNord did not find that.";
  if (status === 429) return "PostNord asked us to slow down. Try again in a moment.";
  if (status >= 500) return "PostNord is not answering right now. Try again in a moment.";
  const said = postnordError(json);
  return said ? `PostNord did not accept the request: ${said}` : `PostNord did not accept the request (${status}).`;
}

// ---------------------------------------------------------------------------
// Booking (Booking APIs v3: EDI instruction with its PDF label)
// ---------------------------------------------------------------------------

/** The PostNord organisation a customer number belongs to (`issuerCode`): Z11 Denmark, Z12 Sweden, Z13 Norway, Z14 Finland. */
export const ISSUER_CODES: Record<string, string> = { DK: "Z11", SE: "Z12", NO: "Z13", FI: "Z14" };
export const issuerCode = (country: string): string | null => ISSUER_CODES[country.toUpperCase()] ?? null;

/**
 * The application id every booking names (`application.applicationId`, 1 to 4 characters): PostNord gives one when a shop goes live
 * (apisupport@postnord.com). The store's own when it saved one; in the test environment PostNord's examples' 9999 stands in.
 */
export function applicationIdOf(details: Record<string, string>, environment: string): string | null {
  const own = (details.applicationId ?? "").trim();
  if (/^\d{1,4}$/.test(own)) return own;
  return environment === "live" ? null : "9999";
}

/**
 * The basic service code a booking is made as. A service point means MyPack Collect (19), the only one delivered to one; without a point, a
 * service quoted as 19 before PostNord's codes were corrected (D459) was MyPack Home (17). 17 and 18 are booked as they are.
 */
export function basicServiceCode(serviceId: string, pickupPointId: string | null | undefined): string {
  if (pickupPointId) return "19";
  return serviceId === "19" ? "17" : serviceId;
}

const CALLING_CODES: Record<string, string> = { NO: "+47", SE: "+46", DK: "+45", FI: "+358" };

/** A phone number as PostNord's `smsNo` takes it, with the country's calling code when it carries none; empty when there is none. */
export function smsNumber(phone: string | undefined, country: string): string {
  const compact = (phone ?? "").replace(/[\s().-]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  const code = CALLING_CODES[country.toUpperCase()];
  return code ? `${code}${compact.replace(/^0/, "")}` : compact;
}

const kilos = (grams: number) => Math.max(0.01, Math.round(grams / 10) / 100);

const party = (a: ShippingAddress, withContact: boolean) => ({
  nameIdentification: { name: a.name.slice(0, 70) },
  address: { streets: [a.street.slice(0, 70)], postalCode: a.postalCode.replace(/\s+/g, ""), city: a.city.slice(0, 35), countryCode: a.country.toUpperCase() },
  ...(withContact && (a.email || a.phone)
    ? {
        contact: {
          contactName: a.name.slice(0, 70),
          ...(a.email ? { emailAddress: a.email } : {}),
          ...(a.phone ? { phoneNo: smsNumber(a.phone, a.country), smsNo: smsNumber(a.phone, a.country) } : {}),
        },
      }
    : {}),
});

const consignor = (from: ShippingAddress, customerNumber: string, issuer: string) => ({
  issuerCode: issuer,
  partyIdentification: { partyId: customerNumber, partyIdType: "160" },
  party: party(from, true),
});

const item = (p: BookingRequest["parcels"][number]) => {
  const cm = (mm: number | undefined) => (mm ? { value: Math.max(1, Math.ceil(mm / 10)), unit: "CMT" } : null);
  const [length, width, height] = [cm(p.lengthMm), cm(p.widthMm), cm(p.heightMm)];
  return {
    itemIdentification: { itemId: "0", itemIdType: "SSCC" },
    ...(length && width && height ? { dimensions: { height, width, length } } : {}),
    grossWeight: { value: kilos(p.weightGrams), unit: "KGM" },
  };
};

/** What is missing for PostNord to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: BookingRequest, input: { customerNumber: string; applicationId: string | null }): string[] {
  const problems: string[] = [];
  if (!/^\d{1,17}$/.test(input.customerNumber.trim())) problems.push("The customer number is missing: add it on the carrier's page.");
  if (!input.applicationId) problems.push("Add the application id PostNord gave you for live bookings (ask apisupport@postnord.com) on the carrier's page.");
  if (!POSTNORD_SERVICES.some((s) => s.id === request.serviceId)) problems.push("Choose a PostNord service.");
  if (!issuerCode(request.from.country)) problems.push("Add the sender's country on the carrier's page: Sweden, Denmark, Norway or Finland, where your PostNord agreement is.");
  if (!request.from.name || !request.from.street || !request.from.postalCode || !request.from.city) problems.push("Add the sender's name and address on the carrier's page.");
  const to = request.to;
  if (!to.name || !to.street || !to.postalCode || !to.city) problems.push("The delivery address needs a name, street, postal code and city.");
  if (!to.email && !to.phone) problems.push("The order has no email or phone for the recipient, which PostNord needs to tell them the parcel is coming.");
  return problems;
}

/** CN23 takes at most five lines (PostNord's guide, *Book Customs Information*). */
export const CN23_MAX_LINES = 5;

/** A customs line as CN23 writes it: the value is per piece, the weight the line's. */
function cn23Line(line: CustomsLine, currency: string, row: number) {
  const each = Math.round(line.valueMinor / Math.max(1, line.quantity)) / 100;
  return {
    content: line.description.slice(0, 50),
    quantity: { value: line.quantity },
    grossWeight: { value: kilos(line.weightGrams), unit: "KGM" },
    value: { amount: each, currency },
    hsTariffNumber: line.hsCode,
    countryCode: line.origin,
    rowNo: row,
  };
}

/** A unique message id, 1 to 14 characters, as the guide asks of every message. */
export const messageIdOf = (seed: string, now: Date) => `kf${(now.getTime() % 36 ** 8).toString(36)}${seed.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`.slice(0, 14);

/**
 * The EDI instruction for one shipment: the store's customer number on the consignor (with its PostNord organisation), the recipient with their
 * email and phone for PostNord's notices, the service point the shopper chose as `deliveryParty` (party id type 156, with add-on A7, *optional
 * service point*, as PostNord's MyPack Collect examples have it), one item per parcel, the order number as the CU reference, and for a parcel
 * across a customs border with at most five lines a CN23 declaration and the terms of delivery. With more lines nothing is declared here
 * (`customs.declared` false): staff declare it in PostNord's own tools, as for Bring.
 */
export function ediBody(
  request: BookingRequest,
  input: { customerNumber: string; applicationId: string; servicePoint?: PickupPoint | null; now?: Date },
): { body: Record<string, unknown>; customs: { declared: boolean; problem: string | null } | null } {
  const now = input.now ?? new Date();
  const issuer = issuerCode(request.from.country) ?? "Z12";
  const code = basicServiceCode(request.serviceId, request.pickupPointId);
  const totalGrams = request.parcels.reduce((sum, p) => sum + Math.max(1, p.weightGrams), 0);
  const customs = request.customs;
  const declare = customs && customs.lines.length > 0 && customs.lines.length <= CN23_MAX_LINES;
  const point = request.pickupPointId
    ? {
        deliveryParty: {
          partyIdentification: { partyId: request.pickupPointId, partyIdType: "156" },
          ...(input.servicePoint ? { party: party(input.servicePoint.address, false) } : {}),
        },
      }
    : {};
  const shipment: Record<string, unknown> = {
    shipmentIdentification: { shipmentId: "0" },
    dateAndTimes: { loadingDate: now.toISOString() },
    service: { basicServiceCode: code, ...(request.pickupPointId ? { additionalServiceCode: ["A7"] } : {}) },
    numberOfPackages: { value: request.parcels.length },
    totalGrossWeight: { value: kilos(totalGrams), unit: "KGM" },
    references: [{ referenceNo: request.orderReference.slice(0, 35), referenceType: "CU" }],
    ...(request.courierInstructions ? { freeText: [{ usageCode: "DEL", text: request.courierInstructions.slice(0, 256) }] } : {}),
    parties: {
      consignor: consignor(request.from, input.customerNumber.trim(), issuer),
      consignee: { party: party(request.to, true) },
      ...point,
    },
    goodsItem: [{ packageTypeCode: "PC", items: request.parcels.map(item) }],
  };
  if (customs && declare) {
    const total = customs.lines.reduce((sum, l) => sum + l.valueMinor, 0);
    shipment.termsOfDelivery = { todConditionCode: customs.incoterm, todConditionCodeList: "INCOTERMS" };
    shipment.customsDeclarationCN23 = {
      categoryOfItem: { categoryType: ["SALE OF GOODS"] },
      detailedDescription: customs.lines.map((line, i) => cn23Line(line, customs.currency, i + 1)),
      totalGrossWeight: { value: kilos(customs.lines.reduce((sum, l) => sum + l.weightGrams, 0)), unit: "KGM" },
      totalValue: { amount: total / 100, currency: customs.currency },
    };
  }
  return {
    body: {
      messageDate: now.toISOString(),
      messageFunction: "Instruction",
      messageId: messageIdOf(request.parcelReference ?? request.orderReference, now),
      application: { applicationId: Number(input.applicationId), name: "Kaizena Flow", version: "1.0" },
      updateIndicator: "Original",
      shipment: [shipment],
    },
    customs: customs
      ? declare
        ? { declared: true, problem: null }
        : { declared: false, problem: `PostNord's CN23 takes at most ${CN23_MAX_LINES} customs lines and this parcel has ${customs.lines.length}: declare it in PostNord's own tools.` }
      : null,
  };
}

/** The booking with its PDF label in one call: one PDF holding every label, on label-sized pages, kept by PostNord only in our answer. */
export function ediLabelsUrl(host: string, apiKey: string): string {
  const query = new URLSearchParams({
    apikey: apiKey,
    paperSize: "LABEL",
    rotate: "0",
    multiPDF: "true",
    labelType: "standard",
    pnInfoText: "false",
    labelsPerPage: "100",
    page: "1",
    processOffline: "false",
    storeLabel: "false",
  });
  return `${host}/rest/shipment/v3/edi/labels/pdf?${query.toString()}`;
}

export type ParsedBooking =
  | { ok: true; itemId: string; bookingId: string | null; trackingUrl: string | null; label: Uint8Array | null }
  | { ok: false; problem: string };

const isPdf = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

/** The PDF among an answer's printouts (a return's answer also has the QR code as a PNG); null when there is none. */
function pdfOf(json: unknown): Uint8Array | null {
  for (const printout of list(obj(json).labelPrintout)) {
    const p = obj(obj(printout).printout);
    if (text(p.labelFormat).toUpperCase() !== "PDF" || !text(p.data)) continue;
    const bytes = Uint8Array.from(Buffer.from(text(p.data), "base64"));
    if (isPdf(bytes)) return bytes;
  }
  return null;
}

/**
 * The booking made: the first item id (the parcel's number, which tracking finds), the booking id, PostNord's tracking page for it (only one of
 * PostNord's own `https` addresses), and the label. An item PostNord did not accept is a plain sentence.
 */
export function parseBooking(json: unknown): ParsedBooking {
  const body = obj(json);
  const booking = Object.keys(obj(body.bookingResponse)).length > 0 ? obj(body.bookingResponse) : body;
  const info = obj(list(booking.idInformation)[0]);
  if (text(info.status) && text(info.status).toUpperCase() !== "OK") return { ok: false, problem: `PostNord did not accept the parcel: ${postnordError(json) || text(info.status)}` };
  const itemId = text(obj(list(info.ids).map(obj).find((i) => text(i.idType) === "itemId")).value);
  if (!itemId) return { ok: false, problem: "PostNord answered without a parcel number." };
  const tracking = text(obj(list(info.urls).map(obj).find((u) => text(u.type).toUpperCase() === "TRACKING")).url);
  return {
    ok: true,
    itemId,
    bookingId: text(booking.bookingId) || null,
    trackingUrl: /^https:\/\/(at)?tracking\.postnord\.com\//.test(tracking) ? tracking : null,
    label: pdfOf(json),
  };
}

/**
 * Where a booked parcel's label is at PostNord (its label-by-id call, with the item id after `#`): what the shipment's `label_url` says. The
 * label itself is the booking's `labelPdf`, kept by the booking path; this address is never fetched (the call's request is not published).
 */
export const labelAddress = (host: string, itemId: string) => `${host}/rest/shipment/v3/labels/ids/pdf#${encodeURIComponent(itemId)}`;

/** A service point by its id (Business Location v5), for the name and address a MyPack Collect booking carries. */
export function servicePointByIdUrl(host: string, apiKey: string, country: string, id: string): string {
  const query = new URLSearchParams({ apikey: apiKey, returnType: "json", countryCode: country.toUpperCase(), ids: id });
  return `${host}/rest/businesslocation/v5/servicepoints/ids?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Return labels (Book Digital Returns: Return Drop Off, 24)
// ---------------------------------------------------------------------------

/** The return services a store can book: Return Drop Off (24), handed in at a PostNord service point, in all four Nordic countries. */
export const POSTNORD_RETURN_SERVICES: { id: string; name: string; confirmed: boolean }[] = [{ id: "24", name: "PostNord Return Drop Off", confirmed: true }];
export const POSTNORD_RETURN_DEFAULT = "24";
export const POSTNORD_RETURN_COUNTRIES = ["SE", "DK", "NO", "FI"];

/**
 * A return label: the shopper hands the parcel in (the consignor, with their email and phone, which PostNord's guide asks for on 24) and it goes
 * to the store's return address (the consignee). The store's customer number goes on the consignor, except for a parcel handed in in Norway,
 * where the guide puts it on the consignee only. No QR code is asked for: the label is a PDF.
 */
export function returnBody(request: ReturnBookingRequest, input: { customerNumber: string; applicationId: string; storeCountry: string; now?: Date }) {
  const now = input.now ?? new Date();
  const issuer = issuerCode(input.storeCountry) ?? "Z12";
  const ids = { issuerCode: issuer, partyIdentification: { partyId: input.customerNumber.trim(), partyIdType: "160" } };
  const inNorway = request.from.country.toUpperCase() === "NO";
  const totalGrams = request.parcels.reduce((sum, p) => sum + Math.max(1, p.weightGrams), 0);
  return {
    messageDate: now.toISOString(),
    messageFunction: "Instruction",
    messageId: messageIdOf(request.returnReference, now),
    application: { applicationId: Number(input.applicationId), name: "Kaizena Flow", version: "1.0" },
    updateIndicator: "Original",
    shipment: [
      {
        shipmentIdentification: { shipmentId: "0" },
        dateAndTimes: { loadingDate: now.toISOString() },
        service: { basicServiceCode: request.serviceId || POSTNORD_RETURN_DEFAULT },
        numberOfPackages: { value: request.parcels.length },
        totalGrossWeight: { value: kilos(totalGrams), unit: "KGM" },
        references: [{ referenceNo: request.returnReference.slice(0, 35), referenceType: "CU" }],
        parties: {
          consignor: { ...(inNorway ? {} : ids), party: party(request.from, true) },
          consignee: { ...(inNorway ? ids : {}), party: party(request.to, true) },
        },
        goodsItem: [{ packageTypeCode: "PC", items: request.parcels.map(item) }],
      },
    ],
  };
}

export function returnLabelsUrl(host: string, apiKey: string, locale = "en"): string {
  const query = new URLSearchParams({
    apikey: apiKey,
    paperSize: "LABEL",
    rotate: "0",
    multiPDF: "true",
    pnInfoText: "false",
    labelsPerPage: "100",
    page: "1",
    labelType: "standard",
    processOffline: "false",
    emailQRcode: "false",
    smsQRcode: "false",
    locale,
    storeLabel: "false",
  });
  return `${host}/rest/shipment/v3/returns/edi/labels/pdf?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Pickups (Book Pickups, messageFunction PickupBooking)
// ---------------------------------------------------------------------------

/** The countries PostNord's pickup booking collects from ("Only available pickup from SE, FI and DK"). */
export const PICKUP_COUNTRIES = ["SE", "DK", "FI"];

/**
 * A pickup of the booked parcels at the sender's business address (service 0, add-on p1), in the window they are ready, with the instructions
 * PostNord requires (`freeText` ADS). The times are the sender's local day and times as instants. The message id is the parcel's own, so a
 * retry within 24 hours gets PostNord's first answer back rather than a second pickup.
 */
export function pickupBody(
  request: BookingRequest & { collection: NonNullable<BookingRequest["collection"]> },
  input: { customerNumber: string; applicationId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const zone = COUNTRY_ZONES[request.from.country.toUpperCase()] ?? "Europe/Stockholm";
  const at = (time: string) => toInstant(`${request.collection.date}T${time}`, zone) ?? `${request.collection.date}T${time}:00Z`;
  const totalGrams = request.parcels.reduce((sum, p) => sum + Math.max(1, p.weightGrams), 0);
  return {
    messageDate: now.toISOString(),
    messageFunction: "PickupBooking",
    messageId: `pu${(request.parcelReference ?? request.orderReference).replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 14),
    application: { applicationId: Number(input.applicationId), name: "Kaizena Flow", version: "1.0" },
    updateIndicator: "Original",
    shipment: [
      {
        shipmentIdentification: { shipmentId: "0" },
        dateAndTimes: { earliestPickupDate: at(request.collection.readyTime), latestPickupDate: at(request.collection.closeTime) },
        service: { basicServiceCode: "0", additionalServiceCode: ["p1"] },
        freeText: [{ usageCode: "ADS", text: (request.courierInstructions || `Order ${request.orderReference}`).slice(0, 256) }],
        references: [{ referenceNo: request.orderReference.slice(0, 35), referenceType: "CU" }],
        totalGrossWeight: { value: kilos(totalGrams), unit: "KGM" },
        parties: { consignor: consignor(request.from, input.customerNumber.trim(), issuerCode(request.from.country) ?? "Z12") },
        goodsItem: [{ packageTypeCode: "PC", items: request.parcels.map((p) => ({ itemIdentification: { itemId: "0" }, grossWeight: { value: kilos(p.weightGrams), unit: "KGM" } })) }],
      },
    ],
  };
}

export const pickupsUrl = (host: string, apiKey: string) => `${host}/rest/shipment/v3/pickups?apikey=${encodeURIComponent(apiKey)}`;

/** The pickup PostNord took: its pickup id; null when the answer holds none. */
export function parsePickup(json: unknown): string | null {
  const info = obj(list(obj(json).idInformation)[0]);
  if (text(info.status) && text(info.status).toUpperCase() !== "OK") return null;
  return text(obj(list(info.ids).map(obj).find((i) => text(i.idType) === "pickupId")).value) || null;
}
