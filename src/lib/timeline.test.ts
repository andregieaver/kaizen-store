import { describe, expect, it } from "vitest";

import { blockOwnContent, blockText, newPageContent, pageInput, type IconListBlock, type PageBlock, type PageContent, type TimelineBlock } from "./page-content";
import { newBlock } from "./page-rows";
import { mapBlockTexts } from "./page-translation";

/** A timeline (D414) and the icon list's descriptions (D414). */

const page = (b: PageBlock): PageContent => ({ ...newPageContent(), title: "Historie", slug: "historie", rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [b] }] }] });
const keys = (b: PageBlock) => {
  const out: string[] = [];
  mapBlockTexts(b, (key, value) => (out.push(key), value));
  return out;
};
const timeline = (items: TimelineBlock["items"], extra: Partial<TimelineBlock> = {}): TimelineBlock => ({ id: "tl", type: "timeline", items, ...extra });

describe("a timeline", () => {
  it("starts with three events to write in, and is saved with dates, titles, words, icons, a layout and a colour", () => {
    const fresh = newBlock("timeline", (() => { let n = 0; return () => `n${++n}`; })()) as TimelineBlock;
    expect(fresh.items).toHaveLength(3);
    expect(fresh.items[0]).toEqual({ id: "n2", date: "", title: "", text: "" });
    const full = timeline(
      [
        { id: "a", date: "1998", title: "Founded", text: "In a garage.", icon: "house" },
        { id: "b", date: "Spring 2024", title: "Second shop", text: "" },
      ],
      { layout: "alternate", markerColor: "#ff0000" },
    );
    expect(pageInput.safeParse(page(full)).success).toBe(true);
  });

  it("refuses a date, title or text too long, an icon it does not know and two events with one id", () => {
    expect(pageInput.safeParse(page(timeline([{ id: "a", date: "x".repeat(61), title: "T", text: "" }]))).success).toBe(false);
    expect(pageInput.safeParse(page(timeline([{ id: "a", date: "", title: "x".repeat(201), text: "" }]))).success).toBe(false);
    expect(pageInput.safeParse(page(timeline([{ id: "a", date: "", title: "T", text: "x".repeat(1001) }]))).success).toBe(false);
    expect(pageInput.safeParse(page(timeline([{ id: "a", date: "", title: "T", text: "", icon: "unicorn" as never }]))).success).toBe(false);
    const twice = { id: "a", date: "", title: "T", text: "" };
    expect(pageInput.safeParse(page(timeline([twice, twice]))).success).toBe(false);
  });

  it("shows once an event has a title or words, and gives its words to the excerpt", () => {
    expect(blockOwnContent(timeline([{ id: "a", date: "1998", title: "", text: "" }]))).toBe(false);
    expect(blockOwnContent(timeline([{ id: "a", date: "", title: "", text: "Words" }]))).toBe(true);
    expect(blockText(timeline([{ id: "a", date: "1998", title: "Founded", text: "In a garage." }, { id: "b", date: "2000", title: "", text: "" }]))).toBe("1998 Founded In a garage.");
  });

  it("translates each event's date, title and words by its id", () => {
    expect(keys(timeline([{ id: "a", date: "1998", title: "Founded", text: "In a garage." }]))).toEqual(["block.tl.a.date", "block.tl.a.title", "block.tl.a.text"]);
  });
});

describe("an icon list's descriptions", () => {
  const list = (description?: string): IconListBlock => ({ id: "il", type: "iconList", items: [{ id: "l", icon: "check", text: "Free delivery", href: "", ...(description !== undefined && { description }) }] });

  it("are optional, kept when written and dropped when empty", () => {
    const saved = pageInput.safeParse(page(list("  Orders before 14:00 leave the same day.  ")));
    expect(saved.success && (saved.data.rows[0].columns[0].blocks[0] as IconListBlock).items[0].description).toBe("Orders before 14:00 leave the same day.");
    const empty = pageInput.safeParse(page(list("   ")));
    expect(empty.success && "description" in (empty.data.rows[0].columns[0].blocks[0] as IconListBlock).items[0] ? (empty.data.rows[0].columns[0].blocks[0] as IconListBlock).items[0].description : undefined).toBeUndefined();
    expect(pageInput.safeParse(page(list("x".repeat(501)))).success).toBe(false);
  });

  it("are translated only where written, and read in the excerpt", () => {
    expect(keys(list())).toEqual(["block.il.l.text"]);
    expect(keys(list("Same day."))).toEqual(["block.il.l.text", "block.il.l.description"]);
    expect(blockText(list("Same day."))).toBe("Free delivery Same day.");
  });
});
