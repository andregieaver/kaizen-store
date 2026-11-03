import { z } from "zod";

import recorded from "../data/api-contract.json";

import { API_ERRORS, API_SCOPES, type ApiErrorCode } from "./admin-api";
import { ADMIN_API, COMMON_ERRORS, errorsOf, type AdminOperation } from "./admin-api-routes";
import { API_ERROR_WORDS } from "./admin-openapi";
import { apiContract } from "./api-contract";
import { curlSample, javascriptSample, javascriptSignatureCheck, phpSignatureCheck, pythonSample, pythonSignatureCheck, TOKEN_ENV, type ApiCall } from "./docs-api-samples";
import { DOCS_CHANGELOG_PATH, DOCS_REFERENCE_PATH, type DocArea, type DocReference, type DocRefItem, type DocRefPage } from "./docs-content";
import { parseMarkdown } from "./docs-markdown";
import { SUBJECT_AREAS, TAG_AREAS } from "./docs-reference";
import { anchorOf, exampleFor, mdCell, mdCode, mdFence, mdTable, mdText, scalarCandidates, schemaMarkdown, schemaTable, typeText, type JsonSchema } from "./docs-schema";
import { OAUTH_SCOPES } from "./oauth";
import { jsonSchemaOf, pathParams } from "./openapi";
import { GATE_WORDS, type GateCategory } from "./owner-tools";
import { AREA_LABELS, type Area } from "./permissions";
import { STOREFRONT_ROUTES } from "./storefront-api";
import { signWebhook, TIMESTAMP_HEADER, SIGNATURE_HEADER, ID_HEADER, TOPIC_HEADER } from "./webhook-signature";
import { webhookEnvelope, WEBHOOK_TOPICS, type WebhookTopic } from "./webhook-topics";

/**
 * The docs' generated reference (wave 14 unit E4, D442, `docs/wave-14-developer-platform.md` E4): every page made from unit A's contracts
 * (D438) when the docs are built, never written by hand and never kept as Markdown in the repository. A new operation, scope, topic or tool
 * in a registry is on its page at the next build:
 *
 * - the Admin API and the storefront API, one page per resource (an OpenAPI tag): its operations listed first, then each with its method,
 *   address, scope, parameters, body and answer as tables, its errors and an example request in curl, JavaScript and Python, the example's
 *   body one the operation's own zod takes (`exampleFor()`);
 * - webhooks: the topics, the envelope, the headers, the signature check in JavaScript, Python and PHP and a signature to try one on (made by
 *   `signWebhook()`), then one page per topic with its payload and an example;
 * - the owner MCP's tools by area (the area of the permission each needs), each with its gate, permission, scope and inputs, and the
 *   shopping agents' tools;
 * - scopes, errors and rate limits, a page each; the changelog is the developers' own page (`content/docs/developers/changelog.md`).
 *
 * Each page is Markdown in the docs' subset, read by `parseMarkdown()` as an article is, so the frame draws it, `….md` answers it and the
 * search indexes it as it does the articles. The words around the contracts' own (headings, the columns' names, a sentence leading into a
 * table) are this file's, in English, as the developers' track is. Pure: the server hands in what is not a contract (the MCP's budgets).
 */

/** A budget as the server keeps it (`BUDGETS` of `src/server/request-budget.ts`): calls a window for one caller, and for a store's together. */
export type ReferenceBudget = { window: string; visitor: number; store: number };

export type ReferenceOptions = {
  /** The contract's recorded version; `src/data/api-contract.json`'s when left out. */
  version?: string | null;
  /** The budgets of the MCP servers, which no contract publishes: the owner MCP's (per grant) and the shopping agents' (per caller). */
  limits?: { mcp?: ReferenceBudget; agent?: ReferenceBudget };
};

export type ReferenceProblem = { path: string; line?: number; message: string };

type Draft = Omit<DocRefPage, "blocks" | "headings" | "lang">;

const REF = DOCS_REFERENCE_PATH;
const PATHS = {
  admin: `${REF}/admin-api`,
  storefront: `${REF}/storefront-api`,
  webhooks: `${REF}/webhooks`,
  mcp: `${REF}/mcp`,
  agents: `${REF}/mcp/shopping-agents`,
  scopes: `${REF}/scopes`,
  errors: `${REF}/errors`,
  limits: `${REF}/rate-limits`,
} as const;

/** A link in the generated Markdown to a docs page (as on Kaizena Flow's own site; the frame makes it the docs host's). */
const doc = (path: string, anchor?: string) => `/docs/${path}${anchor ? `#${anchor}` : ""}`;
const link = (words: string, href: string) => `[${words}](${href})`;
const para = (...parts: (string | false | null | undefined)[]) => parts.filter((p): p is string => typeof p === "string" && p !== "").join("\n\n");

const asObject = (value: unknown): JsonSchema => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchema) : {});
const asList = (value: unknown): JsonSchema[] => (Array.isArray(value) ? value.map(asObject) : []);
const words = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The first sentence of words, for a page's summary (at most 300 characters). */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(?:\s|$)/.exec(flat);
  const sentence = match ? match[1] : flat;
  return sentence.length <= 300 ? sentence : `${sentence.slice(0, 297).replace(/\s+\S*$/, "")}…`;
}

/** Words after their first sentence, which the page's summary already shows under its title. */
function afterFirstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(?:\s|$)/.exec(flat);
  return match && match[1].length <= 300 ? flat.slice(match[0].length).trim() : flat;
}

/** Words written for people as plain text: a summary or a title keeps its code's backticks out. */
const plain = (text: string) => text.replace(/`/g, "");

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const spoken = (seconds: number) =>
  seconds < 3600 ? count(seconds / 60, "minute") : seconds < 86_400 ? count(seconds / 3600, "hour") : count(seconds / 86_400, "day");

// ---------------------------------------------------------------------------------------------------------------------
// Parameters, bodies, answers and errors as Markdown
// ---------------------------------------------------------------------------------------------------------------------

type Parameter = { name: string; required: boolean; description: string; schema: JsonSchema };

const parametersIn = (list: unknown, where: "path" | "query"): Parameter[] =>
  asList(list)
    .filter((p) => p.in === where && typeof p.name === "string")
    .map((p) => ({ name: String(p.name), required: p.required === true, description: words(p.description) || words(asObject(p.schema).description), schema: asObject(p.schema) }));

function parametersMarkdown(params: readonly Parameter[]): string {
  return mdTable(
    ["Name", "Type", "Required", "Description"],
    params.map((p) => {
      const fallback = p.schema.default;
      return [mdCode(p.name), typeText(p.schema), p.required ? "yes" : fallback !== undefined ? `no, default ${mdCode(JSON.stringify(fallback))}` : "no", mdCell(p.description)];
    }),
  );
}

/** The JSON Schema of a request's or an answer's body in an OpenAPI document's operation. */
const bodySchema = (holder: unknown): JsonSchema | null => {
  const schema = asObject(asObject(asObject(asObject(holder).content)["application/json"]).schema);
  return Object.keys(schema).length > 0 ? schema : null;
};

/** An answer's refusals as the document has them: each status with its codes and its words. */
function refusalsOf(responses: JsonSchema): { status: number; codes: string[]; words: string }[] {
  return Object.entries(responses)
    .map(([status, response]) => ({ status: Number(status), response: asObject(response) }))
    .filter(({ status }) => Number.isInteger(status) && status >= 400)
    .sort((a, b) => a.status - b.status)
    .map(({ status, response }) => {
      const codeSchema = asObject(asObject(asObject(asObject(bodySchema(response)).properties).error).properties).code;
      const codes = Array.isArray(asObject(codeSchema).enum) ? (asObject(codeSchema).enum as unknown[]).map(String) : [];
      return { status, codes, words: words(response.description) };
    });
}

const errorLink = (code: string) => link(mdCode(code), doc(PATHS.errors, anchorOf(code)));
const scopeLink = (scope: string) => link(mdCode(scope), doc(PATHS.scopes, anchorOf(scope)));

/** The example call's three samples under their names. */
function samplesMarkdown(call: ApiCall): string {
  return para("**curl**", mdFence("shell", curlSample(call)), "**JavaScript**", mdFence("javascript", javascriptSample(call)), "**Python**", mdFence("python", pythonSample(call)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Example calls, from the operations' own zod
// ---------------------------------------------------------------------------------------------------------------------

/** An address with its path parameters filled in (each encoded) and its query. */
function fillPath(base: string, path: string, params: Record<string, unknown>, query: Record<string, unknown>): string {
  const filled = path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(String(params[name] ?? name)));
  const search = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])).toString();
  return `${base}${filled}${search ? `?${search}` : ""}`;
}

export type OperationExample = { call: ApiCall; params: Record<string, unknown>; query: Record<string, unknown>; body: unknown };

/** An Admin API operation's example call: path parameters, the query it needs and a body, each taken by the operation's own zod; null if none is. */
export function adminExample(o: AdminOperation, base: string): OperationExample | null {
  const params = "params" in o ? exampleFor(o.params, jsonSchemaOf(o.params), {}, { fill: false }) : { value: {} };
  const query = "query" in o ? exampleFor(o.query, jsonSchemaOf(o.query), {}, { fill: false }) : { value: {} };
  const body = "body" in o ? exampleFor(o.body, jsonSchemaOf(o.body)) : { value: undefined };
  if (!params || !query || !body) return null;
  const p = asObject(params.value);
  const q = asObject(query.value);
  return {
    call: { method: o.method, url: fillPath(base, o.path, p, q), auth: { header: "Authorization", bearer: true, env: TOKEN_ENV.admin }, ...(body.value !== undefined && { body: body.value }) },
    params: p,
    query: q,
    body: body.value,
  };
}

type StorefrontRoute = (typeof STOREFRONT_ROUTES)[number];

/** A storefront route's example call: its path's names filled in by their kind (the store's slug, a handle, a cart's key, an id), its body taken by its zod. */
export function storefrontExample(route: StorefrontRoute, base: string, header: string): OperationExample | null {
  const params: Record<string, unknown> = {};
  for (const name of pathParams(`/{store}${route.path}`)) {
    const value = scalarCandidates({ type: "string" }, name)[0];
    if (typeof value !== "string") return null;
    params[name] = value;
  }
  const query = "query" in route ? exampleFor(route.query, jsonSchemaOf(route.query), {}, { fill: false }) : { value: {} };
  const body = "body" in route ? exampleFor(route.body, jsonSchemaOf(route.body)) : { value: undefined };
  if (!query || !body) return null;
  const q = asObject(query.value);
  return {
    call: { method: route.method, url: fillPath(base, `/{store}${route.path}`, params, q), auth: { header, bearer: false, env: TOKEN_ENV.storefront }, ...(body.value !== undefined && { body: body.value }) },
    params,
    query: q,
    body: body.value,
  };
}

/** A webhook topic's whole body (the envelope with its `data`), as its own zod takes it. */
export function topicExample(topic: WebhookTopic): unknown | null {
  const envelope = webhookEnvelope(z.literal(topic.id), topic.data);
  return exampleFor(envelope, jsonSchemaOf(envelope), { words: topic.id.split(/[._]/) })?.value ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------------------------------------------------

/** What each receiver of a topic is, in words. */
const RECEIVERS: Record<string, string> = { endpoints: "your own endpoints", services: "Zapier, Make and Slack" };

/** What each MCP annotation means. */
const HINTS = {
  readOnlyHint: "Only reads: it changes nothing in the store.",
  destructiveHint: "May change something that cannot simply be taken back: money, a domain, who works in the store, or what it deletes or ends.",
  idempotentHint: "Calling it again with the same arguments changes nothing more.",
  openWorldHint: "Reaches outside the store: the web, a domain registrar, a payment provider or people.",
} as const;

const hintWords = (annotations: JsonSchema) =>
  (Object.keys(HINTS) as (keyof typeof HINTS)[]).filter((key) => annotations[key] === true).map((key) => ({ readOnlyHint: "read-only", destructiveHint: "destructive", idempotentHint: "idempotent", openWorldHint: "open world" })[key]);

/** The MCP's areas, by the permission each tool needs: the admin's areas, then the owner's own, with the list of stores first. */
const MCP_AREA_TITLES: Record<string, string> = { stores: "Stores", ...AREA_LABELS, owner: "The owner's own" };
const MCP_AREA_LEADS: Record<string, string> = {
  stores: "The stores a connection reaches: every other tool takes one of their slugs.",
  owner: "What only a store's owner may do: payments, the plan, domains, the AI's and integrations' settings, and overviews across the store.",
};
/** The docs' area of each of the admin's areas, for the search's filters. */
const MCP_DOC_AREAS: Partial<Record<Area | "owner" | "stores", DocArea>> = {
  orders: "orders",
  products: "products",
  customers: "customers",
  marketing: "marketing",
  analytics: "analytics",
  website: "website",
  bookings: "orders",
  support: "customers",
  settings: "settings",
  billing: "billing",
  staff: "team",
  owner: "settings",
};

const areaOfScope = (scope: unknown): string => {
  const value = typeof scope === "string" ? scope : "owner";
  if (value === "owner") return "owner";
  const area = value.split(":")[0];
  return area === "stores" ? "stores" : area;
};

/** Every page of the generated reference, in reading order, with any problem its Markdown has (none, as the tests hold). */
export function docsApiReference(options: ReferenceOptions = {}): { reference: DocReference; problems: ReferenceProblem[] } {
  const contract = apiContract();
  const admin = contract.admin as unknown as JsonSchema;
  const storefront = contract.storefront as unknown as JsonSchema;
  const adminBase = String(asObject(asList(admin.servers)[0]).url);
  const storefrontBase = String(asObject(asList(storefront.servers)[0]).url);
  const site = new URL(adminBase).origin;
  const version = options.version === undefined ? recorded.version : options.version;
  const drafts: Draft[] = [];
  const add = (draft: Draft) => drafts.push(draft);

  // The Admin API --------------------------------------------------------------------------------------------------

  const adminPaths = asObject(admin.paths);
  const adminOp = (o: AdminOperation) => asObject(asObject(adminPaths[o.path])[o.method.toLowerCase()]);
  const adminTags = [...new Set(ADMIN_API.map((o) => o.tag))];
  const tagWords = new Map(asList(admin.tags).map((t) => [String(t.name), words(t.description)]));
  const adminTagPath = (tag: string) => `${PATHS.admin}/${anchorOf(tag)}`;
  const adminScheme = asObject(asObject(asObject(admin.components).securitySchemes).adminToken);
  const idempotency = asObject(asObject(asObject(admin.components).parameters).IdempotencyKey);
  const adminInfo = asObject(admin.info);
  const operationsTable = (ops: readonly AdminOperation[], here: boolean) =>
    mdTable(
      ["Operation", "Method and path", "Scope"],
      ops.map((o) => [link(mdText(o.summary), here ? `#${anchorOf(o.name)}` : doc(adminTagPath(o.tag), anchorOf(o.name))), mdCode(`${o.method} ${o.path}`), scopeLink(o.scope)]),
    );

  const adminParagraphs = words(adminInfo.description).split(/\n\s*\n/).map((p) => mdText(p.trim())).filter(Boolean);
  add({
    path: PATHS.admin,
    parent: REF,
    title: "Admin API",
    summary: firstSentence(plain(words(adminInfo.description))),
    areas: ["admin-api"],
    sources: ["src/lib/admin-api-routes.ts", "src/lib/admin-openapi.ts"],
    items: [],
    toc: 2,
    markdown: para(
      `Every call goes to ${mdCode(`${adminBase}/…`)}. The OpenAPI 3.1 document of the same operations is ${link(mdCode("/api/admin/v1/openapi.json"), "/api/admin/v1/openapi.json")}.`,
      ...adminParagraphs.slice(1),
      `## Authentication {#authentication}`,
      para(
        mdText(words(adminScheme.description)),
        `Send it on every call as ${mdCode("Authorization: Bearer kf_…")}. ${link("Scopes", doc(PATHS.scopes))} says what each scope opens, ${link("Errors", doc(PATHS.errors))} what a refusal means and ${link("Rate limits", doc(PATHS.limits))} how many calls a minute a token may make.`,
      ),
      `## Calls made once {#idempotency}`,
      para(
        `${mdText(words(idempotency.description))} The header is ${mdCode(String(idempotency.name ?? "Idempotency-Key"))}, at most ${asObject(idempotency.schema).maxLength ?? 255} characters; an answer given again says ${mdCode("Idempotent-Replayed: true")}.`,
      ),
      ...adminTags.flatMap((tag) => {
        const ops = ADMIN_API.filter((o) => o.tag === tag);
        return [`## ${link(mdText(tag), doc(adminTagPath(tag)))} {#${anchorOf(tag)}}`, para(mdText(tagWords.get(tag) ?? ""), operationsTable(ops, false))];
      }),
    ),
  });

  for (const tag of adminTags) {
    const ops = ADMIN_API.filter((o) => o.tag === tag);
    const sections = ops.map((o) => {
      const own = adminOp(o);
      const a = anchorOf(o.name);
      const pathParameters = parametersIn(asObject(adminPaths[o.path]).parameters, "path").filter((p) => pathParams(o.path).includes(p.name));
      const query = parametersIn(own.parameters, "query");
      const request = bodySchema(own.requestBody);
      const responses = asObject(own.responses);
      const success = asObject(responses[String(o.status)]);
      const answer = bodySchema(success);
      const pages = asObject(own["x-pagination"]);
      const example = adminExample(o, adminBase);
      const errors = errorsOf(o).sort((x, y) => API_ERRORS[x] - API_ERRORS[y] || x.localeCompare(y));
      const write = o.scope.endsWith(":read") ? o.scope.replace(/:read$/, ":write") : null;
      return para(
        `## ${mdText(o.summary)} {#${a}}`,
        mdCode(`${o.method} ${adminBase}${o.path}`),
        mdText(o.description),
        [
          `- **Operation:** ${mdCode(o.name)}`,
          `- **Scope:** ${scopeLink(o.scope)}${write && (API_SCOPES as readonly string[]).includes(write) ? `, or ${scopeLink(write)}, which reads too` : ""}`,
          `- **Answers:** ${mdCode(String(o.status))}, ${mdText(words(success.description).replace(/^./, (c) => c.toLowerCase()))}`,
          ...(Object.keys(pages).length > 0
            ? [`- **Pages:** at most ${pages.max} rows, ${pages.default} when ${mdCode(String(pages.limit))} is left out; give an answer's ${mdCode(String(pages.answer))} as ${mdCode(`?${pages.query}=`)} for the page after.`]
            : []),
          ...(o.method === "POST" ? [`- **Once only:** with an ${link(mdCode("Idempotency-Key"), doc(PATHS.admin, "idempotency"))} header.`] : []),
        ].join("\n"),
        pathParameters.length > 0 && `### Path parameters {#${a}-path}`,
        pathParameters.length > 0 && parametersMarkdown(pathParameters),
        query.length > 0 && `### Query parameters {#${a}-query}`,
        query.length > 0 && parametersMarkdown(query),
        request && `### Body {#${a}-body}`,
        request && `JSON, with ${mdCode("Content-Type: application/json")}.`,
        request && schemaMarkdown(schemaTable(request), true),
        `### Answer {#${a}-answer}`,
        answer ? schemaMarkdown(schemaTable(answer), false) : "No body.",
        `### Errors {#${a}-errors}`,
        mdTable(
          ["Status", "Code", "When"],
          errors.map((code) => [String(API_ERRORS[code]), errorLink(code), mdCell(API_ERROR_WORDS[code])]),
        ),
        `### Example request {#${a}-example}`,
        example ? samplesMarkdown(example.call) : "No example could be made from this operation's schema.",
      );
    });
    add({
      path: adminTagPath(tag),
      parent: PATHS.admin,
      title: tag,
      summary: firstSentence(plain(tagWords.get(tag) || `The Admin API's ${tag.toLowerCase()} operations.`)),
      areas: [...new Set<DocArea>(["admin-api", TAG_AREAS[tag] ?? "settings"])],
      sources: ["src/lib/admin-api-routes.ts"],
      items: ops.map((o) => ({ item: "operation", id: o.name, anchor: anchorOf(o.name) })),
      toc: 2,
      markdown: para(operationsTable(ops, true), ...sections),
    });
  }

  // The storefront API ---------------------------------------------------------------------------------------------

  const sfPaths = asObject(storefront.paths);
  const sfScheme = asObject(asObject(asObject(storefront.components).securitySchemes).storefrontToken);
  const sfHeader = String(sfScheme.name ?? "X-Storefront-Token");
  const sfInfo = asObject(storefront.info);
  const sfOps = STOREFRONT_ROUTES.map((route) => {
    const key = `/{store}${route.path}`;
    const own = asObject(asObject(sfPaths[key])[route.method.toLowerCase()]);
    return { route, key, own, tag: String(asList(own.tags).length > 0 ? (own.tags as unknown[])[0] : "Storefront"), anchor: anchorOf(String(own.operationId ?? route.what)) };
  });
  const sfTags = [...new Set(sfOps.map((o) => o.tag))];
  const sfTagWords = new Map(asList(storefront.tags).map((t) => [String(t.name), words(t.description)]));
  const sfTagPath = (tag: string) => `${PATHS.storefront}/${anchorOf(tag)}`;
  const sfTable = (ops: typeof sfOps, here: boolean) =>
    mdTable(
      ["Operation", "What it does"],
      ops.map((o) => [link(mdCode(`${o.route.method} ${o.route.path}`), here ? `#${o.anchor}` : doc(sfTagPath(o.tag), o.anchor)), mdCell(words(o.own.summary))]),
    );
  const sfRate = asObject(storefront["x-rate-limit"]);

  add({
    path: PATHS.storefront,
    parent: REF,
    title: "Storefront API",
    summary: firstSentence(plain(words(sfInfo.description))),
    areas: ["storefront-api"],
    sources: ["src/lib/storefront-api.ts"],
    items: [],
    toc: 2,
    markdown: para(
      `Every call goes to ${mdCode(`${storefrontBase}/{store}/…`)}, ${mdCode("{store}")} the store's slug. The OpenAPI 3.1 document of the same routes is ${link(mdCode("/api/storefront/v1/openapi.json"), "/api/storefront/v1/openapi.json")}.`,
      mdText(afterFirstSentence(words(sfInfo.description))),
      `## Authentication {#authentication}`,
      `Send a storefront token (${mdCode("kfs_…")}, made for one market in the store's Apps and API settings) in the ${mdCode(sfHeader)} header on every call. It opens only what any visitor of its market sees, so it may sit in a site's own code. ${link("Rate limits", doc(PATHS.limits))} says how many calls a minute it may make (${Number(sfRate.per_token).toLocaleString("en-US")}).`,
      ...sfTags.flatMap((tag) => [`## ${link(mdText(tag), doc(sfTagPath(tag)))} {#${anchorOf(tag)}}`, para(mdText(sfTagWords.get(tag) ?? ""), sfTable(sfOps.filter((o) => o.tag === tag), false))]),
    ),
  });

  for (const tag of sfTags) {
    const ops = sfOps.filter((o) => o.tag === tag);
    const sections = ops.map(({ route, key, own, anchor }) => {
      const pathParameters = parametersIn(asObject(sfPaths[key]).parameters, "path");
      const query = parametersIn(own.parameters, "query");
      const request = bodySchema(own.requestBody);
      const responses = asObject(own.responses);
      const success = asObject(responses[String(route.status)]);
      const answer = bodySchema(success);
      const example = storefrontExample(route, storefrontBase, sfHeader);
      return para(
        `## ${mdText(`${route.method} ${route.path}`)} {#${anchor}}`,
        mdCode(`${route.method} ${storefrontBase}${key}`),
        mdText(words(own.summary)),
        `- **Answers:** ${mdCode(String(route.status))}, ${mdText(words(success.description).replace(/^./, (c) => c.toLowerCase()))}`,
        pathParameters.length > 0 && `### Path parameters {#${anchor}-path}`,
        pathParameters.length > 0 && parametersMarkdown(pathParameters),
        query.length > 0 && `### Query parameters {#${anchor}-query}`,
        query.length > 0 && parametersMarkdown(query),
        request && `### Body {#${anchor}-body}`,
        request && `JSON, with ${mdCode("Content-Type: application/json")}.`,
        request && schemaMarkdown(schemaTable(request), true),
        `### Answer {#${anchor}-answer}`,
        answer ? schemaMarkdown(schemaTable(answer), false) : "No body.",
        `### Errors {#${anchor}-errors}`,
        mdTable(
          ["Status", "Codes", "When"],
          refusalsOf(responses).map((r) => [String(r.status), r.codes.map((c) => mdCode(c)).join(", "), mdCell(r.words)]),
        ),
        `### Example request {#${anchor}-example}`,
        example ? samplesMarkdown(example.call) : "No example could be made from this route's schema.",
      );
    });
    add({
      path: sfTagPath(tag),
      parent: PATHS.storefront,
      title: tag,
      summary: firstSentence(plain(sfTagWords.get(tag) || `The storefront API's ${tag.toLowerCase()} routes.`)),
      areas: ["storefront-api", tag === "Carts" ? "orders" : "products"],
      sources: ["src/lib/storefront-api.ts"],
      items: [],
      toc: 2,
      markdown: para(sfTable(ops, true), ...sections),
    });
  }

  // Webhooks -------------------------------------------------------------------------------------------------------

  const hooks = contract.webhooks;
  const topicPath = (id: string) => `${PATHS.webhooks}/${anchorOf(id)}`;
  const receivers = (list: readonly string[]) => {
    // The owner's own endpoints first, then the services; each name may hold an "and" of its own.
    const named = [...list].sort((a, b) => Number(b === "endpoints") - Number(a === "endpoints")).map((r) => RECEIVERS[r] ?? r);
    return (named.length > 1 ? `${named.slice(0, -1).join(", ")}, and ${named[named.length - 1]}` : (named[0] ?? "")).replace(/^./, (c) => c.toUpperCase());
  };
  // A signature to try a check on: the shortest topic's example, signed with a secret shown here and a fixed time.
  const trySecret = "whsec_cmVmZXJlbmNlLW9ubHktbm90LWEtcmVhbC1zZWNyZXQ";
  const tryStamp = Date.UTC(2026, 10, 3, 9, 30) / 1000;
  const tryBody = (() => {
    const bodies = WEBHOOK_TOPICS.map((t) => topicExample(t)).filter((b) => b !== null).map((b) => JSON.stringify(b));
    return bodies.sort((a, b) => a.length - b.length)[0] ?? "{}";
  })();

  add({
    path: PATHS.webhooks,
    parent: REF,
    title: "Webhooks",
    summary: firstSentence(plain(hooks.description)),
    areas: ["webhooks"],
    sources: ["src/lib/webhook-topics.ts", "src/lib/webhook-signature.ts"],
    items: [],
    toc: 3,
    markdown: para(
      mdText(afterFirstSentence(hooks.description)),
      `An owner adds endpoints and chooses their topics in the admin, under ${link("Your own endpoints", "/admin/{store}/integrations/endpoints")}. Every topic and the JSON Schema of its payload are published at ${link(mdCode("/api/webhooks/v1/topics.json"), "/api/webhooks/v1/topics.json")} and in the Admin API's OpenAPI document under ${mdCode("webhooks")}.`,
      `## Topics {#topics}`,
      mdTable(
        ["Topic", "What happened", "Sent to"],
        hooks.topics.map((t) => [link(mdCode(t.id), doc(topicPath(t.id))), mdCell(t.description), mdCell(receivers(t.receivers))]),
      ),
      `## The envelope {#envelope}`,
      `Every delivery is a ${mdCode("POST")} of JSON with the same envelope; its ${mdCode("data")} holds what the topic is about, under its own name, as each topic's page shows. The payload's ${mdCode("version")} is ${hooks.version}: a change to a payload's shape raises it.`,
      schemaMarkdown(schemaTable(asObject(hooks.envelope)), false),
      `## Headers {#headers}`,
      mdTable(
        ["Header", "What it holds"],
        hooks.headers.map((h) => [mdCode(h.name), mdCell(h.description)]),
      ),
      `## Check the signature {#signature}`,
      `Every delivery is signed with the endpoint's own secret (${mdCode("whsec_…")}, shown once when the endpoint is made). Check it before you trust a delivery:`,
      hooks.signature.steps.map((step, i) => `${i + 1}. ${mdText(step)}`).join("\n"),
      `### JavaScript {#signature-javascript}`,
      para("For Node.js, with nothing to install:", mdFence("javascript", javascriptSignatureCheck())),
      `### Python {#signature-python}`,
      para("For Python 3.10 and later, with the standard library alone:", mdFence("python", pythonSignatureCheck())),
      `### PHP {#signature-php}`,
      para("For PHP 8:", mdFence("php", phpSignatureCheck())),
      `### Try your check {#signature-example}`,
      para(
        `This delivery was signed with the secret ${mdCode(trySecret)} at ${mdCode(String(tryStamp))} (${new Date(tryStamp * 1000).toISOString().replace(".000Z", "Z")}). With your clock at that time (or the time check left out while you try), your check must take it, and refuse it with any character of the body changed.`,
        mdFence("http", [`${TIMESTAMP_HEADER}: ${tryStamp}`, `${SIGNATURE_HEADER}: ${signWebhook(trySecret, tryStamp, tryBody)}`, "", tryBody].join("\n")),
      ),
      `## Retries {#retries}`,
      `A delivery your endpoint does not answer with a 2xx status within ${count(hooks.timeout_seconds, "second")} is tried again after ${hooks.retry_seconds.map(spoken).join(", then ")}; after the last it has failed. It keeps its ${mdCode(ID_HEADER)}, so do the work once per id.`,
      `## Send a test {#test}`,
      mdText(hooks.test.description),
    ),
  });

  for (const topic of WEBHOOK_TOPICS) {
    const published = hooks.topics.find((t) => t.id === topic.id);
    const envelope = jsonSchemaOf(webhookEnvelope(z.literal(topic.id), topic.data));
    const example = topicExample(topic);
    add({
      path: topicPath(topic.id),
      parent: PATHS.webhooks,
      title: topic.id,
      summary: `${topic.title}: ${firstSentence(topic.description).replace(/^./, (c) => c.toLowerCase())}`.slice(0, 300),
      areas: [...new Set<DocArea>(["webhooks", SUBJECT_AREAS[topic.subject] ?? "integrations"])],
      sources: ["src/lib/webhook-topics.ts"],
      items: [{ item: "topic", id: topic.id, anchor: null }],
      toc: 2,
      markdown: para(
        [
          `- **Topic:** ${mdCode(topic.id)}, in the ${mdCode(TOPIC_HEADER)} header and the body's ${mdCode("topic")}`,
          `- **Sent to:** ${mdText(receivers(published?.receivers ?? topic.receivers))}`,
          `- **About:** the ${mdCode(topic.subject)}, under ${mdCode(`data.${topic.subject}`)}`,
          `- **Payload version:** ${hooks.version}`,
        ].join("\n"),
        `## Payload {#payload}`,
        schemaMarkdown(schemaTable(envelope), false),
        `## Example {#example}`,
        example === null ? "No example could be made from this topic's schema." : para(mdFence("json", JSON.stringify(example, null, 2)), "Every value is an example of its type, not a real store's."),
        `## Signature and retries {#signature}`,
        `Each delivery carries the ${link("headers", doc(PATHS.webhooks, "headers"))} every topic has and is signed: ${link("check the signature", doc(PATHS.webhooks, "signature"))} before you trust it. One not answered with a 2xx status is ${link("tried again", doc(PATHS.webhooks, "retries"))}.`,
      ),
    });
  }

  // MCP ------------------------------------------------------------------------------------------------------------

  const mcp = contract.mcp;
  const tools = mcp.tools.map((t) => ({ ...t, area: areaOfScope(t.scope ?? t.permission) }));
  const areaOrder = ["stores", ...(Object.keys(AREA_LABELS) as string[]), "owner"];
  const areas = [...new Set(tools.map((t) => t.area))].sort((a, b) => (areaOrder.indexOf(a) + 1 || 99) - (areaOrder.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const areaPath = (area: string) => `${PATHS.mcp}/${anchorOf(area)}`;
  const areaTitle = (area: string) => MCP_AREA_TITLES[area] ?? area.replace(/^./, (c) => c.toUpperCase());
  const gateCell = (gate: unknown) => (typeof gate === "string" ? link(mdCode(gate), doc(PATHS.mcp, "gates")) : "none");
  const endpoint = `${site}${mcp.server.endpoint}`;

  add({
    path: PATHS.mcp,
    parent: REF,
    title: "MCP",
    summary: firstSentence(plain(mcp.description)),
    areas: ["mcp"],
    sources: ["src/lib/mcp-catalogue.ts", "src/lib/owner-tools.ts"],
    items: [],
    toc: 2,
    markdown: para(
      [
        `- **Address:** ${mdCode(endpoint)}`,
        `- **Transport:** ${mdCode(mcp.server.transport)}, protocol version ${mdCode(mcp.server.protocol_version)}`,
        `- **Catalogue:** ${link(mdCode("/api/mcp/catalogue.json"), "/api/mcp/catalogue.json")}, every tool below with its JSON Schema`,
        `- **Sign-in:** OAuth 2.1 with Kaizena Flow's own authorization server; each tool needs its ${link("scope", doc(PATHS.scopes, "mcp"))}`,
      ].join("\n"),
      mdText(afterFirstSentence(mcp.description)),
      `## Areas {#areas}`,
      `The tools by the area of the store each works in, as the permission it needs names it.`,
      mdTable(
        ["Area", "Tools", "Read-only", "With a gate"],
        areas.map((area) => {
          const own = tools.filter((t) => t.area === area);
          return [link(mdText(areaTitle(area)), doc(areaPath(area))), String(own.length), String(own.filter((t) => t.annotations.readOnlyHint).length), String(own.filter((t) => t.gate).length)];
        }),
      ),
      `## Gates {#gates}`,
      `A tool with a gate changes nothing when it is called: the change is kept for the owner to approve in Kaizena Flow's admin, and the answer says so.`,
      mdTable(
        ["Gate", "What it means", "Tools"],
        [...new Set(tools.map((t) => t.gate).filter((g): g is GateCategory => typeof g === "string"))]
          .sort()
          .map((gate) => [mdCode(gate), mdCell(GATE_WORDS[gate] ?? gate), String(tools.filter((t) => t.gate === gate).length)]),
      ),
      `## Annotations {#annotations}`,
      `Each tool carries MCP's hints about what it does, which a client may use to decide what to ask its user first.`,
      mdTable(
        ["Hint", "When it is true"],
        (Object.keys(HINTS) as (keyof typeof HINTS)[]).map((key) => [mdCode(key), mdCell(HINTS[key])]),
      ),
      `## Shopping agents {#shopping-agents}`,
      `A store's public MCP server for AI shopping agents is apart from this one: ${link("Shopping agents", doc(PATHS.agents))}.`,
    ),
  });

  for (const area of areas) {
    const own = tools.filter((t) => t.area === area);
    const sections = own.map((t) => {
      const a = anchorOf(t.name);
      const hints = hintWords(asObject(t.annotations));
      return para(
        `## ${mdText(t.title)} {#${a}}`,
        mdCode(t.name),
        mdText(t.description),
        [
          `- **Gate:** ${typeof t.gate === "string" ? `${gateCell(t.gate)}: ${mdText(GATE_WORDS[t.gate as GateCategory] ?? t.gate)}` : "none: it runs when called"}`,
          `- **Permission:** ${t.permission ? mdCode(t.permission) : "none"}`,
          `- **Scope:** ${t.scope ? link(mdCode(t.scope), doc(PATHS.scopes, "mcp")) : "none"}`,
          ...(t.feature && t.feature.length > 0 ? [`- **Feature:** ${t.feature.map((f) => mdCode(f)).join(", ")} must be on in the store`] : []),
          `- **Hints:** ${hints.length > 0 ? hints.join(", ") : "none"}`,
        ].join("\n"),
        `### Inputs {#${a}-inputs}`,
        schemaMarkdown(schemaTable(asObject(t.inputSchema), "input"), true),
      );
    });
    add({
      path: areaPath(area),
      parent: PATHS.mcp,
      title: areaTitle(area),
      summary: MCP_AREA_LEADS[area] ?? `The owner MCP's tools for the store's ${areaTitle(area).toLowerCase()}.`,
      areas: [...new Set<DocArea>(["mcp", ...(MCP_DOC_AREAS[area as Area] ? [MCP_DOC_AREAS[area as Area] as DocArea] : [])])],
      sources: ["src/lib/mcp-catalogue.ts", "src/lib/owner-tools.ts", "src/lib/owner-tool-permissions.ts"],
      items: own.map((t) => ({ item: "tool", id: t.name, anchor: anchorOf(t.name) })),
      toc: 2,
      markdown: para(
        mdTable(
          ["Tool", "What it does", "Gate", "Permission"],
          own.map((t) => [link(mdCode(t.name), `#${anchorOf(t.name)}`), mdCell(t.title), gateCell(t.gate), t.permission ? mdCode(t.permission) : "none"]),
        ),
        ...sections,
      ),
    });
  }

  const ucp = contract.ucp;
  add({
    path: PATHS.agents,
    parent: PATHS.mcp,
    title: "Shopping agents",
    summary: firstSentence(plain(ucp.description)),
    areas: ["shopping-agents", "mcp"],
    sources: ["src/lib/ucp-catalogue.ts", "src/lib/shopping-agents.ts"],
    items: ucp.tools.map((t) => ({ item: "agent-tool" as const, id: t.name, anchor: anchorOf(t.name) })),
    toc: 2,
    markdown: para(
      [
        `- **Address:** ${mdCode(`${site}${ucp.server.endpoint}`)}, ${mdCode("{store}")} the store's slug`,
        `- **Profile:** ${mdCode(ucp.server.profile)} on the store's own address`,
        `- **Transport:** ${mdCode(ucp.server.transport)}, protocol version ${mdCode(ucp.server.protocol_version)}, UCP ${mdCode(ucp.server.ucp_version)}`,
        `- **Catalogue:** ${link(mdCode("/api/ucp/catalogue.json"), "/api/ucp/catalogue.json")}`,
      ].join("\n"),
      mdText(afterFirstSentence(ucp.description)),
      mdTable(
        ["Tool", "What it does", "Hints"],
        ucp.tools.map((t) => [link(mdCode(t.name), `#${anchorOf(t.name)}`), mdCell(t.title), hintWords(asObject(t.annotations)).join(", ") || "none"]),
      ),
      ...ucp.tools.map((t) =>
        para(
          `## ${mdText(t.title)} {#${anchorOf(t.name)}}`,
          mdCode(t.name),
          mdText(t.description),
          `### Inputs {#${anchorOf(t.name)}-inputs}`,
          schemaMarkdown(schemaTable(asObject(t.inputSchema), "input"), true),
        ),
      ),
    ),
  });

  // Scopes ---------------------------------------------------------------------------------------------------------

  const scopeWords = new Map(asList(admin["x-scopes"]).map((s) => [String(s.scope), words(s.description)]));
  add({
    path: PATHS.scopes,
    parent: REF,
    title: "Scopes",
    summary: "What each Admin API scope opens and the operations that need it, and the scopes an MCP connection asks for.",
    areas: ["authentication", "admin-api", "mcp"],
    sources: ["src/lib/admin-api.ts", "src/lib/admin-openapi.ts", "src/lib/oauth.ts", "src/lib/mcp-catalogue.ts"],
    items: API_SCOPES.map((scope) => ({ item: "scope", id: scope, anchor: anchorOf(scope) })),
    toc: 2,
    markdown: para(
      `## Admin API {#admin-api}`,
      `A token (${mdCode("kf_…")}) holds the scopes its owner chose when making it, and each operation needs one. A ${mdCode(":write")} scope reads too: a token that may change products may read them.`,
      mdTable(
        ["Scope", "What it opens", "Operations"],
        API_SCOPES.map((scope) => [link(mdCode(scope), `#${anchorOf(scope)}`), mdCell(scopeWords.get(scope) ?? ""), String(ADMIN_API.filter((o) => o.scope === scope).length)]),
      ),
      ...API_SCOPES.map((scope) => {
        const ops = ADMIN_API.filter((o) => o.scope === scope);
        return para(
          `### ${mdCode(scope)} {#${anchorOf(scope)}}`,
          mdText(scopeWords.get(scope) ?? ""),
          ops.length > 0 ? ops.map((o) => `- ${link(mdText(o.summary), doc(adminTagPath(o.tag), anchorOf(o.name)))}: ${mdCode(`${o.method} ${o.path}`)}`).join("\n") : "No operation needs it alone yet.",
        );
      }),
      `## MCP {#mcp}`,
      `An MCP client signs in with OAuth 2.1 and asks for scopes: ${mdCode("stores:read")} to list the stores, and one per staff permission. A call needs its tool's scope in the grant, and the person's own role decides at every call, so a token never does more than its person may.`,
      mdTable(
        ["Scope", "Tools that need it"],
        OAUTH_SCOPES.map((scope) => {
          const needing = tools.filter((t) => t.scope === scope);
          const where = [...new Set(needing.map((t) => t.area))];
          return [mdCode(scope), needing.length === 0 ? "none" : `${needing.length}, in ${where.map((area) => link(mdText(areaTitle(area)), doc(areaPath(area)))).join(", ")}`];
        }),
      ),
    ),
  });

  // Errors ---------------------------------------------------------------------------------------------------------

  const adminCodes = (Object.keys(API_ERRORS) as ApiErrorCode[]).sort((a, b) => API_ERRORS[a] - API_ERRORS[b] || a.localeCompare(b));
  const sfRefusals = new Map<number, { codes: Set<string>; words: string }>();
  for (const { own } of sfOps) {
    for (const r of refusalsOf(asObject(own.responses))) {
      const entry = sfRefusals.get(r.status) ?? { codes: new Set<string>(), words: r.words };
      for (const code of r.codes) entry.codes.add(code);
      sfRefusals.set(r.status, entry);
    }
  }
  const envelopeSchema = asObject(asObject(asObject(admin.components).schemas).Error);
  add({
    path: PATHS.errors,
    parent: REF,
    title: "Errors",
    summary: "Every refusal the Admin API and the storefront API answer: its status, its code and what it means.",
    areas: ["errors", "admin-api", "storefront-api"],
    sources: ["src/lib/admin-api.ts", "src/lib/admin-openapi.ts", "src/lib/storefront-api.ts"],
    items: adminCodes.map((code) => ({ item: "error", id: code, anchor: anchorOf(code) })),
    toc: 2,
    markdown: para(
      `## The error envelope {#envelope}`,
      `A refusal answers its HTTP status and this body; branch on ${mdCode("error.code")}, show ${mdCode("error.message")} to a person.`,
      schemaMarkdown(schemaTable(envelopeSchema), false),
      mdFence("json", JSON.stringify({ error: { code: "not_found", message: "No product with that id in this store." } }, null, 2)),
      `## Admin API {#admin-api}`,
      mdTable(
        ["Code", "Status", "What it means"],
        adminCodes.map((code) => [link(mdCode(code), `#${anchorOf(code)}`), String(API_ERRORS[code]), mdCell(API_ERROR_WORDS[code])]),
      ),
      ...adminCodes.map((code) => {
        const ops = ADMIN_API.filter((o) => errorsOf(o).includes(code));
        const common = (COMMON_ERRORS as readonly string[]).includes(code);
        return para(
          `### ${mdCode(code)} {#${anchorOf(code)}}`,
          `Status ${mdCode(String(API_ERRORS[code]))}. ${mdText(API_ERROR_WORDS[code])}`,
          common
            ? "Any operation can answer it."
            : ops.length > 0
              ? `Answered by ${ops.map((o) => link(mdCode(o.name), doc(adminTagPath(o.tag), anchorOf(o.name)))).join(", ")}.`
              : "No operation answers it yet.",
        );
      }),
      `## Storefront API {#storefront-api}`,
      `The storefront API answers the same envelope; its codes say which part of a request it could not take.`,
      mdTable(
        ["Status", "Codes", "What it means"],
        [...sfRefusals.entries()].sort(([a], [b]) => a - b).map(([status, entry]) => [String(status), [...entry.codes].sort().map((c) => mdCode(c)).join(", "), mdCell(entry.words)]),
      ),
    ),
  });

  // Rate limits ----------------------------------------------------------------------------------------------------

  const adminRate = asObject(admin["x-rate-limit"]);
  const per = (n: unknown, who: string) => `${Number(n).toLocaleString("en-US")} a ${who}`;
  const limitRows: string[][] = [
    [link("Admin API", doc(PATHS.admin)), per(adminRate.per_token, "token"), Number(adminRate.per_store).toLocaleString("en-US"), `a ${adminRate.window}`],
    [link("Storefront API", doc(PATHS.storefront)), per(sfRate.per_token, "token"), Number(sfRate.per_store).toLocaleString("en-US"), `a ${sfRate.window}`],
    ...(options.limits?.mcp
      ? [[link("Owner MCP", doc(PATHS.mcp)), per(options.limits.mcp.visitor, "connection, across its stores"), options.limits.mcp.store.toLocaleString("en-US"), `a ${options.limits.mcp.window}`]]
      : []),
    ...(options.limits?.agent
      ? [[link("Shopping agents' MCP", doc(PATHS.agents)), per(options.limits.agent.visitor, "caller"), options.limits.agent.store.toLocaleString("en-US"), `a ${options.limits.agent.window}`]]
      : []),
  ];
  add({
    path: PATHS.limits,
    parent: REF,
    title: "Rate limits",
    summary: "How many calls each API takes from one caller and from a store's callers together, and what a call past them is answered.",
    areas: ["rate-limits", "admin-api", "storefront-api", "mcp"],
    sources: ["src/lib/admin-openapi.ts", "src/lib/storefront-api.ts", "src/server/request-budget.ts"],
    items: [],
    toc: 2,
    markdown: para(
      `Each API counts the calls of one caller and of all of a store's callers together; a call past either is refused until its window turns.`,
      mdTable(["API", "One caller", "A store's callers together", "Window"], limitRows),
      `## When a limit is reached {#reached}`,
      `The Admin API and the storefront API answer ${mdCode("429")} with the code ${errorLink("rate_limited")} and a ${mdCode("Retry-After")} header: the seconds to wait before the next call. Nothing of the refused call was done, so it is safe to send again then. An MCP server answers a call past its limit with a JSON-RPC error, and ${mdCode("429")} with ${mdCode("Retry-After")} when the request was that one call.`,
      `## Keeping within them {#within}`,
      [
        `- Ask for pages of up to 100 rows rather than many small ones, and follow ${mdCode("next")}.`,
        `- Let ${link("webhooks", doc(PATHS.webhooks))} tell you what changed rather than asking again and again.`,
        `- Make one token per integration: each has its own limit, within the store's.`,
      ].join("\n"),
    ),
  });

  // The front page ---------------------------------------------------------------------------------------------------

  const front: Draft = {
    path: REF,
    parent: null,
    title: "API reference",
    summary: "Every Admin API operation, storefront API route, webhook topic and MCP tool, made from the contracts the APIs themselves are built from.",
    areas: ["admin-api", "storefront-api", "webhooks", "mcp"],
    sources: ["src/lib/api-contract.ts"],
    items: [],
    toc: 2,
    markdown: para(
      `These pages are made from Kaizena Flow's published contract${version ? `, version ${mdCode(version)}` : ""}, the same description the APIs check their requests and answers against, so they say what the code does. ${link("The changelog", doc(DOCS_CHANGELOG_PATH))} says what changed in each version. The guides are in the ${link("developers' track", "/docs/developers")}.`,
      mdTable(
        ["Reference", "What it holds", "Machine-readable"],
        [
          [link("Admin API", doc(PATHS.admin)), `${count(ADMIN_API.length, "operation")} in ${count(adminTags.length, "resource")}`, link(mdCode("openapi.json"), "/api/admin/v1/openapi.json")],
          [link("Storefront API", doc(PATHS.storefront)), `${count(sfOps.length, "route")} in ${count(sfTags.length, "resource")}`, link(mdCode("openapi.json"), "/api/storefront/v1/openapi.json")],
          [link("Webhooks", doc(PATHS.webhooks)), `${count(WEBHOOK_TOPICS.length, "topic")}, the envelope and the signature`, link(mdCode("topics.json"), "/api/webhooks/v1/topics.json")],
          [link("MCP", doc(PATHS.mcp)), `${count(tools.length, "tool")} in ${count(areas.length, "area")}, and ${count(ucp.tools.length, "shopping agents' tool", "shopping agents' tools")}`, link(mdCode("catalogue.json"), "/api/mcp/catalogue.json")],
          [link("Scopes", doc(PATHS.scopes)), `${count(API_SCOPES.length, "Admin API scope")} and the MCP's`, ""],
          [link("Errors", doc(PATHS.errors)), `${count(adminCodes.length, "error code")} of the Admin API, and the storefront API's`, ""],
          [link("Rate limits", doc(PATHS.limits)), "How many calls a minute", ""],
          [link("Changelog", doc(DOCS_CHANGELOG_PATH)), "Every version of the contract", ""],
        ],
      ),
    ),
  };

  // In reading order: the front page, then each group with its pages.
  const ordered = [front, ...drafts.filter((d) => d.parent === REF).flatMap((group) => [group, ...drafts.filter((d) => d.parent === group.path), ...drafts.filter((d) => drafts.some((g) => g.parent === group.path && d.parent === g.path))])];
  const problems: ReferenceProblem[] = [];
  const pages: DocRefPage[] = ordered.map((draft) => {
    const parsed = parseMarkdown(draft.markdown);
    for (const p of parsed.problems) problems.push({ path: draft.path, line: p.line, message: p.message });
    return { ...draft, lang: "en", blocks: parsed.blocks, headings: parsed.headings };
  });
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.path)) problems.push({ path: page.path, message: "Two pages of the reference have this address." });
    seen.add(page.path);
    for (const item of page.items) if (item.anchor && !page.headings.some((h) => h.id === item.anchor)) problems.push({ path: page.path, message: `${item.item} ${item.id} has no heading #${item.anchor}.` });
  }
  if (pages.length !== drafts.length + 1) problems.push({ path: REF, message: "A page of the reference is not under its group." });
  return { reference: { version, pages }, problems };
}

/** Where each reference item is, as a docs address with its heading: what the search leads to. */
export function referenceItemUrls(reference: DocReference): Map<string, string> {
  const out = new Map<string, string>();
  for (const page of reference.pages) for (const item of page.items as DocRefItem[]) out.set(`${item.item}:${item.id}`, item.anchor ? `${page.path}#${item.anchor}` : page.path);
  return out;
}
