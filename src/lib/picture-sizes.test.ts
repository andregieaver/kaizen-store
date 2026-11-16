import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/wishlist-heart", () => ({ WishlistHeart: () => null }));

import { PageBlockView } from "@/components/page-block";
import { ProductCard } from "@/components/product-card";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { newPageContent, pageInput, type ImageBlock, type PageContent, type PageRow } from "@/lib/page-content";
import { withSmallCopies } from "@/lib/page-images";
import { newBlock } from "@/lib/page-rows";
import { priceView, WITH_VAT } from "@/lib/pricing";
import type { ProductSummary } from "@/server/catalog";

import { fixedSizes, gridSizes, pictureSources } from "./picture-sizes";

/**
 * Pictures at the visitor's device size (D336): the library keeps every picture as two files (D213), offered by width with `srcset`
 * on a product card, a grid's tile and a picture component; a picture with one file is drawn as it always was.
 */

const large = "https://x.test/lamp.webp";
const small = "https://x.test/lamp-480.webp";

describe("which files a picture is loaded from", () => {
  it("offers the small copy and the picture by width, the picture as the fallback", () => {
    expect(pictureSources({ url: large, small, width: 1200 })).toEqual({ src: large, srcSet: `${small} 480w, ${large} 1200w` });
    // A width the library does not know is taken as the most a picture is kept at.
    expect(pictureSources({ url: large, small })).toEqual({ src: large, srcSet: `${small} 480w, ${large} 1600w` });
  });

  it("is the one file without a small copy, with the same file twice, or for a picture no wider than the copy", () => {
    expect(pictureSources({ url: large })).toEqual({ src: large });
    expect(pictureSources({ url: large, small: large, width: 1200 })).toEqual({ src: large });
    expect(pictureSources({ url: large, small, width: 400 })).toEqual({ src: large });
  });

  it("offers the middle copy between the two when the picture has one and is wider than it", () => {
    expect(pictureSources({ url: "big.webp", small: "s.webp", medium: "m.webp", width: 1600 })).toEqual({
      src: "big.webp",
      srcSet: "s.webp 480w, m.webp 800w, big.webp 1600w",
    });
    // No wider than the middle copy: the two files, as before.
    expect(pictureSources({ url: "big.webp", small: "s.webp", medium: "m.webp", width: 700 })).toEqual({ src: "big.webp", srcSet: "s.webp 480w, big.webp 700w" });
    // Without one, or with the picture itself as the middle copy: today's two-file string.
    expect(pictureSources({ url: large, small, medium: null, width: 1200 })).toEqual({ src: large, srcSet: `${small} 480w, ${large} 1200w` });
    expect(pictureSources({ url: large, small, medium: large, width: 1200 })).toEqual({ src: large, srcSet: `${small} 480w, ${large} 1200w` });
    // Without a small copy it is the one file, whatever the middle copy.
    expect(pictureSources({ url: large, medium: "m.webp", width: 1600 })).toEqual({ src: large });
    expect(pictureSources({ url: large, small: null, medium: "m.webp" })).toEqual({ src: large });
  });

  it("says how wide a grid's tile is at each screen size, less the page's sides and the gaps, leaving out what repeats", () => {
    // Bloat review step 0.33: the page's sides (32 px) and the gaps between the columns come off the screen before it is shared.
    expect(gridSizes({ xl: 4, md: 4, sm: 2 }, { gaps: { xl: 24 } })).toBe("(min-width: 768px) calc((100vw - 104px) / 4), calc((100vw - 56px) / 2)");
    expect(gridSizes({ xl: 4, lg: 3, md: 2, sm: 1 }, { gaps: { xl: 24, sm: 16 } })).toBe(
      "(min-width: 1280px) calc((100vw - 104px) / 4), (min-width: 1024px) calc((100vw - 80px) / 3), (min-width: 768px) calc((100vw - 56px) / 2), calc(100vw - 32px)",
    );
    // Without gaps, only the page's sides.
    expect(gridSizes({ xl: 2 })).toBe("calc((100vw - 32px) / 2)");
    // What a 2-column tile claims at 360 and 390 px against the tile measured there (148 and 163 px): never under it, and at 3x on
    // the right side of the 480 px copy (160 px), so 360 px takes the 480 px copy and 390 px the 800 px one.
    const claim = (screen: number) => (screen - 56) / 2;
    expect(claim(360)).toBeGreaterThanOrEqual(148);
    expect(claim(360) * 3).toBeLessThanOrEqual(480);
    expect(claim(390)).toBeGreaterThanOrEqual(163);
    expect(claim(390) * 3).toBeGreaterThan(480);
    expect(fixedSizes(640)).toBe("(min-width: 640px) 640px, 100vw");
  });

  it("tells a picture in a column that stays beside others its share of the screen", () => {
    expect(fixedSizes(600)).toBe("(min-width: 600px) 600px, 100vw");
    expect(fixedSizes(600, 0.5)).toBe("(min-width: 1200px) 600px, 50vw");
    expect(fixedSizes(600, 1)).toBe(fixedSizes(600));
    expect(fixedSizes(600, 0)).toBe(fixedSizes(600));
  });
});

describe("the markup", () => {
  const market = { slug: "no", code: "NO", currency: "NOK", locale: "nb-NO", lang: "nb" } as Market;
  const card = (image: ProductSummary["image"]) =>
    renderToString(
      createElement(ProductCard, {
        product: { id: "p1", handle: "lampe", title: "Lampe", audience: "all", image, priceVaries: false, price: priceView(4990, "NOK", null, WITH_VAT), preorderUntil: null, priceOnRequest: false },
        href: "/s/demo/no/p/lampe",
        market,
        m: t("nb"),
        store: "demo",
        base: "/s/demo/no",
      }),
    );

  it("gives a product card both files by width, sized to the listing's columns", () => {
    const html = card({ url: small, alt: "Lampe", large, width: 1200 });
    expect(html).toContain(`srcSet="${small} 480w, ${large} 1200w"`);
    expect(html).toContain('sizes="(min-width: 768px) calc((100vw - 104px) / 4), calc((100vw - 56px) / 2)"');
    expect(html).toMatch(/<img[^>]*src="https:\/\/x\.test\/lamp\.webp"/);
  });

  it("draws a card's picture with one file as before, without srcset", () => {
    const html = card({ url: "/demo/lamp.webp", alt: "Lampe" });
    expect(html).not.toContain("srcSet");
    expect(html).toContain('src="/demo/lamp.webp"');
  });

  const block = (image: ImageBlock["image"]): ImageBlock => ({ ...(newBlock("image", () => "i1") as ImageBlock), image });
  const page = (b: ImageBlock): PageContent =>
    ({ ...newPageContent(), title: "T", slug: "t", rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [b] }] } as PageRow] }) as PageContent;

  it("gives a picture component the library's small copy when the page is read, and both files by width at its own size", () => {
    const filled = withSmallCopies(page(block({ url: large, width: 1200, height: 800, alt: "A lamp" })), (url) => (url === large ? small : undefined));
    const image = filled.rows[0].columns[0].blocks[0] as ImageBlock;
    expect(image.image?.small).toBe(small);
    const html = renderToString(createElement(PageBlockView, { block: image } as never));
    expect(html).toContain(`srcSet="${small} 480w, ${large} 1200w"`);
    expect(html).toContain('sizes="(min-width: 1200px) 1200px, 100vw"');
  });

  it("never saves the small copy: the page's schema drops it", () => {
    const parsed = pageInput.parse(page(block({ url: large, width: 1200, height: 800, alt: "", small })));
    const saved = parsed.rows[0].columns[0].blocks[0] as ImageBlock;
    expect(saved.image).toEqual({ url: large, width: 1200, height: 800, alt: "" });
  });
});
