import { minorUnitDigits } from "./money";
import type { BookingRequest, PickupPoint, ShippingAddress, ShippingOption, TrackingEvent } from "./shipping-carriers";

/**
 * DHL Express (D457): what the MyDHL API is sent and how its answers are read, as pure functions so they are tested without the network. The calls
 * are in `src/server/carriers/dhl.ts`. Written against DHL's own OpenAPI document for the MyDHL API 3.4.1 (developer.dhl.com, released 2026-11-01,
 * read 2026-11-05) and its reference data (`ExpressReferenceData_3.4.1`): HTTP Basic with the store's API key and secret, `x-version` on every call,
 * Address Validate (the city of a postal code, which Rates needs), Rates, Shipments (the label comes back in the answer, as a PDF, and only there)
 * and Tracking. DHL Express is the one DHL service a store anywhere in Europe can use with one connection; DHL's parcel networks are per country.
 */

/** DHL's test and production hosts, chosen by the store's environment (the test host books nothing and allows 500 calls a day). */
export const DHL_HOSTS = { live: "https://express.api.dhl.com/mydhlapi", test: "https://express.api.dhl.com/mydhlapi/test" } as const;
export const dhlHost = (environment: string) => (environment === "live" ? DHL_HOSTS.live : DHL_HOSTS.test);

/** The API version every call names (`x-version`, required, "do not change"). */
export const DHL_VERSION = "3.4.1";

/** DHL's public tracking page for a waybill. */
export const dhlTrackingPage = (trackingNumber: string) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(trackingNumber)}`;

/**
 * The services a store can offer and book. DHL names a product per lane (Express Worldwide is `P` for goods through customs, `U` within the EU and
 * `N` within one country), so a service here is a family of DHL's product codes, and the code booked is the one Rates gives for the parcel's lane.
 * `servicepoint` is DHL Express delivered to a DHL ServicePoint the shopper chooses (On Demand Delivery, D458): the same products, priced the same.
 */
export const DHL_SERVICES: { id: string; name: string; needsPickupPoint: boolean; maxWeightGrams?: number; codes: string[] }[] = [
  { id: "express", name: "DHL Express", needsPickupPoint: false, maxWeightGrams: 70_000, codes: ["P", "U", "N"] },
  { id: "servicepoint", name: "DHL Express to a ServicePoint", needsPickupPoint: true, maxWeightGrams: 25_000, codes: ["P", "U", "N"] },
  { id: "express_1200", name: "DHL Express 12:00", needsPickupPoint: false, maxWeightGrams: 70_000, codes: ["Y", "T", "1"] },
  { id: "economy", name: "DHL Economy Select", needsPickupPoint: false, maxWeightGrams: 70_000, codes: ["H", "W"] },
];

/** The store's service a DHL product code belongs to; null for one not offered (documents, 9:00, 10:30). */
export const dhlServiceOf = (productCode: string) => DHL_SERVICES.find((s) => s.codes.includes(productCode)) ?? null;

/** Every service of the store's a DHL product code prices (Express and Express to a ServicePoint share theirs). */
export const dhlServicesOf = (productCode: string) => DHL_SERVICES.filter((s) => s.codes.includes(productCode));

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null);
const digitsOf = (currency: string) => {
  try {
    return minorUnitDigits(currency);
  } catch {
    return 2;
  }
};
const toMinor = (major: number, currency: string) => Math.round(major * 10 ** digitsOf(currency));
const toMajor = (minor: number, currency: string) => minor / 10 ** digitsOf(currency);

/** HTTP Basic with the API key and secret, and the headers every call carries. */
export function dhlHeaders(apiKey: string, apiSecret: string, extra: Record<string, string> = {}, options: { version?: boolean } = {}): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
    Accept: "application/json",
    // Every operation names the version but the ServicePoint search (`GET /servicepoints`), which takes none.
    ...(options.version === false ? {} : { "x-version": DHL_VERSION }),
    "Plugin-Name": "Kaizena Flow",
    ...extra,
  };
}

/** Text as DHL's customs and label fields take it: printable ASCII only (æøå written out), cut to `max`. */
export function asciiText(value: string, max: number): string {
  const spelled = value.replace(/æ/g, "ae").replace(/Æ/g, "AE").replace(/ø/g, "o").replace(/Ø/g, "O").replace(/ß/g, "ss");
  return spelled
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Kilograms as DHL takes them (up to three decimals), at least 0.1. */
export const dhlKilos = (grams: number) => Math.max(0.1, Math.round(grams) / 1000);

/**
 * When the parcel is handed to DHL, as DHL writes it ("2026-11-06T12:00:00 GMT+00:00"): today at 16:00 UTC on a weekday before 14:00 UTC, else the
 * next weekday at noon UTC. DHL refuses a date in the past or more than ten days ahead.
 */
export function plannedShipping(now: Date = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  let hour = 16;
  if (!weekday(day) || now.getUTCHours() >= 14) {
    hour = 12;
    do day.setUTCDate(day.getUTCDate() + 1);
    while (!weekday(day));
  }
  return `${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00 GMT+00:00`;
}

/** The time zone of each European country a sender can ship from, for the GMT offset DHL asks with a local time. */
const ZONES: Record<string, string> = {
  GB: "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon", IS: "Atlantic/Reykjavik",
  FI: "Europe/Helsinki", EE: "Europe/Tallinn", LV: "Europe/Riga", LT: "Europe/Vilnius", BG: "Europe/Sofia", RO: "Europe/Bucharest", GR: "Europe/Athens", CY: "Asia/Nicosia",
};

/** "GMT+01:00": the offset of the sender's country (central European time where not listed) on a local day and time. */
export function gmtOffset(country: string, date: string, time: string): string {
  const zone = ZONES[country.toUpperCase()] ?? "Europe/Berlin";
  const at = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const minutes = Math.round((wall - at.getTime()) / 60000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** A collection's day and window as DHL takes it (D458): HH:MM times, ready before close, the day not before today. Null when it is fine. */
export function collectionProblem(collection: NonNullable<BookingRequest["collection"]>, now: Date = new Date()): string | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collection.date) || !time.test(collection.readyTime) || !time.test(collection.closeTime)) return "Give the collection's day and the times the parcel is ready from and until.";
  if (collection.readyTime >= collection.closeTime) return "The parcel must be ready before the time the collection closes.";
  if (collection.date < now.toISOString().slice(0, 10)) return "The collection's day has passed.";
  return null;
}

// ---------------------------------------------------------------------------
// Address Validate: the city of a postal code
// ---------------------------------------------------------------------------

export const addressValidateUrl = (host: string, country: string, postalCode: string) =>
  `${host}/address-validate?type=delivery&countryCode=${encodeURIComponent(country.toUpperCase())}&postalCode=${encodeURIComponent(postalCode.replace(/\s+/g, ""))}&strictValidation=false`;

/** The city DHL knows for the postal code; null when it gave none. */
export const parseCity = (json: unknown): string | null => text(obj(list(obj(json).address)[0]).cityName) || null;

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const ratesAddress = (a: Pick<ShippingAddress, "postalCode" | "city" | "country">) => ({
  postalCode: a.postalCode.replace(/\s+/g, "").slice(0, 12),
  cityName: asciiText(a.city, 45) || a.city.slice(0, 45),
  countryCode: a.country.toUpperCase(),
});

const dhlPackage = (p: BookingRequest["parcels"][number]) => {
  const cm = (mm: number | undefined) => (mm ? Math.max(1, Math.ceil(mm / 10)) : null);
  const [length, width, height] = [cm(p.lengthMm), cm(p.widthMm), cm(p.heightMm)];
  return { weight: dhlKilos(p.weightGrams), ...(length && width && height ? { dimensions: { length, width, height } } : {}) };
};

/** Every product DHL has for this parcel on this lane, with the store's own prices (its account), in metric units. */
export function ratesBody(input: { accountNumber: string; from: ShippingAddress; to: ShippingAddress; parcels: BookingRequest["parcels"]; declarable: boolean; now?: Date }) {
  return {
    customerDetails: { shipperDetails: ratesAddress(input.from), receiverDetails: ratesAddress(input.to) },
    accounts: [{ typeCode: "shipper", number: input.accountNumber }],
    plannedShippingDateAndTime: plannedShipping(input.now),
    unitOfMeasurement: "metric",
    isCustomsDeclarable: input.declarable,
    packages: input.parcels.map(dhlPackage),
  };
}

/** A product DHL offered: its own code, and the store's service it is. */
export type DhlProduct = ShippingOption & { productCode: string };

/**
 * The price of each product, in the account's billing currency (`BILLC`) without the tax DHL put on it (`STTXA`, "total tax for the shipment"),
 * with the transit days. A product of no service here (documents, 9:00) is left out; of two products of one service, the cheaper is kept.
 */
export function parseRates(json: unknown): DhlProduct[] {
  const best = new Map<string, DhlProduct>();
  for (const raw of list(obj(json).products)) {
    const product = obj(raw);
    const code = text(product.productCode);
    const services = dhlServicesOf(code);
    if (services.length === 0) continue;
    const billed = list(product.totalPrice).map(obj).find((p) => text(p.currencyType) === "BILLC");
    const currency = text(billed?.priceCurrency).toUpperCase();
    const gross = num(billed?.price);
    if (!billed || !/^[A-Z]{3}$/.test(currency) || gross === null || gross < 0) continue;
    const breakdown = list(list(product.totalPriceBreakdown).map(obj).find((b) => text(b.currencyType) === "BILLC")?.priceBreakdown).map(obj);
    const tax = num(breakdown.find((b) => text(b.typeCode) === "STTXA")?.price) ?? 0;
    const days = num(obj(product.deliveryCapabilities).totalTransitDays);
    for (const service of services) {
      const option: DhlProduct = {
        serviceId: service.id,
        carrier: "dhl",
        name: service.name,
        priceMinor: toMinor(Math.max(0, gross - Math.max(0, tax)), currency),
        currency,
        productCode: code,
        ...(service.needsPickupPoint ? { needsPickupPoint: true } : {}),
        ...(days !== null && days >= 0 ? { estimate: { minDays: Math.round(days), maxDays: Math.round(days) } } : {}),
      };
      const kept = best.get(service.id);
      if (!kept || option.priceMinor < kept.priceMinor) best.set(service.id, option);
    }
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

/** What is missing for DHL to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: BookingRequest, accountNumber: string): string[] {
  const problems: string[] = [];
  if (!/^\d{9,10}$/.test(accountNumber)) problems.push("The DHL Express account number is nine digits: check it on the carrier's page.");
  if (!DHL_SERVICES.some((s) => s.id === request.serviceId)) problems.push("Choose a DHL service.");
  if (request.serviceId === "servicepoint" && !/^[A-Z0-9]{6}$/.test(request.pickupPointId ?? "")) problems.push("The customer's DHL ServicePoint is missing.");
  if (request.collection) {
    const wrong = collectionProblem(request.collection);
    if (wrong) problems.push(wrong);
  }
  const { from, to } = request;
  if (!to.name || !to.street || !to.postalCode || !to.city) problems.push("The delivery address needs a name, street, postal code and city.");
  if (!to.phone) problems.push("The order has no phone number for the recipient, which DHL Express needs.");
  if (!from.name || !from.street || !from.postalCode || !from.city || !from.phone) problems.push("Add the sender's name, address and phone on the carrier's page.");
  return problems;
}

const party = (a: ShippingAddress) => {
  const [line1, line2] = a.street
    .split(/\n|,\s*/)
    .map((l) => asciiText(l, 45))
    .filter(Boolean);
  return {
    postalAddress: {
      postalCode: a.postalCode.replace(/\s+/g, "").slice(0, 12),
      cityName: asciiText(a.city, 45),
      countryCode: a.country.toUpperCase(),
      addressLine1: line1 ?? asciiText(a.street, 45),
      ...(line2 ? { addressLine2: line2 } : {}),
    },
    contactInformation: {
      phone: (a.phone ?? "").replace(/[^\d+ ]/g, "").trim().slice(0, 70),
      companyName: asciiText(a.name, 100),
      fullName: asciiText(a.name, 255),
      ...(a.email ? { email: a.email.slice(0, 70) } : {}),
    },
  };
};

/**
 * The shipment, for the product code Rates gave this lane: the store's account, a PDF label, the order number as the reference, and for a parcel
 * that crosses a customs border (D343) its value and export declaration with each line (DDP when the shopper paid the duties at checkout, else DAP).
 * No collection is asked for unless the request has one (D458): then DHL is asked to collect it on that day, from the ready time (in the sender's
 * own time zone) until the close time. A ServicePoint delivery is On Demand Delivery to the point the shopper chose, which DHL takes only with the
 * buyer's details (the shopper).
 */
export function shipmentBody(request: BookingRequest, input: { accountNumber: string; productCode: string; declarable: boolean; now?: Date }) {
  const customs = request.customs;
  const declared = input.declarable && customs;
  const total = declared ? customs.lines.reduce((sum, line) => sum + line.valueMinor, 0) : 0;
  const description = asciiText(customs?.lines.map((l) => l.description).join(", ") || "Goods", 70) || "Goods";
  const collection = request.collection;
  const servicePoint = request.serviceId === "servicepoint" && request.pickupPointId ? request.pickupPointId : null;
  return {
    plannedShippingDateAndTime: collection
      ? `${collection.date}T${collection.readyTime}:00 ${gmtOffset(request.from.country, collection.date, collection.readyTime)}`
      : plannedShipping(input.now),
    pickup: collection ? { isRequested: true, closeTime: collection.closeTime } : { isRequested: false },
    productCode: input.productCode,
    accounts: [{ typeCode: "shipper", number: input.accountNumber }],
    customerReferences: [{ value: request.orderReference.slice(0, 35), typeCode: "CU" }],
    outputImageProperties: { encodingFormat: "pdf", imageOptions: [{ typeCode: "label", templateName: "ECOM26_84_001" }] },
    customerDetails: {
      shipperDetails: party(request.from),
      receiverDetails: party(request.to),
      ...(servicePoint ? { buyerDetails: party(request.to) } : {}),
    },
    ...(servicePoint ? { onDemandDelivery: { deliveryOption: "servicepoint", servicePointId: servicePoint } } : {}),
    content: {
      packages: request.parcels.map(dhlPackage),
      isCustomsDeclarable: input.declarable,
      description,
      incoterm: customs?.incoterm ?? "DAP",
      unitOfMeasurement: "metric",
      ...(declared
        ? {
            declaredValue: toMajor(total, customs.currency),
            declaredValueCurrency: customs.currency,
            exportDeclarations: [{
              lineItems: customs.lines.map((line, i) => ({
                number: i + 1,
                description: asciiText(line.description, 512) || "Goods",
                price: toMajor(Math.round(line.valueMinor / Math.max(1, line.quantity)), customs.currency),
                quantity: { value: line.quantity, unitOfMeasurement: "PCS" },
                commodityCodes: [{ typeCode: "outbound", value: line.hsCode }],
                manufacturerCountry: line.origin,
                weight: { netValue: dhlKilos(line.weightGrams), grossValue: dhlKilos(line.weightGrams) },
              })),
              invoice: { number: asciiText(customs.invoiceNumber, 35), date: customs.invoiceDate },
              exportReason: "Sale",
              exportReasonType: "commercial_purpose_or_sale",
              incoterm: customs.incoterm,
            }],
          }
        : {}),
    },
  };
}

export type ParsedShipment = { ok: true; trackingNumber: string; label: Uint8Array | null; dispatchConfirmation: string | null } | { ok: false; problem: string };

/** The shipment made: its waybill number, the label DHL put in the answer (a PDF), which DHL gives only here, and a collection's confirmation. */
export function parseShipment(json: unknown): ParsedShipment {
  const body = obj(json);
  const trackingNumber = text(body.shipmentTrackingNumber);
  if (!trackingNumber) return { ok: false, problem: "DHL answered without a waybill number." };
  const dispatchConfirmation = text(body.dispatchConfirmationNumber) || null;
  const document = list(body.documents)
    .map(obj)
    .find((d) => text(d.typeCode) === "label" && text(d.imageFormat).toUpperCase() === "PDF");
  const content = text(document?.content);
  const bytes = content ? Uint8Array.from(Buffer.from(content, "base64")) : null;
  const pdf = bytes && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? bytes : null;
  return { ok: true, trackingNumber, label: pdf, dispatchConfirmation };
}

// ---------------------------------------------------------------------------
// DHL ServicePoints (the Global Service Point Locator, `GET /servicepoints`)
// ---------------------------------------------------------------------------

/** The ServicePoints nearest an address (its postal code and city, as checkout knows it), in kilometres, in English. */
export function servicePointsUrl(host: string, near: Pick<ShippingAddress, "street" | "postalCode" | "city" | "country">, count = 10) {
  const address = [near.street, `${near.postalCode} ${near.city}`.trim()].filter(Boolean).join(", ");
  const query = new URLSearchParams({ address, countryCode: near.country.toUpperCase(), servicePointResults: String(count), resultUom: "km", language: "eng" });
  return `${host}/servicepoints?${query.toString()}`;
}

const DAY_NAMES: Record<string, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun" };
/** Minutes after midnight (600) as "10:00". */
const clock = (minutes: unknown) => {
  const n = num(minutes);
  return n === null || n < 0 || n > 1440 ? "" : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.round(n % 60)).padStart(2, "0")}`;
};

/**
 * The ServicePoints of an answer that hand parcels to the people they are for (`shipmentCollection`), nearest first, by their six-character id
 * (`facilityId`, the id a shipment's `onDemandDelivery.servicePointId` takes). None when DHL found none (status 201).
 */
export function parseServicePoints(json: unknown): PickupPoint[] {
  const body = obj(json);
  if (num(obj(body.status).statusCode) !== 1) return [];
  const points: PickupPoint[] = [];
  for (const raw of list(body.servicePoints)) {
    const p = obj(raw);
    const id = text(p.facilityId).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(id) || points.some((x) => x.id === id)) continue;
    if (obj(p.servicePointCapabilities).shipmentCollection === false) continue;
    const a = obj(p.address);
    const name = text(p.localName) || text(p.servicePointNameFormatted) || text(p.servicePointName) || id;
    const km = num(p.distanceMetric) ?? num(p.distanceValue);
    const hours = list(obj(p.openingHours).openingHours)
      .map(obj)
      .filter((h) => DAY_NAMES[text(h.dayOfWeek).toUpperCase()] && clock(h.openingTime) && clock(h.closingTime))
      .map((h) => `${DAY_NAMES[text(h.dayOfWeek).toUpperCase()]} ${clock(h.openingTime)}–${clock(h.closingTime)}`)
      .join(", ");
    points.push({
      id,
      name,
      address: {
        name,
        street: [text(a.addressLine1), text(a.addressLine2)].filter(Boolean).join(", "),
        postalCode: text(a.zipCode),
        city: text(a.city),
        country: text(a.country).toUpperCase(),
      },
      ...(hours ? { openingHours: hours } : {}),
      ...(km !== null && km >= 0 ? { distanceMeters: Math.round(km * 1000) } : {}),
    });
  }
  return points.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
}

/** Where a shipment is at DHL (`/shipments/{waybill}`): what the shipment's `label_url` says; the label itself is kept in `carrier_labels`. */
export const shipmentUrl = (host: string, trackingNumber: string) => `${host}/shipments/${encodeURIComponent(trackingNumber)}`;

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export const trackingUrl = (host: string, trackingNumber: string) =>
  `${host}/shipments/${encodeURIComponent(trackingNumber)}/tracking?trackingView=all-checkpoints&levelOfDetail=shipment&requestGMTOffsetPerEvent=true`;

/** A waybill's events, newest first: DHL's event code (`typeCode`), its description and the service area it happened in. */
export function parseTracking(json: unknown): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  for (const shipment of list(obj(json).shipments)) {
    for (const raw of list(obj(shipment).events)) {
      const e = obj(raw);
      const date = text(e.date);
      const time = text(e.time) || "00:00:00";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) continue;
      const offset = text(e.GMTOffset);
      const at = `${date}T${time.length === 5 ? `${time}:00` : time}${/^[+-]\d{2}:\d{2}$/.test(offset) ? offset : ""}`;
      const area = text(obj(list(e.serviceArea)[0]).description);
      events.push({ at, status: text(e.typeCode).toUpperCase(), description: text(e.description), ...(area ? { location: area } : {}) });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** What DHL said was wrong (`detail`, then the first of `additionalDetails`), cut short. */
export function dhlError(json: unknown): string {
  const body = obj(json);
  const extra = text(list(body.additionalDetails)[0]);
  return [text(body.detail), extra].filter(Boolean).join(" ").slice(0, 300);
}

/** What to tell the owner when DHL answers with a status that is not a success. */
export function dhlProblem(status: number, json?: unknown): string {
  const said = dhlError(json);
  if (status === 401) return "DHL did not accept the API key and secret. Check them on this page, and that they are for the right environment (test or live).";
  if (status === 403) return "DHL refused access for these credentials. Ask your DHL Express contact to enable the MyDHL API for your account.";
  if (status === 404) return "DHL did not find that.";
  if (status === 429) return "DHL asked us to slow down (the test environment allows 500 calls a day). Try again later.";
  if (status >= 500) return "DHL is not answering right now. Try again in a moment.";
  return said ? `DHL did not accept the request: ${said}` : `DHL did not accept the request (${status}).`;
}
