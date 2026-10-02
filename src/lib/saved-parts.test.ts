import { describe, expect, it } from "vitest";

import type { PageBlock, PageColumn, PageRow } from "./page-content";
import { parseSavedPart, savedPartInput } from "./saved-parts";

/**
 * A picture's own size (D151) in the parts saved to use again: the schema `savedPartInput` is non-strict, so a key it does not
 * know is dropped without a word. These hold that a width and a position survive being saved and read back, of every kind.
 */

const align = { mobile: "center", desktop: "right" } as const;
const picture = { url: "https://cdn.example.com/cup.webp", width: 800, height: 600, alt: "A cup" };
const kept = { maxWidth: 300, align: { mobile: "center", desktop: "right" }, shape: "circle", caption: "Our cup" };

const block = (): PageBlock => ({ id: "img1", type: "image", image: picture, caption: "Our cup", shape: "circle", maxWidth: 300, align: { ...align } });
const column = (): PageColumn => ({ id: "col1", blocks: [block()] });
const row = (): PageRow => ({ id: "row1", type: "row", layout: "1", columns: [column()] });

/** The picture block inside a block, a column or a row. */
const imageIn = (content: unknown): unknown => {
  const found = content as { type?: string; blocks?: unknown[]; columns?: { blocks: unknown[] }[] };
  if (found.type === "image") return found;
  if (found.blocks) return found.blocks[0];
  return found.columns?.[0].blocks[0];
};

describe("saving a part with a sized picture (D151)", () => {
  const inputs = [
    ["block", block()],
    ["column", column()],
    ["row", row()],
    ["page", { pageType: "page", rows: [row()], css: "" }],
  ] as const;

  it.each(inputs)("keeps a %s's picture width and position through the schema the builder and the server share", (kind, content) => {
    const parsed = savedPartInput.safeParse({ kind, name: "A cup", content });
    expect(parsed.error?.issues).toBeUndefined();
    const part = parsed.data!;
    expect(part.kind).toBe(kind);
    const found = kind === "page" ? imageIn((part.content as { rows: PageRow[] }).rows[0]) : imageIn(part.content);
    expect(found).toMatchObject(kept);
  });

  it("keeps a picture with no width and no position as it was, with neither key added", () => {
    const plain = { id: "img2", type: "image", image: picture, caption: "" } as PageBlock;
    const parsed = savedPartInput.parse({ kind: "block", name: "A cup", content: plain });
    expect(parsed.content).not.toHaveProperty("maxWidth");
    expect(parsed.content).not.toHaveProperty("align");
  });

  it("refuses a width the page itself would refuse, with the page's words", () => {
    for (const [maxWidth, message] of [
      [15, "Make a picture at least 16 pixels wide."],
      [10_001, "Keep a picture at most 10000 pixels wide."],
      [2.5, "A picture's width is whole pixels."],
    ] as const) {
      const parsed = savedPartInput.safeParse({ kind: "block", name: "A cup", content: { ...block(), maxWidth } });
      expect(parsed.success, String(maxWidth)).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message), String(maxWidth)).toContain(message);
    }
  });

  it("is read back from what was stored, so the library and the templates offer the picture as it was saved", () => {
    for (const [kind, content] of inputs) {
      const stored = JSON.parse(JSON.stringify(content));
      const part = parseSavedPart({ id: "p1", kind, name: "A cup", content: stored, updatedAt: "2026-10-02T10:00:00Z" });
      expect(part, kind).not.toBeNull();
      const found = kind === "page" ? imageIn((part!.content as { rows: PageRow[] }).rows[0]) : imageIn(part!.content);
      expect(found, kind).toMatchObject(kept);
    }
  });
});
