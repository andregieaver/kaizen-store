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

  it("says how wide a grid's tile is at each screen size, leaving out what repeats", () => {
    expect(gridSizes({ xl: 4, md: 4, sm: 2 })).toBe("(min-width: 768px) 25vw, 50vw");
    expect(gridSizes({ xl: 4, lg: 3, md: 2, sm: 1 })).toBe("(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw");
    expect(fixedSizes(640)).toBe("(min-width: 640px) 640px, 100vw");
  });
});

describe("the markup", () => {
  const market = { slug: "no", code: "NO", currency: "NOK", locale: "nb-NO", lang: "nb" } as Market;
  const card = (image: ProductSummary["image"]) =>
    renderToString(
      createElement(ProductCard, {
        product: { id: "p1", handle: "lampe", title: "Lampe", audience: "all", image, priceVaries: false, price: priceView(4990, "NOK", null, WITH_VAT) },
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
    expect(html).toContain('sizes="(min-width: 768px) 25vw, 50vw"');
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
