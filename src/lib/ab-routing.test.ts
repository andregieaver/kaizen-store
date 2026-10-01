import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseStoreRequest, storeOfHost, variantPath } from "./ab-routing";
import { dataCookieName, encodeAssignments, MARKER_COOKIE } from "./experiments";

const V = "11111111-1111-4111-8111-111111111111";
const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cookie = (version: string) => encodeAssignments({ visitor: V, versions: { [E]: version } });

describe("which requests are a store's pages", () => {
  it("reads the platform's addresses and a store's own hosts", () => {
    expect(parseStoreRequest("/s/demo/no/om-oss", null)).toEqual({ store: "demo", market: "no", slug: "om-oss", hostBased: false });
    expect(parseStoreRequest("/no/om-oss", "demo")).toEqual({ store: "demo", market: "no", slug: "om-oss", hostBased: true });
    expect(parseStoreRequest("/no-en-eur/om-oss", "demo")?.market).toBe("no-en-eur");
  });

  it("leaves everything else alone: the store's other routes, the admin, the API, other depths", () => {
    expect(parseStoreRequest("/s/demo/no", null)).toBeNull();
    expect(parseStoreRequest("/s/demo/no/om-oss/ab/b", null)).toBeNull();
    expect(parseStoreRequest("/s/demo/no/Om%20Oss", null)).toBeNull();
    expect(parseStoreRequest("/no/om-oss", null)).toBeNull();
    expect(parseStoreRequest("/api/ab", "demo")).toBeNull();
    expect(parseStoreRequest("/admin/demo", "demo")).toBeNull();
    expect(parseStoreRequest("/", "demo")).toBeNull();
  });

  it("finds the store of a host", () => {
    const custom = { shop: { primary: "www.butikk.no", hosts: ["butikk.no"] } };
    expect(storeOfHost("demo.kaizen.store", "kaizen.store", custom)).toBe("demo");
    expect(storeOfHost("demo.kaizen.store:3000", "kaizen.store", custom)).toBe("demo");
    expect(storeOfHost("www.butikk.no", "kaizen.store", custom)).toBe("shop");
    expect(storeOfHost("butikk.no", null, custom)).toBe("shop");
    expect(storeOfHost("www.kaizen.store", "kaizen.store", custom)).toBeNull();
    expect(storeOfHost("kaizen.store", "kaizen.store", custom)).toBeNull();
    expect(storeOfHost("evil.com", "kaizen.store", custom)).toBeNull();
    expect(storeOfHost("demo.kaizen.store.evil.com", "kaizen.store", custom)).toBeNull();
  });
});

describe("where a visitor's request goes", () => {
  const request = { store: "demo", market: "no", slug: "om-oss", hostBased: false };
  const tests = [{ id: E, slug: "om-oss" }];

  it("sends a visitor in another version to its page, and nobody else", () => {
    expect(variantPath(request, tests, cookie("b"))).toBe("/s/demo/no/om-oss/ab/b");
    expect(variantPath(request, tests, cookie("c"))).toBe("/s/demo/no/om-oss/ab/c");
    expect(variantPath(request, tests, cookie("a"))).toBeNull();
    expect(variantPath(request, tests, cookie("0"))).toBeNull();
    expect(variantPath(request, tests, undefined)).toBeNull();
    expect(variantPath(request, tests, "garbage")).toBeNull();
  });

  it("only for pages under test, and only for the test's own answer", () => {
    expect(variantPath({ ...request, slug: "frakt" }, tests, cookie("b"))).toBeNull();
    expect(variantPath(request, [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", slug: "om-oss" }], cookie("b"))).toBeNull();
    expect(variantPath(request, [], cookie("b"))).toBeNull();
  });

  it("keeps a store host's address without the platform prefix", () => {
    expect(variantPath({ ...request, hostBased: true }, tests, cookie("b"))).toBe("/no/om-oss/ab/b");
  });

  it("names a store's cookie by its id", () => {
    expect(dataCookieName("abc")).toBe("kaizen_ab_abc");
  });
});

describe("the proxy's matcher", () => {
  it("is written with the marker cookie's name, which the build needs as a literal", () => {
    const source = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(source).toContain(`key: "${MARKER_COOKIE}"`);
  });
});
