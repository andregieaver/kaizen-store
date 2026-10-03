import { describe, expect, it } from "vitest";

import { newPageContent, pageInput, type ContentGridBlock, type PageBlock, type PageRow } from "./page-content";
import { buildReplica, type BuildInput } from "./replicate-build";
import type { Box, CaptureNode, PageCapture, Run } from "./replicate-capture";
import { gridLines, parseDate } from "./replicate-grid";
import { renderStyles } from "./replicate-styles";
import { watchTracks, type WatchDeps } from "./replicate-watch";

/**
 * Adversarial review of D155 part C (safety and bounds). Each test here names a way a page, honest or hostile, makes the converter or the
 * watch do something its own rules forbid: the copy fails whole at the builder's schema, a word is lost that the check counts as kept,
 * the summary counts what the page does not hold, the watch hangs or reads a ticker as slides. Captured trees, no browser; the
 * browser-side ones are in `e2e/replicate-adversarial.spec.ts`.
 */

let seq = 0;
let counter = 0;
const newId = () => `id-${++counter}`;
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
  docHeight: 30000,
  background: "rgb(255, 255, 255)",
  root,
  fonts: [],
  left: { fixed: [], hidden: 0, capped: false },
});
const library = (name: string) => `https://files.test/storage/v1/object/public/media/${name}`;
const input = (desktop: PageCapture): BuildInput => ({ desktop, mobile: null, picture: (url) => ({ url: library(url.split("/").pop() ?? "x"), width: 800, height: 600 }), shot: () => null, video: () => null, font: () => "Inter" });
const page = (...children: CaptureNode[]) => node({ p: "", tag: "body", box: [0, 0, 1440, 30000], s: { display: "block" } }, children);
const blocksOf = (rows: PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
const gridsOf = (rows: PageRow[]) => blocksOf(rows).filter((b): b is ContentGridBlock => b.type === "contentGrid");
const accepted = (built: ReturnType<typeof buildReplica>) => pageInput.safeParse({ ...newPageContent(), title: "Copy", slug: "copy", rows: built.rows, css: renderStyles(built.model, built.shared).css });
const problems = (built: ReturnType<typeof buildReplica>) => {
  const parsed = accepted(built);
  return parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 2));
};

type CardOpts = { href?: string; buttonNoHref?: string; date?: string };

/** A card at `x`, `top`: a heading, a line of words, optionally a button with an address, a button without one, a date. */
function card(i: number, p: string, x: number, top = 100, o: CardOpts = {}): CaptureNode {
  const w = 290;
  const kids: CaptureNode[] = [];
  let n = 0;
  kids.push(text("h3", [x + 16, top + 20, w - 32, 28], `Title ${i}`, { fontSize: "22px", lineHeight: "28px", fontWeight: "600" }, { p: `${p}/${n++}` }));
  if (o.date) kids.push(text("time", [x + 16, top + 56, w - 32, 20], o.date, { fontSize: "14px", lineHeight: "20px" }, { p: `${p}/${n++}` }));
  kids.push(text("p", [x + 16, top + 84, w - 32, 48], `Words ${i}`, {}, { p: `${p}/${n++}` }));
  if (o.href !== undefined) kids.push(text("a", [x + 16, top + 150, 110, 44], "Les mer", { color: "#fff", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { p: `${p}/${n++}`, button: true, href: o.href }));
  if (o.buttonNoHref) kids.push(text("a", [x + 16, top + 210, 110, 44], o.buttonNoHref, { color: "#fff", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { p: `${p}/${n++}`, button: true }));
  return node({ p, tag: "div", sel: "div.card", box: [x, top, w, 300], s: { display: "block", backgroundColor: "rgb(250, 250, 250)" } }, kids);
}

/** A section of `n` cards in one row (at most four), `k` places down the page. */
const section = (k: number, n: number, opts: (i: number) => CardOpts = () => ({})): CaptureNode => {
  const top = 100 + k * 400;
  return node({ p: `${k}`, tag: "section", box: [0, top, 1440, 400], s: { display: "block" } }, [
    node({ p: `${k}/0`, tag: "div", sel: "div.cards", box: [110, top, 1220, 300], s: { display: "flex" } }, Array.from({ length: n }, (_, i) => card(i, `${k}/0/${i}`, 110 + i * 310, top, opts(i)))),
  ]);
};

describe("what a card holds must fit what the builder accepts, or the group stays columns (the whole copy fails at the save otherwise)", () => {
  it("a card's link longer than the builder's 1000 characters (a tracking address) does not make the page unsavable", () => {
    const long = `https://source.test/p/1?${"a=b&".repeat(400)}`;
    const built = buildReplica(input(capture(page(section(0, 3, () => ({ href: long }))))), newId);
    expect(problems(built)).toBe("");
  });

  it("a button-looking box with no address and many words does not become a detail line over the schema's 120 characters", () => {
    const built = buildReplica(input(capture(page(section(0, 3, () => ({ buttonNoHref: "word ".repeat(40).trim() }))))), newId);
    expect(problems(built)).toBe("");
  });
});

describe("no word of a card is lost, whatever the check counts", () => {
  it("is a date only when the text is nothing but a date: a word in front of it ('Published', 'Sale ends') is not a weekday", () => {
    for (const text of ["Published 12 March 2024", "Sale ends 5 May 2024", "Updated 3. mars 2024", "Posted 12 mars 2024"]) expect(parseDate(text), text).toBeNull();
    // A weekday still is allowed in front, as before.
    expect(parseDate("tirsdag 12. mars 2024")).toBe("2024-03-12");
    expect(parseDate("Tue, 12 Mar 2024")).toBe("2024-03-12");
  });

  it("an item keeps the words in front of a date: either they are in the item, or there is no date field", () => {
    const built = buildReplica(input(capture(page(section(0, 3, () => ({ date: "Published 12 March 2024" }))))), newId);
    for (const grid of gridsOf(built.rows)) for (const item of grid.items!) expect(item.date === null || JSON.stringify(item).includes("Published")).toBe(true);
  });
});

describe("the counts say what the page holds, not what was built before the page's limits cut it", () => {
  it("rows cut at the builder's fifty take their grids out of the counts and the report", () => {
    const sections = Array.from({ length: 60 }, (_, k) => section(k, 3));
    const built = buildReplica(input(capture(page(...sections))), newId);
    const onPage = gridsOf(built.rows);
    expect(built.dropped.some((d) => d.kind === "rows-cut")).toBe(true);
    expect(onPage.length).toBe(50);
    expect(built.counts.grids).toBe(onPage.length);
    expect(built.counts.items).toBe(onPage.reduce((n, g) => n + (g.items?.length ?? 0), 0));
    expect(built.grids.built).toHaveLength(onPage.length);
  });
});

// -- the watch -------------------------------------------------------------------------------------------------------

const limits = { windowMs: 6500, retryMs: 5000, totalMs: 12_000, sampleMs: 350, mergeMs: 1200 };

describe("the watch for autoplay", () => {
  it("does not read a track that moves all the time (a ticker, a marquee by script) as a slider that rests on each slide", async () => {
    let t = 0;
    const deps: WatchDeps = {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      // A new place at every sample, as a ticker moved by `requestAnimationFrame` has.
      read: async () => ({ "0": `translateX(${-t / 2}px)` }),
    };
    const { watches } = await watchTracks(["0"], deps, limits);
    expect(watches["0"].observed).toBe(false);
  });

  it("is bounded when the page stops answering: a read that never comes back ends the watch within its total, not at the tick's limit", async () => {
    const deps: WatchDeps = {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      read: () => new Promise(() => {}),
    };
    const small = { windowMs: 200, retryMs: 200, totalMs: 400, sampleMs: 20, mergeMs: 50 };
    const outcome = await Promise.race([watchTracks(["0"], deps, small).then(() => "ended"), new Promise((resolve) => setTimeout(() => resolve("hung"), 2000))]);
    expect(outcome).toBe("ended");
  });
});

// -- what a card is, exactly (review of D155 part C: correctness) -----------------------------------------------------

/** A card wrapper at `x`, whose pieces `build` makes from the path of each (`${p}/0`, …) and the card's x and top. */
function made(i: number, p: string, x: number, top: number, build: (path: (n: number) => { p: string }, x: number, y: number) => CaptureNode[], opts: { s?: Record<string, string>; h?: number } = {}): CaptureNode {
  const path = (n: number) => ({ p: `${p}/${n}` });
  return node({ p, tag: "div", sel: "div.card", box: [x, top, 290, opts.h ?? 300], s: { display: "block", backgroundColor: "rgb(250, 250, 250)", ...opts.s } }, build(path, x, top));
}
/** A section of `n` cards (up to four in a row) made by `one(i, p, x, top)`, with a heading above, so the build has the page's own words too. */
const row = (n: number, one: (i: number, p: string, x: number, top: number) => CaptureNode, order?: (i: number) => number): CaptureNode =>
  node({ p: "0", tag: "section", box: [0, 100, 1440, 400], s: { display: "block" } }, [
    node({ p: "0/0", tag: "div", sel: "div.cards", box: [110, 100, 1220, 300], s: { display: "flex" } }, Array.from({ length: n }, (_, i) => one(i, `0/0/${i}`, 110 + (order ? order(i) : i) * 310, 100))),
  ]);
const title = (path: { p: string }, x: number, y: number, t: string) => text("h3", [x + 16, y + 20, 258, 28], t, { fontSize: "22px", lineHeight: "28px", fontWeight: "600" }, path);
const words = (path: { p: string }, x: number, y: number, t: string | Run[], at = 60) => {
  const leaf = text("p", [x + 16, y + at, 258, 48], typeof t === "string" ? t : "", {}, path);
  if (typeof t !== "string") leaf.runs = t;
  return leaf;
};
const buildOf = (tree: CaptureNode) => buildReplica(input(capture(page(tree))), newId);
const itemTitles = (built: ReturnType<typeof buildReplica>) => gridsOf(built.rows)[0].items!.map((item) => item.title);

describe("the order of the cards", () => {
  it("is the order they stand in on the page, whatever order the markup gives (CSS order, a reversed row, a right-to-left page)", () => {
    // DOM: Third, First, Second; on the screen: First, Second, Third (a flex row with CSS `order`).
    const placed = [2, 0, 1];
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, ["First", "Second", "Third"][placed[i]]), words(path(1), cx, cy, `Words ${placed[i]}`)]), (i) => placed[i]));
    expect(itemTitles(built)).toEqual(["First", "Second", "Third"]);
  });

  it("is left to right when the first card of the markup stands at the right, as in a right-to-left page", () => {
    const built = buildOf(row(4, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, `Card ${i}`), words(path(1), cx, cy, `Words ${i}`)]), (i) => 3 - i));
    expect(itemTitles(built)).toEqual(["Card 3", "Card 2", "Card 1", "Card 0"]);
  });

  it("is row after row, then left to right, in a grid that wraps", () => {
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 800], s: { display: "block" } }, [
      node({ p: "0/0", tag: "div", box: [110, 100, 930, 700], s: { display: "flex", flexWrap: "wrap" } }, [4, 5, 3, 0, 1, 2].map((i, k) => made(i, `0/0/${k}`, 110 + (i % 3) * 320, 100 + Math.floor(i / 3) * 340, (path, cx, cy) => [title(path(0), cx, cy, `Card ${i}`), words(path(1), cx, cy, `Words ${i}`)]))),
    ]);
    expect(itemTitles(buildOf(tree))).toEqual(["Card 0", "Card 1", "Card 2", "Card 3", "Card 4", "Card 5"]);
  });
});

describe("a link is the card's only when it is the card's", () => {
  const inline = (): Run[] => [{ t: "Warm. See the " }, { t: "care guide", href: "https://source.test/care/wool" }, { t: " for washing." }];

  it("is not taken from a word inside a paragraph: the title, the picture and the card do not go to the care guide", () => {
    const built = buildOf(row(6, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, `Title ${i}`), words(path(1), cx, cy, i === 2 ? inline() : `Words ${i}`)])));
    const grid = gridsOf(built.rows)[0];
    expect(grid.items!.every((item) => item.link === null)).toBe(true);
    // The words stay; the link in the sentence is said to be lost, not silently.
    expect(grid.items![2].text).toBe("Warm. See the care guide for washing.");
    expect(built.grids.built[0].failed).toHaveLength(1);
    expect(built.grids.built[0].failed[0].what.join(" ")).toMatch(/link inside a sentence/);
    expect(built.dropped.some((d) => d.kind === "grid-card" && /link inside a sentence/.test(d.text ?? ""))).toBe(true);
  });

  it("keeps a group as columns, with the reason, when more than a fifth of its cards have a link in a sentence", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, `Title ${i}`), words(path(1), cx, cy, inline())])));
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/hold a link inside a sentence/);
  });

  it("is a heading that is a link from end to end: that is the card's link", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [text("h3", [cx + 16, cy + 20, 258, 28], `Title ${i}`, { fontSize: "22px", lineHeight: "28px" }, { ...path(0), runs: [{ t: `Title ${i}`, href: `https://source.test/p/${i}` }] }), words(path(1), cx, cy, `Words ${i}`)])));
    expect(gridsOf(built.rows)[0].items!.map((item) => (item.link as { url: string }).url)).toEqual(["https://source.test/p/0", "https://source.test/p/1", "https://source.test/p/2"]);
  });
});

describe("a button is a link, or it is words", () => {
  /** A card whose picture is the link to the product and whose button runs a script (`Add to cart`). */
  const shopCard = (i: number, p: string, x: number, top: number, script: boolean | null) =>
    made(i, p, x, top, (path, cx, cy) => [
      node({ ...path(0), tag: "a", box: [cx, cy, 290, 120], s: { display: "block" }, href: `https://source.test/p/${i}` }, [node({ p: `${p}/0/0`, tag: "img", box: [cx, cy, 290, 120], s: { display: "block" }, media: { kind: "img", url: `https://source.test/img/${i}.jpg`, width: 400, height: 200, alt: `P${i}` } })]),
      text("h3", [cx + 16, cy + 130, 258, 28], `Product ${i}`, { fontSize: "20px", lineHeight: "28px", fontWeight: "600" }, path(1)),
      text("a", [cx + 16, cy + 200, 120, 40], "Les mer", { color: "#fff", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { ...path(2), button: true, href: `https://source.test/p/${i}` }),
      ...(script === null ? [] : [text("button", [cx + 150, cy + 200, 120, 40], "Add to cart", { color: "#fff", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { ...path(3), button: true })]),
    ]);

  it("is not lent the picture's address: a script's button is a line of words, said to be, and the item's button is the link's", () => {
    const tree = row(6, (i, p, x, top) => shopCard(i, p, x, top, i === 3 ? true : null));
    const built = buildOf(tree);
    const grid = gridsOf(built.rows)[0];
    expect(grid.items![3]).toMatchObject({ buttonLabel: "Les mer", link: { kind: "url", url: "https://source.test/p/3" } });
    expect(grid.items![3].details.map((d) => d.text)).toContain("Add to cart");
    expect(built.grids.built[0].failed[0].what.join(" ")).toMatch(/button that is not a link \(Add to cart\)/);
  });

  it("keeps a group as columns when more than a fifth of its cards have buttons that are not links, where the old output had button blocks", () => {
    const built = buildOf(row(3, (i, p, x, top) => shopCard(i, p, x, top, true)));
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/hold a button that is not a link/);
    expect(blocksOf(built.rows).filter((b) => b.type === "button").length).toBeGreaterThan(0);
    // Nothing of the script's button is an item's: no label of the picture's address, no label at all.
    expect(JSON.stringify(built.rows)).not.toContain('"buttonLabel"');
  });

  it("is the item's button when the picture's link wraps it", () => {
    const wrapped = (i: number, p: string, x: number, top: number) =>
      made(i, p, x, top, (path, cx, cy) => [
        node({ ...path(0), tag: "a", box: [cx, cy, 290, 300], s: { display: "block" }, href: `https://source.test/p/${i}` }, [
          title({ p: `${p}/0/0` }, cx, cy, `Product ${i}`),
          text("div", [cx + 16, cy + 240, 120, 40], "Les mer", { color: "#fff", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { p: `${p}/0/1`, button: true }),
        ]),
      ]);
    const built = buildOf(row(3, wrapped));
    expect(gridsOf(built.rows)[0].items!.map((item) => item.buttonLabel)).toEqual(["Les mer", "Les mer", "Les mer"]);
  });
});

describe("a picture is a picture", () => {
  const photo = (path: { p: string }, cx: number, cy: number, i: number) => node({ ...path, tag: "img", box: [cx, cy, 290, 140], s: { display: "block", objectFit: "cover" }, media: { kind: "img", url: `https://source.test/img/${i}.jpg`, width: 400, height: 200, alt: `P${i}` } });

  it("is never a tracking pixel: a card's only picture of 1×1 is no picture, and the pixel is left out and named", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [node({ ...path(0), tag: "img", box: [cx, cy, 1, 1], s: { display: "block" }, media: { kind: "img", url: "https://tracker.test/p.gif", width: 1, height: 1, alt: "" } }), title(path(1), cx, cy, `Title ${i}`), words(path(2), cx, cy, `Words ${i}`)])));
    const grid = gridsOf(built.rows)[0];
    expect(grid.items!.every((item) => item.picture === null)).toBe(true);
    expect(grid.show.image).toBe(false);
    expect(built.dropped.some((d) => d.kind === "shape" && /tracking pixel/.test(d.text ?? ""))).toBe(true);
  });

  it("is the real one when a card has a pixel and a photograph", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [node({ ...path(0), tag: "img", box: [cx, cy, 1, 1], s: { display: "block" }, media: { kind: "img", url: "https://tracker.test/p.gif", width: 1, height: 1, alt: "" } }), photo(path(1), cx, cy, i), title(path(2), cx, cy + 150, `Title ${i}`), words(path(3), cx, cy + 150, `Words ${i}`)])));
    expect(gridsOf(built.rows)[0].items!.map((item) => item.picture?.alt)).toEqual(["P0", "P1", "P2"]);
    expect(built.grids.built[0].failed).toHaveLength(0);
  });

  it("is not lost without a word when it is drawn as a box's background (the usual thumbnail)", () => {
    const thumb = (path: { p: string }, cx: number, cy: number, i: number) => node({ ...path, tag: "div", sel: "div.thumb", box: [cx, cy, 290, 140], s: { display: "block", backgroundImage: `url("https://source.test/img/${i}.jpg")`, backgroundSize: "cover" }, bg: [`https://source.test/img/${i}.jpg`] });
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [thumb(path(0), cx, cy, i), title(path(1), cx, cy + 150, `Title ${i}`), words(path(2), cx, cy + 150, `Words ${i}`)])));
    const grid = gridsOf(built.rows)[0];
    expect(grid.items!.map((item) => item.picture?.url)).toEqual([library("0.jpg"), library("1.jpg"), library("2.jpg")]);
    expect(grid.items![0].picture!.alt).toBe("");
  });

  it("is said to be left out when words are drawn over a picture that is a background: the item has no background picture", () => {
    const banner = (path: { p: string }, cx: number, cy: number, i: number) =>
      node({ ...path, tag: "div", box: [cx, cy, 290, 140], s: { display: "block", backgroundImage: `url("https://source.test/img/${i}.jpg")` }, bg: [`https://source.test/img/${i}.jpg`] }, [title({ p: `${path.p}/0` }, cx, cy, `Title ${i}`)]);
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [banner(path(0), cx, cy, i), words(path(1), cx, cy + 150, `Words ${i}`)])));
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/paint a picture behind their words/);
  });
});

describe("a card's words are one sentence, a label, or a list: never a mirage", () => {
  it("is a sentence set in two styles when there is no more than a word space between the pieces, not a label and its value", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [
      title(path(0), cx, cy, `Title ${i}`),
      text("span", [cx + 16, cy + 60, 30, 24], "Fine", {}, path(1)),
      text("span", [cx + 47, cy + 60, 40, 24], "print", {}, path(2)),
    ])));
    const item = gridsOf(built.rows)[0].items![0];
    expect(item.details).toEqual([]);
    expect(item.text).toBe("Fine print");
  });

  it("is a label and its value when there is room between them", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [
      title(path(0), cx, cy, `Title ${i}`),
      text("span", [cx + 16, cy + 60, 60, 24], "Size", {}, path(1)),
      text("span", [cx + 150, cy + 60, 40, 24], "M", {}, path(2)),
    ])));
    expect(gridsOf(built.rows)[0].items![0].details).toEqual([{ id: expect.any(String), label: "Size", text: "M" }]);
  });

  it("keeps a number or a label above the title as the item's badge (words in the order they stood), and refuses a paragraph above it", () => {
    const steps = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [text("span", [cx + 16, cy + 10, 30, 24], String(i + 1), { fontSize: "14px" }, path(0)), title(path(1), cx, cy + 40, `Step title ${i}`), words(path(2), cx, cy + 40, `Description of step ${i}.`, 40)])));
    const grid = gridsOf(steps.rows)[0];
    expect(grid.items!.map((item) => item.badge)).toEqual(["1", "2", "3"]);
    expect(grid.items![0].text).toBe("Description of step 0.");
    const above = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [words(path(0), cx, cy, `An introduction to step ${i}, which is long enough to be a paragraph of its own`, 10), title(path(1), cx, cy + 70, `Step title ${i}`), words(path(2), cx, cy + 70, `Description of step ${i}.`, 40)])));
    expect(gridsOf(above.rows)).toHaveLength(0);
    expect(above.grids.kept[0].reason).toMatch(/words above the title/);
  });

  it("refuses a card with a list of words, with its own reason (a pricing column is not a footer's links)", () => {
    const list = (path: { p: string }, cx: number, cy: number, i: number) =>
      node({ ...path, tag: "ul", box: [cx + 16, cy + 60, 258, 80], s: { display: "block", listStyleType: "disc" } }, [0, 1, 2].map((k) => text("li", [cx + 16, cy + 60 + k * 26, 258, 24], `Feature ${i}-${k}`, {}, { p: `${path.p}/${k}` })));
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, `Plan ${i}`), list(path(1), cx, cy, i)])));
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept[0].reason).toMatch(/holds a list of three or more lines, which an item shows as one run-on text/);
    expect(built.grids.kept[0].reason).not.toMatch(/footer/);
  });

  it("says what an item's plain text does not keep of the words' look: bold, italic and a line break, the words kept", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, `Title ${i}`), words(path(1), cx, cy, [{ t: "Soft " }, { t: "and warm", b: 1 }, { t: "", br: 1 }, { t: "all year", i: 1 }])])));
    const grid = gridsOf(built.rows)[0];
    expect(grid.items![0].text).toBe("Soft and warm all year");
    expect(built.grids.built[0].simplified).toEqual(expect.arrayContaining([{ what: "bold", cards: 3 }, { what: "italic", cards: 3 }, { what: "line breaks", cards: 3 }]));
    expect(built.dropped.some((d) => d.kind === "grid-simplified")).toBe(true);
    expect(gridLines(built.grids).problems.join(" ")).toMatch(/plain text in an item/);
  });
});

describe("words a page draws with CSS are named as left out", () => {
  it("names a ::before that says NEW, in a card and outside one, and a card that has one is among those that held something an item does not", () => {
    const flagged = (i: number) => (i === 1 ? { gen: ["NEW"] } : {});
    const built = buildOf(row(6, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [{ ...title(path(0), cx, cy, `Shirt ${i}`), ...flagged(i) }, words(path(1), cx, cy, `Words ${i}`)])));
    expect(gridsOf(built.rows)[0].items![1].title).toBe("Shirt 1");
    expect(built.grids.built[0].failed[0].what.join(" ")).toMatch(/words the page draws with CSS \(NEW\)/);
    const outside = buildReplica(input(capture(page(text("h2", [110, 100, 600, 40], "Sale", { fontSize: "32px" }, { p: "0", gen: ["NEW"] })))), newId);
    expect(outside.dropped.some((d) => d.kind === "generated-text" && d.text === "NEW")).toBe(true);
    expect(outside.notes.some((n) => /draws with CSS/.test(n.text))).toBe(true);
  });
});

describe("a track that scrolls sideways", () => {
  const track = (n: number, o: { controls?: boolean; arrows?: boolean }) =>
    node({ p: "0", tag: "section", box: [0, 100, 1440, 400], s: { display: "block" } }, [
      node(
        {
          p: "0/0",
          tag: "div",
          sel: "div.track",
          box: [110, 100, 700, 300],
          s: { display: "flex", overflowX: "auto", scrollSnapType: "x mandatory" },
          scroll: true,
          ...(o.controls ? { controls: { arrows: [{ dir: "next" as const, label: "Next", sel: "button.nav", box: [820, 220, 40, 40] as Box }], dots: null } } : {}),
        },
        Array.from({ length: n }, (_, i) => made(i, `0/0/${i}`, 110 + i * 360, 100, (path, cx, cy) => [title(path(0), cx, cy, `Title ${i}`), words(path(1), cx, cy, `Words ${i}`)], { s: { backgroundColor: "rgb(250, 250, 250)", scrollSnapAlign: "start" } })).map((card) => ({ ...card, box: [card.box[0], card.box[1], 340, 300] as Box })),
      ),
      ...(o.arrows ? [node({ p: "0/1", tag: "button", sel: "button.arrow-next", box: [820, 220, 40, 40], s: { display: "block" } }, [node({ p: "0/1/0", tag: "svg", box: [830, 230, 20, 20], media: { kind: "svg" } })])] : []),
    ]);

  it("is two cards only with something to go to: two cards in a scroller with no arrows or dots are a pair, not a carousel", () => {
    expect(gridsOf(buildOf(track(2, {})).rows)).toHaveLength(0);
    expect(gridsOf(buildOf(track(3, {})).rows)).toHaveLength(1);
  });

  it("is two cards with the buttons the browser found by their label, though their class says nothing", () => {
    const built = buildOf(track(2, { controls: true }));
    const [grid] = gridsOf(built.rows);
    expect(grid.items).toHaveLength(2);
    expect(grid.display).toBe("carousel");
    expect(grid.carousel?.arrows).not.toBe(false);
  });

  it("is two cards with arrows the converter finds by their shape beside the track", () => {
    expect(gridsOf(buildOf(track(2, { arrows: true })).rows)).toHaveLength(1);
  });
});

// -- pages with no repeated cards are built as they were (review of D155 part C: compatibility) ---------------------------

describe("a page without repeated cards", () => {
  it("keeps a vertical rule between two columns as the separator it was", () => {
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 460], s: { display: "block" } }, [
      text("h2", [110, 120, 560, 40], "Before", { fontSize: "28px", lineHeight: "40px" }, { p: "0/0" }),
      node({ p: "0/1", tag: "div", sel: "div.rule", box: [700, 100, 2, 460], s: { display: "block", backgroundColor: "rgb(200, 0, 0)" } }),
      text("h2", [760, 120, 560, 40], "After", { fontSize: "28px", lineHeight: "40px" }, { p: "0/2" }),
    ]);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(blocksOf(built.rows).map((b) => b.type)).toEqual(["heading", "separator", "heading"]);
    expect(built.dropped.filter((d) => d.kind === "shape")).toEqual([]);
  });

  it("reads a darkening layer laid over a hero as before cards were looked for: an empty painted column beside the words, named as a shape the builder has no block for", () => {
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 400], s: { display: "block", backgroundColor: "rgb(20, 24, 40)" } }, [
      node({ p: "0/0", tag: "div", sel: "div.overlay", box: [0, 100, 1440, 400], s: { display: "block", position: "absolute", backgroundColor: "rgba(0, 0, 0, 0.5)" } }),
      text("h1", [110, 200, 700, 60], "Hero", { fontSize: "48px", lineHeight: "60px" }, { p: "0/1" }),
    ]);
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(built.rows[0].columns.map((c) => c.blocks.map((b) => b.type))).toEqual([[], ["heading"]]);
    // Named by what it is as a box (its size), not as decoration put aside to see cards: no cards were there.
    expect(built.dropped.filter((d) => d.kind === "shape").map((d) => d.text)).toEqual(["1440×400px"]);
  });

  it("looks past decoration only to see cards, and then says it left it out", () => {
    const cards = row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, `Title ${i}`), words(path(1), cx, cy, `Words ${i}`)]));
    // A plate placed absolutely behind the cards, as a sibling of the row.
    const tree: CaptureNode = { ...cards, children: [node({ p: "0/9", tag: "div", sel: "div.plate", box: [0, 100, 1440, 300], s: { display: "block", position: "absolute", backgroundColor: "rgb(240, 240, 255)" } }), ...cards.children] };
    const built = buildReplica(input(capture(page(tree))), newId);
    expect(gridsOf(built.rows)).toHaveLength(1);
    expect(built.dropped.some((d) => d.kind === "shape" && /decoration beside the content/.test(d.text ?? ""))).toBe(true);
  });

  it("draws a sticky bar the first section is drawn under as a row of its own, not a column beside the page", () => {
    const header = node({ p: "0", tag: "header", sel: "header.bar", box: [0, 0, 1440, 80], s: { display: "block", position: "sticky" } }, [text("a", [110, 20, 120, 40], "Logo", {}, { p: "0/0", href: "https://source.test/" })]);
    const content = node({ p: "1", tag: "main", box: [0, 0, 1440, 400], s: { display: "block" } }, [text("h1", [110, 120, 700, 60], "Welcome", { fontSize: "48px", lineHeight: "60px" }, { p: "1/0" })]);
    const built = buildReplica(input(capture(page(header, content))), newId);
    expect(built.rows.every((r) => r.columns.length === 1)).toBe(true);
  });
});

// -- the word rule, as a property (review of D155 part C: correctness) --------------------------------------------------

describe("the word rule over many random cards", () => {
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const WORDS = ["fjord", "båt", "kaffe", "Sommer", "tilbud", "natural", "cotton", "rea", "nyhet", "limited", "edition", "kjøp", "billig", "gave", "ny", "stor", "liten", "åpen", "lørdag", "Published", "Sale", "ends"];
  const DATES = ["12 March 2024", "Published 12 March 2024", "2024-03-12", "tirsdag 12. mars 2024", "Sale ends 5 May 2024"];
  const tokens = (t: string) => t.toLowerCase().split(/\s+/).map((x) => x.replace(/^[^\p{L}\p{N}$€£¥]+|[^\p{L}\p{N}$€£¥]+$/gu, "")).filter(Boolean);
  const tally = (list: string[]) => list.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());

  it("has in every item the words of its card, all of them and no others, whatever a card holds", () => {
    let built = 0;
    let kept = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const pick = () => WORDS[Math.floor(r() * WORDS.length)];
      const sentence = (n: number) => Array.from({ length: n }, pick).join(" ");
      const n = 5 + Math.floor(r() * 3);
      // What a group is built of is the same in every card (the same card repeated); what a card says and the odd one out are not.
      const shape = { dated: r() < 0.3, label: r() < 0.3, above: r() < 0.2, price: r() < 0.3, paragraphs: 1 + Math.floor(r() * 2) };
      const flags = Array.from({ length: n }, () => ({
        ...shape,
        date: shape.dated ? DATES[Math.floor(r() * DATES.length)] : null,
        inline: r() < 0.06,
        script: r() < 0.04,
        pixel: r() < 0.2,
        bold: r() < 0.2,
      }));
      const cardWords: string[][] = [];
      const tree = row(n, (i, p, x, top) => {
        const f = flags[i];
        const own: string[] = [];
        const say = (t: string) => (own.push(...tokens(t)), t);
        return made(i, p, x, top, (path, cx, cy) => {
          const kids: CaptureNode[] = [];
          let k = 0;
          const next = () => path(k++);
          if (f.pixel) kids.push(node({ ...next(), tag: "img", box: [cx, cy, 1, 1], s: { display: "block" }, media: { kind: "img", url: "https://t.test/p.gif", width: 1, height: 1, alt: pick() } }));
          if (f.above) kids.push(text("span", [cx + 16, cy + 4, 40, 18], say(sentence(1)), { fontSize: "12px" }, next()));
          kids.push(text("h3", [cx + 16, cy + 24, 258, 28], say(sentence(1 + Math.floor(r() * 2))), { fontSize: "22px", lineHeight: "28px", fontWeight: "600" }, next()));
          if (f.date) kids.push(text("time", [cx + 16, cy + 56, 258, 20], (own.push(...tokens(f.date)), f.date), { fontSize: "14px", lineHeight: "20px" }, next()));
          for (let q = 0; q < f.paragraphs; q++) {
            const leaf = text("p", [cx + 16, cy + 84 + q * 50, 258, 44], "", {}, next());
            leaf.runs = f.inline && q === 0 ? [{ t: say("See the ") }, { t: say("guide"), href: "https://source.test/guide" }, { t: say(" now") }] : f.bold && q === 0 ? [{ t: say(sentence(2)), b: 1 }, { t: say(" " + sentence(1)) }] : [{ t: say(sentence(2 + Math.floor(r() * 5))) }];
            kids.push(leaf);
          }
          if (f.label) {
            kids.push(text("span", [cx + 16, cy + 190, 60, 24], say(sentence(1)), {}, next()));
            kids.push(text("span", [cx + 150, cy + 190, 60, 24], say(sentence(1)), {}, next()));
          }
          if (f.price) kids.push(text("p", [cx + 16, cy + 220, 100, 24], say("199 kr"), { fontWeight: "700" }, next()));
          kids.push(text("a", [cx + 16, cy + 250, 110, 40], say("Les mer"), { color: "#fff", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { ...next(), button: true, href: `https://source.test/p/${i}` }));
          if (f.script) kids.push(text("button", [cx + 150, cy + 250, 110, 40], say("Add to cart"), { color: "#fff", backgroundColor: "rgb(79, 70, 229)", textAlign: "center" }, { ...next(), button: true }));
          cardWords[i] = own;
          return kids;
        });
      });
      const out = buildOf(tree);
      const grid = gridsOf(out.rows)[0];
      if (!grid) {
        kept += 1;
        continue;
      }
      built += 1;
      expect(grid.items).toHaveLength(n);
      grid.items!.forEach((item, i) => {
        const fromItem = [item.title, item.text, item.buttonLabel, item.badge, item.priceText, ...item.details.flatMap((d) => [d.label, d.text])].flatMap(tokens);
        // A date is drawn in the shopper's language from its day, so its words are the card's date words by the date it came to; the rest of the words are exact.
        const dateWords = item.date ? tokens(flags[i].date ?? "") : [];
        const have = tally([...fromItem, ...dateWords]);
        const want = tally(cardWords[i]);
        for (const [w, c] of have) expect(c, `seed ${seed} card ${i}: "${w}" is not in the card`).toBeLessThanOrEqual(want.get(w) ?? 0);
        for (const [w, c] of want) expect(have.get(w) ?? 0, `seed ${seed} card ${i}: "${w}" was lost`).toBeGreaterThanOrEqual(c);
        // A date field is only a date with nothing else in the text: never a word in front of it.
        if (item.date) expect(flags[i].date, `seed ${seed} card ${i}`).not.toMatch(/^(Published|Sale)/);
      });
    }
    expect(built).toBeGreaterThan(100);
    expect(built + kept).toBe(200);
  });
});

describe("a track nobody asked for cards", () => {
  it("is named as not looked at, in the report and the summary, and its cards stay as they were", () => {
    const track = node({ p: "0/1", tag: "div", sel: "div.rail", box: [760, 100, 560, 300], s: { display: "flex", overflowX: "auto" }, scroll: true }, [0, 1, 2].map((i) => ({ ...made(i, `0/1/${i}`, 760 + i * 300, 100, (path, cx, cy) => [title(path(0), cx, cy, `Rail ${i}`), words(path(1), cx, cy, `Words ${i}`)]), box: [760 + i * 300, 100, 280, 300] as Box })));
    const tree = node({ p: "0", tag: "section", box: [0, 100, 1440, 300], s: { display: "block" } }, [text("h2", [110, 110, 560, 40], "Beside the rail", { fontSize: "28px", lineHeight: "40px" }, { p: "0/0" }), track]);
    const built = buildOf(tree);
    expect(gridsOf(built.rows)).toHaveLength(0);
    expect(built.grids.kept).toHaveLength(1);
    expect(built.grids.kept[0].reason).toMatch(/not looked at for repeated cards/);
    expect(built.dropped.some((d) => d.kind === "grid-columns" && /not looked at/.test(d.text ?? ""))).toBe(true);
    expect(gridLines(built.grids).problems.join(" ")).toMatch(/were kept as columns: a track that scrolls sideways was not looked at/);
  });
});

describe("the excerpt's room", () => {
  it("is the lines measured and one more, up to the six an item shows, so a wider face in the copy does not cut the last words of text the data holds", () => {
    const built = buildOf(row(3, (i, p, x, top) => made(i, p, x, top, (path, cx, cy) => [title(path(0), cx, cy, `Title ${i}`), words(path(1), cx, cy, `Words ${i}`)])));
    // The words are two lines of 24 px in the capture.
    expect(gridsOf(built.rows)[0].excerptLines).toBe(3);
  });
});
