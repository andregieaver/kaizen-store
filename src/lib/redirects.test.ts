import { describe, expect, it } from "vitest";

import { KNOWN_COOKIES } from "./cookie-consent";
import { FINDING_CODES } from "./data-job";
import type { AddressContext } from "./redirect-path";
import {
  AUTOMATIC_KINDS,
  REDIRECT_KINDS,
  closesLoop,
  emptyIndex,
  findingField,
  followChain,
  isAutomatic,
  liveAddresses,
  redirectSentences,
  redirectsTag,
  redirectStatus,
  redirectStatusWords,
  targetExists,
  validateRedirect,
  type RedirectEnv,
  type RedirectIndex,
} from "./redirects";

const ctx: AddressContext = { store: "demo", countries: ["no", "se"], ownHosts: ["shop.demo.no"] };
const live = liveAddresses({
  products: ["new-cup", "lamp"],
  categories: ["shoes", "lamps"],
  tags: ["sale"],
  pages: ["om-oss", "frakt"],
  articles: ["first-post"],
});
const index = (manual: Record<string, string> = {}, automatic: Record<string, string | null> = {}): RedirectIndex => ({
  manual: new Map(Object.entries(manual)),
  automatic: new Map(Object.entries(automatic)),
});
const env = (over: Partial<RedirectEnv> = {}): RedirectEnv => ({ ctx, live, index: emptyIndex(), manualCount: 0, ...over });
const codes = (check: { findings: { code: string }[] }) => check.findings.map((f) => f.code);

describe("the live addresses", () => {
  it("are active products, categories, tags, published pages and articles, /blog when there are articles, and /products", () => {
    expect([...live].sort()).toEqual(
      ["/blog", "/blog/first-post", "/category/lamps", "/category/shoes", "/frakt", "/om-oss", "/p/lamp", "/p/new-cup", "/products", "/tag/sale"].sort(),
    );
    expect(liveAddresses({ products: [], categories: [], tags: [], pages: [], articles: [] })).toEqual(new Set(["/products"]));
  });

  it("count a working page, the front page and a live address as somewhere a shopper can go", () => {
    expect(targetExists("/", live)).toBe(true);
    expect(targetExists("/cart", live)).toBe(true);
    expect(targetExists("/search", live)).toBe(true);
    expect(targetExists("/p/lamp", live)).toBe(true);
    expect(targetExists("/p/gone", live)).toBe(false);
    expect(targetExists("/collections/x", live)).toBe(false);
  });
});

describe("the kinds", () => {
  it("are manual and the three automatic ones", () => {
    expect(REDIRECT_KINDS).toEqual(["manual", "product", "category", "tag"]);
    expect(AUTOMATIC_KINDS).toEqual(["product", "category", "tag"]);
    expect(isAutomatic("manual")).toBe(false);
    expect(isAutomatic("tag")).toBe(true);
  });
});

describe("following a chain", () => {
  it("has no chain for a path with no redirect", () => {
    expect(followChain("/x", index())).toEqual({ status: "none", final: null, hops: [] });
  });

  it("follows a manual redirect to its target as stored, and on while the target is itself redirected", () => {
    const i = index({ "/a": "/b?x=1", "/b": "/c#top", "/c": "/p/lamp" });
    expect(followChain("/a", i)).toEqual({ status: "ok", final: "/p/lamp", hops: ["/a", "/b", "/c"] });
    expect(followChain("/b", i)).toEqual({ status: "ok", final: "/p/lamp", hops: ["/b", "/c"] });
    expect(followChain("/c", i)).toEqual({ status: "ok", final: "/p/lamp", hops: ["/c"] });
  });

  it("ends at an automatic redirect's current address: it points at the thing, so it never goes on", () => {
    const i = index({ "/old": "/p/old-cup" }, { "/p/old-cup": "/p/new-cup", "/p/very-old": "/p/new-cup" });
    expect(followChain("/old", i)).toEqual({ status: "ok", final: "/p/new-cup", hops: ["/old", "/p/old-cup"] });
    expect(followChain("/p/very-old", i)).toEqual({ status: "ok", final: "/p/new-cup", hops: ["/p/very-old"] });
  });

  it("is dead at an automatic redirect whose thing is not live", () => {
    expect(followChain("/p/old-cup", index({}, { "/p/old-cup": null }))).toEqual({ status: "dead", final: null, hops: ["/p/old-cup"] });
    expect(followChain("/x", index({ "/x": "/p/old-cup" }, { "/p/old-cup": null }))).toEqual({ status: "dead", final: null, hops: ["/x", "/p/old-cup"] });
  });

  it("stops at a live address, which is served and never looked up", () => {
    const i = index({ "/a": "/p/lamp", "/p/lamp": "/elsewhere" });
    expect(followChain("/a", i, { isLive: (p) => live.has(p) })).toEqual({ status: "ok", final: "/p/lamp", hops: ["/a"] });
    expect(followChain("/a", i)).toEqual({ status: "ok", final: "/elsewhere", hops: ["/a", "/p/lamp"] });
  });

  it("gives up on a loop, and on the eleventh hop (Google follows at most ten)", () => {
    expect(followChain("/a", index({ "/a": "/b", "/b": "/a" }))).toEqual({ status: "loop", final: null, hops: ["/a", "/b"] });
    expect(followChain("/a", index({ "/a": "/a" }))).toEqual({ status: "loop", final: null, hops: ["/a"] });
    const chain = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`/h${i}`, i === n - 1 ? "/p/lamp" : `/h${i + 1}`]));
    expect(followChain("/h0", index(chain(10))).status).toBe("ok");
    expect(followChain("/h0", index(chain(10))).hops).toHaveLength(10);
    expect(followChain("/h0", index(chain(11)))).toMatchObject({ status: "too_long", final: null });
    expect(followChain("/h0", index(chain(11)), { max: 11 }).status).toBe("ok");
  });

  it("closes a loop only when the new redirect leads back to its own address", () => {
    const i = index({ "/b": "/c", "/c": "/a" });
    expect(closesLoop("/a", "/b", i)).toEqual(["/a", "/b", "/c"]);
    expect(closesLoop("/a", "/a", i)).toEqual(["/a"]);
    expect(closesLoop("/a", "/p/lamp", i)).toBeNull();
    expect(closesLoop("/z", "/b", i)).toBeNull();
    // Replacing a redirect: its old target no longer counts.
    expect(closesLoop("/b", "/p/lamp", index({ "/b": "/c", "/c": "/b" }))).toBeNull();
  });
});

describe("the check of a redirect", () => {
  it("passes a plain one and returns the normal forms", () => {
    const check = validateRedirect({ from: "/Collections/Old-Shoes", to: "/category/shoes" }, env());
    expect(check).toMatchObject({ ok: true, source: "/collections/old-shoes", target: "/category/shoes", existing: null, hops: [] });
    expect(check.findings).toEqual([]);
  });

  it("refuses an unreadable source and target, naming both when both are wrong", () => {
    const check = validateRedirect({ from: "", to: "https://evil.example/x" }, env());
    expect(check.ok).toBe(false);
    expect(codes(check)).toEqual(["source.missing", "target.external"]);
    expect(check.source).toBeNull();
    expect(check.target).toBeNull();
  });

  it("refuses a source that is a live address, but not a draft's or archived product's (they are not in the set)", () => {
    expect(codes(validateRedirect({ from: "/p/lamp", to: "/category/lamps" }, env()))).toEqual(["source.live"]);
    expect(codes(validateRedirect({ from: "/category/shoes", to: "/p/lamp" }, env()))).toEqual(["source.live"]);
    expect(codes(validateRedirect({ from: "/om-oss", to: "/p/lamp" }, env()))).toEqual(["source.live"]);
    expect(codes(validateRedirect({ from: "/blog/first-post", to: "/p/lamp" }, env()))).toEqual(["source.live"]);
    expect(codes(validateRedirect({ from: "/products", to: "/p/lamp" }, env()))).toEqual(["source.live"]);
    expect(validateRedirect({ from: "/p/retired", to: "/category/lamps" }, env())).toMatchObject({ ok: true, findings: [] });
  });

  it("refuses a target equal to the source (with a query too), and a loop through other redirects", () => {
    expect(codes(validateRedirect({ from: "/a", to: "/a" }, env()))).toEqual(["target.self"]);
    expect(codes(validateRedirect({ from: "/a", to: "/A?x=1" }, env()))).toEqual(["target.self"]);
    const loop = validateRedirect({ from: "/a", to: "/b" }, env({ index: index({ "/b": "/c", "/c": "/a" }) }));
    expect(loop.ok).toBe(false);
    expect(codes(loop)).toEqual(["target.loop"]);
    expect(loop.findings[0].text).toContain('"/b"');
  });

  it("stores the final destination when the target is itself redirected, and says through what", () => {
    const check = validateRedirect({ from: "/a", to: "/b" }, env({ index: index({ "/b": "/c", "/c": "/p/lamp" }) }));
    expect(check).toMatchObject({ ok: true, source: "/a", target: "/p/lamp", hops: ["/b", "/c"] });
    expect(codes(check)).toEqual(["target.chain"]);
    // An automatic redirect as the target: the thing's current address.
    const auto = validateRedirect({ from: "/a", to: "/p/old-cup" }, env({ index: index({}, { "/p/old-cup": "/p/new-cup" }) }));
    expect(auto).toMatchObject({ ok: true, target: "/p/new-cup", hops: ["/p/old-cup"] });
  });

  it("warns, and still passes, for a target that is not there now", () => {
    const check = validateRedirect({ from: "/a", to: "/category/none-yet" }, env());
    expect(check.ok).toBe(true);
    expect(codes(check)).toEqual(["target.not_found"]);
    for (const to of ["/", "/cart", "/search?q=x", "/p/lamp", "/om-oss"]) expect(codes(validateRedirect({ from: "/a", to }, env())), to).toEqual([]);
  });

  it("notes a query string cut from the source and a country removed from the target (information only)", () => {
    const check = validateRedirect({ from: "/a?x=1", to: "/no/p/lamp" }, env());
    expect(check.ok).toBe(true);
    expect(codes(check)).toEqual(["source.query_dropped", "target.market_removed"]);
    expect(check.findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("says what already exists for the source: replaced, the same, or an automatic redirect that is replaced", () => {
    const manual = index({ "/a": "/category/shoes" });
    expect(validateRedirect({ from: "/a", to: "/category/lamps" }, env({ index: manual }))).toMatchObject({ ok: true, existing: { kind: "manual", target: "/category/shoes" } });
    expect(codes(validateRedirect({ from: "/a", to: "/category/lamps" }, env({ index: manual })))).toEqual(["exists.update"]);
    expect(codes(validateRedirect({ from: "/a", to: "/category/shoes" }, env({ index: manual })))).toEqual(["exists.same"]);
    const auto = index({}, { "/p/old-cup": "/p/new-cup" });
    const check = validateRedirect({ from: "/p/old-cup", to: "/category/lamps" }, env({ index: auto }));
    expect(check.existing).toEqual({ kind: "automatic" });
    expect(codes(check)).toEqual(["exists.replaced_automatic"]);
  });

  it("refuses the 100,001st manual redirect, but not a replacement of one", () => {
    expect(codes(validateRedirect({ from: "/a", to: "/p/lamp" }, env({ manualCount: 100_000 })))).toEqual(["limit.reached"]);
    expect(codes(validateRedirect({ from: "/a", to: "/p/lamp" }, env({ manualCount: 99_999 })))).toEqual([]);
    expect(codes(validateRedirect({ from: "/a", to: "/p/lamp" }, env({ manualCount: 5, limit: 5 })))).toEqual(["limit.reached"]);
    const replace = validateRedirect({ from: "/a", to: "/category/lamps" }, env({ manualCount: 5, limit: 5, index: index({ "/a": "/category/shoes" }) }));
    expect(replace.ok).toBe(true);
    expect(codes(replace)).toEqual(["exists.update"]);
  });

  it("only ever writes a sentence that names normalised addresses, never a cell as typed", () => {
    const check = validateRedirect({ from: "/Hello%20World?x=1", to: "/a" }, env());
    expect(check.findings[0].text).not.toContain("Hello");
    const loop = validateRedirect({ from: "/A", to: "/B" }, env({ index: index({ "/b": "/a" }) }));
    expect(loop.findings[0].text).toContain('"/a"');
    expect(loop.findings[0].text).not.toContain('"/A"');
  });

  it("is about the field the finding names", () => {
    expect(findingField("source.live")).toBe("from");
    expect(findingField("target.loop")).toBe("to");
    expect(findingField("limit.reached")).toBe("line");
    expect(findingField("exists.update")).toBe("line");
    expect(findingField("duplicate.in_file")).toBe("line");
    expect(FINDING_CODES.filter((c) => findingField(c) !== "line").every((c) => c.startsWith("source.") || c.startsWith("target."))).toBe(true);
  });
});

describe("the status of a row in the list", () => {
  const e = (i: RedirectIndex) => ({ live, index: i });
  it("is not used when the source is a live address now", () => {
    expect(redirectStatus({ kind: "manual", source: "/p/lamp", target: "/x" }, e(index({ "/p/lamp": "/x" })))).toEqual({ status: "not_used", more: 0 });
  });
  it("warns about a target that is not a live address, and says how many redirects a chain goes through", () => {
    expect(redirectStatus({ kind: "manual", source: "/a", target: "/gone" }, e(index({ "/a": "/gone" })))).toEqual({ status: "target_missing", more: 0 });
    expect(redirectStatus({ kind: "manual", source: "/a", target: "/b" }, e(index({ "/a": "/b", "/b": "/c", "/c": "/p/lamp" })))).toEqual({ status: "chain", more: 2 });
    expect(redirectStatus({ kind: "manual", source: "/a", target: "/p/lamp" }, e(index({ "/a": "/p/lamp" })))).toEqual({ status: "active", more: 0 });
    expect(redirectStatus({ kind: "product", source: "/p/old", target: null }, e(index({}, { "/p/old": "/p/lamp" })))).toEqual({ status: "active", more: 0 });
  });
  it("has words", () => {
    expect(redirectStatusWords("active")).toBe("Active");
    expect(redirectStatusWords("chain", 1)).toBe("Goes through 1 more redirect");
    expect(redirectStatusWords("chain", 3)).toBe("Goes through 3 more redirects");
    expect(redirectStatusWords("not_used")).toMatch(/live/);
    expect(redirectSentences.count(12, 100_000)).toBe("12 of 100,000 manual redirects");
    expect(redirectSentences.permanent).toMatch(/permanent/);
  });
});

describe("what a redirect never does", () => {
  it("sets no cookie or storage item: nothing of redirects is among the known cookies", () => {
    expect(KNOWN_COOKIES.filter((c) => /redirect|not_found|404/i.test(`${c.name} ${c.purpose ?? ""}`))).toEqual([]);
  });
  it("has a cache tag for each store, apart from every other store's", () => {
    expect(redirectsTag("a")).toBe("redirects:a");
    expect(redirectsTag("a")).not.toBe(redirectsTag("b"));
  });
});
