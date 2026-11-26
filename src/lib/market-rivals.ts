import { minorUnitDigits } from "./money";

/**
 * A store's rivals (D900 M2, `docs/market-check.md` 4), the pure parts: a rival's web host from what the owner typed, whether a page is the
 * rival's own, the limits, and how a rival's offer is held against the store's own price. The facts are read by `readOfferPage()` from the
 * page's own data and kept by `src/server/market-rivals.ts`; the comparison is worked out here, never by a model.
 */

/** Rivals a store keeps in one country, and offers it keeps of one rival. */
export const RIVALS_PER_MARKET = 8;
export const OFFERS_PER_RIVAL = 50;
/** How much dearer the store's product must be than a rival's before it is a finding (a tenth). */
export const PRICE_GAP_MIN = 0.1;
/** An offer read longer ago than this is old: shown so, and no finding rests on it. */
export const OFFER_FRESH_DAYS = 30;
/** The watcher reads an offer again once it was read longer ago than this (D900 M3): before it goes old. */
export const RIVAL_WATCH_DAYS = 28;
/** After the watcher could not read a page, it waits this long before it tries that page again. */
export const RIVAL_RETRY_DAYS = 7;
/** Offers the watcher reads in one run of the five-minute dispatcher, and at most in a day for one store: the store's research keeps the rest of its pages. */
export const WATCH_PER_RUN = 3;
export const WATCH_PER_STORE_DAY = 30;
/** How far a rival's price must fall between two reads before it is a threat (a twentieth): smaller moves are noise. */
export const RIVAL_MOVE_MIN = 0.05;

/** A shop's host from what the owner typed (`https://www.shop.example/p`, `shop.example`): lower case, without `www.`; null if none. */
export function rivalHost(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host) && host.includes(".") && host.length <= 253 ? host : null;
}

/** Whether a page's address is on the rival's own site: its host, or a host below it (`www.`, `shop.`), over https. */
export function onRivalSite(host: string, address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const h = url.hostname.toLowerCase().replace(/\.$/, "");
  return h === host || h.endsWith(`.${host}`);
}

/** The store's own price for a product in a country: the lowest of its variants' current prices there, VAT included, as shoppers see it. */
export type OwnPrice = { priceMinor: number; currency: string };

/** What a read of an offer's page states, and what is compared between two reads (D900 M3, `keepOffer()`'s comparison in SQL). */
export type OfferState = {
  /** The rival's price as its page states it (an `AggregateOffer`'s lowest), in minor units of `currency`. */
  priceMinor: number;
  currency: string;
  /** As `pageOffers()` read it: `in_stock`, `out_of_stock`, `discontinued`, … or `unknown`. */
  availability: string;
  /** The cheapest shipping the page states, and its currency; null when it states none. */
  shippingMinor: number | null;
  shippingCurrency: string | null;
  /** The returns window in days the page states; null when it states none. */
  returnDays: number | null;
};

export type RivalOfferFacts = OfferState & {
  rivalName: string;
  market: string;
  productName: string;
  own: OwnPrice | null;
  readAt: string;
  /** The state before the last read that changed it, and when that was read; null until a read changes something. */
  previous: (OfferState & { readAt: string }) | null;
  /** When a read last found it changed. */
  changedAt: string | null;
};

/** A rival's move against the store between two reads (D900 M3): a lower price, cheaper shipping or a longer returns window. */
export type RivalMove = { move: "price" | "shipping" | "returns"; before: number; after: number; currency: string | null };

/**
 * What a rival changed in its own favour since its page was read before, or null: its price down by at least `RIVAL_MOVE_MIN` in the same
 * currency, else its shipping down (to free included) in the same currency, else its returns window longer. Only on a fresh offer changed
 * within `OFFER_FRESH_DAYS`: an old change is no longer news.
 */
export function rivalMove(o: Pick<RivalOfferFacts, keyof OfferState | "previous" | "changedAt" | "readAt">, now: Date): RivalMove | null {
  const before = o.previous;
  if (!before || !o.changedAt || !offerFresh(o.readAt, now) || !offerFresh(o.changedAt, now)) return null;
  if (before.currency === o.currency && before.priceMinor > 0 && (before.priceMinor - o.priceMinor) / before.priceMinor >= RIVAL_MOVE_MIN) {
    return { move: "price", before: before.priceMinor, after: o.priceMinor, currency: o.currency };
  }
  if (before.shippingMinor !== null && o.shippingMinor !== null && before.shippingCurrency === o.shippingCurrency && o.shippingMinor < before.shippingMinor) {
    return { move: "shipping", before: before.shippingMinor, after: o.shippingMinor, currency: o.shippingCurrency };
  }
  if (before.returnDays !== null && o.returnDays !== null && o.returnDays > before.returnDays) {
    return { move: "returns", before: before.returnDays, after: o.returnDays, currency: null };
  }
  return null;
}

/** A rival's offer it cannot sell now: out of stock or discontinued on its own page (a gap it leaves, D900 M2). */
export const rivalGone = (availability: string) => availability === "out_of_stock" || availability === "discontinued";

/**
 * How much dearer the store's price is than the rival's (0.15 is 15 % dearer, negative cheaper), or null when there is no own price or the
 * two are in different currencies: a price is never converted to be compared.
 */
export function priceGap(own: OwnPrice | null, rival: { priceMinor: number; currency: string }): number | null {
  if (!own || own.currency !== rival.currency || rival.priceMinor <= 0) return null;
  return (own.priceMinor - rival.priceMinor) / rival.priceMinor;
}

/** Whether an offer was read within `OFFER_FRESH_DAYS` of `now`. */
export function offerFresh(readAt: string, now: Date): boolean {
  const at = Date.parse(readAt);
  return Number.isFinite(at) && now.getTime() - at <= OFFER_FRESH_DAYS * 86_400_000;
}

/** Other store platforms' prices (D900 M4): the watcher reads a price's page again once it was checked longer ago than this, a few a run. */
export const PLATFORM_WATCH_DAYS = 28;
export const PLATFORM_WATCH_PER_RUN = 2;

/** The marks a page writes beside a price in each currency it may show: its symbol, its code, and the Nordic `kr`. */
const CURRENCY_MARKS: Readonly<Record<string, readonly string[]>> = {
  EUR: ["€", "eur"],
  USD: ["$", "us$", "usd"],
  GBP: ["£", "gbp"],
  NOK: ["kr", "nok", ",-"],
  SEK: ["kr", "sek", ":-"],
  DKK: ["kr", "dkk", ",-"],
  CHF: ["chf", "fr."],
  PLN: ["zł", "pln"],
  CZK: ["kč", "czk"],
  ISK: ["kr", "isk"],
};

/** How an amount in major units may be written: with or without decimals and thousands marks, as pages write them. */
function amountSpellings(minor: number, digits: number): string[] {
  const whole = Math.floor(minor / 10 ** digits);
  const fraction = digits > 0 ? String(minor % 10 ** digits).padStart(digits, "0") : "";
  const grouped = (mark: string) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, mark);
  const wholes = [...new Set([String(whole), grouped(" "), grouped(","), grouped(".")])];
  if (!fraction || /^0+$/.test(fraction)) return [...wholes, ...wholes.flatMap((w) => (digits > 0 ? [`${w}.${"0".repeat(digits)}`, `${w},${"0".repeat(digits)}`] : []))];
  return wholes.flatMap((w) => [`${w}.${fraction}`, `${w},${fraction}`]);
}

/**
 * Whether a page's readable text states this price (D900 M4): the amount as pages write it, standing alone as a number, with the currency's
 * mark within a few characters before or after. Code reads the page for the figure a person kept; the model never reads a price off it.
 */
export function priceOnPage(text: string, minor: number, currency: string): boolean {
  const digits = minorUnitDigits(currency);
  const marks = CURRENCY_MARKS[currency] ?? [currency.toLowerCase()];
  const flat = text.replace(/[\u00a0\u202f\u2009]/g, " ").toLowerCase();
  for (const spelling of amountSpellings(minor, digits)) {
    const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = new RegExp(`(?<![\\d.,])${escaped}(?![\\d]|[.,]\\d)`, "g");
    for (const m of flat.matchAll(found)) {
      const around = flat.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
      if (marks.some((mark) => around.includes(mark))) return true;
    }
  }
  return false;
}

// What changed on a rival's site (D905, market check M5a, `docs/market-check.md` 7.2) ---------------------------------------------------

/** Sitemap files read of a rival's site at a time (an index's files followed), and the paths kept of one rival at most. */
export const SITE_FILES_MAX = 5;
export const RIVAL_PATHS_MAX = 1_000;
/** A rival's site is read again once it was read (or tried) longer ago than this, a few a run of the five-minute dispatcher. */
export const SITE_WATCH_DAYS = 7;
export const SITES_PER_RUN = 2;
/** The days a site's added and gone pages are counted over, and kept gone for. */
export const SITE_WINDOW_DAYS = 30;
/** Pages a rival must add in `SITE_WINDOW_DAYS`, and more than twice what the store published, before it is a finding. */
export const SITE_ADDED_MIN = 5;

/** Why a read of a rival's site listed nothing: its robots.txt closed it or could not be heard, no sitemap could be read, or it listed no page. */
export type SiteProblem = "robots" | "unread" | "none";

/** What is known of a rival's site from its sitemaps (`rivalSites()` in `src/server/market-rivals.ts`). */
export type RivalSiteFacts = {
  rivalId: string;
  rivalName: string;
  market: string;
  host: string;
  /** When the site was last read or tried; null until the watcher first reaches it. */
  readAt: string | null;
  /** When it was first listed: the pages seen then are where it started, never added. */
  since: string | null;
  /** The pages its last listing had, and whether that listing passed `RIVAL_PATHS_MAX` (then no page is marked gone, and no finding made). */
  pages: number | null;
  cut: boolean;
  problem: SiteProblem | null;
  /** Pages first seen, and pages gone, within `SITE_WINDOW_DAYS` (none added before `since`). */
  added: number;
  gone: number;
  /** The part of the site most of the added pages are under (`/blog`), when at least two are. */
  section: string | null;
  /** The newest added paths, newest first, at most five. */
  newest: string[];
};

const LOCALE_PART = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;

/**
 * The part of a site a path is under: its first part (`/blog/a` is `/blog`), or its first two where the first is a language (`/en/blog/a`
 * is `/en/blog`). Null for the front page and for a page that is a part of its own (`/about`): a part has pages under it.
 */
export function pathSection(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const take = parts.length > 2 && LOCALE_PART.test(parts[0]) ? 2 : 1;
  if (parts.length <= take) return null;
  return `/${parts.slice(0, take).join("/").toLowerCase()}`.slice(0, 120);
}

/** A path as a person reads it: its escapes decoded where they are text (`/tjenester/r%C3%B8r` is `/tjenester/rør`). */
export function pathShown(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * A rival's site growing faster than the store's own (D905): a complete listing (not cut), first listed before, with at least
 * `SITE_ADDED_MIN` pages added in `SITE_WINDOW_DAYS` and more than twice the pages the store first published in that time. Null otherwise:
 * a rival that grows less is shown, not found.
 */
export function siteGrowth(site: Pick<RivalSiteFacts, "since" | "cut" | "added">, published: number): number | null {
  if (!site.since || site.cut || site.added < SITE_ADDED_MIN || site.added <= 2 * published) return null;
  return site.added;
}
