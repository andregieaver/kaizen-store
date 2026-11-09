import { connection } from "next/server";

import { isRequestState, listQuery, platformRouteOf } from "@/lib/platform-api";
import { log } from "@/server/log";
import { runPlatformApiRoute } from "@/server/platform-api";
import { platformApiCaller } from "@/server/platform-api-tokens";
import { takeBudget } from "@/server/request-budget";

/**
 * Kaizena Flow's own API (C4 step 4, D517): `GET /api/platform/v1/{stores|stores/{id or slug}|plans|requests|figures}` with
 * `Authorization: Bearer kfp_…`, a token a platform owner made under Settings → Integrations → API. Read only. A route outside the token's
 * scopes is a 403 that names the scope, anything not found a 404, more than the budget a 429 with `Retry-After`. JSON out, never cached.
 */
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

const error = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  Response.json({ error: { code, message } }, { status, headers: { ...HEADERS, ...headers } });

export async function GET(request: Request, { params }: RouteContext<"/api/platform/v1/[...path]">): Promise<Response> {
  await connection();
  const caller = await platformApiCaller(request.headers.get("authorization"));
  if (!caller) return error(401, "unauthorized", "Give a valid token as Authorization: Bearer kfp_… (made under Platform → Settings → Integrations → API).", { "WWW-Authenticate": "Bearer" });
  const route = platformRouteOf((await params).path);
  if (!route) return error(404, "not_found", "No such route.");
  if (!caller.token.scopes.includes(route.scope)) return error(403, "forbidden", `This token does not have the scope ${route.scope}.`);
  if (!(await takeBudget(null, "api", caller.token.id))) return error(429, "rate_limited", "Too many requests. Try again in a minute.", { "Retry-After": "60" });
  const url = new URL(request.url);
  const query = listQuery(url.searchParams);
  if (!query.ok) return error(400, "invalid", query.problem);
  const state = url.searchParams.get("status") ?? "pending";
  if (!isRequestState(state)) return error(400, "invalid", "status is pending, approved, declined or all.");
  try {
    const answer = await runPlatformApiRoute(route, { limit: query.limit, before: query.before, state });
    return Response.json(answer.body, { status: answer.status, headers: HEADERS });
  } catch (thrown) {
    log("error", "platform_api.failed", { route: route.name, tokenId: caller.token.id }, thrown);
    return error(500, "failed", "Something went wrong.");
  }
}

const notAllowed = () => error(405, "method_not_allowed", "Kaizena Flow's own API only reads: use GET.", { Allow: "GET" });
export const POST = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
