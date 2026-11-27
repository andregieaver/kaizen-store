/**
 * What a store's owner reads about a problem Kaizena Flow saw on their store (D895 IA-18): where it was, in words of theirs, and where it
 * stands. Pure: from the incident's route shape and status only, never its message, fingerprint or anything technical.
 */

export type StoreIncidentArea = "store" | "admin" | "background" | "connection" | "other";
export type StoreIncidentState = "fixing" | "watching" | "fixed";

/** Where it happened, as an owner names it: their store's pages, their admin, a background task or a connection. */
export function incidentArea(route: string | null): StoreIncidentArea {
  if (!route) return "other";
  if (route.startsWith("/s/")) return "store";
  if (route.startsWith("/admin/")) return "admin";
  if (route.startsWith("/api/cron")) return "background";
  if (route.startsWith("/api/")) return "connection";
  return "other";
}

/** Where it stands: being fixed (waiting, claimed or with the platform's owner), fixed and watched, or fixed for good. */
export function incidentState(status: string): StoreIncidentState {
  if (status === "done") return "fixed";
  if (status === "fixed") return "watching";
  return "fixing";
}
