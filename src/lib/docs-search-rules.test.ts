import { describe, expect, it } from "vitest";

import type { DocArea } from "./docs-content";
import { NO_FILTERS, docsSearchParams, docsSearchQueryString, hasFilters, toggleFilter, type DocsFilters } from "./docs-search";
import {
  anyWordsQuery,
  browseDocs,
  compareKeys,
  decodeCursor,
  docsAlternatives,
  DOCS_SYNONYMS,
  encodeCursor,
  facetCounts,
  fuseRanks,
  groupDocs,
  matchOf,
  missQuery,
  pageOf,
  passes,
  queryWords,
  readDocsSearch,
  readDocsSearchPage,
  RRF_K,
  snippetOf,
  snippetTerms,
  sortDocs,
  sortKey,
  type DocsCandidate,
  type DocsDoc,
} from "./docs-search-rules";
import { cleanWord } from "./search-synonyms";

/** A candidate row, with what found it. */
function row(id: number, doc: string, over: Partial<DocsCandidate> = {}): DocsCandidate {
  return {
    id,
    doc,
    item: "section",
    track: "owners",
    kind: "how-to",
    lang: "en",
    areas: ["products"],
    section: "owners/products",
    title: doc,
    checked: "2026-11-01",
    reading: id,
    position: 0,
    keyword: null,
    similarity: null,
    reads: 0,
    ...over,
  };
}

const kw = (score: number, all = true) => ({ keyword: { score, all } });

describe("reading a search from its address (D443)", () => {
  it("reads every filter as a sorted list of known values, one each, from commas or repeats", () => {
    const read = readDocsSearch(new URLSearchParams("q=  vat   rate &kind=how-to,tutorial,nonsense&kind=how-to&area=tax&lang=nb&track=owners,x&sort=title"));
    expect(read).toEqual({
      ok: true,
      query: {
        q: "vat rate",
        filters: { track: ["owners"], kind: ["how-to", "tutorial"], area: ["tax"], lang: ["nb"], section: null },
        sort: "title",
        cursor: null,
      },
    });
  });

  it("takes the page's record as well, falls back to the default order, and holds a section to its shape", () => {
    const read = readDocsSearch({ q: ["first", "second"], section: "Owners/Getting-Started", sort: "loudest" });
    expect(read.ok && read.query).toMatchObject({ q: "first", sort: "relevance", filters: { section: "owners/getting-started" } });
    expect(readDocsSearch({ section: "../../etc" }).ok && (readDocsSearch({ section: "../../etc" }) as { query: { filters: DocsFilters } }).query.filters.section).toBeNull();
  });

  it("cuts long words and strips control characters", () => {
    const read = readDocsSearch(new URLSearchParams({ q: `a\u0000b​${"x".repeat(300)}` }));
    expect(read.ok && read.query.q.length).toBe(100);
    expect(read.ok && read.query.q.startsWith("a b ")).toBe(true);
  });

  it("refuses a cursor that is not one; the page reads it as the first page", () => {
    expect(readDocsSearch(new URLSearchParams("q=x&cursor=not a cursor!"))).toEqual({ ok: false, problem: "cursor" });
    expect(readDocsSearchPage(new URLSearchParams("q=x&cursor=not a cursor!"))).toMatchObject({ q: "x", cursor: null });
    expect(readDocsSearchPage({ q: "x", cursor: "%%%" })).toMatchObject({ q: "x", cursor: null });
  });

  it("writes a search back as one address, whatever order it was made in", () => {
    const filters: DocsFilters = { track: ["owners"], kind: ["tutorial", "how-to"], area: [], lang: ["nb"], section: "owners/products" };
    expect(docsSearchQueryString({ q: " mva ", filters, sort: "relevance" })).toBe("?q=mva&track=owners&kind=how-to%2Ctutorial&lang=nb&section=owners%2Fproducts");
    expect(docsSearchParams({ q: "", filters: NO_FILTERS, sort: "read", cursor: "abc" }).toString()).toBe("sort=read&cursor=abc");
    expect(docsSearchQueryString({ q: "", filters: NO_FILTERS, sort: "relevance" })).toBe("");
    // What it writes reads back the same.
    const back = readDocsSearch(new URLSearchParams(docsSearchQueryString({ q: "mva", filters, sort: "checked" }).slice(1)));
    expect(back.ok && back.query).toEqual({ q: "mva", filters: { ...filters, kind: ["how-to", "tutorial"] }, sort: "checked", cursor: null });
  });

  it("chooses and takes away one value of a filter", () => {
    const one = toggleFilter(NO_FILTERS, "kind", "how-to");
    expect(one.kind).toEqual(["how-to"]);
    expect(toggleFilter(one, "kind", "how-to").kind).toEqual([]);
    expect(hasFilters(one)).toBe(true);
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, section: "owners/x" })).toBe(true);
  });
});

describe("the docs' words: synonyms, words and misses (D443)", () => {
  it("finds VAT as MVA and moms, a quote as an offer and tilbud, both ways", () => {
    expect(docsAlternatives("vat rate")).toEqual(["mva rate", "moms rate", "merverdiavgift rate"]);
    expect(docsAlternatives("MVA")).toEqual(["vat", "moms", "merverdiavgift"]);
    expect(docsAlternatives("tilbud")).toEqual(["quote", "offer", "quotation"]);
    expect(docsAlternatives("send a quote")).toContain("send a tilbud");
    // The longer phrase first: a discount code is a rabattkode, not a rabatt code.
    expect(docsAlternatives("discount code")[0]).toBe("rabattkode");
    expect(docsAlternatives("nothing here")).toEqual([]);
  });

  it("keeps every synonym in the form a search reads it, once", () => {
    const words = DOCS_SYNONYMS.flatMap((g) => g.words);
    for (const word of words) expect(cleanWord(word), word).toBe(word);
    expect(new Set(words).size).toBe(words.length);
    for (const group of DOCS_SYNONYMS) expect(group.kind).toBe("both");
  });

  it("reads only letters and digits as words, so nothing typed changes a query", () => {
    expect(queryWords("How do I add a product's VAT? <script> & | !")).toEqual(["how", "do", "i", "add", "a", "product", "s", "vat"]);
    expect(anyWordsQuery("vat rate")).toBe("vat | rate | mva | moms | merverdiavgift");
    expect(anyWordsQuery("?!")).toBeNull();
    expect(snippetTerms("a vat")).toEqual(["vat", "mva", "moms", "merverdiavgift"]);
  });

  it("counts a miss under its tidy words, never under what looks like a person's details or a secret", () => {
    expect(missQuery("  Gift  CARDS ")).toBe("gift cards");
    expect(missQuery("x")).toBeNull();
    expect(missQuery("1234")).toBeNull();
    expect(missQuery("refund for ola@example.com")).toBeNull();
    expect(missQuery("call +47 912 34 567")).toBeNull();
    expect(missQuery("order 100234567")).toBeNull();
    expect(missQuery("kf_abcDEF123456789")).toBeNull();
    expect(missQuery("sk_live_123abc")).toBeNull();
    expect(missQuery("order 1234")).toBe("order 1234");
  });
});

describe("merging keyword and meaning by rank (D443)", () => {
  it("says how the words matched", () => {
    expect(matchOf("", [])).toBe("browse");
    expect(matchOf("x", [])).toBe("none");
    expect(matchOf("x", [row(1, "a", kw(1, false))])).toBe("any");
    expect(matchOf("x", [row(1, "a", kw(1, false)), row(2, "b", kw(0.2))])).toBe("all");
    expect(matchOf("x", [row(1, "a", { similarity: 0.8 })])).toBe("all");
  });

  it("sums 1 / (k + place) over keyword's and meaning's lists, as searchKnowledge() does", () => {
    const candidates = [row(1, "a", kw(0.9)), row(2, "b", { ...kw(0.5), similarity: 0.9 }), row(3, "c", { similarity: 0.7 }), row(4, "d", kw(0.3, false))];
    const scores = fuseRanks(candidates, "all");
    expect(scores.get(1)).toBeCloseTo(1 / (RRF_K + 1));
    expect(scores.get(2)).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1));
    expect(scores.get(3)).toBeCloseTo(1 / (RRF_K + 2));
    // A part with only some of the words is not ranked while others have them all.
    expect(scores.has(4)).toBe(false);
    // Found by both, it leads.
    expect([...scores.entries()].sort((x, y) => y[1] - x[1])[0][0]).toBe(2);
    // With no part having every word, the parts with some are ranked by their score.
    const some = fuseRanks([row(1, "a", kw(0.1, false)), row(2, "b", kw(0.4, false))], "any");
    expect(some.get(2)! > some.get(1)!).toBe(true);
  });

  it("answers each document once, at its best part, the earlier part at a tie", () => {
    const candidates = [
      row(1, "en:page", { position: 0, ...kw(0.2) }),
      row(2, "en:page", { position: 2, ...kw(0.9) }),
      row(3, "en:other", { position: 0, ...kw(0.5) }),
      row(4, "en:other", { position: 1, ...kw(0.5) }),
    ];
    const docs = groupDocs(candidates, fuseRanks(candidates, "all"), "all");
    expect(docs.map((d) => [d.doc, d.best.id])).toEqual([
      ["en:page", 2],
      ["en:other", 3],
    ]);
  });

  it("lists every document's start without words", () => {
    const docs = browseDocs([
      { doc: "en:a", item: "section", track: "owners", kind: "how-to", lang: "en", areas: ["products"], section: "owners/x", title: "A", checked: null, reading: 1, position: 0 },
      { doc: "en:a", item: "section", track: "owners", kind: "how-to", lang: "en", areas: ["products"], section: "owners/x", title: "A", checked: null, reading: 1, position: 1 },
      { doc: "en:b", item: "section", track: "owners", kind: "tutorial", lang: "en", areas: ["stock"], section: "owners/x", title: "B", checked: null, reading: 0, position: 0 },
    ]);
    expect(docs.map((d) => d.doc)).toEqual(["en:a", "en:b"]);
    expect(sortDocs(docs, "relevance", true).map((d) => d.doc)).toEqual(["en:b", "en:a"]);
  });
});

/** A document as a list holds it. */
function doc(name: string, over: Partial<DocsDoc> = {}): DocsDoc {
  const best = row(0, name);
  return {
    doc: name,
    best,
    score: 0,
    item: "section",
    track: "owners",
    kind: "how-to",
    lang: "en",
    areas: ["products"],
    section: "owners/products",
    title: name,
    checked: "2026-11-01",
    reading: 0,
    reads: 0,
    ...over,
  };
}

describe("the filters and their counts (D443)", () => {
  const docs = [
    doc("a", { kind: "how-to", areas: ["products", "orders"] }),
    doc("b", { kind: "tutorial", areas: ["products"] }),
    doc("c", { kind: "how-to", track: "developers", areas: ["admin-api"], section: "developers/overview" }),
    doc("d", { kind: "reference", track: "developers", lang: "en", areas: ["admin-api", "errors"], section: null, item: "error" }),
    doc("e", { kind: "how-to", lang: "nb", areas: ["products"] }),
  ];

  it("passes a document on any chosen value of a filter and on every filter", () => {
    expect(docs.filter((d) => passes(d, { ...NO_FILTERS, kind: ["how-to", "tutorial"] })).map((d) => d.doc)).toEqual(["a", "b", "c", "e"]);
    expect(docs.filter((d) => passes(d, { ...NO_FILTERS, kind: ["how-to"], track: ["owners"] })).map((d) => d.doc)).toEqual(["a", "e"]);
    expect(docs.filter((d) => passes(d, { ...NO_FILTERS, area: ["orders", "errors"] })).map((d) => d.doc)).toEqual(["a", "d"]);
    expect(docs.filter((d) => passes(d, { ...NO_FILTERS, section: "developers/overview" })).map((d) => d.doc)).toEqual(["c"]);
  });

  it("counts each filter's values with the other filters applied and not its own", () => {
    const facets = facetCounts(docs, { ...NO_FILTERS, kind: ["how-to"], lang: ["en"] });
    // Kinds counted without the kind filter, within English.
    expect(facets.kind).toEqual([
      { value: "tutorial", count: 1, selected: false },
      { value: "how-to", count: 2, selected: true },
      { value: "reference", count: 1, selected: false },
    ]);
    // Languages counted without the language filter, within how-tos.
    expect(facets.lang).toEqual([
      { value: "en", count: 2, selected: true },
      { value: "nb", count: 1, selected: false },
    ]);
    expect(facets.track).toEqual([
      { value: "owners", count: 1, selected: false },
      { value: "developers", count: 1, selected: false },
    ]);
    // Areas most first, a document counted once in each of its areas.
    expect(facets.area).toEqual([
      { value: "products", count: 1, selected: false },
      { value: "orders", count: 1, selected: false },
      { value: "admin-api", count: 1, selected: false },
    ]);
  });

  it("keeps a chosen value that would leave nothing, so it can be taken away", () => {
    const facets = facetCounts(docs, { ...NO_FILTERS, area: ["tax" as DocArea], track: ["developers"] });
    expect(facets.area.find((f) => f.value === "tax")).toEqual({ value: "tax", count: 0, selected: true });
  });
});

describe("the orders and the cursor (D443)", () => {
  const docs = [
    doc("en:a", { score: 0.02, reading: 3, title: "Ørsted", checked: "2026-10-01", reads: 5 }),
    doc("en:b", { score: 0.03, reading: 2, title: "apples", checked: null, reads: 9 }),
    doc("en:c", { score: 0.01, reading: 1, title: "Zebra", checked: "2026-11-02", reads: 0 }),
    doc("nb:d", { score: 0.03, reading: 0, title: "Bananer", checked: "2026-11-02", reads: 9, lang: "nb" }),
  ];
  const order = (sort: Parameters<typeof sortDocs>[1], browse = false) => sortDocs(docs, sort, browse).map((d) => d.doc);

  it("orders by best match (the docs' reading order without words), recently checked, A to Z and most read", () => {
    expect(order("relevance")).toEqual(["nb:d", "en:b", "en:a", "en:c"]);
    expect(order("relevance", true)).toEqual(["nb:d", "en:c", "en:b", "en:a"]);
    expect(order("checked")).toEqual(["nb:d", "en:c", "en:a", "en:b"]);
    expect(order("title")).toEqual(["en:b", "nb:d", "en:c", "en:a"]);
    expect(order("read")).toEqual(["nb:d", "en:b", "en:a", "en:c"]);
  });

  it("compares keys item by item, words without case", () => {
    expect(compareKeys([1, "b"], [1, "a"])).toBe(1);
    expect(compareKeys(["apple"], ["Apple"])).not.toBe(0);
    expect(compareKeys(["apple", "x"], ["Apple", "x"])).not.toBe(0);
    expect(compareKeys([-2], [-1])).toBe(-1);
  });

  it("pages twenty at a time, each page after the last one's document, and says when there is no more", () => {
    const many = Array.from({ length: 45 }, (_, i) => doc(`en:p${String(i).padStart(2, "0")}`, { reading: i }));
    const first = pageOf(many, "relevance", true, null);
    expect(first.page.map((d) => d.reading)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(first.next).not.toBeNull();
    const second = pageOf(many, "relevance", true, decodeCursor(first.next!, "relevance"));
    expect(second.page[0].reading).toBe(20);
    const third = pageOf(many, "relevance", true, decodeCursor(second.next!, "relevance"));
    expect(third.page.map((d) => d.reading)).toEqual([40, 41, 42, 43, 44]);
    expect(third.next).toBeNull();
    // A document gone meanwhile moves nothing: the next page starts after where the last one stood.
    const fewer = many.filter((d) => d.reading !== 19 && d.reading !== 20);
    expect(pageOf(fewer, "relevance", true, decodeCursor(first.next!, "relevance")).page[0].reading).toBe(21);
  });

  it("holds a cursor to its order and to its shape", () => {
    const cursor = encodeCursor("title", sortKey(docs[0], "title", false));
    expect(decodeCursor(cursor, "title")).toEqual(["Ørsted", "en", "en:a"]);
    expect(decodeCursor(cursor, "relevance")).toBeNull();
    expect(decodeCursor("bm90IGpzb24", "title")).toBeNull();
    expect(decodeCursor(encodeCursor("title", [{} as unknown as string]), "title")).toBeNull();
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("the snippet (D443)", () => {
  const text =
    "Each country gets its own storefront in its own language and currency. A product shows in a country once it has a price there. " +
    "Prices include VAT at the country's rate, and the 30-day reference price is shown only for a genuine reduction.";

  it("shows the words around the first one found, each word starting with a term marked", () => {
    const parts = snippetOf(text, snippetTerms("vat"), 120);
    expect(parts[0].hit).toBe(false);
    expect(parts[0].text.startsWith("…it has a price there.")).toBe(true);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["VAT"]);
    expect(parts.map((p) => p.text).join("").length).toBeLessThanOrEqual(124);
  });

  it("marks a whole word from its start, and only at a word's start", () => {
    const parts = snippetOf("Products and byproducts: one product.", ["product"]);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Products", "product"]);
  });

  it("starts at the beginning when nothing is found, and keeps text as text", () => {
    expect(snippetOf("<b>bold</b> words", ["nothing"])).toEqual([{ text: "<b>bold</b> words", hit: false }]);
    expect(snippetOf("", ["x"])).toEqual([]);
  });
});
