import { amountToMinor } from "./bring";
import { minorUnitDigits } from "./money";
import type { BookingRequest, CustomsLine, PickupPoint, ShippingAddress, ShippingOption, TrackingEvent } from "./shipping-carriers";

/**
 * UPS (D457): what UPS's APIs are sent and how their answers are read, as pure functions so they are tested without the network. The calls are in
 * `src/server/carriers/ups.ts`. Written against UPS's own OpenAPI documents (github.com/UPS-API/api-documentation, read 2026-11-05:
 * `OAuthClientCredentials.yaml`, `Rating.yaml`, `Shipping.yaml`, `Tracking.yaml`, `Locator.yaml`): a bearer token from the store's client id and
 * secret, Rating (`Shop`, every service at once, with the store's negotiated rates when its account has them), the Locator for UPS Access Points,
 * Shipping and Tracking. Every amount, weight and size is a string there; an object that holds one item may come as the item instead of a list.
 *
 * The label: Shipping gives it only as a GIF inside its answer, so it is not kept; Label Recovery gives the same label again as a PDF from the
 * tracking number, when it is printed (`labelUrl()`), as the other carriers' labels are fetched.
 */

/** UPS's customer integration environment (test) and production, chosen by the store's environment. */
export const UPS_HOSTS = { live: "https://onlinetools.ups.com", test: "https://wwwcie.ups.com" } as const;
export const upsHost = (environment: string) => (environment === "live" ? UPS_HOSTS.live : UPS_HOSTS.test);

/** The API versions written against (Rating and Shipping v2409: lists are always lists; Label Recovery v1). */
export const UPS_VERSIONS = { rating: "v2409", shipping: "v2409", labels: "v1", locator: "v3" } as const;

/** UPS's public tracking page for a parcel (no UPS document gives it; it answers for any 1Z number). */
export const upsTrackingPage = (trackingNumber: string) => `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`;

/**
 * The services a store can offer at checkout and book, by UPS's service codes (Rating.yaml `Service.Code`): Standard by road within Europe, Express
 * Saver and Express by air, and Standard held at a UPS Access Point the shopper chooses (`AP`: booked as Standard with `ShipmentIndicationType` 01).
 */
export const UPS_SERVICES: { id: string; name: string; needsPickupPoint: boolean; maxWeightGrams?: number }[] = [
  { id: "11", name: "UPS Standard", needsPickupPoint: false, maxWeightGrams: 70_000 },
  { id: "AP", name: "UPS Standard to a UPS Access Point", needsPickupPoint: true, maxWeightGrams: 20_000 },
  { id: "65", name: "UPS Express Saver", needsPickupPoint: false, maxWeightGrams: 70_000 },
  { id: "07", name: "UPS Express", needsPickupPoint: false, maxWeightGrams: 70_000 },
];

/** The UPS service code a store's service is booked and priced as. */
export const upsServiceCode = (serviceId: string) => (serviceId === "AP" ? "11" : serviceId);

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
/** A list, or the one item UPS wrote without its list. */
const many = (value: unknown): unknown[] => (Array.isArray(value) ? value : value && typeof value === "object" ? [value] : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const digitsOf = (currency: string) => {
  try {
    return minorUnitDigits(currency);
  } catch {
    return 2;
  }
};
/** Minor units as UPS writes an amount: "149.50". */
export const upsAmount = (minor: number, currency: string) => {
  const digits = digitsOf(currency);
  return digits === 0 ? String(minor) : (minor / 10 ** digits).toFixed(digits);
};

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export const tokenUrl = (host: string) => `${host}/security/v1/oauth/token`;

/** HTTP Basic with the client id and secret (`client_secret_basic`). */
export const basicAuth = (clientId: string, clientSecret: string) => `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

/** The bearer token and how long it lasts, in seconds (UPS writes `expires_in` as a string); null when the answer is not one. */
export function parseToken(json: unknown): { token: string; expiresIn: number } | null {
  const body = obj(json);
  const token = text(body.access_token);
  const expiresIn = Number(text(body.expires_in));
  return token ? { token, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600 } : null;
}

// ---------------------------------------------------------------------------
// Addresses and parcels
// ---------------------------------------------------------------------------

/** UPS's address: up to three lines of 35 characters, the city, the postal code and the country. */
export function upsAddress(a: Pick<ShippingAddress, "street" | "postalCode" | "city" | "country">) {
  const lines = a.street
    .split(/\n|,\s*/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(0, 35))
    .slice(0, 3);
  return {
    ...(lines.length > 0 ? { AddressLine: lines } : {}),
    ...(a.city ? { City: a.city.slice(0, 30) } : {}),
    PostalCode: a.postalCode.replace(/\s+/g, "").slice(0, 9),
    CountryCode: a.country.toUpperCase(),
  };
}

/** A phone number as UPS takes it: digits (and a leading +), at most 15. */
const phoneOf = (phone: string | undefined) => (phone ?? "").replace(/[^\d+]/g, "").slice(0, 15);

/** Kilograms as UPS writes them: one decimal, at least 0.1. */
export const upsKilos = (grams: number) => Math.max(0.1, Math.ceil(grams / 100) / 10).toFixed(1);

function upsPackage(parcel: BookingRequest["parcels"][number], packagingKey: "PackagingType" | "Packaging") {
  const cm = (mm: number | undefined) => (mm ? String(Math.min(270, Math.max(1, Math.ceil(mm / 10)))) : null);
  const [length, width, height] = [cm(parcel.lengthMm), cm(parcel.widthMm), cm(parcel.heightMm)];
  return {
    // 02: the customer's own package.
    [packagingKey]: { Code: "02", Description: "Package" },
    ...(length && width && height ? { Dimensions: { UnitOfMeasurement: { Code: "CM", Description: "cm" }, Length: length, Width: width, Height: height } } : {}),
    PackageWeight: { UnitOfMeasurement: { Code: "KGS", Description: "kg" }, Weight: upsKilos(parcel.weightGrams) },
  };
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

export const ratingUrl = (host: string) => `${host}/api/rating/${UPS_VERSIONS.rating}/Shop`;

/** Every service UPS has for this parcel (`Shop`), with the account's negotiated rates when it has them. */
export function rateBody(input: { accountNumber: string; from: ShippingAddress; to: ShippingAddress; parcels: BookingRequest["parcels"] }) {
  return {
    RateRequest: {
      Request: { SubVersion: "2409", TransactionReference: { CustomerContext: "Kaizena Flow rates" } },
      Shipment: {
        Shipper: { Name: (input.from.name || "Shipper").slice(0, 35), ShipperNumber: input.accountNumber, Address: upsAddress(input.from) },
        ShipTo: { Name: (input.to.name || "Recipient").slice(0, 35), Address: { ...upsAddress(input.to), ResidentialAddressIndicator: "" } },
        ShipFrom: { Name: (input.from.name || "Shipper").slice(0, 35), Address: upsAddress(input.from) },
        PaymentDetails: { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: input.accountNumber } }] },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: "" },
        Package: input.parcels.map((p) => upsPackage(p, "PackagingType")),
      },
    },
  };
}

/** The price of each service: the negotiated total when UPS gave one, else the published total, without VAT, in the account's currency. */
export function parseRates(json: unknown): ShippingOption[] {
  const options: ShippingOption[] = [];
  for (const raw of many(obj(obj(json).RateResponse).RatedShipment)) {
    const rated = obj(raw);
    const code = text(obj(rated.Service).Code);
    const negotiated = obj(obj(rated.NegotiatedRateCharges).TotalCharge);
    const charge = text(negotiated.MonetaryValue) ? negotiated : obj(rated.TotalCharges);
    const currency = text(charge.CurrencyCode).toUpperCase();
    const minor = amountToMinor(text(charge.MonetaryValue), digitsOf(currency));
    if (!code || !/^[A-Z]{3}$/.test(currency) || minor === null || minor < 0) continue;
    const days = Number(text(obj(rated.GuaranteedDelivery).BusinessDaysInTransit));
    const estimate = Number.isInteger(days) && days > 0 ? { estimate: { minDays: days, maxDays: days } } : {};
    for (const service of UPS_SERVICES.filter((s) => upsServiceCode(s.id) === code)) {
      options.push({ serviceId: service.id, carrier: "ups", name: service.name, priceMinor: minor, currency, needsPickupPoint: service.needsPickupPoint, ...estimate });
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// UPS Access Points
// ---------------------------------------------------------------------------

export const locatorUrl = (host: string) => `${host}/api/locations/${UPS_VERSIONS.locator}/search/availabilities/64`;

/** The active UPS Access Points near an address (search option 64), nearest first, in kilometres. */
export function locatorBody(near: Pick<ShippingAddress, "street" | "postalCode" | "city" | "country">, count = 10) {
  return {
    LocatorRequest: {
      Request: { RequestAction: "Locator", TransactionReference: { CustomerContext: "Kaizena Flow access points" } },
      OriginAddress: {
        AddressKeyFormat: {
          AddressLine: near.street || "",
          PoliticalDivision2: near.city || "",
          PoliticalDivision1: "",
          PostcodePrimaryLow: near.postalCode.replace(/\s+/g, ""),
          CountryCode: near.country.toUpperCase(),
        },
      },
      Translate: { Locale: "en_GB" },
      UnitOfMeasurement: { Code: "KM" },
      LocationSearchCriteria: { MaximumListSize: String(count), SearchRadius: "25", AccessPointSearch: { AccessPointStatus: "01" } },
    },
  };
}

const DAYS = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (value: string) => (/^\d{1,4}$/.test(value) ? value.padStart(4, "0").replace(/^(\d{2})(\d{2})$/, "$1:$2") : "");

/** The access points of a Locator answer, by their public id (the one a shipment names; `LocationID` is UPS's own and not shown). */
export function parseAccessPoints(json: unknown): PickupPoint[] {
  const points: PickupPoint[] = [];
  for (const raw of many(obj(obj(obj(json).LocatorResponse).SearchResults).DropLocation)) {
    const location = obj(raw);
    const info = obj(location.AccessPointInformation);
    const id = text(info.PublicAccessPointID);
    if (!id || points.some((p) => p.id === id)) continue;
    const a = obj(location.AddressKeyFormat);
    const lines = Array.isArray(a.AddressLine) ? a.AddressLine.map(text) : [text(a.AddressLine)];
    const name = text(a.ConsigneeName) || id;
    const distance = obj(location.Distance);
    const value = Number(text(distance.Value));
    const unit = text(obj(distance.UnitOfMeasurement).Code).toUpperCase();
    const meters = Number.isFinite(value) && value >= 0 ? Math.round(value * (unit === "MI" ? 1609.344 : 1000)) : null;
    const regular = many(obj(location.OperatingHours).StandardHours).map(obj).find((h) => text(h.HoursType) === "10");
    const hours = regular
      ? many(regular.DayOfWeek)
          .map(obj)
          .filter((d) => DAYS[Number(text(d.Day))] && (d.Open24HoursIndicator !== undefined || (hhmm(text(d.OpenHours)) && hhmm(text(d.CloseHours)))))
          .map((d) => `${DAYS[Number(text(d.Day))]} ${d.Open24HoursIndicator !== undefined ? "00:00–24:00" : `${hhmm(text(d.OpenHours))}–${hhmm(text(d.CloseHours)) === "00:00" ? "24:00" : hhmm(text(d.CloseHours))}`}`)
          .join(", ")
      : text(location.StandardHoursOfOperation);
    points.push({
      id,
      name,
      address: {
        name,
        street: lines.filter(Boolean).join(", "),
        postalCode: text(a.PostcodePrimaryLow),
        city: text(a.PoliticalDivision2),
        country: text(a.CountryCode).toUpperCase(),
      },
      ...(hours ? { openingHours: hours } : {}),
      ...(meters !== null ? { distanceMeters: meters } : {}),
    });
  }
  return points.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export const shipUrl = (host: string) => `${host}/api/shipments/${UPS_VERSIONS.shipping}/ship`;

/** What is missing for UPS to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: BookingRequest, accountNumber: string): string[] {
  const problems: string[] = [];
  if (!/^[A-Z0-9]{6}$/i.test(accountNumber)) problems.push("The UPS account number is six letters and digits: check it on the carrier's page.");
  if (!UPS_SERVICES.some((s) => s.id === request.serviceId)) problems.push("Choose a UPS service.");
  if (request.serviceId === "AP" && !request.pickupPointId) problems.push("The customer's UPS Access Point is missing.");
  const { from, to } = request;
  if (!to.name || !to.street || !to.postalCode || !to.city) problems.push("The delivery address needs a name, street, postal code and city.");
  if (!from.name || !from.street || !from.postalCode || !from.city || !from.phone) problems.push("Add the sender's name, address and phone on the carrier's page.");
  // Across a border UPS asks for the recipient's phone (Shipping.yaml `ShipTo.Phone`).
  if (from.country !== to.country && !to.phone) problems.push("The order has no phone number for the recipient, which UPS needs for a parcel to another country.");
  return problems;
}

/** One line of UPS's commercial invoice (`InternationalForms.Product`): what it is, how many, what each is worth, its code and origin. */
function invoiceProduct(line: CustomsLine, currency: string) {
  const each = Math.round(line.valueMinor / Math.max(1, line.quantity));
  return {
    Description: [line.description.slice(0, 35)],
    Unit: { Number: String(line.quantity), Value: upsAmount(each, currency), UnitOfMeasurement: { Code: "PCS", Description: "Pieces" } },
    CommodityCode: line.hsCode,
    OriginCountryCode: line.origin,
    ProductWeight: { UnitOfMeasurement: { Code: "KGS", Description: "kg" }, Weight: upsKilos(line.weightGrams) },
  };
}

const party = (a: ShippingAddress, extra: Obj = {}) => ({
  Name: a.name.slice(0, 35),
  AttentionName: a.name.slice(0, 35),
  ...(phoneOf(a.phone) ? { Phone: { Number: phoneOf(a.phone) } } : {}),
  ...(a.email ? { EMailAddress: a.email.slice(0, 50) } : {}),
  Address: upsAddress(a),
  ...extra,
});

/**
 * The shipment: the store's account billed, the service, one package per parcel, the order number as the reference, a GIF label (the only image the
 * Shipping API makes; Label Recovery makes the PDF), and for a parcel that crosses a customs border (D343) a paperless commercial invoice with each
 * line, the duties billed to the store when it collected them at checkout (DDP). An Access Point delivery names the point the shopper chose.
 */
export function shipBody(request: BookingRequest, accountNumber: string, accessPoint?: PickupPoint | null) {
  const customs = request.customs;
  const crossing = request.from.country !== request.to.country;
  const description = (customs?.lines.map((l) => l.description).join(", ") || "Goods").slice(0, 50);
  const ap = request.serviceId === "AP" && request.pickupPointId;
  return {
    ShipmentRequest: {
      Request: { RequestOption: "nonvalidate", SubVersion: "2409", TransactionReference: { CustomerContext: request.orderReference.slice(0, 512) } },
      Shipment: {
        ...(crossing ? { Description: description } : {}),
        Shipper: party(request.from, { ShipperNumber: accountNumber }),
        ShipFrom: party(request.from),
        ShipTo: party(request.to),
        ...(ap
          ? {
              AlternateDeliveryAddress: {
                Name: (accessPoint?.name || request.to.name).slice(0, 35),
                AttentionName: request.to.name.slice(0, 35),
                UPSAccessPointID: request.pickupPointId,
                Address: upsAddress(accessPoint?.address ?? request.to),
              },
              ShipmentIndicationType: [{ Code: "01" }],
            }
          : {}),
        PaymentInformation: {
          ShipmentCharge: [
            { Type: "01", BillShipper: { AccountNumber: accountNumber } },
            // Duties and taxes billed to the store, when the shopper paid them at checkout (DDP).
            ...(customs?.incoterm === "DDP" ? [{ Type: "02", BillShipper: { AccountNumber: accountNumber } }] : []),
          ],
        },
        ReferenceNumber: [{ Value: request.orderReference.slice(0, 35) }],
        Service: { Code: upsServiceCode(request.serviceId) },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: "" },
        Package: request.parcels.map((p) => upsPackage(p, "Packaging")),
        ShipmentServiceOptions: {
          // The recipient is told by email where the parcel can be collected (UPS's Access Point example sends it).
          ...(ap && request.to.email ? { Notification: [{ NotificationCode: "012", EMail: { EMailAddress: [request.to.email] }, Locale: { Language: "ENG", Dialect: "GB" } }] } : {}),
          ...(customs && crossing
            ? {
                InternationalForms: {
                  FormType: ["01"],
                  InvoiceNumber: customs.invoiceNumber.slice(0, 35),
                  InvoiceDate: customs.invoiceDate.replace(/-/g, ""),
                  ReasonForExport: "SALE",
                  CurrencyCode: customs.currency,
                  TermsOfShipment: customs.incoterm,
                  Product: customs.lines.map((line) => invoiceProduct(line, customs.currency)),
                },
              }
            : {}),
        },
      },
      LabelSpecification: { LabelImageFormat: { Code: "GIF" }, HTTPUserAgent: "Mozilla/4.5" },
    },
  };
}

export type ParsedShipment = { ok: true; shipmentNumber: string; trackingNumber: string; price: { amountMinor: number; currency: string } | null } | { ok: false; problem: string };

/** The shipment made: its number and the first package's tracking number (a 1Z number), and what UPS charged for it. */
export function parseShipment(json: unknown): ParsedShipment {
  const results = obj(obj(obj(json).ShipmentResponse).ShipmentResults);
  const shipmentNumber = text(results.ShipmentIdentificationNumber);
  const trackingNumber = text(obj(many(results.PackageResults)[0]).TrackingNumber) || shipmentNumber;
  if (!trackingNumber) return { ok: false, problem: "UPS answered without a tracking number." };
  const negotiated = obj(obj(results.NegotiatedRateCharges).TotalCharge);
  const charge = text(negotiated.MonetaryValue) ? negotiated : obj(obj(results.ShipmentCharges).TotalCharges);
  const currency = text(charge.CurrencyCode).toUpperCase();
  const minor = /^[A-Z]{3}$/.test(currency) ? amountToMinor(text(charge.MonetaryValue), digitsOf(currency)) : null;
  return { ok: true, shipmentNumber: shipmentNumber || trackingNumber, trackingNumber, price: minor !== null && minor >= 0 ? { amountMinor: minor, currency } : null };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Where a shipment's label is fetched again: Label Recovery on the store's own environment, with the tracking number after `#` (the request is a
 * POST with the number in its body; the address only says which host and number).
 */
export const labelUrl = (host: string, trackingNumber: string) => `${host}/api/labels/${UPS_VERSIONS.labels}/recovery#${encodeURIComponent(trackingNumber)}`;

/** The tracking number a label address holds, when it is one of UPS's own hosts; null for anything else, which is never sent the store's token. */
export function labelTrackingNumber(url: string): { host: string; trackingNumber: string } | null {
  const match = /^(https:\/\/(?:onlinetools|wwwcie)\.ups\.com)\/api\/labels\/v1\/recovery#([A-Za-z0-9]{7,34})$/.exec(url);
  return match ? { host: match[1], trackingNumber: decodeURIComponent(match[2]) } : null;
}

export const labelRecoveryBody = (trackingNumber: string) => ({
  LabelRecoveryRequest: {
    Request: { TransactionReference: { CustomerContext: "Kaizena Flow label" } },
    LabelSpecification: { LabelImageFormat: { Code: "PDF" }, HTTPUserAgent: "Mozilla/4.5" },
    TrackingNumber: trackingNumber,
  },
});

/** The PDF of a recovered label, as bytes; null when the answer holds none. */
export function parseLabelRecovery(json: unknown): Uint8Array | null {
  const result = obj(many(obj(obj(json).LabelRecoveryResponse).LabelResults)[0]);
  const image = text(obj(result.LabelImage).GraphicImage);
  if (!image) return null;
  const bytes = Uint8Array.from(Buffer.from(image, "base64"));
  // A PDF starts with "%PDF".
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? bytes : null;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export const trackingUrl = (host: string, trackingNumber: string) => `${host}/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_GB`;

/** "20261105" and "143000" as an ISO time without a zone (read in the delivery country's zone, `toInstant()`); null when it is not that. */
function localTime(date: string, time: string): string | null {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (!d) return null;
  const t = /^(\d{2})(\d{2})(\d{2})?$/.exec(time) ?? ["", "00", "00", "00"];
  return `${d[1]}-${d[2]}-${d[3]}T${t[1]}:${t[2]}:${t[3] ?? "00"}`;
}

/** A parcel's events, newest first; the status is UPS's status type (`D`, `I`, `P`, `M`, `X`), its description in UPS's words. */
export function parseTracking(json: unknown): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  for (const shipment of many(obj(obj(json).trackResponse).shipment)) {
    for (const pkg of many(obj(shipment).package)) {
      for (const raw of many(obj(pkg).activity)) {
        const a = obj(raw);
        const gmt = /^\d{8}$/.test(text(a.gmtDate)) && text(a.gmtOffset) ? localTime(text(a.gmtDate), text(a.gmtTime).replace(/:/g, "")) : null;
        const at = gmt ? `${gmt}Z` : localTime(text(a.date), text(a.time));
        if (!at) continue;
        const status = obj(a.status);
        const address = obj(obj(a.location).address);
        const place = [text(address.city), text(address.countryCode)].filter(Boolean).join(", ");
        events.push({
          at,
          status: text(status.type).toUpperCase(),
          description: text(status.description) || text(status.simplifiedTextDescription),
          ...(place ? { location: place } : {}),
        });
      }
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The first error UPS gave (`response.errors[].message`), cut short. */
export const upsError = (json: unknown): string => {
  const first = obj(many(obj(obj(json).response).errors)[0]);
  const message = text(first.message);
  return message ? `${message.slice(0, 200)}${text(first.code) ? ` (${text(first.code)})` : ""}` : "";
};

/** What to tell the owner when UPS answers with a status that is not a success. */
export function upsProblem(status: number, json?: unknown): string {
  const said = upsError(json);
  if (status === 401) return "UPS did not accept the client id and secret. Check them on this page, and that they are for the right environment (test or live).";
  if (status === 403) return `UPS refused access for this account${said ? `: ${said}` : ". Check the account number on this page."}`;
  if (status === 404) return "UPS did not find that.";
  if (status === 429) return "UPS asked us to slow down. Try again in a moment.";
  if (status >= 500) return "UPS is not answering right now. Try again in a moment.";
  return said ? `UPS did not accept the request: ${said}` : `UPS did not accept the request (${status}).`;
}
