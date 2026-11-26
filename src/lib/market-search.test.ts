import { describe, expect, it } from "vitest";

import { normaliseTerm, placesIn, SEARCH_FRESH_DAYS, searchStanding, urlOnHost, urlOnSite, type OwnSite, type SearchTermFacts } from "./market-search";

/** Where a store and its rivals come up in search (D905 M5b): the word as kept, a site in one page of results, and what a check means. */

describe("a word the store follows (D905 M5b)", () => {
  it("is kept trimmed, its spaces one, in lower case, 2 to 80 characters", () => {
    expect(normaliseTerm("  Forkle   i LIN ")).toBe("forkle i lin");
    expect(normaliseTerm("a")).toBeNull();
    expect(normaliseTerm("x".repeat(81))).toBeNull();
  });
});

describe("a site in one page of results (D905 M5b)", () => {
  const own: OwnSite = { hosts: ["linen.no"], prefix: null };
  const onPlatform: OwnSite = { hosts: [], prefix: { host: "kaizenaflow.com", path: "/s/linen" } };

  it("knows the store's own site by its hosts, a host below one, or its path on the platform's host", () => {
    expect(urlOnSite("https://www.linen.no/p/apron", own)).toBe(true);
    expect(urlOnSite("http://shop.linen.no/", own)).toBe(true);
    expect(urlOnSite("https://notlinen.no/", own)).toBe(false);
    expect(urlOnSite("https://kaizenaflow.com/s/linen/no", onPlatform)).toBe(true);
    expect(urlOnSite("https://kaizenaflow.com/s/linen", onPlatform)).toBe(true);
    expect(urlOnSite("https://kaizenaflow.com/s/linens", onPlatform)).toBe(false);
    expect(urlOnSite("https://kaizenaflow.com/", onPlatform)).toBe(false);
    expect(urlOnHost("https://www.rival.no/a", "rival.no")).toBe(true);
    expect(urlOnHost("ftp://rival.no/a", "rival.no")).toBe(false);
  });

  it("counts each site's first place on the page, from one", () => {
    const results = ["https://rival.no/a", "https://other.no", "https://www.linen.no/p", "https://rival.no/b", "https://linen.no/x"].map((url) => ({ url }));
    expect(placesIn(results, own, ["rival.no", "furu.no"])).toEqual({ own: 3, rivals: { "rival.no": 1 } });
    expect(placesIn([], own, ["rival.no"])).toEqual({ own: null, rivals: {} });
  });
});

describe("what a check means (D905 M5b)", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const term = (over: Partial<SearchTermFacts> = {}): SearchTermFacts => ({
    term: "linen apron",
    market: "NO",
    checkedAt: "2026-11-20T10:00:00Z",
    own: 6,
    rivals: [
      { name: "Linnet", host: "linnet.no", position: 4 },
      { name: "Bomull", host: "bomull.no", position: 2 },
      { name: "Furu", host: "furu.no", position: null },
    ],
    ...over,
  });

  it("is behind the rival highest above the store, also when the store is not on the page", () => {
    expect(searchStanding(term(), now)).toEqual({ kind: "behind", rivalName: "Bomull", theirs: 2, yours: 6 });
    expect(searchStanding(term({ own: null }), now)).toEqual({ kind: "behind", rivalName: "Bomull", theirs: 2, yours: null });
  });

  it("is ahead near the top with no rival above, and nothing otherwise or from an old check", () => {
    expect(searchStanding(term({ own: 1 }), now)).toEqual({ kind: "ahead", yours: 1 });
    expect(searchStanding(term({ own: 5, rivals: [] }), now)).toBeNull();
    expect(searchStanding(term({ own: null, rivals: [] }), now)).toBeNull();
    expect(searchStanding(term({ checkedAt: new Date(now.getTime() - (SEARCH_FRESH_DAYS + 1) * 86_400_000).toISOString() }), now)).toBeNull();
    expect(searchStanding(term({ checkedAt: null }), now)).toBeNull();
  });
});
