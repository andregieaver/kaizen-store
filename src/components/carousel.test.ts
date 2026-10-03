import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GridData } from "@/lib/content-grid";
import { newBlock } from "@/lib/page-rows";
import type { ContentGridBlock } from "@/lib/page-content";

import { Carousel } from "./carousel";
import { ContentGridView } from "./content-grid";
import { TestimonialCards, type TestimonialEntry } from "./testimonials-view";

vi.mock("server-only", () => ({}));

/**
 * The carousel as the server draws it (D91, D155): the track and every link in it are in the HTML for a visitor without
 * script, the arrows are what they were, and what needs script (the dots, the Pause button) is not drawn until it runs.
 * What the controls do is `carousel-controller.test.ts`'s, and e2e/carousel.spec.ts's in a browser.
 */
const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "");
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((match) => match[1]);

const entries: TestimonialEntry[] = [
  { key: "a", quote: "Best coffee in town.", name: "Ola" },
  { key: "b", quote: "Fast delivery.", name: "Kari" },
  { key: "c", quote: "Will order again.", name: "Per" },
];

describe("a testimonials carousel by default", () => {
  const markup = html(createElement(TestimonialCards, { entries, carousel: true }));

  it("is the carousel it was: a scrolling track and two arrows, nothing else", () => {
    expect(markup).toContain("data-carousel-track");
    expect(markup).toContain('aria-roledescription="Carousel"');
    expect(buttons(markup)).toEqual(["Previous", "Next"]);
    // At the start, previous is off and next is on.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous"/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next"/);
    expect(markup).not.toContain("data-snap");
    expect(markup).not.toContain("aria-live");
    expect(markup).not.toContain("data-carousel-dot");
    expect(markup).not.toContain("data-carousel-toggle");
  });

  it("has every quote in the HTML, so it reads without script", () => {
    for (const entry of entries) expect(markup).toContain(entry.quote);
  });

  it("is a plain grid, with no carousel, when it is not one", () => {
    const grid = html(createElement(TestimonialCards, { entries, carousel: false, carouselSettings: { dots: true, autoplay: { seconds: 5 } } }));
    expect(grid).not.toContain("data-carousel-track");
    expect(grid).not.toContain("<button");
  });
});

describe("a carousel's settings, as drawn by the server", () => {
  const draw = (carouselSettings: Parameters<typeof TestimonialCards>[0]["carouselSettings"]) => html(createElement(TestimonialCards, { entries, carousel: true, carouselSettings }));

  it("leaves the arrows out when off, and the track still scrolls", () => {
    const markup = draw({ arrows: false });
    expect(buttons(markup)).toEqual([]);
    expect(markup).toContain("data-carousel-track");
    expect(markup).toContain("Best coffee in town.");
  });

  it("marks where a tile rests on the track, for the style sheet, only when it is not the start", () => {
    expect(draw({ snap: "center" })).toContain('data-snap="center"');
    expect(draw({ snap: "none" })).toContain('data-snap="none"');
    expect(draw({ snap: "start" })).not.toContain("data-snap");
  });

  it("draws neither dots nor a Pause button before the script runs, as they would do nothing", () => {
    const markup = draw({ dots: true, rewind: true, autoplay: { seconds: 5 } });
    expect(markup).not.toContain("data-carousel-dot");
    expect(markup).not.toContain("data-carousel-toggle");
    expect(markup).not.toContain("aria-live");
    expect(buttons(markup)).toEqual(["Previous", "Next"]);
  });

  it("names its buttons in the page's language: Norwegian, Swedish, Danish and English", async () => {
    const { t } = await import("@/lib/i18n");
    expect(t("nb").carouselGoTo(2, 5)).toBe("Gå til side 2 av 5");
    expect(t("sv").carouselGoTo(2, 5)).toBe("Gå till sida 2 av 5");
    expect(t("da").carouselGoTo(2, 5)).toBe("Gå til side 2 af 5");
    expect(t("en").carouselGoTo(2, 5)).toBe("Go to slide 2 of 5");
    expect([t("nb"), t("sv"), t("da"), t("en")].map((m) => [m.carouselPause, m.carouselPlay, m.carouselPages].every((word) => typeof word === "string" && word.length > 2))).toEqual([true, true, true, true]);
    // Pause and Play are told apart in every language.
    for (const lang of ["nb", "sv", "da", "en"] as const) expect(t(lang).carouselPause).not.toBe(t(lang).carouselPlay);
  });
});

describe("a content grid shown as a carousel", () => {
  const data: GridData = {
    lang: "en",
    locale: "en-GB",
    items: [1, 2, 3, 4].map((n) => ({ id: `i${n}`, href: `/s/kaizen/no/page-${n}`, title: `Page ${n}`, excerpt: "", image: null, price: null })),
  };
  const block = (extra: Partial<ContentGridBlock> = {}) =>
    ({ ...newBlock("contentGrid", () => "g"), source: { type: "pages" }, display: "carousel", ...extra }) as ContentGridBlock;

  it("keeps every link in the track, with the arrows, and no setting means the old markup", () => {
    const markup = html(createElement(ContentGridView, { block: block(), data }));
    expect(markup).toContain("data-carousel-track");
    for (const n of [1, 2, 3, 4]) expect(markup).toContain(`href="/s/kaizen/no/page-${n}"`);
    expect(buttons(markup)).toEqual(["Previous", "Next"]);
    expect(markup).not.toContain("data-snap");
  });

  it("takes its settings from the block", () => {
    const markup = html(createElement(ContentGridView, { block: block({ carousel: { arrows: false, snap: "center" } }), data }));
    expect(markup).toContain('data-snap="center"');
    expect(buttons(markup)).toEqual([]);
  });

  it("is a plain grid when it is not a carousel, whatever its settings", () => {
    const markup = html(createElement(ContentGridView, { block: block({ display: undefined, carousel: { dots: true } }), data }));
    expect(markup).not.toContain("data-carousel-track");
    expect(markup).not.toContain("<button");
  });
});

describe("Carousel on its own", () => {
  it("draws nothing under the row when it has no arrows and nothing else", () => {
    // eslint-disable-next-line react/no-children-prop -- the file is not JSX, and `children` is required
    const markup = html(createElement(Carousel, { settings: { arrows: false }, children: createElement("ul", { "data-carousel-track": "" }, createElement("li", null, "x")) }));
    expect(markup).not.toContain("<button");
    expect(markup).toContain("<li>x</li>");
  });
});
