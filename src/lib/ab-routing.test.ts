import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pageSlugOf, parseStoreRequest, storeOfHost, variantPath } from "./ab-routing";
import { dataCookieName, encodeAssignments, MARKER_COOKIE } from "./experiments";

const V = "11111111-1111-4111-8111-111111111111";
const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cookie = (version: string) => encodeAssignments({ visitor: V, versions: { [E]: version } });

describe("which requests are a store's pages", () => {
  it("reads the platform's addresses and a store's own hosts, whatever follows the market", () => {
    expect(parseStoreRequest("/s/demo/no/om-oss", null)).toEqual({ store: "demo", market: "no", rest: ["om-oss"], hostBased: false });
    expect(parseStoreRequest("/s/demo/no", null)).toEqual({ store: "demo", market: "no", rest: [], hostBased: false });
    expect(parseStoreRequest("/s/demo/no/p/lampe", null)?.rest).toEqual(["p", "lampe"]);
    expect(parseStoreRequest("/no/om-oss", "demo")).toEqual({ store: "demo", market: "no", rest: ["om-oss"], hostBased: true });
    expect(parseStoreRequest("/no-en-eur/om-oss", "demo")?.market).toBe("no-en-eur");
    expect(parseStoreRequest("/no", "demo")?.rest).toEqual([]);
  });

  it("leaves everything else alone: the store's own front door, the admin, the API, odd addresses", () => {
    expect(parseStoreRequest("/s/demo", null)).toBeNull();
    expect(parseStoreRequest("/s/demo/Not_a_market/x", null)).toBeNull();
    expect(parseStoreRequest("/s/demo/no/om oss", null)).toBeNull();
    expect(parseStoreRequest("/no/om-oss", null)).toBeNull();
    expect(parseStoreRequest("/api/ab", "demo")).toBeNull();
    expect(parseStoreRequest("/admin/demo", "demo")).toBeNull();
    expect(parseStoreRequest("/", "demo")).toBeNull();
    expect(parseStoreRequest("/cart", "demo")).toBeNull();
  });

  it("knows a page's address from deeper routes", () => {
    expect(pageSlugOf({ rest: ["om-oss"] })).toBe("om-oss");
    expect(pageSlugOf({ rest: [] })).toBeNull();
    expect(pageSlugOf({ rest: ["p", "lampe"] })).toBeNull();
    expect(pageSlugOf({ rest: ["Om%20Oss"] })).toBeNull();
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
  const request = { store: "demo", market: "no", rest: ["om-oss"], hostBased: false };
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
    expect(variantPath({ ...request, rest: ["frakt"] }, tests, cookie("b"))).toBeNull();
    expect(variantPath({ ...request, rest: [] }, tests, cookie("b"))).toBeNull();
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

describe("where a visitor's request goes under a test of the header, the footer or the product layout", () => {
  const header = { id: E, kind: "header" as const, slug: null };
  const layout = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "layout" as const, slug: null };
  const at = (rest: string[], hostBased = false) => ({ store: "demo", market: "no", rest, hostBased });

  it("changes the market part of every page's address for a header or footer test, the original's left alone", () => {
    expect(variantPath(at([]), [header], cookie("b"))).toBe("/s/demo/no~aaaaaaaab");
    expect(variantPath(at(["cart"]), [header], cookie("b"))).toBe("/s/demo/no~aaaaaaaab/cart");
    expect(variantPath(at(["p", "lampe"]), [header], cookie("c"))).toBe("/s/demo/no~aaaaaaaac/p/lampe");
    expect(variantPath(at(["om-oss"], true), [{ ...header, kind: "footer" }], cookie("b"))).toBe("/no~aaaaaaaab/om-oss");
    expect(variantPath(at(["cart"]), [header], cookie("a"))).toBeNull();
    expect(variantPath(at(["cart"]), [header], cookie("0"))).toBeNull();
  });

  it("changes only product pages' for a layout test", () => {
    const both = encodeAssignments({ visitor: V, versions: { [layout.id]: "b" } });
    expect(variantPath(at(["p", "lampe"]), [layout], both)).toBe("/s/demo/no~bbbbbbbbb/p/lampe");
    expect(variantPath(at(["om-oss"]), [layout], both)).toBeNull();
    expect(variantPath(at([]), [layout], both)).toBeNull();
    expect(variantPath(at(["p"]), [layout], both)).toBeNull();
  });

  it("puts several tests together: the site's in the market, a page's in its own route", () => {
    const mixed = encodeAssignments({ visitor: V, versions: { [E]: "b", [layout.id]: "c", "cccccccc-cccc-4ccc-8ccc-cccccccccccc": "d" } });
    const page = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", kind: "page" as const, slug: "om-oss" };
    expect(variantPath(at(["om-oss"]), [header, layout, page], mixed)).toBe("/s/demo/no~aaaaaaaab/om-oss/ab/d");
    expect(variantPath(at(["p", "lampe"]), [header, layout, page], mixed)).toBe("/s/demo/no~aaaaaaaab_bbbbbbbbc/p/lampe");
  });
});

describe("the proxy's matcher", () => {
  it("is written with the marker cookie's name, which the build needs as a literal", () => {
    const source = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(source).toContain(`key: "${MARKER_COOKIE}"`);
  });
});
