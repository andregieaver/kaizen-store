/** The states of a broadcast and its recipients (D297), apart from `broadcasts.ts` so the schema reads them without zod. */

export const BROADCAST_STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const BROADCAST_AUDIENCES = ["everyone", "segment"] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

/** `held`: a reader outside a split test's tested share (M2.5, D868), sent the winning version once the test is called. */
export const RECIPIENT_STATUSES = ["queued", "sent", "failed", "skipped", "held"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];
