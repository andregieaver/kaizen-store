import { describe, expect, it } from "vitest";

import { newPageContent, pageInput, type PageContent, type RichTextDoc } from "./page-content";
import {
  blockTextFields,
  cleanTranslations,
  localizePage,
  pageLanguages,
  pageTexts,
  setBlockText,
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

describe("a component's texts for the translator", () => {
  it("lists each text by its place, with what it is, and sets one", () => {
    const image = { id: "i", type: "image" as const, image: { url: "https://x/a.webp", width: 1, height: 1, alt: "Kopp" }, caption: "Vår kopp" };
    expect(blockTextFields(image)).toEqual([
      { key: "block.i.caption", label: "Caption", max: 300, value: "Vår kopp" },
      { key: "block.i.alt", label: "Description of the picture", max: 300, value: "Kopp" },
    ]);
    const next = setBlockText(image, "block.i.caption", "Vår mugg");
    expect(next).toMatchObject({ caption: "Vår mugg", image: { alt: "Kopp" } });
    expect(blockTextFields({ id: "m", type: "menu" })).toEqual([]);
  });
});

describe("a picture's own size and its translations (D151)", () => {
  const picture = { url: "https://example.com/a.webp", width: 800, height: 600, alt: "En kopp" };
  const sized = { id: "i1", type: "image" as const, image: picture, caption: "Vår kopp", shape: "circle" as const, maxWidth: 300, align: { mobile: "center", desktop: "right" } as const };
  const withSized = (): PageContent => {
    const base = page();
    return { ...base, rows: base.rows.map((row) => ({ ...row, columns: row.columns.map((column) => ({ ...column, blocks: column.blocks.map((b) => (b.id === "i1" ? { ...sized, align: { ...sized.align } } : b)) })) })) };
  };
  const pictureOf = (content: PageContent) => content.rows[0].columns[0].blocks.find((b) => b.id === "i1");

  it("adds no text to translate: the translator still lists the caption and the description, and no more", () => {
    expect(blockTextFields(sized).map((field) => field.key)).toEqual(["block.i1.caption", "block.i1.alt"]);
    expect(blockTextFields(sized)).toEqual(blockTextFields({ ...sized, maxWidth: undefined, align: undefined }));
    // The page lists the same texts with the size as without it: the width and position are no text.
    expect([...pageTexts(withSized()).keys()]).toEqual([...pageTexts(page()).keys()]);
  });

  it("keeps the width and position when a text is set, and when a block's texts are mapped", () => {
    const next = setBlockText(sized, "block.i1.alt", "Een kop");
    expect(next).toMatchObject({ maxWidth: 300, align: { mobile: "center", desktop: "right" }, shape: "circle", image: { alt: "Een kop", width: 800, height: 600 } });
    expect(setBlockText(sized, "block.i1.caption", "Onze kop")).toMatchObject({ caption: "Onze kop", maxWidth: 300, align: { desktop: "right" } });
  });

  it("is read in another language with the same width and position, the words changed", () => {
    const base = withSized();
    const translated = withTranslation(base, "sv-SE", { "block.i1.caption": "Vår kopp (sv)", "block.i1.alt": "En kopp (sv)" });
    const read = localizePage(translated, "sv-SE");
    expect(pictureOf(read)).toMatchObject({ caption: "Vår kopp (sv)", maxWidth: 300, align: { mobile: "center", desktop: "right" }, shape: "circle", image: { alt: "En kopp (sv)", width: 800, height: 600 } });
    // Another language, or none, reads the page as written.
    expect(pictureOf(localizePage(translated, "da-DK"))).toMatchObject({ caption: "Vår kopp", maxWidth: 300 });
    // The page the translation was made on is not touched.
    expect(pictureOf(base)).toMatchObject({ caption: "Vår kopp", image: { alt: "En kopp" } });
  });

  it("is no translation by itself: a copy with another width or position gives none, and a changed caption only its own", () => {
    const base = withSized();
    const narrower: PageContent = { ...base, rows: base.rows.map((row) => ({ ...row, columns: row.columns.map((column) => ({ ...column, blocks: column.blocks.map((b) => (b.id === "i1" ? { ...b, maxWidth: 120, align: { mobile: "left" as const } } : b)) })) })) };
    expect(translationOf(base, narrower)).toEqual({});
    const edited = localizePage(withTranslation(narrower, "sv-SE", { "block.i1.caption": "Vår mugg" }), "sv-SE");
    expect(translationOf(base, edited)).toEqual({ "block.i1.caption": "Vår mugg" });
  });

  it("is saved with its translations: they are cleaned against the page's texts and the width is not one of them", () => {
    const content = { ...withSized(), translations: { "sv-SE": { "block.i1.caption": "  Vår mugg  ", "block.i1.maxWidth": "100" } } } as PageContent;
    const cleaned = cleanTranslations(content, [{ locale: "sv-SE", name: "Swedish" }]);
    expect(cleaned).toMatchObject({ ok: true, content: { translations: { "sv-SE": { "block.i1.caption": "Vår mugg" } } } });
    if (cleaned.ok) expect(pictureOf(cleaned.content)).toMatchObject({ maxWidth: 300, align: { mobile: "center", desktop: "right" } });
    const parsed = pageInput.safeParse(content);
    expect(parsed.success).toBe(true);
    expect(pictureOf(parsed.data!)).toMatchObject({ maxWidth: 300, align: { mobile: "center", desktop: "right" } });
  });
});
