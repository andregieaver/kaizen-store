/**
 * The admin pages a person opened last (PSI UX-06): kept in their own browser for the AI manager's panel to offer, newest first, five at
 * most, one entry per address. Pure; the launcher reads and writes it (`localStorage`, a convenience that may be missing).
 */

export type RecentPage = { path: string; title: string };

export const RECENT_MAX = 5;
const SITE_SUFFIX = / · Kaizena Flow admin$/;

/** A page's name from its document title: the admin's own suffix taken away, the rest kept as it is. */
export const pageName = (documentTitle: string): string => documentTitle.replace(SITE_SUFFIX, "").trim();

/** The list with this page put first: an earlier visit to the same address is moved, never repeated, and the list stays short. */
export function rememberPage(list: readonly RecentPage[], page: RecentPage, max = RECENT_MAX): RecentPage[] {
  if (!page.path || !page.title) return [...list];
  return [page, ...list.filter((entry) => entry.path !== page.path)].slice(0, max);
}

/** What was stored, kept only if it has the shape: a browser's storage is anyone's to change. */
export function parseRecent(stored: string | null): RecentPage[] {
  try {
    const value: unknown = JSON.parse(stored ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((e): e is RecentPage => typeof e?.path === "string" && typeof e?.title === "string" && e.path.startsWith("/admin"))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
