import { describe, expect, it } from "vitest";

import type { ContentGridBlock, PageBlock, PageRow } from "./page-content";
import { buildReplica, type BuildInput } from "./replicate-build";
import { isExtraTile, runsText, walk, walkLive, type Box, type CaptureNode, type PageCapture, type Run, type SlideHide, type SlideMark, type SliderControl } from "./replicate-capture";
import { autoplayWords, gridLines, mobileTiles, readSlider, sameSig, tokensOf } from "./replicate-grid";
import { renderStyles } from "./replicate-styles";
import { columnsView } from "./responsive";

/** A grid's columns by screen, as the builder shows them (D179: computers' at Extra large, the smaller sizes' overrides). */
const screens = (grid: { columns: number; at?: ContentGridBlock["at"] }) => columnsView(grid, { mobile: 0, tablet: 0, desktop: 0 });

/**
 * Script sliders (D155, C2), from captured trees and no browser: a Swiper-shaped track with copies made to loop, a Slick-shaped track with
 * cloned, hidden and beyond-the-box slides, a fade slider (slides on top of each other), loops told by number and by content, dots and arrows,
 * autoplay as the watch saw it, and a slider the converter cannot understand, which stays as it was with the reason. The rule under all of it:
 * a slide's words are the page's, the copies a library makes are not items, and a hidden slide is read, never invented.
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
const phonePage = (...children: CaptureNode[]) => node({ p: "", tag: "body", box: [0, 0, 390, 3000], s: { display: "block" } }, children);
const blocksOf = (rows: PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
const gridsOf = (rows: PageRow[]) => blocksOf(rows).filter((b): b is ContentGridBlock => b.type === "contentGrid");

// -- a slide, with what the browser read of it ------------------------------------------------------------------------------

/** The skeleton of a card's parts in order: I picture, H heading, B link or button, T text. */
function skeleton(card: CaptureNode): string {
  let out = "";
  const visit = (n: CaptureNode) => {
    if (n.media) out += "I";
    else if (/^h[1-6]$/.test(n.tag)) out += "H";
    else if (n.button || n.tag === "a") out += "B";
    else if (n.runs) out += "T";
    else n.children.forEach(visit);
  };
  visit(card);
  return out;
}

/** What the browser read of a card as a slide: its words, its pictures, its skeleton, and why it is not in view. */
function mark(card: CaptureNode, extra: Partial<SlideMark> = {}): SlideMark {
  const words: string[] = [];
  const imgs: string[] = [];
  const links: string[] = [];
  for (const n of walk(card)) {
    if (n.runs) words.push(runsText(n.runs));
    if (n.media?.kind === "img") imgs.push(n.media.url);
    if (n.href && !links.includes(n.href)) links.push(n.href);
  }
  return { text: words.join(" ").replace(/\s+/g, " ").trim(), imgs, ...(links.length > 0 ? { links } : {}), sig: skeleton(card), ...extra };
}

type CardOpts = { title?: string; text?: string; button?: string | null; second?: string; picture?: boolean; src?: string; href?: string };

/** A slide that is a card: a painted box with a picture to its edges, a heading, a paragraph and a button. `p` is its path. */
function slide(i: number, p: string, [x, y, w]: [number, number, number], o: CardOpts = {}, extra: Partial<SlideMark> = {}): CaptureNode {
  const kids: CaptureNode[] = [];
  let at = y + 1;
  let n = 0;
  if (o.picture !== false) {
    kids.push(node({ p: `${p}/${n++}`, tag: "img", box: [x + 1, at, w - 2, 192], s: { display: "block", objectFit: "cover" }, media: { kind: "img", url: o.src ?? `https://source.test/photo-${i}.jpg`, width: 800, height: 600, alt: `Photo ${i}` } }));
    at += 208;
  }
  kids.push(text("h3", [x + 16, at, w - 32, 28], o.title ?? `Title ${i}`, { fontSize: "22px", lineHeight: "28px", fontWeight: "600" }, { p: `${p}/${n++}` }));
  at += 36;
  kids.push(text("p", [x + 16, at, w - 32, 72], o.text ?? `Words of slide ${i} in a few lines.`, { color: "rgb(90, 90, 90)" }, { p: `${p}/${n++}` }));
  at += 80;
  if (o.button !== null) {
    kids.push(text("a", [x + 16, at, 110, 44], o.button ?? "Les mer", { color: "rgb(255, 255, 255)", backgroundColor: "rgb(79, 70, 229)", paddingTop: "10px", paddingBottom: "10px", paddingLeft: "16px", paddingRight: "16px", textAlign: "center" }, { p: `${p}/${n++}`, button: true, href: o.href ?? `https://source.test/p/${i}` }));
    at += 52;
  }
  if (o.second) kids.push(text("a", [x + 140, at - 52, 90, 44], o.second, { color: "rgb(79, 70, 229)", textAlign: "center" }, { p: `${p}/${n++}`, button: true, href: `https://source.test/q/${i}` }));
  const border = (side: string) => ({ [`border${side}Width`]: "1px", [`border${side}Color`]: "rgb(220, 220, 225)" });
  const card = node(
    {
      p,
      tag: "div",
      sel: "div.slide",
      box: [x, y, w, 420],
      s: { display: "block", backgroundColor: "rgb(255, 255, 255)", borderTopStyle: "solid", ...border("Top"), ...border("Right"), ...border("Bottom"), ...border("Left"), borderTopLeftRadius: "12px", overflowX: "hidden" },
    },
    kids,
  );
  card.slide = mark(card, extra);
  return card;
}

const arrow = (dir: "prev" | "next", x: number, p: string, sel = `div.swiper-button-${dir}`) =>
  node({ p, tag: "div", sel, box: [x, 340, 44, 44], s: { display: "flex" } }, [node({ p: `${p}/0`, tag: "svg", box: [x + 12, 352, 20, 20], media: { kind: "svg" } })]);
const bullets = (count: number, p: string, at: Box) =>
  node({ p, tag: "div", sel: "div.swiper-pagination", box: at, s: { display: "flex" } }, Array.from({ length: count }, (_, i) => node({ p: `${p}/${i}`, tag: "span", sel: "span.swiper-pagination-bullet", box: [at[0] + i * 18, at[1], 8, 8], s: { display: "block", backgroundColor: "rgb(180, 180, 190)" } })));

type SwiperOpts = {
  /** The real slides, then the copies at the head and the tail of the track. */
  real?: number;
  head?: number;
  tail?: number;
  /** A tile is a copy by marker (`swiper-slide-duplicate`), by a key only, or not at all. */
  mark?: "marker" | "none";
  /** Keys: the library's own numbers on every slide. */
  keys?: boolean;
  arrows?: boolean;
  dots?: boolean;
  watch?: PageCapture["root"]["watch"];
  slides?: (i: number) => CardOpts;
  /** The tile's width and the clip's, which differ between computers and phones. */
  w?: number;
  clipW?: number;
  x0?: number;
  gap?: number;
  kind?: "transform" | "flex";
  controls?: SliderControl[];
  /** The arrows' class: one a reader would not know leaves them to be found by label. */
  arrowSel?: string;
  dotsNamed?: boolean;
  hints?: string[];
};

/** A section with a heading over a Swiper-shaped track: `.swiper` clips `.swiper-wrapper`, which is moved so the first real slide stands at the clip's left. */
function swiper(o: SwiperOpts = {}, origin = "0", top = 100): CaptureNode {
  const real = o.real ?? 6;
  const head = o.head ?? 0;
  const tail = o.tail ?? 0;
  const w = o.w ?? 290;
  const gap = o.gap ?? 20;
  const x0 = o.x0 ?? 110;
  const clipW = o.clipW ?? 3 * w + 2 * gap;
  const y = top + 70;
  const total = head + real + tail;
  const wrapperPath = `${origin}/1/0`;
  const cards: CaptureNode[] = [];
  for (let k = 0; k < total; k++) {
    const index = k < head ? real - head + k : k < head + real ? k - head : k - head - real;
    const isCopy = k < head || k >= head + real;
    const x = x0 + (k - head) * (w + gap);
    const hide: SlideHide | undefined = x + w <= x0 + 1 || x >= x0 + clipW - 1 ? "outside" : undefined;
    const slides = o.slides ?? (() => ({}));
    const extra: Partial<SlideMark> = { ...(hide ? { hide } : {}), ...(o.keys !== false ? { key: String(index) } : {}), ...(isCopy && o.mark !== "none" ? { clone: "swiper-slide-duplicate" } : {}) };
    cards.push(slide(index, `${wrapperPath}/${k}`, [x, y, w], slides(index), extra));
  }
  const wrapper = node(
    {
      p: wrapperPath,
      tag: "div",
      sel: "div.swiper-wrapper",
      // As the library draws it: the wrapper is as wide as the clip and moved by a transform, its slides overflowing it.
      box: [x0 - head * (w + gap), y, clipW, 420],
      s: { display: "flex", transform: `matrix(1, 0, 0, 1, ${-head * (w + gap)}, 0)` },
      scroll: true,
      slider: { kind: o.kind ?? "transform", clip: [x0, y, clipW, 420], tiles: total, hints: o.hints ?? ["swiper-wrapper"], arrows: o.controls ?? [], dots: o.dotsNamed ? { count: real, role: "named", sel: "div.swiper-pagination", box: [x0 + clipW / 2 - 50, y + 400, 100, 8] } : null },
      ...(o.watch ? { watch: o.watch } : {}),
    },
    cards,
  );
  const around: CaptureNode[] = [];
  if (o.arrows !== false) around.push(arrow("prev", x0 + 10, `${origin}/1/1`, o.arrowSel), arrow("next", x0 + clipW - 54, `${origin}/1/2`, o.arrowSel));
  if (o.dots) around.push(bullets(real, `${origin}/1/3`, [x0 + clipW / 2 - 50, y + 400, 100, 8]));
  return node({ p: origin, tag: "section", box: [0, top, 1440, 70 + 420 + 30], s: { display: "block" } }, [
    text("h2", [110, top + 10, 600, 40], "Popular", { fontSize: "32px", lineHeight: "40px", fontWeight: "700" }, { p: `${origin}/0` }),
    node({ p: `${origin}/1`, tag: "div", sel: "div.swiper", box: [x0, y, clipW, 420], s: { display: "block", position: "relative", overflowX: "hidden" } }, [wrapper, ...around]),
  ]);
}

const swiperPhone = (o: SwiperOpts = {}) => swiper({ w: 358, clipW: 358, x0: 16, gap: 20, ...o, arrows: false, dots: o.dots });

const titlesOf = (grid: ContentGridBlock) => grid.items!.map((item) => item.title);

// ---------------------------------------------------------------------------------------------------------------------

describe("a Swiper-shaped track with copies made to loop", () => {
  const options: SwiperOpts = { real: 6, head: 3, tail: 3, dots: true, watch: { observed: true, watchedMs: 6500, seconds: 5, moves: 2, basis: "interval" } };
  const build = (extra: SwiperOpts = {}, phone: SwiperOpts = { real: 6, head: 1, tail: 1, dots: true }) => buildReplica(input(capture(page(swiper({ ...options, ...extra }))), capture(phonePage(swiperPhone(phone)), 390)), newId);

  it("is one grid of the real slides: the copies are not items, whatever stands before the first real one", () => {
    const built = build();
    const [grid] = gridsOf(built.rows);
    expect(gridsOf(built.rows)).toHaveLength(1);
    expect(titlesOf(grid)).toEqual(["Title 0", "Title 1", "Title 2", "Title 3", "Title 4", "Title 5"]);
    expect(built.counts).toMatchObject({ grids: 1, items: 6, blocks: 2 });
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading", "contentGrid"]);
    expect(grid.items![5]).toMatchObject({ text: "Words of slide 5 in a few lines.", buttonLabel: "Les mer", link: { kind: "url", url: "https://source.test/p/5" }, picture: { alt: "Photo 5" } });
  });

  it("goes round (the copies were a loop), has dots, and moves by itself as often as the watch saw", () => {
    const [grid] = gridsOf(build().rows);
    expect(grid.display).toBe("carousel");
    // Arrows are the default and are said only when absent; dots, rewind and autoplay are said.
    expect(grid.carousel).toEqual({ dots: true, rewind: true, autoplay: { seconds: 5 } });
  });

  it("reads the slides in view at each width: three on computers, one on phones, wherever the copies are", () => {
    const built = build();
    const [grid] = gridsOf(built.rows);
    expect(screens(grid).desktop).toBe(3);
    expect(screens(grid).mobile).toBe(1);
    expect(built.grids.built[0].carousel).toMatchObject({ arrows: true, dots: true, rewind: true, perScreen: { desktop: 3, phone: 1 }, clones: 6 });
  });

  it("says what it read: a script slider, its copies by marker, its slides out of view, and autoplay as watched", () => {
    const built = build();
    const carousel = built.grids.built[0].carousel!;
    expect(carousel.script).toMatchObject({ kind: "transform", hints: ["swiper-wrapper"], hidden: 3, clonesBy: { markers: 6, keys: 0, hashes: 0 }, order: "page" });
    expect(carousel.autoplay).toBe("observed, 5 s");
    expect(autoplayWords(carousel)).toBe("autoplay observed (every 5 s, 2 moves in 6.5 s)");
    const lines = gridLines(built.grids);
    expect(lines.well[0]).toContain("6 slides");
    expect(lines.well[0]).toContain("goes back to the first tile after the last");
    expect(lines.well[0]).toContain("autoplay observed (every 5 s");
    expect(lines.well.join(" ")).toContain("6 copies made to loop were left out (6 by the library's marker)");
    expect(lines.well.join(" ")).toContain("3 slides out of view were read from the page's own text and pictures");
  });

  it("says autoplay was not observed when the track did not move, and how long it was watched", () => {
    const built = build({ watch: { observed: false, watchedMs: 11_500 } });
    const [grid] = gridsOf(built.rows);
    expect(grid.carousel).toEqual({ dots: true, rewind: true });
    expect(built.grids.built[0].carousel!.autoplay).toBe("not observed");
    expect(gridLines(built.grids).well[0]).toContain("autoplay not observed (watched 11.5 s)");
  });

  it("says one move is only a lower bound for the period", () => {
    const built = build({ watch: { observed: true, watchedMs: 6500, seconds: 4, moves: 1, basis: "once" } });
    expect(gridLines(built.grids).well[0]).toContain("autoplay observed (moved once in 6.5 s, so at least 4 s on each slide)");
    expect(gridsOf(built.rows)[0].carousel).toMatchObject({ autoplay: { seconds: 4 } });
  });

  it("never lets a copy's words in, even when a copy says something else", () => {
    const tree = swiper(options);
    const wrapper = tree.children[1].children[0];
    for (const n of wrapper.children) if (n.slide?.clone) for (const t of walk(n)) if (t.runs) t.runs = [{ t: "POISONED copy words" }];
    const built = buildReplica(input(capture(page(tree)), capture(phonePage(swiperPhone({ real: 6, head: 1, tail: 1, dots: true })), 390)), newId);
    const json = JSON.stringify(built.rows);
    expect(json).not.toContain("POISONED");
    expect(gridsOf(built.rows)[0].items).toHaveLength(6);
  });

  it("is the page's own content that the schema accepts, with its rules in the style sheet", () => {
    const built = build();
    const [grid] = gridsOf(built.rows);
    expect(built.model.rules.filter((r) => r.id === grid.htmlId).length).toBeGreaterThan(3);
    expect(renderStyles(built.model, built.shared).css).toContain(`#${grid.htmlId} li[data-item-id]`);
  });

  it("is what the grid is without a phone capture too, and deterministic", () => {
    const once = () => {
      counter = 0;
      seq = 0;
      return buildReplica(input(capture(page(swiper(options)))), newId);
    };
    const a = once();
    const b = once();
    expect(screens(gridsOf(a.rows)[0]).mobile).toBe(1);
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
    expect(JSON.stringify(a.grids)).toBe(JSON.stringify(b.grids));
  });
});

describe("reading the real slides of a track", () => {
  const track = (opts: SwiperOpts) => swiper(opts).children[1].children[0];

  it("finds copies by marker first, then by a number seen again, then by content", () => {
    expect(readSlider(track({ real: 4, head: 2, tail: 2 }))!.clones).toEqual({ markers: 4, keys: 0, hashes: 0 });
    // No marker: the library's own numbers repeat on its copies.
    const byKey = readSlider(track({ real: 4, head: 2, tail: 2, mark: "none" }))!;
    expect(byKey.clones).toEqual({ markers: 0, keys: 4, hashes: 0 });
    expect(byKey.real).toHaveLength(4);
    // No marker, no numbers: the same words and pictures as a slide already kept.
    const byHash = readSlider(track({ real: 4, head: 2, tail: 2, mark: "none", keys: false }))!;
    expect(byHash.clones).toEqual({ markers: 0, keys: 0, hashes: 4 });
    expect(byHash.real.map((n) => n.p)).toHaveLength(4);
    expect(byHash.loop).toBe(true);
  });

  // A slider's own slides are not the copies a library makes to loop: without a marker or a number, only copies at both ends of the track (or a run of two at one end)
  // tell a loop, and what a slide links to is part of what it is.
  const same = (i: number, as: number): CardOpts => ({ title: `Title ${as}`, text: `Words of slide ${as} in a few lines.`, src: `https://source.test/photo-${as}.jpg`, href: `https://source.test/p/${as}` });

  it("a slider's own slides are not mistaken for the copies a library makes to loop: one that ends as it began is a list of four", () => {
    const read = readSlider(track({ real: 4, mark: "none", keys: false, slides: (i) => (i === 3 ? same(i, 0) : {}) }))!;
    expect(read.real).toHaveLength(4);
    expect(read.clones).toEqual({ markers: 0, keys: 0, hashes: 0 });
    expect(read.loop).toBe(false);
    const built = buildReplica(input(capture(page(swiper({ real: 4, mark: "none", keys: false, slides: (i) => (i === 3 ? same(i, 0) : {}) })))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.items).toHaveLength(4);
    expect(grid.carousel?.rewind).toBeUndefined();
  });

  it("a slider's own slides are not mistaken for the copies a library makes to loop: slides that say the same and go to different places are different slides", () => {
    const summer = (i: number): CardOpts => ({ title: "Summer sale", text: "Up to 50 off.", src: "https://source.test/summer.jpg", href: `https://source.test/cat/${["women", "men", "kids", "home"][i]}` });
    const read = readSlider(track({ real: 4, mark: "none", keys: false, slides: summer }))!;
    expect(read.real).toHaveLength(4);
    expect(read.loop).toBe(false);
    const built = buildReplica(input(capture(page(swiper({ real: 4, mark: "none", keys: false, slides: summer })))), newId);
    expect(gridsOf(built.rows)[0].items!.map((item) => (item.link as { url: string }).url)).toEqual(["women", "men", "kids", "home"].map((c) => `https://source.test/cat/${c}`));
  });

  it("copies at both ends of an unmarked track are a loop, the slides between them the real ones, and the grid goes round", () => {
    const read = readSlider(track({ real: 4, head: 2, tail: 2, mark: "none", keys: false }))!;
    expect(read.loop).toBe(true);
    expect(read.clones.hashes).toBe(4);
    const built = buildReplica(input(capture(page(swiper({ real: 4, head: 1, tail: 1, mark: "none", keys: false })))), newId);
    expect(gridsOf(built.rows)[0].carousel).toMatchObject({ rewind: true });
    expect(gridsOf(built.rows)[0].items).toHaveLength(4);
  });

  it("says how many slides were never read, when the browser read a track only to its limit, and counts them as left out", () => {
    const tree = swiper({ real: 6 });
    tree.children[1].children[0].slider!.unread = 5;
    expect(readSlider(tree.children[1].children[0])!.unread).toBe(5);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(built.grids.built[0]).toMatchObject({ items: 6, cut: 0, unread: 5 });
    expect(built.dropped.some((d) => d.kind === "grid-items-cut" && /5 slides never read/.test(d.text ?? ""))).toBe(true);
    expect(gridLines(built.grids).problems.join(" ")).toContain("5 slides of the slider at div.swiper-wrapper were never read");
  });

  it("keeps the real slides from the first one in view, in their order, when only content tells the copies", () => {
    const read = readSlider(track({ real: 4, head: 2, tail: 2, mark: "none", keys: false }))!;
    expect(read.real.map((n) => /Title (\d)/.exec(n.slide!.text)![1]).join("")).toBe("0123");
    expect(read.real[0].p).toBe("0/1/0/2");
    // With the library's numbers, the one in view is kept of each pair.
    const keyed = readSlider(track({ real: 4, head: 2, tail: 2, mark: "none" }))!;
    expect(keyed.real.map((n) => n.slide!.key).join("")).toBe("0123");
    expect(keyed.real[0].p).toBe("0/1/0/2");
  });

  it("does not take a number seen again for a copy when the slides say different things: it was not a slide's place", () => {
    const t = track({ real: 4, keys: false });
    for (const tile of t.children) tile.slide!.key = "1";
    const read = readSlider(t)!;
    expect(read.real).toHaveLength(4);
    expect(read.clones).toEqual({ markers: 0, keys: 0, hashes: 0 });
    expect(read.loop).toBe(false);
  });

  it("is not a loop when it has no copies", () => {
    const read = readSlider(track({ real: 5 }))!;
    expect(read.loop).toBe(false);
    expect(read.real).toHaveLength(5);
    expect(read.hidden).toBe(2);
    expect(read.hiddenWords).toBeGreaterThan(0);
  });

  it("leaves two slides alone that say different things, even with no number to tell them apart", () => {
    const read = readSlider(track({ real: 4, keys: false, slides: (i) => ({ title: `Different ${i}` }) }))!;
    expect(read.real).toHaveLength(4);
    expect(read.clones).toEqual({ markers: 0, keys: 0, hashes: 0 });
  });

  it("orders the slides by the library's own numbers when the page's order is a loop's", () => {
    const t = track({ real: 4 });
    const [a, b, c, d] = t.children;
    t.children = [c, a, d, b];
    const read = readSlider(t)!;
    expect(read.real.map((n) => n.slide!.key)).toEqual(["0", "1", "2", "3"]);
    expect(read.order).toBe("numbers");
  });

  it("is nothing for a box that is not a slider", () => {
    expect(readSlider(node({ tag: "div", box: [0, 0, 10, 10] }))).toBeNull();
  });

  it("pairs a slide at computers' width with the one at phones' by its place among the real ones, not among the children", () => {
    const desktop = readSlider(track({ real: 4, head: 3, tail: 3 }))!;
    const phone = readSlider(track({ real: 4, head: 1, tail: 1 }))!;
    const map = mobileTiles(desktop, phone);
    expect(map.get(desktop.real[0].p)).toBe(phone.real[0].p);
    expect(desktop.real[0].p).toBe("0/1/0/3");
    expect(phone.real[0].p).toBe("0/1/0/1");
    expect(map.size).toBe(4);
  });

  it("walks a capture without what the page does not show first, for counting", () => {
    const tree = page(swiper({ real: 4, head: 2, tail: 2 }));
    const all = [...walk(tree)].filter((n) => n.runs).length;
    const live = [...walkLive(tree)].filter((n) => n.runs).length;
    expect(all).toBeGreaterThan(live);
    // The copies and the slides out of view are 7 of the 8 slides' texts; one real slide in view per... three in view.
    expect(tree.children[0].children[1].children[0].children.filter((n) => !isExtraTile(n))).toHaveLength(3);
  });

  it("says two skeletons are one card, or one text part apart", () => {
    expect(sameSig("IHTB", "IHTB")).toBe(true);
    expect(sameSig("IHTB", "ITHTB")).toBe(true);
    expect(sameSig("IHTB", "IHB")).toBe(true);
    expect(sameSig("IHTB", "IHBB")).toBe(false);
    expect(sameSig("IHTB", "HTB")).toBe(false);
  });
});

describe("a Slick-shaped track with cloned and hidden slides", () => {
  const w = 290;
  const gap = 20;
  /** `slick-list` clips `slick-track`: three clones before, six slides, three after; slides 3 to 5 are beyond the box, one is `visibility: hidden`, the dots are a list of buttons. */
  function slick(): CaptureNode {
    const y = 170;
    const cards: CaptureNode[] = [];
    const place = (k: number) => 110 + (k - 3) * (w + gap);
    for (let k = 0; k < 12; k++) {
      const index = k < 3 ? k - 3 : k < 9 ? k - 3 : k - 3;
      const real = k >= 3 && k < 9;
      const x = place(k);
      const hide: SlideHide | undefined = x + w <= 111 || x >= 110 + 910 - 1 ? "outside" : undefined;
      cards.push(slide(real ? index : Math.abs(index) % 6, `0/1/0/0/${k}`, [x, y, w], { title: `Slide ${real ? index : (index + 6) % 6}`, text: `Slick words ${real ? index : (index + 6) % 6}.` }, { ...(hide ? { hide } : {}), key: String(index), ...(real ? {} : { clone: "slick-cloned" }) }));
    }
    // One real slide is also see-through: a slide a library parks.
    cards[5].slide = { ...cards[5].slide!, hide: "visibility" };
    const track = node({ p: "0/1/0/0", tag: "div", sel: "div.slick-track", box: [110 - 3 * (w + gap), y, 12 * (w + gap), 420], s: { display: "block", transform: "matrix(1, 0, 0, 1, -930, 0)" }, scroll: true, slider: { kind: "transform", clip: [110, y, 910, 420], tiles: 12, hints: ["slick-track", "slick-list"], arrows: [], dots: { count: 6, role: "named", sel: "ul.slick-dots", box: [500, 600, 120, 20] } } }, cards);
    const list = node({ p: "0/1/0", tag: "div", sel: "div.slick-list", box: [110, y, 910, 420], s: { display: "block", overflowX: "hidden" } }, [track]);
    const prev = node({ p: "0/1/1", tag: "button", sel: "button.slick-prev", box: [60, 360, 40, 40], s: { display: "block" } });
    const next = node({ p: "0/1/2", tag: "button", sel: "button.slick-next", box: [1030, 360, 40, 40], s: { display: "block" } });
    return node({ p: "0", tag: "section", box: [0, 100, 1440, 560], s: { display: "block" } }, [
      text("h2", [110, 110, 600, 40], "Slick", { fontSize: "32px", lineHeight: "40px" }, { p: "0/0" }),
      node({ p: "0/1", tag: "div", sel: "div.slick-slider", box: [60, y, 1010, 420], s: { display: "block", position: "relative" } }, [prev, list, next]),
    ]);
  }

  it("is one grid of the six real slides, in their own order, the hidden one among them", () => {
    const built = buildReplica(input(capture(page(slick()))), newId);
    const [grid] = gridsOf(built.rows);
    expect(titlesOf(grid)).toEqual(["Slide 0", "Slide 1", "Slide 2", "Slide 3", "Slide 4", "Slide 5"]);
    expect(grid.display).toBe("carousel");
    // Dots: the list the page names as pagination has as many dots as there are slides.
    expect(grid.carousel).toEqual({ dots: true, rewind: true });
    expect(built.grids.built[0].carousel!.script).toMatchObject({ kind: "transform", hidden: 4, clonesBy: { markers: 6 } });
    // Arrows by class (`slick-prev`, `slick-next`), outside the slides.
    expect(built.grids.built[0].carousel).toMatchObject({ arrows: true });
  });

  it("reads the words of slides that are out of view from the page: they are in the items", () => {
    const [grid] = gridsOf(buildReplica(input(capture(page(slick()))), newId).rows);
    expect(grid.items![4].text).toBe("Slick words 4.");
    expect(grid.items![5].link).toEqual({ kind: "url", url: "https://source.test/p/5" });
  });
});

describe("arrows and dots a library draws with no class a reader would know", () => {
  const labelled: SliderControl[] = [
    { dir: "prev", label: "Previous slide", sel: "button.nav-a", box: [96, 340, 40, 40] },
    { dir: "next", label: "Next slide", sel: "button.nav-b", box: [980, 340, 40, 40] },
  ];

  it("reads arrows from the buttons the browser found by label near the track", () => {
    const withLabels = buildReplica(input(capture(page(swiper({ real: 5, arrows: false, controls: labelled })))), newId);
    expect(gridsOf(withLabels.rows)[0].carousel).toBeUndefined();
    expect(withLabels.grids.built[0].carousel).toMatchObject({ arrows: true });
  });

  it("builds the grid round buttons that have no class, words or sign to know them by, when the browser found them by label", () => {
    // Two svg-only buttons of an unknown class beside the track: without the browser's label they would be taken for part of the page.
    const found: SliderControl[] = [
      { dir: "prev", label: "Forrige", sel: "button.nav-a", box: [124, 344, 36, 36] },
      { dir: "next", label: "Neste", sel: "button.nav-a", box: [970, 344, 36, 36] },
    ];
    const built = buildReplica(input(capture(page(swiper({ real: 5, arrowSel: "div.nav-a", controls: found })))), newId);
    expect(gridsOf(built.rows)).toHaveLength(1);
    expect(built.grids.built[0].carousel).toMatchObject({ arrows: true });
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading", "contentGrid"]);
  });

  it("is measured against the box the slides show through, not the track, which a library moves out of it", () => {
    const built = buildReplica(input(capture(page(swiper({ real: 6, head: 3, tail: 3 })))), newId);
    const grid = gridsOf(built.rows)[0];
    const part = built.parts.find((p) => p.id === grid.htmlId)!;
    expect(part.target![0]).toBe(110);
    expect(part.target![2]).toBe(910);
    // The row is as wide as that box too: the track's slides beyond it do not stretch it.
    expect(built.parts.find((p) => p.kind === "row")?.target?.[2] ?? 910).toBeLessThanOrEqual(1440);
  });

  it("says no arrows when there are none by class, label or words", () => {
    const none = buildReplica(input(capture(page(swiper({ real: 5, arrows: false })))), newId);
    expect(gridsOf(none.rows)[0].carousel).toEqual({ arrows: false });
  });

  it("reads dots from the pagination the browser found by name, a tablist or a named box, when it has as many buttons as pages or slides", () => {
    const named = buildReplica(input(capture(page(swiper({ real: 6, dotsNamed: true })))), newId);
    expect(gridsOf(named.rows)[0].carousel).toEqual({ dots: true });
    // Four dots for six slides three to a screen is neither the pages (2), the slides (6) nor the places it rests (4)... it is: 6 - 3 + 1.
    const tree = swiper({ real: 6 });
    tree.children[1].children[0].slider!.dots = { count: 4, role: "tablist", sel: "div[role=tablist]", box: [500, 500, 100, 10] };
    expect(gridsOf(buildReplica(input(capture(page(tree))), newId).rows)[0].carousel).toEqual({ dots: true });
    // Five dots match nothing.
    const odd = swiper({ real: 6 });
    odd.children[1].children[0].slider!.dots = { count: 5, role: "named", sel: "div.dots", box: [500, 500, 100, 10] };
    expect(gridsOf(buildReplica(input(capture(page(odd))), newId).rows)[0].carousel).toBeUndefined();
  });

  it("finds a bare row of small buttons equal to the slides, by where it stands", () => {
    const built = buildReplica(input(capture(page(swiper({ real: 6, dots: true })))), newId);
    expect(gridsOf(built.rows)[0].carousel).toEqual({ dots: true });
  });
});

describe("a fade slider: slides on top of each other, one showing", () => {
  const quote = (i: number, p: string, hide: boolean, o: { words?: string; extra?: boolean } = {}): CaptureNode => {
    const kids = [
      node({ p: `${p}/0`, tag: "img", box: [150, 210, 64, 64], s: { display: "block", objectFit: "cover", borderTopLeftRadius: "32px" }, media: { kind: "img", url: `https://source.test/face-${i}.jpg`, width: 200, height: 200, alt: `Face ${i}` } }),
      text("p", [230, 214, 520, 48], o.words ?? `Quote ${i}: they made it easy.`, { fontSize: "20px", lineHeight: "24px" }, { p: `${p}/1` }),
      text("p", [230, 270, 520, 24], `Customer ${i}`, { fontSize: "14px", lineHeight: "24px", fontWeight: "700" }, { p: `${p}/2` }),
      ...(o.extra ? [text("a", [230, 300, 110, 40], "Read more", { color: "rgb(255, 255, 255)", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { p: `${p}/3`, button: true, href: `https://source.test/q/${i}` })] : []),
    ];
    const card = node({ p, tag: "div", sel: "div.slide", box: [110, 200, 700, 160], s: { display: "block" } }, kids);
    card.slide = mark(card, hide ? { hide: "opacity" } : {});
    return card;
  };
  const fade = (n: number, o: { odd?: boolean; hero?: boolean; dots?: boolean } = {}) => {
    const slides = Array.from({ length: n }, (_, i) => quote(i, `0/1/0/${i}`, i > 0, o.odd && i === 2 ? { extra: true } : {}));
    const track = node({ p: "0/1/0", tag: "div", sel: "div.fade", box: [110, 200, 700, 160], s: { display: "block", position: "relative" }, scroll: true, slider: { kind: "stack", clip: [110, 200, 700, 160], tiles: n, hints: ["swiper-wrapper"], arrows: [], dots: o.dots === false ? null : { count: n, role: "named", sel: "div.dots", box: [400, 380, 80, 8] } } }, slides);
    return node({ p: "0", tag: "section", box: [0, 100, 1440, 360], s: { display: "block" } }, [
      text("h2", [110, 110, 600, 40], "Customers", { fontSize: "32px", lineHeight: "40px" }, { p: "0/0" }),
      node({ p: "0/1", tag: "div", sel: "div.wrap", box: [110, 200, 700, 160], s: { display: "block" } }, [track]),
    ]);
  };

  // The spec (D155, C4): the slides of a fade slider are read whether they show or not, and the group is built when their skeletons agree; the effect is replaced by
  // scrolling (said in the report), and the source's autoplay is not carried over (a fade is not a scroll); slides that differ keep the group as columns.
  it("is built from the slides' own words and pictures, one in view at every width, whatever is hidden", () => {
    const built = buildReplica(input(capture(page(fade(4)))), newId);
    const [grid] = gridsOf(built.rows);
    expect(grid.items).toHaveLength(4);
    // The quote is the largest text, so it is the item's title; the name under it is its text.
    expect(grid.items!.map((i) => i.title)).toEqual(["Quote 0: they made it easy.", "Quote 1: they made it easy.", "Quote 2: they made it easy.", "Quote 3: they made it easy."]);
    expect(grid.items!.map((i) => i.text)).toEqual(["Customer 0", "Customer 1", "Customer 2", "Customer 3"]);
    expect(grid.items![3].picture).toMatchObject({ alt: "Face 3" });
    expect(grid.display).toBe("carousel");
    expect(screens(grid)).toMatchObject({ desktop: 1, mobile: 1, tablet: 1 });
    expect(grid.gap).toBe(0);
    // No arrows beside this one, and as many dots as slides.
    expect(grid.carousel).toEqual({ arrows: false, dots: true });
    expect(built.grids.built[0].carousel).toMatchObject({ perScreen: { desktop: 1 }, script: { kind: "stack", hidden: 3 } });
  });

  it("says the effect is not the original's: the slides scroll instead of fading", () => {
    const lines = gridLines(buildReplica(input(capture(page(fade(4)))), newId).grids);
    expect(lines.problems.join(" ")).toContain("fades or swaps its slides in one place; as a carousel they scroll sideways instead");
  });

  it("does not carry the source's autoplay over to a carousel that scrolls instead of fading, and says it did not", () => {
    const tree = fade(4);
    tree.children[1].children[0].watch = { observed: true, watchedMs: 6500, seconds: 3, moves: 2, basis: "interval" };
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)[0].carousel).toEqual({ arrows: false, dots: true });
    expect(built.grids.built[0].carousel!.autoplay).toBe("not observed");
    const lines = gridLines(built.grids);
    expect(lines.well[0]).toContain("autoplay not observed (watched 6.5 s: it moved by itself, but its slides fade or swap in one place");
    expect(lines.problems.join(" ")).toContain("its autoplay is not carried over");
  });

  it("is kept as it was when the skeletons the browser read of the slides differ, though their boxes look alike", () => {
    const tree = fade(4);
    // The page drew slide 2 with a part the others do not have (read from its elements, so a slide with no box has one).
    tree.children[1].children[0].children[2].slide!.sig = "ITTTB";
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toContain("1 of 4 slides are built differently from the others (the slides out of view counted)");
  });

  it("is kept as it was when a slide out of view is built differently, and says so, with what the copy lacks", () => {
    const built = buildReplica(input(capture(page(fade(4, { odd: true })))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept).toHaveLength(1);
    expect(built.grids.kept[0]).toMatchObject({ slider: true, cards: 4 });
    expect(built.grids.kept[0].reason).toContain("structurally different siblings (1 box of 4 are built differently from the others)");
    expect(built.grids.kept[0].reason).toContain("the 3 slides out of view (");
    expect(built.dropped.some((d) => d.kind === "grid-columns")).toBe(true);
    // As before: only the slide that shows is in the copy; nothing hidden leaks into the rows.
    const json = JSON.stringify(built.rows);
    expect(json).toContain("Quote 0");
    expect(json).not.toContain("Quote 1");
    expect(json).not.toContain("Quote 3");
    expect(gridLines(built.grids).problems.join(" ")).toContain("were kept as columns");
  });

  it("is never taken for tabs: a stack of boxes of which one shows is a slider only when the page says so (a library's name, buttons, dots), by the extractor", () => {
    // The extractor's rule is tested in a real browser (e2e/replicate-adversarial.spec.ts); here: a track the extractor did not mark is no slider.
    const tree = fade(4);
    delete tree.children[1].children[0].slider;
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(built.grids.built.filter((g) => g.carousel?.script)).toEqual([]);
  });
});

describe("a slider the converter cannot understand", () => {
  it("stays as it was with the reason when its slides hold a second button, and no copy of the loop leaks into the rows", () => {
    const built = buildReplica(input(capture(page(swiper({ real: 5, head: 2, tail: 2, slides: () => ({ second: "Kjøp nå" }) })))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0]).toMatchObject({ slider: true });
    expect(built.grids.kept[0].reason).toMatch(/^5 of 5 slides hold a second (link|button)/);
    expect(built.grids.kept[0].reason).toContain("out of view");
    // The page as before: the slides in view as columns, never a copy or a slide out of view.
    const slides = built.rows.flatMap((row) => row.columns).length;
    expect(slides).toBeLessThanOrEqual(4);
    expect(JSON.stringify(built.rows)).not.toContain("Title 4");
  });

  it("is reported with the reason in the facts the report is made from", () => {
    const built = buildReplica(input(capture(page(swiper({ real: 5, slides: () => ({ second: "Kjøp nå" }) })))), newId);
    expect(gridLines(built.grids).problems.join(" ")).toMatch(/were kept as columns: 5 of 5 slides hold a second/);
  });

  it("is a slider with slides that are not cards of one kind when their widths differ", () => {
    const tree = swiper({ real: 5 });
    tree.children[1].children[0].children[1].box = [430, 170, 120, 420];
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept.length).toBeGreaterThan(0);
  });
});

describe("a native scroller that the watch saw move", () => {
  it("takes the autoplay the watch saw, as a script slider does", () => {
    const w = 290;
    const cards = Array.from({ length: 6 }, (_, i) => {
      const c = slide(i, `0/1/0/${i}`, [110 + i * (w + 20), 170, w]);
      delete c.slide;
      c.s = { ...c.s, scrollSnapAlign: "start" };
      return c;
    });
    const trackNode = node({ p: "0/1/0", tag: "div", sel: "div.track", scroll: true, box: [110, 170, 910, 420], s: { display: "flex", overflowX: "auto", scrollSnapType: "x mandatory" }, watch: { observed: true, watchedMs: 9000, seconds: 3, moves: 3, basis: "interval" } }, cards);
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 560], s: { display: "block" } }, [
      text("h2", [110, 110, 600, 40], "Popular", { fontSize: "32px", lineHeight: "40px" }, { p: "0/0" }),
      node({ p: "0/1", tag: "div", box: [60, 170, 1110, 420], s: { display: "block" } }, [trackNode]),
    ]);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)[0].carousel).toEqual({ arrows: false, autoplay: { seconds: 3 } });
    expect(built.grids.built[0].carousel!.script).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("the words are the slide's, exactly", () => {
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const WORDS = ["fjord", "båt", "kaffe", "Sommer", "tilbud", "natural", "cotton", "rea", "nyhet", "limited", "edition", "kjøp", "billig", "gave", "ny", "stor", "liten", "åpen", "lørdag"];

  it("builds only items made of words found in the real slides, never a copy's, and loses none, over many random sliders", () => {
    let built = 0;
    let kept = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      const pick = () => WORDS[Math.floor(r() * WORDS.length)];
      const sentence = (n: number) => Array.from({ length: n }, pick).join(" ");
      const real = 3 + Math.floor(r() * 5);
      let head = Math.floor(r() * 3);
      const tail = Math.floor(r() * 3);
      const marking: SwiperOpts["mark"] = r() < 0.6 ? "marker" : "none";
      const options: CardOpts[] = Array.from({ length: real }, (_, i) => ({ title: `${sentence(1 + Math.floor(r() * 2))} ${i}`, text: sentence(3 + Math.floor(r() * 10)), second: r() < 0.05 ? sentence(1) : undefined }));
      const keys = r() < 0.7;
      // Without a marker or a number of the library's own, copies are told only by standing at both ends of the track or as a run of two at one end (`loopedEnds()`):
      // one slide repeated at one end alone is a list that ends as it began, and no loop.
      if (marking === "none" && !keys && head + tail === 1) head = 2;
      const tree = swiper({ real, head, tail, mark: marking, keys, slides: (i) => options[i] });
      const out = buildReplica(input(capture(page(tree))), newId);
      const grid = gridsOf(out.rows)[0];
      const wrapper = tree.children[1].children[0];
      // The copies made to loop say exactly what their originals say, so a copy that got in would double an item.
      const read = readSlider(wrapper)!;
      expect(read.real, `seed ${seed}`).toHaveLength(real);
      if (!grid) {
        kept += 1;
        expect(out.grids.kept[0]?.slider).toBe(true);
        continue;
      }
      built += 1;
      expect(grid.items, `seed ${seed}`).toHaveLength(real);
      grid.items!.forEach((item, i) => {
        const tile = read.real[i];
        const leaves: CaptureNode[] = [];
        const visit = (n: CaptureNode) => (n.runs ? leaves.push(n) : n.children.forEach(visit));
        visit(tile);
        const tileWords = [...leaves.flatMap((l) => tokensOf(runsText(l.runs))), ...tokensOf(tile.slide!.text)];
        const available = new Map<string, number>();
        for (const w of leaves.flatMap((l) => tokensOf(runsText(l.runs)))) available.set(w, (available.get(w) ?? 0) + 1);
        const itemWords = [item.title, item.text, item.buttonLabel, item.badge, item.priceText, ...item.details.flatMap((d) => [d.label, d.text])].flatMap(tokensOf);
        for (const w of itemWords) {
          const n = available.get(w) ?? 0;
          expect(n, `seed ${seed} slide ${i}: "${w}" is not in the slide`).toBeGreaterThan(0);
          available.set(w, n - 1);
        }
        for (const [w, n] of available) expect(n, `seed ${seed} slide ${i}: "${w}" was lost`).toBeLessThanOrEqual(0);
        // What the browser read of the slide as words is no more than what the item holds.
        expect(tileWords.length).toBeGreaterThan(0);
        if (item.link) expect(item.link, `seed ${seed} item ${i} ${JSON.stringify({ real, head, tail, marking, keys })}`).toEqual({ kind: "url", url: `https://source.test/p/${i}` });
        if (item.picture) expect(item.picture.alt).toBe(`Photo ${i}`);
      });
      // Every title once, in order: no slide twice, none skipped.
      expect(titlesOf(grid), `seed ${seed}`).toEqual(options.map((o) => o.title));
    }
    expect(built).toBeGreaterThan(100);
    expect(built + kept).toBe(150);
  });

  it("refuses a slide whose page drew words the card's pieces do not hold, rather than lose them", () => {
    const tree = swiper({ real: 4 });
    const wrapper = tree.children[1].children[0];
    // The browser read a word in slide 2 that no captured piece of it has (text a piece's runs skipped).
    wrapper.children[2].slide!.text += " hemmelig";
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toContain("have more words than an item holds");
  });
});
