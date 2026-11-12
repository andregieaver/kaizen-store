import { describe, expect, it } from "vitest";

import { IDEMPOTENT_NAMES, isReadOnly, mcpTools, mcpCatalogue, OPEN_WORLD, OWNER_KEY_READS, toolAnnotations, toolPermission, toolTitle } from "./mcp-catalogue";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, toolDefinition } from "./owner-tools";
import { TOOL_FEATURES } from "./owner-tool-features";
import { AGENT_TOOLS } from "./shopping-agents";
import { ucpCatalogue, UCP_TOOLS } from "./ucp-catalogue";

/**
 * The MCP catalogues (D438): every owner tool and every shopping agents' tool with a title and MCP annotations, worked out beside the tools
 * so their own words and inputs (and the eval's tools version) stay as they are.
 */
describe("the owner MCP's annotations", () => {
  it("gives every tool a title and every hint", () => {
    expect(mcpTools()).toHaveLength(OWNER_TOOLS.length + 3);
    for (const tool of mcpTools()) {
      expect(tool.title, tool.name).toMatch(/^[A-Z][A-Za-z' ]+[A-Za-z]$/);
      expect(tool.title, tool.name).not.toContain("_");
      expect(Object.keys(tool.annotations).sort(), tool.name).toEqual(["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"]);
      expect(Object.values(tool.annotations).every((v) => typeof v === "boolean"), tool.name).toBe(true);
    }
    expect(toolTitle("list_products")).toBe("List products");
    expect(toolTitle("oss_return_data")).toBe("OSS return data");
    expect(toolTitle("list_dns_records")).toBe("List DNS records");
  });

  it("never calls a gated tool or a write read-only, and never a read destructive", () => {
    for (const tool of OWNER_TOOLS) {
      const hints = toolAnnotations(tool);
      const permission = toolPermission(tool.name) ?? "";
      if (tool.gate || permission.endsWith(":write")) expect(hints.readOnlyHint, tool.name).toBe(false);
      if (hints.readOnlyHint) expect([hints.destructiveHint, hints.idempotentHint], tool.name).toEqual([false, true]);
      if (tool.gate === "spend" || tool.gate === "domain" || tool.gate === "access") expect(hints.destructiveHint, tool.name).toBe(true);
      if (tool.gate === "send" || tool.gate === "domain") expect(hints.openWorldHint, tool.name).toBe(true);
    }
    expect(toolAnnotations(OWNER_TOOLS_BY_NAME.list_orders)).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(toolAnnotations(OWNER_TOOLS_BY_NAME.refund_order)).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(toolAnnotations(OWNER_TOOLS_BY_NAME.archive_orders)).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(toolAnnotations(OWNER_TOOLS_BY_NAME.search_web)).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(toolAnnotations(OWNER_TOOLS_BY_NAME.create_draft_order)).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });

  it("decides each tool whose permission is neither a read nor a write", () => {
    const undecided = OWNER_TOOLS.filter((t) => !t.gate && !/:(read|write)$/.test(toolPermission(t.name) ?? "") && !OWNER_KEY_READS.has(t.name));
    expect(undecided.map((t) => t.name), "Add a tool that only reads to OWNER_KEY_READS; one that changes anything needs a :write permission or a gate").toEqual([]);
    for (const name of [...OWNER_KEY_READS, ...OPEN_WORLD, ...IDEMPOTENT_NAMES]) expect(OWNER_TOOLS_BY_NAME[name], name).toBeDefined();
    expect(isReadOnly({ name: "store_overview" })).toBe(true);
  });
});

describe("the owner MCP's catalogue", () => {
  const catalogue = mcpCatalogue();

  it("publishes every tool as tools/list does, with its gate, permission and feature", () => {
    expect(catalogue.tools.map((t) => t.name)).toEqual(mcpTools().map((t) => t.name));
    for (const own of OWNER_TOOLS) {
      const listed = catalogue.tools.find((t) => t.name === own.name)!;
      const { parameters } = toolDefinition(own);
      // The tool's own words and inputs, with the store it is for: nothing of the tool itself is changed for the catalogue.
      expect(listed.description.startsWith(own.description), own.name).toBe(true);
      expect(listed.inputSchema).toEqual({ ...parameters, properties: { store: expect.any(Object), ...(parameters.properties as object) }, required: ["store", ...((parameters.required as string[]) ?? [])] });
      expect(listed.gate).toBe(own.gate ?? null);
      expect(listed.permission).toBe(toolPermission(own.name));
      const feature = TOOL_FEATURES[own.name as keyof typeof TOOL_FEATURES];
      expect(listed.feature).toEqual(feature === undefined ? null : [feature].flat());
    }
    expect(catalogue.tools.find((t) => t.name === "list_stores")).toMatchObject({ gate: null, permission: null, annotations: { readOnlyHint: true } });
  });

  it("holds no store's data", () => {
    const text = JSON.stringify(catalogue);
    expect(text).not.toMatch(/kf_[A-Za-z0-9_-]{20}|whsec_|@example\.com/);
    expect(Object.keys(catalogue)).toEqual(["server", "description", "tools"]);
  });
});

describe("the shopping agents' catalogue", () => {
  it("is AGENT_TOOLS with titles and annotations: reading, and a cart that orders nothing", () => {
    expect(UCP_TOOLS.map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name));
    for (const tool of UCP_TOOLS) {
      const own = AGENT_TOOLS.find((t) => t.name === tool.name)!;
      expect(tool.inputSchema).toBe(own.inputSchema);
      expect(tool.title.length).toBeGreaterThan(3);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.annotations.readOnlyHint).toBe(tool.name !== "create_cart");
    }
    expect(ucpCatalogue().server.endpoint).toBe("/api/ucp/{store}/mcp");
  });
});
