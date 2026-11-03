import type { McpAnnotations } from "./mcp-catalogue";
import { AGENT_TOOLS, UCP_VERSION, type AgentToolName } from "./shopping-agents";

/**
 * The shopping agents' MCP catalogue (wave 14 unit A, D438): `AGENT_TOOLS` (D353) with a title and MCP tool annotations each, as a store's
 * `/api/ucp/{store}/mcp` answers `tools/list` and `/api/ucp/catalogue.json` publishes them. Kept apart from the owner MCP's catalogue so a
 * store's public endpoint loads none of the AI manager's tools. Pure.
 */

const AGENT_TITLES: Record<AgentToolName, string> = {
  search_catalog: "Search the catalogue",
  lookup_catalog: "Look up products",
  get_product: "Get a product",
  create_cart: "Create a cart",
};

const READING: McpAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const AGENT_ANNOTATIONS: Record<AgentToolName, McpAnnotations> = {
  search_catalog: READING,
  lookup_catalog: READING,
  get_product: READING,
  // A cart is made in the store, never ordered or paid: nothing is taken away, and each call makes a new one.
  create_cart: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

/** The shopping agents' tools as `tools/list` answers them: `AGENT_TOOLS` with a title and annotations. */
export const UCP_TOOLS = AGENT_TOOLS.map((t) => ({ ...t, title: AGENT_TITLES[t.name], annotations: AGENT_ANNOTATIONS[t.name] }));

/** The shopping agents' catalogue (`/api/ucp/catalogue.json`): a store's public MCP server for AI shopping agents, by UCP. */
export function ucpCatalogue() {
  return {
    server: { endpoint: "/api/ucp/{store}/mcp", profile: "/.well-known/ucp", transport: "streamable-http", protocol_version: "2025-06-18", ucp_version: UCP_VERSION },
    description:
      "A store's public MCP server for AI shopping agents, as the Universal Commerce Protocol describes it: no token and nothing of a person, within a budget per caller and per store, while the store takes shopping agents. Prices are minor units with the currency, VAT included. Nothing is ordered or paid here: create_cart answers a link to the store's own checkout.",
    tools: UCP_TOOLS,
  };
}
