import { describe, expect, it, vi } from "vitest";

import { cssProblem } from "./custom-css";
import { newPageContent, pageInput, type ImageBlock, type PageBlock, type PageRow } from "./page-content";
import { buildReplica, SHARED_CSS, type BuildInput } from "./replicate-build";
import type { Box, CaptureNode, PageCapture, Run } from "./replicate-capture";
import { renderStyles } from "./replicate-styles";

let counter = 0;
const newId = () => `id-${++counter}`;

type Spec = Partial<CaptureNode> & { tag: string; box: Box };
let path = 0;
const node = (spec: Spec, children: CaptureNode[] = []): CaptureNode => ({ p: spec.p ?? `n${++path}`, s: { display: "block" }, children, ...spec });
const words = (text: string): Run[] => [{ t: text }];
const text = (tag: string, box: Box, t: string, s: Record<string, string> = {}, extra: Partial<CaptureNode> = {}): CaptureNode =>
  node({ tag, box, s: { display: "block", fontSize: "16px", lineHeight: "24px", fontWeight: "400", color: "rgb(30, 30, 30)", fontFamily: "Inter, sans-serif", textAlign: "left", ...s }, runs: words(t), ...extra });

const capture = (root: CaptureNode, width = 1440, extra: Partial<PageCapture> = {}): PageCapture => ({
  viewport: { w: width, h: 900 },
  url: "https://example.com/",
  title: "Example page",
  lang: "en",
  description: "A page",
  docWidth: width,
  docHeight: 3000,
  background: "rgb(255, 255, 255)",
  root,
  fonts: [],
  left: { fixed: [], hidden: 0, capped: false },
  ...extra,
});

const input = (desktop: PageCapture, mobile: PageCapture | null = null, over: Partial<BuildInput> = {}): BuildInput => ({
  desktop,
  mobile,
  picture: (url) => ({ url: `https://files.test/${url.split("/").pop()}`, width: 800, height: 600 }),
  shot: () => null,
  video: () => null,
  font: (family) => (family === "Inter" ? "Inter" : null),
  ...over,
});

const blocksOf = (rows: PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));

/** A section the colour of ink, 1440 wide, holding a heading, a paragraph and a button. */
function hero(prefix = ""): CaptureNode {
  return node({ p: `${prefix}0`, tag: "section", box: [0, 0, 1440, 400], s: { display: "block", backgroundColor: "rgb(20, 24, 40)", paddingTop: "80px", paddingBottom: "80px" } }, [
    node({ p: `${prefix}0/0`, tag: "div", box: [320, 80, 800, 240], s: { display: "block" } }, [
      text("h1", [320, 80, 800, 60], "Make it better, every day", { fontSize: "48px", lineHeight: "60px", fontWeight: "700", color: "rgb(255, 255, 255)", textAlign: "center" }, { p: `${prefix}0/0/0` }),
      text("p", [320, 160, 800, 56], "Small steps add up to large changes.", { fontSize: "20px", lineHeight: "28px", color: "rgb(200, 200, 210)", textAlign: "center" }, { p: `${prefix}0/0/1` }),
      text("a", [620, 250, 200, 56], "Get started", { color: "rgb(255, 255, 255)", backgroundColor: "rgb(79, 70, 229)", textAlign: "center", paddingTop: "16px", paddingBottom: "16px", paddingLeft: "32px", paddingRight: "32px", borderTopLeftRadius: "8px", borderTopRightRadius: "8px", borderBottomRightRadius: "8px", borderBottomLeftRadius: "8px" }, { p: `${prefix}0/0/2`, button: true, href: "https://example.com/start" }),
    ]),
  ]);
}

const page = (...sections: CaptureNode[]) => node({ p: "", tag: "body", box: [0, 0, 1440, 3000], s: { display: "block" } }, sections);

describe("converting a captured page into rows and blocks", () => {
  it("makes a section a row and its words, picture and button blocks", () => {
    const built = buildReplica(input(capture(page(hero()))), newId);
    expect(built.rows).toHaveLength(1);
    const blocks = blocksOf(built.rows);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "richText", "button"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1, text: "Make it better, every day", typography: { text: { family: "Inter" } } });
    expect(blocks[2]).toMatchObject({ type: "button", label: "Get started", href: "https://example.com/start", variant: "filled" });
    // The section's colour is the row's own background.
    expect(built.rows[0].background).toEqual({ type: "color", color: "#141828" });
    expect(built.counts).toMatchObject({ rows: 1, blocks: 3, headings: 1, texts: 1, buttons: 1 });
  });

  it("measures space from the boxes: the row's room, the blocks' gaps and where they sit", () => {
    const built = buildReplica(input(capture(page(hero()))), newId);
    const rule = (id: string, suffix = "") => built.model.rules.find((r) => r.id === id && r.suffix === suffix)!;
    const [row] = built.rows;
    expect(rule(row.htmlId!).desktop).toMatchObject({ "margin-top": "0px", "padding-top": "80px", "padding-bottom": "94px" });
    // The content is centred (320 left, 320 right): its width is a maximum, and the row keeps no side padding.
    expect(rule(row.htmlId!).desktop).toMatchObject({ "padding-left": "0px", "padding-right": "0px" });
    expect(rule(row.htmlId!, " > :last-child").desktop).toMatchObject({ "max-width": "800px", "margin-left": "auto" });
    const [heading, paragraph, button] = blocksOf(built.rows);
    expect(rule(heading.htmlId!).desktop).toMatchObject({ "margin-top": "0px", "font-size": "48px", "line-height": "60px", "font-weight": "700", "text-align": "center", color: "rgb(255, 255, 255)" });
    // 160 - (80 + 60) = 20 between the heading and the paragraph; 250 - (160 + 56) = 34 to the button.
    expect(rule(paragraph.htmlId!).desktop["margin-top"]).toBe("20px");
    expect(rule(button.htmlId!).desktop["margin-top"]).toBe("34px");
    expect(rule(button.htmlId!).desktop).toMatchObject({ width: "200px", "margin-left": "auto", "margin-right": "auto" });
    expect(rule(button.htmlId!, " a").desktop).toMatchObject({ "padding-left": "32px", "background-color": "#4f46e5", "border-radius": "8px 8px 8px 8px" });
  });

  it("uses the family only where it is a Google font, else the original's stack", () => {
    const section = hero();
    section.children[0].children[1].s.fontFamily = '"Gotham Rounded", Arial, sans-serif';
    const built = buildReplica(input(capture(page(section))), newId);
    const [, paragraph] = blocksOf(built.rows);
    expect(paragraph).not.toHaveProperty("font");
    const rule = built.model.rules.find((r) => r.id === paragraph.htmlId && r.suffix === "")!;
    expect(rule.desktop["font-family"]).toBe('"Gotham Rounded", Arial, sans-serif');
  });

  it("makes boxes side by side columns of one row, in proportion", () => {
    const card = (i: number, x: number) =>
      node({ p: `1/${i}`, tag: "div", box: [x, 500, 360, 300], s: { display: "block", backgroundColor: "rgb(245, 245, 250)", paddingTop: "24px", paddingLeft: "24px", paddingRight: "24px", paddingBottom: "24px", borderTopLeftRadius: "12px" } }, [
        text("h3", [x + 24, 524, 312, 30], `Card ${i}`, { fontSize: "24px", lineHeight: "30px", fontWeight: "600" }, { p: `1/${i}/0` }),
        text("p", [x + 24, 570, 312, 48], `About card ${i}.`, {}, { p: `1/${i}/1` }),
      ]);
    const section = node({ p: "1", tag: "section", box: [0, 500, 1440, 300], s: { display: "block" } }, [
      node({ p: "1/c", tag: "div", box: [120, 500, 1200, 300], s: { display: "flex" } }, [card(0, 120), card(1, 540), card(2, 960)]),
    ]);
    // Three cards of one shape are a grid of custom items now (D155, `replicate-grid.test.ts`); the columns are what a group becomes
    // when it is refused or when a pass finds the grid matched worse, which is what this keeps under test.
    const built = buildReplica({ ...input(capture(page(section))), reverted: [{ path: "1/c", match: 40, pass: 1 }] }, newId);
    const row = built.rows[0];
    expect(row.layout).toBe("3");
    expect(row.columns).toHaveLength(3);
    expect(row.equalHeight).toBe(true);
    expect(row.columns.map((c) => c.blocks.map((b) => b.type))).toEqual([["heading", "richText"], ["heading", "richText"], ["heading", "richText"]]);
    const grid = built.model.rules.find((r) => r.id === row.htmlId && r.suffix === " > :last-child > :first-child")!;
    expect(grid.desktop["grid-template-columns"]).toBe("minmax(0, 360fr) minmax(0, 360fr) minmax(0, 360fr)");
    expect(grid.desktop["column-gap"]).toBe("60px");
    const column = built.model.rules.find((r) => r.id === row.columns[0].htmlId && r.suffix === "")!;
    expect(column.desktop).toMatchObject({ "padding-left": "24px", "min-height": "300px", gap: "0px", "border-radius": "12px 0px 0px 0px" });
    // A plain colour is the column's own background, which the builder shows and edits.
    expect(row.columns[0].background).toEqual({ type: "color", color: "#f5f5fa" });
  });

  it("joins paragraphs of the same look into one block", () => {
    const section = node({ p: "2", tag: "section", box: [0, 0, 1440, 400], s: { display: "block" } }, [
      text("p", [100, 0, 700, 48], "First paragraph.", {}, { p: "2/0" }),
      text("p", [100, 68, 700, 48], "Second paragraph.", {}, { p: "2/1" }),
      text("p", [100, 136, 700, 48], "Third paragraph.", {}, { p: "2/2" }),
    ]);
    const built = buildReplica(input(capture(page(section))), newId);
    const blocks = blocksOf(built.rows);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "richText" });
    expect((blocks[0] as { doc: { content: unknown[] } }).doc.content).toHaveLength(3);
    const second = built.model.rules.find((r) => r.id === blocks[0].htmlId && r.suffix === " .rich-text > :nth-child(2)")!;
    expect(second.desktop["margin-top"]).toBe("20px");
  });

  it("keeps bold, italic and links in the words, and leaves out an address the builder refuses", () => {
    const paragraph = text("p", [0, 0, 600, 24], "", {}, { p: "3/0" });
    paragraph.runs = [{ t: "Read " }, { t: "this", b: 1, href: "https://example.com/a" }, { t: " and " }, { t: "that", i: 1, href: "javascript:alert(1)" }];
    const built = buildReplica(input(capture(page(node({ p: "3", tag: "section", box: [0, 0, 1440, 100], s: { display: "block" } }, [paragraph])))), newId);
    const doc = (blocksOf(built.rows)[0] as { doc: { content: { content: { text: string; marks?: unknown[] }[] }[] } }).doc;
    const inline = doc.content[0].content;
    expect(inline.map((n) => n.text)).toEqual(["Read ", "this", " and ", "that"]);
    expect(inline[1].marks).toEqual([{ type: "bold" }, { type: "link", attrs: { href: "https://example.com/a" } }]);
    expect(inline[3].marks).toEqual([{ type: "italic" }]);
  });

  it("makes a list of text items a list", () => {
    const list = node({ p: "4/0", tag: "ul", box: [100, 0, 400, 80], s: { display: "block", paddingLeft: "24px", listStyleType: "disc" } }, [
      text("li", [124, 0, 376, 24], "One", { display: "list-item" }, { p: "4/0/0" }),
      text("li", [124, 40, 376, 24], "Two", { display: "list-item" }, { p: "4/0/1" }),
    ]);
    const built = buildReplica(input(capture(page(node({ p: "4", tag: "section", box: [0, 0, 1440, 100], s: { display: "block" } }, [list])))), newId);
    const [block] = blocksOf(built.rows);
    expect((block as { doc: { content: { type: string }[] } }).doc.content[0].type).toBe("bulletList");
    expect(built.model.rules.find((r) => r.id === block.htmlId && r.suffix === " li + li")!.desktop["margin-top"]).toBe("16px");
  });

  it("copies pictures from the library, and says which could not be downloaded", () => {
    const img = (src: string, p: string): CaptureNode => node({ p, tag: "img", box: [100, 0, 400, 300], s: { display: "block" }, media: { kind: "img", url: src, width: 800, height: 600, alt: "A view" } });
    const section = node({ p: "5", tag: "section", box: [0, 0, 1440, 700], s: { display: "block" } }, [img("https://example.com/a.jpg", "5/0"), { ...img("https://example.com/b.jpg", "5/1"), box: [100, 340, 400, 300] }]);
    const built = buildReplica(input(capture(page(section)), null, { picture: (url) => (url.endsWith("a.jpg") ? { url: "https://files.test/a.webp", width: 800, height: 600 } : null) }), newId);
    const blocks = blocksOf(built.rows);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "image", image: { url: "https://files.test/a.webp", alt: "A view" } });
    expect(built.notes.some((n) => /1 picture could not be downloaded/.test(n.text))).toBe(true);
    const rule = built.model.rules.find((r) => r.id === blocks[0].htmlId && r.suffix === " img")!;
    expect(rule.desktop).toMatchObject({ "aspect-ratio": "400 / 300", width: "100%" });
  });

  it("carries a section's background picture over all its rows, as it sits behind the whole section", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://files.test");
    const section = node({ p: "6", tag: "section", box: [0, 0, 1440, 500], s: { display: "block", backgroundImage: 'url("https://example.com/hero.jpg")', backgroundSize: "cover", backgroundPosition: "50% 50%", backgroundColor: "rgb(0, 0, 0)" }, bg: ["https://example.com/hero.jpg"] }, [
      text("h2", [100, 100, 600, 40], "Over the picture", { fontSize: "32px", lineHeight: "40px", fontWeight: "700" }, { p: "6/0" }),
      node({ p: "6/1", tag: "div", box: [100, 200, 900, 200], s: { display: "flex" } }, [
        text("p", [100, 200, 400, 24], "Left", {}, { p: "6/1/0" }),
        text("p", [600, 200, 400, 24], "Right", {}, { p: "6/1/1" }),
      ]),
    ]);
    const stored = (url: string) => ({ url: `https://files.test/storage/v1/object/public/${url.split("/").pop()}`, width: 800, height: 600 });
    const built = buildReplica(input(capture(page(section)), null, { picture: stored }), newId);
    expect(built.rows).toHaveLength(2);
    expect(built.rows[0].background).toMatchObject({ type: "image", image: { url: "https://files.test/storage/v1/object/public/hero.jpg" } });
    // The second row starts 140 px down the section: the same picture, 1440 x 1080 as `cover` puts it, 140 px higher.
    const second = built.model.rules.find((r) => r.id === built.rows[1].htmlId && r.suffix === "")!.desktop;
    expect(second["background-image"]).toBe('url("https://files.test/storage/v1/object/public/hero.jpg")');
    expect(second["background-size"]).toBe("1440px 1080px");
    expect(second["background-position"]).toBe("0px -430px");
    expect(second["background-color"]).toBe("#000000");
    vi.unstubAllEnvs();
  });

  it("leaves out form fields, and says so", () => {
    const field = node({ p: "7/0", tag: "input", box: [100, 0, 300, 40], s: { display: "block" }, media: { kind: "control", type: "text", label: "Email" } });
    const built = buildReplica(input(capture(page(node({ p: "7", tag: "section", box: [0, 0, 1440, 100], s: { display: "block" } }, [field, text("p", [100, 60, 300, 24], "Sign up", {}, { p: "7/1" })])))), newId);
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["richText"]);
    expect(built.notes.some((n) => /form field was not copied/.test(n.text))).toBe(true);
  });

  it("keeps to the builder's limits: fifty rows", () => {
    const sections = Array.from({ length: 60 }, (_, i) =>
      node({ p: `s${i}`, tag: "section", box: [0, i * 100, 1440, 100], s: { display: "block", backgroundColor: i % 2 ? "rgb(240, 240, 240)" : "rgb(255, 255, 255)" } }, [text("p", [100, i * 100 + 30, 400, 24], `Section ${i}`, {}, { p: `s${i}/0` })]),
    );
    const built = buildReplica(input(capture(page(...sections))), newId);
    expect(built.rows).toHaveLength(50);
    expect(built.notes.some((n) => /last 10 rows are left out/.test(n.text))).toBe(true);
  });

  it("makes the phone's rules from the phone's boxes, and hides what is not on the phone", () => {
    const mobileSection = node({ p: "0", tag: "section", box: [0, 0, 390, 360], s: { display: "block", backgroundColor: "rgb(20, 24, 40)" } }, [
      node({ p: "0/0", tag: "div", box: [20, 40, 350, 280], s: { display: "block" } }, [
        text("h1", [20, 40, 350, 90], "Make it better, every day", { fontSize: "32px", lineHeight: "36px", fontWeight: "700", color: "rgb(255, 255, 255)", textAlign: "left" }, { p: "0/0/0" }),
        text("p", [20, 150, 350, 84], "Small steps add up to large changes.", { fontSize: "18px", lineHeight: "28px", color: "rgb(200, 200, 210)", textAlign: "left" }, { p: "0/0/1" }),
        // The button is not on the phone's page.
      ]),
    ]);
    const built = buildReplica(input(capture(page(hero())), capture(node({ p: "", tag: "body", box: [0, 0, 390, 360], s: { display: "block" } }, [mobileSection]), 390)), newId);
    const [heading, , button] = blocksOf(built.rows);
    const rule = (id: string, suffix = "") => built.model.rules.find((r) => r.id === id && r.suffix === suffix)!;
    expect(rule(heading.htmlId!).mobile).toMatchObject({ "font-size": "32px", "line-height": "36px", "text-align": "left" });
    expect(rule(button.htmlId!).mobile).toEqual({ display: "none" });
    const row = built.rows[0];
    expect(rule(row.htmlId!).mobile).toMatchObject({ "padding-left": "20px", "padding-right": "20px", "max-width": "none" });
    expect(rule(row.htmlId!, " > :last-child").mobile).toMatchObject({ "max-width": "none" });
  });

  it("makes a page the builder accepts, with its CSS", () => {
    const built = buildReplica(input(capture(page(hero()))), newId);
    const { css } = renderStyles(built.model, built.shared);
    expect(css.startsWith(SHARED_CSS)).toBe(true);
    const parsed = pageInput.safeParse({ ...newPageContent(), title: "Copy", slug: "copy", rows: built.rows, css });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});

describe("pictures keep the size of the original (D151)", () => {
  type Built = ReturnType<typeof buildReplica>;
  const rule = (built: Built, id: string, suffix: string) => built.model.rules.find((r) => r.id === id && r.suffix === suffix);
  const images = (built: Built): ImageBlock[] => blocksOf(built.rows).filter((b): b is ImageBlock => b.type === "image");
  const section = (p: string, box: Box, children: CaptureNode[]) => node({ p, tag: "section", box, s: { display: "block" } }, children);
  const img = (p: string, box: Box, src: string, s: Record<string, string> = {}): CaptureNode =>
    node({ p, tag: "img", box, s: { display: "block", ...s }, media: { kind: "img", url: src, width: 800, height: 600, alt: "A view" } });
  const video = (p: string, box: Box, s: Record<string, string> = {}, over: Partial<Extract<NonNullable<CaptureNode["media"]>, { kind: "video" }>> = {}): CaptureNode =>
    node({ p, tag: "video", box, s: { display: "block", ...s }, media: { kind: "video", url: "https://example.com/hero.mp4", poster: "https://example.com/poster.jpg", autoplay: false, loop: false, muted: false, controls: true, ...over } });
  const phonePage = (...sections: CaptureNode[]) => capture(node({ p: "", tag: "body", box: [0, 0, 390, 2000], s: { display: "block" } }, sections), 390);

  describe("the copy's shared rule", () => {
    const shared = SHARED_CSS.split("\n").filter((line) => line.startsWith(".rp.rp{"));

    it("has one rule for every part, which counts padding and border inside the width the original was measured at", () => {
      expect(shared).toHaveLength(1);
      expect(shared[0].endsWith("}")).toBe(true);
      const declarations = shared[0].slice(".rp.rp{".length, -1).split(";");
      expect(declarations).toContain("box-sizing:border-box");
      // The rest of what makes a part its own size is still stated: a limit of the builder's (a picture's `max-w-(--picture-width)`) never clamps a copy.
      expect(declarations).toEqual(expect.arrayContaining(["width:auto", "max-width:none"]));
    });

    it("is the CSS a copy's page starts with, and one the builder accepts", () => {
      const built = buildReplica(input(capture(page(section("0", [0, 0, 1440, 400], [img("0/0", [100, 40, 400, 300], "https://example.com/a.jpg")])))), newId);
      expect(renderStyles(built.model, built.shared).css.startsWith(SHARED_CSS)).toBe(true);
      expect(cssProblem(SHARED_CSS)).toBeNull();
    });

    it("applies to a picture's own box, which is a part of the copy like any other", () => {
      const built = buildReplica(input(capture(page(section("0", [0, 0, 1440, 400], [img("0/0", [100, 40, 400, 300], "https://example.com/a.jpg")])))), newId);
      const [block] = images(built);
      // `.rp.rp` is the rule above: the block's box must carry the class, or the builder's `box-content` would win.
      expect(block.className).toBe("rp");
    });
  });

  describe("a video that could not be copied, whose still picture could", () => {
    it("is a picture told to fill the video's box, at the video's shape", () => {
      const built = buildReplica(input(capture(page(section("0", [0, 0, 1440, 500], [video("0/0", [100, 40, 640, 360])])))), newId);
      const blocks = blocksOf(built.rows);
      expect(blocks.map((b) => b.type)).toEqual(["image"]);
      const [block] = images(built);
      // The still, at the size it was stored at: the page's room for it is the video's box, not what the file measures.
      expect(block.image).toEqual({ url: "https://files.test/poster.jpg", width: 800, height: 600, alt: "" });
      expect(block).not.toHaveProperty("maxWidth");
      expect(block).not.toHaveProperty("align");
      const picture = rule(built, block.htmlId!, " img")!;
      expect(picture).toBeDefined();
      expect(picture.desktop).toEqual({ width: "100%", height: "auto", "aspect-ratio": "640 / 360", "object-fit": "cover", "border-radius": "0px" });
      // No phone was captured, so there is nothing to say for phones.
      expect(picture.mobile).toEqual({});
      expect(built.counts).toMatchObject({ pictures: 1, videos: 0 });
      expect(built.dropped.map((d) => d.kind)).toEqual(["video-still-only"]);
      expect(built.notes.some((n) => /still picture is used instead/.test(n.text))).toBe(true);
    });

    it("takes the video's own corners, and the rule reaches the page's CSS", () => {
      const rounded = { borderTopLeftRadius: "16px", borderTopRightRadius: "16px", borderBottomRightRadius: "16px", borderBottomLeftRadius: "16px" };
      const built = buildReplica(input(capture(page(section("0", [0, 0, 1440, 500], [video("0/0", [100, 40, 640, 360], rounded)])))), newId);
      const [block] = images(built);
      expect(rule(built, block.htmlId!, " img")!.desktop["border-radius"]).toBe("16px");
      const { css } = renderStyles(built.model, built.shared);
      expect(css).toContain(`#${block.htmlId} img{width:100%;height:auto;aspect-ratio:640 / 360;object-fit:cover;border-radius:16px}`);
    });

    it("is told the phone's own box and corners where a phone was captured", () => {
      const desktopVideo = video("0/0", [100, 40, 640, 360], { borderTopLeftRadius: "16px" });
      const phoneVideo = video("0/0", [20, 40, 350, 197], { borderTopLeftRadius: "8px" });
      const built = buildReplica(input(capture(page(section("0", [0, 0, 1440, 500], [desktopVideo]))), phonePage(section("0", [0, 0, 390, 300], [phoneVideo]))), newId);
      const [block] = images(built);
      const picture = rule(built, block.htmlId!, " img")!;
      expect(picture.desktop).toMatchObject({ width: "100%", "object-fit": "cover", "aspect-ratio": "640 / 360", "border-radius": "16px" });
      expect(picture.mobile).toEqual({ width: "100%", height: "auto", "aspect-ratio": "350 / 197", "object-fit": "cover", "border-radius": "8px" });
      // The page's CSS says for phones only what differs from computers: the shape and the corners.
      const { css } = renderStyles(built.model, built.shared);
      expect(css).toContain(`@media (max-width: 767.98px){`);
      expect(css.slice(css.indexOf("@media"))).toContain(`#${block.htmlId} img{aspect-ratio:350 / 197;border-radius:8px}`);
    });

    it("says nothing for phones that do not show the video, and the block is hidden there", () => {
      const built = buildReplica(input(capture(page(section("0", [0, 0, 1440, 500], [video("0/0", [100, 40, 640, 360])]))), phonePage(section("0", [0, 0, 390, 300], []))), newId);
      const [block] = images(built);
      expect(rule(built, block.htmlId!, "")!.mobile).toEqual({ display: "none" });
      expect(rule(built, block.htmlId!, " img")!.mobile).toEqual({});
      expect(rule(built, block.htmlId!, " img")!.desktop).toMatchObject({ width: "100%", "aspect-ratio": "640 / 360" });
    });

    it("is the only video that gets a picture's rule: a copied video draws itself, and one with nothing is left out", () => {
      const copied = buildReplica(input(capture(page(section("0", [0, 0, 1440, 500], [video("0/0", [100, 40, 640, 360])]))), null, { video: () => ({ url: "https://files.test/hero.mp4" }) }), newId);
      expect(blocksOf(copied.rows).map((b) => b.type)).toEqual(["video"]);
      expect(copied.model.rules.some((r) => r.suffix === " img")).toBe(false);
      expect(copied.dropped.map((d) => d.kind)).not.toContain("video-still-only");

      const nothing = buildReplica(input(capture(page(section("0", [0, 0, 1440, 500], [video("0/0", [100, 40, 640, 360])]))), null, { picture: () => null }), newId);
      expect(blocksOf(nothing.rows)).toEqual([]);
      expect(nothing.model.rules.some((r) => r.suffix === " img")).toBe(false);
      expect(nothing.dropped.map((d) => d.kind)).toEqual(["video-missing"]);
    });
  });

  describe("an ordinary picture", () => {
    const upscaled = img("1/0", [120, 40, 1200, 900], "https://example.com/big.jpg");
    const pair = (i: number, x: number) => node({ p: `2/c/${i}`, tag: "div", box: [x, 40, 560, 420], s: { display: "block" } }, [img(`2/c/${i}/0`, [x, 40, 560, 420], `https://example.com/p${i}.jpg`, { borderTopLeftRadius: "12px", borderTopRightRadius: "12px" })]);
    const icon = node({ p: "3/0", tag: "svg", box: [100, 40, 32, 32], s: { display: "block" }, media: { kind: "svg" } });
    const embed = node({ p: "4/0", tag: "iframe", box: [100, 40, 300, 200], s: { display: "block" }, media: { kind: "embed", url: "https://widgets.example.com/chart", title: "A chart" } });
    const sections = () => [
      section("0", [0, 0, 1440, 400], [img("0/0", [100, 40, 400, 300], "https://example.com/a.jpg")]),
      section("1", [0, 500, 1440, 940], [upscaled]),
      section("2", [0, 1500, 1440, 500], [node({ p: "2/c", tag: "div", box: [120, 1540, 1200, 420], s: { display: "flex" } }, [pair(0, 120), pair(1, 760)])]),
      section("3", [0, 2100, 1440, 120], [icon]),
      section("4", [0, 2300, 1440, 300], [embed]),
    ];
    const buildAll = (mobile: PageCapture | null = null) => buildReplica(input(capture(page(...sections())), mobile, { shot: (p) => (p === "3/0" || p === "4/0" ? { url: `https://files.test/shot-${p.replace("/", "-")}.webp`, width: 64, height: 64 } : null) }), newId);

    it("is told to fill its box and sets no width of its own", () => {
      const built = buildAll();
      const found = images(built);
      // A picture, an upscaled picture, two in columns, a photographed drawing and a photographed widget: none left out.
      expect(found).toHaveLength(6);
      for (const block of found) {
        const picture = rule(built, block.htmlId!, " img");
        expect(picture, `an img rule for ${block.htmlId}`).toBeDefined();
        expect(picture!.desktop.width).toBe("100%");
        expect(picture!.desktop["object-fit"]).toBe("cover");
        expect(picture!.desktop["max-width"]).toBeUndefined();
        expect(block).not.toHaveProperty("maxWidth");
        expect(block).not.toHaveProperty("align");
        expect(block.className).toBe("rp");
        // The picture's own rule is declared for the one place the builder draws it; nothing else in the model narrows the picture.
        expect(Object.keys(rule(built, block.htmlId!, "")!.desktop)).not.toContain("--picture-width");
      }
      // The upscaled picture is drawn at the original's 1200 wide, though its file is 800: it has to be told, the file would not.
      const big = found.find((b) => b.image?.url.endsWith("big.jpg"))!;
      expect(big.image).toMatchObject({ width: 800, height: 600 });
      expect(rule(built, big.htmlId!, " img")!.desktop["aspect-ratio"]).toBe("1200 / 900");
    });

    it("keeps that through the builder's own checks, with no width or place added", () => {
      const built = buildAll();
      const { css } = renderStyles(built.model, built.shared);
      const parsed = pageInput.safeParse({ ...newPageContent(), title: "Copy", slug: "copy", rows: built.rows, css });
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
      if (!parsed.success) return;
      const kept = parsed.data.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)).filter((b) => b.type === "image");
      expect(kept).toHaveLength(6);
      for (const block of kept) {
        expect(block).not.toHaveProperty("maxWidth");
        expect(block).not.toHaveProperty("align");
        expect(css).toMatch(new RegExp(`#${block.htmlId} img[^{]*\\{width:100%[;}]`));
      }
    });

    it("is told the same for phones, from the phone's own box", () => {
      const phoneSections = [
        section("0", [0, 0, 390, 300], [img("0/0", [20, 20, 350, 262], "https://example.com/a.jpg")]),
        section("1", [0, 300, 390, 300], [img("1/0", [20, 20, 350, 262], "https://example.com/big.jpg")]),
        section("2", [0, 600, 390, 300], [node({ p: "2/c", tag: "div", box: [20, 600, 350, 300], s: { display: "block" } }, [img("2/c/0/0", [20, 600, 350, 262], "https://example.com/p0.jpg"), img("2/c/1/0", [20, 900, 350, 262], "https://example.com/p1.jpg")])]),
      ];
      const built = buildAll(phonePage(...phoneSections));
      const first = images(built)[0];
      expect(rule(built, first.htmlId!, " img")!.mobile).toMatchObject({ width: "100%", "aspect-ratio": "350 / 262", "object-fit": "cover" });
      for (const block of images(built)) {
        expect(block).not.toHaveProperty("maxWidth");
        expect(block).not.toHaveProperty("align");
        const { mobile } = rule(built, block.htmlId!, " img")!;
        // Where a phone shows the picture it is told to fill its box too; where it does not, there is nothing to say.
        if (Object.keys(mobile).length > 0) expect(mobile.width).toBe("100%");
      }
    });
  });
});
