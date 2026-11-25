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

export type RivalOfferFacts = {
  rivalName: string;
  market: string;
  productName: string;
  /** The rival's price as its page states it (an `AggregateOffer`'s lowest), in minor units of `currency`. */
  priceMinor: number;
  currency: string;
  own: OwnPrice | null;
  readAt: string;
};

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
