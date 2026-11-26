/**
 * Admin heatmaps' fixed values (D895 phase 3b), browser-safe: where the admin's collector sends a screen view's summary, and the name it
 * gives in the summary's `store` field (the storefront's shape is reused; no store is ever sent from the admin).
 */
export const ADMIN_HEAT_ENDPOINT = "/api/admin-use/heat";
export const ADMIN_HEAT_STORE = "admin";
