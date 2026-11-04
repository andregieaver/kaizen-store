import { describe, expect, it } from "vitest";

import { API_ERRORS, API_SCOPES, isApiPower } from "./admin-api";
import { ADMIN_API, errorsOf } from "./admin-api-routes";
import { ADMIN_RATE, adminOpenApi } from "./admin-openapi";
import { canonicalJson, jsonSchemaOf, parametersOf, pathParams, type JsonSchema } from "./openapi";
import { STOREFRONT_RATE, STOREFRONT_ROUTES, storefrontOpenApi } from "./storefront-api";
import { WEBHOOK_TOPICS } from "./webhook-topics";
import { z } from "zod";

/**
 * The published OpenAPI 3.1 documents (D438) hold together as the format asks. No validator of the format is among the dependencies, so this
 * is a structural check written from the specification (OpenAPI 3.1.0, sections 4.8.1 to 4.8.30, and JSON Schema 2020-12 for the schemas):
 * the required fields of each object, the places each may stand, every `$ref` found, every path parameter declared, ids unique.
 */

type Node = JsonSchema;
const isObject = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

const HTTP = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const PATH_ITEM_KEYS = new Set(["$ref", "summary", "description", "servers", "parameters", ...HTTP]);
const OPERATION_KEYS = new Set(["tags", "summary", "description", "externalDocs", "operationId", "parameters", "requestBody", "responses", "callbacks", "deprecated", "security", "servers"]);
const PARAMETER_KEYS = new Set(["name", "in", "description", "required", "deprecated", "allowEmptyValue", "style", "explode", "allowReserved", "schema", "example", "examples", "content"]);
const RESPONSE_KEYS = new Set(["description", "headers", "content", "links"]);
const MEDIA_KEYS = new Set(["schema", "example", "examples", "encoding"]);
const ROOT_KEYS = new Set(["openapi", "info", "jsonSchemaDialect", "servers", "paths", "webhooks", "components", "security", "tags", "externalDocs"]);
const COMPONENT_KEYS = new Set(["schemas", "responses", "parameters", "examples", "requestBodies", "headers", "securitySchemes", "links", "callbacks", "pathItems"]);
const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
/** The JSON Schema 2020-12 keywords (core, applicator, validation, format, meta-data) the documents may use. */
const SCHEMA_KEYS = new Set([
  "$ref", "$defs", "$id", "$comment", "type", "enum", "const", "properties", "required", "additionalProperties", "propertyNames", "patternProperties",
  "items", "prefixItems", "minItems", "maxItems", "uniqueItems", "contains", "anyOf", "oneOf", "allOf", "not", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "title", "description", "default",
  "examples", "deprecated", "readOnly", "writeOnly", "minProperties", "maxProperties",
]);

const extension = (key: string) => key.startsWith("x-");

/** The problems of an OpenAPI 3.1 document, as `where: what` lines; none for a sound one. */
function openApiProblems(doc: Node): string[] {
  const problems: string[] = [];
  const say = (where: string, what: string) => problems.push(`${where}: ${what}`);
  const keysOf = (node: Node, allowed: Set<string>, where: string) => {
    for (const key of Object.keys(node)) if (!allowed.has(key) && !extension(key)) say(where, `unknown field ${key}`);
  };

  const resolve = (ref: string): unknown => {
    if (!ref.startsWith("#/")) return undefined;
    return ref
      .slice(2)
      .split("/")
      .reduce<unknown>((node, part) => (isObject(node) ? node[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), doc);
  };

  const schema = (node: unknown, where: string) => {
    if (typeof node === "boolean") return;
    if (!isObject(node)) return say(where, "a schema is an object or a boolean");
    for (const key of Object.keys(node)) if (!SCHEMA_KEYS.has(key) && !extension(key)) say(where, `unknown schema keyword ${key}`);
    if (typeof node.$ref === "string" && resolve(node.$ref) === undefined && !node.$ref.startsWith("#/$defs/")) say(where, `$ref ${node.$ref} not found`);
    const types = node.type === undefined ? [] : Array.isArray(node.type) ? node.type : [node.type];
    for (const t of types) if (!SCHEMA_TYPES.has(String(t))) say(where, `type ${String(t)}`);
    if (node.required !== undefined) {
      if (!Array.isArray(node.required) || node.required.some((r) => typeof r !== "string")) say(where, "required is a list of names");
      else if (isObject(node.properties)) for (const r of node.required) if (!(r in node.properties)) say(where, `required ${r} is not a property`);
    }
    if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) say(where, "enum is a non-empty list");
    if (isObject(node.properties)) for (const [k, v] of Object.entries(node.properties)) schema(v, `${where}.${k}`);
    else if (node.properties !== undefined) say(where, "properties is an object");
    for (const key of ["items", "additionalProperties", "propertyNames", "not", "contains"]) if (node[key] !== undefined) schema(node[key], `${where}.${key}`);
    for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
      if (node[key] === undefined) continue;
      if (!Array.isArray(node[key]) || (node[key] as unknown[]).length === 0) say(where, `${key} is a non-empty list`);
      else (node[key] as unknown[]).forEach((s, i) => schema(s, `${where}.${key}[${i}]`));
    }
    if (isObject(node.$defs)) for (const [k, v] of Object.entries(node.$defs)) schema(v, `${where}.$defs.${k}`);
  };

  const content = (node: unknown, where: string) => {
    if (!isObject(node) || Object.keys(node).length === 0) return say(where, "content maps media types");
    for (const [type, media] of Object.entries(node)) {
      if (!/^[a-z]+\/[a-z0-9.+*-]+$/.test(type)) say(where, `media type ${type}`);
      if (!isObject(media)) {
        say(`${where}.${type}`, "a media type object");
        continue;
      }
      keysOf(media, MEDIA_KEYS, `${where}.${type}`);
      if (media.schema !== undefined) schema(media.schema, `${where}.${type}.schema`);
    }
  };

  const deref = (node: unknown): unknown => (isObject(node) && typeof node.$ref === "string" ? resolve(node.$ref) : node);

  const parameter = (raw: unknown, where: string): { name: string; in: string } | null => {
    if (isObject(raw) && typeof raw.$ref === "string" && resolve(raw.$ref) === undefined) {
      say(where, `$ref ${raw.$ref} not found`);
      return null;
    }
    const node = deref(raw);
    if (!isObject(node)) {
      say(where, "a parameter object");
      return null;
    }
    keysOf(node, PARAMETER_KEYS, where);
    if (typeof node.name !== "string" || !node.name) say(where, "a parameter has a name");
    if (!["query", "header", "path", "cookie"].includes(String(node.in))) say(where, `in ${String(node.in)}`);
    if (node.in === "path" && node.required !== true) say(where, "a path parameter is required");
    if ((node.schema === undefined) === (node.content === undefined)) say(where, "a parameter has a schema or a content, not both");
    if (node.schema !== undefined) schema(node.schema, `${where}.schema`);
    return { name: String(node.name), in: String(node.in) };
  };

  const schemes = isObject(doc.components) && isObject(doc.components.securitySchemes) ? doc.components.securitySchemes : {};
  const operationIds = new Set<string>();
  const declaredTags = new Set(Array.isArray(doc.tags) ? doc.tags.map((t) => (isObject(t) ? String(t.name) : "")) : []);

  const operation = (node: unknown, where: string, inherited: { name: string; in: string }[], template: string | null) => {
    if (!isObject(node)) return say(where, "an operation object");
    keysOf(node, OPERATION_KEYS, where);
    if (typeof node.operationId === "string") {
      if (operationIds.has(node.operationId)) say(where, `operationId ${node.operationId} twice`);
      operationIds.add(node.operationId);
    }
    for (const tag of (node.tags as unknown[]) ?? []) if (!declaredTags.has(String(tag))) say(where, `tag ${String(tag)} is not declared`);
    const own = ((node.parameters as unknown[]) ?? []).map((p, i) => parameter(p, `${where}.parameters[${i}]`)).filter((p) => p !== null);
    const seen = new Set<string>();
    for (const p of own) {
      if (seen.has(`${p.in} ${p.name}`)) say(where, `parameter ${p.name} twice`);
      seen.add(`${p.in} ${p.name}`);
    }
    if (template !== null) {
      const inPath = [...inherited, ...own].filter((p) => p.in === "path").map((p) => p.name);
      for (const name of pathParams(template)) if (!inPath.includes(name)) say(where, `path parameter ${name} is not declared`);
      for (const name of inPath) if (!pathParams(template).includes(name)) say(where, `path parameter ${name} is not in the path`);
    }
    if (node.requestBody !== undefined) {
      const body = deref(node.requestBody);
      if (!isObject(body)) say(where, "requestBody is an object");
      else content(body.content, `${where}.requestBody.content`);
    }
    if (!isObject(node.responses) || Object.keys(node.responses).length === 0) say(where, "responses has at least one response");
    else {
      for (const [status, raw] of Object.entries(node.responses)) {
        if (!/^([1-5](\d\d|XX)|default)$/.test(status)) say(where, `response status ${status}`);
        const response = deref(raw);
        if (!isObject(response)) {
          say(`${where}.responses.${status}`, "a response object");
          continue;
        }
        keysOf(response, RESPONSE_KEYS, `${where}.responses.${status}`);
        if (typeof response.description !== "string") say(`${where}.responses.${status}`, "a response has a description");
        if (response.content !== undefined) content(response.content, `${where}.responses.${status}.content`);
        for (const [name, header] of Object.entries(isObject(response.headers) ? response.headers : {})) {
          const h = deref(header);
          if (!isObject(h) || (h.schema === undefined && h.content === undefined)) say(`${where}.responses.${status}.headers.${name}`, "a header has a schema");
        }
      }
    }
    for (const requirement of (node.security as unknown[]) ?? []) {
      if (!isObject(requirement)) say(where, "a security requirement is an object");
      else for (const [name, scopes] of Object.entries(requirement)) if (!(name in schemes) || !Array.isArray(scopes)) say(where, `security scheme ${name}`);
    }
  };

  const pathItem = (node: unknown, where: string, template: string | null) => {
    if (!isObject(node)) return say(where, "a path item object");
    keysOf(node, PATH_ITEM_KEYS, where);
    const inherited = ((node.parameters as unknown[]) ?? []).map((p, i) => parameter(p, `${where}.parameters[${i}]`)).filter((p) => p !== null);
    const ops = HTTP.filter((m) => node[m] !== undefined);
    if (ops.length === 0) say(where, "a path item has an operation");
    for (const m of ops) operation(node[m], `${where}.${m}`, inherited, template);
  };

  keysOf(doc, ROOT_KEYS, "document");
  if (typeof doc.openapi !== "string" || !/^3\.1\.\d+$/.test(doc.openapi)) say("openapi", "3.1.x");
  if (!isObject(doc.info) || typeof doc.info.title !== "string" || typeof doc.info.version !== "string") say("info", "title and version are strings");
  if (doc.paths === undefined && doc.webhooks === undefined && doc.components === undefined) say("document", "paths, webhooks or components");
  for (const server of (doc.servers as unknown[]) ?? []) if (!isObject(server) || typeof server.url !== "string") say("servers", "each has a url");
  for (const [template, item] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    if (!template.startsWith("/")) say(`paths.${template}`, "a path starts with /");
    pathItem(item, `paths.${template}`, template);
  }
  for (const [name, item] of Object.entries(isObject(doc.webhooks) ? doc.webhooks : {})) pathItem(item, `webhooks.${name}`, null);
  if (isObject(doc.components)) {
    keysOf(doc.components, COMPONENT_KEYS, "components");
    for (const [name, s] of Object.entries(isObject(doc.components.schemas) ? doc.components.schemas : {})) schema(s, `components.schemas.${name}`);
    for (const [name, p] of Object.entries(isObject(doc.components.parameters) ? doc.components.parameters : {})) parameter(p, `components.parameters.${name}`);
    for (const [name, s] of Object.entries(schemes)) {
      if (!isObject(s) || !["apiKey", "http", "mutualTLS", "oauth2", "openIdConnect"].includes(String(s.type))) say(`components.securitySchemes.${name}`, "a known type");
      else if (s.type === "http" && typeof s.scheme !== "string") say(`components.securitySchemes.${name}`, "http has a scheme");
      else if (s.type === "apiKey" && (typeof s.name !== "string" || !["query", "header", "cookie"].includes(String(s.in)))) say(`components.securitySchemes.${name}`, "apiKey has a name and in");
    }
  }
  for (const requirement of (doc.security as unknown[]) ?? []) if (isObject(requirement)) for (const name of Object.keys(requirement)) if (!(name in schemes)) say("security", `scheme ${name}`);
  return problems;
}

const asNode = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Node;

describe("the Admin API's OpenAPI document (D438)", () => {
  const doc = asNode(adminOpenApi("https://kaizenaflow.example/api/admin/v1", "1.0"));

  it("is sound OpenAPI 3.1", () => {
    expect(openApiProblems(doc)).toEqual([]);
  });

  it("holds every operation with its scope, its parameters, its body and every refusal at its status", () => {
    const paths = doc.paths as Record<string, Record<string, Node>>;
    for (const o of ADMIN_API) {
      const op = paths[o.path]?.[o.method.toLowerCase()];
      expect(op?.operationId, `${o.method} ${o.path}`).toBe(o.name);
      expect(op["x-required-scope"]).toBe(o.scope);
      // An owner's token with the operation's scope, or an app's (D441) with its permission and, for a power, the power; the owner's own
      // operations (the webhook endpoints) take no app.
      expect(op.security).toEqual(
        o.permission === "owner" ? [{ adminToken: [o.scope] }] : [{ adminToken: [o.scope] }, { appOAuth: [o.permission, ...(isApiPower(o.scope) ? [o.scope] : [])] }],
      );
      expect(Boolean(op.requestBody)).toBe("body" in o);
      const statuses = Object.keys(op.responses as Node);
      expect(statuses).toContain(String(o.status));
      for (const code of errorsOf(o)) {
        const refusal = (op.responses as Record<string, Node>)[String(API_ERRORS[code])];
        const codes = (((refusal.content as Node)["application/json"] as Node).schema as { properties: { error: { properties: { code: { enum: string[] } } } } }).properties.error.properties.code.enum;
        expect(codes, `${o.name} ${code}`).toContain(code);
      }
      // A POST takes an Idempotency-Key; a list says how it pages.
      if (o.method === "POST") expect(op.parameters).toContainEqual({ $ref: "#/components/parameters/IdempotencyKey" });
      if ("query" in o && "after" in o.query.shape) expect(op["x-pagination"]).toMatchObject({ query: "after", answer: "next", max: 100 });
    }
    expect(Object.values(paths).flatMap((item) => Object.keys(item).filter((k) => k !== "parameters"))).toHaveLength(ADMIN_API.length);
  });

  it("names the bearer token, the scopes, the budget and the webhook topics", () => {
    expect((doc.components as Node).securitySchemes).toMatchObject({ adminToken: { type: "http", scheme: "bearer", bearerFormat: "kf_" } });
    expect((doc["x-scopes"] as { scope: string }[]).map((s) => s.scope)).toEqual([...API_SCOPES]);
    expect(doc["x-rate-limit"]).toEqual({ window: "minute", per_token: ADMIN_RATE.perToken, per_store: ADMIN_RATE.perStore });
    expect(Object.keys(doc.webhooks as Node).sort()).toEqual(WEBHOOK_TOPICS.map((t) => t.id).sort());
    expect((doc.info as Node)["x-contract-version"]).toBe("1.0");
    expect((adminOpenApi("https://x").info as Node)["x-contract-version"]).toBeUndefined();
  });
});

describe("the storefront API's OpenAPI document (D398, D438)", () => {
  const doc = asNode(storefrontOpenApi("https://kaizenaflow.example/api/storefront/v1"));

  it("is sound OpenAPI 3.1", () => {
    expect(openApiProblems(doc)).toEqual([]);
  });

  it("holds every route's query, body and answer from its zod", () => {
    const paths = doc.paths as Record<string, Record<string, Node>>;
    for (const route of STOREFRONT_ROUTES) {
      const op = paths[`/{store}${route.path}`][route.method.toLowerCase()];
      expect(Boolean(op.requestBody), route.what).toBe("body" in route);
      expect((op.responses as Record<string, Node>)[String(route.status)]).toHaveProperty("content");
      if ("query" in route) expect((op.parameters as { name: string }[]).map((p) => p.name)).toEqual(["category", "tag", "sort", "limit"]);
    }
    expect(doc["x-rate-limit"]).toEqual({ window: "minute", per_token: STOREFRONT_RATE.perToken, per_store: STOREFRONT_RATE.perStore });
  });
});

describe("the structural check itself", () => {
  it("finds what a broken document gets wrong", () => {
    const broken = {
      openapi: "3.0.0",
      info: { title: "x" },
      paths: {
        "/a/{id}": { get: { operationId: "a", responses: { "200": {} }, tags: ["Nope"] } },
        "/b": { post: { operationId: "a", requestBody: { content: { "application/json": { schema: { type: "text", required: ["q"], properties: {} } } } }, responses: {} } },
      },
      components: { parameters: { P: { name: "p", in: "path", schema: {} } } },
      security: [{ missing: [] }],
    };
    const problems = openApiProblems(broken);
    expect(problems).toEqual(
      expect.arrayContaining([
        "openapi: 3.1.x",
        "info: title and version are strings",
        "paths./a/{id}.get: tag Nope is not declared",
        "paths./a/{id}.get: path parameter id is not declared",
        "paths./a/{id}.get.responses.200: a response has a description",
        "paths./b.post: operationId a twice",
        "paths./b.post.requestBody.content.application/json.schema: type text",
        "paths./b.post.requestBody.content.application/json.schema: required q is not a property",
        "paths./b.post: responses has at least one response",
        "components.parameters.P: a path parameter is required",
        "security: scheme missing",
      ]),
    );
  });
});

describe("the shared parts", () => {
  it("lift a parameter's description and keep only the format of an id or a time", () => {
    const params = parametersOf(z.object({ id: z.guid().describe("The id."), at: z.iso.datetime().optional() }), "query");
    expect(params).toEqual([
      { name: "id", in: "query", required: true, description: "The id.", schema: { type: "string", format: "uuid" } },
      { name: "at", in: "query", required: false, schema: { type: "string", format: "date-time" } },
    ]);
    expect(jsonSchemaOf(z.int())).toEqual({ type: "integer" });
  });

  it("writes the same JSON for the same contract, whatever the order of its keys", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}');
  });
});
