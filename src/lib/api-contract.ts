import { createHash } from "node:crypto";

import { adminOpenApi } from "./admin-openapi";
import { mcpCatalogue } from "./mcp-catalogue";
import { canonicalJson, type JsonSchema } from "./openapi";
import { storefrontOpenApi } from "./storefront-api";
import { ucpCatalogue } from "./ucp-catalogue";
import { webhookCatalogue } from "./webhook-topics";

/**
 * The published contract and its version (wave 14 unit A, D438, `docs/wave-14-developer-platform.md` A5): the Admin API's and the
 * storefront's OpenAPI documents, the webhook topics and the MCP catalogues, generated, written as canonical JSON and hashed. The hash and
 * the version (`1.<n>`) are kept in `src/data/api-contract.json`, and the contract's surface (every operation, topic and tool, every field an
 * answer or a payload holds and every field a request must send) in `src/data/api-contract-surface.json`: `api-contract.test.ts` fails when
 * the contract changes without a new version and its entry in `content/docs/developers/changelog.md`, and when a field or a path is taken
 * away (or a request must send a new field) within the same major version. Pure.
 */

/** The address the contract is generated for: the served documents name the site they are served from. */
export const CONTRACT_SERVER = "https://kaizenaflow.com";

export function apiContract() {
  return {
    admin: adminOpenApi(`${CONTRACT_SERVER}/api/admin/v1`),
    storefront: storefrontOpenApi(`${CONTRACT_SERVER}/api/storefront/v1`),
    webhooks: webhookCatalogue(),
    mcp: mcpCatalogue(),
    ucp: ucpCatalogue(),
  };
}

export const contractHash = (contract: unknown = apiContract()): string => createHash("sha256").update(canonicalJson(contract)).digest("hex");

const asObject = (value: unknown): JsonSchema => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchema) : {});

/** Every field a schema describes, as dotted paths (`data[].id`), through objects, arrays and the branches of a union. */
function fieldsOf(schema: unknown, at: string, out: Set<string>): void {
  const s = asObject(schema);
  for (const branch of [...((s.anyOf as unknown[]) ?? []), ...((s.oneOf as unknown[]) ?? []), ...((s.allOf as unknown[]) ?? [])]) fieldsOf(branch, at, out);
  if (s.items) fieldsOf(s.items, `${at}[]`, out);
  for (const [name, inner] of Object.entries(asObject(s.properties))) {
    const path = at ? `${at}.${name}` : name;
    out.add(path);
    fieldsOf(inner, path, out);
  }
}

/** Every field a request must send, as dotted paths: required at each level outside a union's branches (a new branch never breaks a caller). */
function requiredOf(schema: unknown, at: string, out: Set<string>): void {
  const s = asObject(schema);
  if (s.items) requiredOf(s.items, `${at}[]`, out);
  const properties = asObject(s.properties);
  for (const name of (s.required as string[] | undefined) ?? []) {
    const path = at ? `${at}.${name}` : name;
    out.add(path);
    requiredOf(properties[name], path, out);
  }
}

const OPERATIONS = ["get", "post", "put", "patch", "delete"] as const;

function openApiSurface(api: string, doc: JsonSchema, out: string[]): void {
  for (const [path, item] of Object.entries(asObject(doc.paths))) {
    for (const method of OPERATIONS) {
      const op = asObject(asObject(item)[method]);
      if (Object.keys(op).length === 0) continue;
      const name = `${api} ${method.toUpperCase()} ${path}`;
      out.push(name);
      const ok = Object.entries(asObject(op.responses)).find(([status]) => status.startsWith("2"));
      const answer = new Set<string>();
      fieldsOf(asObject(asObject(asObject(ok?.[1]).content)["application/json"]).schema, "", answer);
      for (const field of answer) out.push(`${name} -> ${field}`);
      const body = new Set<string>();
      requiredOf(asObject(asObject(asObject(op.requestBody).content)["application/json"]).schema, "", body);
      for (const field of body) out.push(`${name} <- ${field} (required)`);
      for (const p of (op.parameters as JsonSchema[] | undefined) ?? []) if (p.required && p.in === "query") out.push(`${name} <- ?${String(p.name)} (required)`);
    }
  }
}

/**
 * The contract's surface: what a caller may rely on. A line that ends `(required)` is something a caller must send; every other line is
 * something the contract offers (an operation, a topic, a tool, a field of an answer or a payload).
 */
export function contractSurface(contract: ReturnType<typeof apiContract> = apiContract()): string[] {
  const out: string[] = [];
  openApiSurface("admin", contract.admin as unknown as JsonSchema, out);
  openApiSurface("storefront", contract.storefront as unknown as JsonSchema, out);
  for (const topic of contract.webhooks.topics) {
    const name = `webhook ${topic.id}`;
    out.push(name);
    const fields = new Set<string>();
    fieldsOf(topic.data, "data", fields);
    for (const field of fields) out.push(`${name} -> ${field}`);
  }
  for (const [server, tools] of [
    ["mcp", contract.mcp.tools],
    ["ucp", contract.ucp.tools],
  ] as const) {
    for (const tool of tools) {
      const name = `${server} ${tool.name}`;
      out.push(name);
      const required = new Set<string>();
      requiredOf(tool.inputSchema, "", required);
      for (const field of required) out.push(`${name} <- ${field} (required)`);
    }
  }
  return [...new Set(out)].sort();
}

/**
 * What would break a caller between a kept surface and the one now: anything offered that is gone, and anything a request must now send
 * that it did not have to (unless its whole operation or tool is new).
 */
export function breakingChanges(kept: readonly string[], now: readonly string[]): string[] {
  const before = new Set(kept);
  const after = new Set(now);
  const owner = (line: string) => line.split(/ (?:->|<-) /)[0];
  const removed = kept.filter((line) => !line.endsWith("(required)") && !after.has(line)).map((line) => `removed: ${line}`);
  const demanded = now.filter((line) => line.endsWith("(required)") && !before.has(line) && before.has(owner(line))).map((line) => `now required: ${line}`);
  return [...removed, ...demanded];
}

/** A version's major and minor numbers (`1.4` gives 1 and 4). */
export function versionParts(version: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/** The versions the changelog has an entry for: each heading `## 1.0 — 2026-11-03`. */
export function changelogVersions(markdown: string): { version: string; date: string }[] {
  return [...markdown.matchAll(/^##\s+(\d+\.\d+)\s+[—-]\s+(\d{4}-\d{2}-\d{2})\b/gm)].map((m) => ({ version: m[1], date: m[2] }));
}
