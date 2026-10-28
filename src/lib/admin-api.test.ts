import { describe, expect, it } from "vitest";

import { API_ROUTES, API_SCOPES, bearerToken, grants, pageSize, PAGE_MAX, routeOf } from "./admin-api";

const ID = "5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d";
const TOKEN = `kf_${"A".repeat(43)}`;

/** The Admin API's routes, scopes and tokens (D355). */
describe("routeOf", () => {
  it("names every route on the page, with the scope it lists", () => {
    for (const route of API_ROUTES) {
      const path = route.path.replace("{id}", ID).replace("{tag}", "vip").split("/").filter(Boolean);
      expect(routeOf(route.method, path)?.scope, `${route.method} ${route.path}`).toBe(route.scope);
    }
  });

  it("refuses an unknown path, a bad id and the wrong method", () => {
    expect(routeOf("GET", ["webhooks"])).toBeNull();
    expect(routeOf("GET", ["products", "not-an-id"])).toBeNull();
    expect(routeOf("DELETE", ["products", ID])).toBeNull();
    expect(routeOf("POST", ["orders"])).toBeNull();
    expect(routeOf("GET", ["orders", ID, "refunds"])).toBeNull();
    expect(routeOf("GET", ["products", ID, "a", "b", "c"])).toBeNull();
  });
});

describe("scopes and tokens", () => {
  it("lets a write scope read too, never the other way", () => {
    expect(grants(["products:write"], "products:read")).toBe(true);
    expect(grants(["products:read"], "products:write")).toBe(false);
    expect(grants(["orders:read"], "customers:read")).toBe(false);
    expect(new Set(API_SCOPES).size).toBe(API_SCOPES.length);
  });

  it("reads only a Bearer token of the shape made", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`bearer   ${TOKEN} `)).toBe(TOKEN);
    expect(bearerToken(`Basic ${TOKEN}`)).toBeNull();
    expect(bearerToken("Bearer kf_short")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("keeps a page within its limit", () => {
    expect(pageSize("500")).toBe(PAGE_MAX);
    expect(pageSize("10")).toBe(10);
    expect(pageSize("-1")).toBe(50);
    expect(pageSize(null)).toBe(50);
  });
});
