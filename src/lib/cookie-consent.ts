import { z } from "zod";

/**
 * Cookie consent (D58), for Kaizen's own site and each store: the optional
 * tools an owner can switch on, the categories of cookies, what each known
 * cookie is for, and the consent cookie that remembers a visitor's choice.
 * Shared by the storefront, the consent widget in the browser and the admin.
 */

/** Cookie categories; only the optional ones are asked about. */
export const CONSENT_CATEGORIES = ["necessary", "preferences", "statistics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export const OPTIONAL_CATEGORIES = ["preferences", "statistics", "marketing"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];
export type ConsentChoices = Record<OptionalCategory, boolean>;

export const NO_CONSENT: ConsentChoices = { preferences: false, statistics: false, marketing: false };
export const FULL_CONSENT: ConsentChoices = { preferences: true, statistics: true, marketing: true };

// ---------------------------------------------------------------------------
// Tools an owner switches on
// ---------------------------------------------------------------------------

/** Analytics and marketing tools, by the id each service gives; none is loaded without consent. */
export type TrackingSettings = { ga4?: string; gtm?: string; metaPixel?: string };

const optionalId = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === "" || pattern.test(value), message)
    .optional();

export const trackingSchema = z
  .object({
    ga4: optionalId(/^G-[A-Z0-9]{4,15}$/, "A Google Analytics 4 id looks like G-XXXXXXXXXX."),
    gtm: optionalId(/^GTM-[A-Z0-9]{4,12}$/, "A Google Tag Manager id looks like GTM-XXXXXXX."),
    metaPixel: optionalId(/^\d{6,20}$/, "A Meta Pixel id is a number of 6 to 20 digits."),
  })
  // Empty fields are tools switched off.
  .transform((value) =>
    Object.fromEntries(Object.entries(value).filter(([, id]) => id)) as TrackingSettings,
  );

/** The stored value, or no tools if it is missing or damaged. */
export function parseTracking(value: unknown): TrackingSettings {
  const parsed = trackingSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** The categories a set of tools needs consent for: Analytics is statistics; the Pixel marketing; Tag Manager may run either. */
export function toolCategories(tracking: TrackingSettings): OptionalCategory[] {
  const used = new Set<OptionalCategory>();
  if (tracking.ga4) used.add("statistics");
  if (tracking.gtm) {
    used.add("statistics");
    used.add("marketing");
  }
  if (tracking.metaPixel) used.add("marketing");
  return OPTIONAL_CATEGORIES.filter((c) => used.has(c));
}

// ---------------------------------------------------------------------------
// The consent cookie
// ---------------------------------------------------------------------------

/** How long a choice lasts before a visitor is asked again, as Datatilsynet recommends at most. */
export const CONSENT_DAYS = 365;

/** The consent cookie of Kaizen's site (null) or a store's, one per site so choices are the site's own. */
export const consentCookieName = (storeId: string | null) => `consent_${storeId ?? "kaizen"}`;

/**
 * Which optional categories a site asks about. A choice made against another
 * list is asked again, so a visitor who allowed statistics is asked before
 * marketing starts.
 */
export const consentVersion = (categories: readonly OptionalCategory[]) =>
  OPTIONAL_CATEGORIES.filter((c) => categories.includes(c)).join("+");

export type StoredConsent = { visitor: string; version: string; choices: ConsentChoices };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `1.{visitor}.{version}.{p}{s}{m}`: readable in the browser, which applies it before anything loads. */
export function encodeConsent({ visitor, version, choices }: StoredConsent): string {
  const bits = OPTIONAL_CATEGORIES.map((c) => (choices[c] ? "1" : "0")).join("");
  return `1.${visitor}.${version || "none"}.${bits}`;
}

export function decodeConsent(value: string | undefined | null): StoredConsent | null {
  const match = /^1\.([0-9a-f-]{36})\.([a-z+]{1,60})\.([01]{3})$/.exec(value ?? "");
  if (!match || !UUID.test(match[1])) return null;
  const [p, s, m] = match[3].split("").map((bit) => bit === "1");
  return {
    visitor: match[1],
    version: match[2] === "none" ? "" : match[2],
    choices: { preferences: p, statistics: s, marketing: m },
  };
}

/** A choice still stands when it was made against the categories the site asks about now. */
export const consentIsCurrent = (stored: StoredConsent | null, version: string) =>
  stored !== null && stored.version === version;

// ---------------------------------------------------------------------------
// Known cookies
// ---------------------------------------------------------------------------

type Texts = { en: string; nb: string; sv: string; da: string };

/** A cookie Kaizen knows: what sets it, why, and for how long (days; null while the browser is open). */
export type KnownCookie = {
  /** As shown: `cart_…` stands for every cookie of that kind. */
  name: string;
  /** Matches the cookie's real name. */
  pattern: RegExp;
  provider: string;
  category: ConsentCategory;
  days: number | null;
  purpose: Texts;
  /** Where it is set: Kaizen's site, stores, or both. */
  on: "platform" | "store" | "both";
  /** Set only by this tool, when switched on. */
  tool?: keyof TrackingSettings;
  /** Set only in stores selling to both private shoppers and businesses (D63). */
  buyers?: boolean;
};

/**
 * The cookies Kaizen sets itself, and those of the tools it can load.
 * Descriptions are plain statements of fact; they are shown on each
 * site's cookie page and should be reviewed with the other legal texts.
 */
export const KNOWN_COOKIES: KnownCookie[] = [
  {
    name: "cart_…",
    pattern: /^cart_[0-9a-f-]{36}_[a-z]{2}$/,
    provider: "Kaizen",
    category: "necessary",
    days: 30,
    on: "store",
    purpose: {
      en: "Keeps your shopping cart while you shop.",
      nb: "Husker handlekurven din mens du handler.",
      sv: "Kommer ihåg din varukorg medan du handlar.",
      da: "Husker din kurv, mens du handler.",
    },
  },
  {
    name: "account_…",
    pattern: /^account_[0-9a-f-]{36}$/,
    provider: "Kaizen",
    category: "necessary",
    days: 60,
    on: "store",
    purpose: {
      en: "Keeps you signed in to your account when you choose to sign in.",
      nb: "Holder deg innlogget på kontoen din når du velger å logge inn.",
      sv: "Håller dig inloggad på ditt konto när du väljer att logga in.",
      da: "Holder dig logget ind på din konto, når du vælger at logge ind.",
    },
  },
  {
    name: "wishlist_…",
    pattern: /^wishlist_[0-9a-f-]{36}$/,
    provider: "Kaizen",
    category: "necessary",
    days: 365,
    on: "store",
    purpose: {
      en: "Keeps the products you save to your wishlist.",
      nb: "Husker produktene du lagrer i ønskelisten.",
      sv: "Kommer ihåg produkterna du sparar i önskelistan.",
      da: "Husker de produkter, du gemmer på ønskelisten.",
    },
  },
  {
    name: "buyer_…",
    pattern: /^buyer_[0-9a-f-]{36}$/,
    provider: "Kaizen",
    category: "necessary",
    days: 365,
    on: "store",
    buyers: true,
    purpose: {
      en: "Remembers whether you shop privately or for a business, to show the right prices and products.",
      nb: "Husker om du handler privat eller for en bedrift, for å vise riktige priser og varer.",
      sv: "Kommer ihåg om du handlar privat eller för ett företag, för att visa rätt priser och varor.",
      da: "Husker, om du handler privat eller for en virksomhed, for at vise de rigtige priser og varer.",
    },
  },
  {
    name: "consent_…",
    pattern: /^consent_([0-9a-f-]{36}|kaizen)$/,
    provider: "Kaizen",
    category: "necessary",
    days: CONSENT_DAYS,
    on: "both",
    purpose: {
      en: "Remembers your choice about cookies on this site.",
      nb: "Husker valget ditt om informasjonskapsler på dette nettstedet.",
      sv: "Kommer ihåg ditt val om kakor på den här webbplatsen.",
      da: "Husker dit valg om cookies på dette websted.",
    },
  },
  {
    name: "sb-…-auth-token",
    pattern: /^sb-[a-z0-9]+-auth-token(\.\d+)?$/,
    provider: "Kaizen (Supabase)",
    category: "necessary",
    days: 400,
    on: "platform",
    purpose: {
      en: "Keeps store owners and staff signed in to the admin.",
      nb: "Holder butikkeiere og ansatte innlogget i administrasjonen.",
      sv: "Håller butiksägare och personal inloggade i administrationen.",
      da: "Holder butiksejere og ansatte logget ind i administrationen.",
    },
  },
  {
    name: "__stripe_mid, __stripe_sid",
    pattern: /^__stripe_(mid|sid)$/,
    provider: "Stripe",
    category: "necessary",
    days: 365,
    on: "both",
    purpose: {
      en: "Used by Stripe to take payments safely and prevent fraud.",
      nb: "Brukes av Stripe for å ta imot betaling trygt og hindre svindel.",
      sv: "Används av Stripe för att ta emot betalningar säkert och förhindra bedrägerier.",
      da: "Bruges af Stripe til at modtage betalinger sikkert og forhindre svindel.",
    },
  },
  {
    name: "_ga",
    pattern: /^_ga$/,
    provider: "Google Analytics",
    category: "statistics",
    days: 730,
    on: "both",
    tool: "ga4",
    purpose: {
      en: "Tells visits apart, to count how the site is used.",
      nb: "Skiller besøk fra hverandre, for å telle hvordan nettstedet brukes.",
      sv: "Skiljer besök åt, för att räkna hur webbplatsen används.",
      da: "Skelner besøg fra hinanden for at tælle, hvordan webstedet bruges.",
    },
  },
  {
    name: "_ga_…",
    pattern: /^_ga_[A-Z0-9]+$/,
    provider: "Google Analytics",
    category: "statistics",
    days: 730,
    on: "both",
    tool: "ga4",
    purpose: {
      en: "Keeps the state of a visit, to count how the site is used.",
      nb: "Holder styr på et besøk, for å telle hvordan nettstedet brukes.",
      sv: "Håller reda på ett besök, för att räkna hur webbplatsen används.",
      da: "Holder styr på et besøg for at tælle, hvordan webstedet bruges.",
    },
  },
  {
    name: "_gcl_au",
    pattern: /^_gcl_(au|aw|dc)$/,
    provider: "Google Ads",
    category: "marketing",
    days: 90,
    on: "both",
    tool: "gtm",
    purpose: {
      en: "Measures which ads lead to visits and purchases.",
      nb: "Måler hvilke annonser som fører til besøk og kjøp.",
      sv: "Mäter vilka annonser som leder till besök och köp.",
      da: "Måler, hvilke annoncer der fører til besøg og køb.",
    },
  },
  {
    name: "_fbp",
    pattern: /^_fbp$/,
    provider: "Meta",
    category: "marketing",
    days: 90,
    on: "both",
    tool: "metaPixel",
    purpose: {
      en: "Lets Meta show and measure ads to people who visited the site.",
      nb: "Lar Meta vise og måle annonser til folk som har besøkt nettstedet.",
      sv: "Låter Meta visa och mäta annonser för personer som har besökt webbplatsen.",
      da: "Lader Meta vise og måle annoncer til personer, der har besøgt webstedet.",
    },
  },
  {
    name: "_fbc",
    pattern: /^_fbc$/,
    provider: "Meta",
    category: "marketing",
    days: 90,
    on: "both",
    tool: "metaPixel",
    purpose: {
      en: "Remembers the Meta ad a visitor came from.",
      nb: "Husker hvilken Meta-annonse en besøkende kom fra.",
      sv: "Kommer ihåg vilken Meta-annons en besökare kom från.",
      da: "Husker, hvilken Meta-annonce en besøgende kom fra.",
    },
  },
];

/** What Kaizen knows about a cookie by its name, if anything. */
export const knownCookie = (name: string) => KNOWN_COOKIES.find((cookie) => cookie.pattern.test(name)) ?? null;

/** A cookie's purpose in a language, English when there is none. */
export const cookiePurpose = (cookie: Pick<KnownCookie, "purpose">, lang: string) =>
  cookie.purpose[lang as keyof Texts] ?? cookie.purpose.en;

/**
 * The cookies a site's cookie page lists before any scan (D58): Kaizen's
 * own for that kind of site, and those of the tools switched on.
 */
export function declaredCookies(
  site: "platform" | "store",
  tracking: TrackingSettings,
  { buyers = false }: { buyers?: boolean } = {},
): KnownCookie[] {
  return KNOWN_COOKIES.filter(
    (cookie) =>
      (cookie.on === site || cookie.on === "both") &&
      (!cookie.buyers || buyers) &&
      (cookie.tool ? Boolean(tracking[cookie.tool]) : cookie.provider !== "Stripe"),
  );
}
