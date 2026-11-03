/**
 * The reference items the docs' search finds (wave 14 unit E3, D443), from unit A's contracts (D438): every Admin API operation, webhook
 * topic, owner MCP tool, shopping agent's tool, error code and Admin API scope, with its words and the docs' areas it belongs to. Apart from
 * `docs-index.ts` so the docs' pages, which make rows of their own articles at build, never load the catalogues. Pure.
 */

import { API_ERRORS, API_SCOPES, type ApiErrorCode } from "./admin-api";
import { ADMIN_API, errorsOf } from "./admin-api-routes";
import { API_ERROR_WORDS, SCOPE_TEXT } from "./admin-openapi";
import type { DocArea } from "./docs-content";
import type { DocsReferenceItem } from "./docs-index";
import { MCP_TOOLS } from "./mcp-catalogue";
import { UCP_TOOLS } from "./ucp-catalogue";
import { WEBHOOK_TOPICS, type WebhookSubjectName } from "./webhook-topics";

/** The Admin API's resources (`tag`) as the docs' areas. */
const TAG_AREAS: Record<string, DocArea> = {
  Products: "products",
  Inventory: "stock",
  Orders: "orders",
  Customers: "customers",
  Discounts: "marketing",
  Checkout: "settings",
};

/** What a webhook topic is about, as the docs' areas. */
const SUBJECT_AREAS: Record<WebhookSubjectName, DocArea> = {
  order: "orders",
  customer: "customers",
  subscription: "orders",
  support: "customers",
  return: "returns",
  withdrawal: "returns",
  product: "products",
  stock: "stock",
  discount: "marketing",
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** Every item of unit A's contracts the docs' search finds. */
export function docsReferenceItems(): DocsReferenceItem[] {
  const operations = ADMIN_API.map((o) => ({
    item: "operation" as const,
    id: o.name,
    title: o.summary,
    code: `${o.name} · ${o.method} /api/admin/v1${o.path}`,
    text: `${o.name}. ${o.description} Scope: ${o.scope}. Errors: ${errorsOf(o).join(", ")}.`,
    areas: unique<DocArea>(["admin-api", TAG_AREAS[o.tag] ?? "settings"]),
  }));
  const topics = WEBHOOK_TOPICS.map((t) => ({
    item: "topic" as const,
    id: t.id,
    title: t.title,
    code: t.id,
    text: `${t.description} Sent to ${t.receivers.join(" and ")}.`,
    areas: unique<DocArea>(["webhooks", SUBJECT_AREAS[t.subject]]),
  }));
  const tools = MCP_TOOLS.map((t) => ({ item: "tool" as const, id: t.name, title: t.title, code: t.name, text: t.description, areas: ["mcp"] as DocArea[] }));
  const agentTools = UCP_TOOLS.map((t) => ({
    item: "agent-tool" as const,
    id: t.name,
    title: t.title,
    code: t.name,
    text: t.description,
    areas: ["shopping-agents", "mcp"] as DocArea[],
  }));
  const errors = (Object.keys(API_ERRORS) as ApiErrorCode[]).map((code) => ({
    item: "error" as const,
    id: code,
    title: code,
    code: `${API_ERRORS[code]} ${code}`,
    text: API_ERROR_WORDS[code],
    areas: ["errors", "admin-api"] as DocArea[],
  }));
  const scopes = API_SCOPES.map((scope) => ({
    item: "scope" as const,
    id: scope,
    title: scope,
    code: scope,
    text: SCOPE_TEXT[scope],
    areas: ["authentication", "admin-api"] as DocArea[],
  }));
  return [...operations, ...topics, ...tools, ...agentTools, ...errors, ...scopes];
}
