/**
 * The admin page an owner or staff member was last on, per store, so the
 * storefront can offer a way back. Kept in this browser only (local
 * storage), written by the store's admin pages and cleared at sign-out.
 * The storefront pages are cached for everyone, so the way back is decided
 * in the browser, never on the server.
 */

const KEY = "kaizen-admin-return";

type Trail = Record<string, string>;

function read(): Trail {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as Trail) : {};
  } catch {
    return {}; // Storage can be unavailable (private mode) or hold junk.
  }
}

/** Only the store's own admin pages count, so the link cannot lead elsewhere. */
export function isAdminPath(storeSlug: string, path: string): boolean {
  const base = `/admin/${storeSlug}`;
  const inStore = path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`);
  return inStore && !path.includes("//") && !path.includes("\\");
}

export function rememberAdminPage(storeSlug: string, path: string): void {
  if (!isAdminPath(storeSlug, path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [storeSlug]: path }));
  } catch {
    // Nothing to remember with.
  }
}

export function forgetAdminPages(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Supabase's session cookie is readable by the page; its absence means signed out. */
export function hasSessionCookie(cookie: string): boolean {
  return /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(cookie);
}

/** Where "Back to admin" leads for this store, or null when there is no way back. */
export function adminReturnPath(storeSlug: string, cookie: string): string | null {
  if (!hasSessionCookie(cookie)) return null;
  const path = read()[storeSlug];
  return typeof path === "string" && isAdminPath(storeSlug, path) ? path : null;
}

// ---------------------------------------------------------------------------
// Stores on their own domains (P7, P8)
// ---------------------------------------------------------------------------
//
// A store on its own domain cannot see the admin's session or storage: they
// are Kaizen's site, not the store's. So the admin hands its page over in
// every link it opens to the store, as `#kaizen-admin=/admin/{store}/…` (a
// fragment, never sent to a server), and the store keeps it in its own
// storage for a while. It only ever leads to the store's own admin pages,
// which still ask for a sign-in.

const STAFF_KEY = "kaizen-staff";
const HANDOFF = "kaizen-admin=";

/** How long a store offers the way back after staff came from the admin. */
export const STAFF_HOURS = 12;

type Handoffs = Record<string, { path: string; at: number }>;

function readHandoffs(): Handoffs {
  try {
    const value = JSON.parse(localStorage.getItem(STAFF_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as Handoffs) : {};
  } catch {
    return {};
  }
}

/** The fragment the admin adds to its links to the store. */
export const handoffHash = (path: string) => `#${HANDOFF}${encodeURIComponent(path)}`;

/** Keeps the admin page handed over in the address, if it is the store's own; true when there was one. */
export function takeHandoff(storeSlug: string, hash: string, now = Date.now()): boolean {
  if (!hash.startsWith(`#${HANDOFF}`)) return false;
  let path: string;
  try {
    path = decodeURIComponent(hash.slice(HANDOFF.length + 1));
  } catch {
    return true;
  }
  if (!isAdminPath(storeSlug, path)) return true;
  try {
    localStorage.setItem(STAFF_KEY, JSON.stringify({ ...readHandoffs(), [storeSlug]: { path, at: now } }));
  } catch {
    // Nothing to keep it in.
  }
  return true;
}

/** The admin page staff came from, while it is recent enough. */
export function handedOffPath(storeSlug: string, now = Date.now()): string | null {
  const entry = readHandoffs()[storeSlug];
  if (!entry || typeof entry.path !== "string" || typeof entry.at !== "number") return null;
  if (now - entry.at > STAFF_HOURS * 3600_000 || !isAdminPath(storeSlug, entry.path)) return null;
  return entry.path;
}
