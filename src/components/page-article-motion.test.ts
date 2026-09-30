import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PartMotion } from "@/lib/motion";
import { newPageContent, type PageBlock, type PageColumn, type PageContent, type PageRow } from "@/lib/page-content";

import { ModalRow, PageArticle } from "./page-article";
import { MotionRuntime } from "./motion-runtime";
import { MotionSupport } from "./motion-support";

vi.mock("server-only", () => ({}));
vi.mock("@/server/place-lang", () => ({ placeLang: async () => "nb" }));

/**
 * Motion (D128) as the server draws a page: the content is always in the HTML, the effects are attributes and custom
 * properties, the runtime and the no-script fallback only come with motion that needs them.
 */
const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});
const heading = (id: string, text: string, motion?: PartMotion): PageBlock =>
  ({ id, type: "heading", text, level: 2, ...(motion ? { motion } : {}) }) as PageBlock;
const prose = (id: string, text: string, motion?: PartMotion): PageBlock =>
  ({ id, type: "richText", doc: doc(text), ...(motion ? { motion } : {}) }) as PageBlock;
const column = (id: string, blocks: PageBlock[], extra: Partial<PageColumn> = {}): PageColumn => ({
  id,
  blocks,
  ...extra,
});
const row = (id: string, columns: PageColumn[], extra: Partial<PageRow> = {}): PageRow => ({
  id,
  type: "row",
  layout: columns.length === 1 ? "1" : "2",
  columns,
  ...extra,
});
const page = (...rows: PageRow[]): PageContent => ({ ...newPageContent(), title: "Motion", slug: "motion", rows });
const draw = (content: PageContent) =>
  renderToString(createElement(PageArticle, { content, place: { pageId: "p", owner: null }, inAdmin: true })).replace(
    /<!-- -->/g,
    "",
  );

const picture = { url: "https://cdn.example/bg.webp", width: 1600, height: 900 };
const fadeUp: PartMotion = { enter: { effect: "fade-up" } };

/** The elements of a React tree of the given type (server components are drawn by calling them). */
function find(node: ReactNode, type: unknown, into: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((child) => find(child, type, into));
  else if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.type === type) into.push(element);
    find(element.props.children, type, into);
  }
  return into;
}
const needs = (content: PageContent) => {
  const tree = PageArticle({ content, place: { pageId: "p", owner: null } });
  const [support] = find(tree, MotionSupport);
  return (support.props as { needs: { js: boolean; view: boolean; any: boolean } }).needs;
};

describe("a page with motion on the server", () => {
  const content = page(
    row("r1", [column("c1", [heading("h1", "Above the fold", fadeUp), prose("t1", "Intro text")])]),
    row(
      "r2",
      [
        column("c2", [
          heading("h2", "Below the fold", { enter: { effect: "words" } }),
          prose("t2", "Story text", fadeUp),
        ]),
      ],
      {
        motion: { hover: { effect: "lift" } },
      },
    ),
  );

  it("has all the content in the HTML, with the effects as attributes", () => {
    const out = draw(content);
    for (const words of ["Above the fold", "Intro text", "Below the fold", "Story text"]) expect(out).toContain(words);
    // The first row plays by CSS at once; what is below waits for its waypoint.
    expect(out).toMatch(/data-fx-enter="fade-up"[^>]*data-fx-trigger="load"/);
    expect(out).toMatch(/data-fx-enter="words"[^>]*data-fx-trigger="view"[^>]*data-fx-text=""/);
    expect(out).toMatch(/data-fx-enter="fade-up"[^>]*data-fx-trigger="view"/);
    expect(out).toContain('data-fx-hover="lift"');
    // Text is not split on the server: the words are there whole.
    expect(out).not.toContain(`data-fx-w=""`);
  });

  it("has no attribute of motion on a page without it, and no fallback or runtime", () => {
    const plain = page(row("r1", [column("c1", [heading("h1", "Plain"), prose("t1", "Text")])]));
    const out = draw(plain);
    expect(out).toContain("Plain");
    expect(out).not.toContain("data-fx");
    expect(out).not.toContain("<noscript");
    expect(needs(plain)).toEqual({ js: false, view: false, any: false });
    expect(find(PageArticle({ content: plain, place: { pageId: "p", owner: null } }), MotionRuntime)).toHaveLength(0);
  });

  it("carries a no-script fallback when something waits for a waypoint, and clips its sides", () => {
    const out = draw(content);
    expect(out).toMatch(/<noscript><style>[^<]*data-fx-trigger="view"[^<]*opacity:1!important/);
    expect(out).toContain('<article class="flex flex-col gap-8" data-fx-clip="">');
    expect(draw(page(row("r1", [column("c1", [heading("h1", "Only load", fadeUp)])])))).not.toContain("<noscript");
  });

  it("draws the runtime only when the motion needs it", () => {
    expect(needs(content)).toEqual({ js: true, view: true, any: true });
    const runtime = (n: { js: boolean; view: boolean; any: boolean }) =>
      find(MotionSupport({ needs: n }), MotionRuntime);
    expect(runtime({ js: true, view: true, any: true })).toHaveLength(1);
    expect(runtime({ js: false, view: false, any: true })).toHaveLength(0);
    // Waiting entrances only in the first row, hover CSS only: nothing to load.
    const css = page(
      row("r1", [column("c1", [heading("h1", "Hi", fadeUp)])], { motion: { hover: { effect: "glow" } } }),
    );
    expect(needs(css)).toEqual({ js: false, view: false, any: true });
    expect(find(PageArticle({ content: css, place: { pageId: "p", owner: null } }), MotionRuntime)).toHaveLength(0);
  });

  it("gives a staggered row's columns the row's entrance and their number, and holds the row itself still", () => {
    const staggered = page(
      row("r0", [column("c0", [prose("t0", "Top")])]),
      row(
        "r1",
        [column("a", [prose("ta", "One")]), column("b", [prose("tb", "Two")]), column("c", [prose("tc", "Three")])],
        {
          layout: "3",
          motion: { enter: { effect: "fade-up", stagger: 120, delay: 100 } },
        },
      ),
    );
    const out = draw(staggered);
    expect(out).toContain('data-fx-each=""');
    expect(out.match(/data-fx-c=""/g)).toHaveLength(3);
    expect(out).toContain("--fx-i:0");
    expect(out).toContain("--fx-i:2;--fx-stagger:120ms");
    expect(out.match(/data-fx-enter="fade-up"/g)).toHaveLength(3);
  });

  it("does not start a picture in the first row transparent", () => {
    const hero = page(
      row("r1", [
        column("c1", [
          {
            id: "i1",
            type: "image",
            image: { ...picture, alt: "A" },
            caption: "",
            motion: { enter: { effect: "fade" } },
          } as PageBlock,
        ]),
      ]),
    );
    expect(draw(hero)).toMatch(/data-fx-nofade=""/);
  });

  it("plays a modal's entrances when it opens: they wait like any below the fold, whatever the row's place", async () => {
    const modal = row("m", [column("mc", [heading("mh", "Offer", fadeUp)])], {
      modal: { key: "offer", triggers: { button: true }, frequency: "always", size: "md" },
    });
    const element = await ModalRow({ row: modal, place: { pageId: "p", owner: null }, inAdmin: false });
    const out = renderToString(element).replace(/<!-- -->/g, "");
    expect(out).toContain("Offer");
    expect(out).toMatch(/data-fx-enter="fade-up"[^>]*data-fx-trigger="view"/);
    expect(needs(page(modal))).toMatchObject({ js: true, view: true });
  });
});

describe("motion backgrounds on the server", () => {
  const gradient = {
    type: "gradient" as const,
    style: "aurora" as const,
    colors: ["#112233", "#445566", "#778899"],
    flow: "medium" as const,
    grain: true,
  };
  const withBackground = (background: PageRow["background"], extra: Partial<PageRow> = {}) =>
    draw(page(row("r1", [column("c1", [heading("h1", "On top")])], { background, ...extra })));

  it("draws a gradient with CSS alone, behind the content", () => {
    const out = withBackground(gradient);
    expect(out).toContain("On top");
    expect(out).toMatch(
      /<div aria-hidden="true" class="absolute inset-0 -z-10 overflow-hidden \[border-radius:inherit\]"/,
    );
    expect(out).toContain('data-fx-grad="aurora"');
    expect(out.match(/data-fx-blob="\d"/g)).toHaveLength(3);
    expect(out).toContain('data-fx-flow="medium"');
    expect(out).toContain("data-fx-grain");
    expect(out).toContain("--fx-c1:#112233");
    expect(out).toContain("--fx-c2:#445566");
    expect(out).toContain("--fx-stops:#112233, #445566, #778899, #112233");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<video");
  });

  it("draws each style, with two colours as well as four, and only blobs for the aurora", () => {
    for (const style of ["shift", "mesh", "conic"] as const) {
      const out = withBackground({ type: "gradient", style, colors: ["#000000", "#ffffff"], angle: 45 });
      expect(out).toContain(`data-fx-grad="${style}"`);
      expect(out).not.toContain("data-fx-blob");
      expect(out).not.toContain("data-fx-grain");
      expect(out).toContain("--fx-angle:45deg");
      // Two colours fill four places by turns.
      expect(out).toContain("--fx-c3:#000000");
      expect(out).toContain("--fx-c4:#ffffff");
    }
  });

  it("leaves out a colour that is not #rrggbb, and a gradient left with fewer than two", () => {
    expect(withBackground({ ...gradient, colors: ["#112233", "red; background: url(x)"] })).not.toContain(
      "data-fx-grad",
    );
    expect(withBackground({ ...gradient, colors: ["#112233", "#445566"] })).toContain("data-fx-grad");
  });

  it("puts a picture on a layer that moves, only with motion", () => {
    const image = { type: "image" as const, image: picture, overlay: { color: "#000000", opacity: 40 } };
    const plain = withBackground(image);
    expect(plain).toContain("<img");
    expect(plain).not.toContain("data-fx");
    const moving = withBackground(image, { backgroundMotion: { effect: "parallax", intensity: "strong" } });
    expect(moving).toMatch(/data-fx-bgroot=""/);
    expect(moving).toMatch(
      /data-fx-layer=""[^>]*data-fx-bgm="parallax"[^>]*data-fx-scroll="bg-parallax"[^>]*data-fx-tl="parent"/,
    );
    expect(moving).toContain("--fx-sk:1.6");
    // The picture is on the layer, and the colour over it stays where it was.
    expect(moving).toMatch(/data-fx-layer[^>]*><img/);
    expect(moving).toContain("opacity:0.4");
  });

  it("never fades a background in on the page's first row, and runs a slow zoom by itself", () => {
    const image = { type: "image" as const, image: picture, overlay: null };
    expect(withBackground(image, { backgroundMotion: { effect: "fade-scroll" } })).not.toContain("data-fx");
    expect(withBackground(image, { backgroundMotion: { effect: "ken-burns" } })).toContain('data-fx-bgm="ken-burns"');
    expect(
      needs(
        page(
          row("r1", [column("c1", [heading("h", "x")])], {
            background: image,
            backgroundMotion: { effect: "ken-burns" },
          }),
        ),
      ),
    ).toMatchObject({ js: false });
  });

  it("puts a column's background motion on its own layer", () => {
    const content = page(
      row("r1", [
        column("c1", [heading("h1", "In column")], { background: gradient, backgroundMotion: { effect: "drift" } }),
      ]),
    );
    const out = draw(content);
    expect(out).toContain("In column");
    expect(out).toContain('data-fx-bgm="drift"');
    expect(out).toContain('data-fx-grad="aurora"');
  });
});
