import { API_ERRORS, API_SCOPES, PAGE_DEFAULT, PAGE_MAX, type ApiErrorCode } from "./admin-api";
import { ADMIN_API, errorsOf, type AdminOperation } from "./admin-api-routes";
import { errorEnvelope, jsonSchemaOf, OPENAPI_DIALECT, parametersOf, pathParams, type JsonSchema } from "./openapi";
import { webhookOpenApi } from "./webhook-topics";

/**
 * The Admin API's contract as an OpenAPI 3.1 document (wave 14 unit A, D438, `docs/wave-14-developer-platform.md` A2), made from
 * `ADMIN_API` alone with `z.toJSONSchema()`: every operation's parameters, body, answer and refusals, the bearer token and the scope each
 * needs, pages, the budget and `Idempotency-Key`, and the webhook topics (`webhooks`). Served at `/api/admin/v1/openapi.json`. Pure.
 */

export const ADMIN_API_VERSION = "v1";
/** The calls a token may make a minute, and a store's tokens together (`BUDGETS.api` of `src/server/request-budget.ts`). */
export const ADMIN_RATE = { perToken: 120, perStore: 1200 } as const;

/** What each refusal means, for the document and the reference. */
export const API_ERROR_WORDS: Record<ApiErrorCode, string> = {
  unauthorized: "No valid token in `Authorization: Bearer kf_…`, or one that was revoked.",
  forbidden: "The token does not hold the scope the operation needs; the message names it.",
  not_found: "No such route, or nothing with that id in the token's store (another store's ids are simply not found).",
  method: "The method is not one this path takes.",
  invalid: "Nothing was done: a body, query or cursor that is not as described, or a check of the screen it goes through; the message says what.",
  gated: "Only the owner does this, in the admin: publishing, changing a product on the site, a copied order.",
  conflict: "Nothing was done: it clashes with how things are now (nothing left to send), or an `Idempotency-Key` is in use or was used for another request.",
  rate_limited: "More calls than the budget allows; `Retry-After` says how many seconds to wait.",
  failed: "Something went wrong on our side; nothing more was done. It is safe to try again.",
};

const SCOPE_WORDS: Record<string, string> = {
  products: "Products, their variants and prices.",
  inventory: "Stock locations and levels.",
  orders: "Orders, parcels, invoices and credit notes.",
  customers: "Customer accounts and their tags.",
  discounts: "Discount codes.",
  checkout: "Checkout rules and questions.",
};

const TAGS = [
  { name: "Products", description: "Products as the admin keeps them. Drafts only are written: what shoppers see is the owner's." },
  { name: "Inventory", description: "Stock per variant and location, adjusted or counted as the Inventory page does." },
  { name: "Orders", description: "Orders in their own currency, parcels with tracking, and invoices and credit notes as EN 16931 UBL." },
  { name: "Customers", description: "Customer accounts and their tags." },
  { name: "Discounts", description: "Discount codes, made through the admin's own form." },
  { name: "Checkout", description: "Checkout rules and the questions the checkout asks (D399)." },
  { name: "Webhooks", description: "Events sent to the owner's own endpoints, signed (see `webhooks`)." },
];

const isPaged = (o: AdminOperation) => "query" in o && "after" in o.query.shape;

function responses(o: AdminOperation): Record<string, JsonSchema> {
  const byStatus = new Map<number, ApiErrorCode[]>();
  for (const code of errorsOf(o)) byStatus.set(API_ERRORS[code], [...(byStatus.get(API_ERRORS[code]) ?? []), code]);
  const success: JsonSchema = {
    description: o.status === 201 ? "Made: the answer under `data`." : isPaged(o) ? "A page: the rows under `data`, and `next` for the page after." : "The answer under `data`.",
    content: { "application/json": { schema: jsonSchemaOf(o.response) } },
    ...(o.method === "POST" && { headers: { "Idempotent-Replayed": { $ref: "#/components/headers/IdempotentReplayed" } } }),
  };
  const refusals = [...byStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, codes]) => {
      const words = codes.map((c) => `\`${c}\`: ${API_ERROR_WORDS[c]}`).join(" ");
      return [
        String(status),
        {
          description: words,
          ...(status === 429 && { headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } } }),
          ...(status === 401 && { headers: { "WWW-Authenticate": { description: "`Bearer`.", schema: { type: "string" } } } }),
          content: { "application/json": { schema: errorEnvelope(codes, words) } },
        },
      ] as const;
    });
  return { [String(o.status)]: success, ...Object.fromEntries(refusals) };
}

function operation(o: AdminOperation): JsonSchema {
  const parameters = [...("query" in o ? parametersOf(o.query, "query") : []), ...(o.method === "POST" ? [{ $ref: "#/components/parameters/IdempotencyKey" }] : [])];
  return {
    operationId: o.name,
    summary: o.summary,
    description: `${o.description} Needs the scope \`${o.scope}\`${o.scope.endsWith(":read") ? ` (or \`${o.scope.replace(/:read$/, ":write")}\`)` : ""}.`,
    tags: [o.tag],
    security: [{ adminToken: [o.scope] }],
    "x-required-scope": o.scope,
    ...(isPaged(o) && { "x-pagination": { style: "cursor", query: "after", answer: "next", limit: "limit", default: PAGE_DEFAULT, max: PAGE_MAX } }),
    ...(parameters.length > 0 && { parameters }),
    ...("body" in o && { requestBody: { required: true, content: { "application/json": { schema: jsonSchemaOf(o.body) } } } }),
    responses: responses(o),
  };
}

/** The document, for `server` (the API's base address). `contractVersion` names the published contract's version (D438) when given. */
export function adminOpenApi(server: string, contractVersion?: string) {
  const paths: Record<string, JsonSchema> = {};
  for (const o of ADMIN_API) {
    const item = (paths[o.path] ??= {});
    if (!item.parameters && "params" in o) {
      const params = parametersOf(o.params, "path");
      item.parameters = pathParams(o.path).map((name) => params.find((p) => p.name === name) ?? { name, in: "path", required: true, schema: { type: "string" } });
    }
    item[o.method.toLowerCase()] = operation(o);
  }
  return {
    openapi: "3.1.0",
    jsonSchemaDialect: OPENAPI_DIALECT,
    info: {
      title: "Kaizena Flow Admin API",
      version: ADMIN_API_VERSION,
      description: [
        "A store's own data for the owner's integrations: products, stock, orders, customers, discounts and checkout rules. A token (`kf_…`) is made by an owner in Settings, Apps and API for one store, with the scopes it needs, and acts as its maker; every change goes through the admin's own screens and is audited with the token's name.",
        "Money is integer minor units with an ISO 4217 code. Lists are pages of at most 100 under a cursor: give a page's `next` as `?after=` for the next one.",
        `A token may make ${ADMIN_RATE.perToken} calls a minute, and a store's tokens ${ADMIN_RATE.perStore} together; past that the answer is 429 with \`Retry-After\`.`,
        "A POST with an `Idempotency-Key` header is done once: the same key with the same request gets the first answer again for 24 hours (`Idempotent-Replayed: true`).",
        "Within v1 nothing a caller relies on is renamed or removed; answers may gain fields.",
      ].join("\n\n"),
      ...(contractVersion && { "x-contract-version": contractVersion }),
    },
    servers: [{ url: server }],
    security: [{ adminToken: [] }],
    tags: TAGS,
    "x-scopes": API_SCOPES.map((scope) => ({ scope, description: `${scope.endsWith(":write") ? "Read and change" : "Read"}: ${SCOPE_WORDS[scope.split(":")[0]] ?? scope}` })),
    "x-rate-limit": { window: "minute", per_token: ADMIN_RATE.perToken, per_store: ADMIN_RATE.perStore },
    components: {
      securitySchemes: {
        adminToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "kf_",
          description: "A token made in Settings, Apps and API: `kf_` and 43 characters. Each operation names the scope it needs; a write scope reads too.",
        },
      },
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          description: "Makes a POST happen once: the same key with the same request answers as the first time for 24 hours; with another request it is refused.",
          schema: { type: "string", minLength: 1, maxLength: 255 },
        },
      },
      headers: {
        RetryAfter: { description: "Seconds until the budget allows a call again.", schema: { type: "integer" } },
        IdempotentReplayed: { description: "`true` when the answer is the one kept for this `Idempotency-Key`.", schema: { type: "string", enum: ["true"] } },
      },
      schemas: { Error: errorEnvelope(Object.keys(API_ERRORS), "A refusal: what went wrong, as a code and a sentence.") },
    },
    paths,
    webhooks: webhookOpenApi(),
  };
}
