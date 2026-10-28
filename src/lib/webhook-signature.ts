import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed events to an owner's endpoint (D354): every delivery carries `Kaizena-Webhook-Id`, `Kaizena-Webhook-Timestamp` (seconds) and
 * `Kaizena-Webhook-Signature: v1={hex}`, the HMAC-SHA256 of `"{timestamp}.{body}"` with the endpoint's secret. A receiver recomputes it over
 * the raw body and refuses a timestamp more than five minutes from its own clock, so a captured delivery cannot be played again later.
 */

export const SIGNATURE_HEADER = "Kaizena-Webhook-Signature";
export const TIMESTAMP_HEADER = "Kaizena-Webhook-Timestamp";
export const ID_HEADER = "Kaizena-Webhook-Id";
export const TOPIC_HEADER = "Kaizena-Webhook-Topic";
/** How far a timestamp may be from the receiver's clock. */
export const TOLERANCE_SECONDS = 300;
/** The version every payload carries; a change to a payload's shape raises it. */
export const PAYLOAD_VERSION = 1;

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Whether a delivery is ours and fresh: its signature over the raw body, and a timestamp within the tolerance of `now` (seconds). */
export function verifyWebhook(input: { secret: string; signature: string | null; timestamp: string | null; body: string; now?: number }): boolean {
  const stamp = Number(input.timestamp);
  if (!input.signature || !Number.isInteger(stamp)) return false;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - stamp) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signWebhook(input.secret, stamp, input.body));
  // A header may carry several signatures (while a secret is renewed): any one of them is enough.
  return input.signature.split(/[ ,]+/).some((part) => {
    const given = Buffer.from(part.trim());
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** An owner's endpoint address: https, a host name (never an IP literal), no login, no port other than 443. */
export function checkEndpointUrl(text: string): { ok: true; url: string; hint: string } | { ok: false; problem: string } {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, problem: "Write the whole address, starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, problem: "The address must start with https://." };
  if (url.username || url.password) return { ok: false, problem: "Leave the login out of the address." };
  if (url.port && url.port !== "443") return { ok: false, problem: "Use the standard https port." };
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(":") || !url.hostname.includes(".")) return { ok: false, problem: "Use a host name, not a bare address." };
  if (url.toString().length > 500) return { ok: false, problem: "The address is too long." };
  return { ok: true, url: url.toString(), hint: `${url.hostname}${url.pathname.length > 1 ? "/…" : ""}` };
}
