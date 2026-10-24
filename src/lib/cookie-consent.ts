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
export type TrackingSettings = {
  ga4?: string;
  gtm?: string;
  metaPixel?: string;
  /** Google Ads' tag (`AW-…`, D303 I1): remarketing and the shop events; purchases are measured through GA4 linking. */
  googleAds?: string;
  tiktokPixel?: string;
  pinterestTag?: string;
};

/** The ads tags only a store may switch on (D303 I1); Kaizena Flow's own site keeps GA4, Tag Manager and the Meta Pixel. */
export const STORE_ONLY_TOOLS = ["googleAds", "tiktokPixel", "pinterestTag"] as const;

/** The categories a set of tools needs consent for: Analytics is statistics; the Pixel marketing; Tag Manager may run either. */
export function toolCategories(tracking: TrackingSettings): OptionalCategory[] {
  const used = new Set<OptionalCategory>();
  if (tracking.ga4) used.add("statistics");
  if (tracking.gtm) {
    used.add("statistics");
    used.add("marketing");
  }
  if (tracking.metaPixel || tracking.googleAds || tracking.tiktokPixel || tracking.pinterestTag) used.add("marketing");
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
  /** The tool (or any of the tools) that sets it. */
  tool?: keyof TrackingSettings | (keyof TrackingSettings)[];
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
  /** Set only on Kaizena Flow's own site while it is offered in more than one language (D312). */
  languages?: boolean;
  /** Set only in stores whose referral program (the affiliate program, D131) is on. */
  affiliate?: boolean;
  /** Set only in stores whose product recommendations are on (D139). */
  recommendations?: boolean;
  /** Set only in stores with a running A/B test (D148). */
  experiments?: boolean;
  /** Only in a store that counts visits and asks about statistics (D303 I3). */
  touch?: boolean;
  /**
   * Set only for signed-in staff, by something they press (D193): known, so a scan that meets it calls it necessary, but never part
   * of what a visitor's cookie page declares, as no visitor is given it.
   */
  staff?: boolean;
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
    provider: "Kaizena Flow",
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
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "platform",
    purpose: {
      en: "In Kaizena Flow's admin: remembers whether you chose light or dark colours, so pages open in them.",
      nb: "I Kaizena Flows administrasjon: husker om du valgte lyse eller mørke farger, så sidene åpnes med dem.",
      sv: "I Kaizena Flows administration: kommer ihåg om du valde ljusa eller mörka färger, så att sidorna öppnas med dem.",
      da: "I Kaizena Flows administration: husker, om du valgte lyse eller mørke farver, så siderne åbner med dem.",
    },
  },
  {
    // In local storage, not a cookie: set in Kaizen's admin by someone signed in who chooses a colour scheme (D221).
    name: "kaizen_admin_scheme",
    pattern: /^kaizen_admin_scheme$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "platform",
    purpose: {
      en: "In Kaizena Flow's admin: remembers the colour scheme you chose, so pages open in it.",
      nb: "I Kaizena Flows administrasjon: husker fargeskjemaet du valgte, så sidene åpnes med det.",
      sv: "I Kaizena Flows administration: kommer ihåg färgschemat du valde, så att sidorna öppnas med det.",
      da: "I Kaizena Flows administration: husker det farveskema, du valgte, så siderne åbner med det.",
    },
  },
  {
    // In local storage, not a cookie: set in Kaizen's admin for someone signed in, the language their account shows the admin in (D312 A0).
    name: "kaizen_admin_lang",
    pattern: /^kaizen_admin_lang$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "platform",
    staff: true,
    purpose: {
      en: "In Kaizena Flow's admin: remembers the language your account shows the admin in, so pages open marked in it.",
      nb: "I Kaizena Flows administrasjon: husker språket kontoen din viser administrasjonen på, så sidene åpnes merket med det.",
      sv: "I Kaizena Flows administration: kommer ihåg språket ditt konto visar administrationen på, så att sidorna öppnas märkta med det.",
      da: "I Kaizena Flows administration: husker det sprog, din konto viser administrationen på, så siderne åbner mærket med det.",
    },
  },
  {
    // In local storage, not a cookie: set in Kaizen's admin by someone signed in who shows the rail's names (D262).
    name: "kaizen_admin_rail",
    pattern: /^kaizen_admin_rail$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "platform",
    staff: true,
    purpose: {
      en: "In Kaizena Flow's admin: remembers that you chose to see the sections' names beside their icons.",
      nb: "I Kaizena Flows administrasjon: husker at du valgte å se navnene på seksjonene ved siden av ikonene.",
      sv: "I Kaizena Flows administration: kommer ihåg att du valde att se avsnittens namn bredvid ikonerna.",
      da: "I Kaizena Flows administration: husker, at du valgte at se afsnittenes navne ved siden af ikonerne.",
    },
  },
  {
    // In local storage, not a cookie: set in the admin's page builder by someone signed in who folds a sidebar or drags its edge (D125, D262).
    name: "kaizen_admin_builder_…",
    pattern: /^kaizen_admin_builder_(left|right)(_width)?$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "platform",
    staff: true,
    purpose: {
      en: "In Kaizena Flow's page builder: remembers whether you folded a sidebar away and how wide you made it.",
      nb: "I Kaizena Flows sidebygger: husker om du skjulte et sidepanel og hvor bredt du gjorde det.",
      sv: "I Kaizena Flows sidbyggare: kommer ihåg om du fällde ihop en sidopanel och hur bred du gjorde den.",
      da: "I Kaizena Flows sidebygger: husker, om du foldede et sidepanel sammen, og hvor bredt du gjorde det.",
    },
  },
  {
    // In the tab's session storage, not a cookie: only once a visitor writes to the chat agent (D81).
    name: "kaizen_chat",
    pattern: /^kaizen_chat$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "both",
    chat: true,
    purpose: {
      // legal: needs review (D216, docs/support.md 8).
      en: "Remembers which chat conversation is yours and a copy of it while you move between pages; gone when you close the tab. The conversation itself is kept by the site for a limited time.",
      nb: "Husker hvilken chatsamtale som er din og en kopi av den mens du går mellom sidene; forsvinner når du lukker fanen. Selve samtalen lagres av nettstedet en begrenset tid.",
      sv: "Kommer ihåg vilken chattkonversation som är din och en kopia av den medan du går mellan sidorna; försvinner när du stänger fliken. Själva konversationen sparas av webbplatsen en begränsad tid.",
      da: "Husker, hvilken chatsamtale der er din, og en kopi af den, mens du går mellem siderne; forsvinder, når du lukker fanen. Selve samtalen gemmes af webstedet i en begrænset tid.",
    },
  },
  {
    // In the tab's session storage, not a cookie: only on a store whose recommendations are on, and only what the visitor does in this tab (D139).
    name: "kaizen_rec",
    pattern: /^kaizen_rec$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "store",
    recommendations: true,
    // The online shop's (D178 step 5): a website sets none of it.
    feature: "shop",
    purpose: {
      en: "Remembers in this tab which products you looked at, what you searched for and which recommended products you opened, so the store can suggest products that suit you; gone when you close the tab, never joined to who you are.",
      nb: "Husker i denne fanen hvilke produkter du så på, hva du søkte etter og hvilke anbefalte produkter du åpnet, slik at butikken kan foreslå produkter som passer deg; forsvinner når du lukker fanen og kobles aldri til hvem du er.",
      sv: "Kommer ihåg i den här fliken vilka produkter du tittade på, vad du sökte efter och vilka rekommenderade produkter du öppnade, så att butiken kan föreslå produkter som passar dig; försvinner när du stänger fliken och kopplas aldrig till vem du är.",
      da: "Husker i denne fane, hvilke produkter du så på, hvad du søgte efter, og hvilke anbefalede produkter du åbnede, så butikken kan foreslå produkter, der passer til dig; forsvinder, når du lukker fanen, og knyttes aldrig til, hvem du er.",
    },
  },
  {
    // Only in a store that counts visits and already asks about statistics, once a visitor has allowed it (D303 I3).
    name: "kaizen_touch_…",
    pattern: /^kaizen_touch_[0-9a-f-]{36}$/,
    provider: "Kaizena Flow",
    category: "statistics",
    days: 30,
    on: "store",
    touch: true,
    purpose: {
      en: "Remembers where your first visit in the last 30 days came from (an ad, a search, another site), so the store can see which of its campaigns bring customers; no number that identifies you, never joined to who you are.",
      nb: "Husker hvor ditt første besøk de siste 30 dagene kom fra (en annonse, et søk, et annet nettsted), slik at butikken kan se hvilke kampanjer som gir kunder; ingen nummer som identifiserer deg, og kobles aldri til hvem du er.",
      sv: "Kommer ihåg var ditt första besök de senaste 30 dagarna kom från (en annons, en sökning, en annan webbplats), så att butiken kan se vilka kampanjer som ger kunder; inget nummer som identifierar dig, och kopplas aldrig till vem du är.",
      da: "Husker, hvor dit første besøg de seneste 30 dage kom fra (en annonce, en søgning, et andet websted), så butikken kan se, hvilke kampagner der giver kunder; intet nummer, der identificerer dig, og knyttes aldrig til, hvem du er.",
    },
  },
  {
    // Two cookies and one item of session storage, only in a store with a running A/B test (D148) and only once a visitor has allowed statistics.
    name: "kaizen_ab_…",
    pattern: /^kaizen_ab(_[0-9a-f-]{36}|_reload)?$/,
    provider: "Kaizena Flow",
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
    provider: "Kaizena Flow",
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
    // In local storage, not a cookie: only once a visitor who allowed preferences closes the bar suggesting the site in their browser's
    // language (D312, `LanguageHint`); without that choice the bar is closed for the page view only.
    name: "kaizen_lang_hint",
    pattern: /^kaizen_lang_hint$/,
    provider: "Kaizena Flow",
    category: "preferences",
    days: null,
    on: "platform",
    languages: true,
    purpose: {
      en: "Remembers that you closed the suggestion to read Kaizena Flow's site in another language, so it is not shown again; kept in your browser until you clear it.",
      nb: "Husker at du lukket forslaget om å lese Kaizena Flows nettsted på et annet språk, slik at det ikke vises igjen; lagres i nettleseren til du sletter det.",
      sv: "Kommer ihåg att du stängde förslaget att läsa Kaizena Flows webbplats på ett annat språk, så att det inte visas igen; sparas i webbläsaren tills du rensar det.",
      da: "Husker, at du lukkede forslaget om at læse Kaizena Flows websted på et andet sprog, så det ikke vises igen; gemmes i browseren, til du sletter det.",
    },
  },
  {
    // In a cookie, set by the sign-up page and only once a visitor who allowed marketing arrives by a referral link (D131).
    name: "kaizen_ref",
    pattern: /^kaizen_ref$/,
    provider: "Kaizena Flow",
    category: "marketing",
    days: 30,
    on: "platform",
    referrals: true,
    purpose: {
      en: "Remembers which Kaizena Flow store owner's referral link you came from, so they are credited if you ask for a store; kept for the number of days the referral program sets.",
      nb: "Husker hvilken Kaizena Flow-butikkeiers anbefalingslenke du kom fra, slik at vedkommende får æren hvis du ber om en butikk; lagres i så mange dager som anbefalingsprogrammet bestemmer.",
      sv: "Kommer ihåg vilken Kaizena Flow-butiksägares rekommendationslänk du kom från, så att hen krediteras om du ber om en butik; sparas i så många dagar som rekommendationsprogrammet bestämmer.",
      da: "Husker, hvilken Kaizena Flow-butiksejers anbefalingslink du kom fra, så vedkommende krediteres, hvis du beder om en butik; gemmes i det antal dage, anbefalingsprogrammet bestemmer.",
    },
  },
  {
    // A cookie, written by the browser and only once a visitor has allowed marketing, in a store whose referral program
    // is on and only for a visitor who opened a friend's link (D131).
    name: "kaizen_aff_…",
    pattern: /^kaizen_aff_[0-9a-f-]{36}$/,
    provider: "Kaizena Flow",
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
    provider: "Kaizena Flow",
    category: "necessary",
    days: 30,
    on: "store",
    // The online shop's (D178 step 5): a website sets none of it.
    feature: "shop",
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
    provider: "Kaizena Flow",
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
    provider: "Kaizena Flow",
    category: "necessary",
    days: 365,
    on: "store",
    // The online shop's (D178 step 5): a website sets none of it.
    feature: "shop",
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
    provider: "Kaizena Flow",
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
    provider: "Kaizena Flow",
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
    provider: "Kaizena Flow (Supabase)",
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
    provider: "Kaizena Flow",
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
    provider: "Kaizena Flow",
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
    // Only while an owner connects the store's Mollie account to Kaizena Flow (D292).
    name: "kaizen_mollie_connect",
    pattern: /^kaizen_mollie_connect$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "platform",
    purpose: {
      en: "Checks, for the ten minutes it takes, that a store owner connecting Mollie comes back from the Mollie page they started from.",
      nb: "Sjekker, i de ti minuttene det tar, at en butikkeier som kobler til Mollie kommer tilbake fra Mollie-siden de startet fra.",
      sv: "Kontrollerar, under de tio minuter det tar, att en butiksägare som ansluter Mollie kommer tillbaka från Mollie-sidan de startade från.",
      da: "Kontrollerer, i de ti minutter det tager, at en butiksejer, der forbinder Mollie, kommer tilbage fra den Mollie-side, de startede fra.",
    },
  },
  {
    // Only for signed-in staff who press "Edit text" on a store's own domain, where the admin's sign-in cannot be seen (D193); closed to scripts.
    name: "kaizen_edit",
    pattern: /^kaizen_edit$/,
    provider: "Kaizena Flow",
    category: "necessary",
    days: null,
    on: "store",
    staff: true,
    purpose: {
      en: "Lets a store's own signed-in staff change the words of a page they are looking at, for half an hour after the admin gave them the pass.",
      nb: "Lar butikkens egne innloggede ansatte endre ordene på en side de ser på, i en halvtime etter at administrasjonen ga dem tilgang.",
      sv: "Låter butikens egna inloggade medarbetare ändra orden på en sida de tittar på, i en halvtimme efter att administrationen gav dem tillgång.",
      da: "Lader butikkens egne loggede ansatte ændre ordene på en side, de ser på, i en halv time, efter at administrationen gav dem adgang.",
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
    pattern: /^_gcl_(au|aw|dc|gb|ag)$/,
    provider: "Google Ads",
    category: "marketing",
    days: 90,
    on: "both",
    tool: ["gtm", "googleAds"],
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
  {
    name: "_ttp",
    pattern: /^(_ttp|_tt_enable_cookie|ttcsid.*)$/,
    provider: "TikTok",
    category: "marketing",
    days: 390,
    on: "store",
    tool: "tiktokPixel",
    purpose: {
      en: "Lets TikTok show and measure ads to people who visited the site.",
      nb: "Lar TikTok vise og måle annonser til folk som har besøkt nettstedet.",
      sv: "Låter TikTok visa och mäta annonser för personer som har besökt webbplatsen.",
      da: "Lader TikTok vise og måle annoncer til personer, der har besøgt webstedet.",
    },
  },
  {
    name: "_pin_unauth",
    pattern: /^(_pin_unauth|_pinterest_ct_ua|_epik|_derived_epik)$/,
    provider: "Pinterest",
    category: "marketing",
    days: 365,
    on: "store",
    tool: "pinterestTag",
    purpose: {
      en: "Lets Pinterest show and measure ads to people who visited the site.",
      nb: "Lar Pinterest vise og måle annonser til folk som har besøkt nettstedet.",
      sv: "Låter Pinterest visa och mäta annonser för personer som har besökt webbplatsen.",
      da: "Lader Pinterest vise og måle annoncer til personer, der har besøgt webstedet.",
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
    languages = false,
    touch = false,
  }: { buyers?: boolean; chat?: boolean; colorMode?: boolean; modals?: boolean; referrals?: boolean; affiliate?: boolean; recommendations?: boolean; experiments?: boolean; languages?: boolean; touch?: boolean } = {},
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
      !cookie.staff &&
      (!cookie.referrals || referrals) &&
      (!cookie.languages || languages) &&
      (!cookie.touch || touch) &&
      (cookie.tool ? [cookie.tool].flat().some((tool) => Boolean(tracking[tool])) : cookie.provider !== "Stripe"),
  );
}
