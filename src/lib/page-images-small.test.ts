import { describe, expect, it } from "vitest";

import { newPageContent, pageInput, type PageContent, type PageRow } from "./page-content";
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

  it("lists the pictures that are layers over a row's, a column's and a nested column's background, and fills their small copies (D537)", () => {
    const cloud = (id: string, name: string) => ({ id, type: "picture" as const, image: { ...big, url: `https://x.test/${name}.webp` }, x: 50, y: 50 });
    const glow = { id: "g", type: "glow" as const, color: "#d946ef", x: 50, y: 50, width: 80, height: 60 };
    const layered = row({
      background: undefined,
      backgroundLayers: [glow, cloud("l1", "cloud")],
      columns: [
        {
          id: "c1",
          backgroundLayers: [cloud("l2", "rock")],
          blocks: [{ id: "k", type: "columns", layout: "1", columns: [{ id: "c2", blocks: [], backgroundLayers: [cloud("l3", "leaf")] }] } as never],
        },
      ],
    });
    expect(backgroundImageUrls(page([layered]))).toEqual(["https://x.test/cloud.webp", "https://x.test/rock.webp", "https://x.test/leaf.webp"]);

    const filled = withSmallCopies(page([layered]), (url) => url.replace(".webp", "-480.webp"));
    const smallOf = (layers: unknown) => (layers as { type: string; image?: { small?: string } }[]).filter((l) => l.type === "picture").map((l) => l.image?.small);
    expect(smallOf(filled.rows[0].backgroundLayers)).toEqual(["https://x.test/cloud-480.webp"]);
    expect(smallOf(filled.rows[0].columns[0].backgroundLayers)).toEqual(["https://x.test/rock-480.webp"]);
    const nested = (filled.rows[0].columns[0].blocks[0] as unknown as { columns: { backgroundLayers: unknown }[] }).columns[0];
    expect(smallOf(nested.backgroundLayers)).toEqual(["https://x.test/leaf-480.webp"]);
    // The other layers are the same, and a part without layers gains no key.
    expect(filled.rows[0].backgroundLayers?.[0]).toBe(glow);
    const plain = withSmallCopies(page([row()]), (url) => url.replace(".webp", "-480.webp"));
    expect("backgroundLayers" in plain.rows[0]).toBe(false);
    expect("backgroundLayers" in plain.rows[0].columns[0]).toBe(false);
    // Nothing to fill: the page as it was.
    const same = page([layered]);
    expect(withSmallCopies(same, () => undefined)).toBe(same);
  });

  it("sends a blurred picture's small copy only, and offers a sharp one's beside it by width", () => {
    const image = { ...big, small: "https://x.test/a-480.webp" };
    expect(backgroundSources(image, 6)).toEqual({ src: "https://x.test/a-480.webp" });
    expect(backgroundSources(image, 0)).toEqual({ src: big.url, srcSet: "https://x.test/a-480.webp 480w, https://x.test/a.webp 1600w" });
    // No small copy, or a picture no larger than one: as it is.
    expect(backgroundSources(big, 6)).toEqual({ src: big.url });
    expect(backgroundSources({ ...image, width: 400 }, 0)).toEqual({ src: big.url });
  });

  const imageBlock = { id: "i1", type: "image", image: { ...big, alt: "" } } as never;
  const withImage = () => page([row({ columns: [{ id: "c1", blocks: [imageBlock] }] })]);
  const imageOf = (content: PageContent) => (content.rows[0].columns[0].blocks[0] as unknown as { image: { small?: string; medium?: string } }).image;

  it("fills the 800 px copy on a row's background and on a picture component, and leaves it out where the library has none", () => {
    const small = (url: string) => url.replace(".webp", "-480.webp");
    const medium = (url: string) => url.replace(".webp", "-800.webp");
    const filled = withSmallCopies(page([row()]), small, medium);
    const r = filled.rows[0];
    expect(r.background?.type === "image" && r.background.image.medium).toBe("https://x.test/a-800.webp");
    const block = withSmallCopies(withImage(), small, medium);
    expect(imageOf(block)).toMatchObject({ small: "https://x.test/a-480.webp", medium: "https://x.test/a-800.webp" });
    const noMedium = withSmallCopies(withImage(), small);
    expect(imageOf(noMedium).small).toBe("https://x.test/a-480.webp");
    expect(imageOf(noMedium).medium).toBeUndefined();
    const none = withImage();
    expect(withSmallCopies(none, () => undefined, () => undefined)).toBe(none);
  });

  it("fills a Before and after's two pictures, and a medium alone still changes the page", () => {
    const pictureOf = (name: string) => ({ ...big, url: `https://x.test/${name}.webp`, alt: "" });
    const ba = { id: "b1", type: "beforeAfter", before: pictureOf("before"), after: pictureOf("after") } as never;
    const content = page([row({ columns: [{ id: "c1", blocks: [ba] }] })]);
    const filled = withSmallCopies(content, (url) => url.replace(".webp", "-480.webp"), (url) => url.replace(".webp", "-800.webp"));
    const got = filled.rows[0].columns[0].blocks[0] as unknown as { before: { small?: string; medium?: string }; after: { medium?: string } };
    expect(got.before).toMatchObject({ small: "https://x.test/before-480.webp", medium: "https://x.test/before-800.webp" });
    expect(got.after.medium).toBe("https://x.test/after-800.webp");
    const only = withSmallCopies(withImage(), () => undefined, (url) => url.replace(".webp", "-800.webp"));
    expect(only).not.toBe(withImage());
    expect(imageOf(only)).toMatchObject({ medium: "https://x.test/a-800.webp" });
    expect(imageOf(only).small).toBeUndefined();
  });

  it("offers a sharp background's 800 px copy between the other two, only when it is wider than that", () => {
    const image = { ...big, small: "s.webp", medium: "m.webp" };
    expect(backgroundSources(image, 0).srcSet).toBe("s.webp 480w, m.webp 800w, https://x.test/a.webp 1600w");
    expect(backgroundSources(image, 6)).toEqual({ src: "s.webp" });
    expect(backgroundSources({ ...image, width: 700 }, 0).srcSet).toBe("s.webp 480w, https://x.test/a.webp 700w");
  });

  it("never saves the small or the middle copy", () => {
    const content = {
      ...newPageContent(),
      title: "Copies",
      slug: "copies",
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "i1", type: "image", image: { ...big, alt: "x", small: "s.webp", medium: "m.webp" } }] }] }],
    };
    const json = JSON.stringify(pageInput.parse(content));
    expect(json).not.toContain('"medium"');
    expect(json).not.toContain('"small"');
  });
});
