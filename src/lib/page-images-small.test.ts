import { describe, expect, it } from "vitest";

import type { PageContent, PageRow } from "./page-content";
import { backgroundImageUrls, backgroundSources, withSmallCopies } from "./page-images";

/** Background pictures' small copies (the library's 480 px one), for phones and blurred pictures. */

const big = { url: "https://x.test/a.webp", width: 1600, height: 900 };
const row = (over: Partial<PageRow> = {}): PageRow => ({
  id: "r1",
  type: "row",
  layout: "1",
  background: { type: "image", image: big, overlay: null, blur: 6 },
  columns: [{ id: "c1", blocks: [], background: { type: "image", image: { ...big, url: "https://x.test/b.webp" }, overlay: null } }],
  ...over,
});
const page = (rows: PageRow[]): PageContent =>
  ({ title: "x", slug: "x", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [], rows }) as PageContent;

describe("background pictures' small copies", () => {
  it("lists the rows' and columns' pictures", () => {
    expect(backgroundImageUrls(page([row()]))).toEqual(["https://x.test/a.webp", "https://x.test/b.webp"]);
  });

  it("fills the small copy where the library has one, and leaves the page alone otherwise", () => {
    const small = new Map([["https://x.test/a.webp", "https://x.test/a-480.webp"]]);
    const filled = withSmallCopies(page([row()]), (url) => small.get(url));
    const r = filled.rows[0];
    expect(r.background?.type === "image" && r.background.image.small).toBe("https://x.test/a-480.webp");
    expect(r.columns[0].background?.type === "image" && r.columns[0].background.image.small).toBeUndefined();
    const none = page([row()]);
    expect(withSmallCopies(none, () => undefined)).toBe(none);
  });

  it("sends a blurred picture's small copy only, and offers a sharp one's beside it by width", () => {
    const image = { ...big, small: "https://x.test/a-480.webp" };
    expect(backgroundSources(image, 6)).toEqual({ src: "https://x.test/a-480.webp" });
    expect(backgroundSources(image, 0)).toEqual({ src: big.url, srcSet: "https://x.test/a-480.webp 480w, https://x.test/a.webp 1600w" });
    // No small copy, or a picture no larger than one: as it is.
    expect(backgroundSources(big, 6)).toEqual({ src: big.url });
    expect(backgroundSources({ ...image, width: 400 }, 0)).toEqual({ src: big.url });
  });
});
