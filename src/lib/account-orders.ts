/**
 * Finding an order in My account (wave 5 unit J2, D304, `docs/wave-5-marketing.md` 11.2): the address of `/account/orders` read into a search, a
 * state and a keyset cursor. Pure; unknown keys are dropped and invalid values ignored. The search's words are D173's (`searchWords()`), bound
 * into SQL by `findCustomerOrders()` only.
 */
import { searchWords, type SearchWords } from "./order-search";

export const ACCOUNT_ORDERS_PAGE = 20;
export const ACCOUNT_ORDER_STATES = ["open", "sent", "delivered", "returned"] as const;
export type AccountOrderState = (typeof ACCOUNT_ORDER_STATES)[number];

export type AccountOrderCursor = { placedAt: string; id: string };

export type AccountOrderQuery = {
  search: SearchWords;
  state: AccountOrderState | null;
  /** The last order of the page before: the next page starts after it. */
  after: AccountOrderCursor | null;
};

const one = (raw: unknown): string => (typeof raw === "string" ? raw : Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cursor for the address: the order's time and id, base64url. */
export function cursorOf(c: AccountOrderCursor): string {
  return Buffer.from(`${c.placedAt}|${c.id}`, "utf8").toString("base64url");
}

export function readCursor(raw: string): AccountOrderCursor | null {
  if (!raw || raw.length > 120) return null;
  let text: string;
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [placedAt, id, ...rest] = text.split("|");
  if (rest.length || !id || !UUID.test(id) || Number.isNaN(Date.parse(placedAt ?? ""))) return null;
  return { placedAt: new Date(placedAt).toISOString(), id: id.toLowerCase() };
}

/** The address's `q`, `state` and `after`. */
export function parseAccountOrderParams(params: Record<string, unknown>): AccountOrderQuery {
  const state = one(params.state);
  return {
    search: searchWords(one(params.q)),
    state: (ACCOUNT_ORDER_STATES as readonly string[]).includes(state) ? (state as AccountOrderState) : null,
    after: readCursor(one(params.after)),
  };
}

/** The address of a page of the list (the search and state kept, a cursor or none). */
export function accountOrdersQuery(q: { text: string; state: AccountOrderState | null; after?: AccountOrderCursor | null }): string {
  const p = new URLSearchParams();
  if (q.text) p.set("q", q.text);
  if (q.state) p.set("state", q.state);
  if (q.after) p.set("after", cursorOf(q.after));
  const s = p.toString();
  return s ? `?${s}` : "";
}
