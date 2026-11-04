import { describe, expect, it } from "vitest";

import { API_POWERS } from "./admin-api";
import { ADMIN_API } from "./admin-api-routes";
import {
  APP_SCOPES,
  APP_TOPICS,
  appMayCall,
  APP_POWERS,
  appPermissions,
  installationTopics,
  missingPermissions,
  normaliseAppScopes,
  POWER_PERMISSION,
  readAppForm,
  topicScope,
} from "./apps";

/** An app's form as `FormData` would give it. */
function formOf(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
}

describe("apps for many stores (D441)", () => {
  it("asks for unit B's scopes and the Admin API's powers but the owner's endpoints, each write with its read, never the owner's own", () => {
    expect(APP_SCOPES).not.toContain("owner");
    expect(APP_SCOPES).not.toContain("webhooks:write");
    for (const power of API_POWERS) if (power !== "webhooks:write") expect(APP_SCOPES).toContain(power);
    expect(normaliseAppScopes(["products:write", "orders:refund", "owner", "webhooks:write", "nonsense"])).toEqual([
      "stores:read",
      "orders:read",
      "orders:write",
      "products:read",
      "products:write",
      "orders:refund",
    ]);
  });

  it("rests each power on the permission its operations need, and asking for the power asks for it too", () => {
    for (const power of APP_POWERS) {
      const permission = POWER_PERMISSION[power];
      const operations = ADMIN_API.filter((o) => o.scope === power);
      if (power === "customers:email") expect(ADMIN_API.find((o) => o.name === "customers.update")?.permission).toBe(permission);
      else expect(operations.some((o) => o.permission === permission), power).toBe(true);
      expect(normaliseAppScopes([power]), power).toContain(permission);
    }
    expect(appPermissions(["products:read", "products:publish"]).sort()).toEqual(["products:read", "products:write"]);
    expect(appPermissions(["content:publish"]).sort()).toEqual(["website:read", "website:write"]);
  });

  it("offers a store only where the person holds every permission asked for (a write holds its read)", () => {
    expect(missingPermissions(["products:read", "orders:read"], ["products:write", "orders:read"])).toEqual([]);
    expect(missingPermissions(["products:write"], ["products:read"])).toEqual(["products:write"]);
    expect(missingPermissions(["orders:refund"], ["orders:read"]).length).toBeGreaterThan(0);
  });

  it("lets an install call an operation only with its permission, and a power only when it holds the power", () => {
    const create = ADMIN_API.find((o) => o.name === "products.create")!;
    const list = ADMIN_API.find((o) => o.name === "products.list")!;
    expect(appMayCall(["stores:read", "products:read"], list)).toBe(true);
    expect(appMayCall(["stores:read", "products:read"], create)).toBe(false);
    expect(appMayCall(["stores:read", "products:write"], create)).toBe(true);
    const publish = ADMIN_API.find((o) => o.scope === "products:publish")!;
    expect(appMayCall(["stores:read", "products:write"], publish)).toBe(false);
    expect(appMayCall(["stores:read", "products:write", "products:publish"], publish)).toBe(true);
  });

  it("sends an install only the topics its scopes read, and customer.erased always", () => {
    expect(topicScope("order.paid")).toBe("orders:read");
    expect(topicScope("product.updated")).toBe("products:read");
    for (const topic of APP_TOPICS) expect(topicScope(topic), topic).not.toBeNull();
    const sent = installationTopics(["order.paid", "product.updated"], ["stores:read", "products:read"]);
    expect([...sent].sort()).toEqual(["customer.erased", "product.updated"]);
    expect(installationTopics([], ["stores:read"])).toEqual(["customer.erased"]);
  });

  it("reads an app's form: a cleaned name, https addresses only, redirect URIs one per line, and at least one scope", () => {
    const read = readAppForm(
      formOf({
        name: "  Stock​ sync ",
        description: "Keeps stock in step.",
        redirect_uris: "https://app.example/cb\nhttps://app.example/cb2",
        scopes: ["products:write", "orders:read"],
        distribution: "unlisted",
        homepage_url: "https://app.example",
        support_email: "help@app.example",
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.app.name).toBe("Stock sync");
    expect(read.app.redirectUris).toEqual(["https://app.example/cb", "https://app.example/cb2"]);
    expect(read.app.scopes).toEqual(["stores:read", "orders:read", "products:read", "products:write"]);
    expect(read.app.distribution).toBe("unlisted");

    const bad = readAppForm(formOf({ name: "Kaizena Flow Official", redirect_uris: "http://app.example/cb", scopes: [], homepage_url: "javascript:alert(1)", support_email: "nope" }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(Object.keys(bad.problems).sort()).toEqual(["homepage_url", "name", "redirect_uris", "scopes", "support_email"]);
  });
});
