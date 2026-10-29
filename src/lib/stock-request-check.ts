/**
 * The back-in-stock request's own checks (D298, `docs/wave-5-marketing.md` 6.4), with no imports: the product page's form runs them in the
 * browser (no zod there, D211) and the route runs them again.
 */

export const REQUEST_EMAIL_MAX = 254;

/** A whole address: something, an at sign, a domain with a dot; no spaces. */
export function isRequestAddress(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && email.length <= REQUEST_EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** What the form sends. */
export type StockRequestBody = { store: string; market: string; variant: string; email: string; lang: string };

/** The answers the route gives the form. */
export type StockRequestReply = { ok: true; outcome: "waiting" | "check" | "cancelled" } | { ok: false; error: "invalid" | "busy" | "failed" };
