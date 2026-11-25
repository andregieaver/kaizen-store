/**
 * Canva's addresses in the admin (D898): plain posts that start and end a person's connection, so they work before any script and add no
 * server action, and the page Canva's *Return* comes back to for a picture field. Their own module with no imports, so the admin's browser
 * code that names them carries nothing of `canva.ts` (zod, `node:crypto`).
 */
export const CANVA_CONNECT = "/api/integrations/canva/connect";
export const CANVA_DISCONNECT = "/api/integrations/canva/disconnect";
/**
 * Where Canva's *Return* lands for an edit a picture field started (C2): a page that tells the field's tab the design is back and closes its
 * own; also where a connect started from a field comes back to. Under the account's pages, so no store's address can be it.
 */
export const CANVA_BACK = "/admin/account/canva-back";
/** The channel the back page tells the field's tab on: this site's tabs only (`BroadcastChannel`). */
export const CANVA_CHANNEL = "kaizen-canva";

/** What a picture field's *Edit in Canva* needs (C2): the route its edit goes through, and whether the person's Canva is connected now. */
export type CanvaField = { endpoint: string; connected: boolean };
