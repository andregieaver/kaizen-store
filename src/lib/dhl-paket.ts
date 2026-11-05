import { crossesBorder } from "./duties";
import { splitStreet } from "./porterbuddy";
import type { BookingRequest, PickupPoint, ReturnBookingRequest, TrackingEvent } from "./shipping-carriers";

/**
 * DHL Paket (D459): Deutsche Post DHL's parcels from Germany, for a business customer with an EKP, as pure functions so they are tested without the
 * network. The calls are in `src/server/carriers/dhl-paket.ts`. Written against DHL's own OpenAPI documents on developer.dhl.com, read 2026-11-05:
 * Parcel DE Shipping 2.2.0 (`parcel-de-shipping-v2_4.yaml`), the Authentication API for Post & Parcel Germany (`pp-account-auth-ropc.yaml`),
 * Parcel DE Returns 1.1.0 (`pp-parcel-returns_1.yaml`), Parcel DE Pickup 1.0.3 (`parcel-de-pickup_0.yaml`), Location Finder - Unified 1.14.0 and
 * Shipment Tracking - Unified 1.5.8.
 *
 * A token comes from the store's own developer-portal app (its API key and secret) and its Business Customer Portal (GKP) user and password (the
 * OAuth password grant, which DHL recommends: Basic is deprecated for Shipping). A shipment's billing number is the EKP, the product's procedure and
 * the contract participation (14 characters). There is no price service for contract customers: the store enters its prices for checkout. The
 * label comes as a PDF in the booking's answer and can be fetched again only until the day's end-of-day closing (17:45 by default), so it is
 * handed on to be kept (`labelPdf`).
 */

/** DHL's sandbox and production hosts, chosen by the store's environment. The sandbox works before a store is a DHL business customer. */
export const DHL_PAKET_HOSTS = { live: "https://api-eu.dhl.com", test: "https://api-sandbox.dhl.com" } as const;
export const dhlPaketHost = (environment: string) => (environment === "live" ? DHL_PAKET_HOSTS.live : DHL_PAKET_HOSTS.test);

/** Location Finder - Unified has only a production host; it is asked in both environments. */
export const LOCATION_FINDER = "https://api.dhl.com/location-finder/v1";

export const SHIPPING_PATH = "/parcel/de/shipping/v2";
export const RETURNS_PATH = "/parcel/de/shipping/returns/v1";
export const PICKUP_PATH = "/parcel/de/transportation/pickup/v1";
export const TOKEN_PATH = "/parcel/de/account/auth/ropc/v1/token";

/** The user group profile every GKP user has unless the business customer made others. */
export const DEFAULT_PROFILE = "STANDARD_GRUPPENPROFIL";

/** DHL.de's public tracking page for a shipment number. */
export const dhlPaketTrackingPage = (shipmentNo: string) => `https://www.dhl.de/en/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(shipmentNo)}`;

/**
 * The services a store can offer and book. Each is a DHL product within Germany and another abroad (`products`), so one service covers both:
 * a parcel to the door (DHL Paket, or DHL Paket International), a small parcel (DHL Kleinpaket, or Warenpost International, at most 1 kg), and a
 * parcel to a post office or Paketshop the shopper chooses in Germany (addressed by the shopper's email; a Packstation would need the shopper's
 * DHL Postnummer, which checkout does not ask for, so it is not offered).
 */
export const DHL_PAKET_SERVICES: { id: string; name: string; needsPickupPoint: boolean; maxWeightGrams: number; products: { domestic: string; international: string | null } }[] = [
  { id: "paket", name: "DHL Paket", needsPickupPoint: false, maxWeightGrams: 31_500, products: { domestic: "V01PAK", international: "V53WPAK" } },
  { id: "kleinpaket", name: "DHL Kleinpaket", needsPickupPoint: false, maxWeightGrams: 1_000, products: { domestic: "V62KP", international: "V66WPI" } },
  { id: "filiale", name: "DHL Paket to a post office or Paketshop", needsPickupPoint: true, maxWeightGrams: 31_500, products: { domestic: "V01PAK", international: null } },
];

/** The procedure of each product, digits 11 and 12 of its billing number; 07 is DHL Retoure (return labels). */
export const PROCEDURES: Record<string, string> = { V01PAK: "01", V53WPAK: "53", V54EPAK: "54", V62KP: "62", V62WP: "62", V66WPI: "66", RETOURE: "07" };

/** The product a service is booked as to this country, or null when it does not go there. */
export function productFor(serviceId: string, toCountry: string): string | null {
  const service = DHL_PAKET_SERVICES.find((s) => s.id === serviceId);
  if (!service) return null;
  return toCountry.toUpperCase() === "DE" ? service.products.domestic : service.products.international;
}

/** The 14-character billing number: the EKP (10), the product's procedure (2) and the contract participation (2, `01` unless the store says). */
export function billingNumber(ekp: string, product: string, participation?: string): string | null {
  const procedure = PROCEDURES[product];
  const ownEkp = ekp.replace(/\s+/g, "");
  const part = (participation ?? "").trim() || "01";
  if (!procedure || !/^\w{10}$/.test(ownEkp) || !/^\w{2}$/.test(part)) return null;
  return `${ownEkp}${procedure}${part}`;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** ISO 3166-1 alpha-3, which DHL's shipping API writes countries in: Europe and the countries a German shop most often ships to. */
const ALPHA3: Record<string, string> = {
  AD: "AND", AL: "ALB", AT: "AUT", AU: "AUS", BA: "BIH", BE: "BEL", BG: "BGR", CA: "CAN", CH: "CHE", CN: "CHN", CY: "CYP", CZ: "CZE", DE: "DEU",
  DK: "DNK", EE: "EST", ES: "ESP", FI: "FIN", FO: "FRO", FR: "FRA", GB: "GBR", GI: "GIB", GL: "GRL", GR: "GRC", HK: "HKG", HR: "HRV", HU: "HUN",
  IE: "IRL", IL: "ISR", IS: "ISL", IT: "ITA", JP: "JPN", KR: "KOR", LI: "LIE", LT: "LTU", LU: "LUX", LV: "LVA", MC: "MCO", MD: "MDA", ME: "MNE",
  MK: "MKD", MT: "MLT", NL: "NLD", NO: "NOR", NZ: "NZL", PL: "POL", PT: "PRT", RO: "ROU", RS: "SRB", SE: "SWE", SG: "SGP", SI: "SVN", SK: "SVK",
  SM: "SMR", TR: "TUR", UA: "UKR", US: "USA", VA: "VAT",
};
export const alpha3 = (country: string): string | null => ALPHA3[country.toUpperCase()] ?? null;

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/** The password grant: the app's key and secret with the GKP user and password, form-encoded. */
export function tokenBody(input: { apiKey: string; apiSecret: string; username: string; password: string }): string {
  return new URLSearchParams({ grant_type: "password", username: input.username, password: input.password, client_id: input.apiKey, client_secret: input.apiSecret }).toString();
}

export function parseToken(json: unknown): { token: string; expiresIn: number } | null {
  const body = obj(json);
  const token = text(body.access_token);
  const expiresIn = Number(body.expires_in);
  return token ? { token, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 1800 } : null;
}

// ---------------------------------------------------------------------------
// Post offices and Paketshops
// ---------------------------------------------------------------------------

/** The post offices and Paketshops near an address in Germany where a parcel can be collected. */
export function locationsUrl(near: { postalCode: string; city: string; street?: string }, limit = 10): string {
  const query = new URLSearchParams({ countryCode: "DE", postalCode: near.postalCode.replace(/\s+/g, "") });
  if (near.city) query.set("addressLocality", near.city);
  if (near.street) query.set("streetAddress", near.street);
  query.append("providerType", "parcel");
  query.append("locationType", "postoffice");
  query.append("locationType", "servicepoint");
  query.append("serviceType", "parcel:pick-up");
  query.set("hideClosedLocations", "true");
  query.set("limit", String(limit));
  return `${LOCATION_FINDER}/find-by-address?${query.toString()}`;
}

/**
 * A post office or Paketshop as the shopper's choice keeps it: its number (`keywordId`, the shipment's `retailID`) with its postal code and city,
 * which the shipment names too (`502~53113~Bonn`).
 */
export const outletChoice = (retailId: string, postalCode: string, city: string) => `${retailId}~${postalCode}~${city}`.slice(0, 80);

export function readOutletChoice(id: string): { retailId: number; postalCode: string; city: string } | null {
  const [retail, postalCode, city] = id.split("~");
  return /^\d{1,9}$/.test(retail ?? "") && postalCode && city ? { retailId: Number(retail), postalCode, city } : null;
}

const DAYS: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

/** The outlets of an answer, nearest first; a location without a number (`keywordId`) cannot be addressed and is left out. */
export function parseLocations(json: unknown): PickupPoint[] {
  const points: PickupPoint[] = [];
  for (const raw of list(obj(json).locations)) {
    const l = obj(raw);
    const location = obj(l.location);
    const retailId = text(location.keywordId);
    const address = obj(obj(l.place).address);
    const postalCode = text(address.postalCode);
    const city = text(address.addressLocality);
    if (!/^\d+$/.test(retailId) || !postalCode || !city) continue;
    const id = outletChoice(retailId, postalCode, city);
    if (points.some((p) => p.id === id)) continue;
    const name = text(l.name) || `${text(location.keyword)} ${retailId}`.trim();
    const hours = list(l.openingHours)
      .map(obj)
      .map((h) => {
        const day = DAYS[text(h.dayOfWeek).split("/").pop()?.toLowerCase() ?? ""];
        return day && text(h.opens) && text(h.closes) ? `${day} ${text(h.opens).slice(0, 5)}–${text(h.closes).slice(0, 5)}` : "";
      })
      .filter(Boolean)
      .join(", ");
    const distance = Number(l.distance);
    points.push({
      id,
      name,
      address: { name, street: text(address.streetAddress), postalCode, city, country: text(address.countryCode).toUpperCase() || "DE" },
      ...(hours ? { openingHours: hours } : {}),
      ...(Number.isFinite(distance) && distance >= 0 ? { distanceMeters: Math.round(distance) } : {}),
    });
  }
  return points.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

/** What the store's DHL Paket agreement says on its carrier page. */
export type PaketAccount = { ekp: string; participation?: string; profile?: string };

/** What is missing for DHL to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: BookingRequest, account: PaketAccount): string[] {
  const problems: string[] = [];
  const product = productFor(request.serviceId, request.to.country);
  if (!DHL_PAKET_SERVICES.some((s) => s.id === request.serviceId)) problems.push("Choose a DHL Paket service.");
  else if (!product) problems.push("This DHL service is for parcels within Germany.");
  if (product && !billingNumber(account.ekp, product, account.participation)) problems.push("The EKP is ten characters and the participation two: check them on the carrier's page.");
  if (request.from.country.toUpperCase() !== "DE") problems.push("DHL Paket sends parcels from Germany: the sender's country must be DE.");
  if (!request.from.name || !request.from.street || !request.from.postalCode || !request.from.city) problems.push("Add the sender's name and address on the carrier's page.");
  const to = request.to;
  if (!to.name || !to.postalCode || !to.city || (request.serviceId !== "filiale" && !to.street)) problems.push("The delivery address needs a name, street, postal code and city.");
  if (!alpha3(to.country)) problems.push("DHL Paket does not know the delivery country here.");
  if (request.serviceId === "filiale") {
    if (!request.pickupPointId || !readOutletChoice(request.pickupPointId)) problems.push("The customer's post office or Paketshop is missing.");
    if (!to.email) problems.push("The order has no email for the recipient: DHL needs it to hold a parcel at a post office or Paketshop.");
  }
  const service = DHL_PAKET_SERVICES.find((s) => s.id === request.serviceId);
  if (service && request.parcels.some((p) => p.weightGrams > service.maxWeightGrams)) problems.push(`${service.name} takes at most ${service.maxWeightGrams / 1000} kg.`);
  return problems;
}

/** A reference DHL prints on the label and finds the shipment by: at least 8 characters. */
export const refNo = (reference: string) => (reference.length >= 8 ? reference : `Order ${reference}`).slice(0, 35);

/** Units of a currency as DHL writes an amount (a number), from minor units. */
const major = (minor: number) => Math.round(minor) / 100;

/**
 * The shipment order: the product the service is to the destination, the store's billing number, the sender, the recipient (an address, or the
 * post office or Paketshop the shopper chose, addressed by their email), the weight and size, and for a parcel that crosses a customs border (D343)
 * the customs declaration with each line (value and weight per piece; postal charges 0, as the order's shipping is not part of the request).
 * Within Germany DHL may not be sent the recipient's phone; abroad it is sent with the email, which some countries need for a drop point.
 */
export function orderBody(request: BookingRequest, account: PaketAccount) {
  const product = productFor(request.serviceId, request.to.country)!;
  const domestic = request.to.country.toUpperCase() === "DE";
  const outlet = request.serviceId === "filiale" && request.pickupPointId ? readOutletChoice(request.pickupPointId) : null;
  const parcel = request.parcels[0];
  const customs = request.customs && crossesBorder(request.from.country.toUpperCase(), request.to.country.toUpperCase()) ? request.customs : null;
  const consignee = outlet
    ? { name: request.to.name.slice(0, 50), retailID: outlet.retailId, email: (request.to.email ?? "").slice(0, 80), postalCode: outlet.postalCode, city: outlet.city.slice(0, 80), country: "DEU" }
    : {
        name1: request.to.name.slice(0, 50),
        addressStreet: request.to.street.split(/\n/)[0].slice(0, 50),
        postalCode: request.to.postalCode.trim().slice(0, 10),
        city: request.to.city.slice(0, 40),
        country: alpha3(request.to.country),
        ...(request.to.email ? { email: request.to.email.slice(0, 80) } : {}),
        ...(!domestic && request.to.phone ? { phone: request.to.phone.replace(/[^\d+ ]/g, "").trim().slice(0, 20) } : {}),
      };
  const dims = parcel?.lengthMm && parcel.widthMm && parcel.heightMm ? { dim: { uom: "mm", length: Math.round(parcel.lengthMm), width: Math.round(parcel.widthMm), height: Math.round(parcel.heightMm) } } : {};
  return {
    profile: account.profile?.trim() || DEFAULT_PROFILE,
    shipments: [
      {
        product,
        billingNumber: billingNumber(account.ekp, product, account.participation),
        refNo: refNo(request.parcelReference ?? request.orderReference),
        shipper: {
          name1: request.from.name.slice(0, 50),
          addressStreet: request.from.street.slice(0, 50),
          postalCode: request.from.postalCode.trim().slice(0, 10),
          city: request.from.city.slice(0, 40),
          country: "DEU",
          ...(request.from.email ? { email: request.from.email.slice(0, 80) } : {}),
        },
        consignee,
        details: { weight: { uom: "g", value: Math.max(1, Math.round(parcel?.weightGrams ?? 1)) }, ...dims },
        ...(domestic ? {} : { services: { endorsement: "RETURN", ...(customs?.incoterm === "DDP" ? { postalDeliveryDutyPaid: true } : {}) } }),
        ...(customs
          ? {
              customs: {
                exportType: "COMMERCIAL_GOODS",
                invoiceNo: customs.invoiceNumber.slice(0, 35),
                postalCharges: { currency: customs.currency, value: 0 },
                items: customs.lines.map((line) => {
                  const quantity = Math.max(1, line.quantity);
                  return {
                    itemDescription: line.description.slice(0, 256),
                    packagedQuantity: quantity,
                    hsCode: line.hsCode,
                    ...(alpha3(line.origin) ? { countryOfOrigin: alpha3(line.origin) } : {}),
                    itemValue: { currency: customs.currency, value: major(Math.round(line.valueMinor / quantity)) },
                    itemWeight: { uom: "g", value: Math.max(1, Math.round(line.weightGrams / quantity)) },
                  };
                }),
              },
            }
          : {}),
      },
    ],
  };
}

/** The sample shipment a connection check validates (`validate=true`): from the sender to the sender, nothing booked. */
export function checkBody(from: BookingRequest["from"], account: PaketAccount) {
  return orderBody({ orderReference: "Connection check", serviceId: "paket", from, to: { ...from, name: from.name || "Test" }, parcels: [{ weightGrams: 1000 }] }, account);
}

const isPdf = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

/** A document's PDF from its base64 (`label.b64`), or null. */
export function pdfOf(document: unknown): Uint8Array | null {
  const b64 = text(obj(document).b64);
  if (!b64) return null;
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  return isPdf(bytes) ? bytes : null;
}

/** What DHL said was wrong with a shipment: its validation messages (errors first), else the item's or the answer's detail. */
export function shipmentProblem(json: unknown): string {
  const body = obj(json);
  const item = obj(list(body.items)[0]);
  const messages = list(item.validationMessages)
    .map(obj)
    .sort((a, b) => (text(a.validationState) === "Error" ? -1 : 0) - (text(b.validationState) === "Error" ? -1 : 0))
    .map((m) => [text(m.property), text(m.validationMessage)].filter(Boolean).join(": "))
    .filter(Boolean);
  const detail = text(obj(item.sstatus).detail) || text(obj(body.status).detail) || text(body.detail);
  return (messages.length > 0 ? messages.slice(0, 3).join("; ") : detail).slice(0, 300);
}

export type ParsedOrder = { ok: true; shipmentNo: string; label: Uint8Array | null; warnings: string[] } | { ok: false; problem: string };

/** The shipment made: its number and its label (the answer always holds a list, of one here). A warning is kept: the label is valid anyway. */
export function parseOrder(json: unknown): ParsedOrder {
  const item = obj(list(obj(json).items)[0]);
  const status = Number(obj(item.sstatus).status ?? obj(item.sstatus).statusCode ?? 200);
  const shipmentNo = text(item.shipmentNo);
  if (!shipmentNo || status >= 400) return { ok: false, problem: shipmentProblem(json) || "DHL answered without a shipment number." };
  const warnings = list(item.validationMessages)
    .map(obj)
    .filter((m) => text(m.validationState) !== "Error")
    .map((m) => text(m.validationMessage))
    .filter(Boolean);
  return { ok: true, shipmentNo, label: pdfOf(item.label), warnings };
}

/** Where a shipment's label is fetched again while the day is not yet closed: the shipment's own documents. */
export const labelUrl = (host: string, shipmentNo: string, profile = DEFAULT_PROFILE) =>
  `${host}${SHIPPING_PATH}/orders?shipment=${encodeURIComponent(shipmentNo)}&profile=${encodeURIComponent(profile)}&docFormat=PDF&includeDocs=include`;

/** Only DHL's own hosts are ever sent the store's token. */
export const isDhlPaketUrl = (url: string) => /^https:\/\/api-(eu|sandbox)\.dhl\.com\/parcel\/de\/shipping\/v2\/orders\?/.test(url);

/** Whether a cancellation went through: the shipment's own status in the answer. */
export function parseCancel(json: unknown): { ok: true } | { ok: false; problem: string } {
  const item = obj(list(obj(json).items)[0]);
  const status = Number(obj(item.sstatus).status ?? obj(item.sstatus).statusCode ?? 0);
  return status >= 200 && status < 300 ? { ok: true } : { ok: false, problem: shipmentProblem(json) || "DHL did not cancel the shipment." };
}

// ---------------------------------------------------------------------------
// Return labels (DHL Retoure)
// ---------------------------------------------------------------------------

/** DHL's return service: the returns receiver the store set up in the Business Customer Portal (`deu` for returns from Germany). */
export const DHL_PAKET_RETURN_SERVICES: { id: string; name: string; confirmed: boolean }[] = [{ id: "retoure", name: "DHL Retoure", confirmed: true }];
export const DHL_PAKET_RETURN_DEFAULT = "retoure";

/** What is missing for a return label, in plain words; empty when it can be made. */
export function returnProblems(request: ReturnBookingRequest): string[] {
  const problems: string[] = [];
  if (request.from.country.toUpperCase() !== "DE") problems.push("DHL Retoure labels are for returns sent from Germany.");
  const { streetNumber } = splitStreet(request.from.street);
  if (!request.from.name || !request.from.street || !streetNumber || !request.from.postalCode || !request.from.city) problems.push("The customer's address needs a name, a street with its number, a postal code and a city.");
  return problems;
}

/** A return order: from the customer's address to the store's returns receiver, the return's number as the reference printed on the label. */
export function returnBody(request: ReturnBookingRequest, receiverId: string) {
  const { streetName, streetNumber } = splitStreet(request.from.street);
  return {
    receiverId: receiverId.trim() || "deu",
    customerReference: request.returnReference.slice(0, 50),
    shipmentReference: request.returnReference.slice(0, 50),
    shipper: {
      name1: request.from.name.slice(0, 50),
      addressStreet: streetName.slice(0, 50),
      addressHouse: streetNumber.slice(0, 10),
      postalCode: request.from.postalCode.trim(),
      city: request.from.city.slice(0, 40),
      ...(request.from.email ? { email: request.from.email } : {}),
      ...(request.from.phone ? { phone: request.from.phone.slice(0, 20) } : {}),
    },
    itemWeight: { uom: "g", value: Math.max(1, Math.round(request.parcels[0]?.weightGrams ?? 1000)) },
  };
}

export type ParsedReturn = { ok: true; shipmentNo: string; label: Uint8Array | null } | { ok: false; problem: string };

export function parseReturn(json: unknown): ParsedReturn {
  const body = obj(json);
  const shipmentNo = text(body.shipmentNo);
  if (!shipmentNo) return { ok: false, problem: text(obj(body.sstatus).detail) || text(body.detail) || "DHL answered without a return shipment number." };
  return { ok: true, shipmentNo, label: pdfOf(body.label) };
}

// ---------------------------------------------------------------------------
// Collection (Parcel DE Pickup)
// ---------------------------------------------------------------------------

/**
 * A collection of the booked parcel at the sender's address (a chargeable single collection, "Einzelabholung"): the store's billing number, the
 * address with its house number apart, the window the parcel is ready in, who DHL can call, the day and the parcel's number. DHL takes it until
 * 22:00 the day before, Monday to Friday.
 */
export function pickupBody(input: { billingNumber: string; from: BookingRequest["from"]; collection: NonNullable<BookingRequest["collection"]>; shipmentNo: string; reference: string }) {
  const { streetName, streetNumber } = splitStreet(input.from.street);
  return {
    customerDetails: { billingNumber: input.billingNumber },
    pickupLocation: {
      pickupAddress: { name1: input.from.name.slice(0, 50), addressStreet: streetName.slice(0, 50), addressHouse: streetNumber.slice(0, 10), postalCode: input.from.postalCode.trim(), city: input.from.city.slice(0, 40), country: "DE" },
      businessHours: [{ timeFrom: input.collection.readyTime, timeUntil: input.collection.closeTime }],
    },
    contactPerson: { name: input.from.name.slice(0, 50), phone: (input.from.phone ?? "").slice(0, 50), ...(input.from.email ? { email: input.from.email.slice(0, 250) } : {}) },
    pickupDetails: { pickupDate: { type: "Date", value: input.collection.date } },
    shipmentDetails: { shipments: [{ transportationType: "PAKET", shipmentNo: input.shipmentNo, customerReference: input.reference.slice(0, 20) }] },
  };
}

/** Why a collection cannot be asked for, or null. */
export function pickupProblem(from: BookingRequest["from"], collection: NonNullable<BookingRequest["collection"]>): string | null {
  if (!splitStreet(from.street).streetNumber) return "DHL needs the sender's street with its house number to collect.";
  if (!from.phone) return "Add the sender's phone on the carrier's page: DHL calls it about a collection.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collection.date) || !/^\d{2}:\d{2}$/.test(collection.readyTime) || !/^\d{2}:\d{2}$/.test(collection.closeTime)) return "The collection needs a day and the window the parcel is ready in.";
  return null;
}

/** The collection order's number, or why DHL did not take it. */
export function parsePickup(json: unknown): { ok: true; orderId: string } | { ok: false; problem: string } {
  const value = obj(obj(obj(json).confirmation).value);
  const orderId = text(value.orderID);
  if (orderId) return { ok: true, orderId };
  const first = obj(list(json)[0]);
  return { ok: false, problem: [text(first.title), text(first.detail)].filter(Boolean).join(": ").slice(0, 200) || "DHL did not take the collection." };
}

// ---------------------------------------------------------------------------
// Tracking (Shipment Tracking - Unified)
// ---------------------------------------------------------------------------

export const trackingUrl = (host: string, shipmentNo: string) => `${host}/track/shipments?trackingNumber=${encodeURIComponent(shipmentNo)}&service=parcel-de&language=en`;

/** A shipment's events, newest first: the unified status code (`pre-transit`, `transit`, `delivered`, `failure`, `unknown`) and DHL's words. */
export function parseTracking(json: unknown): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  for (const shipment of list(obj(json).shipments)) {
    for (const raw of list(obj(shipment).events)) {
      const e = obj(raw);
      const at = text(e.timestamp);
      if (!at) continue;
      const place = text(obj(obj(e.location).address).addressLocality);
      events.push({ at, status: text(e.statusCode).toLowerCase(), description: text(e.description) || text(e.status), ...(place ? { location: place } : {}) });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** What to tell the owner when DHL answers with a status that is not a success. */
export function dhlPaketProblem(status: number, json?: unknown): string {
  const said = shipmentProblem(json);
  if (status === 401) return "DHL did not accept the API key and secret or the Business Customer Portal user and password. Check them on this page, and that they are for the right environment (test or live).";
  if (status === 403) return "DHL refused access. Check that your app on DHL's developer portal has the Parcel DE Shipping API, and that your user may use the billing number.";
  if (status === 404) return "DHL did not find that.";
  if (status === 429) return "DHL asked us to slow down. Try again in a moment.";
  if (status >= 500) return "DHL is not answering right now. Try again in a moment.";
  return said ? `DHL did not accept the request: ${said}` : `DHL did not accept the request (${status}).`;
}
