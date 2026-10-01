import { addDays, zonedDate, zonedTime } from "./booking-slots";
import type { BookingRequest, DeliveryWindow, ShippingAddress, ShippingOption, TrackingEvent } from "./shipping-carriers";

/**
 * Porterbuddy (D137): what Porterbuddy's API is sent and how its answers are read, as pure functions so they are tested
 * without the network. The calls are in `src/server/carriers/porterbuddy.ts`. Written against Porterbuddy's public API
 * reference (developer.porterbuddy.com): an availability request returns the windows the goods can be delivered in, each
 * with a price and a token; the order is placed for the window the shopper chose, with its token. Every call carries the
 * store's own API key in `x-api-key`.
 */

export const PORTERBUDDY_HOSTS = { live: "https://api.porterbuddy.com", test: "https://api.porterbuddy-test.com" } as const;
export const porterbuddyHost = (environment: string) => (environment === "live" ? PORTERBUDDY_HOSTS.live : PORTERBUDDY_HOSTS.test);

/** Porterbuddy's products a store can offer at checkout, by their own names in the API. */
export const PORTERBUDDY_PRODUCTS: { id: string; name: string; needsPickupPoint: boolean }[] = [
  { id: "delivery", name: "Porterbuddy delivery", needsPickupPoint: false },
  { id: "large", name: "Porterbuddy large delivery", needsPickupPoint: false },
];

/** Countries as Porterbuddy writes them in an address. */
const COUNTRY_NAMES: Record<string, string> = { NO: "Norway", SE: "Sweden", DK: "Denmark", FI: "Finland" };
export const countryName = (code: string) => COUNTRY_NAMES[code.toUpperCase()] ?? code;

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

// ---------------------------------------------------------------------------
// Addresses and phone numbers
// ---------------------------------------------------------------------------

/** "Keysers Gate 3" as the street name and number Porterbuddy asks for; the number is empty when there is none. */
export function splitStreet(line: string): { streetName: string; streetNumber: string } {
  const clean = line.replace(/\s+/g, " ").trim();
  const match = /^(.*[^\s,])[\s,]+(\d+\s?[A-Za-z]?(?:[-/]\d+)?)$/.exec(clean);
  return match ? { streetName: match[1], streetNumber: match[2].replace(/\s/g, "") } : { streetName: clean, streetNumber: "" };
}

const PHONE_CODES = ["+47", "+46", "+45", "+358", "+354", "+49", "+44", "+31", "+48"];

/** A phone number as a country code and national number; Norway's +47 when the number carries no code. */
export function splitPhone(phone: string, fallbackCode = "+47"): { code: string; number: string } {
  const compact = phone.replace(/[\s().-]/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (international.startsWith("+")) {
    const code = PHONE_CODES.find((c) => international.startsWith(c));
    if (code) return { code, number: international.slice(code.length) };
    return { code: fallbackCode, number: international.replace(/^\+/, "") };
  }
  return { code: fallbackCode, number: international };
}

const addressOf = (a: ShippingAddress) => {
  const { streetName, streetNumber } = splitStreet(a.street);
  return { streetName, streetNumber, postalCode: a.postalCode, city: a.city, country: countryName(a.country) };
};

// ---------------------------------------------------------------------------
// Pick-up windows: when the store has the goods ready
// ---------------------------------------------------------------------------

/** "10:00-17:00" as opening and closing times, or null when it is not that. */
export function parseHours(typed: string): { from: string; to: string } | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/.exec(typed);
  if (!match) return null;
  const pad = (n: string) => n.padStart(2, "0");
  const from = `${pad(match[1])}:${match[2]}`;
  const to = `${pad(match[3])}:${match[4]}`;
  return from < to && Number(match[1]) < 24 && Number(match[3]) < 24 ? { from, to } : null;
}

/** "1-5" or "1,2,3,4,6" as ISO weekdays (1 Monday … 7 Sunday); Monday to Friday when it is not that. */
export function parseDays(typed: string): number[] {
  const days = new Set<number>();
  for (const part of typed.split(",")) {
    const range = /^\s*([1-7])\s*(?:[-–]\s*([1-7]))?\s*$/.exec(part);
    if (!range) continue;
    const a = Number(range[1]);
    const b = range[2] ? Number(range[2]) : a;
    for (let d = Math.min(a, b); d <= Math.max(a, b); d++) days.add(d);
  }
  return days.size > 0 ? [...days].sort() : [1, 2, 3, 4, 5];
}

const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * The windows the goods can be collected in over the next days, in the store's time zone: its opening hours on the days it
 * is open, the first one starting no earlier than `now` plus the time it takes to get the parcel ready. Wide windows over
 * several days are what Porterbuddy recommends.
 */
export function pickupWindows(
  now: number,
  options: { hours: string; days: string; timeZone: string; prepMinutes?: number; count?: number },
): { start: string; end: string }[] {
  const hours = parseHours(options.hours) ?? { from: "10:00", to: "17:00" };
  const days = parseDays(options.days);
  const earliest = now + (options.prepMinutes ?? 30) * 60_000;
  const windows: { start: string; end: string }[] = [];
  let date = zonedDate(now, options.timeZone);
  for (let i = 0; i < 14 && windows.length < (options.count ?? 7); i++, date = addDays(date, 1)) {
    if (!days.includes(isoWeekday(date))) continue;
    const open = zonedTime(date, hours.from, options.timeZone);
    const close = zonedTime(date, hours.to, options.timeZone);
    const start = Math.max(open, earliest);
    if (start >= close - 15 * 60_000) continue;
    windows.push({ start: new Date(start).toISOString(), end: new Date(close).toISOString() });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** The availability request: where from and to, when the goods can be collected, and what is shipped. */
export function availabilityBody(input: {
  from: ShippingAddress;
  to: ShippingAddress;
  pickupWindows: { start: string; end: string }[];
  products: string[];
  parcels: { weightGrams: number; lengthMm?: number; widthMm?: number; heightMm?: number }[];
}) {
  const origin = addressOf(input.from);
  return {
    pickupWindows: input.pickupWindows,
    originAddress: origin,
    destinationAddress: {
      ...(splitStreet(input.to.street).streetName ? splitStreet(input.to.street) : {}),
      postalCode: input.to.postalCode,
      ...(input.to.city ? { city: input.to.city } : {}),
      country: countryName(input.to.country),
    },
    products: input.products,
    parcels: input.parcels.map((p) => ({
      weightGrams: Math.max(1, Math.round(p.weightGrams)),
      ...(p.widthMm ? { widthCm: Math.ceil(p.widthMm / 10) } : {}),
      ...(p.heightMm ? { heightCm: Math.ceil(p.heightMm / 10) } : {}),
      ...(p.lengthMm ? { depthCm: Math.ceil(p.lengthMm / 10) } : {}),
    })),
  };
}

/** A price in the lowest denomination, an integer or a string of digits; null when it is not one. */
function minor(value: unknown): number | null {
  const n = typeof value === "number" ? value : /^\d+$/.test(text(value)) ? Number(text(value)) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * The delivery windows an answer holds, as options to offer: the price made for the shopper to see (`displayPrice`,
 * already with VAT) when the store has one configured, else the price Porterbuddy charges the store (without VAT, as
 * Porterbuddy invoices). A window without a token, a price or times is left out, and so is one that has expired.
 */
export function parseAvailability(json: unknown, now = Date.now()): ShippingOption[] {
  const options: ShippingOption[] = [];
  for (const raw of list(obj(json).deliveryWindows)) {
    const w = obj(raw);
    const start = text(w.start);
    const end = text(w.end);
    const token = text(w.token);
    const product = text(w.product) || "delivery";
    const expiresAt = text(w.expiresAt);
    const display = obj(w.displayPrice);
    const actual = obj(w.price);
    const shown = minor(display.fractionalDenomination);
    const price = shown ?? minor(actual.fractionalDenomination);
    const currency = text(shown !== null ? display.currency : actual.currency) || "NOK";
    if (!start || !end || !token || price === null || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) continue;
    if (expiresAt && Date.parse(expiresAt) <= now) continue;
    const known = PORTERBUDDY_PRODUCTS.find((p) => p.id === product);
    options.push({
      serviceId: product,
      carrier: "porterbuddy",
      name: known?.name ?? `Porterbuddy ${product}`,
      priceMinor: price,
      currency,
      window: { start, end, token, expiresAt: expiresAt || new Date(now + 30 * 60_000).toISOString() },
      ...(shown !== null ? { includesVat: true } : {}),
    });
  }
  return options;
}

// ---------------------------------------------------------------------------
// Orders and labels
// ---------------------------------------------------------------------------

const party = (a: ShippingAddress, fallbackName: string) => {
  const phone = splitPhone(a.phone ?? "");
  return {
    name: a.name || fallbackName,
    address: addressOf(a),
    email: a.email ?? "",
    phoneCountryCode: phone.code,
    phoneNumber: phone.number,
  };
};

/** What is missing for Porterbuddy to take the order, in plain words; empty when it can be placed. */
export function orderProblems(request: BookingRequest): string[] {
  const problems: string[] = [];
  const from = party(request.from, "");
  const to = party(request.to, "");
  if (!request.window) problems.push("The delivery window is missing.");
  if (!from.address.streetNumber) problems.push("Add the street number to the sender address on the carrier's page (for example “Keysers Gate 3”).");
  if (!from.email || !from.phoneNumber) problems.push("Add the sender's email and phone on the carrier's page.");
  if (!to.address.streetName || !to.address.streetNumber) problems.push("The delivery address needs a street name and number.");
  if (!to.name || !to.address.postalCode || !to.address.city) problems.push("The delivery address needs a name, postal code and city.");
  if (!to.email) problems.push("The order has no email for the recipient.");
  if (!to.phoneNumber) problems.push("The order has no phone number for the recipient.");
  return problems;
}

/** The order request for the window the shopper chose, with its token. */
export function orderBody(request: BookingRequest) {
  const window = request.window!;
  return {
    origin: party(request.from, request.from.name),
    destination: {
      ...party(request.to, request.to.name),
      deliveryWindow: { start: window.start, end: window.end, token: window.token },
      verifications: { deliveryVerification: "CONTACTLESS" },
    },
    parcels: request.parcels.map((p) => ({
      description: "Parcel",
      weightGrams: Math.max(1, Math.round(p.weightGrams)),
      ...(p.widthMm ? { widthCm: Math.ceil(p.widthMm / 10) } : {}),
      ...(p.heightMm ? { heightCm: Math.ceil(p.heightMm / 10) } : {}),
      ...(p.lengthMm ? { depthCm: Math.ceil(p.lengthMm / 10) } : {}),
    })),
    product: request.serviceId,
    orderReference: request.orderReference,
    ...(request.courierInstructions ? { courierInstructions: request.courierInstructions.slice(0, 300) } : {}),
  };
}

export type ParsedOrder =
  | { ok: true; orderId: string; pickupTime: string | null; labelInfoUrl: string | null; trackingUrl: string | null }
  | { ok: false; problem: string };

/** The order placed: its id (the tracking number), when it is collected, and the links to its labels and the recipient's tracking page. */
export function parseOrder(json: unknown): ParsedOrder {
  const body = obj(json);
  const orderId = text(body.orderId);
  if (!orderId) return { ok: false, problem: "Porterbuddy answered without an order number." };
  const links = obj(body._links);
  return {
    ok: true,
    orderId,
    pickupTime: text(body.pickupTime) || null,
    labelInfoUrl: text(obj(links.labelInfo).href) || null,
    trackingUrl: text(obj(links.userInformation).href) || null,
  };
}

/** The address of the label document for all the order's parcels, from the label info; null when there is none. */
export function parseLabelInfo(json: unknown): string | null {
  const url = text(obj(json).shipmentLabelUrl);
  return /^https:\/\//.test(url) ? url : null;
}

/** Where the order is: its status and when that changed, as one tracking event (Porterbuddy gives a status, not a trail). */
export function parseStatus(json: unknown): TrackingEvent[] {
  const body = obj(json);
  const status = text(body.orderStatus) || text(body.status);
  if (!status) return [];
  const at = text(body.statusUpdatedAt) || "";
  return [{ at, status, description: `Order ${status.replace(/_/g, " ")}` }];
}

/** The address Porterbuddy's own label and status calls must go to: only its hosts, and https. */
export const isPorterbuddyUrl = (url: string) => /^https:\/\/api\.porterbuddy(-test)?\.com\//.test(url);

/** What to tell the owner when Porterbuddy answers with a status that is not a success. */
export function porterbuddyProblem(status: number): string {
  if (status === 401 || status === 403) return "Porterbuddy did not accept the API key. Check it on this page, and that it is for the right environment (test or live).";
  if (status === 404) return "Porterbuddy did not find that.";
  if (status === 422 || status === 400) return "Porterbuddy could not use the request. Check the sender address and the recipient's address and phone number.";
  if (status === 429) return "Porterbuddy asked us to slow down. Try again in a moment.";
  if (status >= 500) return "Porterbuddy is not answering right now. Try again in a moment.";
  return `Porterbuddy did not accept the request (${status}).`;
}

/** A window written for people: "Thu 13 Feb, 17:30–19:30" in the shopper's language and the store's time zone. */
export function formatWindow(window: Pick<DeliveryWindow, "start" | "end">, locale: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(window.start));
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  return `${day}, ${clock.format(new Date(window.start))}–${clock.format(new Date(window.end))}`;
}
