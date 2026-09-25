import { describe, expect, it } from "vitest";

import { newPageContent, pageInput, type PageContent, type RichTextDoc } from "./page-content";
import {
  cleanTranslations,
  localizePage,
  pageLanguages,
  pageTexts,
  translationOf,
  translationProgress,
  withTranslation,
} from "./page-translation";

const doc = (text: string): RichTextDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** A page in Norwegian with a text, a heading, a button, a picture and a linked column. */
const page = (): PageContent => ({
  ...newPageContent(),
  title: "Om oss",
  slug: "om-oss",
  seo: { title: "", description: "Hvem vi er" },
  rows: [
    {
      id: "r1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "c1",
          link: { href: "/kontakt", label: "Kontakt oss" },
          blocks: [
            { id: "t1", type: "richText", doc: doc("Vi selger ting.") },
            { id: "h1", type: "heading", text: "Velkommen", level: 2 },
            { id: "b1", type: "button", label: "Handle nå", href: "/p/kopp" },
            { id: "i1", type: "image", image: { url: "https://example.com/a.webp", width: 10, height: 10, alt: "En kopp" }, caption: "" },
          ],
        },
      ],
    },
  ],
});

describe("a page's texts in other languages (D55)", () => {
  it("knows every text by its place, even an empty one", () => {
    const texts = pageTexts(page());
    expect([...texts.keys()]).toEqual([
      "title",
      "seo.title",
      "seo.description",
      "column.c1.label",
      "block.t1.doc",
      "block.h1.text",
      "block.b1.label",
      "block.i1.caption",
      "block.i1.alt",
    ]);
    expect(texts.get("block.h1.text")).toEqual({ value: "Velkommen", max: 300 });
  });

  it("keeps only what differs from the main language, and reads the page in each language", () => {
    const base = page();
    const swedish = localizePage(base, "sv-SE");
    expect(swedish).toBe(base);
    const edited: PageContent = {
      ...swedish,
      title: "Om oss",
      seo: { title: "Vilka vi är", description: "Hvem vi er" },
      rows: swedish.rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => ({
          ...column,
          blocks: column.blocks.map((block) =>
            block.type === "heading" ? { ...block, text: "Välkommen", level: 3 as const } : block.type === "richText" ? { ...block, doc: doc("Vi säljer saker.") } : block,
          ),
        })),
      })),
    };
    const translation = translationOf(base, edited);
    // Only texts count: the heading's new level is not a translation.
    expect(translation).toEqual({ "seo.title": "Vilka vi är", "block.t1.doc": doc("Vi säljer saker."), "block.h1.text": "Välkommen" });
    const withSwedish = withTranslation(base, "sv-SE", translation);
    const read = localizePage(withSwedish, "sv-SE");
    expect(read.seo.title).toBe("Vilka vi är");
    expect(read.rows[0].columns[0].blocks[1]).toMatchObject({ text: "Välkommen", level: 2 });
    // Another language, or none, reads the page as written.
    expect(localizePage(withSwedish, "da-DK").rows[0].columns[0].blocks[1]).toMatchObject({ text: "Velkommen" });
    expect(translationProgress(withSwedish, "sv-SE")).toEqual({ done: 2, of: 7 });
    // Clearing a language's last text removes it.
    expect(withTranslation(withSwedish, "sv-SE", {}).translations).toBeUndefined();
  });

  it("saves only the owner's other languages, texts the page has, and clean rich text", () => {
    const content = {
      ...page(),
      translations: {
        "sv-SE": {
          "block.h1.text": "  Välkommen  ",
          "block.gone.text": "Borta",
          "block.t1.doc": { type: "doc", content: [{ type: "script", text: "x" }] },
        },
        "fi-FI": { "block.h1.text": "Tervetuloa" },
      },
    } as unknown as PageContent;
    const languages = [{ locale: "sv-SE", name: "Swedish" }];
    expect(cleanTranslations(content, languages)).toEqual({ ok: false, problems: [expect.stringMatching(/\(Swedish\)$/)] });
    const fine = { ...content, translations: { ...content.translations, "sv-SE": { "block.h1.text": "  Välkommen  ", "block.b1.label": "Handle nå", "block.gone.text": "Borta" } } };
    const cleaned = cleanTranslations(fine, languages);
    expect(cleaned).toEqual({ ok: true, content: { ...page(), translations: { "sv-SE": { "block.h1.text": "Välkommen" } } } });
    const tooLong = { ...content, translations: { "sv-SE": { "block.h1.text": "x".repeat(301) } } };
    expect(cleanTranslations(tooLong, languages)).toEqual({ ok: false, problems: ["Keep each text under 300 characters (Swedish)."] });
    // Kaizen's pages have no other languages: translations are dropped.
    expect(cleanTranslations(fine, [])).toEqual({ ok: true, content: page() });
  });

  it("are read with the page, and languages come in the markets' order, each once", () => {
    const stored = { ...page(), translations: { "sv-SE": { "block.h1.text": "Välkommen" } } };
    expect(pageInput.safeParse(stored).success).toBe(true);
    expect(pageInput.safeParse({ ...stored, translations: { "not a locale": {} } }).success).toBe(false);
    expect(pageLanguages(["nb-NO", "sv-SE", "nb-NO"])).toEqual([
      { locale: "nb-NO", name: "Norwegian Bokmål" },
      { locale: "sv-SE", name: "Swedish" },
    ]);
  });
});
