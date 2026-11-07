/**
 * Sendcloud (D483, `docs/sendcloud-labels.md`): the pure parts of its connection, read against Sendcloud's API v3 documentation on
 * 5 November 2026 (`sendcloud.dev`). Each shop connects its own Sendcloud account with the public and secret key of a Sendcloud API
 * integration, sent as Basic auth; v2 is not used (it is closed to accounts made after 13 April 2026). No database, no network: the
 * calls are `src/server/carriers/sendcloud.ts`.
 */

/** Sendcloud's API v3. There is no separate test host: Sendcloud has no sandbox. */
export const SENDCLOUD_API = "https://panel.sendcloud.sc/api/v3";
const SENDCLOUD_HOST = "panel.sendcloud.sc";

/**
 * The only labels the store's *test* environment will make (from step 2): Sendcloud's free test label, an unstamped letter that
 * nothing ships and nobody pays for, and its return counterpart.
 */
export const SENDCLOUD_TEST_OPTION = "sendcloud:letter";
export const SENDCLOUD_TEST_RETURN_OPTION = "sendcloud:letterreturn";

/** The `Authorization` header for a shop's keys. */
export const sendcloudAuthorization = (publicKey: string, secretKey: string): string =>
  `Basic ${Buffer.from(`${publicKey}:${secretKey}`, "utf8").toString("base64")}`;

/** Headers for every call: the shop's keys and, once Sendcloud approves Kaizena Flow as a Tech Partner, its partner id. */
export function sendcloudHeaders(keys: { publicKey: string; secretKey: string }, partnerId: string | null): Record<string, string> {
  return {
    Authorization: sendcloudAuthorization(keys.publicKey, keys.secretKey),
    Accept: "application/json",
    ...(partnerId ? { "Sendcloud-Partner-Id": partnerId } : {}),
  };
}

/** One sender address of the shop's Sendcloud account, as the admin offers it. */
export type SendcloudSender = { id: string; label: string; country: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A sender address in one line: the company (else the name), the street and number, the postal code and city, the country. */
export function senderLabel(address: Record<string, unknown>): string {
  const who = text(address.company_name) || text(address.name);
  const street = [text(address.address_line_1), text(address.house_number)].filter(Boolean).join(" ");
  const place = [text(address.postal_code), text(address.city)].filter(Boolean).join(" ");
  return [who, street, place, text(address.country_code).toUpperCase()].filter(Boolean).join(", ");
}

/**
 * The sender addresses in `GET /addresses/sender-addresses`'s answer (`{ data: [...] }`, each with an integer `id`), or null when the
 * answer is not that shape. Addresses without an id or a country are left out.
 */
export function parseSenders(json: unknown): SendcloudSender[] | null {
  const data = json && typeof json === "object" ? (json as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return null;
  const senders: SendcloudSender[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const address = item as Record<string, unknown>;
    const id = typeof address.id === "number" && Number.isSafeInteger(address.id) && address.id > 0 ? String(address.id) : "";
    const country = text(address.country_code).toUpperCase();
    if (!id || !/^[A-Z]{2}$/.test(country)) continue;
    senders.push({ id, label: senderLabel(address), country });
  }
  return senders;
}

/**
 * The next page of a list, from the `Link` header (RFC 8288, `rel="next"`), only when it stays on Sendcloud's own host over https:
 * the shop's keys are never sent anywhere else.
 */
export function nextPage(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    if (!match || !/\brel="?next"?/.test(match[2])) continue;
    try {
      const url = new URL(match[1]);
      return url.protocol === "https:" && url.hostname === SENDCLOUD_HOST ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Sendcloud's refusal as a plain sentence for the owner. v3's error bodies differ between endpoints (`errors` with a `detail`, a
 * `title` or only a `code`), so the status decides first and Sendcloud's own words follow when there are any.
 */
export function sendcloudProblem(status: number, json: unknown = null): string {
  if (status === 401) return "Sendcloud did not accept these keys: copy the public and secret key of your Sendcloud API integration again.";
  if (status === 403) return "Sendcloud accepted the keys but refused this request: check that your Sendcloud plan includes the API.";
  if (status === 429) return "Sendcloud is busy. Try again in a minute.";
  const errors = json && typeof json === "object" ? (json as { errors?: unknown }).errors : undefined;
  const first = Array.isArray(errors) && errors[0] && typeof errors[0] === "object" ? (errors[0] as Record<string, unknown>) : null;
  const said = first ? text(first.detail) || text(first.title) || text(first.code) : "";
  if (status >= 500) return "Sendcloud had a problem on its side. Try again in a moment.";
  return said ? `Sendcloud said: ${said.slice(0, 200)}` : `Sendcloud refused the request (status ${status}).`;
}

/** Whether the store's saved sender address is still one of its Sendcloud account's, with the sentence to show when it is not. */
export function senderProblem(senders: SendcloudSender[], chosen: string | undefined): string | null {
  if (senders.length === 0) return "Sendcloud accepted the keys, but your Sendcloud account has no sender address yet: add one in Sendcloud's settings, then choose it here.";
  if (!chosen) return "Sendcloud accepted the keys. Now choose the sender address your parcels leave from.";
  if (!senders.some((s) => s.id === chosen)) return "The sender address you chose is no longer in your Sendcloud account: choose another.";
  return null;
}
