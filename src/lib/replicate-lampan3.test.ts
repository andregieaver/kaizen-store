import { describe, expect, it } from "vitest";

import type { ContentGridBlock, PageBlock, PageRow } from "./page-content";
import { buildReplica, liftBackdrops, type BuildInput } from "./replicate-build";
import type { Box, CaptureNode, PageCapture, Run } from "./replicate-capture";
import { pictureFrameOf } from "./replicate-grid";
import { cleanDecl, renderStyles } from "./replicate-styles";

/**
 * What the third look at lampan.no (D150) found: a strip of links read as a stack, a link drawn as a button inside a sentence, a text a "read more"
 * box cuts, plain links centred like buttons, a hero's corners lost with its picture, and product cards whose photo sits in a panel taller than it.
 */

let counter = 0;
const newId = () => `id-${++counter}`;
type Spec = Partial<CaptureNode> & { tag: string; box: Box };
let seq = 0;
const node = (spec: Spec, children: CaptureNode[] = []): CaptureNode => ({ p: spec.p ?? `n${++seq}`, s: { display: "block" }, children, ...spec });
const words = (t: string): Run[] => [{ t }];
const text = (tag: string, box: Box, t: string, s: Record<string, string> = {}, extra: Partial<CaptureNode> = {}): CaptureNode =>
  node({ tag, box, s: { display: "block", fontSize: "16px", lineHeight: "24px", fontWeight: "400", color: "rgb(30, 30, 30)", fontFamily: "Inter, sans-serif", textAlign: "left", ...s }, runs: words(t), ...extra });
const capture = (root: CaptureNode, width = 1440): PageCapture => ({
  viewport: { w: width, h: 900 },
  url: "https://example.com/",
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
const input = (desktop: PageCapture, mobile: PageCapture | null = null): BuildInput => ({
  desktop,
  mobile,
  picture: (url) => ({ url: `https://files.test/${url.split("/").pop()}`, width: 800, height: 600 }),
  shot: () => null,
  video: () => null,
  font: (family) => (family === "Inter" ? "Inter" : null),
});
const page = (...children: CaptureNode[]) => node({ p: "", tag: "body", box: [0, 0, 1440, 3000], s: { display: "block" } }, children);
const blocksOf = (rows: PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
const cssOf = (built: ReturnType<typeof buildReplica>) => renderStyles(built.model, built.shared).css;

describe("a strip of links side by side", () => {
  const strip = () =>
    node({ p: "0", tag: "section", box: [0, 0, 1440, 40], s: { display: "block" } }, [
      node({ p: "0/0", tag: "ul", box: [80, 10, 164, 20], s: { display: "inline-flex", columnGap: "25px", listStyleType: "none" } }, [
        text("li", [80, 10, 78, 20], "Kundeservice", { fontSize: "12.5px", lineHeight: "20px", display: "block" }, { p: "0/0/0" }),
        text("li", [183, 10, 61, 20], "Mine sider", { fontSize: "12.5px", lineHeight: "20px", display: "block" }, { p: "0/0/1" }),
      ]),
    ]);

  it("stays a row of its items with the gap between them, in the type of its items, and does not wrap", () => {
    const css = cssOf(buildReplica(input(capture(page(strip()))), newId));
    expect(css).toMatch(/:is\(ul,ol\)\{display:flex;flex-wrap:nowrap;white-space:nowrap;column-gap:25px;padding-left:0px;list-style-type:none\}/);
    expect(css).toContain("font-size:12.5px");
  });
});

describe("a text a read-more box cuts", () => {
  it("is clipped at the height the visitor saw", () => {
    const cut = text("p", [100, 100, 600, 124], "A long text that goes on and on, of which only some lines are seen.", {}, { cut: true });
    const css = cssOf(buildReplica(input(capture(page(node({ p: "0", tag: "section", box: [0, 100, 1440, 124], s: { display: "block" } }, [cut])))), newId));
    expect(css).toContain("max-height:124px");
    expect(css).toContain("overflow:hidden");
  });
});

describe("links set as plain text", () => {
  const link = (align: string) => node({ p: "0/0", tag: "a", href: "https://example.com/x", button: true, box: [100, 100, 200, 25], runs: words("Kontakt"), s: { display: "block", fontSize: "16px", lineHeight: "25px", color: "rgb(255, 255, 255)", fontFamily: "Inter, sans-serif", textAlign: align } });
  it("keep the side their words stand on, and a filled button keeps its label centred", () => {
    const plain = cssOf(buildReplica(input(capture(page(node({ p: "0", tag: "section", box: [0, 100, 1440, 25], s: { display: "block" } }, [link("start")])))), newId));
    expect(plain).toMatch(/text-align:left;justify-content:flex-start/);
    const filled = link("start");
    filled.s = { ...filled.s, backgroundColor: "rgb(211, 67, 8)" };
    const pill = cssOf(buildReplica(input(capture(page(node({ p: "0", tag: "section", box: [0, 100, 1440, 25], s: { display: "block" } }, [filled])))), newId));
    expect(pill).toMatch(/text-align:center;justify-content:center/);
  });
});

describe("a hero picture lifted onto a wrapper", () => {
  it("takes the corners of the box that held it", () => {
    const radius = { borderTopLeftRadius: "10px", borderTopRightRadius: "10px", borderBottomRightRadius: "10px", borderBottomLeftRadius: "10px" };
    const img = node({ p: "0/0/0/0", tag: "img", box: [80, 0, 635, 484], s: { display: "inline" }, media: { kind: "img", url: "https://example.com/hero.jpg", width: 800, height: 600, alt: "" } });
    const holder = node({ p: "0/0/0", tag: "div", box: [80, 0, 635, 484], s: { display: "block", ...radius } }, [node({ p: "0/0/0/0x", tag: "p", box: [80, 0, 635, 484] }, [img]), text("h2", [200, 160, 300, 40], "Title", {}, { p: "0/0/0/1" })]);
    const wrapper = node({ p: "0/0", tag: "div", box: [80, 0, 635, 484], s: { display: "block" } }, [holder]);
    const lifted = liftBackdrops(capture(page(node({ p: "0", tag: "section", box: [0, 0, 1440, 484], s: { display: "block" } }, [wrapper])))).capture;
    const found = [...(function* walk(n: CaptureNode): Generator<CaptureNode> {
      yield n;
      for (const c of n.children) yield* walk(c);
    })(lifted.root)].filter((n) => n.s.backgroundImage?.startsWith("url("));
    expect(found).toHaveLength(1);
    expect(found[0].s.borderTopLeftRadius).toBe("10px");
  });
});

describe("a product's picture in a panel taller than it", () => {
  /** A card 313 wide: a panel 375 high holding a photo 190 x 285 and a badge, then the words under it (lampan.no). */
  const card = (i: number, x: number): CaptureNode => {
    const p = (k: string) => `0/1/${i}/${k}`;
    const img = node({ p: p("0/0/0"), tag: "img", box: [x + 61, 20, 190, 285], s: { display: "block", position: "absolute" }, media: { kind: "img", url: `https://shop.test/lamp-${i}.jpg`, width: 190, height: 285, alt: `Lamp ${i}` } });
    const badge = text("span", [x + 15, 340, 108, 23], "OKTOBERFEST", { fontSize: "13px", backgroundColor: "rgb(211, 67, 8)", color: "rgb(255, 255, 255)", display: "inline" }, { p: p("0/1/0") });
    const panel = node({ p: p("0"), tag: "div", box: [x, 0 + 20 - 20, 313, 375], s: { display: "block" } }, [
      node({ p: p("0/0"), tag: "a", href: `https://shop.test/p/${i}`, box: [x, 0, 313, 375], s: { display: "block" } }, [img]),
      node({ p: p("0/1"), tag: "div", box: [x + 15, 340, 108, 23], s: { display: "block", position: "absolute" } }, [badge]),
    ]);
    const brand = text("p", [x + 3, 393, 290, 18], `Brand ${i}`, { fontSize: "12px", lineHeight: "18px" }, { p: p("1/0") });
    const title = text("h3", [x + 3, 411, 290, 17], `Lamp ${i}`, { fontSize: "14px", lineHeight: "17px" }, { p: p("1/1") });
    const price = text("span", [x + 3, 437, 60, 18], "kr 2 514", { fontSize: "16px", lineHeight: "18px", fontWeight: "600" }, { p: p("1/2") });
    const old = text("span", [x + 3, 455, 60, 16], "Veil. kr 3 711", { fontSize: "12px", lineHeight: "16px" }, { p: p("1/3") });
    return node({ p: p("").replace(/\/$/, ""), tag: "li", box: [x, 0, 313, 490], s: { display: "block", backgroundColor: "rgb(255, 255, 255)" } }, [panel, node({ p: p("1"), tag: "div", box: [x + 3, 393, 290, 100], s: { display: "block" } }, [brand, title, price, old])]);
  };
  const grid = () => node({ p: "0/1", tag: "ul", box: [80, 0, 1280, 490], s: { display: "flex" } }, [0, 1, 2, 3].map((i) => card(i, 80 + i * 323)));
  const section = () => node({ p: "0", tag: "section", box: [0, 0, 1440, 490], s: { display: "block" } }, [text("h2", [80, 0, 300, 30], "", {}, { p: "0/0", runs: [] }), grid()]);

  it("finds the panel: the outermost box holding the picture and only overlays, not the card's words", () => {
    const cardNode = card(0, 80);
    const img = cardNode.children[0].children[0].children[0];
    const frame = pictureFrameOf(cardNode, img);
    expect(frame).not.toBeNull();
    expect(frame!.box).toEqual([80, 0, 313, 375]);
  });

  it("is no panel when the picture fills the card's room", () => {
    const filled = node({ p: "c", tag: "li", box: [0, 0, 300, 400], s: { display: "block" } }, [node({ p: "c/0", tag: "img", box: [0, 0, 300, 300], s: { display: "block" }, media: { kind: "img", url: "https://shop.test/a.jpg", width: 300, height: 300, alt: "" } })]);
    expect(pictureFrameOf(filled, filled.children[0])).toBeNull();
  });

  it("draws the picture as the panel with its room as padding, and puts the words where they stood, in the order they stood", () => {
    const built = buildReplica(input(capture(page(section()))), newId);
    const grids = blocksOf(built.rows).filter((b): b is ContentGridBlock => b.type === "contentGrid");
    expect(grids).toHaveLength(1);
    const items = grids[0].items!;
    // The brand above the title is a line of detail, the label on the picture the badge.
    expect(items[0]).toMatchObject({ title: "Lamp 0", badge: "OKTOBERFEST", priceText: "kr 2 514" });
    expect(items[0].details.map((d) => d.text)).toEqual(["Brand 0"]);
    const css = cssOf(built);
    const id = grids[0].htmlId;
    expect(css).toContain(`#${id} li[data-item-id] img{`);
    expect(css).toMatch(/aspect-ratio:313 \/ 375;object-fit:fill;background-color:transparent;padding-top:6\.4%;padding-right:19\.8%;padding-bottom:22\.4%;padding-left:19\.5%/);
    // The badge by its corner of the panel, the details before the title, the price before the old price.
    expect(css).toMatch(/span\.bg-accent\{[^}]*position:absolute;top:auto;bottom:12px;left:15px;right:auto\}/);
    const order = (sel: string) => Number(new RegExp(`${sel.replace(/[()[\].*>,]/g, "\\$&")}\\{order:(\\d+)`).exec(css)?.[1]);
    expect(order(`#${id} li[data-item-id] > ul.text-muted`)).toBeLessThan(order(`#${id} li[data-item-id] > :is(h2,h3,h4,h5,h6)`));
    expect(css).toContain(`#${id} li[data-item-id]{`);
    expect(css).toMatch(/row-gap:0px/);
  });
});

describe("the style whitelist for placing a part", () => {
  it("takes an order, offsets and a position inside its own box, never a position fixed to the screen", () => {
    expect(cleanDecl("order", "2")).toBe("2");
    expect(cleanDecl("bottom", "12px")).toBe("12px");
    expect(cleanDecl("position", "absolute")).toBe("absolute");
    expect(cleanDecl("position", "fixed")).toBeNull();
    expect(cleanDecl("position", "sticky")).toBeNull();
  });
});
