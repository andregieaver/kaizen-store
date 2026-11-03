import { describe, expect, it } from "vitest";

import recorded from "@/data/api-contract.json";

import * as admin from "@/app/api/admin/v1/openapi.json/route";
import * as mcp from "@/app/api/mcp/catalogue.json/route";
import * as storefront from "@/app/api/storefront/v1/openapi.json/route";
import * as ucp from "@/app/api/ucp/catalogue.json/route";
import * as topics from "@/app/api/webhooks/v1/topics.json/route";

/** The published contracts (D438) are served public, cached for an hour, any site may read them, and each names the contract's version. */
describe("the contracts' addresses", () => {
  const served = [
    ["/api/admin/v1/openapi.json", admin.GET],
    ["/api/storefront/v1/openapi.json", storefront.GET],
    ["/api/webhooks/v1/topics.json", topics.GET],
    ["/api/mcp/catalogue.json", mcp.GET],
    ["/api/ucp/catalogue.json", ucp.GET],
  ] as const;

  it.each(served)("%s", async (_path, get) => {
    const response = get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await response.json()) as { info?: Record<string, unknown>; contract_version?: string };
    expect(body.info ? body.info["x-contract-version"] : body.contract_version).toBe(recorded.version);
  });

  it("serve the documents as made, on this site's address", async () => {
    const doc = (await admin.GET().json()) as { openapi: string; servers: { url: string }[]; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers[0].url).toMatch(/\/api\/admin\/v1$/);
    expect(Object.keys(doc.paths)).toContain("/products/{id}");
    const catalogue = (await mcp.GET().json()) as { tools: { name: string }[] };
    expect(catalogue.tools.map((t) => t.name)).toContain("list_stores");
  });
});
