import { describe, expect, it } from "vitest";

import type { RichTextDoc } from "./page-content";
import { cleanTermDescription, descriptionSummary, parseTermTexts, termsIn, termTextFor, termTextsInput, TERM_DESCRIPTION_MAX } from "./term-texts";

/** A category's or tag's own page per language (wave 6 unit A, D319): what is kept, and what a page in each language reads. */

const doc = (text: string): RichTextDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("a description", () => {
  it("is a document Kaizena Flow can draw, empty is none, and long is refused", () => {
    expect(cleanTermDescription(doc("Lys til hjemmet."))).toMatchObject({ ok: true, doc: { type: "doc" } });
    expect(cleanTermDescription(null)).toEqual({ ok: true, doc: null });
    expect(cleanTermDescription({ type: "doc", content: [{ type: "paragraph" }] })).toEqual({ ok: true, doc: null });
    expect(cleanTermDescription(doc("x".repeat(TERM_DESCRIPTION_MAX + 1)))).toMatchObject({ ok: false });
    expect(cleanTermDescription({ type: "doc", content: [{ type: "script" }] })).toMatchObject({ ok: false });
  });
});

describe("other languages", () => {
  const input = termTextsInput(["nb-NO", "sv-SE", "da-DK"], "nb-NO");

  it("keep the languages the store keeps, never the main one, and drop a language with nothing written", () => {
    expect(input.parse({ "sv-SE": { name: " Lampor ", description: doc("Ljus.") }, "da-DK": { name: "" } })).toEqual({ "sv-SE": { name: "Lampor", description: doc("Ljus.") } });
    expect(input.safeParse({ "fr-FR": { name: "Lampes" } }).success).toBe(false);
    expect(input.safeParse({ "nb-NO": { name: "Lamper" } }).success).toBe(false);
    expect(input.safeParse({ "sv-SE": { name: "x".repeat(81) } }).success).toBe(false);
  });

  it("are read leniently: anything that is not a name or a description is dropped, never thrown", () => {
    expect(parseTermTexts({ "sv-SE": { name: "Lampor", extra: 1 }, bad: "x", "da-DK": { description: { type: "nope" } } })).toEqual({ "sv-SE": { name: "Lampor" } });
    expect(parseTermTexts(null)).toEqual({});
    expect(parseTermTexts([])).toEqual({});
  });
});

describe("what a page reads", () => {
  const term = { name: "Lamper", description: doc("Lys til hjemmet."), texts: { "sv-SE": { name: "Lampor" } } };

  it("is the language's own name and description, else the main language's, never a third language's", () => {
    expect(termTextFor(term, "sv-SE")).toEqual({ name: "Lampor", description: doc("Lys til hjemmet.") });
    expect(termTextFor(term, "da-DK")).toEqual({ name: "Lamper", description: doc("Lys til hjemmet.") });
    expect(termTextFor({ ...term, texts: { "sv-SE": { description: doc("Ljus.") } } }, "sv-SE")).toEqual({ name: "Lamper", description: doc("Ljus.") });
    expect(termsIn([term, { name: "Bord" }], "sv-SE").map((t) => t.name)).toEqual(["Lampor", "Bord"]);
  });

  it("summarises a description for the page's metadata, cut at a word", () => {
    expect(descriptionSummary(null)).toBe("");
    expect(descriptionSummary(doc("Kort."))).toBe("Kort.");
    const long = descriptionSummary(doc("Lys til hjemmet og hagen, ".repeat(20)));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });
});
