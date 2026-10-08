import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContentGridView } from "@/components/content-grid";
import { customGridData } from "@/lib/custom-grid";
import { CUSTOM_ITEMS_MAX, pageInput, newPageContent, type ContentGridBlock, type PageBlock, type PageRow } from "./page-content";
import { buildReplica, type BuildInput } from "./replicate-build";
import type { Box, CaptureNode, PageCapture, Run } from "./replicate-capture";
import { COLUMNS_MARGIN, columnsBeatGrid, cutOnWord, gridLines, isPriceText, loopedEnds, parseDate, stretchesOf, tokensOf, weakGrids } from "./replicate-grid";
import { renderStyles, suffixOk } from "./replicate-styles";
import { runsText } from "./replicate-capture";
import { columnsView } from "./responsive";

/** A grid's columns by screen, as the builder shows them (D179: computers' at Extra large, the smaller sizes' overrides). */
const screens = (grid: { columns: number; at?: ContentGridBlock["at"] }) => columnsView(grid, { mobile: 0, tablet: 0, desktop: 0 });

/**
 * Repeated cards become one grid of custom items (D155, C), from captured trees and no browser: a static grid, a native scroller with
 * arrows, cards with a badge, a price and a date; and what is refused (a second button, cards of different heights, a footer's columns)
 * and stays as columns with its reason. The rule under all of it: no word in an item that is not in the card, no word of a card lost.
 */

let counter = 0;
const newId = () => `id-${++counter}`;
let seq = 0;
type Spec = Partial<CaptureNode> & { tag: string; box: Box };
const node = (spec: Spec, children: CaptureNode[] = []): CaptureNode => ({ p: spec.p ?? `n${++seq}`, s: { display: "block" }, children, ...spec });
const text = (tag: string, box: Box, t: string, s: Record<string, string> = {}, extra: Partial<CaptureNode> = {}): CaptureNode =>
  node({ tag, box, s: { display: "block", fontSize: "16px", lineHeight: "24px", fontWeight: "400", color: "rgb(30, 30, 30)", fontFamily: "Inter, sans-serif", textAlign: "left", ...s }, runs: [{ t }] as Run[], ...extra });
const capture = (root: CaptureNode, width = 1440): PageCapture => ({
  viewport: { w: width, h: 900 },
  url: "https://source.test/",
  title: "Shop",
  lang: "nb",
  description: "",
  docWidth: width,
  docHeight: 3000,
  background: "rgb(255, 255, 255)",
  root,
  fonts: [],
  left: { fixed: [], hidden: 0, capped: false },
});
const library = (name: string) => `https://files.test/storage/v1/object/public/media/${name}`;
const input = (desktop: PageCapture, mobile: PageCapture | null = null, extra: Partial<BuildInput> = {}): BuildInput => ({
  desktop,
  mobile,
  picture: (url) => ({ url: library(url.split("/").pop() ?? "x"), width: 800, height: 600 }),
  shot: () => null,
  video: () => null,
  font: (family) => (family === "Inter" ? "Inter" : null),
  ...extra,
});
const page = (...children: CaptureNode[]) => node({ p: "", tag: "body", box: [0, 0, 1440, 3000], s: { display: "block" } }, children);
const blocksOf = (rows: PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
const gridsOf = (rows: PageRow[]) => blocksOf(rows).filter((b): b is ContentGridBlock => b.type === "contentGrid");

// -- a card, as a shop draws one --------------------------------------------------------------------------------------

type CardOpts = {
  title?: string;
  text?: string;
  badge?: string;
  price?: string;
  date?: string;
  detail?: string;
  button?: string | null;
  second?: string;
  picture?: boolean;
  href?: string;
  height?: number;
};

/** A card at `x`, `y` with `w` width: a painted box, its picture to the edges, its words inset. `p` is the card's own path. */
function card(i: number, p: string, [x, y, w]: [number, number, number], o: CardOpts = {}): CaptureNode {
  const height = o.height ?? 420;
  const kids: CaptureNode[] = [];
  let at = y + 1;
  const path = (n: number) => `${p}/${n}`;
  let n = 0;
  if (o.picture !== false) {
    kids.push(node({ p: path(n++), tag: "img", box: [x + 1, at, w - 2, 192], s: { display: "block", objectFit: "cover" }, media: { kind: "img", url: `https://source.test/photo-${i}.jpg`, width: 800, height: 600, alt: `Photo ${i}` } }));
    if (o.badge) kids.push(text("span", [x + 10, y + 10, 52, 22], o.badge, { fontSize: "12px", lineHeight: "22px", backgroundColor: "rgb(220, 38, 38)", color: "rgb(255, 255, 255)", borderTopLeftRadius: "4px" }, { p: path(n++) }));
    at += 192 + 16;
  }
  kids.push(text("h3", [x + 16, at, w - 32, 28], o.title ?? `Title ${i}`, { fontSize: "22px", lineHeight: "28px", fontWeight: "600" }, { p: path(n++) }));
  at += 28 + 8;
  if (o.date) {
    kids.push(text("time", [x + 16, at, w - 32, 20], o.date, { fontSize: "14px", lineHeight: "20px", color: "rgb(110, 110, 110)" }, { p: path(n++) }));
    at += 28;
  }
  kids.push(text("p", [x + 16, at, w - 32, 72], o.text ?? `Words of card ${i} in a few lines.`, { color: "rgb(90, 90, 90)" }, { p: path(n++) }));
  at += 72 + 8;
  if (o.detail) {
    kids.push(text("p", [x + 16, at, w - 32, 20], o.detail, { fontSize: "14px", lineHeight: "20px" }, { p: path(n++) }));
    at += 28;
  }
  if (o.price) {
    kids.push(text("p", [x + 16, at, w - 32, 24], o.price, { fontWeight: "700" }, { p: path(n++) }));
    at += 32;
  }
  if (o.button !== null) {
    const label = o.button ?? "Les mer";
    kids.push(
      text("a", [x + 16, at, 110, 44], label, { color: "rgb(255, 255, 255)", backgroundColor: "rgb(79, 70, 229)", paddingTop: "10px", paddingBottom: "10px", paddingLeft: "16px", paddingRight: "16px", borderTopLeftRadius: "8px", borderTopRightRadius: "8px", borderBottomRightRadius: "8px", borderBottomLeftRadius: "8px", textAlign: "center" }, { p: path(n++), button: true, href: o.href ?? `https://source.test/p/${i}` }),
    );
    at += 52;
  }
  if (o.second) kids.push(text("a", [x + 140, at - 52, 90, 44], o.second, { color: "rgb(79, 70, 229)", textAlign: "center", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "rgb(79, 70, 229)", borderBottomWidth: "1px", borderLeftWidth: "1px", borderRightWidth: "1px" }, { p: path(n++), button: true, href: `https://source.test/q/${i}` }));
  const b = (side: string) => ({ [`border${side}Width`]: "1px", [`border${side}Color`]: "rgb(220, 220, 225)" });
  return node(
    {
      p,
      tag: "div",
      sel: "div.card",
      box: [x, y, w, height],
      s: { display: "block", backgroundColor: "rgb(255, 255, 255)", borderTopStyle: "solid", ...b("Top"), ...b("Right"), ...b("Bottom"), ...b("Left"), borderTopLeftRadius: "12px", borderTopRightRadius: "12px", borderBottomRightRadius: "12px", borderBottomLeftRadius: "12px", boxShadow: "rgba(0, 0, 0, 0.1) 0px 4px 12px 0px", overflowX: "hidden" },
    },
    kids,
  );
}

/** A section with a heading over a row of cards: `perRow` to a row at computers' width. */
function shop(count: number, perRow: number, opts: (i: number) => CardOpts = () => ({}), origin = "0", top = 100): CaptureNode {
  const w = 290;
  const gap = 20;
  const left = 110;
  const rows = Math.ceil(count / perRow);
  const cards = Array.from({ length: count }, (_, i) => card(i, `${origin}/1/${i}`, [left + (i % perRow) * (w + gap), top + 70 + Math.floor(i / perRow) * 440, w], opts(i)));
  return node({ p: origin, tag: "section", box: [0, top, 1440, 70 + rows * 440 + 30], s: { display: "block" } }, [
    text("h2", [110, top + 10, 600, 40], "Our products", { fontSize: "32px", lineHeight: "40px", fontWeight: "700" }, { p: `${origin}/0` }),
    node({ p: `${origin}/1`, tag: "div", sel: "div.cards", box: [left, top + 70, perRow * (w + gap) - gap, rows * 440 - 20], s: { display: "flex", flexWrap: "wrap" } }, cards),
  ]);
}

/** The same cards at a phone's width: one to a row, 358 wide. */
function phoneShop(count: number, opts: (i: number) => CardOpts = () => ({}), origin = "0", top = 100): CaptureNode {
  const cards = Array.from({ length: count }, (_, i) => card(i, `${origin}/1/${i}`, [16, top + 70 + i * 440, 358], opts(i)));
  return node({ p: origin, tag: "section", box: [0, top, 390, 70 + count * 440 + 30], s: { display: "block" } }, [
    text("h2", [16, top + 10, 358, 40], "Our products", { fontSize: "26px", lineHeight: "32px", fontWeight: "700" }, { p: `${origin}/0` }),
    node({ p: `${origin}/1`, tag: "div", sel: "div.cards", box: [16, top + 70, 358, count * 440 - 20], s: { display: "block" } }, cards),
  ]);
}

const phonePage = (...children: CaptureNode[]) => node({ p: "", tag: "body", box: [0, 0, 390, 4000], s: { display: "block" } }, children);

// ---------------------------------------------------------------------------------------------------------------------

describe("a static grid of four cards", () => {
  const build = () => buildReplica(input(capture(page(shop(4, 4))), capture(phonePage(phoneShop(4)), 390)), newId);

  it("becomes one grid block of four custom items, with the heading above it as it was", () => {
    const built = build();
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading", "contentGrid"]);
    const [grid] = gridsOf(built.rows);
    expect(grid.source).toEqual({ type: "custom" });
    expect(grid.items).toHaveLength(4);
    expect(grid.items![0]).toMatchObject({
      title: "Title 0",
      text: "Words of card 0 in a few lines.",
      buttonLabel: "Les mer",
      link: { kind: "url", url: "https://source.test/p/0" },
      picture: { url: library("photo-0.jpg"), width: 800, height: 600, alt: "Photo 0" },
      date: null,
      badge: "",
      priceText: "",
      details: [],
    });
    expect(built.counts).toMatchObject({ grids: 1, items: 4, blocks: 2 });
    expect(built.grids.built).toHaveLength(1);
    expect(built.grids.built[0]).toMatchObject({ cards: 4, items: 4, cut: 0, columns: { desktop: 4, mobile: 1 } });
  });

  it("reads columns and the gap from what was measured, and the tile from the card's painted box", () => {
    const [grid] = gridsOf(build().rows);
    expect(screens(grid).desktop).toBe(4);
    expect(screens(grid).mobile).toBe(1);
    expect(screens(grid).tablet).toBeGreaterThanOrEqual(screens(grid).mobile);
    expect(grid.gap).toBe(20);
    expect(grid.tile).toMatchObject({ background: "#ffffff", radius: 12, shadow: "md", border: { width: { top: 1, right: 1, bottom: 1, left: 1 }, color: "#dcdce1", style: "solid" } });
    expect(grid.headingLevel).toBe(3);
    // The "md" preset as the titles' typography (D179): 1.5rem, 1.25rem on Small.
    expect(grid.typography?.title?.size).toEqual({ value: 1.5, unit: "rem" });
    expect(grid.at?.sm?.typography?.title?.size).toEqual({ value: 1.25, unit: "rem" });
    expect(grid.show).toEqual({ image: true, heading: true, excerpt: true, price: false, button: true });
    expect(grid.button).toMatchObject({ variant: "filled", shape: "rounded", size: "md", fill: "#4f46e5", textColor: "#ffffff" });
    expect(grid.excerptLines).toBeGreaterThanOrEqual(3);
    expect(grid.typography?.text?.family).toBe("Inter");
    expect(grid.display).toBeUndefined();
  });

  it("styles the grid part with rules the AI's patch plan can still change, drawn only on places the grid has", () => {
    const built = build();
    const [grid] = gridsOf(built.rows);
    const rules = built.model.rules.filter((r) => r.id === grid.htmlId);
    expect(rules.length).toBeGreaterThan(3);
    for (const rule of rules) expect(suffixOk(rule.suffix)).toBe(true);
    const title = rules.find((r) => r.suffix === " li[data-item-id] :is(h2,h3,h4,h5,h6)")!;
    expect(title.desktop).toMatchObject({ "font-size": "22px", "line-height": "28px", "font-weight": "600" });
    const image = rules.find((r) => r.suffix === " li[data-item-id] img")!;
    expect(image.desktop).toMatchObject({ width: "100%", "aspect-ratio": "1.5 / 1" });
    // The picture runs to the card's edges with the words inset: the words carry the inset.
    expect(rules.find((r) => r.suffix === " li[data-item-id] > *")!.desktop).toMatchObject({ "margin-left": "15px", "margin-right": "15px" });
    // The converter never sets a picture's own width or place (D150): only its rules do.
    expect(JSON.stringify(grid)).not.toContain("maxWidth");
    const css = renderStyles(built.model, built.shared).css;
    expect(css).toContain(`#${grid.htmlId} li[data-item-id] :is(h2,h3,h4,h5,h6){`);
  });

  it("is the page's own content: the builder's schema accepts it", () => {
    const built = build();
    const parsed = pageInput.safeParse({ ...newPageContent(), title: "Copy", slug: "copy", rows: built.rows, css: renderStyles(built.model, built.shared).css });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
  });

  it("registers the block as a part that can be compared, with the group it came from", () => {
    const built = build();
    const [grid] = gridsOf(built.rows);
    const part = built.parts.find((p) => p.id === grid.htmlId)!;
    expect(part).toMatchObject({ kind: "block", grid: "0/1", label: "grid of 4 custom items" });
    expect(part.target![3]).toBe(420);
    expect(part.targetM).not.toBeNull();
  });

  it("is deterministic: the same capture gives the same rows and the same style model", () => {
    const again = () => {
      counter = 0;
      seq = 0;
      return buildReplica(input(capture(page(shop(4, 4))), capture(phonePage(phoneShop(4)), 390)), newId);
    };
    const a = again();
    const b = again();
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
    expect(JSON.stringify(a.model)).toBe(JSON.stringify(b.model));
    expect(JSON.stringify(a.grids)).toBe(JSON.stringify(b.grids));
  });
});

describe("a wrapped grid", () => {
  it("counts the cards in a row, and keeps the order of the cards as the page has them", () => {
    const built = buildReplica(input(capture(page(shop(6, 3)))), newId);
    const [grid] = gridsOf(built.rows);
    expect(screens(grid).desktop).toBe(3);
    expect(grid.items!.map((i) => i.title)).toEqual(["Title 0", "Title 1", "Title 2", "Title 3", "Title 4", "Title 5"]);
    // Rows' gap is read too: 20px between the rows of cards.
    expect(grid.gap).toBe(20);
  });
});

describe("a grid at computers' width that scrolls sideways on phones only", () => {
  /** The same cards on a phone: one row of tiles 158 wide in a box that scrolls sideways, the third cut by the screen's edge. */
  const phoneTrack = (count: number, scroll = true) => {
    const cards = Array.from({ length: count }, (_, i) => card(i, `0/1/${i}`, [16 + i * 170, 170, 158]));
    return node({ p: "0", tag: "section", box: [0, 100, 390, 520], s: { display: "block" } }, [
      text("h2", [16, 110, 358, 40], "Our products", { fontSize: "26px", lineHeight: "32px" }, { p: "0/0" }),
      node({ p: "0/1", tag: "div", sel: "div.cards", ...(scroll ? { scroll: true as const } : {}), box: [0, 170, 390, 420], s: { display: "flex", ...(scroll ? { overflowX: "auto" } : {}) } }, cards),
    ]);
  };

  it("is a carousel on phones only, with the columns each width showed and no arrows the phone did not have", () => {
    const built = buildReplica(input(capture(page(shop(8, 4))), capture(phonePage(phoneTrack(3)), 390)), newId);
    const [grid] = gridsOf(built.rows);
    // A carousel on phones only (D179: at Small), a grid from Medium up.
    expect(grid.display).toBeUndefined();
    expect(grid.at?.sm?.display).toBe("carousel");
    expect(grid.items).toHaveLength(8);
    expect(screens(grid)).toMatchObject({ desktop: 4, mobile: 2 });
    expect(grid.carousel).toMatchObject({ arrows: false });
    expect(built.grids.built[0].carousel).toMatchObject({ phonesOnly: true, perScreen: { desktop: 4, phone: 2 } });
    expect(pageInput.safeParse({ ...newPageContent(), title: "Copy", slug: "copy", rows: built.rows }).success).toBe(true);
  });

  it("is a plain grid when the phone's row does not scroll, or has fewer than three tiles", () => {
    expect(gridsOf(buildReplica(input(capture(page(shop(8, 4))), capture(phonePage(phoneTrack(3, false)), 390)), newId).rows)[0].display).toBeUndefined();
    expect(gridsOf(buildReplica(input(capture(page(shop(8, 4))), capture(phonePage(phoneTrack(2)), 390)), newId).rows)[0].display).toBeUndefined();
  });

  it("says so in the report's lines", () => {
    const built = buildReplica(input(capture(page(shop(8, 4))), capture(phonePage(phoneTrack(3)), 390)), newId);
    expect(gridLines(built.grids).well[0]).toContain("as a carousel on phones only (2 in view; computers show a grid of 4 to a row, no arrows");
  });
});

describe("a native scroller of six cards with arrows", () => {
  const arrow = (label: string, x: number, p: string) => node({ p, tag: "button", sel: `button.carousel-${label}`, box: [x, 280, 40, 40], s: { display: "flex" } }, [node({ p: `${p}/0`, tag: "svg", box: [x + 10, 290, 20, 20], media: { kind: "svg" } })]);
  const scroller = (opts: { snap?: boolean; arrows?: boolean; dots?: boolean } = {}) => {
    const snap = opts.snap !== false;
    const w = 290;
    const cards = Array.from({ length: 6 }, (_, i) => {
      const c = card(i, `0/1/0/${i}`, [110 + i * (w + 20), 170, w]);
      if (snap) c.s = { ...c.s, scrollSnapAlign: "start" };
      return c;
    });
    // The track shows 3 whole cards and a quarter of the fourth: 1220 wide minus the room of three cards and gaps.
    const track = node({ p: "0/1/0", tag: "div", sel: "div.track", scroll: true, box: [110, 170, 1000, 420], s: { display: "flex", overflowX: "auto", ...(snap ? { scrollSnapType: "x mandatory" } : {}) } }, cards.filter((c) => c.box[0] < 1200 + 400 || true));
    const around: CaptureNode[] = [];
    if (opts.arrows !== false) around.push(arrow("prev", 60, "0/1/1"), arrow("next", 1130, "0/1/2"));
    if (opts.dots) around.push(node({ p: "0/1/3", tag: "div", box: [560, 610, 100, 12], s: { display: "flex" } }, [0, 1].map((i) => node({ p: `0/1/3/${i}`, tag: "button", box: [560 + i * 20, 610, 10, 10], s: { display: "block" } }))));
    return node({ p: "0", tag: "section", box: [0, 100, 1440, 560], s: { display: "block" } }, [
      text("h2", [110, 110, 600, 40], "Popular", { fontSize: "32px", lineHeight: "40px" }, { p: "0/0" }),
      node({ p: "0/1", tag: "div", sel: "div.wrap", box: [60, 170, 1110, 420], s: { display: "block", position: "relative" } }, [track, ...around]),
    ]);
  };

  it("is a carousel with the arrows it had and the snap it had", () => {
    const built = buildReplica(input(capture(page(scroller()))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.display).toBe("carousel");
    expect(grid.items).toHaveLength(6);
    // Arrows are the default: they are said only when absent. Snap "start" is the default too.
    expect(grid.carousel).toBeUndefined();
    expect(screens(grid).desktop).toBe(3);
    expect(built.grids.built[0].carousel).toMatchObject({ arrows: true, dots: false, snap: "start", autoplay: "not observed", clones: 0 });
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading", "contentGrid"]);
  });

  it("says no arrows and free scrolling when the page has none", () => {
    const built = buildReplica(input(capture(page(scroller({ snap: false, arrows: false })))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.display).toBe("carousel");
    expect(grid.carousel).toEqual({ arrows: false, snap: "none" });
  });

  it("reads dots when a row of small buttons equals the number of pages", () => {
    const built = buildReplica(input(capture(page(scroller({ dots: true })))), newId);
    expect(gridsOf(built.rows)[0].carousel).toEqual({ dots: true });
  });

  it("reads centre snapping off the tiles", () => {
    const tree = scroller();
    for (const n of [...tree.children[1].children[0].children]) n.s = { ...n.s, scrollSnapAlign: "center" };
    expect(gridsOf(buildReplica(input(capture(page(tree))), newId).rows)[0].carousel).toEqual({ snap: "center" });
  });

  it("says what it read in the report's facts, and that autoplay was not observed", () => {
    const built = buildReplica(input(capture(page(scroller()))), newId);
    const lines = gridLines(built.grids);
    expect(lines.well[0]).toContain("6 repeated cards");
    expect(lines.well[0]).toContain("as a carousel");
    expect(lines.well[0]).toContain("autoplay not observed");
  });
});

describe("cards with a badge, a price and a date", () => {
  const rich = (i: number): CardOpts => ({ badge: "Nytt", price: `${199 + i * 100} kr`, date: `1${i}. mars 2024`, detail: "Varighet: 2 timer" });

  it("puts each in its own field: badge over the picture, price as text, date as a day, a label and value as a detail", () => {
    const built = buildReplica(input(capture(page(shop(3, 3, rich)))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.items![1]).toMatchObject({ badge: "Nytt", priceText: "299 kr", date: "2024-03-11", details: [{ label: "Varighet", text: "2 timer" }], title: "Title 1" });
    expect(grid.items![1].details[0].id).toBeTruthy();
    expect(grid.show.price).toBe(true);
    // The price is words: nothing in the item is a number to charge.
    expect(JSON.stringify(grid.items![0])).not.toMatch(/"price"/);
    const rules = built.model.rules.filter((r) => r.id === grid.htmlId).map((r) => r.suffix);
    expect(rules).toContain(" li[data-item-id] p.font-medium");
    expect(rules).toContain(" li[data-item-id] time");
    expect(rules).toContain(" li[data-item-id] span.bg-accent");
  });

  it("is a price only by pattern, and a date only by one", () => {
    for (const price of ["199 kr", "kr 1 299,-", "$19.99", "NOK 450", "199,-", "Fra 89 kr", "€ 12"]) expect(isPriceText(price), price).toBe(true);
    for (const not of ["Gratis", "4 stjerner", "2 timer", "Free shipping", "12 mars 2024", ""]) expect(isPriceText(not), not).toBe(false);
    expect(parseDate("2024-03-12")).toBe("2024-03-12");
    expect(parseDate("12. mars 2024")).toBe("2024-03-12");
    expect(parseDate("12 March 2024")).toBe("2024-03-12");
    expect(parseDate("March 12, 2024")).toBe("2024-03-12");
    expect(parseDate("tirsdag 12. mars 2024")).toBe("2024-03-12");
    expect(parseDate("12.03.2024")).toBe("2024-03-12");
    expect(parseDate("25/12/2024")).toBe("2024-12-25");
    // Never a guess: ambiguous, impossible or not a date.
    expect(parseDate("03/04/2024")).toBeNull();
    expect(parseDate("31. februar 2024")).toBeNull();
    expect(parseDate("In 2024 we grew")).toBeNull();
    expect(parseDate("12")).toBeNull();
  });

  it("makes the picture the card's alt, and never a word the card did not have", () => {
    const built = buildReplica(input(capture(page(shop(3, 3, () => ({ title: "Fjord tour" }))))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.items![0].picture?.alt).toBe("Photo 0");
    expect(grid.items![0].title).toBe("Fjord tour");
  });
});

describe("what stays as columns, and why", () => {
  it("keeps cards with a second button as columns and says how many hold one", () => {
    const built = buildReplica(input(capture(page(shop(6, 3, (i) => (i % 2 === 0 ? { second: "Kjøp" } : {}))))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.built).toEqual([]);
    expect(built.grids.kept[0]).toMatchObject({ cards: 6, reason: "3 of 6 cards hold a second button" });
    expect(built.dropped.find((d) => d.kind === "grid-columns")?.text).toBe("3 of 6 cards hold a second button");
    // As before: boxes side by side are columns of rows.
    expect(blocksOf(built.rows).some((b) => b.type === "heading")).toBe(true);
    expect(blocksOf(built.rows).filter((b) => b.type === "button").length).toBeGreaterThanOrEqual(9);
    expect(gridLines(built.grids).problems[0]).toContain("kept as columns: 3 of 6 cards hold a second button");
  });

  it("refuses equal cards of different heights", () => {
    const built = buildReplica(input(capture(page(shop(4, 4, (i) => ({ height: i === 2 ? 560 : 420 }))))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/differ in height by more than 20 %/);
  });

  it("refuses boxes of different widths silently, as a hero next to two small boxes is not a group", () => {
    const hero = node({ p: "0/0", tag: "div", box: [0, 0, 700, 400], s: { display: "block" } }, [text("h2", [20, 20, 600, 40], "Big", {}, { p: "0/0/0" }), text("p", [20, 80, 600, 40], "Hero words here", {}, { p: "0/0/1" })]);
    const small = (i: number) => node({ p: `0/${i}`, tag: "div", box: [720 + (i - 1) * 360, 0, 340, 400], s: { display: "block" } }, [text("h3", [740 + (i - 1) * 360, 20, 300, 30], `Small ${i}`, {}, { p: `0/${i}/0` }), text("p", [740 + (i - 1) * 360, 60, 300, 30], "Words", {}, { p: `0/${i}/1` })]);
    const built = buildReplica(input(capture(page(node({ p: "0", tag: "section", box: [0, 0, 1440, 400], s: { display: "block" } }, [hero, small(1), small(2)])))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept).toEqual([]);
  });

  it("refuses structurally different siblings of one width", () => {
    const built = buildReplica(input(capture(page(shop(4, 4, (i) => (i === 3 ? { picture: false, button: null } : {}))))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/structurally different siblings/);
  });

  it("refuses a footer's columns: they keep their own handling", () => {
    const column = (i: number, x: number) =>
      node({ p: `1/0/${i}`, tag: "div", box: [x, 2000, 300, 200], s: { display: "block" } }, [
        text("h4", [x, 2000, 300, 24], `Column ${i}`, { fontSize: "16px", fontWeight: "700" }, { p: `1/0/${i}/0` }),
        node({ p: `1/0/${i}/1`, tag: "ul", box: [x, 2040, 300, 120], s: { display: "block" } }, [0, 1, 2].map((k) => text("li", [x, 2040 + k * 40, 300, 24], `Link ${i}-${k}`, {}, { p: `1/0/${i}/1/${k}` }))),
      ]);
    const footer = node({ p: "1", tag: "footer", sel: "footer.site", box: [0, 2000, 1440, 240], s: { display: "block", backgroundColor: "rgb(20, 20, 20)" } }, [
      node({ p: "1/0", tag: "div", box: [100, 2000, 1240, 200], s: { display: "flex" } }, [column(0, 100), column(1, 420), column(2, 740), column(3, 1060)]),
    ]);
    const built = buildReplica(input(capture(page(footer))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    // A footer's columns are rightly refused: no problem of the copy, so no summary line and no finding, but the markdown report says it (`grids.quiet`).
    expect(built.grids.kept).toHaveLength(0);
    expect(built.grids.quiet?.[0].reason).toMatch(/footer/);
    expect(built.dropped.some((d) => d.kind === "grid-columns")).toBe(false);
    expect(gridLines(built.grids).problems).toEqual([]);
  });

  it("refuses a menu of words and a row of form fields", () => {
    const menu = node({ p: "0", tag: "nav", sel: "nav.main", box: [0, 0, 1440, 60], s: { display: "block" } }, [0, 1, 2, 3].map((i) => node({ p: `0/${i}`, tag: "div", box: [100 + i * 200, 10, 180, 40], s: { display: "block" } }, [text("a", [100 + i * 200, 10, 180, 40], `Item ${i}`, {}, { p: `0/${i}/0`, href: `https://source.test/${i}` })])));
    const built = buildReplica(input(capture(page(menu))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
  });

  it("keeps a group as columns when more than a fifth of its cards hold something an item cannot, and builds it when only a few do", () => {
    const withSecondPicture = (tree: CaptureNode, count: number, size = 48) => {
      const cards = tree.children[1].children;
      for (let i = 0; i < count; i++) cards[i].children.push(node({ p: `${cards[i].p}/99`, tag: "img", box: [cards[i].box[0] + 200, cards[i].box[1] + 10, size, size], s: { display: "block" }, media: { kind: "img", url: "https://source.test/icon.png", width: size, height: size, alt: "" } }));
      return tree;
    };
    const few = buildReplica(input(capture(page(withSecondPicture(shop(10, 5), 2)))), newId);
    expect(gridsOf(few.rows)).toHaveLength(1);
    expect(few.grids.built[0].failed).toHaveLength(2);
    expect(few.dropped.filter((d) => d.kind === "grid-card")).toHaveLength(2);
    const many = buildReplica(input(capture(page(withSecondPicture(shop(10, 5), 3)))), newId);
    expect(gridsOf(many.rows)).toHaveLength(0);
    expect(many.grids.kept[0].reason).toMatch(/3 of 10 cards hold a second picture or an icon set, more than a fifth/);
  });

  it("builds the group when every card has small icons (review stars, a heart): decoration is left out and said so, it is not a second picture (lampan.no)", () => {
    const withIcons = (tree: CaptureNode) => {
      for (const card of tree.children[1].children) {
        for (let k = 0; k < 3; k++) card.children.push(node({ p: `${card.p}/9${k}`, tag: "svg", box: [card.box[0] + 10 + k * 14, card.box[1] + 5, 13, 13], s: { display: "block" }, media: { kind: "svg", markup: "<svg/>", width: 13, height: 13 } as never }));
      }
      return tree;
    };
    const built = buildReplica(input(capture(page(withIcons(shop(10, 5))))), newId);
    expect(gridsOf(built.rows)).toHaveLength(1);
    expect(built.grids.kept).toHaveLength(0);
    expect(built.grids.built[0].failed).toHaveLength(0);
    expect(gridsOf(built.rows)[0].items).toHaveLength(10);
    // But a 33 px picture is a picture.
    const tree = shop(10, 5);
    for (const card of tree.children[1].children) {
      card.children.push(node({ p: `${card.p}/98`, tag: "img", box: [card.box[0] + 200, card.box[1] + 10, 33, 33], s: { display: "block" }, media: { kind: "img", url: "https://source.test/b.png", width: 33, height: 33, alt: "" } }));
    }
    const bigger = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(bigger.rows)).toHaveLength(0);
  });

  it("keeps a group as columns when a card's text is more than an item holds, never cutting words", () => {
    const long = "word ".repeat(140).trim();
    const built = buildReplica(input(capture(page(shop(3, 3, (i) => (i === 0 ? { text: long } : {}))))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toBe("1 of 3 cards have more words than an item holds");
  });

  it("keeps a group as columns when some cards are linked with a button and others are linked without one", () => {
    // The first card's title is linked and it has no button; the others have a button. An item with a link and no label of its own
    // would be drawn with a "Read more" nobody wrote.
    const tree = shop(3, 3, (i) => (i === 0 ? { button: null } : {}));
    const first = tree.children[1].children[0];
    first.href = "https://source.test/p/0";
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
  });

  it("cuts a group at the most an item list holds and counts what it leaves out", () => {
    const built = buildReplica(input(capture(page(shop(62, 6)))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.items).toHaveLength(CUSTOM_ITEMS_MAX);
    expect(built.grids.built[0]).toMatchObject({ cards: 62, items: CUSTOM_ITEMS_MAX, cut: 2 });
    expect(built.dropped.find((d) => d.kind === "grid-items-cut")?.text).toBe(`2 cards beyond the ${CUSTOM_ITEMS_MAX} an item list holds`);
    expect(gridLines(built.grids).problems.join(" ")).toContain("2 cards beyond the 60");
  });
});

describe("pictures that do not fill their card", () => {
  const icon = (i: number, p: string, [x, y, w]: [number, number, number]): CaptureNode =>
    node({ p, tag: "div", sel: "div.feature", box: [x, y, w, 220], s: { display: "block", backgroundColor: "rgb(255, 255, 255)", paddingTop: "32px", paddingBottom: "32px", paddingLeft: "32px", paddingRight: "32px" } }, [
      node({ p: `${p}/0`, tag: "svg", box: [x + 32, y + 32, 44, 44], media: { kind: "svg" } }),
      text("h3", [x + 32, y + 94, w - 64, 28], `Feature ${i}`, { fontSize: "22px", lineHeight: "28px", fontWeight: "600" }, { p: `${p}/1` }),
      text("p", [x + 32, y + 132, w - 64, 48], `What feature ${i} does.`, {}, { p: `${p}/2` }),
    ]);

  it("keeps an icon at its own width and place, and a padded card's room as the tile's padding", () => {
    const cards = [0, 1, 2].map((i) => icon(i, `0/0/${i}`, [100 + i * 360, 100, 340]));
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 220], s: { display: "block" } }, [node({ p: "0/0", tag: "div", box: [100, 100, 1060, 220], s: { display: "flex" } }, cards)]);
    const built = buildReplica({ ...input(capture(page(tree))), shot: (path) => ({ url: library(`icon-${path.replace(/\//g, "-")}.svg`), width: 44, height: 44 }) }, newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.items).toHaveLength(3);
    expect(grid.items![0].picture).toMatchObject({ alt: "", width: 44, height: 44 });
    expect(grid.tile).toMatchObject({ background: "#ffffff", padding: 32 });
    const image = built.model.rules.find((r) => r.id === grid.htmlId && r.suffix === " li[data-item-id] img")!;
    expect(image.desktop).toMatchObject({ width: "44px", height: "auto", "margin-left": "0px", "aspect-ratio": "1 / 1" });
    expect(grid.imageShape).toBe("square");
  });

  it("makes a strip of logos a grid of pictures, each its own link, with no words to lose", () => {
    const logo = (i: number) => node({ p: `0/0/${i}`, tag: "a", href: `https://partner.test/${i}`, box: [100 + i * 200, 100, 160, 80], s: { display: "block" } }, [node({ p: `0/0/${i}/0`, tag: "img", box: [100 + i * 200, 100, 160, 80], s: { display: "block", objectFit: "contain" }, media: { kind: "img", url: `https://source.test/logo-${i}.png`, width: 320, height: 160, alt: `Partner ${i}` } })]);
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 80], s: { display: "block" } }, [node({ p: "0/0", tag: "div", box: [100, 100, 1160, 80], s: { display: "flex" } }, [0, 1, 2, 3, 4, 5].map(logo))]);
    const built = buildReplica(input(capture(page(tree))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.items).toHaveLength(6);
    expect(grid.items![3]).toMatchObject({ title: "", text: "", buttonLabel: "", link: { kind: "url", url: "https://partner.test/3" }, picture: { alt: "Partner 3" } });
    expect(grid.show).toMatchObject({ image: true, heading: false, excerpt: false, button: false });
    expect(screens(grid).desktop).toBe(6);
    expect(blocksOf(built.rows)).toHaveLength(1);
  });
});

describe("a track and its controls", () => {
  const cards = (origin: string, top: number) => Array.from({ length: 5 }, (_, i) => card(i, `${origin}/0/0/${i}`, [110 + i * 310, top, 290]));
  it("is a grid when the track is wrapped in a box and the arrows stand beside the wrapper", () => {
    const track = node({ p: "0/0/0", tag: "div", scroll: true, box: [110, 170, 1000, 420], s: { display: "flex", overflowX: "auto" } }, cards("0", 170));
    const wrapper = node({ p: "0/0", tag: "div", box: [110, 170, 1000, 420], s: { display: "block" } }, [track]);
    const arrow = (name: string, x: number, p: string) => node({ p, tag: "button", sel: `button.${name}`, box: [x, 300, 40, 40], s: { display: "block" } });
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 560], s: { display: "block" } }, [wrapper, arrow("swiper-button-prev", 60, "0/1"), arrow("swiper-button-next", 1130, "0/2")]);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(1);
    expect(gridsOf(built.rows)[0].display).toBe("carousel");
    expect(built.grids.built[0].carousel).toMatchObject({ arrows: true });
  });

  it("leaves the buttons where they were, as columns, when the cards are not a grid", () => {
    const track = node({ p: "0/0", tag: "div", scroll: true, box: [110, 170, 1000, 420], s: { display: "flex", overflowX: "auto" } }, cards("0", 170).map((c, i) => (i === 3 ? { ...c, children: c.children.slice(1) } : c)));
    const arrow = (name: string, x: number, p: string) => text("button", [x, 300, 40, 40], "›", { fontSize: "22px" }, { p, sel: `button.${name}` });
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 560], s: { display: "block" } }, [track, arrow("carousel-prev", 60, "0/1"), arrow("carousel-next", 1130, "0/2")]);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/structurally different siblings/);
    // The arrows' signs are words of the page: still there as before.
    expect(JSON.stringify(built.rows)).toContain("›");
  });
});

describe("a group inside a card", () => {
  it("is not found: a card that holds a grid of its own is not a card an item can be", () => {
    const logo = (i: number, j: number, x: number, y: number) => node({ p: `0/0/${i}/${j + 1}`, tag: "img", box: [x + 16 + j * 90, y + 60, 80, 40], s: { display: "block" }, media: { kind: "img", url: `https://source.test/l${j}.png`, width: 160, height: 80, alt: `L${j}` } });
    const outer = [0, 1, 2].map((i) => {
      const x = 110 + i * 400;
      return node({ p: `0/0/${i}`, tag: "div", sel: "div.partner", box: [x, 100, 380, 200], s: { display: "block", backgroundColor: "rgb(250, 250, 250)" } }, [text("h3", [x + 16, 110, 340, 30], `Group ${i}`, { fontSize: "20px", lineHeight: "30px" }, { p: `0/0/${i}/0` }), logo(i, 0, x, 100), logo(i, 1, x, 100), logo(i, 2, x, 100)]);
    });
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 200], s: { display: "block" } }, [node({ p: "0/0", tag: "div", box: [110, 100, 1200, 200], s: { display: "flex" } }, outer)]);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/3 of 3 cards hold a second picture or an icon set/);
  });
});

describe("what the summary and the report say", () => {
  const built = () => buildReplica(input(capture(page(shop(4, 4), shop(6, 3, (i) => (i % 2 === 0 ? { second: "Kjøp" } : {}), "1", 700)))), newId);

  it("names the grids built and the groups kept, in facts", async () => {
    const out = built();
    const { buildSummary } = await import("./replicate-summary");
    const summary = buildSummary({
      outcome: "done",
      problem: null,
      notes: out.notes,
      words: 10,
      counts: out.counts,
      assets: { picturesOk: 0, picturesFailed: 0, videosOk: 0, videosFailed: 0, fontsInstalled: [], fontsStandIn: [], fontsFailed: [], shots: 0 },
      passes: [],
      iterationsAsked: 1,
      stoppedEarly: false,
      vision: { used: true, why: null },
      page: null,
      analysis: null,
      grids: out.grids,
    });
    expect(summary.wentWell.join("\n")).toMatch(/4 repeated cards at div\.cards \(170px down\) became one grid of 4 items/);
    expect(summary.problems.join("\n")).toMatch(/6 boxes at div\.cards .* were kept as columns: 3 of 6 cards hold a second button/);
  });

  it("is a finding with its evidence, the change and where to start, and a section of the Markdown brief", async () => {
    const out = built();
    const { buildReport, reportMarkdown } = await import("./replicate-report");
    const facts = {
      now: "2026-10-03T10:00:00.000Z",
      url: "https://source.test/",
      outcome: "done" as const,
      problem: null,
      iterationsAsked: 1,
      stoppedEarly: false,
      vision: { used: true, why: null },
      desktop: capture(page(shop(4, 4))),
      mobile: null,
      parts: out.parts,
      counts: out.counts,
      words: 10,
      notes: out.notes,
      dropped: out.dropped,
      grids: out.grids,
      passes: [],
      finalDiff: null,
      assets: null,
      analysis: null,
      cssLength: null,
      cssTrimmed: null,
      log: [],
    };
    const report = buildReport(facts);
    const kept = report.findings.find((f) => f.id === "grids-kept")!;
    expect(kept.evidence[0]).toMatch(/6 boxes at div\.cards .*: 3 of 6 cards hold a second button\./);
    expect(kept.where.join(" ")).toContain("replicate-grid.ts");
    expect(report.grids?.built).toHaveLength(1);
    const text = reportMarkdown(report);
    expect(text).toContain("## Grids and carousels (repeated cards)");
    expect(text).toMatch(/Built at `div\.cards` \(170px\): 4 cards → 4 items/);
    expect(text).toMatch(/Kept as columns at `div\.cards` .*3 of 6 cards hold a second button/);
    // An evidence-free report is still honest: a page with no repeated cards says nothing of grids.
    const plain = buildReport({ ...facts, grids: { built: [], kept: [] } });
    expect(plain.findings.some((f) => f.id.startsWith("grid"))).toBe(false);
  });
});

describe("a grid that matches worse than the columns did", () => {
  const wide = (match: number) => [{ y: 120, height: 460, match }];

  it("is named by a pass's weakest stretch under 60 %, and only then", () => {
    const built = buildReplica(input(capture(page(shop(4, 4)))), newId);
    expect(weakGrids(built.parts, wide(52))).toEqual([{ id: built.parts.find((p) => p.grid)!.id, path: "0/1", match: 52 }]);
    expect(weakGrids(built.parts, wide(61))).toEqual([]);
    // A stretch that only brushes the grid does not name it.
    expect(weakGrids(built.parts, [{ y: 0, height: 200, match: 30 }])).toEqual([]);
  });

  it("is rebuilt as columns, with the evidence kept in the report", () => {
    const tree = capture(page(shop(4, 4)));
    const built = buildReplica(input(tree, null, { reverted: [{ path: "0/1", match: 52, pass: 1 }] }), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0]).toMatchObject({ path: "0/1", reverted: { match: 52, pass: 1 } });
    expect(built.dropped.find((d) => d.kind === "grid-reverted")?.text).toContain("52%");
    expect(gridLines(built.grids).problems[0]).toContain("was rebuilt as columns after pass 1");
    // Columns hold the cards: four columns of heading, text and button.
    expect(built.rows.find((r) => r.columns.length === 4)).toBeTruthy();
  });
});

describe("a page with two grids and one carousel", () => {
  const page3 = () => {
    const first = shop(4, 4, () => ({}), "0", 100);
    const second = shop(3, 3, (i) => ({ price: `${99 + i} kr` }), "1", 700);
    const w = 290;
    const cards = Array.from({ length: 6 }, (_, i) => card(i, `2/1/0/${i}`, [110 + i * (w + 20), 1370, w]));
    const track = node({ p: "2/1/0", tag: "div", sel: "div.track", scroll: true, box: [110, 1370, 1000, 420], s: { display: "flex", overflowX: "auto" } }, cards);
    const carousel = node({ p: "2", tag: "section", box: [0, 1300, 1440, 560], s: { display: "block" } }, [
      text("h2", [110, 1310, 600, 40], "Popular", { fontSize: "32px", lineHeight: "40px" }, { p: "2/0" }),
      node({ p: "2/1", tag: "div", box: [110, 1370, 1000, 420], s: { display: "block" } }, [track]),
    ]);
    return capture(page(first, second, carousel));
  };

  it("builds three grid blocks, with fewer blocks than the columns would take", () => {
    const grids = buildReplica(input(page3()), newId);
    const columns = buildReplica(input(page3(), null, { reverted: [{ path: "0/1", match: 0, pass: 1 }, { path: "1/1", match: 0, pass: 1 }, { path: "2/1/0", match: 0, pass: 1 }] }), newId);
    expect(gridsOf(grids.rows)).toHaveLength(3);
    expect(gridsOf(grids.rows).map((g) => g.display)).toEqual([undefined, undefined, "carousel"]);
    expect(gridsOf(grids.rows).map((g) => g.items!.length)).toEqual([4, 3, 6]);
    expect(grids.counts).toMatchObject({ grids: 3, items: 13 });
    expect(gridsOf(columns.rows)).toHaveLength(0);
    expect(grids.counts.blocks).toBeLessThan(columns.counts.blocks);
    // 3 headings and 3 grids against every card's picture, heading, text and button.
    expect(grids.counts.blocks).toBe(6);
    expect(columns.counts.blocks).toBeGreaterThan(40);
    expect(gridLines(grids.grids).well).toHaveLength(3);
  });

  it("stays inside the builder's own limits and validates as a page", () => {
    const built = buildReplica(input(page3()), newId);
    const parsed = pageInput.safeParse({ ...newPageContent(), title: "Copy", slug: "copy", rows: built.rows, css: renderStyles(built.model, built.shared).css });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
  });
});

describe("the rules a grid is styled with, against the grid as the site draws it", () => {
  it("finds an element in the drawn grid for every rule's selector", () => {
    const built = buildReplica(
      input(capture(page(shop(3, 3, () => ({ badge: "Nytt", price: "199 kr", date: "12. mars 2024", detail: "Varighet: 2 timer" })))), capture(phonePage(phoneShop(3, () => ({ badge: "Nytt", price: "199 kr", date: "12. mars 2024", detail: "Varighet: 2 timer" }))), 390)),
      newId,
    );
    const [grid] = gridsOf(built.rows);
    const data = customGridData(grid, { base: "/s/demo/no", lang: "nb", locale: "nb-NO" });
    const html = renderToString(createElement(ContentGridView, { block: grid, data })).replace(/<!-- -->/g, "");
    // A compound selector (a tag, classes, an attribute) is found when some element of the html has them all.
    const found = (compound: string): boolean => {
      const match = /^(\*|[a-z][a-z0-9]*)?((?:\.[\w-]+)*)(\[data-item-id\])?$/.exec(compound);
      if (!match) return /^:/.test(compound);
      const [, tag, classes, attribute] = match;
      const elements = html.match(/<[a-z][a-z0-9]*\s[^>]*>/g) ?? [];
      return elements.some((el) => {
        if (tag && tag !== "*" && !el.startsWith(`<${tag}`) && !el.startsWith(`<${tag} `)) return false;
        for (const cls of classes.split(".").filter(Boolean)) if (!new RegExp(`class="(?:[^"]*\\s)?${cls.replace(/[-/]/g, "\\$&")}(?:\\s[^"]*)?"`).test(el)) return false;
        return !attribute || el.includes("data-item-id=");
      });
    };
    const rules = built.model.rules.filter((r) => r.id === grid.htmlId && r.suffix !== "");
    expect(rules.length).toBeGreaterThan(5);
    for (const rule of rules) {
      const compounds = rule.suffix.trim().split(/\s*>\s*|\s+/).filter(Boolean).filter((c) => !c.startsWith(":is("));
      for (const compound of compounds) {
        // `:is(h2,…)` stands for the heading the grid draws; a list of tags is found when one of them is.
        const [head] = compound.split(":");
        if (head === "") continue;
        expect(found(head), `${rule.suffix} → ${compound}`).toBe(true);
      }
    }
    expect(html).toMatch(/<h3[^>]*>/);
  });
});

describe("the words are the card's, exactly", () => {
  // A small deterministic generator, so a failure is the same failure every time.
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const WORDS = ["fjord", "båt", "kaffe", "Sommer", "tilbud", "natural", "cotton", "rea", "nyhet", "limited", "edition", "kjøp", "billig", "2 for 1", "gave", "ny", "stor", "liten", "åpen", "lørdag"];

  it("builds only items made of words found in the card, and loses none, over many random cards", () => {
    let built = 0;
    let kept = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      const pick = () => WORDS[Math.floor(r() * WORDS.length)];
      const sentence = (n: number) => Array.from({ length: n }, pick).join(" ");
      const count = 3 + Math.floor(r() * 3);
      const options: CardOpts[] = Array.from({ length: count }, (_, i) => ({
        title: sentence(1 + Math.floor(r() * 3)) + ` ${i}`,
        text: sentence(3 + Math.floor(r() * 12)),
        badge: r() < 0.3 ? pick() : undefined,
        price: r() < 0.5 ? `${Math.floor(r() * 900) + 10} kr` : undefined,
        date: r() < 0.3 ? `${1 + Math.floor(r() * 27)}. mai 2025` : undefined,
        detail: r() < 0.3 ? `${pick()}: ${pick()}` : undefined,
        picture: r() < 0.9,
        second: r() < 0.05 ? sentence(1) : undefined,
      }));
      // The group's shape must be the same for every card, or it is (rightly) not a group; make the shape of the first card the shape of all.
      for (const o of options) {
        o.badge = options[0].badge ? (o.badge ?? pick()) : undefined;
        o.price = options[0].price ? (o.price ?? "99 kr") : undefined;
        o.date = options[0].date ? (o.date ?? "1. mai 2025") : undefined;
        o.detail = options[0].detail ? (o.detail ?? "a: b") : undefined;
        o.picture = options[0].picture;
      }
      const tree = capture(page(shop(count, count, (i) => options[i])));
      const out = buildReplica(input(tree), newId);
      const grid = gridsOf(out.rows)[0];
      const cardNodes = tree.root.children[0].children[1].children;
      if (!grid) {
        kept += 1;
        continue;
      }
      built += 1;
      const hrefs = new Set<string>();
      grid.items!.forEach((item, i) => {
        const card = cardNodes[i];
        const leaves: CaptureNode[] = [];
        const visit = (n: CaptureNode) => (n.runs ? leaves.push(n) : n.children.forEach(visit));
        visit(card);
        const cardWords = leaves.flatMap((l) => tokensOf(runsText(l.runs)));
        const itemWords = [item.title, item.text, item.buttonLabel, item.badge, item.priceText, ...item.details.flatMap((d) => [d.label, d.text])].flatMap(tokensOf);
        const dateWords = item.date ? leaves.filter((l) => parseDate(runsText(l.runs)) === item.date).flatMap((l) => tokensOf(runsText(l.runs))) : [];
        // Nothing an item says is a word the card did not say.
        const available = new Map<string, number>();
        for (const w of [...cardWords]) available.set(w, (available.get(w) ?? 0) + 1);
        for (const w of itemWords) {
          const n = available.get(w) ?? 0;
          expect(n, `seed ${seed} card ${i}: "${w}" is not in the card`).toBeGreaterThan(0);
          available.set(w, n - 1);
        }
        // And nothing the card said is lost.
        for (const w of dateWords) available.set(w, (available.get(w) ?? 0) - 1);
        for (const [w, n] of available) expect(n, `seed ${seed} card ${i}: "${w}" was lost`).toBeLessThanOrEqual(0);
        // A link is one the card had; a picture is the card's own, and its description too.
        if (item.link) {
          expect(item.link.kind).toBe("url");
          hrefs.add(item.link.kind === "url" ? item.link.url : "");
          expect(item.link.kind === "url" && item.link.url).toBe(`https://source.test/p/${i}`);
        }
        if (item.picture) expect(item.picture.alt).toBe(`Photo ${i}`);
        if (item.date) expect(leaves.some((l) => parseDate(runsText(l.runs)) === item.date)).toBe(true);
      });
    }
    // The property was exercised both ways: groups built and groups kept.
    expect(built).toBeGreaterThan(100);
    expect(built + kept).toBe(150);
  });

  it("cuts text on a word", () => {
    expect(cutOnWord("one two three", 7)).toBe("one two");
    expect(cutOnWord("one two three", 8)).toBe("one two");
    expect(cutOnWord("short", 20)).toBe("short");
    expect(cutOnWord("abcdefghijkl", 5)).toBe("abcde");
  });
});

describe("whether a grid is worse than columns", () => {
  const parts = [
    { id: "a", grid: "0/1", target: [0, 200, 1440, 400] as Box, targetM: [0, 300, 390, 1200] as Box },
    { id: "b", target: [0, 700, 1440, 100] as Box },
  ];

  it("names a grid weak at phones' width by the phone's boxes and stretches, and at computers' by the computers'", () => {
    const stretch = [{ y: 700, height: 800, match: 40 }];
    expect(weakGrids(parts, stretch)).toEqual([]);
    expect(weakGrids(parts, stretch, 60, "phone")).toEqual([{ id: "a", path: "0/1", match: 40 }]);
    expect(weakGrids(parts, [{ y: 250, height: 300, match: 45 }])).toEqual([{ id: "a", path: "0/1", match: 45 }]);
  });

  it("gives the stretch each grid stood in, at each width", () => {
    expect(stretchesOf(parts, ["0/1", "nowhere"])).toEqual([{ path: "0/1", desktop: { y: 200, height: 400 }, phone: { y: 300, height: 1200 } }]);
  });

  it("keeps columns only when they match clearly better over the same stretch, the grid on a tie", () => {
    expect(columnsBeatGrid({ desktop: 40, phone: null }, { desktop: 41.5, phone: null }).columnsWin).toBe(false);
    expect(columnsBeatGrid({ desktop: 40, phone: null }, { desktop: 40 + COLUMNS_MARGIN + 0.5, phone: null }).columnsWin).toBe(true);
    // Worse at computers' and better at phones': the average of what was measured decides.
    expect(columnsBeatGrid({ desktop: 80, phone: 30 }, { desktop: 70, phone: 60 })).toMatchObject({ grid: 55, columns: 65, columnsWin: true });
    // Nothing measured to compare: the grid stays.
    expect(columnsBeatGrid({ desktop: null, phone: null }, { desktop: 90, phone: 90 })).toEqual({ grid: null, columns: null, columnsWin: false });
    expect(columnsBeatGrid({ desktop: 50, phone: null }, { desktop: null, phone: 90 }).columnsWin).toBe(false);
  });
});

describe("copies at the ends of a track with no marker", () => {
  const c = (...names: string[]) => names;
  it("tells a loop by copies at both ends, or a run of two at one, and not a list that ends as it began", () => {
    expect(loopedEnds(c("C", "A", "B", "C", "A"))).toEqual({ head: 1, tail: 1 });
    expect(loopedEnds(c("C", "D", "A", "B", "C", "D", "A", "B"))).toEqual({ head: 2, tail: 2 });
    // Copies at both ends and a run at one end can read the same: the track that opens on its first slide says which.
    expect(loopedEnds(c("A", "B", "C", "D", "A", "B"), 0)).toEqual({ head: 0, tail: 2 });
    expect(loopedEnds(c("A", "B", "C", "A"))).toBeNull();
    expect(loopedEnds(c("A", "B", "C", "D"))).toBeNull();
    // Slides with nothing to compare (no words, no pictures) are never copies of each other.
    expect(loopedEnds(c("", "A", "B", "", "A"))).toBeNull();
  });
});
