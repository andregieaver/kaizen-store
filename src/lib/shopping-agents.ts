/**
 * Shopping agents (wave 8 unit I, D353, `docs/wave-8-analytics-ai.md` section 4, I): the pure parts of a store's public endpoint for AI
 * shopping agents, as the Universal Commerce Protocol describes it (UCP, version `2026-08-25`, read at ucp.dev on 28 October 2026): the
 * business profile served at `/.well-known/ucp`, the tools of its MCP server (`search_catalog`, `lookup_catalog`, `get_product`, `create_cart`)
 * and how their arguments are read. Ids are Global IDs (`gid://kaizena-flow/Product/{uuid}`, `…/ProductVariant/{uuid}`); a bare uuid is read too.
 * Prices are UCP's: integer minor units with the currency, VAT included as the storefront charges them. Nothing here is paid or ordered.
 */

export const UCP_VERSION = "2026-08-25";

const UCP_SPEC = `https://ucp.dev/${UCP_VERSION}/specification/overview`;
const UCP_SCHEMA = (path: string) => `https://ucp.dev/${UCP_VERSION}/${path}`;

/** The business profile (`/.well-known/ucp`): the shopping service over MCP at the store's endpoint, with catalog search, lookup and cart. */
export function ucpProfile(endpoint: string) {
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": [
          { version: UCP_VERSION, spec: UCP_SPEC, transport: "mcp", endpoint, schema: UCP_SCHEMA("services/shopping/mcp.openrpc.json") },
        ],
      },
      capabilities: {
        "dev.ucp.shopping.catalog.search": [
          { version: UCP_VERSION, spec: "https://ucp.dev/specification/shopping/catalog/", schema: UCP_SCHEMA("schemas/shopping/catalog_search.json") },
        ],
        "dev.ucp.shopping.catalog.lookup": [
          { version: UCP_VERSION, spec: "https://ucp.dev/specification/shopping/catalog/", schema: UCP_SCHEMA("schemas/shopping/catalog_lookup.json") },
        ],
        "dev.ucp.shopping.cart": [{ version: UCP_VERSION, spec: "https://ucp.dev/specification/shopping/cart/", schema: UCP_SCHEMA("schemas/shopping/cart.json") }],
      },
      // No payment is taken through the endpoint: a cart is handed to the store's own checkout.
      payment_handlers: {},
    },
  };
}

/** The `ucp` block every answer carries. */
export const ucpMeta = (capabilities: readonly string[]) => ({
  version: UCP_VERSION,
  capabilities: Object.fromEntries(capabilities.map((name) => [name, [{ version: UCP_VERSION }]])),
});

const GID = "gid://kaizena-flow/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const productGid = (id: string) => `${GID}Product/${id}`;
export const variantGid = (id: string) => `${GID}ProductVariant/${id}`;

/** The uuid an id names, as a product or a variant (a bare uuid is either); null for anything else. */
export function readGid(value: unknown): { kind: "product" | "variant" | "either"; id: string } | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (UUID.test(text)) return { kind: "either", id: text.toLowerCase() };
  const match = /^gid:\/\/kaizena-flow\/(Product|ProductVariant)\/([0-9a-f-]{36})$/i.exec(text);
  if (!match || !UUID.test(match[2])) return null;
  return { kind: match[1] === "Product" ? "product" : "variant", id: match[2].toLowerCase() };
}

/** Most products one search or lookup answers, and most lines in a cart. */
export const SEARCH_MAX = 10;
export const LOOKUP_MAX = 20;
export const CART_LINES_MAX = 20;
export const LINE_QUANTITY_MAX = 99;

type Args = Record<string, unknown>;
const objectOf = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? (value as Args) : {});

/** A tool's arguments: UCP nests them under `catalog` or `cart`; an agent that sends them flat is read too. */
export function toolArgs(args: Args, under: "catalog" | "cart"): Args {
  const nested = objectOf(args[under]);
  return Object.keys(nested).length > 0 ? { ...args, ...nested } : args;
}

/** The country an agent asks about (`context.address_country`), as a market's code, or null for the store's own. */
export function askedCountry(args: Args): string | null {
  const country = objectOf(args.context).address_country;
  return typeof country === "string" && /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : null;
}

/** `search_catalog`'s words (at most 200 characters), and how many it asks for within `SEARCH_MAX`. */
export function searchArgs(args: Args): { query: string; limit: number } {
  const query = typeof args.query === "string" ? args.query.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const asked = Number(objectOf(args.pagination).limit ?? objectOf(args.pagination).first);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, SEARCH_MAX) : SEARCH_MAX;
  return { query, limit };
}

/** `create_cart`'s lines: each variant once (quantities added), at most `CART_LINES_MAX`, a quantity of 1 to `LINE_QUANTITY_MAX`. */
export function cartLines(args: Args): { lines: { variantId: string; quantity: number }[] } | { problem: string } {
  const raw = Array.isArray(args.line_items) ? args.line_items : null;
  if (!raw || raw.length === 0) return { problem: "Give line_items: each { item: { id }, quantity }." };
  if (raw.length > CART_LINES_MAX) return { problem: `At most ${CART_LINES_MAX} lines.` };
  const lines = new Map<string, number>();
  for (const item of raw) {
    const line = objectOf(item);
    const id = readGid(objectOf(line.item).id ?? line.id);
    const quantity = Number(line.quantity ?? 1);
    if (!id || id.kind === "product") return { problem: "Each line names a variant's id, as get_product gives it." };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > LINE_QUANTITY_MAX) return { problem: `A quantity is a whole number from 1 to ${LINE_QUANTITY_MAX}.` };
    lines.set(id.id, Math.min(LINE_QUANTITY_MAX, (lines.get(id.id) ?? 0) + quantity));
  }
  return { lines: [...lines].map(([variantId, quantity]) => ({ variantId, quantity })) };
}

const string = (description: string) => ({ type: "string", description });
const context = {
  type: "object",
  description: "The shopper's context: address_country (ISO 3166-1 alpha-2) picks the country's prices and currency; the store's own country when left out.",
  properties: { address_country: { type: "string" } },
};

/** The MCP tools the endpoint serves, with their input schemas (UCP's argument names, nested under `catalog` or `cart`). */
export const AGENT_TOOLS = [
  {
    name: "search_catalog",
    description: "Searches the store's products for sale in a country by keyword, newest first without words. Prices include VAT, in the country's currency.",
    inputSchema: {
      type: "object",
      properties: {
        catalog: {
          type: "object",
          properties: { query: string("Words to search for."), context, pagination: { type: "object", properties: { limit: { type: "integer", maximum: SEARCH_MAX } } } },
        },
      },
    },
  },
  {
    name: "lookup_catalog",
    description: "Gets products or variants by their ids.",
    inputSchema: {
      type: "object",
      properties: { catalog: { type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string" }, maxItems: LOOKUP_MAX }, context } } },
    },
  },
  {
    name: "get_product",
    description: "Gets one product with every variant: options, price, whether it can be bought now, pictures and its page in the store.",
    inputSchema: { type: "object", properties: { catalog: { type: "object", required: ["id"], properties: { id: string("A product's or a variant's id."), context } } } },
  },
  {
    name: "create_cart",
    description:
      "Puts variants in a cart in the store, checked as adding them in the store is, and answers continue_url, where the shopper opens it (once, within 15 minutes) and pays in the store's own checkout. Nothing is ordered or paid here.",
    inputSchema: {
      type: "object",
      properties: {
        cart: {
          type: "object",
          required: ["line_items"],
          properties: {
            line_items: {
              type: "array",
              maxItems: CART_LINES_MAX,
              items: { type: "object", properties: { item: { type: "object", properties: { id: string("A variant's id.") } }, quantity: { type: "integer", minimum: 1 } } },
            },
            context,
          },
        },
      },
    },
  },
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number]["name"];

/** The capability each tool answers for, in its answer's `ucp` block. */
export const TOOL_CAPABILITY: Record<AgentToolName, string> = {
  search_catalog: "dev.ucp.shopping.catalog.search",
  lookup_catalog: "dev.ucp.shopping.catalog.lookup",
  get_product: "dev.ucp.shopping.catalog.lookup",
  create_cart: "dev.ucp.shopping.cart",
};

/** The store's `agents.md`: what an agent may do here and where, in plain words. */
export function agentsMarkdown(input: { name: string; site: string; endpoint: string | null; profile: string | null; llms: string }): string {
  const lines = [
    `# ${input.name.replace(/\s+/g, " ").trim()}`,
    "",
    `The online store at ${input.site}, on Kaizena Flow.`,
    "",
  ];
  if (input.endpoint && input.profile) {
    lines.push(
      "## For shopping agents",
      "",
      `- UCP profile: ${input.profile}`,
      `- MCP endpoint (UCP ${UCP_VERSION}): ${input.endpoint}`,
      "- Tools: search_catalog, lookup_catalog, get_product and create_cart. Prices include VAT, in the currency of the country asked for.",
      "- create_cart gives a link the shopper opens to pay in the store's own checkout. Nothing is ordered or paid through the endpoint.",
      "- No personal data is asked for or kept. Requests are limited per caller and per store.",
      "",
    );
  } else {
    lines.push("The store does not take requests from shopping agents.", "");
  }
  lines.push("## For assistants", "", `- The store in plain text: ${input.llms}`, "");
  return lines.join("\n");
}
