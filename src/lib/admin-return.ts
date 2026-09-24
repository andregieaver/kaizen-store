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
