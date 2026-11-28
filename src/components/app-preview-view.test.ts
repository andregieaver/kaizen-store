import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { appPreviewWords, pageBlockSchema, type AppPreviewBlock, type PreviewPart } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";
import { mapBlockTexts } from "@/lib/page-translation";

import { AppPreviewView } from "./app-preview-view";

/**
 * The app preview (D916): a window or a card drawn from parts in the theme's colours, its words the page's own (translated with it), empty
 * lines drawn as soft bars, and the content's rules.
 */

let n = 0;
const id = () => `id${++n}`;
const block = (parts: PreviewPart[], patch: Partial<AppPreviewBlock> = {}): AppPreviewBlock => ({
  id: "b",
  type: "appPreview",
  frame: "window",
  bar: "kaizenalife.com/app/today",
  sideTitle: "",
  side: [],
  parts,
  alt: "",
  ...patch,
});
const draw = (b: AppPreviewBlock) => renderToString(createElement(AppPreviewView, { block: b }));

describe("an app preview on the site (D916)", () => {
  it("draws a window with its three dots and its address, and its parts' words", () => {
    const html = draw(
      block([
        { id: "t", kind: "title", title: "Today", aside: "8/12", asidePill: true, asideTone: "accent" },
        { id: "c", kind: "checklist", title: "Due today", mark: "tick", items: [{ id: "a", text: "Call the dentist", done: true }, { id: "b", text: "Review Q3 budget", done: false }] },
      ]),
    );
    expect(html).toContain("#ff5f57");
    expect(html).toContain("kaizenalife.com/app/today");
    expect(html).toContain("Today");
    expect(html).toContain("8/12");
    expect(html).toContain("Due today");
    expect(html).toMatch(/line-through[^>]*>Call the dentist/);
    expect(html).toContain("Review Q3 budget");
  });

  it("draws a plain card without the window's bar, and a sidebar with the first item chosen", () => {
    const html = draw(block([{ id: "p", kind: "progress", value: 66 }], { frame: "card", sideTitle: "Kaizena Life", side: [{ id: "s1", text: "Today" }, { id: "s2", text: "Tasks" }] }));
    expect(html).not.toContain("#ff5f57");
    expect(html).not.toContain("kaizenalife.com/app/today");
    expect(html).toContain("Kaizena Life");
    expect(html).toMatch(/font-medium text-accent[^>]*>Today/);
    expect(html).toContain("width:66%");
  });

  it("draws bars at their heights, the last ones lighter as a forecast, and paired bars", () => {
    const bars = draw(block([{ id: "b", kind: "bars", title: "Cash-flow", aside: "On track", asideTone: "success", values: [55, 80, 40], soft: 1, captionStart: "This month", captionEnd: "Forecast" }]));
    expect(bars).toContain("height:55%");
    expect(bars).toContain("height:80%");
    expect(bars.match(/38%, transparent\)/g)).toHaveLength(1);
    expect(bars).toContain("#22a04b");
    expect(bars).toMatch(/This month[\s\S]*Forecast/);
    const pairs = draw(block([{ id: "p", kind: "pairs", title: "Training", legendFirst: "Planned", legendSecond: "Done", values: [[70, 60], [85, 90]], caption: "Block 2" }]));
    expect(pairs).toContain("height:70%");
    expect(pairs).toContain("height:90%");
    expect(pairs).toMatch(/Planned[\s\S]*Done/);
  });

  it("draws a chat, rings with their figures, a calendar, a board and status rows", () => {
    const html = draw(
      block([
        { id: "c", kind: "chat", title: "Assistant", messages: [{ id: "m1", text: "Plan my week", mine: true }, { id: "m2", text: "Done", mine: false }] },
        { id: "r", kind: "rings", items: [{ id: "r1", text: "Sleep", value: 72 }] },
        { id: "h", kind: "heatmap", weeks: 4, on: [2, 5] },
        { id: "k", kind: "kanban", columns: [{ id: "k1", cards: [{ id: "k1a", text: "Pitch deck" }] }, { id: "k2", cards: [] }] },
        { id: "w", kind: "rows", title: "Invoices", items: [{ id: "w1", text: "Acme AS", tone: "warning" }] },
      ]),
    );
    expect(html).toMatch(/ml-auto[^>]*>Plan my week/);
    expect(html).toContain("72%");
    expect(html).toContain("conic-gradient(var(--accent) 72%");
    expect(html.match(/aspect-square/g)).toHaveLength(28);
    expect(html).toContain("Pitch deck");
    expect(html).toContain("repeat(2, minmax(0, 1fr))");
    expect(html).toContain("Acme AS");
    expect(html).toContain("#e07b00");
  });

  it("draws an empty line as a soft bar, puts half parts side by side, and tells a screen reader the description", () => {
    const html = draw(
      block(
        [
          { id: "a", kind: "briefing", title: "", lines: 2, boxed: true, half: true },
          { id: "b", kind: "title", title: "Wide", aside: "" },
        ],
        { alt: "The app's Today screen" },
      ),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="The app&#x27;s Today screen"');
    expect(html).toMatch(/class="min-w-0  rounded-md border/);
    expect(html).toContain("sm:col-span-2");
    expect(html).toContain('aria-hidden="true" class="inline-block h-2.5 rounded-full');
  });

  it("draws nothing without parts", () => {
    expect(draw(block([]))).toBe("");
  });
});

describe("the app preview's content (D916)", () => {
  it("is made as a window with a title, a briefing, a checklist and a chart, and holds to its rules", () => {
    const made = newBlock("appPreview", id) as AppPreviewBlock;
    expect(made.parts.map((part) => part.kind)).toEqual(["title", "briefing", "checklist", "bars"]);
    expect(pageBlockSchema.safeParse(made).success).toBe(true);
    const bars = made.parts[3];
    expect(pageBlockSchema.safeParse({ ...made, parts: [{ ...bars, values: [120] }] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...made, parts: [{ ...bars, values: [] }] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...made, parts: [{ id: "h", kind: "heatmap", weeks: 6, on: [] }] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...made, parts: [made.parts[0], { ...made.parts[1], id: made.parts[0].id }] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...made, parts: [{ id: "x", kind: "video" }] }).success).toBe(false);
  });

  it("translates every word it draws, by its part and its line, and lists them for the page's words", () => {
    const b = block(
      [
        { id: "t", kind: "title", title: "Today", aside: "" },
        { id: "c", kind: "checklist", title: "", items: [{ id: "a", text: "Call the dentist", done: false }] },
        { id: "k", kind: "kanban", columns: [{ id: "k1", cards: [{ id: "k1a", text: "Pitch deck" }] }] },
      ],
      { side: [{ id: "s1", text: "Tasks" }] },
    );
    const keys: string[] = [];
    const translated = mapBlockTexts(b, (key, value) => {
      keys.push(key);
      return typeof value === "string" && value ? `nb:${value}` : value;
    }) as AppPreviewBlock;
    expect(keys).toEqual(expect.arrayContaining(["block.b.bar", "block.b.side.s1", "block.b.t.title", "block.b.c.a", "block.b.k.k1.k1a", "block.b.alt"]));
    expect(translated.parts[1]).toMatchObject({ items: [{ id: "a", text: "nb:Call the dentist", done: false }] });
    expect(appPreviewWords(b)).toEqual(["kaizenalife.com/app/today", "Tasks", "Today", "Call the dentist", "Pitch deck"]);
  });
});
