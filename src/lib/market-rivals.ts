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
