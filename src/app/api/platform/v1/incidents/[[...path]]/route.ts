import { connection } from "next/server";

import { incidentRouteOf } from "@/lib/incident-api";
import { runIncidentApiRoute } from "@/server/incident-api";
import { log } from "@/server/log";
import { platformApiCaller } from "@/server/platform-api-tokens";
import { takeBudget } from "@/server/request-budget";

/**
 * The incident log's part of Kaizena Flow's own API (D895): `/api/platform/v1/incidents/…` with `Authorization: Bearer kfp_…`, a token with
 * the `incidents` scope, the one scope that writes, and only to the log. GET the board, `due` or an entry; POST `ingest`, `propose`, `runs`,
 * `runs/{id}/finish` and `{id}/claim|fixed|needs-owner|give-back|note` (`src/lib/incident-api.ts`). JSON in and out, never cached.
 */
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

const error = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  Response.json({ error: { code, message } }, { status, headers: { ...HEADERS, ...headers } });

async function answer(request: Request, { params }: RouteContext<"/api/platform/v1/incidents/[[...path]]">): Promise<Response> {
  await connection();
  const caller = await platformApiCaller(request.headers.get("authorization"));
  if (!caller) return error(401, "unauthorized", "Give a valid token as Authorization: Bearer kfp_….", { "WWW-Authenticate": "Bearer" });
  if (!caller.token.scopes.includes("incidents")) return error(403, "forbidden", "This token does not have the scope incidents.");
  const route = incidentRouteOf(request.method, (await params).path ?? []);
  if (!route) return error(404, "not_found", "No such route.");
  if (!(await takeBudget(null, "api", caller.token.id))) return error(429, "rate_limited", "Too many requests. Try again in a minute.", { "Retry-After": "60" });
  let body: unknown;
  if (request.method === "POST") {
    const text = await request.text();
    if (text.length > 64_000) return error(413, "too_large", "The body is at most 64 KB.");
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return error(400, "invalid", "The body is not JSON.");
    }
  }
  try {
    const result = await runIncidentApiRoute(route, body);
    return Response.json(result.body, { status: result.status, headers: HEADERS });
  } catch (thrown) {
    log("error", "incident_api.failed", { route: route.name, tokenId: caller.token.id }, thrown);
    return error(500, "failed", "Something went wrong.");
  }
}

export const GET = answer;
export const POST = answer;
