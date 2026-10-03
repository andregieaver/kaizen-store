import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SOURCE_TRAITS, sourceTraits, type SourceTraits } from "./grid-source";
import { newPageContent, pageInput, type ContentGridBlock, type GridSource } from "./page-content";
import { newBlock } from "./page-rows";

/**
 * What a content grid's kinds of content (D155) mean for the code that reads `block.source.type`: one table keyed by every
 * source, an exhaustive switch over it, and an inventory of every reader, each with the decision taken for the new source.
 */

describe("an exhaustive switch over GridSource", () => {
  // A source added to the union and not handled is a compile error (the `@ts-expect-error` lines fail `pnpm typecheck` if the
  // switch stops catching it), so adding one means deciding each reader below.
  type WithNewSource = GridSource | { type: "future" };

  function name(source: WithNewSource): string {
    switch (source.type) {
      case "pages":
      case "articles":
      case "products":
      case "custom":
        return source.type;
      default: {
        // @ts-expect-error a source nobody handles is not `never`
        const unhandled: never = source;
        return String(unhandled);
      }
    }
  }

  // @ts-expect-error the traits table has no row for a source added to the union
  const incomplete: Record<WithNewSource["type"], SourceTraits> = SOURCE_TRAITS;

  it("names every source and answers for each in the traits table", () => {
    expect(incomplete).toBe(SOURCE_TRAITS);
    for (const type of ["pages", "articles", "products", "custom"] as const) {
      expect(name({ type })).toBe(type);
      expect(Object.keys(SOURCE_TRAITS)).toContain(type);
    }
    expect(Object.keys(SOURCE_TRAITS).sort()).toEqual(["articles", "custom", "pages", "products"]);
  });

  it("throws for a source it does not know, rather than treating it as another", () => {
    expect(() => sourceTraits({ type: "future" } as unknown as GridSource)).toThrow(/unknown source/);
  });

  it("is the same list the page's schema accepts, and no other", () => {
    const parse = (type: string) => {
      const block = { ...(newBlock("contentGrid", () => "g1") as ContentGridBlock), source: { type } as unknown as GridSource, limit: 6 };
      const page = { ...newPageContent(), title: "T", slug: "t", rows: [{ id: "r1", type: "row" as const, layout: "1" as const, columns: [{ id: "c1", blocks: [block] }] }] };
      return pageInput.safeParse(page).success;
    };
    for (const type of Object.keys(SOURCE_TRAITS)) expect(parse(type), type).toBe(true);
    expect(parse("future")).toBe(false);
  });
});

describe("what each source means", () => {
  it("looks items up for pages, articles and products, and takes custom items from the block", () => {
    expect(sourceTraits({ type: "pages" }).lookedUp).toBe(true);
    expect(sourceTraits({ type: "articles" }).lookedUp).toBe(true);
    expect(sourceTraits({ type: "products" }).lookedUp).toBe(true);
    expect(sourceTraits({ type: "custom" }).lookedUp).toBe(false);
  });

  it("is a product only for products: live prices, campaigns, recommendations, filters and the theme's cards", () => {
    expect(Object.entries(SOURCE_TRAITS).filter(([, traits]) => traits.products).map(([type]) => type)).toEqual(["products"]);
  });

  it("chooses by categories and tags for what is looked up, never for custom items", () => {
    expect(sourceTraits({ type: "custom" }).terms).toBe(false);
    expect(sourceTraits({ type: "custom" }).fieldEntity).toBeNull();
    expect(sourceTraits({ type: "products" }).fieldEntity).toBe("product");
    expect(sourceTraits({ type: "articles" }).fieldEntity).toBe("article");
    expect(sourceTraits({ type: "pages" }).fieldEntity).toBe("page");
  });

  it("says “View product” only for products, “Read more” for everything else", () => {
    expect(sourceTraits({ type: "products" }).button).toBe("viewProduct");
    for (const type of ["pages", "articles", "custom"] as const) expect(sourceTraits({ type }).button).toBe("readMore");
  });
});

/** The decision for each module that reads `source.type`, made when custom items were added (D155). */
const READERS: Record<string, string> = {
  "src/components/admin/page-builder.tsx":
    "the builder: the source choice, custom items' editor and Copy current items; terms, order, limit, filters, recommendations and tile fields are hidden for custom; the theme's cards and filters are products'",
  "src/components/admin/custom-items-editor.tsx": "the custom items' own editor and Copy current items, which turns a looked-up source into custom items",
  "src/lib/custom-grid.ts": "sourceChoice(): what changes in a grid when the owner chooses another source (custom items are kept in the editor until the page is saved)",
  "src/lib/experiment-parts.ts": "names a custom grid in an A/B test by its first titles; the other sources by the page's own words (none)",
  "src/lib/grid-source.ts": "the table and its exhaustive switch",
  "src/lib/page-content.ts": "ownProducts() leaves custom as it is; gridImageShape() draws custom items as pages are (never the theme's product cards); the schema's rules for custom",
  "src/lib/page-translation.ts": "only a custom grid's items are texts to translate (items left over from another source are not shown)",
  "src/server/content-grid.ts": "gridData() is an exhaustive switch: custom is answered from the block (no query); pages, articles and products are looked up",
  "src/server/page-rules.ts": "the owner rules are about products' store and market: custom has none",
  "src/server/recommend-grid.ts": "recommendations are products' only: a custom grid never recommends",
};

describe("every module that reads a grid's source", () => {
  const root = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const readers = walk(path.join(root, "src"))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !/\.int\.test\./.test(file))
    .filter((file) => /\bsource\??\.type\b/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();

  it("has a decision for custom items, and a new reader needs one", () => {
    // A module that reads `source.type` and is not listed has not been decided for custom items: decide it, then list it.
    expect(readers).toEqual(Object.keys(READERS).sort());
  });
});

describe("the readers that only ask what a source means", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("ask sourceTraits() rather than comparing the source's name, so a new source has to answer", () => {
    // These take what the grid shows from the table: products' cards and campaigns, the button's words, what the editor offers.
    for (const file of ["src/components/content-grid.tsx", "src/components/content-grid-section.tsx"]) {
      const text = read(file);
      expect(text, file).toContain("sourceTraits(");
      expect(text, file).not.toMatch(/\bsource\??\.type\s*[!=]==/);
    }
    // The page's image shape and the builder's "is it products" and "is it custom" questions too.
    expect(read("src/lib/page-content.ts")).toContain("sourceTraits(block.source).products");
    expect(read("src/components/admin/page-builder.tsx")).toContain("const custom = !traits.lookedUp;");
  });

  it("answers every source in gridData(), ending in an exhaustive check", () => {
    const text = read("src/server/content-grid.ts");
    expect(text).toContain("assertNever(source)");
    for (const type of Object.keys(SOURCE_TRAITS)) expect(text, type).toContain(`case "${type}"`);
  });
});
