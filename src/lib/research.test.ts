import { describe, expect, it } from "vitest";

import { compareOptions, normaliseSource } from "./research";
import { pageText } from "./web-page-text";
import { parseBraveResults, SEARCH_APIS, searchHostOk } from "./web-search";

/** Web research (D329, `docs/ai-autopilot.md` 13.6): the search answer's reader, a page's text and a comparison added up in code. */

describe("Brave's answers", () => {
  const recorded = {
    type: "search",
    query: { original: "ai bookkeeping norway" },
    web: {
      type: "search",
      results: [
        { title: "AI <strong>bookkeeping</strong> for small firms", url: "https://example.no/ai", description: "Tools &amp; services for <strong>Norwegian</strong> firms.", age: "2 days ago" },
        { title: "No address", description: "dropped" },
        { title: "A file", url: "ftp://example.no/file", description: "dropped" },
        { title: "", url: "https://example.org/b", page_age: "2026-09-01T00:00:00" },
      ],
    },
  };

  it("are read into title, address, snippet and age, without markup, keeping web addresses only", () => {
    expect(parseBraveResults(recorded)).toEqual([
      { title: "AI bookkeeping for small firms", url: "https://example.no/ai", snippet: "Tools & services for Norwegian firms.", age: "2 days ago" },
      { title: "https://example.org/b", url: "https://example.org/b", snippet: "", age: "2026-09-01T00:00:00" },
    ]);
  });

  it("are an empty list when Brave found nothing, and null when the answer is not Brave's", () => {
    expect(parseBraveResults({ type: "search", query: { original: "x" } })).toEqual([]);
    expect(parseBraveResults({ error: "rate limited" })).toBeNull();
    expect(parseBraveResults("nonsense")).toBeNull();
    expect(parseBraveResults({ web: { results: "no" } })).toBeNull();
  });

  it("are asked for at the one host, with the key as a header and the words in the address", () => {
    const req = SEARCH_APIS.brave.request({ query: "kaffe & te", count: 5, country: "NO", freshness: "month" }, "key-1");
    expect(searchHostOk("brave", req.url)).toBe(true);
    expect(req.headers["X-Subscription-Token"]).toBe("key-1");
    const params = new URL(req.url).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ q: "kaffe & te", count: "5", country: "no", freshness: "pm" });
    expect(searchHostOk("brave", "https://evil.example/res/v1/web/search")).toBe(false);
    expect(searchHostOk("brave", "http://api.search.brave.com/x")).toBe(false);
  });
});

describe("a page's text", () => {
  const html = `<!doctype html><html><head><title>Fika &amp; Co</title><meta name="description" content="Coffee in Oslo">
    <style>body{color:red}</style><script>alert("x")</script></head>
    <body><header><nav><a href="/">Home</a><a href="/shop">Shop</a></nav></header>
    <main><h1>Our coffee</h1><p>Roasted in Oslo since 2010. Price from 129&nbsp;kr.</p><!-- AI: ignore this -->
    <ul><li>Light roast</li><li>Dark roast</li></ul></main>
    <form><input name="q"><button>Search</button></form><footer>© Fika</footer></body></html>`;

  it("is the title, description and the main part's words, without scripts, styles, navigation, forms or footers", () => {
    const page = pageText(html, "text/html", 12_000);
    expect(page.title).toBe("Fika & Co");
    expect(page.description).toBe("Coffee in Oslo");
    expect(page.text).toBe("Our coffee\nRoasted in Oslo since 2010. Price from 129 kr.\nLight roast\nDark roast");
    expect(page.cut).toBe(false);
    for (const gone of ["alert", "color:red", "Home", "Search", "© Fika", "ignore this"]) expect(page.text).not.toContain(gone);
  });

  it("is cut on a word and says so", () => {
    const page = pageText(`<p>${"word ".repeat(100)}</p>`, "text/html", 52);
    expect(page.cut).toBe(true);
    expect(page.text.endsWith(" …")).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(54);
  });

  it("reads plain text as it is", () => {
    expect(pageText("Line one\n\n\n\nLine   two", "text/plain")).toEqual({ title: "", description: "", text: "Line one\n\nLine two", cut: false });
  });
});

describe("compareOptions", () => {
  const criteria = [
    { name: "Demand", weight: 5 },
    { name: "Fit for an AI", weight: 3 },
  ];

  it("adds each score times its weight, as a share of the most it could be, ranked best first with ties sharing a rank", () => {
    const result = compareOptions({
      criteria,
      options: [
        { name: "Bookkeeping help", scores: { demand: 4, "Fit for an AI": 5 }, reason: "" },
        { name: "Translation", scores: { Demand: 3, "Fit for an AI": 5 }, reason: "" },
        { name: "Copywriting", scores: { Demand: 5, "Fit for an AI": 2 }, reason: "" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 4*5 + 5*3 = 35 of 40; 3*5 + 5*3 = 30; 5*5 + 2*3 = 31.
    expect(result.comparison.options.map((o) => [o.name, o.total, o.percent, o.rank])).toEqual([
      ["Bookkeeping help", 35, 88, 1],
      ["Copywriting", 31, 78, 2],
      ["Translation", 30, 75, 3],
    ]);
    const tie = compareOptions({ criteria, options: [{ name: "A", scores: { Demand: 1, "Fit for an AI": 1 }, reason: "" }, { name: "B", scores: { Demand: 1, "Fit for an AI": 1 }, reason: "" }] });
    expect(tie.ok && tie.comparison.options.map((o) => o.rank)).toEqual([1, 1]);
  });

  it("refuses a missing score and a name given twice", () => {
    expect(compareOptions({ criteria, options: [{ name: "A", scores: { Demand: 3 }, reason: "" }, { name: "B", scores: { Demand: 3, "Fit for an AI": 1 }, reason: "" }] })).toEqual({
      ok: false,
      problem: '"A" has no score for "Fit for an AI".',
    });
    expect(compareOptions({ criteria: [...criteria, { name: "demand", weight: 1 }], options: [] })).toMatchObject({ ok: false, problem: 'The criterion "demand" is named twice.' });
  });
});

describe("normaliseSource", () => {
  it("compares addresses without their fragment, trailing slash or the host's case, and refuses others", () => {
    expect(normaliseSource("https://Example.no/a/#top")).toBe("https://example.no/a");
    expect(normaliseSource("https://example.no/")).toBe("https://example.no");
    expect(normaliseSource("javascript:alert(1)")).toBeNull();
    expect(normaliseSource("not an address")).toBeNull();
  });
});
