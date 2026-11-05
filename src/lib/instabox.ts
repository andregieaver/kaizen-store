import type { BookingRequest, PickupPoint } from "./shipping-carriers";

/**
 * Instabox (D457): what Instabee's API is sent and how its answers are read, as pure functions so they are tested without the network. The calls are
 * in `src/server/carriers/instabox.ts`. Instabox is Instabee's brand of parcel lockers in Sweden, Norway and Denmark; a shop connects through
 * Instabee's integration API (docs.integration.instabee.com, beta, read 2026-11-05), with the API key Instabee's implementation manager gives it:
 * `Authorization: ApiKey …` and `Accept-Version: 1.0.0` on every call. Delivery options (the lockers near a postal code, with an availability token
 * held 14 days), orders (`PUT /orders`, booked and confirmed as packed at once) and labels. Instabee's documentation does not say whose price its
 * `deliveryPrice` is, so the store enters its own prices for checkout (`delivery-options.ts`, pricing "store").
 */

/** Instabee's production API and its sandbox, chosen by the store's environment. */
export const INSTABOX_HOSTS = { live: "https://api.integration.instabee.com", test: "https://sandbox-api.integration.instabee.com" } as const;
export const instaboxHost = (environment: string) => (environment === "live" ? INSTABOX_HOSTS.live : INSTABOX_HOSTS.test);

export const INSTABOX_BRAND = "instabox";
/** Instabee's locker product ("Locker Delivery"). */
export const LOCKER_PRODUCT = "LOCKER_EXPRESS";

/** The services a store can offer at checkout: a locker the shopper chooses (at most 20 kg and 39 × 39 × 59 cm). */
export const INSTABOX_SERVICES: { id: string; name: string; needsPickupPoint: boolean; maxWeightGrams: number }[] = [
  { id: "locker", name: "Instabox locker", needsPickupPoint: true, maxWeightGrams: 20_000 },
];

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

/** The lockers Instabox delivers to near a postal code, with their opening hours and distance. */
export const deliveryOptionsUrl = (host: string, country: string, postalCode: string) =>
  `${host}/availability/countries/${encodeURIComponent(country.toUpperCase())}/postal-codes/${encodeURIComponent(postalCode.replace(/\s+/g, ""))}/delivery-options?brand=${INSTABOX_BRAND}&product=${LOCKER_PRODUCT}`;

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

/** What is missing for Instabox to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: BookingRequest): string[] {
  const problems: string[] = [];
  if (!request.pickupPointId) problems.push("The customer's Instabox locker is missing.");
  const to = request.to;
  if (!["SE", "NO", "DK"].includes(to.country)) problems.push("Instabox delivers in Sweden, Norway and Denmark.");
  if (!to.name || !to.street || !to.postalCode || !to.city) problems.push("The delivery address needs a name, street, postal code and city.");
  if (!to.phone) problems.push("The order has no phone number for the recipient: Instabox texts the code for the locker.");
  if (!to.email) problems.push("The order has no email for the recipient.");
  return problems;
}

/**
 * The order, booked and confirmed as packed in one call (`parcelPackingConfirmed`): the locker's sort code and the token it came with, the recipient
 * Instabox texts the code to, the order number, and the parcel's weight and size. Instabee knows the store's warehouse; a store with several names
 * the one it sends from (`collectionPointId`).
 */
export function orderBody(request: BookingRequest, token: string, sortCode: string, collectionPointId?: string) {
  const parcel = request.parcels[0];
  const grams = request.parcels.reduce((sum, p) => sum + Math.max(1, Math.round(p.weightGrams)), 0);
  return {
    brand: INSTABOX_BRAND,
    product: LOCKER_PRODUCT,
    availabilityToken: token,
    parcelPackingConfirmed: true,
    recipient: {
      name: request.to.name.slice(0, 100),
      email: request.to.email ?? "",
      phone: (request.to.phone ?? "").replace(/[^\d+]/g, ""),
      street: request.to.street.slice(0, 100),
      postalCode: request.to.postalCode.replace(/\s+/g, ""),
      city: request.to.city.slice(0, 60),
      countryCode: request.to.country.toUpperCase(),
    },
    deliveryOption: { sortCode },
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
