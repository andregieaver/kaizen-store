import { describe, expect, it } from "vitest";

import type { PageContent, RichTextDoc } from "./page-content";
import { applyTranslated, batchItems, readTranslations, richRuns, translationItems, translationMessages, withRichRuns } from "./page-translate-ai";

const doc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Handmade " }, { type: "text", text: "coffee", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "from Bergen." }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Fair trade" }] }] }] },
  ],
};

const page = {
  title: "About us",
  slug: "about",
  seo: { title: "", description: "Our story" },
  rows: [{ id: "r1", columns: [{ id: "c1", blocks: [{ id: "b1", type: "richText", doc }, { id: "b2", type: "heading", text: "Welcome", level: 2 }] }] }],
  translations: { "sv-SE": { title: "Om oss" } },
} as unknown as PageContent;

describe("rich text runs", () => {
  it("reads the runs of a document and puts new ones in, keeping its formatting", () => {
    expect(richRuns(doc)).toEqual(["Handmade ", "coffee", "from Bergen.", "Fair trade"]);
    const next = withRichRuns(doc, ["Handgjort ", "kaffe", "från Bergen.", "Rättvis handel"])!;
    expect(richRuns(next)).toEqual(["Handgjort ", "kaffe", "från Bergen.", "Rättvis handel"]);
    expect(JSON.stringify(next)).toContain('"bold"');
    // The original is untouched, and a wrong number of runs is refused.
    expect(richRuns(doc)[0]).toBe("Handmade ");
    expect(withRichRuns(doc, ["one"])).toBeNull();
  });
});

describe("what to translate", () => {
  it("lists every text with words, or only those a language lacks", () => {
    const all = translationItems(page, "sv-SE", "all").map((i) => i.key);
    expect(all).toEqual(expect.arrayContaining(["title", "seo.description", "block.b1.doc", "block.b2.text"]));
    expect(all).not.toContain("seo.title");
    const missing = translationItems(page, "sv-SE", "missing").map((i) => i.key);
    expect(missing).not.toContain("title");
    expect(missing).toContain("block.b2.text");
    expect(translationItems(page, "sv-SE", "all").find((i) => i.key === "block.b1.doc")).toMatchObject({ rich: true, max: 0 });
  });

  it("groups them into batches", () => {
    const items = translationItems(page, "de-DE", "all");
    expect(batchItems(items, 5000, 30)).toHaveLength(1);
    expect(batchItems(items, 5000, 2).length).toBeGreaterThan(1);
    expect(batchItems([], 100, 2)).toEqual([]);
  });

  it("asks with the languages and the texts by id", () => {
    const items = translationItems(page, "sv-SE", "missing");
    const [system, user] = translationMessages("Norwegian", "Swedish", items);
    expect(system.content).toContain("from Norwegian into Swedish");
    expect(JSON.parse(user.content)[0]).toMatchObject({ id: "t0" });
  });
});

describe("the model's answer", () => {
  const items = translationItems(page, "de-DE", "all");
  const answerFor = (fill: (key: string) => unknown) => Object.fromEntries(items.map((item, i) => [`t${i}`, fill(item.key)]));

  it("is checked and put in the language's translation", () => {
    const answer = answerFor((key) =>
      key === "block.b1.doc" ? ["Handgemachter ", "Kaffee", "aus Bergen.", "Fairer Handel"] : `de:${key}`,
    );
    const { done, skipped } = readTranslations(answer, items);
    expect(skipped).toEqual([]);
    const translation = applyTranslated(page, { title: "Om oss" }, done);
    expect(translation["block.b2.text"]).toBe("de:block.b2.text");
    expect(richRuns(translation["block.b1.doc"] as RichTextDoc)).toEqual(["Handgemachter ", "Kaffee", "aus Bergen.", "Fairer Handel"]);
  });

  it("keeps a run's own spaces", () => {
    const { done } = readTranslations(answerFor((key) => (key === "block.b1.doc" ? ["Handgemachter", "Kaffee", "aus Bergen.", "Fairer Handel"] : "x")), items);
    expect((done["block.b1.doc"] as string[])[0]).toBe("Handgemachter ");
  });

  it("skips what is missing, misshapen, too long or carries a claim the source did not", () => {
    const answer = answerFor((key) => {
      if (key === "title") return "x".repeat(300);
      if (key === "block.b1.doc") return ["only one"];
      if (key === "block.b2.text") return "Nur 99 kr heute";
      return undefined;
    });
    const { done, skipped } = readTranslations(answer, items);
    expect(done).toEqual({});
    expect(skipped.map((s) => s.key).sort()).toEqual(items.map((i) => i.key).sort());
  });
});
