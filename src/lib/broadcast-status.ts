/** The states of a broadcast and its recipients (D297), apart from `broadcasts.ts` so the schema reads them without zod. */

export const BROADCAST_STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const BROADCAST_AUDIENCES = ["everyone", "segment"] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export const RECIPIENT_STATUSES = ["queued", "sent", "failed", "skipped"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];
