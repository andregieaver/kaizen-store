/**
 * Canva's forms in the admin (D898): plain posts that start and end a person's connection, so they work before any script and add no server
 * action. Their own module with no imports, so the admin's browser code that names them carries nothing of `canva.ts` (zod, `node:crypto`).
 */
export const CANVA_CONNECT = "/api/integrations/canva/connect";
export const CANVA_DISCONNECT = "/api/integrations/canva/disconnect";
