import { describe, expect, it } from "vitest";

import { figmaFrame, figmaToCapture, pictureKeys, type FigmaFrame, type FigmaNode } from "./figma-capture";
import { buildReplica } from "./replicate-build";
import { walk } from "./replicate-capture";

const white = { r: 1, g: 1, b: 1, a: 1 };
const ink = { r: 0.07, g: 0.07, b: 0.07, a: 1 };
const brand = { r: 0.1, g: 0.6, b: 0.3, a: 1 };

const text = (id: string, t: string, size: number, box: FigmaNode["box"], extra: Partial<FigmaNode["text"] & object> = {}): FigmaNode => ({
  id,
  type: "TEXT",
  name: t.slice(0, 20),
  box,
  text: { align: "LEFT", runs: [{ t, family: "Inter", style: "Regular", weight: size > 30 ? 700 : 400, size, color: ink, line: Math.round(size * 1.3), tracking: 0 }], ...extra },
});

/** A hero as a designer draws it: a column with a heading, a paragraph and a button, beside a picture. */
const frame: FigmaFrame = {
  name: "Home",
  width: 1440,
  height: 900,
  tree: {
    id: "1:1",
    type: "FRAME",
    name: "Home",
    box: [0, 0, 1440, 900],
    fills: [{ type: "SOLID", color: white }],
    children: [
      {
        id: "1:2",
        type: "FRAME",
        name: "Hero",
        box: [0, 0, 1440, 700],
        layout: { mode: "HORIZONTAL", wrap: false, gap: 48, crossGap: 0, padding: [96, 120, 96, 120], main: "MIN", cross: "CENTER" },
        children: [
          {
            id: "1:3",
            type: "FRAME",
            name: "Copy",
            box: [120, 180, 560, 340],
            layout: { mode: "VERTICAL", wrap: false, gap: 24, crossGap: 0, padding: [0, 0, 0, 0], main: "MIN", cross: "MIN" },
            children: [
              text("1:4", "Handmade mugs", 64, [120, 180, 560, 84]),
              text("1:5", "Glazed in small batches in Bergen.\nEach one a little different.", 18, [120, 288, 560, 56]),
              {
                id: "1:6",
                type: "FRAME",
                name: "Button",
                box: [120, 368, 180, 52],
                fills: [{ type: "SOLID", color: brand }],
                corners: [26, 26, 26, 26],
                layout: { mode: "HORIZONTAL", wrap: false, gap: 0, crossGap: 0, padding: [14, 28, 14, 28], main: "CENTER", cross: "CENTER" },
                children: [text("1:7", "Shop the mugs", 16, [148, 382, 124, 24], { runs: [{ t: "Shop the mugs", family: "Inter", style: "Semi Bold", weight: 600, size: 16, color: white, line: 24, tracking: 0, href: "https://example.com/mugs" }] })],
              },
            ],
          },
          { id: "1:8", type: "RECTANGLE", name: "Photo", box: [728, 96, 592, 508], corners: [24, 24, 24, 24], fills: [{ type: "IMAGE", hash: "abc123", scale: "FILL" }] },
        ],
      },
      { id: "1:9", type: "VECTOR", name: "Logo", box: [120, 760, 96, 32], shot: "shot:1:9" },
    ],
  },
};

const pictures = new Map([
  ["image:abc123", { url: "https://files.example/mug.webp", width: 1184, height: 1016 }],
  ["shot:1:9", { url: "https://files.example/logo.webp", width: 192, height: 64 }],
]);

describe("a Figma frame read as a page (D898 F2)", () => {
  it("checks what the plugin sends, and names the pictures it uses", () => {
    expect(figmaFrame.safeParse(frame).success).toBe(true);
    expect(figmaFrame.safeParse({ ...frame, tree: { ...frame.tree, box: [0, 0, -1, 2] } }).success).toBe(false);
    expect(pictureKeys(frame).sort()).toEqual(["image:abc123", "shot:1:9"]);
  });

  it("turns auto layout into flex boxes, text into a heading and a paragraph, a painted box with a label into a button, and pictures into the library's", () => {
    const capture = figmaToCapture(frame, pictures, "Shop.fig");
    const nodes = [...walk(capture.root)];
    const hero = nodes.find((n) => n.p === "0/0")!;
    expect(hero).toMatchObject({ tag: "section", s: { display: "flex", flexDirection: "row", columnGap: "48px", paddingLeft: "120px", alignItems: "center" } });
    const h1 = nodes.find((n) => n.tag === "h1")!;
    expect(h1.runs).toEqual([{ t: "Handmade mugs", b: 1 }]);
    expect(h1.s).toMatchObject({ fontSize: "64px", fontWeight: "700", fontFamily: '"Inter", sans-serif' });
    const p = nodes.find((n) => n.tag === "p")!;
    expect(p.runs).toEqual([{ t: "Glazed in small batches in Bergen." }, { t: "", br: 1 }, { t: "Each one a little different." }]);
    const button = nodes.find((n) => n.button)!;
    expect(button).toMatchObject({ tag: "a", href: "https://example.com/mugs", s: { backgroundColor: "rgb(26, 153, 77)", borderTopLeftRadius: "26px" } });
    expect(nodes.find((n) => n.media?.kind === "img" && n.media.url.endsWith("mug.webp"))).toMatchObject({ box: [728, 96, 592, 508] });
    expect(nodes.some((n) => n.media?.kind === "img" && n.media.url.endsWith("logo.webp"))).toBe(true);
    expect(capture.fonts.map((f) => f.family)).toEqual(["Inter", "Inter", "Inter"]);
    expect(capture.background).toBe("rgb(255, 255, 255)");
  });

  it("leaves out a picture the plugin did not send", () => {
    const capture = figmaToCapture(frame, new Map(), "Shop.fig");
    expect([...walk(capture.root)].some((n) => n.media)).toBe(false);
  });

  it("is built by the page copy engine into rows with a heading, text, a picture and a button", () => {
    const capture = figmaToCapture(frame, pictures, "Shop.fig");
    let n = 0;
    const built = buildReplica(
      {
        desktop: capture,
        mobile: null,
        picture: (url) => (url.endsWith("mug.webp") ? { url, width: 1184, height: 1016 } : url.endsWith("logo.webp") ? { url, width: 192, height: 64 } : null),
        shot: () => null,
        video: () => null,
        font: (family) => family,
      },
      () => `id-${++n}`,
    );
    expect(built.rows.length).toBeGreaterThan(0);
    expect(built.counts.headings).toBeGreaterThanOrEqual(1);
    expect(built.counts.pictures).toBeGreaterThanOrEqual(1);
    expect(built.counts.buttons).toBe(1);
  });
});
