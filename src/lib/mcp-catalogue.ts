import { STORES_READ, type OAuthScope } from "./oauth";
import { OWNER_TOOLS, toolDefinition, type GateCategory, type OwnerTool } from "./owner-tools";
import { TOOL_FEATURES } from "./owner-tool-features";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { GATED_WHEN_LIVE } from "./product-tools";
import { GATED_WHEN_OPEN } from "./setup-tools";

/**
 * The MCP catalogues (wave 14 unit A, D438, `docs/wave-14-developer-platform.md` A4): the owner MCP's tools (`/api/mcp`, D96) and the
 * shopping agents' (`/api/ucp/{store}/mcp`, D353, in `ucp-catalogue.ts`), each with a title and MCP tool annotations (specification 2025-06-18: `readOnlyHint`,
 * `destructiveHint`, `idempotentHint`, `openWorldHint`), published at `/api/mcp/catalogue.json` and `/api/ucp/catalogue.json` and answered
 * by `tools/list`. The tools' own names, descriptions and inputs are `OWNER_TOOLS`' and stay untouched: titles and annotations are worked
 * out here, beside them, so the AI manager's tools and their eval recording (`toolsVersion()`) do not move. Pure.
 */

export type McpAnnotations = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };

export type McpToolInfo = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: McpAnnotations };

/** Tools whose permission is the owner's (`owner`) or another key not named `:read` that only read. A new such tool is decided here (the test asks). */
export const OWNER_KEY_READS: ReadonlySet<string> = new Set([
  "store_overview",
  "legal_pages_status",
  "list_features",
  "setup_progress",
  "get_tax_profile",
  "tax_readiness",
  "invoice_readiness",
  "store_checkup",
  "ai_usage",
  "search_domains",
  "plan_domain_move",
  "start_dns_move_here",
  "list_staff",
  "billing_overview",
]);

/** Gates whose change cannot simply be taken back: money, a domain, who works in the store. */
const DESTRUCTIVE_GATES: ReadonlySet<GateCategory> = new Set(["spend", "domain", "access"]);
/** A name that deletes, ends or takes back. */
const DESTRUCTIVE_NAME = /(^|_)(delete|remove|archive|refund|cancel|end|unpublish|decline|block|undo|stop)(_|$)/;
/** Writes that leave the store as the same call left it when made again with the same arguments. */
const IDEMPOTENT_VERBS: ReadonlySet<string> = new Set(["set", "update", "switch", "publish", "unpublish", "archive", "delete", "remove", "tag", "use", "moderate", "open", "stop", "end", "cancel", "block", "verify"]);
export const IDEMPOTENT_NAMES: ReadonlySet<string> = new Set(["make_theme_live", "change_staff_role", "connect_domain", "apply_winner"]);
/** Tools that reach a service or people outside the store: the web, a registrar's DNS, a payment provider. Gates `send` and `domain` always do. */
export const OPEN_WORLD: ReadonlySet<string> = new Set([
  "search_web",
  "read_web_page",
  "search_domains",
  "check_domain",
  "list_dns_records",
  "plan_domain_move",
  "start_dns_move_here",
  "buy_domain",
  "renew_domain",
  "connect_domain",
  "refund_order",
  "change_order",
  "process_exchange",
  "change_plan",
  "end_plan",
  "issue_gift_card",
]);
const OPEN_WORLD_GATES: ReadonlySet<GateCategory> = new Set(["send", "domain"]);

/** Words a title writes in capitals. */
const CAPITALS: Record<string, string> = { ai: "AI", dns: "DNS", oss: "OSS", vat: "VAT", seo: "SEO", sku: "SKU", ucp: "UCP" };
const TITLES: Record<string, string> = {
  verify_domain_for: "Verify a domain for a service",
  start_dns_move_here: "Look at moving DNS here",
  ask_store_assistant: "Ask the store's assistant",
};

/** A tool's short title: its name in words, such as `list_products` → List products. */
export function toolTitle(name: string): string {
  if (TITLES[name]) return TITLES[name];
  const words = name.split("_").map((w) => CAPITALS[w] ?? w);
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

export const toolPermission = (name: string): string | null => (Object.hasOwn(TOOL_PERMISSIONS, name) ? TOOL_PERMISSIONS[name as keyof typeof TOOL_PERMISSIONS] : null);

/**
 * The scope a call of an owner MCP tool needs from an OAuth grant (D439, B3): `stores:read` to list the stores, the owner's key to ask the
 * store's assistant (it is the owner's, as `/assistant` is), and each owner tool's own permission key. Null for a name that is no tool.
 */
export function toolScope(name: string): OAuthScope | null {
  if (name === "list_stores") return STORES_READ;
  if (name === "ask_store_assistant") return "owner";
  return Object.hasOwn(TOOL_PERMISSIONS, name) ? TOOL_PERMISSIONS[name as keyof typeof TOOL_PERMISSIONS] : null;
}

/** Whether a tool only reads: no gate, and the permission it needs is a reading one. */
export function isReadOnly(tool: Pick<OwnerTool, "name" | "gate">): boolean {
  if (tool.gate) return false;
  const permission = toolPermission(tool.name) ?? "";
  return permission.endsWith(":read") || OWNER_KEY_READS.has(tool.name);
}

/** The MCP annotations of an owner tool, from its gate, its permission and its name. */
export function toolAnnotations(tool: Pick<OwnerTool, "name" | "gate">): McpAnnotations {
  const readOnly = isReadOnly(tool);
  const verb = tool.name.split("_")[0];
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && ((tool.gate !== undefined && DESTRUCTIVE_GATES.has(tool.gate)) || DESTRUCTIVE_NAME.test(tool.name)),
    idempotentHint: readOnly || IDEMPOTENT_VERBS.has(verb) || IDEMPOTENT_NAMES.has(tool.name),
    openWorldHint: OPEN_WORLD.has(tool.name) || (tool.gate !== undefined && OPEN_WORLD_GATES.has(tool.gate)),
  };
}

const STORE_ARG = { type: "string", description: "The store, by its slug from list_stores." };

/** The owner MCP's view of a store tool: the same, plus the store it is for and what its gate means from outside. */
function withStore(tool: OwnerTool): McpToolInfo {
  const { parameters } = toolDefinition(tool);
  const properties = { store: STORE_ARG, ...((parameters.properties as Record<string, unknown>) ?? {}) };
  const required = ["store", ...((parameters.required as string[]) ?? [])];
  const gate = !tool.gate
    ? ""
    : GATED_WHEN_LIVE.has(tool.name)
      ? " On a product that is on the site it is not done from here: it is kept for the owner to approve in Kaizena Flow's admin."
      : GATED_WHEN_OPEN.has(tool.name)
        ? " On a store that is open it is not done from here: it is kept for the owner to approve in Kaizena Flow's admin."
        : " It is not done from here: it is kept for the owner to approve in Kaizena Flow's admin.";
  return { name: tool.name, title: toolTitle(tool.name), description: `${tool.description}${gate}`, inputSchema: { ...parameters, properties, required }, annotations: toolAnnotations(tool) };
}

/** Every tool of the owner MCP (`/api/mcp`): the two of its own, then every owner tool with the store it is for. */
export const MCP_TOOLS: McpToolInfo[] = [
  {
    name: "list_stores",
    title: "List stores",
    description: "The stores this connection reaches in Kaizena Flow: slug, name. Every other tool takes one of these slugs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ask_store_assistant",
    title: toolTitle("ask_store_assistant"),
    description:
      "Asks the store's own assistant, in Kaizena Flow, a question or for something to be done, in words; it answers from the store's data with its tools. Changes it prepares wait for the owner's approval in Kaizena Flow's admin.",
    inputSchema: {
      type: "object",
      properties: {
        store: STORE_ARG,
        question: { type: "string", maxLength: 4000 },
        continue_admin_conversation: {
          type: "boolean",
          description:
            "Kaizen Life only: true to go on in the conversation the owner last had with the store's assistant in Kaizena Flow's admin (within the last 24 hours), so it knows what was said there. Any other assistant, and Kaizen Life otherwise, always asks in its own conversation with it.",
        },
      },
      required: ["store", "question"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  ...OWNER_TOOLS.map(withStore),
];

/** The owner MCP's catalogue (`/api/mcp/catalogue.json`): no store's data, only what each tool is, needs and does. */
export function mcpCatalogue() {
  const byName = new Map<string, OwnerTool>(OWNER_TOOLS.map((t) => [t.name, t]));
  return {
    server: { endpoint: "/api/mcp", transport: "streamable-http", protocol_version: "2025-06-18" },
    description:
      "The tools of a store owner's MCP server. Every tool but list_stores takes the store it is for. A tool with a gate changes nothing from here: the change is kept for the owner to approve in Kaizena Flow's admin. A tool stands behind a store feature when it names one, and needs the permission it names in that store. With an OAuth token from Kaizena Flow (D439), a call also needs that permission as a scope of the token's grant (list_stores needs stores:read), and the person's own role decides at every call.",
    tools: MCP_TOOLS.map((t) => {
      const own = byName.get(t.name);
      const feature = own && Object.hasOwn(TOOL_FEATURES, own.name) ? TOOL_FEATURES[own.name as keyof typeof TOOL_FEATURES] : undefined;
      return {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        gate: own?.gate ?? null,
        permission: own ? toolPermission(own.name) : t.name === "ask_store_assistant" ? "owner" : null,
        // The scope an OAuth grant needs to call it (D439).
        scope: toolScope(t.name),
        feature: feature === undefined ? null : typeof feature === "string" ? [feature] : [...feature],
        annotations: t.annotations,
      };
    }),
  };
}
