import { describe, expect, it } from "vitest";

import { isPlatformApiScope, listQuery, platformBearer, platformRouteOf } from "./platform-api";

describe("Kaizena Flow's own API (D517)", () => {
  it("takes only a platform token, never a store's or an app's", () => {
    const token = `kfp_${"a".repeat(43)}`;
    expect(platformBearer(`Bearer ${token}`)).toBe(token);
    expect(platformBearer(`bearer ${token} `)).toBe(token);
    expect(platformBearer(`Bearer kf_${"a".repeat(43)}`)).toBeNull();
    expect(platformBearer(`Bearer kfa_${"a".repeat(43)}`)).toBeNull();
    expect(platformBearer(`Bearer kfp_short`)).toBeNull();
    expect(platformBearer(null)).toBeNull();
  });

  it("knows its routes and their scopes, and nothing else", () => {
    expect(platformRouteOf(["stores"])).toEqual({ name: "stores", scope: "stores:read" });
    expect(platformRouteOf(["stores", "kroken"])).toEqual({ name: "store", scope: "stores:read", id: "kroken" });
    expect(platformRouteOf(["stores", "a/b"])).toBeNull();
    expect(platformRouteOf(["stores", "x", "orders"])).toBeNull();
    expect(platformRouteOf(["plans"])).toEqual({ name: "plans", scope: "plans:read" });
    expect(platformRouteOf(["plans", "x"])).toBeNull();
    expect(platformRouteOf(["requests"])).toEqual({ name: "requests", scope: "requests:read" });
    expect(platformRouteOf(["figures"])).toEqual({ name: "figures", scope: "figures:read" });
    expect(platformRouteOf(["orders"])).toBeNull();
    expect(isPlatformApiScope("stores:read")).toBe(true);
    expect(isPlatformApiScope("orders:read")).toBe(false);
  });

  it("reads a list's page", () => {
    expect(listQuery(new URLSearchParams())).toEqual({ ok: true, limit: 50, before: null });
    expect(listQuery(new URLSearchParams("limit=10&before=2026-11-09T10:00:00Z"))).toEqual({ ok: true, limit: 10, before: "2026-11-09T10:00:00.000Z" });
    expect(listQuery(new URLSearchParams("limit=0")).ok).toBe(false);
    expect(listQuery(new URLSearchParams("limit=101")).ok).toBe(false);
    expect(listQuery(new URLSearchParams("before=soon")).ok).toBe(false);
  });
});
