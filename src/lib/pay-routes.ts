/**
 * The routes where a shopper pays (wave 1, 1e, `docs/wave-1-trust.md` 2.5, `docs/pci.md`): a store's cart, checkout and
 * order. They send a strict Content-Security-Policy (`checkoutCsp()`), draw nothing from the layout's `@extras` slot (the
 * consent banner and the owner's own code, the chat widget, a friend's referral link and the business popup) and are
 * entered by full page loads, so a script an earlier page added to the document is not still there. Pure, so
 * `next.config.ts`, the tests and the guard in the browser share it.
 */

/** The three routes, as their segment after the market. */
export const PAY_SEGMENTS = ["cart", "checkout", "order"] as const;
export type PaySegment = (typeof PAY_SEGMENTS)[number];

/**
 * A market in an address: the country with a language and a currency (`no`, `no-en`, `no-eur`, `no-en-eur`, D109) and,
 * while a visitor is in a test of the header, footer or layout, the tokens after `~` (D148). Loose on the tokens on
 * purpose: a market that is not one finds no page, and a stricter pattern here would only leave a real one unprotected.
 */
export const MARKET_PARAM = "[a-z]{2}(?:-[a-z]{2,3}){0,2}(?:~[a-z0-9_]+)?";

/**
 * The patterns `next.config.ts` sends the policy on, one for each shape of address: `/s/{store}/{market}/…` and, on a
 * store's own host, `/{market}/…` (which the host routing serves from the same pages). `:path*` is nothing or more.
 */
export const PAY_SOURCES: readonly string[] = [
  `/s/:store/:market(${MARKET_PARAM})/:route(cart|checkout|order)/:path*`,
  `/:market(${MARKET_PARAM})/:route(cart|checkout|order)/:path*`,
];

const MARKET = new RegExp(`^${MARKET_PARAM}$`);

/** Whether an address (a path, with or without a query) is a store's cart, checkout or order, on either shape of address. */
export function isPayPath(pathname: string): boolean {
  const segments = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  const own = segments[0] === "s" ? 2 : 0;
  const market = segments[own];
  const route = segments[own + 1];
  if (own === 2 && segments.length < 4) return false;
  return market !== undefined && MARKET.test(market) && (PAY_SEGMENTS as readonly string[]).includes(route ?? "");
}

/**
 * Modules a pay route, and so anything it imports, must never reach (a test walks the import graph of the market layout's
 * pay slots and of the cart, checkout and order routes): the consent banner and manager that load tracking tools, the owner's
 * own code, the chat widget, a friend's referral capture and the business popup. A path fragment each, of a file under `src/`.
 */
export const FORBIDDEN_ON_PAY_ROUTES: readonly string[] = [
  "components/consent/site-consent",
  "components/consent/consent-manager",
  "components/consent/store-custom-code",
  "lib/custom-code",
  "components/site-chat",
  "components/chat-widget",
  "components/store-affiliate",
  "components/affiliate-capture",
  "components/buyer",
];

/** The file name, relative to `src/`, without its extension, as `FORBIDDEN_ON_PAY_ROUTES` names it. */
export const importsForbidden = (specifier: string): string | undefined =>
  FORBIDDEN_ON_PAY_ROUTES.find((fragment) => specifier === fragment || specifier.endsWith(`/${fragment}`) || specifier === `@/${fragment}`);

/**
 * A hosted invoice or credit note, `/s/{store}/{market}/account/documents/{token}` (and its `/pdf`), on either shape of address (D159,
 * `docs/wave-1b-invoices.md` 2.2 point 4 and 3.5). Not a pay route (no card is typed, so no policy of its own), but the address holds a
 * bearer token that opens a document with a buyer's name, address, email and VAT number: the consent banner's tracking tools and the
 * owner's own code read `location.href`, and the chat widget and the referral capture are other sites' reach too, so the layout draws
 * none of them here, and a document is entered by a full page load like a pay route.
 */
export function isDocumentPath(pathname: string): boolean {
  const segments = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  const own = segments[0] === "s" ? 2 : 0;
  const market = segments[own];
  return market !== undefined && MARKET.test(market) && segments[own + 1] === "account" && segments[own + 2] === "documents" && segments.length > own + 3;
}

/**
 * A draft order's pay link, `/s/{store}/{market}/account/pay/{token}` (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1), on either shape of address. Like a hosted document its address
 * holds a bearer token, here one that opens a buyer's own order and the way to pay it, so the layout draws no tracking, owner code, chat or referral capture on it either, and it is entered by a
 * full page load. It is not a pay route in the policy's sense: no card is typed on it (the button hands the buyer to Stripe's own page), so it needs no policy of its own.
 */
export function isPayLinkPath(pathname: string): boolean {
  const segments = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  const own = segments[0] === "s" ? 2 : 0;
  const market = segments[own];
  return market !== undefined && MARKET.test(market) && segments[own + 1] === "account" && segments[own + 2] === "pay" && segments.length > own + 3;
}

/**
 * The pay link of a change to a paid order, `/s/{store}/{market}/account/change/{token}` (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4), on either shape of address. Like a draft's pay
 * link its address holds a bearer token that opens a customer's own order and the way to pay a difference, so the layout draws no tracking, owner code, chat or referral capture on it, and it
 * is entered by a full page load. No card is typed on it (the button hands the customer to Stripe's own page), so it is not a pay route in the policy's sense.
 */
export function isChangeLinkPath(pathname: string): boolean {
  const segments = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  const own = segments[0] === "s" ? 2 : 0;
  const market = segments[own];
  return market !== undefined && MARKET.test(market) && segments[own + 1] === "account" && segments[own + 2] === "change" && segments.length > own + 3;
}

/**
 * Where the market layout draws none of its extras (`MarketExtras`) and a script from an earlier page must not still be in the document: the pay routes, the hosted documents, a draft's pay
 * link and a change's pay link.
 */
export const isNoExtrasPath = (pathname: string): boolean => isPayPath(pathname) || isDocumentPath(pathname) || isPayLinkPath(pathname) || isChangeLinkPath(pathname);
