import { describe, expect, it, vi } from "vitest";

import { newPageContent, pageInput, type PageBlock, type PageRow } from "./page-content";
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
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1, text: "Make it better, every day", font: "Inter" });
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
    const built = buildReplica(input(capture(page(section))), newId);
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
