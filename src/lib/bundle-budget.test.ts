import { describe, expect, it } from "vitest";

import { fallen, lowered, markerCounts, MARKERS, missingMarkers, parseStats, problems, routeBytes } from "../../scripts/lib/bundle-budget.mjs";

const entry = (route: string, bytes: number, chunks: string[]) => ({ route, firstLoadUncompressedJsBytes: bytes, firstLoadChunkPaths: chunks });

const markers = (over: Record<string, number> = {}) => ({
  supabase: 0,
  zod: 0,
  editor: 0,
  builderEnglish: 0,
  signInEnglish: 0,
  storefrontLanguage: 0,
  cookiePurposes: 0,
  commonEnglishOnStores: 0,
  ...over,
});

describe("bundle budget", () => {
  it("parseStats refuses another shape and returns a good one", () => {
    expect(() => parseStats({})).toThrow(/^route-bundle-stats.json is not what this script reads/);
    expect(() => parseStats([{ route: "/x" }])).toThrow(/is not what this script reads/);
    expect(() => parseStats([])).toThrow(/is not what this script reads/);
    const good = [entry("/a", 10, ["a.js"])];
    expect(parseStats(good)).toBe(good);
  });

  it("routeBytes sorts its keys", () => {
    expect(Object.keys(routeBytes([entry("/b", 2, []), entry("/a", 1, [])]))).toEqual(["/a", "/b"]);
  });

  it("markerCounts counts a route once, and honours only", () => {
    const stats = [entry("/admin/x", 1, ["one.js", "two.js"]), entry("/s/demo", 1, ["one.js", "two.js"]), entry("/other", 1, ["three.js"])];
    const texts: Record<string, string> = {
      "one.js": "a GoTrueClient b is switched off under Settings",
      "two.js": "GoTrueClient again",
      "three.js": "nothing",
    };
    const counts = markerCounts(stats, (p: string) => texts[p]);
    expect(counts.supabase).toBe(2);
    expect(counts.commonEnglishOnStores).toBe(1);
    expect(counts.zod).toBe(0);
  });

  const baseline = { routes: { "/admin/a": 100_000, "/admin/b": 200_000 }, markers: markers({ zod: 3 }) };

  it("problems reports a route 20,000 over, not one 14,000 over", () => {
    expect(problems({ routes: { "/admin/a": 120_000, "/admin/b": 214_000 }, markers: baseline.markers }, baseline)).toHaveLength(1);
    expect(problems({ routes: { "/admin/a": 120_000, "/admin/b": 200_000 }, markers: baseline.markers }, baseline)[0]).toMatch(/^\/admin\/a: 120000 bytes, baseline 100000 \(\+20000\)/);
  });

  it("problems reports a route with no entry and a marker that rose", () => {
    const now = { routes: { ...baseline.routes, "/new": 5 }, markers: markers({ zod: 4 }) };
    const list = problems(now, baseline);
    expect(list).toHaveLength(2);
    expect(list[0]).toContain("/new: new route at 5 bytes");
    expect(list[1]).toContain("zod (ZodError) is in the first scripts of 4 routes, baseline 3");
  });

  it("fallen reports a route far under, a route gone and a marker lower", () => {
    const now = { routes: { "/admin/a": 84_000 }, markers: markers({ zod: 2 }) };
    const list = fallen(now, baseline);
    expect(list).toHaveLength(3);
    for (const line of list) expect(line).toMatch(/run node scripts\/bundle-budget.mjs --write in this change$/);
    expect(fallen({ routes: { "/admin/a": 90_000, "/admin/b": 200_000 }, markers: baseline.markers }, baseline)).toEqual([]);
  });

  it("a marker allowed absent is not missing at 0, and fails the day it comes back", () => {
    const allowed = MARKERS.filter((m: { allowAbsent?: boolean }) => m.allowAbsent).map((m: { key: string }) => m.key);
    expect(allowed).toEqual(["storefrontLanguage", "cookiePurposes"]);
    // Every marker's text but the two in some chunk: only the others are checked.
    const texts = MARKERS.filter((m: { allowAbsent?: boolean }) => !m.allowAbsent).map((m: { text: string }) => m.text);
    expect(missingMarkers(texts)).toEqual([]);
    expect(missingMarkers(texts.slice(1)).map((m: { key: string }) => m.key)).toEqual(["supabase"]);
    const zero = { routes: { "/s/a": 1 }, markers: markers() };
    expect(problems(zero, zero)).toEqual([]);
    expect(problems({ routes: zero.routes, markers: markers({ cookiePurposes: 1 }) }, zero)[0]).toContain("cookiePurposes (Remembers whether you chose)");
  });

  it("lowered never raises, drops gone routes and adds new ones", () => {
    const now = { routes: { "/admin/a": 110_000, "/new": 7 }, markers: markers({ zod: 5, editor: 2 }) };
    const next = lowered(now, baseline);
    expect(next.routes).toEqual({ "/admin/a": 100_000, "/new": 7 });
    expect(next.markers.zod).toBe(3);
    expect(next.markers.editor).toBe(0);
    expect(lowered({ routes: { "/admin/a": 50_000 }, markers: markers() }, baseline).routes["/admin/a"]).toBe(50_000);
  });
});
