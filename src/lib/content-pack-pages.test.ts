import { describe, expect, it } from "vitest";

import { packAboutPage, packHomePage, packProductsPage } from "./content-pack-pages";
import { CONTENT_PACKS } from "./content-packs";
import { pageInput } from "./page-content";

/** A content pack's pages (`docs/theme-showcase-phase-1.md` step 2): built from its words in the core section styles, valid as saved. */

const picture = { url: "https://x.supabase.co/storage/v1/object/public/product-media/s/hero.webp", width: 1600, height: 1067, alt: "A shop" };

describe("a content pack's pages", () => {
  it("are pages the builder accepts, with and without their pictures, for every pack", () => {
    for (const pack of CONTENT_PACKS) {
      for (const pictures of [{ hero: null, story: null }, { hero: picture, story: picture }]) {
        const home = pageInput.safeParse(packHomePage(pack, pictures));
        expect(home.success, `${pack.key} home: ${home.error?.issues.map((i) => i.message).join("; ")}`).toBe(true);
      }
      expect(pageInput.safeParse(packAboutPage(pack, picture)).success, `${pack.key} about`).toBe(true);
      expect(pageInput.safeParse(packAboutPage(pack, null)).success, `${pack.key} about without a picture`).toBe(true);
      expect(pageInput.safeParse(packProductsPage(pack)).success, `${pack.key} all products`).toBe(true);
    }
  });

  it("draw the hero in the theme's hero style, light words only over a picture, then the products, the points and the story", () => {
    const pack = CONTENT_PACKS[0];
    const plain = packHomePage(pack, { hero: null, story: null });
    expect(plain.rows.map((r) => r.sectionStyle)).toEqual(["hero", "plain", "feature", "muted"]);
    expect(JSON.stringify(plain.rows[0])).not.toContain("#ffffff");
    const pictured = packHomePage(pack, { hero: picture, story: picture });
    expect(pictured.rows[0].background).toMatchObject({ type: "image", image: { url: picture.url } });
    expect(JSON.stringify(pictured.rows[0])).toContain("#ffffff");
    expect(JSON.stringify(pictured)).toContain(pack.headline);
    expect(pictured.rows[1].htmlId).toBe("products");
  });

  it("call a store of services' grid its services", () => {
    const services = CONTENT_PACKS.find((p) => p.key === "services")!;
    expect(JSON.stringify(packHomePage(services, { hero: null, story: null }))).toContain("See the services");
    expect(packProductsPage(services).title).toBe("All services");
    expect(packProductsPage(CONTENT_PACKS[0]).title).toBe("All products");
  });

  it("keep the home page off the address a store's own home takes (D181), and list every product with filters on All products", () => {
    expect(packHomePage(CONTENT_PACKS[0], { hero: null, story: null }).slug).toBe("welcome");
    expect(JSON.stringify(packProductsPage(CONTENT_PACKS[0]))).toContain('"filters":true');
  });
});
