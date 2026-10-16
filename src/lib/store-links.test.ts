import { describe, expect, it } from "vitest";

import { isStorePath, storeLink, withStoreLinks } from "./store-links";

/** Links in a store's own pages (`docs/signature-themes.md` step 1): a path written there is the store's, under the market shown. */
describe("a store's links", () => {
  it("draws a store path under the market's base, and leaves everything else as written", () => {
    expect(storeLink("/products", "/s/orbit/no")).toBe("/s/orbit/no/products");
    expect(storeLink("/category/planets?sort=new", "/s/orbit/no-en")).toBe("/s/orbit/no-en/category/planets?sort=new");
    expect(storeLink("/", "/s/orbit/no")).toBe("/s/orbit/no");
    // On its own host with one country the base is empty: nothing changes.
    expect(storeLink("/products", "")).toBe("/products");
    for (const kept of ["#prints", "https://example.com/a", "mailto:a@b.no", "tel:+4712345678", "/s/other/no/about", "/admin", "/api/x", "/themes/orbit", "/demo/themes/orbit/hero.webp", "/files/menu.pdf", "//evil.test/x"]) {
      expect(storeLink(kept, "/s/orbit/no"), kept).toBe(kept);
    }
    expect(isStorePath("/about#team")).toBe(true);
    expect(isStorePath("/admin/orbit")).toBe(false);
  });

  it("rewrites every href in a row, inline links in plain text and rich text's link marks, without changing the row given", () => {
    const row = {
      id: "r",
      columns: [
        {
          id: "c",
          link: { href: "/category/planets", label: "Planets" },
          blocks: [
            { id: "b", type: "button", label: "Shop", href: "/products" },
            { id: "d", type: "dualButton", first: { label: "A", href: "/products" }, second: { label: "B", href: "#story" } },
            { id: "h", type: "heading", text: 'See <a href="/about">our story</a> or <a href="https://x.test/">theirs</a>', level: 2 },
            { id: "t", type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "/faq" } }] }] }] } },
          ],
        },
      ],
    };
    const linked = withStoreLinks(row, "/s/orbit/no");
    expect(linked.columns[0].link.href).toBe("/s/orbit/no/category/planets");
    const blocks = linked.columns[0].blocks as Record<string, unknown>[];
    expect(blocks[0].href).toBe("/s/orbit/no/products");
    expect(blocks[1]).toMatchObject({ first: { href: "/s/orbit/no/products" }, second: { href: "#story" } });
    expect(blocks[2].text).toBe('See <a href="/s/orbit/no/about">our story</a> or <a href="https://x.test/">theirs</a>');
    expect(JSON.stringify(blocks[3])).toContain('"href":"/s/orbit/no/faq"');
    expect(row.columns[0].blocks[0].href).toBe("/products");
    expect(withStoreLinks(row, "")).toBe(row);
  });
});
