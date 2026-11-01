import { describe, expect, it } from "vitest";

import { pageIssues } from "./page-a11y";
import {
  beforeAfterDisplaySize,
  blockOwnContent,
  blockText,
  hasPictureBox,
  newPageContent,
  pageInput,
  type BeforeAfterBlock,
  type PageBlock,
  type PageContent,
} from "./page-content";
import { pageImageUrls, withSmallCopies } from "./page-images";
import { newBlock } from "./page-rows";
import { mapBlockTexts } from "./page-translation";
import { blockStyle } from "./part-css";
import { mapTemplateMedia } from "./template-content";

/** Before and after (D413): two pictures over each other and a slider between them. */

const picture = (name: string, width = 1200, height = 800, alt = `The ${name}`) => ({ url: `https://cdn.example.com/${name}.webp`, width, height, alt });
const block = (extra: Partial<BeforeAfterBlock> = {}): BeforeAfterBlock => ({ id: "ba", type: "beforeAfter", before: picture("before"), after: picture("after"), ...extra });
const page = (b: PageBlock): PageContent => ({ ...newPageContent(), title: "Kjøkken", slug: "kjokken", rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [b] }] }] });

describe("a Before and after", () => {
  it("starts with no pictures, and is saved with both, the words and the slider's start", () => {
    expect(newBlock("beforeAfter", () => "n")).toEqual({ id: "n", type: "beforeAfter", before: null, after: null });
    expect(pageInput.safeParse(page(block({ beforeLabel: "Old", afterLabel: "New", start: 30, shape: "square", maxWidth: 600 }))).success).toBe(true);
    expect(pageInput.safeParse(page(block({ before: null }))).success).toBe(true);
  });

  it("refuses a start outside the picture, words too long and a picture that is not a web address", () => {
    expect(pageInput.safeParse(page(block({ start: 101 }))).success).toBe(false);
    expect(pageInput.safeParse(page(block({ beforeLabel: "x".repeat(41) }))).success).toBe(false);
    expect(pageInput.safeParse(page(block({ after: { ...picture("after"), url: "javascript:alert(1)" } }))).success).toBe(false);
  });

  it("shows on the site only with both pictures, and its words for the excerpt are their descriptions", () => {
    expect(blockOwnContent(block())).toBe(true);
    expect(blockOwnContent(block({ after: null }))).toBe(false);
    expect(blockOwnContent(block({ before: null }))).toBe(false);
    expect(blockText(block())).toBe("The before The after");
  });

  it("is drawn at the before picture's size or its crop, never larger, no wider than set", () => {
    expect(beforeAfterDisplaySize(block())).toEqual({ width: 1200, height: 800 });
    expect(beforeAfterDisplaySize(block({ shape: "square" }))).toEqual({ width: 800, height: 800 });
    expect(beforeAfterDisplaySize(block({ maxWidth: 600 }))).toEqual({ width: 600, height: 400 });
    expect(beforeAfterDisplaySize(block({ before: null }))).toBeNull();
    // Its box hugs the picture, as a picture's does (D151).
    expect(hasPictureBox(block())).toBe(true);
    expect(hasPictureBox(block({ before: null }))).toBe(false);
    expect(JSON.stringify(blockStyle(block({ maxWidth: 600 }), "site"))).toContain("--picture-width");
  });

  it("translates each picture's description, and its words only where the owner wrote them", () => {
    const keys = (b: BeforeAfterBlock) => {
      const out: string[] = [];
      mapBlockTexts(b, (key, value) => (out.push(key), value));
      return out;
    };
    expect(keys(block())).toEqual(["block.ba.beforeAlt", "block.ba.afterAlt"]);
    expect(keys(block({ beforeLabel: "Old", afterLabel: "New" }))).toEqual(["block.ba.beforeAlt", "block.ba.afterAlt", "block.ba.beforeLabel", "block.ba.afterLabel"]);
    const norsk = mapBlockTexts(block({ beforeLabel: "Old" }), (key, value) => (key.endsWith("beforeLabel") ? "Gammel" : value)) as BeforeAfterBlock;
    expect(norsk.beforeLabel).toBe("Gammel");
    expect(norsk.afterLabel).toBeUndefined();
  });

  it("gives its pictures to the image sitemap and the library's descriptions, and takes the library's small copies", () => {
    const content = page(block());
    expect(pageImageUrls(content)).toEqual([picture("before").url, picture("after").url]);
    const small = withSmallCopies(content, (url) => url.replace(".webp", "-480.webp"));
    const shown = small.rows[0].columns[0].blocks[0] as BeforeAfterBlock;
    expect(shown.before?.small).toBe("https://cdn.example.com/before-480.webp");
    expect(shown.after?.small).toBe("https://cdn.example.com/after-480.webp");
  });

  it("asks for a description of each picture in the page check", () => {
    const issues = pageIssues(page(block({ after: picture("after", 1200, 800, "") })));
    expect(issues.filter((i) => i.rule === "image_alt")).toHaveLength(1);
    expect(pageIssues(page(block())).filter((i) => i.rule === "image_alt")).toEqual([]);
  });

  it("brings both pictures along when used as a template in another store, and drops one that cannot come", () => {
    const moved = mapTemplateMedia("block", block(), (url) => (url.includes("after") ? null : url.replace("cdn.example.com", "own.example.com"))) as BeforeAfterBlock;
    expect(moved.before?.url).toBe("https://own.example.com/before.webp");
    expect(moved.after).toBeNull();
  });
});
