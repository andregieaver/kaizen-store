import { z } from "zod";
import type { FeatureId } from "./store-features";

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

/** Sent on `window` when the visitor has just made a choice, for what waits on it (Kaizen's referral cookie, D131). */
export const CONSENT_CHANGED_EVENT = "kaizen:consent-changed";

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
  /**
   * Set only while this store feature is on (D178): `siteCookies()` and the cookie page leave it out while the feature is off, even
   * when an earlier scan found it.
   */
  feature?: FeatureId;
  /** Set only on sites whose chat agent is on (D81). */
  chat?: boolean;
  /** Set only in stores that let visitors choose light or dark (D99). */
  colorMode?: boolean;
  /** Set only on sites with a modal that opens by itself and is not shown every time (D121). */
  modals?: boolean;
  /** Set only on Kaizen's site while its referral program is on (D131). */
  referrals?: boolean;
  /** Set only in stores whose referral program (the affiliate program, D131) is on. */
  affiliate?: boolean;
  /** Set only in stores whose product recommendations are on (D139). */
  recommendations?: boolean;
  /** Set only in stores with a running A/B test (D148). */
  experiments?: boolean;
};

/**
 * The cookies Kaizen sets itself, and those of the tools it can load.
 * Descriptions are plain statements of fact; they are shown on each
 * site's cookie page and should be reviewed with the other legal texts.
 */
export const KNOWN_COOKIES: KnownCookie[] = [
  {
    // In local storage, not a cookie: only once a visitor chooses light or dark (D99).
    name: "color_mode_…",
    pattern: /^color_mode_[0-9a-f-]{36}$/,
    provider: "Kaizen",
    category: "necessary",
    days: null,
    on: "store",
    colorMode: true,
    purpose: {
      en: "Remembers whether you chose light or dark colours for this store; kept in your browser until you choose again.",
      nb: "Husker om du valgte lyse eller mørke farger for denne butikken; lagres i nettleseren til du velger på nytt.",
      sv: "Kommer ihåg om du valde ljusa eller mörka färger för den här butiken; sparas i webbläsaren tills du väljer igen.",
      da: "Husker, om du valgte lyse eller mørke farver til denne butik; gemmes i din browser, indtil du vælger igen.",
    },
  },
  {
    // In local storage, not a cookie: set in Kaizen's admin by someone signed in who chooses light or dark (D99).
    name: "kaizen_admin_color_mode",
    pattern: /^kaizen_admin_color_mode$/,
    provider: "Kaizen",
    category: "necessary",
    days: null,
    on: "platform",
    purpose: {
      en: "In Kaizen's admin: remembers whether you chose light or dark colours, so pages open in them.",
      nb: "I Kaizens administrasjon: husker om du valgte lyse eller mørke farger, så sidene åpnes med dem.",
      sv: "I Kaizens administration: kommer ihåg om du valde ljusa eller mörka färger, så att sidorna öppnas med dem.",
      da: "I Kaizens administration: husker, om du valgte lyse eller mørke farver, så siderne åbner med dem.",
    },
  },
  {
    // In the tab's session storage, not a cookie: only once a visitor writes to the chat agent (D81).
    name: "kaizen_chat",
    pattern: /^kaizen_chat$/,
    provider: "Kaizen",
    category: "necessary",
    days: null,
    on: "both",
    chat: true,
    purpose: {
      en: "Keeps your conversation with the chat assistant while you move between pages; gone when you close the tab.",
      nb: "Husker samtalen din med chatassistenten mens du går mellom sidene; forsvinner når du lukker fanen.",
      sv: "Kommer ihåg ditt samtal med chattassistenten medan du går mellan sidorna; försvinner när du stänger fliken.",
      da: "Husker din samtale med chatassistenten, mens du går mellem siderne; forsvinder, når du lukker fanen.",
    },
  },
  {
    // In the tab's session storage, not a cookie: only on a store whose recommendations are on, and only what the visitor does in this tab (D139).
    name: "kaizen_rec",
    pattern: /^kaizen_rec$/,
    provider: "Kaizen",
    category: "necessary",
    days: null,
    on: "store",
    recommendations: true,
    purpose: {
      en: "Remembers in this tab which products you looked at, what you searched for and which recommended products you opened, so the store can suggest products that suit you; gone when you close the tab, never joined to who you are.",
      nb: "Husker i denne fanen hvilke produkter du så på, hva du søkte etter og hvilke anbefalte produkter du åpnet, slik at butikken kan foreslå produkter som passer deg; forsvinner når du lukker fanen og kobles aldri til hvem du er.",
      sv: "Kommer ihåg i den här fliken vilka produkter du tittade på, vad du sökte efter och vilka rekommenderade produkter du öppnade, så att butiken kan föreslå produkter som passar dig; försvinner när du stänger fliken och kopplas aldrig till vem du är.",
      da: "Husker i denne fane, hvilke produkter du så på, hvad du søgte efter, og hvilke anbefalede produkter du åbnede, så butikken kan foreslå produkter, der passer til dig; forsvinder, når du lukker fanen, og knyttes aldrig til, hvem du er.",
    },
  },
  {
    // Two cookies and one item of session storage, only in a store with a running A/B test (D148) and only once a visitor has allowed statistics.
    name: "kaizen_ab_…",
    pattern: /^kaizen_ab(_[0-9a-f-]{36}|_reload)?$/,
    provider: "Kaizen",
    category: "statistics",
    days: 90,
    on: "store",
    experiments: true,
    purpose: {
      en: "Remembers which version of a page the store is trying on you (an A/B test), by a random number that belongs to this store only, so you see the same version each time and the store can learn which works better; never joined to who you are.",
      nb: "Husker hvilken versjon av en side butikken prøver ut på deg (en A/B-test), med et tilfeldig tall som bare hører til denne butikken, slik at du ser samme versjon hver gang og butikken kan lære hva som fungerer best; kobles aldri til hvem du er.",
      sv: "Kommer ihåg vilken version av en sida butiken testar på dig (ett A/B-test), med ett slumptal som bara hör till den här butiken, så att du ser samma version varje gång och butiken kan lära sig vad som fungerar bäst; kopplas aldrig till vem du är.",
      da: "Husker, hvilken version af en side butikken afprøver på dig (en A/B-test), med et tilfældigt tal, der kun hører til denne butik, så du ser den samme version hver gang, og butikken kan lære, hvad der virker bedst; knyttes aldrig til, hvem du er.",
    },
  },
  {
    // In the tab's session storage or local storage, not a cookie: only once a visitor who allowed preferences closes a
    // pop-up (a modal in a page, D121) that opens by itself, and only for one shown once per visit or every so many days.
    name: "kaizen_modal_…",
    pattern: /^kaizen_modal_[a-z0-9-]+$/,
    provider: "Kaizen",
    category: "preferences",
    days: null,
    on: "both",
    modals: true,
    purpose: {
      en: "Remembers that you closed a pop-up window, so it does not open again straight away; kept until you close the tab, or for the number of days the site has chosen.",
      nb: "Husker at du lukket et popup-vindu, slik at det ikke åpnes igjen med en gang; lagres til du lukker fanen, eller i så mange dager nettstedet har valgt.",
      sv: "Kommer ihåg att du stängde ett popup-fönster, så att det inte öppnas igen direkt; sparas tills du stänger fliken eller så många dagar som webbplatsen har valt.",
      da: "Husker, at du lukkede et popup-vindue, så det ikke åbner igen med det samme; gemmes, til du lukker fanen, eller i det antal dage, webstedet har valgt.",
    },
  },
  {
    // In a cookie, set by the sign-up page and only once a visitor who allowed marketing arrives by a referral link (D131).
    name: "kaizen_ref",
    pattern: /^kaizen_ref$/,
    provider: "Kaizen",
    category: "marketing",
    days: 30,
    on: "platform",
    referrals: true,
    purpose: {
      en: "Remembers which Kaizen store owner's referral link you came from, so they are credited if you ask for a store; kept for the number of days the referral program sets.",
      nb: "Husker hvilken Kaizen-butikkeiers anbefalingslenke du kom fra, slik at vedkommende får æren hvis du ber om en butikk; lagres i så mange dager som anbefalingsprogrammet bestemmer.",
      sv: "Kommer ihåg vilken Kaizen-butiksägares rekommendationslänk du kom från, så att hen krediteras om du ber om en butik; sparas i så många dagar som rekommendationsprogrammet bestämmer.",
      da: "Husker, hvilken Kaizen-butiksejers anbefalingslink du kom fra, så vedkommende krediteres, hvis du beder om en butik; gemmes i det antal dage, anbefalingsprogrammet bestemmer.",
    },
  },
  {
    // A cookie, written by the browser and only once a visitor has allowed marketing, in a store whose referral program
    // is on and only for a visitor who opened a friend's link (D131).
    name: "kaizen_aff_…",
    pattern: /^kaizen_aff_[0-9a-f-]{36}$/,
    provider: "Kaizen",
    category: "marketing",
    days: 90,
    on: "store",
    affiliate: true,
    feature: "referrals",
    purpose: {
      en: "Remembers which friend's referral link you came from, so the store can give you a welcome discount and thank them; the number of days is the store's choice, at most 90.",
      nb: "Husker hvilken venns tipslenke du kom fra, slik at butikken kan gi deg velkomstrabatt og takke vennen; antall dager bestemmer butikken, høyst 90.",
      sv: "Kommer ihåg vilken väns tipslänk du kom från, så att butiken kan ge dig välkomstrabatt och tacka vännen; antalet dagar bestämmer butiken, högst 90.",
      da: "Husker, hvilken vens anbefalingslink du kom fra, så butikken kan give dig velkomstrabat og takke vennen; antallet af dage bestemmer butikken, højst 90.",
    },
  },
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
    feature: "business",
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
    // Only while an owner connects Kaizen Life for the assistant (D96).
    name: "kaizen_life_link",
    pattern: /^kaizen_life_link$/,
    provider: "Kaizen",
    category: "necessary",
    days: null,
    on: "platform",
    purpose: {
      en: "Checks, for the ten minutes it takes, that a store owner connecting Kaizen Life comes back from the sign-in they started.",
      nb: "Sjekker, i de ti minuttene det tar, at en butikkeier som kobler til Kaizen Life kommer tilbake fra innloggingen de startet.",
      sv: "Kontrollerar, under de tio minuter det tar, att en butiksägare som ansluter Kaizen Life kommer tillbaka från inloggningen de startade.",
      da: "Kontrollerer, i de ti minutter det tager, at en butiksejer, der forbinder Kaizen Life, kommer tilbage fra det login, de startede.",
    },
  },
  {
    // Only while an owner adds Kaizen's Slack app to a channel (D101).
    name: "kaizen_slack_connect",
    pattern: /^kaizen_slack_connect$/,
    provider: "Kaizen",
    category: "necessary",
    days: null,
    on: "platform",
    purpose: {
      en: "Checks, for the ten minutes it takes, that a store owner connecting Slack comes back from the Slack page they started from.",
      nb: "Sjekker, i de ti minuttene det tar, at en butikkeier som kobler til Slack kommer tilbake fra Slack-siden de startet fra.",
      sv: "Kontrollerar, under de tio minuter det tar, att en butiksägare som ansluter Slack kommer tillbaka från Slack-sidan de startade från.",
      da: "Kontrollerer, i de ti minutter det tager, at en butiksejer, der forbinder Slack, kommer tilbage fra den Slack-side, de startede fra.",
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
  {
    buyers = false,
    chat = false,
    colorMode = false,
    modals = false,
    referrals = false,
    affiliate = false,
    recommendations = false,
    experiments = false,
  }: { buyers?: boolean; chat?: boolean; colorMode?: boolean; modals?: boolean; referrals?: boolean; affiliate?: boolean; recommendations?: boolean; experiments?: boolean } = {},
): KnownCookie[] {
  return KNOWN_COOKIES.filter(
    (cookie) =>
      (cookie.on === site || cookie.on === "both") &&
      (!cookie.buyers || buyers) &&
      (!cookie.chat || chat) &&
      (!cookie.colorMode || colorMode) &&
      (!cookie.modals || modals) &&
      (!cookie.affiliate || affiliate) &&
      (!cookie.recommendations || recommendations) &&
      (!cookie.experiments || experiments) &&
      (!cookie.referrals || referrals) &&
      (cookie.tool ? Boolean(tracking[cookie.tool]) : cookie.provider !== "Stripe"),
  );
}
