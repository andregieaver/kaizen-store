/**
 * Private mode (D339, `docs/wave-7-storefront.md` E), pure: which requests of a private store the landing page stands in for, where the
 * landing page is, where a visitor goes back to once let in, and the rules for the password. The proxy asks `privateDecision()` for every
 * page request of a store it knows is private, after the address's own decisions (D181, D313, D338), on the path as served (the long form).
 */

/** The landing page's place: `/s/{store}/private/{market}` (on the store's own host `/private/{market}`), under a root layout of its own. */
export const PRIVATE_SEGMENT = "private";

/**
 * What a shopper already has keeps working while a store is private (criterion 3): the order page (and its pay link and documents, under
 * `account`), My account, downloads, the withdrawal function and returns, unsubscribing, a subscription's and a box list's links. Nothing
 * that shows the catalogue or takes a new order is here.
 */
export const PRIVATE_OPEN_SEGMENTS: readonly string[] = ["order", "account", "download", "withdraw", "returns", "unsubscribe", "subscription", "deliveries"];

/** A market slug as the long form of an address writes it (`no`, `no-en`, `se-eur`, `eur`), with an A/B test's versions after `~`. */
const MARKET = /^(?:[a-z]{2}(?:-[a-z]{2,3}){0,2}|[a-z]{3})(?:~[a-z0-9_]+)?$/;

export type PrivateGate = {
  /** The store's address. */
  store: string;
  /** Whether the request came to the store's own host (no `/s/{store}` in its paths). */
  hostBased: boolean;
  /** The parts of the served path after `/s/{store}` (or after the host). */
  parts: readonly string[];
  /** The store's main market, for a request that names none (the country chooser). */
  mainMarket: string;
};

export type PrivateDecision =
  /** Served as asked: an open path, or the landing page itself. */
  | { open: true }
  /** The landing page in this market, from this path (on the request's own host). */
  | { landing: string; market: string };

/** Whether a request of a private store is let through or shown the landing page (for a visitor without a good pass). */
export function privateDecision(gate: PrivateGate): PrivateDecision {
  const [first = "", second = ""] = gate.parts;
  // The landing page itself, and the pages of what was already sold.
  if (first === PRIVATE_SEGMENT) return { open: true };
  const market = MARKET.test(first) ? first.split("~")[0] : gate.mainMarket;
  const rest = MARKET.test(first) ? second : first;
  if (PRIVATE_OPEN_SEGMENTS.includes(rest)) return { open: true };
  return { landing: privatePath(gate.store, gate.hostBased, market), market };
}

/** The landing page's path for a market, as a request's own host serves it. */
export function privatePath(store: string, hostBased: boolean, market: string): string {
  return `${hostBased ? "" : `/s/${store}`}/${PRIVATE_SEGMENT}/${market}`;
}

/**
 * Where a visitor let in goes: the path they asked for, as the browser had it (a path of this site, never another site, a protocol-relative
 * address or one with a backslash), else the store's home on this host.
 */
export function safeBack(to: string | null | undefined, fallback: string): string {
  if (typeof to !== "string" || to.length === 0 || to.length > 2000) return fallback;
  if (!to.startsWith("/") || to.startsWith("//") || to.includes("\\") || /[\u0000-\u001f]/.test(to)) return fallback;
  return to;
}

/** A store's password is a word shared with the people let in, not an account's: 4 to 100 characters, not only spaces. */
export const PRIVATE_PASSWORD_MIN = 4;
export const PRIVATE_PASSWORD_MAX = 100;

/** Why a password cannot be used, or null. */
export function privatePasswordProblem(password: string): "short" | "long" | null {
  const trimmed = password.trim();
  if (trimmed.length < PRIVATE_PASSWORD_MIN) return "short";
  if (password.length > PRIVATE_PASSWORD_MAX) return "long";
  return null;
}
