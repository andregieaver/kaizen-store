import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ShownField } from "@/lib/custom-fields";
import type { FieldDisplay } from "@/lib/page-content";

import { CustomFieldsList, CustomFieldView } from "./custom-fields-view";

/** Flexible content and money as the site draws them: by the same code as any other value, in every display. */

const shown = (over: Partial<ShownField> & Pick<ShownField, "id" | "type">): ShownField => ({
  name: over.id,
  label: over.id,
  value: "",
  text: "",
  ...over,
});
const text = (id: string, value: string, label = id): ShownField =>
  shown({ id, label, type: "text", value, text: value });
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich words" }] }] };
const richText = shown({ id: "story", label: "Story", type: "richText", value: doc as never, text: "Rich words" });
const picture = shown({
  id: "photo",
  label: "Photo",
  type: "image",
  value: { url: "https://cdn.example.com/a.webp", thumbnailUrl: null, alt: "A chair" } as never,
});
const stars = shown({ id: "stars", label: "Stars", type: "number", value: 5, text: "5" });
const money = shown({
  id: "deposit",
  label: "Deposit",
  type: "money",
  value: { amountMinor: 1250, currency: "EUR" } as never,
  text: "12,50 €",
});

const flexible = shown({
  id: "content",
  label: "Content",
  type: "flexible",
  blocks: [
    { layout: "text", label: "Text block", fields: [text("heading", "Made by hand"), richText] },
    { layout: "picture", label: "Picture with caption", fields: [picture, text("caption", "A chair")] },
    { layout: "quote", label: "Quote", fields: [text("quote", "Less is more"), stars] },
  ],
});

const displays: FieldDisplay[] = ["table", "list", "cards"];
const html = (fields: ShownField[], display: FieldDisplay = "table", showLabel = true) =>
  renderToString(createElement(CustomFieldsList, { fields, display, showLabel })).replace(/<!-- -->/g, "");

describe("flexible content drawn on the site (D120)", () => {
  it.each(displays)("draws each row as a block in order, with its content and no heading, in %s", (display) => {
    const out = html([flexible], display);
    expect(out.indexOf("Made by hand")).toBeLessThan(out.indexOf("A chair"));
    expect(out.indexOf("A chair")).toBeLessThan(out.indexOf("Less is more"));
    expect(out).toContain("Rich words");
    expect(out).toContain('src="https://cdn.example.com/a.webp"');
    expect(out).toContain('alt="A chair"');
    // A layout's label is an aria label only, never a heading.
    expect(out).toContain('aria-label="Text block"');
    expect(out).toContain('aria-label="Picture with caption"');
    expect(out).not.toMatch(/<h\d/);
    expect(out).not.toMatch(/>Text block</);
    expect(out).toContain('data-layout="quote"');
  });

  it("draws words, pictures and rich text bare, and keeps the label of a value that does not say what it is", () => {
    const out = html([flexible], "list");
    expect(out).not.toContain("Story");
    expect(out).not.toContain("Photo");
    expect(out).not.toContain("Made by hand:");
    expect(out).toContain("Stars: ");
    expect(out).toContain("5");
  });

  it("puts each row in a card in the cards display only", () => {
    expect(html([flexible], "cards")).toContain("rounded-lg border border-border p-4");
    expect(html([flexible], "table")).not.toContain("rounded-lg border border-border p-4");
  });

  it("gives the field's label once above the rows, in the table display", () => {
    const out = html([flexible], "table");
    expect(out.match(/Content/g)).toHaveLength(1);
    expect(html([flexible], "table", false)).not.toContain("Content");
  });

  it("draws nothing for rows with nothing to show, and leaves such a field out with its label", () => {
    const empty = shown({
      id: "content",
      label: "Content",
      type: "flexible",
      blocks: [{ layout: "text", label: "Text", fields: [text("heading", "  ")] }],
    });
    expect(html([empty])).toBe("");
    expect(html([shown({ id: "content", label: "Content", type: "flexible" })])).toBe("");
    // A block with something drawable stays, one without goes.
    const some = shown({
      id: "content",
      label: "Content",
      type: "flexible",
      blocks: [
        { layout: "text", label: "Text", fields: [text("heading", "")] },
        { layout: "text", label: "Text", fields: [text("heading", "Kept")] },
      ],
    });
    const out = html([some]);
    expect(out).toContain("Kept");
    expect(out.match(/<li/g)).toHaveLength(1);
  });

  it("draws by a view of its own too, with a heading only when the owner wrote one", () => {
    const view = renderToString(
      createElement(CustomFieldView, { field: flexible, heading: "More to read", id: "h", showLabel: false }),
    );
    expect(view).toContain("More to read");
    expect(view).toContain("Less is more");
    expect(view).not.toContain("Content");
  });
});

describe("money drawn on the site (D120)", () => {
  it.each(displays)("draws the amount as it was worded for the market, with no VAT label, in %s", (display) => {
    const out = html([money], display);
    expect(out).toContain("Deposit");
    expect(out).toContain("12,50");
    expect(out).not.toMatch(/vat|mva|moms/i);
  });

  it("draws nothing for an amount that could not be worded", () => {
    expect(html([{ ...money, text: "" }])).toBe("");
  });

  it("is drawn inline in a list, with its label, and inside a flexible row", () => {
    expect(html([money], "list")).toContain("Deposit: ");
    const inRow = shown({
      id: "content",
      label: "Content",
      type: "flexible",
      blocks: [{ layout: "price", label: "Price", fields: [money] }],
    });
    expect(html([inRow], "list")).toContain("Deposit: ");
  });
});
