import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import type { Term } from "@/lib/taxonomy";

import { TermsManager } from "./terms";
import { TermSeoFields, seoLanguagesOf, type TermSeoSetup } from "./term-seo-fields";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const setup: TermSeoSetup = {
  locales: ["nb-NO", "sv-SE"],
  languageNames: { "nb-NO": "Norwegian Bokmål", "sv-SE": "Swedish" },
  storeName: "Demo",
  descriptions: { "nb-NO": "Alt til hjemmet." },
  base: "https://kaizen.example/s/demo/no",
};

describe("the search texts of a category or tag", () => {
  it("offers one language at a time with the product editor's fields and a preview at the term's address", () => {
    const out = html(createElement(TermSeoFields, { setup, name: "Hjem", kind: "category", slug: "hjem", value: {}, onChange: () => {} }));
    expect(out).toContain("Search results");
    expect(out).toContain("Norwegian Bokmål");
    expect(out).toContain("Swedish");
    expect(out).toContain("Title in search results");
    expect(out).toContain("Description in search results");
    // An empty language uses the name and the store's own description, said as the placeholder.
    expect(out).toContain('placeholder="Hjem · Demo"');
    expect(out).toContain("Alt til hjemmet.");
    expect(out).toContain("kaizen.example › s › demo › no › category › hjem");
    expect(out).toContain("never in another");
    expect(out).toContain('aria-pressed="true"');
  });

  it("marks a language that already has a text, and shows it", () => {
    const out = html(createElement(TermSeoFields, { setup, name: "Hjem", kind: "category", slug: "hjem", value: { "nb-NO": { title: "Alt til hjemmet", description: "Møbler." } }, onChange: () => {} }));
    expect(out).toContain('value="Alt til hjemmet"');
    expect(out).toContain("(has a text)");
  });

  it("draws no language buttons for a store with one language", () => {
    const out = html(createElement(TermSeoFields, { setup: { ...setup, locales: ["nb-NO"] }, name: "Hjem", kind: "tag", slug: "hjem", value: {}, onChange: () => {} }));
    expect(out).not.toContain("aria-pressed");
    expect(out).toContain("no › tag › hjem");
  });

  it("names the languages a term has a text in, in the store's order", () => {
    expect(seoLanguagesOf(undefined, setup)).toEqual([]);
    expect(seoLanguagesOf({}, setup)).toEqual([]);
    expect(seoLanguagesOf({ "sv-SE": { title: "Hem", description: "" }, "nb-NO": { title: "", description: "Møbler" } }, setup)).toEqual(["Norwegian Bokmål", "Swedish"]);
    // A language the store no longer offers is not named.
    expect(seoLanguagesOf({ "da-DK": { title: "Hjem", description: "" } }, setup)).toEqual([]);
  });
});

describe("the categories and tags screen", () => {
  const terms: Term[] = [
    { id: "c1", kind: "category", parentId: null, name: "Hjem", slug: "hjem", seo: { "nb-NO": { title: "Alt til hjemmet", description: "" } } },
    { id: "t1", kind: "tag", parentId: null, name: "Salg", slug: "salg", seo: {} },
  ];
  const actions = { create: async () => ({ ok: false as const, problems: [] }), update: async () => ({ ok: false as const, problems: [] }), remove: async () => ({ ok: false as const, problems: [] }) };

  it("says in each row which languages have a search text, when the screen offers them", () => {
    const out = html(createElement(TermsManager, { initial: terms, actions, usedBy: "products", seo: setup }));
    expect(out).toContain("Search results text in Norwegian Bokmål");
    expect(out).toContain("No text of its own in search results");
  });

  it("draws nothing about search texts on a screen that does not offer them (the pages' categories)", () => {
    const out = html(createElement(TermsManager, { initial: terms, actions, usedBy: "pages" }));
    expect(out).not.toContain("search results");
    expect(out).not.toContain("Search results");
  });
});
