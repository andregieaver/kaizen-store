/**
 * What a store's legal starter pages are filled from (wave 1, 1e, `docs/wave-1-trust.md` 2.1): the store's own facts,
 * assembled here from what the server read (`src/server/legal-facts.ts`) into one plain object. A fact the store does not
 * hold is `null` and becomes a visible `[[Add: …]]` placeholder in the text, never an invented sentence. Pure.
 */
import type { ReturnAddress, ReturnSettings } from "./withdrawal";

export type LegalAudience = "consumers" | "businesses" | "both";

export type LegalFacts = {
  storeName: string;
  legalName: string | null;
  organisationNumber: string | null;
  /** `registered`: true or false when the owner has said, null when the store has not (no tax profile yet). */
  vat: { number: string | null; registered: boolean | null };
  address: string | null;
  email: string | null;
  /** Kaizen holds no phone number for a store: always a placeholder unless the owner added one. */
  phone: string | null;
  /** The store's country, ISO 3166-1 alpha-2, upper case. */
  country: string | null;
  /** The countries the store sells to, with the currency each is shown in, main market first. */
  markets: { code: string; currency: string }[];
  /** The flat shipping rate of each market, in the country's own currency; null where none is set. */
  shipping: { code: string; currency: string; rateMinor: number | null; freeAboveMinor: number | null }[];
  /** The names of the carriers the store has connected. */
  carriers: string[];
  returns: {
    windowDays: number;
    whoPays: "shopper" | "store";
    refundWhen: "received" | "request";
    acceptExcluded: boolean;
    instructions: string;
    /** Where returns go, as one line; null is the store's postal address. */
    address: string | null;
    b2bReturns: boolean;
  };
  bookingsOn: boolean;
  deliveriesOn: boolean;
  /** Cookieless visit counting is on. */
  visitCounting: boolean;
  /** The names of the tracking tools the store has set up (they load only with consent). */
  trackingTools: string[];
  chatAgent: boolean;
  audience: LegalAudience;
  /** Addresses on the site the texts link to, where the store has them; left out otherwise. */
  links: { withdraw?: string; cookies?: string };
};

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
};

export function formatReturnAddress(address: ReturnAddress | null): string | null {
  if (!address) return null;
  const parts = [address.name, address.street, `${address.postalCode} ${address.city}`.trim(), address.country].map((p) => clean(p)).filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** What the server reads, in the shapes it already has. */
export type LegalFactsInput = {
  store: {
    name: string;
    legalName: string | null;
    organisationNumber: string | null;
    contactEmail: string | null;
    postalAddress: string | null;
    country: string | null;
    audience: LegalAudience;
    visitCounting: boolean;
    modules: readonly string[];
    tracking: { ga4?: string; gtm?: string; metaPixel?: string };
  };
  /** From `taxFactsOf()`: null until the store has a tax profile. */
  tax: { vatNumber: string | null; registered: boolean | null } | null;
  /** The store's active markets, main first, with their shown currency. */
  markets: { code: string; currency: string }[];
  shippingRates: { marketCode: string; currency: string; rateMinor: number; freeAboveMinor: number | null }[];
  carrierNames: string[];
  returnSettings: ReturnSettings | null;
  chatOn: boolean;
  links?: { withdraw?: string; cookies?: string };
  phone?: string | null;
};

export const TRACKING_TOOL_NAMES = { ga4: "Google Analytics 4", gtm: "Google Tag Manager", metaPixel: "Meta Pixel" } as const;

/** The facts as the starters read them. */
export function assembleLegalFacts(input: LegalFactsInput): LegalFacts {
  const { store } = input;
  const settings = input.returnSettings;
  const rateOf = (code: string) => input.shippingRates.find((r) => r.marketCode === code);
  return {
    storeName: clean(store.name) ?? "",
    legalName: clean(store.legalName),
    organisationNumber: clean(store.organisationNumber),
    vat: { number: clean(input.tax?.vatNumber), registered: input.tax?.registered ?? null },
    address: clean(store.postalAddress),
    email: clean(store.contactEmail),
    phone: clean(input.phone),
    country: store.country ? store.country.toUpperCase() : null,
    markets: input.markets.map((m) => ({ code: m.code.toUpperCase(), currency: m.currency.toUpperCase() })),
    shipping: input.markets.map((m) => {
      const rate = rateOf(m.code);
      return { code: m.code.toUpperCase(), currency: (rate?.currency ?? m.currency).toUpperCase(), rateMinor: rate ? rate.rateMinor : null, freeAboveMinor: rate?.freeAboveMinor ?? null };
    }),
    carriers: [...new Set(input.carrierNames.map((n) => clean(n)).filter((n): n is string => n !== null))],
    returns: {
      windowDays: Math.max(14, settings?.windowDays ?? 14),
      whoPays: settings?.whoPaysReturn ?? "shopper",
      refundWhen: settings?.refundWhen ?? "received",
      acceptExcluded: settings?.acceptExcluded ?? false,
      instructions: clean(settings?.instructions) ?? "",
      address: formatReturnAddress(settings?.returnAddress ?? null) ?? clean(store.postalAddress),
      b2bReturns: settings?.b2bReturns ?? false,
    },
    bookingsOn: store.modules.includes("bookings"),
    deliveriesOn: store.modules.includes("deliveries"),
    visitCounting: store.visitCounting,
    trackingTools: (Object.keys(TRACKING_TOOL_NAMES) as (keyof typeof TRACKING_TOOL_NAMES)[]).filter((k) => Boolean(store.tracking[k])).map((k) => TRACKING_TOOL_NAMES[k]),
    chatAgent: input.chatOn,
    audience: store.audience,
    links: input.links ?? {},
  };
}

/** The basic facts a store has not given, in the owner's words, for the settings screen to list before a starter is made. */
export function missingFacts(facts: LegalFacts): string[] {
  const missing: string[] = [];
  if (!facts.legalName) missing.push("the business's legal name");
  if (!facts.organisationNumber) missing.push("the organisation number");
  if (!facts.address) missing.push("the postal address");
  if (!facts.email) missing.push("the contact email");
  if (!facts.country) missing.push("the country");
  if (facts.vat.registered !== false && !facts.vat.number) missing.push("the VAT number, or that the business is not registered for VAT");
  if (facts.markets.length === 0) missing.push("the countries the store sells to");
  if (facts.shipping.some((s) => s.rateMinor === null)) missing.push("a shipping price for every country");
  return missing;
}
