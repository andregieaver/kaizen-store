import { describe, expect, it } from "vitest";

import { newPageContent, pageInput, type PageBlock, type PageRow } from "./page-content";
import { BACKDROP_BELOW, buildFitted, weakRows, type Side } from "./replicate-backdrop";
import { backdropKey, buildReplica, type Backdrop, type BuildInput } from "./replicate-build";
import { alignTrees, type Box, type CaptureNode, type PageCapture, type Run } from "./replicate-capture";
import { renderStyles } from "./replicate-styles";

let counter = 0;
const newId = () => `id-${++counter}`;
const node = (spec: Partial<CaptureNode> & { tag: string; box: Box; p: string }, children: CaptureNode[] = []): CaptureNode => ({ s: { display: "block" }, children, ...spec });
const run = (t: string): Run[] => [{ t }];
const text = (p: string, box: Box, t: string, s: Record<string, string> = {}): CaptureNode =>
  node({ p, tag: "p", box, s: { display: "block", fontSize: "16px", lineHeight: "24px", fontWeight: "400", color: "rgb(30, 30, 30)", fontFamily: "Inter, sans-serif", textAlign: "left", ...s }, runs: run(t) });
const capture = (root: CaptureNode, width: number): PageCapture => ({
  viewport: { w: width, h: 900 },
  url: "https://example.com/",
  title: "Example",
  lang: "en",
  description: "",
  docWidth: width,
  docHeight: 1200,
  background: "rgb(255, 255, 255)",
  root,
  fonts: [],
  left: { fixed: [], hidden: 0, capped: false },
});
const body = (...kids: CaptureNode[]) => node({ p: "", tag: "body", box: [0, 0, 1440, 1200] }, kids);

describe("finding a phone's element when the phone's page has one element more", () => {
  const section = (prefix: string, width: number) =>
    node({ p: prefix, tag: "section", sel: "section.hero", box: [0, 0, width, 300] }, [
      node({ p: `${prefix}/0`, tag: "div", sel: "div.a", box: [0, 0, width, 100] }),
      node({ p: `${prefix}/1`, tag: "div", sel: "div.b", box: [0, 100, width, 100] }),
    ]);

  it("pairs by tag and classes in order, not by path", () => {
    const desktop = body(node({ p: "0", tag: "div", sel: "div.bar", box: [0, 0, 1440, 30] }), section("1", 1440));
    // A cookie banner stands first on the phone: every path after it is one more.
    const phone = body(node({ p: "0", tag: "div", sel: "div.cookie", box: [0, 0, 390, 80] }), node({ p: "1", tag: "div", sel: "div.bar", box: [0, 0, 390, 30] }), section("2", 390));
    const found = alignTrees(desktop, phone);
    expect(found.get("1")?.p).toBe("2");
    expect(found.get("1/1")?.p).toBe("2/1");
    expect(found.get("0")?.p).toBe("1");
  });

  it("builds the phone's rules from the matched elements (a path match alone would have found none)", () => {
    const bar = (p: string, w: number) => node({ p, tag: "div", sel: "div.bar", box: [0, 0, w, 40], s: { display: "block", backgroundColor: "rgb(10, 20, 30)" } }, [text(`${p}/0`, [20, 8, w - 40, 24], "Free shipping", { color: "rgb(255, 255, 255)" })]);
    const desktop = capture(body(bar("0", 1440), node({ p: "1", tag: "div", sel: "div.rest", box: [0, 40, 1440, 100], s: { display: "block", backgroundColor: "rgb(240, 240, 240)" } }, [text("1/0", [20, 60, 600, 24], "Welcome")])), 1440);
    const mobileRoot = body(node({ p: "0", tag: "div", sel: "div.cookie", box: [0, 0, 390, 0] }), bar("1", 390), node({ p: "2", tag: "div", sel: "div.rest", box: [0, 40, 390, 100], s: { display: "block", backgroundColor: "rgb(240, 240, 240)" } }, [text("2/0", [20, 60, 350, 24], "Welcome")]));
    const built = buildReplica({ desktop, mobile: capture(mobileRoot, 390), picture: () => null, shot: () => null, video: () => null, font: () => null }, newId);
    const rows = built.parts.filter((p) => p.kind === "row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.targetM !== null)).toBe(true);
  });
});

describe("a row kept as a picture of the original", () => {
  const hero = (): CaptureNode =>
    node({ p: "0", tag: "section", sel: "section.hero", box: [0, 0, 1440, 400], s: { display: "block", backgroundColor: "rgb(20, 24, 40)" } }, [
      text("0/0", [300, 100, 840, 60], "Which ripple are you?", { fontSize: "48px", lineHeight: "60px", color: "rgb(255, 255, 255)", textAlign: "center" }),
      text("0/1", [300, 200, 840, 28], "from ice to heat", { fontSize: "20px", lineHeight: "28px", color: "rgb(255, 255, 255)", textAlign: "center" }),
    ]);
  const base = (over: Partial<BuildInput> = {}): BuildInput => ({ desktop: capture(body(hero()), 1440), mobile: null, picture: () => null, shot: () => null, video: () => null, font: () => null, ...over });
  const pic = (name: string) => ({ url: `/${name}.png`, width: 1440, height: 400 });
  const backdrop: Backdrop = { text: { desktop: pic("bare"), phone: null }, plain: { desktop: pic("full"), phone: null } };
  const keyOf = (b: ReturnType<typeof buildReplica>) => {
    const row = b.parts.find((p) => p.kind === "row")!;
    return backdropKey(row.path, row.target![1]);
  };
  const blocks = (rows: PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));

  it("is the strip as the row's background with each piece of text placed where it stood", () => {
    const first = buildReplica(base(), newId);
    const key = keyOf(first);
    const built = buildReplica(base({ backdrop: (k) => (k === key ? backdrop : null) }), newId);
    const css = renderStyles(built.model, built.shared).css;
    expect(css).toContain('background-image:url("/bare.png")');
    expect(css).toContain("position:absolute");
    expect(blocks(built.rows).filter((b) => b.type === "richText" || b.type === "heading")).toHaveLength(2);
    expect(built.dropped.some((d) => d.kind === "row-as-picture")).toBe(true);
    expect(pageInput.safeParse({ ...newPageContent(), title: "t", slug: "t", rows: built.rows, css }).success).toBe(true);
  });

  it("is only the picture, its words hidden, when asked", () => {
    const key = keyOf(buildReplica(base(), newId));
    const built = buildReplica(base({ backdrop: (k) => (k === key ? backdrop : null), backdropPlain: new Set([key]) }), newId);
    const css = renderStyles(built.model, built.shared).css;
    expect(css).toContain('background-image:url("/full.png")');
    expect(css).toContain("opacity:0");
    const all = blocks(built.rows);
    expect(all).toHaveLength(1);
    expect(JSON.stringify(all[0])).toContain("Which ripple are you?");
  });

  it("stays words over the picture when there is no strip with its words to make it plain with", () => {
    const key = keyOf(buildReplica(base(), newId));
    const only: Backdrop = { text: backdrop.text, plain: null };
    const built = buildReplica(base({ backdrop: (k) => (k === key ? only : null), backdropPlain: new Set([key]) }), newId);
    expect(renderStyles(built.model, built.shared).css).toContain('background-image:url("/bare.png")');
    expect(blocks(built.rows).filter((b) => b.type === "richText" || b.type === "heading")).toHaveLength(2);
  });

  it("is left to `buildFitted()` to make plain only when the words would not fit the page's CSS", () => {
    const key = keyOf(buildReplica(base(), newId));
    const fitted = buildFitted(base({ backdrop: (k) => (k === key ? backdrop : null) }), newId);
    // A small page fits: the words stay over the picture.
    expect(fitted.plain).toEqual([]);
    expect(fitted.styled.level).toBe(0);
  });
});

describe("choosing the rows that match badly", () => {
  const solid = (w: number, h: number, v: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
  it("names a row whose stretch of the copy differs, at its own place in the copy", () => {
    const side: Side = { original: solid(10, 100, 0), copy: solid(10, 100, 255), scale: 10 };
    const row = { id: "rp1", path: "0", kind: "row" as const, row: "rp1", target: [0, 100, 1440, 400] as Box, targetM: null };
    const copyRoot = body(node({ p: "0", id: "rp1", tag: "div", box: [0, 100, 1440, 400] }));
    const weak = weakRows([row], side, null, capture(copyRoot, 1440), null, BACKDROP_BELOW.last);
    expect(weak.map((w) => w.part.id)).toEqual(["rp1"]);
    const same: Side = { original: solid(10, 100, 7), copy: solid(10, 100, 7), scale: 10 };
    expect(weakRows([row], same, null, capture(copyRoot, 1440), null, BACKDROP_BELOW.last)).toEqual([]);
  });
});

describe("a box with no size of its own", () => {
  it("shows what it holds when it does not clip (a nav of absolutely placed lists)", () => {
    const nav = node({ p: "0", tag: "nav", box: [1300, 0, 0, 60], s: { display: "block" } }, [
      node({ p: "0/0", tag: "div", box: [0, 0, 1440, 60], s: { display: "block", position: "absolute" } }, [text("0/0/0", [400, 10, 100, 24], "Shop All")]),
    ]);
    const built = buildReplica({ desktop: capture(body(nav), 1440), mobile: null, picture: () => null, shot: () => null, video: () => null, font: () => null }, newId);
    expect(JSON.stringify(built.rows)).toContain("Shop All");
  });
});
