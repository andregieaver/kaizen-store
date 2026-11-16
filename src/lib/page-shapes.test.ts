import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { packAboutPage, packHomePage, packProductsPage } from "./content-pack-pages";
import { CONTENT_PACKS } from "./content-packs";
import { LAUNCH_THEMES } from "./launch-themes";
import { PACK_DESIGNS } from "./pack-designs";
import { pageInput, pageRowSchema } from "./page-content";

/**
 * Every page that source writes (the signature themes, the content packs, the seed) equals its own parse (step 0.46): a page written in
 * an old shape is changed by the parse, and each one adds to the rewrite of stored pages (step 3.17).
 */

const picture = { url: "https://x.supabase.co/storage/v1/object/public/product-media/s/hero.webp", width: 1600, height: 1067, alt: "A shop" };

function same(name: string, value: unknown, schema: z.ZodType) {
  const plain = JSON.parse(JSON.stringify(value));
  const parsed = schema.safeParse(plain);
  expect(parsed.success, `${name}: ${parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`).toBe(true);
  if (!parsed.success) return;
  expect(JSON.parse(JSON.stringify(parsed.data)), `${name} is written in an old shape: the parse changed it`).toEqual(plain);
}

describe("the pages that source writes equal their parse", () => {
  it("every content pack's pages", () => {
    for (const pack of CONTENT_PACKS) {
      same(`${pack.key} home`, packHomePage(pack, { hero: picture, story: picture }), pageInput);
      same(`${pack.key} home without pictures`, packHomePage(pack, { hero: null, story: null }), pageInput);
      same(`${pack.key} about`, packAboutPage(pack, picture), pageInput);
      same(`${pack.key} about without a picture`, packAboutPage(pack, null), pageInput);
      same(`${pack.key} all products`, packProductsPage(pack), pageInput);
    }
  });

  it("every signature theme's designed pages", () => {
    expect(Object.keys(PACK_DESIGNS).length).toBe(6);
    for (const [key, design] of Object.entries(PACK_DESIGNS)) {
      const pack = CONTENT_PACKS.find((p) => p.key === LAUNCH_THEMES.find((t) => t.key === key)?.content);
      expect(pack, `${key} has a content pack`).toBeDefined();
      if (!pack) continue;
      same(`${key} home`, design.home(pack, () => picture), pageInput);
      same(`${key} home without pictures`, design.home(pack, () => null), pageInput);
      same(`${key} about`, design.about(pack, () => picture), pageInput);
    }
  });

  it("every launch theme's header, footer and product page", () => {
    for (const theme of LAUNCH_THEMES) {
      for (const key of ["header", "footer", "productLayout"] as const) {
        const layout = theme.snapshot[key];
        if (layout) same(`${theme.key} ${key}`, layout.rows, pageRowSchema.array());
      }
    }
  });

  it("every theme's sections", () => {
    for (const theme of LAUNCH_THEMES) {
      if (theme.sections) same(`${theme.key} sections`, theme.sections(() => picture).map((section) => section.row), pageRowSchema.array());
    }
  });

  it("the seed's pages", () => {
    const seed = readFileSync(`${process.cwd()}/supabase/seed.sql`, "utf8");
    const matches = [...seed.matchAll(/'(\{"title".*?\})'::jsonb/g)];
    expect(matches.length).toBeGreaterThanOrEqual(10);
    matches.forEach((match, i) => same(`seed page ${i + 1}`, JSON.parse(match[1].replaceAll("''", "'")), pageInput));
  });

  it("would notice a grid in the old shape", () => {
    const page = JSON.parse(JSON.stringify(packProductsPage(CONTENT_PACKS[0])));
    let changed = 0;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        const block = node as Record<string, unknown>;
        if (block.type === "contentGrid") {
          block.columns = { mobile: 2, tablet: 3, desktop: 4 };
          delete block.at;
          changed += 1;
        }
        Object.values(block).forEach(walk);
      }
    };
    walk(page);
    expect(changed).toBeGreaterThan(0);
    const parsed = pageInput.safeParse(page);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(JSON.parse(JSON.stringify(parsed.data))).not.toEqual(page);
  });
});
