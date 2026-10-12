import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageBlockView } from "@/components/page-block";

import { galleryAspect, galleryColumns, galleryFades, gallerySlides, galleryZoomVars, stepSlide } from "./gallery";
import { blockHasContent, blockText, pageInput, type GalleryBlock, type GalleryItem, type PageContent } from "./page-content";
import { pageIssues } from "./page-a11y";
import { newBlock } from "./page-rows";
import { blockTextFields } from "./page-translation";
import { partRules } from "./part-css";
import { mapTemplateMedia } from "./template-content";

/** The gallery (D209): pictures and videos mixed, a grid or a carousel, a lightbox. */

const picture = (name: string) => ({ url: `https://example.com/${name}.jpg`, width: 800, height: 600 });
const image = (id: string, alt = `Picture ${id}`): GalleryItem => ({ id, kind: "image", picture: picture(id), alt, caption: "" });
const youtube = (id: string): GalleryItem => ({ id, kind: "video", source: "youtube", link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", picture: null, alt: "Our workshop", caption: "A tour" });
const uploaded = (id: string): GalleryItem => ({ id, kind: "video", video: { url: "https://example.com/clip.mp4" }, picture: picture("still"), alt: "Clip", caption: "" });
const gallery = (over: Partial<GalleryBlock> = {}): GalleryBlock => ({ id: "g1", type: "gallery", items: [image("a"), youtube("b"), uploaded("c")], ...over });
const page = (block: GalleryBlock): PageContent => ({
  title: "Galleri",
  slug: "galleri",
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }],
});

describe("gallery (D209)", () => {
  it("has three columns on computers, at most three on Medium and two on Small, unless the owner says otherwise per size", () => {
    expect(["xl", "lg", "md", "sm"].map((size) => galleryColumns({}, size as never))).toEqual([3, 3, 3, 2]);
    expect(["xl", "lg", "md", "sm"].map((size) => galleryColumns({ columns: 5 }, size as never))).toEqual([5, 5, 3, 2]);
    expect(galleryColumns({ columns: 5, at: { sm: { columns: 1 } } }, "sm")).toBe(1);
    expect(galleryAspect(undefined)).toBe("1 / 1");
    expect(galleryAspect("auto")).toBeUndefined();
  });

  it("shows pieces with something to show, pictures and videos alike, in order", () => {
    const slides = gallerySlides([image("a"), { ...image("x"), picture: null }, youtube("b"), uploaded("c"), { ...youtube("d"), link: "nope" }]);
    expect(slides.map((s) => [s.key, s.kind])).toEqual([["a", "image"], ["b", "embed"], ["c", "upload"]]);
    expect(blockHasContent(newBlock("gallery", () => "g"))).toBe(false);
    expect(blockHasContent(gallery())).toBe(true);
    expect(stepSlide(2, 1, 3)).toBe(0);
    expect(stepSlide(0, -1, 3)).toBe(2);
  });

  it("is saved, mixed, and refuses a video address that does not play", () => {
    expect(pageInput.safeParse(page(gallery())).success).toBe(true);
    expect(pageInput.safeParse(page(gallery({ items: [{ ...youtube("b"), link: "https://example.com/not-a-video" }] }))).success).toBe(false);
  });

  it("has its columns per screen size in its rules, and its words translated by piece", () => {
    const plain = partRules(page(gallery()).rows, "site").length;
    expect(plain).toBeGreaterThan(0);
    const fields = blockTextFields(gallery());
    expect(fields.map((f) => f.key)).toEqual(expect.arrayContaining(["block.g1.a.alt", "block.g1.b.caption"]));
    expect(blockText(gallery())).toContain("A tour");
  });

  it("carries its pictures and videos when used as a template", () => {
    const moved = mapTemplateMedia("block", gallery(), (url) => url.replace("example.com", "cdn.example.org")) as GalleryBlock;
    expect(moved.items[0].picture?.url).toContain("cdn.example.org");
    expect(moved.items[2].video?.url).toContain("cdn.example.org");
  });

  it("asks for a picture's alt text and a video's title", () => {
    const issues = pageIssues(page(gallery({ items: [image("a", ""), { ...uploaded("c"), alt: "" }] })));
    expect(issues.filter((i) => i.rule === "image_alt")).toHaveLength(2);
  });

  it("draws tiles that open the lightbox, as links to the pieces themselves, with their captions", () => {
    const html = renderToStaticMarkup(createElement(PageBlockView, { block: gallery({ items: [{ ...image("a"), caption: "Morning" }, youtube("b")] }) }));
    expect(html).toContain('data-gallery=""');
    expect(html).toContain('data-gallery-open="0"');
    expect(html).toContain('href="https://example.com/a.jpg"');
    expect(html).toContain("Morning");
    expect(html).toContain('alt="Picture a"');
    // A carousel is the site's own.
    expect(renderToStaticMarkup(createElement(PageBlockView, { block: gallery({ view: "carousel" }) }))).toContain("data-carousel-track");
  });

  it("without the lightbox, shows pictures as they are and plays videos in their tiles", () => {
    const html = renderToStaticMarkup(createElement(PageBlockView, { block: gallery({ lightbox: false }) }));
    expect(html).not.toContain("data-gallery-open");
    expect(html).toContain("<video");
  });

  it("fades only as a carousel with one tile in view at every screen size (D210)", () => {
    const one = { view: "carousel" as const, transition: "fade" as const, columns: 1 };
    expect(galleryFades(one)).toBe(true);
    expect(galleryFades({ ...one, view: "grid" })).toBe(false);
    expect(galleryFades({ ...one, transition: undefined })).toBe(false);
    expect(galleryFades({ ...one, columns: 2 })).toBe(false);
    expect(galleryFades({ ...one, at: { md: { columns: 2 } } })).toBe(false);
  });

  it("zooms by its own amount, at the site's hover time unless it has its own (D210)", () => {
    expect(galleryZoomVars({})).toEqual({ "--gallery-zoom": "1.03" });
    expect(galleryZoomVars({ hoverZoom: 0 })).toEqual({ "--gallery-zoom": "1" });
    expect(galleryZoomVars({ hoverZoom: 12, hoverZoomMs: 900 })).toEqual({ "--gallery-zoom": "1.12", "--gallery-zoom-ms": "900ms" });
    expect(pageInput.safeParse(page(gallery({ hoverZoom: 31 }))).success).toBe(false);
    expect(pageInput.safeParse(page(gallery({ fadeMs: 50 }))).success).toBe(false);
  });

  it("draws a fading carousel as tiles on top of one another, only the first in front and reachable (D210)", () => {
    const html = renderToStaticMarkup(createElement(PageBlockView, { block: gallery({ view: "carousel", transition: "fade", columns: 1, fadeMs: 900 }) }));
    expect(html).toContain("data-fade");
    expect(html).toContain("--fade-ms:900ms");
    expect(html.match(/data-on=""/g)).toHaveLength(1);
    expect(html.match(/inert=""/g)).toHaveLength(2);
    expect(html).not.toContain("data-carousel-track");
  });
});
