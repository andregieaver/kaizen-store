import type { BookingRequest, PickupPoint, ReturnBookingRequest } from "./shipping-carriers";

/**
 * Instabox (D458, D459): what Instabee's API is sent and how its answers are read, as pure functions so they are tested without the network. The calls are
 * in `src/server/carriers/instabox.ts`. Instabox is Instabee's brand of parcel lockers in Sweden, Norway and Denmark; a shop connects through
 * Instabee's integration API (docs.integration.instabee.com, beta, read 2026-11-05), with the API key Instabee's implementation manager gives it:
 * `Authorization: ApiKey …` and `Accept-Version: 1.0.0` on every call. Delivery options (the lockers near a postal code, with an availability token
 * held 14 days), orders (`PUT /orders`, booked and confirmed as packed at once, to a locker or home, D459), returns through a locker and labels.
 * Instabee documents no call that cancels an order for these products. Instabee's documentation does not say whose price its
 * `deliveryPrice` is, so the store enters its own prices for checkout (`delivery-options.ts`, pricing "store").
 */

/** Instabee's production API and its sandbox, chosen by the store's environment. */
export const INSTABOX_HOSTS = { live: "https://api.integration.instabee.com", test: "https://sandbox-api.integration.instabee.com" } as const;
export const instaboxHost = (environment: string) => (environment === "live" ? INSTABOX_HOSTS.live : INSTABOX_HOSTS.test);

export const INSTABOX_BRAND = "instabox";
/** Instabee's locker product ("Locker Delivery"). */
export const LOCKER_PRODUCT = "LOCKER_EXPRESS";
/** Instabee's home delivery product, which its order call documents for the `instabox` brand (D459). */
export const HOME_PRODUCT = "HOME_DELIVERY";
/** Instabee's return product: the shopper drops the parcel at a locker, and it comes back to the store (D459). */
export const RETURN_PRODUCT = "LOCKER_RETURN";

/**
 * The services a store can offer at checkout: a locker the shopper chooses (at most 20 kg and 39 × 39 × 59 cm), and home delivery (D459), which
 * Instabee confirms per postal code when it is booked. Instabee gives no weight limit for home delivery.
 */
export const INSTABOX_SERVICES: { id: string; name: string; needsPickupPoint: boolean; maxWeightGrams?: number }[] = [
  { id: "locker", name: "Instabox locker", needsPickupPoint: true, maxWeightGrams: 20_000 },
  { id: "home", name: "Instabox home delivery", needsPickupPoint: false },
];

/** The Instabee product a store's service is booked as. */
export const instaboxProduct = (serviceId: string) => (serviceId === "home" ? HOME_PRODUCT : LOCKER_PRODUCT);

export const instaboxHeaders = (apiKey: string, extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: `ApiKey ${apiKey}`,
  Accept: "application/json",
  "Accept-Version": "1.0.0",
  ...extra,
});

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

// ---------------------------------------------------------------------------
// Lockers
// ---------------------------------------------------------------------------

/**
 * The delivery options of a product near a postal code: the lockers Instabox delivers to (or takes returns at) with their opening hours and
 * distance, or for home delivery whether it reaches the postal code at all (a 404 when it does not).
 */
export const deliveryOptionsUrl = (host: string, country: string, postalCode: string, product: string = LOCKER_PRODUCT) =>
  `${host}/availability/countries/${encodeURIComponent(country.toUpperCase())}/postal-codes/${encodeURIComponent(postalCode.replace(/\s+/g, ""))}/delivery-options?brand=${INSTABOX_BRAND}&product=${product}`;

/**
 * A locker as the shopper's choice keeps it: Instabox's sort code with the availability token it came with (`SORTCODE~token`), since a booking must
 * name both and the token holds 14 days. The sort code is passed on exactly as Instabox wrote it.
 */
export const lockerChoice = (sortCode: string, token: string) => (token && `${sortCode}~${token}`.length <= 80 ? `${sortCode}~${token}` : sortCode);

export function readLockerChoice(id: string): { sortCode: string; token: string | null } {
  const at = id.indexOf("~");
  return at > 0 ? { sortCode: id.slice(0, at), token: id.slice(at + 1) || null } : { sortCode: id, token: null };
}

/** The lockers of an answer, nearest first, each with its sort code and the answer's token; empty when there is none. */
export function parseLockers(json: unknown): { token: string | null; lockers: PickupPoint[] } {
  const body = obj(json);
  const token = text(body.availabilityToken) || null;
  const lockers: PickupPoint[] = [];
  for (const raw of list(body.deliveryOptions)) {
    const option = obj(raw);
    const sortCode = text(option.sortCode);
    if (!sortCode || text(option.type).toUpperCase() !== "LOCKER") continue;
    const address = obj(option.address);
    const name = text(option.deliveryOption) || sortCode;
    const distance = obj(option.distance);
    const meters = typeof distance.value === "number" && distance.value >= 0 ? Math.round(distance.value * (text(distance.unit) === "kilometer" ? 1000 : 1)) : null;
    const hours = list(option.openHours)
      .map(obj)
      .filter((h) => h.isOpen !== false && text(h.open) && text(h.close))
      .slice(0, 7)
      .map((h) => `${text(h.textLocal) || text(h.date)} ${text(h.open)}–${text(h.close)}`)
      .join(", ");
    lockers.push({
      id: lockerChoice(sortCode, token ?? ""),
      name,
      address: { name, street: text(address.street), postalCode: text(address.postalCode), city: text(address.city), country: text(address.countryCode).toUpperCase() },
      ...(hours ? { openingHours: hours } : {}),
      ...(meters !== null ? { distanceMeters: meters } : {}),
    });
  }
  return { token, lockers: lockers.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)) };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const COUNTRY_CODES: Record<string, string> = { SE: "+46", NO: "+47", DK: "+45" };

/**
 * A phone number with its country code (Instabee asks home delivery for at least ten digits): written as given when it has one (`+` or `00`),
 * else with the delivery country's code, a Swedish or Danish trunk 0 left out.
 */
export function internationalPhone(phone: string, country: string): string {
  const compact = phone.replace(/[^\d+]/g, "");
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  const code = COUNTRY_CODES[country.toUpperCase()];
  return code && compact ? `${code}${compact.replace(/^0/, "")}` : compact;
}

/** What is missing for Instabox to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: BookingRequest): string[] {
  const problems: string[] = [];
  const home = request.serviceId === "home";
  if (!INSTABOX_SERVICES.some((s) => s.id === request.serviceId)) problems.push("Choose an Instabox service.");
  if (!home && !request.pickupPointId) problems.push("The customer's Instabox locker is missing.");
  const to = request.to;
  if (!["SE", "NO", "DK"].includes(to.country)) problems.push("Instabox delivers in Sweden, Norway and Denmark.");
  if (!to.name || !to.street || !to.postalCode || !to.city) problems.push("The delivery address needs a name, street, postal code and city.");
  if (!to.phone) problems.push(home ? "The order has no phone number for the recipient: Instabox texts when it delivers." : "The order has no phone number for the recipient: Instabox texts the code for the locker.");
  else if (home && internationalPhone(to.phone, to.country).replace(/\D/g, "").length < 10) problems.push("The recipient's phone number is too short for Instabox's home delivery.");
  if (!to.email) problems.push("The order has no email for the recipient.");
  return problems;
}

/** Home delivery's answer for a postal code: the availability token, and the sort code of its delivery option when Instabee gave one. */
export function parseHomeAvailability(json: unknown): { token: string | null; sortCode: string | null } {
  const body = obj(json);
  const option = list(body.deliveryOptions).map(obj).find((o) => text(o.sortCode));
  return { token: text(body.availabilityToken) || null, sortCode: option ? text(option.sortCode) : null };
}

/**
 * The order, booked and confirmed as packed in one call (`parcelPackingConfirmed`): the locker's sort code and the token it came with (for home
 * delivery, the token and sort code of the postal code's availability, D459), the recipient Instabox texts, the order number, and the parcel's weight
 * and size. Instabee knows the store's warehouse; a store with several names the one it sends from (`collectionPointId`).
 */
export function orderBody(request: BookingRequest, token: string | null, sortCode: string | null, collectionPointId?: string) {
  const parcel = request.parcels[0];
  const grams = request.parcels.reduce((sum, p) => sum + Math.max(1, Math.round(p.weightGrams)), 0);
  const product = instaboxProduct(request.serviceId);
  return {
    brand: INSTABOX_BRAND,
    product,
    ...(token ? { availabilityToken: token } : {}),
    parcelPackingConfirmed: true,
    recipient: {
      name: request.to.name.slice(0, 100),
      email: request.to.email ?? "",
      phone: product === HOME_PRODUCT ? internationalPhone(request.to.phone ?? "", request.to.country) : (request.to.phone ?? "").replace(/[^\d+]/g, ""),
      street: request.to.street.slice(0, 100),
      postalCode: request.to.postalCode.replace(/\s+/g, ""),
      city: request.to.city.slice(0, 60),
      countryCode: request.to.country.toUpperCase(),
    },
    ...(sortCode ? { deliveryOption: { sortCode } } : {}),
    ...(collectionPointId ? { dispatch: { collectionPointId } } : {}),
    cart: {
      orderNumber: (request.parcelReference ?? request.orderReference).slice(0, 60),
      totalWeightInGrams: grams,
      ...(parcel
        ? {
            parcel: {
              weightGram: Math.max(1, Math.round(parcel.weightGrams)),
              ...(parcel.lengthMm ? { lengthMm: parcel.lengthMm } : {}),
              ...(parcel.widthMm ? { widthMm: parcel.widthMm } : {}),
              ...(parcel.heightMm ? { heightMm: parcel.heightMm } : {}),
            },
          }
        : {}),
    },
  };
}

export type ParsedOrder = { ok: true; orderId: string; parcelId: string; trackingUrl: string | null } | { ok: false; problem: string };

/** The order made: Instabee's order id (for its label), the parcel id the shopper follows it by, and its tracking page. */
export function parseOrder(json: unknown): ParsedOrder {
  const body = obj(json);
  const orderId = text(body.orderId);
  const parcelId = text(body.parcelId) || text(obj(list(body.parcels)[0]).parcelId);
  if (!orderId || !parcelId) return { ok: false, problem: "Instabox answered without an order and parcel number." };
  const tracking = text(obj(body.links).tracking);
  return { ok: true, orderId, parcelId, trackingUrl: /^https:\/\/track\.instabox\.(com|io)\//.test(tracking) ? tracking : instaboxTrackingPage(parcelId) };
}

/** Instabox's public tracking page for a parcel. */
export const instaboxTrackingPage = (parcelId: string) => `https://track.instabox.com/${encodeURIComponent(parcelId)}`;

// ---------------------------------------------------------------------------
// Returns through a locker (D459)
// ---------------------------------------------------------------------------

/** The return service: the shopper drops the parcel at an Instabox locker near them, with the label they print. */
export const INSTABOX_RETURN_SERVICES: { id: string; name: string; confirmed: boolean }[] = [{ id: "locker_return", name: "Instabox locker return", confirmed: false }];
export const INSTABOX_RETURN_DEFAULT = "locker_return";

/** What is missing for Instabox to take a return, in plain words; empty when it can be made. */
export function returnBookingProblems(request: ReturnBookingRequest): string[] {
  const problems: string[] = [];
  if (!INSTABOX_RETURN_SERVICES.some((s) => s.id === request.serviceId)) problems.push("Choose an Instabox return service.");
  const from = request.from;
  if (!["SE", "NO", "DK"].includes(from.country)) problems.push("Instabox takes returns in Sweden, Norway and Denmark.");
  if (!from.name || !from.street || !from.postalCode || !from.city) problems.push("The customer's address needs a name, street, postal code and city.");
  if (!from.email && !from.phone) problems.push("The return needs the customer's email or phone, for Instabox's messages.");
  return problems;
}

/**
 * A return (`LOCKER_RETURN`): the shopper as the sender, the locker nearest them (its sort code and the availability token it came with), the
 * return's number, and the parcel: its weight and size when known, else Instabee's smallest size, which a parcel needs (sizes are agreed with
 * Instabee). Instabee sends it to the store's warehouse.
 */
export function returnOrderBody(request: ReturnBookingRequest, token: string, sortCode: string) {
  const parcel = request.parcels[0];
  const grams = request.parcels.reduce((sum, p) => sum + Math.max(1, Math.round(p.weightGrams)), 0);
  const sized = parcel?.lengthMm && parcel.widthMm && parcel.heightMm;
  return {
    brand: INSTABOX_BRAND,
    product: RETURN_PRODUCT,
    availabilityToken: token,
    sender: {
      name: request.from.name.slice(0, 100),
      ...(request.from.email ? { email: request.from.email } : {}),
      ...(request.from.phone ? { phone: internationalPhone(request.from.phone, request.from.country) } : {}),
      street: request.from.street.slice(0, 100),
      postalCode: request.from.postalCode.replace(/\s+/g, ""),
      city: request.from.city.slice(0, 60),
      countryCode: request.from.country.toUpperCase(),
    },
    deliveryOption: { sortCode },
    cart: {
      orderNumber: request.returnReference.slice(0, 60),
      totalWeightInGrams: grams,
      parcel: {
        weightGram: grams,
        ...(sized ? { lengthMm: parcel.lengthMm, widthMm: parcel.widthMm, heightMm: parcel.heightMm } : { estimatedSize: "SMALL" }),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** An order's label as an A6 PDF, fetched with the store's key when it is printed. */
export const labelUrl = (host: string, orderId: string) => `${host}/orders/${encodeURIComponent(orderId)}/labels?fileFormat=pdf&template=a6`;

/** Only Instabee's own hosts are ever sent the store's key. */
export const isInstaboxUrl = (url: string) => /^https:\/\/(sandbox-)?api\.integration\.instabee\.com\//.test(url);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** What to tell the owner when Instabee answers with a status that is not a success. */
export function instaboxProblem(status: number, json?: unknown): string {
  const said = text(obj(json).message).slice(0, 200);
  if (status === 401) return "Instabox did not accept the API key. Check it on this page, and that it is for the right environment (test or live).";
  if (status === 403) return "Instabox refused access for this key. Ask your Instabee contact to switch on lockers for your account.";
  if (status === 404) return "Instabox does not deliver to that postal code.";
  if (status === 409) return "Instabox already has a booking for this parcel.";
  if (status === 422) return "The locker the customer chose is no longer held: book again, and if it still fails, ask the customer to choose another locker.";
  if (status === 429) return "Instabox asked us to slow down. Try again in a moment.";
  if (status >= 500) return "Instabox is not answering right now. Try again in a moment.";
  return said ? `Instabox did not accept the request: ${said}` : `Instabox did not accept the request (${status}).`;
}
