import { describe, expect, it } from "vitest";

import type { PageBlock, PageRow } from "./page-content";
import { buildReplica, foldButtons, liftBackdrops, SHARED_CSS, type BuildInput } from "./replicate-build";
import type { Box, CaptureNode, PageCapture, Run } from "./replicate-capture";
import { cleanedFamily, fallbackStack, fontCandidates, fontRelation, withGeneric } from "./replicate-fonts";
import { renderStyles, type StyleModel } from "./replicate-styles";

/**
 * What copying a real shop's front page (oda.com, D150) showed the converter could not do, kept as small pages of boxes:
 * a button whose words sit in a span, hero art laid behind a section, a card made of several rows, a track of cards that scroll
 * sideways, a picture that is a section's background on computers only, and a page too big for its CSS once phones are in it.
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

const orange = { backgroundColor: "rgb(255, 164, 36)", paddingTop: "12px", paddingBottom: "12px", paddingLeft: "21px", paddingRight: "21px" };

describe("a button whose words are in a span", () => {
  const button = () => node({ p: "0/0", tag: "a", href: "https://example.com/go", box: [100, 100, 300, 48], s: { display: "block", ...orange } }, [text("span", [121, 112, 258, 24], "Se om vi leverer til deg", { fontWeight: "500", textAlign: "center" }, { p: "0/0/0" })]);

  it("is one button that keeps its own fill, with the words' type", () => {
    const { capture: folded, folded: n } = foldButtons(capture(page(node({ p: "0", tag: "section", box: [0, 0, 1440, 200], s: { display: "block" } }, [button()]))));
    expect(n).toBe(1);
    const a = folded.root.children[0].children[0];
    expect(a).toMatchObject({ tag: "a", button: true, children: [] });
    expect(a.runs).toEqual(words("Se om vi leverer til deg"));
    expect(a.s.fontWeight).toBe("500");
  });

  it("is left alone when there is an icon beside the words", () => {
    const withIcon = button();
    withIcon.children.push(node({ p: "0/0/1", tag: "svg", box: [110, 112, 20, 20], media: { kind: "svg" } }));
    expect(foldButtons(capture(page(node({ p: "0", tag: "section", box: [0, 0, 1440, 200] }, [withIcon])))).folded).toBe(0);
  });

  it("paints the button in a column with other pieces, which it did not before", () => {
    const card = node({ p: "0/1", tag: "div", box: [400, 40, 448, 300], s: { display: "block", backgroundColor: "rgb(255, 255, 255)", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "rgb(195, 189, 182)" } }, [
      text("h2", [440, 80, 368, 40], "Velkommen", { fontSize: "36px", lineHeight: "46px" }, { p: "0/1/0" }),
      node({ p: "0/1/1", tag: "a", href: "https://example.com/go", box: [440, 200, 368, 48], s: { display: "block", ...orange } }, [text("span", [461, 212, 326, 24], "Åpne", { textAlign: "center" }, { p: "0/1/1/0" })]),
    ]);
    const built = buildReplica(input(capture(page(node({ p: "0", tag: "section", box: [0, 0, 1440, 400], s: { display: "block" } }, [card])))), newId);
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading", "button"]);
    const css = renderStyles(built.model, built.shared).css;
    expect(css).toMatch(/ a\{[^}]*background-color:(?:#ffa424|rgb\(255, 164, 36\))/);
  });
});

describe("hero art laid behind a section", () => {
  const section = () =>
    node({ p: "0", tag: "div", box: [0, 100, 1440, 600], s: { display: "block", position: "relative" } }, [
      node({ p: "0/0", tag: "img", box: [0, 100, 1440, 600], s: { display: "block", position: "absolute", objectFit: "cover" }, media: { kind: "img", url: "https://x.test/hero.jpg", width: 2880, height: 1200, alt: "" } }),
      node({ p: "0/1", tag: "div", box: [496, 160, 448, 480], s: { display: "block", backgroundColor: "rgb(255, 255, 255)" } }, [text("h2", [520, 200, 400, 40], "Velkommen til Oda!", { fontSize: "36px" }, { p: "0/1/0" })]),
    ]);

  it("becomes the section's background, not a block", () => {
    const { capture: lifted, lifted: n } = liftBackdrops(capture(page(section())));
    expect(n).toBe(1);
    const box = lifted.root.children[0];
    expect(box.children.map((c) => c.tag)).toEqual(["div"]);
    expect(box.s).toMatchObject({ backgroundImage: 'url("https://x.test/hero.jpg")', backgroundSize: "cover" });
    expect(box.bg).toEqual(["https://x.test/hero.jpg"]);
    const built = buildReplica(input(capture(page(section()))), newId);
    expect(built.rows[0].background).toMatchObject({ type: "image", image: { url: "https://files.test/hero.jpg" } });
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading"]);
  });

  it("is the background too when it is not placed absolutely but words lie over it (a hero with a headline)", () => {
    const hero = node({ p: "0", tag: "section", box: [0, 0, 1440, 900], s: { display: "block", position: "relative" } }, [
      node({ p: "0/0", tag: "figure", box: [0, 0, 1440, 900], s: { display: "block" } }, [node({ p: "0/0/0", tag: "img", box: [0, 0, 1440, 900], s: { display: "block", objectFit: "cover" }, media: { kind: "img", url: "https://x.test/car.webp", width: 1920, height: 1200, alt: "" } })]),
      node({ p: "0/1", tag: "div", box: [318, 688, 804, 136], s: { display: "block", position: "absolute" } }, [text("h1", [318, 688, 804, 80], "Hverdagen fortjener en Kia", { fontSize: "64px", color: "rgb(255, 255, 255)", textAlign: "center" }, { p: "0/1/0" })]),
    ]);
    const { capture: lifted, lifted: n } = liftBackdrops(capture(page(hero)));
    expect(n).toBe(1);
    expect(lifted.root.children[0].s.backgroundImage).toBe('url("https://x.test/car.webp")');
    const built = buildReplica(input(capture(page(hero))), newId);
    expect(built.rows[0].background).toMatchObject({ type: "image" });
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading"]);
  });

  it("is painted by the outermost box of the picture's own size: a column's wrapper is no part of the builder's (lampan.no: blank heroes)", () => {
    const card = (i: number, x: number) =>
      node({ p: `0/${i}`, tag: "div", box: [x, 100, 635, 484], s: { display: "block" } }, [
        node({ p: `0/${i}/0`, tag: "div", box: [x, 100, 635, 484], s: { display: "block", position: "relative" } }, [
          node({ p: `0/${i}/0/0`, tag: "p", box: [x, 100, 635, 484], s: { display: "block" } }, [
            node({ p: `0/${i}/0/0/0`, tag: "img", box: [x, 100, 635, 484], s: { display: "block" }, media: { kind: "img", url: `https://x.test/hero-${i}.jpg`, width: 1270, height: 968, alt: "" } }),
          ]),
          node({ p: `0/${i}/0/1`, tag: "div", box: [x + 200, 264, 237, 120], s: { display: "block", position: "absolute" } }, [text("h2", [x + 200, 264, 237, 33], `Campaign ${i}`, { fontSize: "26px", color: "rgb(255, 255, 255)" }, { p: `0/${i}/0/1/0` })]),
        ]),
      ]);
    const tree = node({ p: "0", tag: "div", box: [80, 100, 1280, 484], s: { display: "grid" } }, [card(0, 80), card(1, 725)]);
    const { capture: lifted, lifted: n } = liftBackdrops(capture(page(tree)));
    expect(n).toBe(2);
    // On the column (the outer box), not the wrapper inside it.
    expect(lifted.root.children[0].children.map((c) => c.s.backgroundImage)).toEqual(['url("https://x.test/hero-0.jpg")', 'url("https://x.test/hero-1.jpg")']);
    expect(lifted.root.children[0].children.map((c) => c.children[0].s.backgroundImage)).toEqual([undefined, undefined]);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(built.rows[0].columns.map((c) => c.background)).toEqual([expect.objectContaining({ type: "image" }), expect.objectContaining({ type: "image" })]);
  });

  it("is not a background when the words under it do not lie over it", () => {
    const tall = node({ p: "0", tag: "div", box: [0, 0, 1440, 700], s: { display: "block" } }, [
      node({ p: "0/0", tag: "img", box: [0, 0, 1440, 600], s: { display: "block", objectFit: "cover" }, media: { kind: "img", url: "https://x.test/a.webp", width: 1440, height: 600, alt: "" } }),
      text("p", [100, 620, 800, 24], "A caption under the picture", {}, { p: "0/1" }),
    ]);
    expect(liftBackdrops(capture(page(tall))).lifted).toBe(0);
  });

  it("stays a picture, with its box's rounded corners, when it is alone in its box", () => {
    const frame = node({ p: "0", tag: "div", box: [620, 100, 740, 555], s: { display: "block", position: "relative", overflowX: "hidden", borderTopLeftRadius: "16px", borderTopRightRadius: "16px", borderBottomRightRadius: "16px", borderBottomLeftRadius: "16px" } }, [
      node({ p: "0/0", tag: "img", box: [620, 100, 740, 555], s: { display: "block", position: "absolute", objectFit: "cover" }, media: { kind: "img", url: "https://x.test/kitchen.jpg", width: 1480, height: 1110, alt: "Kitchen" } }),
    ]);
    expect(liftBackdrops(capture(page(frame))).lifted).toBe(0);
    const built = buildReplica(input(capture(page(node({ p: "1", tag: "section", box: [0, 0, 1440, 700], s: { display: "block" } }, [frame])))), newId);
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["image"]);
    const css = renderStyles(built.model, built.shared).css;
    expect(css).toMatch(/ img\{[^}]*border-radius:16px/);
  });

  it("is not lifted when it is only part of a section, or not a cover picture", () => {
    const small = page(node({ p: "0", tag: "div", box: [0, 100, 1440, 600] }, [node({ p: "0/0", tag: "img", box: [100, 100, 400, 300], s: { display: "block", position: "absolute" }, media: { kind: "img", url: "https://x.test/a.jpg", width: 400, height: 300, alt: "" } })]));
    expect(liftBackdrops(capture(small)).lifted).toBe(0);
    const contain = page(node({ p: "0", tag: "div", box: [0, 100, 1440, 600] }, [node({ p: "0/0", tag: "img", box: [0, 100, 1440, 600], s: { display: "block", position: "absolute", objectFit: "contain" }, media: { kind: "img", url: "https://x.test/a.jpg", width: 400, height: 300, alt: "" } })]));
    expect(liftBackdrops(capture(contain)).lifted).toBe(0);
  });

  it("is drawn by the section's CSS when phones do not show it, so the phone's rule can take it away", () => {
    const phonePage = page(node({ p: "0", tag: "div", box: [0, 100, 390, 500], s: { display: "block", position: "relative" } }, [node({ p: "0/1", tag: "div", box: [16, 120, 358, 460], s: { display: "block", backgroundColor: "rgb(255, 255, 255)" } }, [text("h2", [30, 140, 330, 40], "Velkommen til Oda!", { fontSize: "25px" }, { p: "0/1/0" })])]));
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://files.test";
    try {
      const built = buildReplica(
        { ...input(capture(page(section())), capture(phonePage, 390)), picture: () => ({ url: "https://files.test/storage/v1/object/public/hero.jpg", width: 800, height: 600 }) },
        newId,
      );
      expect(built.rows[0].background).toMatchObject({ type: "color" });
      const css = renderStyles(built.model, built.shared).css;
      expect(css).toContain('background-image:url("https://files.test/storage/v1/object/public/hero.jpg")');
      expect(css).toMatch(/@media[^{]*\{[\s\S]*background-image:none/);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
    }
  });
});

describe("a painted box made of several rows", () => {
  it("is drawn in slices, so it is one box again", () => {
    const card = node({ p: "0/0", tag: "div", box: [400, 40, 448, 360], s: { display: "block", backgroundColor: "rgb(255, 255, 255)", borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px", borderTopStyle: "solid", borderTopColor: "rgb(195, 189, 182)", borderRightColor: "rgb(195, 189, 182)", borderBottomColor: "rgb(195, 189, 182)", borderLeftColor: "rgb(195, 189, 182)", borderTopLeftRadius: "16px", borderTopRightRadius: "16px", borderBottomRightRadius: "16px", borderBottomLeftRadius: "16px" } }, [
      text("h2", [440, 80, 368, 40], "Velkommen", { fontSize: "36px", lineHeight: "46px" }, { p: "0/0/0" }),
      // Two buttons that each paint a box of their own (a box with an icon is not folded), so the card has more than one row.
      node({ p: "0/0/1", tag: "div", box: [440, 200, 368, 56], s: { display: "block", backgroundColor: "rgb(255, 164, 36)" } }, [text("p", [450, 210, 340, 24], "En", {}, { p: "0/0/1/0" }), node({ p: "0/0/1/1", tag: "svg", box: [760, 210, 24, 24], media: { kind: "svg" } })]),
      node({ p: "0/0/2", tag: "div", box: [440, 280, 368, 56], s: { display: "block", backgroundColor: "rgb(255, 164, 36)" } }, [text("p", [450, 290, 340, 24], "To", {}, { p: "0/0/2/0" }), node({ p: "0/0/2/1", tag: "svg", box: [760, 290, 24, 24], media: { kind: "svg" } })]),
    ]);
    const built = buildReplica({ ...input(capture(page(node({ p: "0", tag: "section", box: [0, 0, 1440, 440], s: { display: "block" } }, [card])))), shot: () => ({ url: "https://files.test/s.png", width: 24, height: 24 }) }, newId);
    const rows = built.rows.filter((r) => r.className === "rp");
    expect(rows.length).toBeGreaterThan(1);
    const css = renderStyles(built.model, built.shared).css;
    const rule = (id: string) => new RegExp(`#${id}\\{[^}]*\\}`).exec(css)?.[0] ?? "";
    const first = rule(rows[0].htmlId!);
    const last = rule(rows[rows.length - 1].htmlId!);
    expect(first).toContain("border-top:1px");
    expect(first).not.toContain("border-bottom:1px");
    expect(last).toContain("border-bottom:1px");
    expect(last).not.toContain("border-top:1px");
  });
});

describe("a track of cards that scroll sideways", () => {
  const card = (n: number, x: number): CaptureNode =>
    node({ p: `0/0/${n}`, tag: "div", box: [x, 100, 260, 300], s: { display: "block", backgroundColor: "rgb(255, 255, 255)", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "rgb(200, 200, 200)" } }, [text("h3", [x + 16, 120, 228, 28], `Card ${n}`, { fontSize: "18px" }, { p: `0/0/${n}/0` })]);

  it("keeps the cards' widths and scrolls, instead of squeezing them into the row", () => {
    const track = node({ p: "0/0", tag: "div", scroll: true, box: [0, 100, 390, 300], s: { display: "flex", overflowX: "auto" } }, [card(0, 0), card(1, 276), card(2, 552), card(3, 828)]);
    const built = buildReplica(input(capture(page(node({ p: "0", tag: "section", box: [0, 0, 1440, 500], s: { display: "block" } }, [track])), 1440)), newId);
    const css = renderStyles(built.model, built.shared).css;
    expect(css).toMatch(/> :last-child > :first-child\{[^}]*grid-template-columns:260px 260px 260px 260px/);
    expect(css).toMatch(/> :last-child > :first-child\{[^}]*overflow-x:auto/);
    expect(built.rows[0].sideBySide).toBe(true);
  });
});

describe("the page's CSS with phones in it", () => {
  it("states a part's defaults once, and the phones' rules only where they differ from computers", () => {
    const model: StyleModel = {
      rules: [
        { id: "rp1", suffix: "", desktop: { "margin-top": "0px", "margin-left": "0", width: "auto", "max-width": "none", "border-top": "0 none", "border-radius": "0px 0px 0px 0px", "box-shadow": "none", color: "rgb(1, 2, 3)", "font-size": "20px" }, mobile: { "margin-top": "0px", "margin-left": "0", width: "auto", color: "rgb(1, 2, 3)", "font-size": "16px" } },
        // A descendant keeps its zeros: its base styles are the builder's.
        { id: "rp1", suffix: " a", desktop: { "border-top": "0 none" }, mobile: {} },
        // What a phone needs to take away from computers is said, even when it is a default.
        { id: "rp2", suffix: "", desktop: { "margin-left": "40px", width: "320px" }, mobile: { "margin-left": "0", width: "auto" } },
      ],
    };
    const { css } = renderStyles(model, SHARED_CSS);
    expect(css).toContain("#rp1{color:rgb(1, 2, 3);font-size:20px}");
    expect(css).toContain("#rp1 a{border-top:0 none}");
    expect(css).toContain("#rp2{margin-left:40px;width:320px}");
    const phones = css.slice(css.indexOf("@media"));
    expect(phones).toContain("#rp1{font-size:16px}");
    expect(phones).not.toContain("color:");
    expect(phones).toContain("#rp2{margin-left:0;width:auto}");
    expect(SHARED_CSS).toContain(".rp.rp{margin:0;width:auto;max-width:none;box-sizing:border-box;border:0 none;border-radius:0;box-shadow:none;font-style:normal;text-transform:none}");
  });
});

describe("a page whose CSS is too long for everything", () => {
  it("keeps the phones' sizes, spaces and layout before it gives up their rules", () => {
    const rules = Array.from({ length: 190 }, (_, i) => ({
      id: `rp${i + 1}`,
      suffix: "",
      desktop: { "margin-top": `${i + 1}px`, "font-size": "20px", color: `rgb(${i % 255}, 10, 10)`, "font-family": '"Some Quite Long Family Name", sans-serif', "line-height": "30px", "letter-spacing": "0.2px", "font-weight": "600", "text-align": "center" },
      mobile: { "margin-top": `${i + 2}px`, "font-size": "16px", color: `rgb(${i % 255}, 20, 20)`, "font-family": '"Another Quite Long Family Name", sans-serif', "line-height": "24px", "letter-spacing": "0.1px", "font-weight": "500", "text-align": "left" },
    }));
    const full = renderStyles({ rules }, SHARED_CSS);
    expect(full.css.length).toBeLessThanOrEqual(50_000);
    expect(full.trimmed).toMatch(/only their sizes, spaces and layout were kept/);
    {
      const phones = full.css.slice(full.css.indexOf("@media"));
      expect(phones).toContain("font-size:16px");
      expect(phones).not.toContain("font-family");
    }
  });
});

describe("typefaces that are not Google's own", () => {
  it("tries the page's family, the family without a file's words, then the nearest look-alike", () => {
    expect(fontCandidates("Inter var")).toEqual([
      { name: "Inter var", kind: "same" },
      { name: "Inter", kind: "cleaned" },
    ]);
    expect(fontCandidates("Galaxie Copernicus").map((c) => `${c.name}:${c.kind}`)).toEqual(["Galaxie Copernicus:same", "Source Serif 4:lookalike"]);
    expect(cleanedFamily("Roboto Flex VF")).toBe("Roboto Flex");
    expect(cleanedFamily("Open Sans")).toBe("Open Sans");
    expect(fontRelation("Inter var", "Inter")).toBe("cleaned");
    expect(fontRelation("Galaxie Copernicus", "Source Serif 4")).toBe("lookalike");
    expect(fontRelation("Inter", "inter")).toBe("same");
  });

  it("falls back to the kind of face, not the browser's default serif, when a long stack is cut", () => {
    expect(fallbackStack('"Inter var", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')).toBe('"Inter var", sans-serif');
    expect(fallbackStack('"Galaxie Copernicus", Georgia, "Times New Roman", serif')).toBe('"Galaxie Copernicus", serif');
    expect(fallbackStack('"Mystery"')).toBe('"Mystery", sans-serif');
    expect(withGeneric('"Kia Signature", Arial')).toBe('"Kia Signature", Arial, sans-serif');
    expect(withGeneric('"Kia Signature", sans-serif')).toBe('"Kia Signature", sans-serif');
    expect(withGeneric('"Old Style Serif", Georgia')).toBe('"Old Style Serif", Georgia, serif');
  });
});
