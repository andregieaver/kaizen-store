import { describe, expect, it } from "vitest";

import { parseCsv, recordsOf } from "./csv";
import { classifyChannel } from "./analytics-traffic";
import { feedFile, OPENAI_COLUMNS, parseFeedFile, type FeedItem } from "./feeds";
import {
  agentsMarkdown,
  AGENT_TOOLS,
  askedCountry,
  cartLines,
  productGid,
  readGid,
  searchArgs,
  toolArgs,
  ucpProfile,
  UCP_VERSION,
  variantGid,
} from "./shopping-agents";

const ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

describe("the store's UCP profile and tools (D353)", () => {
  it("declares the shopping service over MCP with catalog search, lookup and cart, and no payment handler", () => {
    const profile = ucpProfile("https://kaizenaflow.com/api/ucp/kaffe/mcp");
    expect(profile.ucp.version).toBe(UCP_VERSION);
    expect(profile.ucp.services["dev.ucp.shopping"]).toEqual([expect.objectContaining({ transport: "mcp", endpoint: "https://kaizenaflow.com/api/ucp/kaffe/mcp" })]);
    expect(Object.keys(profile.ucp.capabilities)).toEqual(["dev.ucp.shopping.catalog.search", "dev.ucp.shopping.catalog.lookup", "dev.ucp.shopping.cart"]);
    expect(profile.ucp.payment_handlers).toEqual({});
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(["search_catalog", "lookup_catalog", "get_product", "create_cart"]);
  });

  it("reads Global IDs and bare uuids, and nothing else", () => {
    expect(readGid(productGid(ID))).toEqual({ kind: "product", id: ID });
    expect(readGid(variantGid(ID.toUpperCase()))).toEqual({ kind: "variant", id: ID });
    expect(readGid(ID)).toEqual({ kind: "either", id: ID });
    expect(readGid("gid://shopify/Product/1")).toBeNull();
    expect(readGid(42)).toBeNull();
  });

  it("reads arguments nested as UCP sends them, or flat", () => {
    expect(searchArgs(toolArgs({ catalog: { query: "  wool   socks ", pagination: { limit: 50 } } }, "catalog"))).toEqual({ query: "wool socks", limit: 10 });
    expect(searchArgs(toolArgs({ query: "mug" }, "catalog"))).toEqual({ query: "mug", limit: 10 });
    expect(askedCountry(toolArgs({ catalog: { context: { address_country: "fi" } } }, "catalog"))).toBe("FI");
    expect(askedCountry({ context: { address_country: "Finland" } })).toBeNull();
  });

  it("takes a cart's lines by variant, adding a variant asked twice, and refuses a product id or a quantity out of range", () => {
    expect(cartLines({ line_items: [{ item: { id: variantGid(ID) }, quantity: 2 }, { item: { id: ID }, quantity: 1 }] })).toEqual({ lines: [{ variantId: ID, quantity: 3 }] });
    expect(cartLines({ line_items: [{ item: { id: productGid(ID) }, quantity: 1 }] })).toMatchObject({ problem: expect.any(String) });
    expect(cartLines({ line_items: [{ item: { id: ID }, quantity: 0 }] })).toMatchObject({ problem: expect.any(String) });
    expect(cartLines({ line_items: [] })).toMatchObject({ problem: expect.any(String) });
  });

  it("writes agents.md with the profile and endpoint only while the store serves agents", () => {
    const on = agentsMarkdown({ name: "Kaffe", site: "https://kaffe.example", endpoint: "https://k/api/ucp/kaffe/mcp", profile: "https://kaffe.example/.well-known/ucp", llms: "https://kaffe.example/llms.txt" });
    expect(on).toContain("https://k/api/ucp/kaffe/mcp");
    expect(on).toContain("Nothing is ordered or paid");
    const off = agentsMarkdown({ name: "Kaffe", site: "https://kaffe.example", endpoint: null, profile: null, llms: "https://kaffe.example/llms.txt" });
    expect(off).not.toContain("/api/ucp/");
    expect(off).toContain("does not take requests from shopping agents");
  });
});

const ITEM: FeedItem = {
  id: "MUG-1",
  groupId: "p1",
  title: "Mug",
  description: "A mug.",
  link: "https://shop.example/no/p/mug",
  images: ["https://cdn.example/a.webp", "https://cdn.example/b,c.webp"],
  priceMinor: 19900,
  referenceMinor: 24900,
  currency: "NOK",
  availability: "in_stock",
  gtin: null,
  brand: "Kari Keramikk",
  measure: null,
  shippingMinor: 9900,
  country: "NO",
};

describe("ChatGPT's product feed (D353)", () => {
  it("has every field OpenAI's spec requires, prices as `amount CURRENCY`, variants grouped, search on and checkout off", () => {
    const csv = feedFile("openai", [ITEM, { ...ITEM, id: "MUG-2" }, { ...ITEM, id: "PLATE", groupId: "p2", referenceMinor: null }], { title: "Kari", link: "https://shop.example/no" });
    const rows = recordsOf(parseCsv(csv).rows).records;
    for (const required of ["item_id", "title", "description", "url", "brand", "seller_name", "image_url", "availability", "price"]) {
      expect(OPENAI_COLUMNS).toContain(required);
      for (const row of rows) expect(row[required], required).not.toBe("");
    }
    expect(rows[0]).toMatchObject({ price: "249.00 NOK", sale_price: "199.00 NOK", seller_name: "Kari", group_id: "p1", listing_has_variations: "true", is_eligible_search: "true", is_eligible_checkout: "false" });
    expect(rows[0].additional_image_urls).toBe("https://cdn.example/b%2Cc.webp");
    expect(rows[2]).toMatchObject({ item_id: "PLATE", group_id: "", listing_has_variations: "false", sale_price: "" });
    expect(["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"]).toContain(rows[0].availability);
    expect(parseFeedFile("no-openai.csv")).toEqual({ market: "no", channel: "openai" });
  });
});

describe("a visit from a shopping agent (D353)", () => {
  it("counts in the AI agents' channel from ChatGPT, Perplexity, Copilot or Gemini, by its referrer or a feed link's utm_source", () => {
    for (const host of ["chatgpt.com", "chat.openai.com", "www.perplexity.ai", "copilot.microsoft.com", "gemini.google.com"]) {
      expect(classifyChannel({ referrerHost: host, ownHosts: [] }).channel, host).toBe("ai_agent");
    }
    expect(classifyChannel({ utmSource: "chatgpt.com", ownHosts: [] }).channel).toBe("ai_agent");
    expect(classifyChannel({ referrerHost: "www.google.com", ownHosts: [] }).channel).toBe("organic_search");
  });
});
