import { z } from "zod";

import { isPushEndpoint } from "./push";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** A browser's `PushSubscription.toJSON()` with the device's name the person gave. */
export const pushSubscriptionInput = z.object({
  endpoint: z.string().max(2000).refine(isPushEndpoint, "Not a push service's address."),
  keys: z.object({ p256dh: base64url.min(40).max(200), auth: base64url.min(8).max(64) }),
  device: z.string().trim().max(60).default(""),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;
