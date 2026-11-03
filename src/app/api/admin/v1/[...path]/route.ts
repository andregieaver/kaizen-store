import { connection } from "next/server";

import { API_ERRORS, grants, retryAfter, type ApiErrorCode, type ApiMethod } from "@/lib/admin-api";
import { ADMIN_API_BY_NAME, routeOf } from "@/lib/admin-api-routes";
import { featureOn, FEATURES_BY_ID, type FeatureId } from "@/lib/store-features";
import { ApiError, runApiRoute } from "@/server/admin-api";
import { claimIdempotencyKey } from "@/server/api-idempotency";
import { apiCaller } from "@/server/api-tokens";
import { log } from "@/server/log";
import { memberCan } from "@/server/permissions";
import { takeBudget } from "@/server/request-budget";

/**
 * The Admin API (wave 9 unit B, D355): `/api/admin/v1/{resource}` with `Authorization: Bearer kf_…`. The token names its store; a route
 * outside its scopes is a 403 that names the scope, anything not found a 404 (another store's ids are simply not found), more than the
 * budget a 429 with `Retry-After`. JSON in and out, money as minor units with the currency, never cached. A POST with an `Idempotency-Key`
 * header is done once: the same key with the same request gets the first answer again (`Idempotent-Replayed: true`) for 24 hours.
 *
 * Besides its scope, each operation asks what its screen asks (D440): the staff permission (D158) the token's maker must hold in the store now
 * (`memberCan()`, so a store that is not open refuses what would change it), and the store feature (D178) it stands behind.
 */
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

const error = (code: ApiErrorCode, message: string, headers: Record<string, string> = {}) =>
  Response.json({ error: { code, message } }, { status: API_ERRORS[code], headers: { ...HEADERS, ...headers } });

async function handle(method: ApiMethod, request: Request, { params }: RouteContext<"/api/admin/v1/[...path]">): Promise<Response> {
  await connection();
  const caller = await apiCaller(request.headers.get("authorization"));
  if (!caller) return error("unauthorized", "Give a valid token as Authorization: Bearer kf_….", { "WWW-Authenticate": "Bearer" });
  const path = (await params).path;
  const route = routeOf(method, path);
  if (!route) return error("not_found", "No such route.");
  if (!grants(caller.token.scopes, route.scope)) return error("forbidden", `This token does not have the scope ${route.scope}.`);
  const operation = ADMIN_API_BY_NAME[route.name];
  if (!memberCan(caller.member, operation.permission)) {
    return error("forbidden", `The token's owner may not do this in the store now: it needs the permission ${operation.permission}${caller.member.store.status !== "active" ? ", and the store is not open" : ""}.`);
  }
  const feature: FeatureId | undefined = "feature" in operation ? operation.feature : undefined;
  if (feature && !featureOn(caller.member.store, feature)) {
    return error("feature_off", `The store has switched off ${FEATURES_BY_ID[feature].label}: turn it on in Settings, Store features.`);
  }
  if (!(await takeBudget(caller.member.store.id, "api", caller.token.id))) {
    const wait = retryAfter();
    return error("rate_limited", `Too many requests. Try again in ${wait} seconds.`, { "Retry-After": String(wait) });
  }
  // A POST with an Idempotency-Key (PSI DATA-03): done once, its answer kept for the same request, which is its method, its whole path
  // (the order it refunds, D440 review) and its body.
  const key = method === "POST" ? request.headers.get("idempotency-key") : null;
  const once = key === null ? null : await claimIdempotencyKey(caller.token.id, key, `${method} /${path.join("/")}`, await request.clone().text());
  if (once?.kind === "refused") return error(once.code, once.message);
  if (once?.kind === "replay") return Response.json(once.answer.body, { status: once.answer.status, headers: { ...HEADERS, "Idempotent-Replayed": "true" } });
  try {
    const answer = await runApiRoute(caller, route, request);
    // What is shown once (a gift card's code, a pay link) is never kept for a replay (D440).
    if (once?.kind === "run") await once.save(answer.replay === undefined ? answer : { status: answer.status, body: answer.replay });
    return Response.json(answer.body, { status: answer.status, headers: HEADERS });
  } catch (thrown) {
    if (thrown instanceof ApiError) {
      // A refusal is the answer to that request: kept like any other, so the same request is refused the same way.
      if (once?.kind === "run") await once.save({ status: API_ERRORS[thrown.code], body: { error: { code: thrown.code, message: thrown.message } } });
      return error(thrown.code, thrown.message);
    }
    log("error", "admin_api.failed", { storeId: caller.member.store.id, route: route.name }, thrown);
    // Nothing was answered: the key is let go, so the client's retry runs again.
    if (once?.kind === "run") await once.forget().catch(() => {});
    return error("failed", "Something went wrong. Nothing more was done.");
  }
}

export const GET = (request: Request, context: RouteContext<"/api/admin/v1/[...path]">) => handle("GET", request, context);
export const POST = (request: Request, context: RouteContext<"/api/admin/v1/[...path]">) => handle("POST", request, context);
export const PATCH = (request: Request, context: RouteContext<"/api/admin/v1/[...path]">) => handle("PATCH", request, context);
export const DELETE = (request: Request, context: RouteContext<"/api/admin/v1/[...path]">) => handle("DELETE", request, context);
