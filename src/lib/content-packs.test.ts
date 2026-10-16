import { describe, expect, it } from "vitest";

import { findClaims } from "./claims";
import { CONTENT_PACKS, PACK_KEYS, PICTURE_RULES, contentPack, packPicturePrompt, packPrice, packSlug } from "./content-packs";

/** Kaizena Flow's content packs (`docs/theme-showcase-phase-1.md` step 2): demo stores per trade, as data. */

const words = (pack: (typeof CONTENT_PACKS)[number]): string[] => [
  pack.title,
  pack.summary,
  pack.description,
  pack.storeName,
  pack.headline,
  pack.tagline,
  pack.storyTitle,
  pack.story,
  ...pack.about,
  ...pack.points.flatMap((p) => [p.title, p.text]),
  ...pack.categories.map((c) => c.name),
  ...pack.products.flatMap((p) => [p.title, p.description]),
];

describe("the content packs", () => {
  it("are the six first trades, once each, in order", () => {
    expect(CONTENT_PACKS.map((pack) => pack.key)).toEqual([...PACK_KEYS]);
    expect(contentPack("beauty")?.storeName).toBe("Lumen Skin");
    expect(contentPack("cars")).toBeNull();
    expect(packSlug("food")).toBe("pack-food");
  });

  it("say nothing the claims filter would stop: no environmental claims, urgency, prices or stock in words", () => {
    for (const pack of CONTENT_PACKS) {
      for (const text of words(pack)) expect(findClaims(text), `${pack.key}: ${text}`).toEqual([]);
    }
  });

  it("hold a whole small store: three points, categories its products use, products with fixed, unique addresses", () => {
    for (const pack of CONTENT_PACKS) {
      expect(pack.points, pack.key).toHaveLength(3);
      expect(pack.products.length, pack.key).toBeGreaterThanOrEqual(6);
      const slugs = pack.categories.map((c) => c.slug);
      const handles = pack.products.map((p) => p.handle);
      expect(new Set(handles).size, pack.key).toBe(handles.length);
      for (const product of pack.products) {
        expect(slugs, `${pack.key}/${product.handle}`).toContain(product.category);
        expect(product.handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(product.price).toBeGreaterThan(0);
        // Goods have a weight; services an appointment's length; never both.
        expect(Boolean(product.grams) !== Boolean(product.minutes), `${pack.key}/${product.handle}`).toBe(true);
      }
      for (const category of slugs) expect(pack.products.some((p) => p.category === category), `${pack.key}/${category}`).toBe(true);
    }
  });

  it("brief every picture in the pack's look, with no words, logos or faces", () => {
    const pack = CONTENT_PACKS[0];
    const prompt = packPicturePrompt(pack, pack.heroPicture);
    expect(prompt).toContain(pack.heroPicture);
    expect(prompt).toContain(pack.look);
    expect(prompt).toContain(PICTURE_RULES);
  });

  it("price Sweden as Norway in its own currency and Denmark at about two thirds, in minor units", () => {
    expect(packPrice(899, "NO")).toBe(89900);
    expect(packPrice(899, "SE")).toBe(89900);
    expect(packPrice(899, "DK")).toBe(60900);
    expect(packPrice(89, "DK")).toBe(5900);
  });
});
