import { describe, expect, it } from "vitest";

import { docToMarkup, markupToDoc, withStyleClass } from "./inline-doc";

/** Inline markup as an editor's document and back (D393): what is written is the markup `<Inline>` already draws. */
describe("markupToDoc and docToMarkup", () => {
  it("leaves plain words and canonical markup as they were", () => {
    for (const text of [
      "My awesome heading",
      'My <span class="ts-gradient">awesome</span> heading',
      "<strong>Bold <em>and italic</em></strong> then plain",
      'A <a href="/about">link <b>inside</b></a> here',
      "Two<br>lines",
      "a < b and 5 > 3 & more",
      "",
    ]) {
      expect(docToMarkup(markupToDoc(text))).toBe(text);
    }
  });

  it("reads the shorthand and nested spans as one span, and writes a class", () => {
    expect(docToMarkup(markupToDoc('<span="ts-glow">x</span>'))).toBe('<span class="ts-glow">x</span>');
    const doc = markupToDoc('<span class="big"><span class="ts-glow">x</span></span>');
    expect(doc.content?.[0]).toEqual({ type: "text", text: "x", marks: [{ type: "m_span", attrs: { className: "big ts-glow" } }] });
  });

  it("escapes only what could be read as markup", () => {
    const doc = { type: "doc" as const, content: [{ type: "text" as const, text: "<b>not bold</b> &amp; x" }] };
    expect(docToMarkup(doc)).toBe("&lt;b>not bold&lt;/b> &amp;amp; x");
    expect(markupToDoc(docToMarkup(doc)).content?.[0]).toEqual({ type: "text", text: "<b>not bold</b> &amp; x" });
  });

  it("keeps marks open across neighbouring text that shares them", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "text" as const, text: "a", marks: [{ type: "m_strong" as const }] },
        { type: "text" as const, text: "b", marks: [{ type: "m_strong" as const }, { type: "m_span" as const, attrs: { className: "ts-x" } }] },
      ],
    };
    expect(docToMarkup(doc)).toBe('<strong>a</strong><span class="ts-x"><strong>b</strong></span>');
  });
});

describe("withStyleClass", () => {
  it("puts one style on a span's classes and takes it off", () => {
    expect(withStyleClass(null, "ts-glow")).toBe("ts-glow");
    expect(withStyleClass("big ts-old", "ts-glow")).toBe("big ts-glow");
    expect(withStyleClass("ts-glow", null)).toBeNull();
    expect(withStyleClass("big ts-glow", null)).toBe("big");
  });
});
