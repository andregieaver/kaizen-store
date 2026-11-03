import "server-only";

import { createHash } from "node:crypto";

import { budgetVisitor, takeBudget, type BudgetEndpoint } from "./request-budget";

/**
 * What the authorization server's endpoints share (D439): any origin may call them (no cookie is read: a public client calls from a
 * browser too), answers are never cached, a body is small and read once, and each address is counted (`takeBudget()`).
 */

export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "3600",
};

/** The most a token, revocation or registration request may weigh. */
export const OAUTH_BODY_MAX = 16 * 1024;

/** A JSON answer with the endpoints' headers (RFC 6749 5.1: `no-store`). */
export function oauthJson(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...OAUTH_CORS, ...headers },
  });
}

/** An OAuth error answer (RFC 6749 5.2). */
export const oauthError = (error: string, description: string, status = 400, headers: Record<string, string> = {}) =>
  oauthJson({ error, error_description: description }, status, headers);

/** The request's body as text when it is within the limit and of the type asked, or the answer refusing it. */
export async function readBody(request: Request, type: "form" | "json"): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const wanted = type === "form" ? "application/x-www-form-urlencoded" : "application/json";
  if (contentType !== wanted) return { ok: false, response: oauthError("invalid_request", `The body is ${wanted}.`) };
  if (Number(request.headers.get("content-length") ?? 0) > OAUTH_BODY_MAX) return { ok: false, response: oauthError("invalid_request", "The body is too large.", 413) };
  const text = await request.text();
  if (Buffer.byteLength(text) > OAUTH_BODY_MAX) return { ok: false, response: oauthError("invalid_request", "The body is too large.", 413) };
  return { ok: true, text };
}

/** Counts one ask from the request's address (an IPv6 one by its /64); the refusal to answer when it is over (429), or null. */
export async function overBudget(request: Request, endpoint: BudgetEndpoint): Promise<Response | null> {
  if (await takeBudget(null, endpoint, budgetVisitor(request.headers))) return null;
  return oauthError("slow_down", "Too many requests from this address: try again later.", 429, { "Retry-After": endpoint === "oauth_register" ? "3600" : "60" });
}

/** The bucket a client's own budget is counted in (`oauth_token`): its id, hashed. */
export const clientBudgetKey = (clientId: string): string => createHash("sha256").update(`client|${clientId}`).digest("hex").slice(0, 32);

/**
 * Charges one token or revocation request to its client's own budget (`oauth_token`, D439 review) and says whether there was room. A
 * hosted client asks for many people from a few addresses, so the per-address count (`oauth`) is only a backstop and this is the real
 * ceiling; the authorization server calls it only once a request has proved itself (`ClientCharge` in `src/server/oauth.ts`), so a flood
 * of made-up codes from many addresses is charged to those addresses and never to the client it names.
 */
export const chargeClient = (clientId: string): Promise<boolean> => takeBudget(null, "oauth_token", clientBudgetKey(clientId));

/** The answer to a request its client's budget had no room for. */
export const clientBudgetSpent = (): Response =>
  oauthError("slow_down", "Too many requests for this client: try again in a minute.", 429, { "Retry-After": "60" });

/** A browser's preflight. */
export const oauthPreflight = (): Response => new Response(null, { status: 204, headers: OAUTH_CORS });
