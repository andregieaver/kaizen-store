import { z } from "zod";

/**
 * Web Push for the admin (wave 9 unit H, D361, `docs/wave-9-platform.md` section 3, H), the pure part: what a browser's subscription must
 * look like, the push services it may name (the server POSTs to the endpoint, so an address of anyone else's is refused, never fetched), and
 * a new order's notification in a person's language, its number and total only.
 */

/** The browsers' own push services: Chrome and Edge's (FCM), Firefox's, Safari's and Windows'. */
export const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"] as const;
export const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"] as const;

/** Whether an endpoint is https on a push service's own host. */
export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return (PUSH_HOSTS as readonly string[]).includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** A browser's `PushSubscription.toJSON()` with the device's name the person gave. */
export const pushSubscriptionInput = z.object({
  endpoint: z.string().max(2000).refine(isPushEndpoint, "Not a push service's address."),
  keys: z.object({ p256dh: base64url.min(40).max(200), auth: base64url.min(8).max(64) }),
  device: z.string().trim().max(60).default(""),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;

/** Devices a person may have per store. */
export const PUSH_DEVICES_MAX = 10;

/** The new order's notification: its title and body, and where a press opens. */
export function newOrderPush(input: { number: string; total: string; store: string; url: string }, words: { title: string; body: string }) {
  const fill = (text: string) => text.replaceAll("{number}", input.number).replaceAll("{total}", input.total).replaceAll("{store}", input.store);
  return { title: fill(words.title), body: fill(words.body), url: input.url, tag: `order-${input.number}` };
}

/** A device's name from its browser, when the person gave none: the platform and browser only. */
export function deviceName(userAgent: string): string {
  const os = /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" · ") || "Browser";
}
