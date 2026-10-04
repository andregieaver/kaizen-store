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
