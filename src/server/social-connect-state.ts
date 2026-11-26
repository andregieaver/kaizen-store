import "server-only";

import { randomBytes } from "node:crypto";

/**
 * What every social account's sign-in shares (D870: Facebook S1.2b, Pinterest S3.4, TikTok S3.5): the platform's refusal as an error whose
 * words may be shown (`ConnectError`, `cancelled` when the person said no), and the state that ties the platform's answer to who started it,
 * kept in a short-lived cookie with the store and the account.
 */

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly reason: "cancelled" | "failed" = "failed",
  ) {
    super(message);
  }
}

/** Where to send the person (`url` made with a fresh state) and the cookie that remembers who started it. */
export function connectStart(url: (state: string) => string, storeSlug: string, accountId: string): { url: string; cookie: string } {
  const state = randomBytes(24).toString("base64url");
  return { url: url(state), cookie: [state, storeSlug, accountId].join(".") };
}

/** Who started connecting, from the cookie, checked against the state the platform sends back; `refuse` makes the platform's error. */
export function connectStarted(cookie: string | undefined, params: URLSearchParams, refuse: (message: string) => Error): { store: string; accountId: string } {
  const [state, store, accountId] = (cookie ?? "").split(".");
  if (!state || !store || !accountId || state !== params.get("state")) throw refuse("The connection could not be checked.");
  return { store, accountId };
}
