import { SEARCHES_MAX, SEARCH_TEXT_MAX, SESSION_ID, VIEWS_MAX, type Placement, type Signals } from "./recommendations";

/**
 * What the shopper's tab remembers for recommendations (D139): the products looked at, the searches made, the products
 * clicked from a recommendation, and a random id for the tab. It is kept in the tab's session storage only (`kaizen_rec`,
 * gone when the tab closes), sent to the site only to ask for recommendations, and never joined to a person. Reads and
 * writes never throw: a browser without storage just gives recommendations without a session.
 */

export const SESSION_KEY = "kaizen_rec";

/** A click from a recommendation counts towards an add to cart for this long. */
export const CLICK_MINUTES = 30;
/** What is older than this is forgotten. */
export const FORGET_HOURS = 6;

type Store = Pick<Storage, "getItem" | "setItem">;

export type TabSession = {
  id: string;
  views: { p: string; t: number }[];
  searches: { q: string; t: number }[];
  clicks: { p: string; placement: Placement; arm: "ai" | "baseline"; t: number }[];
};

const empty = (id: string): TabSession => ({ id, views: [], searches: [], clicks: [] });

/** A new tab's id: 24 random lowercase letters and digits. */
export function newSessionId(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(24));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/** The session as kept, with what is old forgotten; a new one when there is none or it is damaged. */
export function readSession(storage: Store | null, now = Date.now(), makeId = newSessionId): TabSession {
  let stored: Partial<TabSession> | null = null;
  try {
    const text = storage?.getItem(SESSION_KEY);
    stored = text ? (JSON.parse(text) as Partial<TabSession>) : null;
  } catch {
    stored = null;
  }
  const id = typeof stored?.id === "string" && SESSION_ID.test(stored.id) ? stored.id : makeId();
  const keep = now - FORGET_HOURS * 3_600_000;
  const session = empty(id);
  if (stored && typeof stored === "object") {
    session.views = (Array.isArray(stored.views) ? stored.views : []).filter((v) => v && typeof v.p === "string" && typeof v.t === "number" && v.t >= keep).slice(0, VIEWS_MAX);
    session.searches = (Array.isArray(stored.searches) ? stored.searches : []).filter((s) => s && typeof s.q === "string" && typeof s.t === "number" && s.t >= keep).slice(0, SEARCHES_MAX);
    session.clicks = (Array.isArray(stored.clicks) ? stored.clicks : []).filter((c) => c && typeof c.p === "string" && typeof c.t === "number" && c.t >= keep).slice(0, 12);
  }
  return session;
}

function write(storage: Store | null, session: TabSession) {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage full or refused: the session carries on without being kept.
  }
}

/** A product looked at: newest first, once each. */
export function recordView(storage: Store | null, productId: string, now = Date.now()): TabSession {
  const session = readSession(storage, now);
  session.views = [{ p: productId, t: now }, ...session.views.filter((v) => v.p !== productId)].slice(0, VIEWS_MAX);
  write(storage, session);
  return session;
}

/** A search made: newest first, once each. */
export function recordSearch(storage: Store | null, query: string, now = Date.now()): TabSession {
  const session = readSession(storage, now);
  const q = query.replace(/\s+/g, " ").trim().slice(0, SEARCH_TEXT_MAX);
  if (!q) return session;
  session.searches = [{ q, t: now }, ...session.searches.filter((s) => s.q.toLowerCase() !== q.toLowerCase())].slice(0, SEARCHES_MAX);
  write(storage, session);
  return session;
}

/** A product opened from a recommendation. */
export function recordClick(storage: Store | null, productId: string, placement: Placement, arm: "ai" | "baseline", now = Date.now()): TabSession {
  const session = readSession(storage, now);
  session.clicks = [{ p: productId, placement, arm, t: now }, ...session.clicks.filter((c) => c.p !== productId)].slice(0, 12);
  write(storage, session);
  return session;
}

/** What a request for recommendations carries of the session. */
export const signalsOf = (session: TabSession): Signals => ({ views: session.views.map((v) => v.p), searches: session.searches.map((s) => s.q) });

/** What to send with adding a product to the cart: the tab's id and the products clicked from a recommendation in the last half hour; null when there are none. */
export function attributionFor(storage: Store | null, now = Date.now()): string | null {
  const session = readSession(storage, now);
  const clicks = session.clicks.filter((c) => now - c.t <= CLICK_MINUTES * 60_000).map((c) => ({ p: c.p, arm: c.arm, placement: c.placement }));
  return clicks.length > 0 ? JSON.stringify({ session: session.id, clicks }) : null;
}
