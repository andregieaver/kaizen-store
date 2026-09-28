import { describe, expect, it } from "vitest";

import { cleanRichText, richTextPlain } from "./page-content";
import { textToRichText } from "./simple-rich-text";

describe("the AI's text as rich text", () => {
  it("reads paragraphs, lists, bold and allowed links, and nothing else as markup", () => {
    const doc = textToRichText(
      "Vi brenner kaffe **hver uke**.\nI Bergen.\n\n- Lys brent\n- Mørk brent\n\n1. Bestill\n2. Hent\n\nSe [sortimentet](/s/demo/no/products) og [andre](https://evil.example).\n\n<script>alert(1)</script>",
      (href) => href.startsWith("/s/demo/"),
    );
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "bulletList", "orderedList", "paragraph", "paragraph"]);
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Vi brenner kaffe " },
        { type: "text", text: "hver uke", marks: [{ type: "bold" }] },
        { type: "text", text: ". I Bergen." },
      ],
    });
    expect(doc.content[3]).toMatchObject({
      content: [
        { text: "Se " },
        { text: "sortimentet", marks: [{ type: "link", attrs: { href: "/s/demo/no/products" } }] },
        { text: " og " },
        { text: "andre" },
        { text: "." },
      ],
    });
    // Markup it does not know is kept as words, and the whole passes the page's own check.
    expect(richTextPlain(doc)).toContain("<script>alert(1)</script>");
    expect(cleanRichText(doc)).toEqual({ ok: true, doc });
  });

  it("gives an empty document for no words", () => {
    expect(textToRichText("  \n\n ")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});
