import { z } from "zod";

/**
 * Shipping carriers (D133): the carriers a store will be able to connect from Integrations, prepared before their
 * connections exist. A store saves its own agreement with a carrier here (customer number, API access; secrets are
 * encrypted and never shown again) so that the connection can switch on the day it is built; until then nothing is
 * sent to any carrier and nothing at checkout or in orders changes.
 *
 * This file is the contract for what comes next: the registry of carriers with what each needs and what is planned, the
 * checks on what a store saves, and `ShippingCarrierAdapter`, the one interface each connection will implement (rates,
 * pickup points, booking with labels, tracking). The fields each carrier needs are the usual ones for its API and are
 * confirmed against the carrier's own documentation when its connection is built; adding a field is a line here.
 * Pure types, checks and texts, shared by the browser and the server, which checks everything again.
 */

export type CarrierId = "bring" | "postnord" | "porterbuddy" | "helthjem";
export const CARRIER_IDS: CarrierId[] = ["bring", "postnord", "porterbuddy", "helthjem"];
export const isCarrierId = (value: string): value is CarrierId => (CARRIER_IDS as string[]).includes(value);

/** What a connection will do for the store, from the shopper's checkout to the parcel on its way. */
export type CarrierFeature = "rates" | "pickup_points" | "labels" | "tracking" | "time_windows" | "same_day";

export const CARRIER_FEATURE_LABELS: Record<CarrierFeature, string> = {
  rates: "Delivery options and prices at checkout",
  pickup_points: "Pickup points the shopper can choose",
  labels: "Book shipments and print labels from the order",
  tracking: "Tracking numbers on the order and in emails",
  time_windows: "Home delivery in a time window",
  same_day: "Same-day delivery",
};

/** A detail the store gives the carrier's API: secret ones are encrypted and shown only as saved. */
export type CarrierField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
  placeholder?: string;
};

export type CarrierInfo = {
  id: CarrierId;
  name: string;
  /** What it is, in a line. */
  summary: string;
  /** Countries the carrier delivers in, as the store's markets are named (ISO 3166-1 alpha-2). */
  countries: string[];
  features: CarrierFeature[];
  fields: CarrierField[];
  /** Where the store gets an agreement and API access. */
  docs: string;
  /** The steps to get ready, in words. */
  steps: string[];
};

export const CARRIERS: CarrierInfo[] = [
  {
    id: "bring",
    name: "Posten / Bring",
    summary: "Norway's postal service and Bring's parcels across the Nordics: home delivery, pickup points and the mailbox.",
    countries: ["NO", "SE", "DK", "FI"],
    features: ["rates", "pickup_points", "labels", "tracking"],
    fields: [
      { key: "customerNumber", label: "Customer number", secret: false, required: true, help: "Your number in your agreement with Posten / Bring." },
      { key: "apiUid", label: "Mybring API user", secret: false, required: true, help: "The user (email) of your Mybring API access." },
      { key: "apiKey", label: "Mybring API key", secret: true, required: true },
    ],
    docs: "https://developer.bring.com",
    steps: [
      "Have an agreement with Posten / Bring and a Mybring account.",
      "In Mybring, open the API settings and create API access for this store.",
      "Copy the customer number, the API user and the API key to the form.",
    ],
  },
  {
    id: "postnord",
    name: "PostNord",
    summary: "Parcels and letters in Sweden, Denmark, Norway and Finland, with pickup points and tracking.",
    countries: ["SE", "DK", "NO", "FI"],
    features: ["rates", "pickup_points", "labels", "tracking"],
    fields: [
      { key: "customerNumber", label: "Customer number", secret: false, required: true, help: "Your number in your agreement with PostNord." },
      { key: "apiKey", label: "API key", secret: true, required: true },
    ],
    docs: "https://developer.postnord.com",
    steps: [
      "Have a customer agreement with PostNord.",
      "At PostNord's developer portal, make an application and get an API key for it.",
      "Copy the customer number and the API key to the form.",
    ],
  },
  {
    id: "porterbuddy",
    name: "Porterbuddy",
    summary: "Fast home delivery in a time window your shopper chooses, including the same day.",
    countries: ["NO"],
    features: ["rates", "labels", "tracking", "time_windows", "same_day"],
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "apiSecret", label: "API secret", secret: true, required: false, help: "If your agreement has one." },
    ],
    docs: "https://docs.porterbuddy.com",
    steps: [
      "Have an agreement with Porterbuddy and ask them for API access.",
      "Copy the API key (and the secret, if you were given one) to the form.",
      "Use the test environment until Porterbuddy has approved your setup.",
    ],
  },
  {
    id: "helthjem",
    name: "Helthjem",
    summary: "Home delivery in the evening and on days the post does not come.",
    countries: ["NO"],
    features: ["rates", "labels", "tracking", "time_windows"],
    fields: [
      { key: "shopId", label: "Shop ID", secret: false, required: true, help: "Your shop's number in your agreement with Helthjem." },
      { key: "apiKey", label: "API key", secret: true, required: true },
    ],
    docs: "https://helthjem.no",
    steps: [
      "Have an agreement with Helthjem and ask them for API access.",
      "Copy the shop ID and the API key to the form.",
      "Use the test environment until Helthjem has approved your setup.",
    ],
  },
];

export const carrierInfo = (id: string): CarrierInfo | null => CARRIERS.find((c) => c.id === id) ?? null;

export const CARRIER_ENVIRONMENTS = ["test", "live"] as const;
export type CarrierEnvironment = (typeof CARRIER_ENVIRONMENTS)[number];

/** What a store has saved for a carrier, as the screens read it: never the secrets themselves. */
export type CarrierSettings = {
  carrier: CarrierId;
  environment: CarrierEnvironment;
  /** The non-secret details, by field key. */
  details: Record<string, string>;
  /** The markets (country codes) the store wants to ship to with it. */
  countries: string[];
  /** Which secret fields are saved, and the last four characters of each to recognise it by. */
  secrets: Record<string, string>;
  /** All the details the carrier needs are saved. */
  complete: boolean;
  updatedAt: string;
};

const FIELD_MAX = 200;

/**
 * What the form sends: every field of the carrier as text. A secret left empty keeps the one saved; a detail left empty is
 * missing. Unknown fields are dropped. Returns what to store (`details`, `secrets` only for fields given) or the problems.
 */
export function parseCarrierForm(
  info: CarrierInfo,
  raw: {
    environment: unknown;
    countries: unknown[];
    fields: Record<string, unknown>;
  },
  saved: { hasSecret: (key: string) => boolean },
): { ok: true; environment: CarrierEnvironment; countries: string[]; details: Record<string, string>; secrets: Record<string, string> } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const environment = z.enum(CARRIER_ENVIRONMENTS).safeParse(raw.environment);
  if (!environment.success) problems.push("Choose test or live.");
  const countries = [...new Set(raw.countries.map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  const details: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const field of info.fields) {
    const value = String(raw.fields[field.key] ?? "").trim();
    if (value.length > FIELD_MAX) {
      problems.push(`${field.label} is too long.`);
      continue;
    }
    if (field.secret) {
      if (value) secrets[field.key] = value;
      else if (field.required && !saved.hasSecret(field.key)) problems.push(`Enter the ${field.label.toLowerCase()}.`);
    } else if (value) {
      details[field.key] = value;
    } else if (field.required) {
      problems.push(`Enter the ${field.label.toLowerCase()}.`);
    }
  }
  return problems.length > 0 || !environment.success ? { ok: false, problems } : { ok: true, environment: environment.data, countries, details, secrets };
}

/** The last four characters of a saved secret, to recognise it by (shorter ones show only dots). */
export const secretHint = (value: string) => (value.length > 8 ? `…${value.slice(-4)}` : "…");

/** Whether every required field is saved. */
export function carrierComplete(info: CarrierInfo, details: Record<string, string>, secretKeys: string[]): boolean {
  return info.fields.every((f) => !f.required || (f.secret ? secretKeys.includes(f.key) : Boolean(details[f.key])));
}

// ---------------------------------------------------------------------------
// The contract each connection will implement
// ---------------------------------------------------------------------------

export type ShippingAddress = {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  phone?: string;
  email?: string;
};

export type ParcelSpec = { weightGrams: number; lengthMm?: number; widthMm?: number; heightMm?: number };

export type RateRequest = { from: ShippingAddress; to: ShippingAddress; parcels: ParcelSpec[]; currency: string };

export type ShippingOption = {
  /** The carrier's own id for the service, kept to book it. */
  serviceId: string;
  carrier: CarrierId;
  name: string;
  /** Excluding VAT, in minor units of `currency`. */
  priceMinor: number;
  currency: string;
  /** Days, or a window when it is for a time. */
  estimate?: { minDays: number; maxDays: number } | { from: string; to: string };
  /** Set when the shopper must choose a pickup point. */
  needsPickupPoint?: boolean;
};

export type PickupPoint = { id: string; name: string; address: ShippingAddress; openingHours?: string; distanceMeters?: number };

export type BookingRequest = { orderReference: string; serviceId: string; from: ShippingAddress; to: ShippingAddress; parcels: ParcelSpec[]; pickupPointId?: string };
export type BookingResult = { trackingNumber: string; trackingUrl: string | null; labelPdf: Uint8Array | null };

export type TrackingEvent = { at: string; status: string; description: string; location?: string };

/** What a connection is given: the store's own agreement, secrets decrypted for the call only. */
export type CarrierContext = {
  storeId: string;
  environment: CarrierEnvironment;
  details: Record<string, string>;
  secrets: Record<string, string>;
};

/** The one interface each carrier's connection implements; a method a carrier cannot do is left out. */
export interface ShippingCarrierAdapter {
  readonly id: CarrierId;
  /** Checks the agreement with a harmless call; the message is shown to the owner. */
  check(context: CarrierContext): Promise<{ ok: true } | { ok: false; problem: string }>;
  rates?(context: CarrierContext, request: RateRequest): Promise<ShippingOption[]>;
  pickupPoints?(context: CarrierContext, near: ShippingAddress): Promise<PickupPoint[]>;
  book?(context: CarrierContext, request: BookingRequest): Promise<BookingResult>;
  track?(context: CarrierContext, trackingNumber: string): Promise<TrackingEvent[]>;
}
