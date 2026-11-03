import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NO_FILTERS, type DocsSearchAnswer } from "@/lib/docs-search";
import { platformEn } from "@/lib/messages/platform-en";
import { platformNb } from "@/lib/messages/platform-nb";

import { DocsSearchPanel, type DocsPanelStart } from "./docs-search-panel";

/**
 * The search panel as the server draws it (D443): what a reader without JavaScript gets, so every chip, order and *Show more* must be a
 * link to the search page with the search in its address, the form must submit there with its filters, and a result's words must stay
 * text.
 */

const NAMES = { tracks: { owners: "Store owners", developers: "Developers" }, langs: { en: "English", nb: "Norsk" } };

const ANSWER: DocsSearchAnswer = {
  q: "token",
  filters: { ...NO_FILTERS, track: ["developers"] },
  sort: "relevance",
  match: "all",
  meaning: false,
  found: 3,
  total: 2,
  results: [
    {
      doc: "en:developers/overview/authentication",
      href: "/docs/developers/overview/authentication#tokens",
      item: "section",
      track: "developers",
      kind: "reference",
      lang: "en",
      areas: ["admin-api"],
      title: "Authentication, scopes and limits",
      headings: ["Tokens"],
      section: { path: "developers/overview", title: "Overview" },
      code: null,
      snippet: [
        { text: "A <b>", hit: false },
        { text: "token", hit: true },
        { text: " belongs to one store.", hit: false },
      ],
      checked: "2026-11-03",
    },
    {
      doc: "ref:scope:products:read",
      href: "/docs/developers/overview/authentication#scopes",
      item: "scope",
      track: "developers",
      kind: "reference",
      lang: "en",
      areas: ["authentication"],
      title: "products:read",
      headings: [],
      section: null,
      code: "products:read",
      snippet: [{ text: "Read only.", hit: false }],
      checked: null,
    },
  ],
  facets: {
    track: [
      { value: "owners", count: 1, selected: false },
      { value: "developers", count: 2, selected: true },
    ],
    kind: [{ value: "reference", count: 2, selected: false }],
    lang: [{ value: "en", count: 2, selected: false }],
    area: [{ value: "admin-api", count: 2, selected: false }],
  },
  next: "abc_DEF-1",
};

const draw = (start: Partial<DocsPanelStart> & Pick<DocsPanelStart, "query">, more: { guide?: boolean; lang?: "en" | "nb" } = {}) =>
  renderToStaticMarkup(
    createElement(DocsSearchPanel, {
      mode: "page",
      start: { answer: null, problem: null, missCounted: false, ...start },
      words: (more.lang === "nb" ? platformNb : platformEn).docs.finder,
      names: NAMES,
      uiLang: more.lang ?? "en",
      searchHref: more.lang === "nb" ? "/no/docs/search" : "/docs/search",
      homeHref: more.lang === "nb" ? "/no/docs" : "/docs",
      guide: more.guide ?? false,
      sectionTitle: null,
    }),
  );

describe("the docs' search panel without JavaScript (D443)", () => {
  const html = draw({ query: { q: "token", filters: ANSWER.filters, sort: "relevance" }, answer: ANSWER });

  it("is a search form that submits to the search page with its filters", () => {
    expect(html).toMatch(/<form role="search" aria-label="Search the docs"[^>]* action="\/docs\/search" method="get">/);
    expect(html).toContain('type="search"');
    expect(html).toContain('name="q" value="token"');
    expect(html).toContain('<input type="hidden" name="track" value="developers"/>');
  });

  it("draws each filter, order and the next page as a link to the search page with that search", () => {
    expect(html).toContain('href="/docs/search?q=token"');
    expect(html).toContain('href="/docs/search?q=token&amp;track=developers%2Cowners"');
    expect(html).toContain('href="/docs/search?q=token&amp;track=developers&amp;kind=reference"');
    expect(html).toContain('href="/docs/search?q=token&amp;track=developers&amp;sort=title"');
    expect(html).toContain('href="/docs/search?q=token&amp;track=developers&amp;cursor=abc_DEF-1"');
    // A chosen chip says so to a screen reader.
    expect(html).toMatch(/Developers<\/span><span>2<\/span><span class="sr-only">\(chosen\)<\/span>/);
  });

  it("says the count politely and draws every result with its track, section, kind and words as text", () => {
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>2 results</);
    expect(html).toContain('href="/docs/developers/overview/authentication#tokens"');
    expect(html).toContain("Developers › Overview");
    expect(html).toContain("Authentication, scopes and limits");
    expect(html).toContain(" › Tokens");
    expect(html).toContain("A &lt;b&gt;");
    expect(html).toContain("<mark");
    // A reference item names what it is and shows its code.
    expect(html).toContain("Developers › Admin API scope");
    expect(html).toContain(">products:read</code>");
    expect(html).toContain(">Reference<");
  });

  it("offers the whole docs when the filters hid what the words found", () => {
    const hidden = draw({ query: { q: "token", filters: { ...NO_FILTERS, track: ["owners"] }, sort: "relevance" }, answer: { ...ANSWER, total: 0, results: [], match: "none", next: null } });
    expect(hidden).toContain("Nothing matches “token” with these filters.");
    expect(hidden).toMatch(/href="\/docs\/search\?q=token"[^>]*>Search all the docs</);
    expect(hidden).not.toContain("Try fewer words");
  });

  it("says when the docs have nothing, with tips and the gap list's note, and the guide only once it exists (unit E5)", () => {
    const none = { ...ANSWER, q: "zzz", found: 0, total: 0, results: [], match: "none" as const, next: null, filters: NO_FILTERS };
    const without = draw({ query: { q: "zzz", filters: NO_FILTERS, sort: "relevance" }, answer: none });
    expect(without).toContain("Nothing in the docs matches “zzz”.");
    expect(without).toContain("Try fewer words, other words or another spelling.");
    expect(without).toContain("We count searches that find nothing");
    expect(without).not.toContain("Ask the AI guide");
    const withGuide = draw({ query: { q: "how do I zzz", filters: NO_FILTERS, sort: "relevance" }, answer: { ...none, q: "how do I zzz" } }, { guide: true });
    expect(withGuide).toContain('href="/docs?ask=how%20do%20I%20zzz"');
    expect(withGuide).toContain("Ask the AI guide");
  });

  it("speaks Norwegian on the Norwegian page", () => {
    const nb = draw({ query: { q: "token", filters: ANSWER.filters, sort: "relevance" }, answer: ANSWER }, { lang: "nb" });
    expect(nb).toContain('action="/no/docs/search"');
    expect(nb).toContain("2 treff");
    expect(nb).toContain("Flere filtre");
    expect(nb).toContain("Tilgang i Admin-API-et");
  });

  it("says when it is too busy or failed, and what to type before a search", () => {
    expect(draw({ query: { q: "x", filters: NO_FILTERS, sort: "relevance" }, problem: "busy" })).toContain("Too many searches from here just now.");
    expect(draw({ query: { q: "x", filters: NO_FILTERS, sort: "relevance" }, problem: "failed" })).toContain("The search did not answer.");
    expect(draw({ query: { q: "", filters: NO_FILTERS, sort: "relevance" } })).toContain("Type a few words to search every page of the docs.");
  });
});
