import "server-only";

import { STOREFRONT_HEADER } from "@/lib/storefront-api";

import { takeBudget } from "./request-budget";
import { storefrontCaller, storefrontProblem, type StorefrontCaller } from "./storefront-api";

/**
 * How every storefront API route answers (D362): any site may call it from a browser (CORS, the token being public), a call is the token's
 * own (`X-Storefront-Token`), counted against its budget (`storefront`), and a store that is not open, sells nothing or is private answers
 * 404 as an unknown one does. Answers vary by the token, as tokens of one store may be for different markets.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Storefront-Token",
  "Access-Control-Max-Age": "600",
  Vary: "X-Storefront-Token",
};

export const sfJson = (body: unknown, status = 200, cache = false) =>
  Response.json(body, { status, headers: { ...CORS, "Cache-Control": cache ? "public, max-age=60" : "no-store" } });

export const sfProblem = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

/** The preflight a browser sends before a call with the token's header. */
export const sfOptions = () => new Response(null, { status: 204, headers: CORS });

export async function asStorefront(request: Request, slug: string, handle: (caller: StorefrontCaller) => Promise<Response>): Promise<Response> {
  const caller = await storefrontCaller(slug, request.headers.get(STOREFRONT_HEADER));
  if (!caller) return sfProblem(401, "unauthorized", "A storefront token of this store is needed in the X-Storefront-Token header.");
  if (storefrontProblem(caller.store)) return sfProblem(404, "not_found", "No such store.");
  if (!(await takeBudget(caller.store.id, "storefront", caller.tokenId))) return sfProblem(429, "rate_limited", "Too many calls. Try again in a minute.", { "Retry-After": "60" });
  return handle(caller);
}
