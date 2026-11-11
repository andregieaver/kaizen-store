import { describe, expect, it } from "vitest";

import { greenClaimsIn, textOfContent } from "./green-claims";

describe("environmental claims in a store's own words (D552)", () => {
  it("finds generic claims and offsetting claims, with the words around them", () => {
    const found = greenClaimsIn("Koppen er laget av resirkulert leire og er helt miljøvennlig. Frakten er klimakompensert.");
    expect(found.map((f) => [f.phrase, f.offset])).toEqual([
      ["miljøvennlig", false],
      ["klimakompensert", true],
    ]);
    expect(found[0].excerpt).toContain("resirkulert leire");
    expect(greenClaimsIn("A carbon-neutral delivery, CO2-offset by our partner.").map((f) => f.offset)).toEqual([false, true]);
  });

  it("leaves specific facts and vegetables alone", () => {
    expect(greenClaimsIn("Laget av 80 % resirkulert plast. Grønnsaker fra Hedmark.")).toEqual([]);
    expect(greenClaimsIn("")).toEqual([]);
  });

  it("reads the words of a page's rows, blocks and rich text, not its ids, addresses or styles", () => {
    const content = {
      title: "Om oss",
      rows: [{ id: "row-sustainable", type: "row", columns: [{ blocks: [
        { id: "h", type: "heading", text: "Bærekraftige kopper" },
        { id: "t", type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Vi er stolte." }] }] } },
        { id: "i", type: "image", src: "https://example.com/eco-friendly.png", alt: "En kopp" },
      ] }] }],
    };
    const text = textOfContent(content);
    expect(text).toContain("Bærekraftige kopper");
    expect(text).toContain("Vi er stolte.");
    expect(text).not.toContain("row-sustainable");
    expect(text).not.toContain("eco-friendly.png");
    expect(greenClaimsIn(text).map((f) => f.phrase)).toEqual(["Bærekraftige"]);
  });
});
