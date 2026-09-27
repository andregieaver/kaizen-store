import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Product layouts (D79): a store's published layout lays out its product
 * pages, with the product's parts where its product components are.
 */
test("a store's standard product layout lays out its product pages", async ({ page }) => {
  const slug = `layouts-${Date.now()}`;
  const layout = {
    title: "Kompakt",
    slug: "kompakt",
    thumbnail: null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: [
      {
        id: "r1",
        type: "row",
        layout: "1",
        columns: [
          {
            id: "c1",
            blocks: [
              { id: "t", type: "product", part: "title", wishlist: false },
              { id: "p", type: "product", part: "price" },
              { id: "h", type: "heading", text: "Håndplukket for deg", level: 2 },
              { id: "rel", type: "product", part: "related", heading: "Mer fra oss", limit: 2 },
            ],
          },
        ],
      },
    ],
  };
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null) as id`;
    const [{ id: layoutId }] = await sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}, 'product_layout', 'kompakt', ${sql.json(layout)}, ${sql.json(layout)}, now()) returning id`;
    await sql`update commerce.stores set product_layout_id = ${layoutId} where id = ${storeId}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  await expect(page.getByRole("heading", { level: 1, name: "Demo: Keramikkopp" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Håndplukket for deg" })).toBeVisible();
  // Two related products, not the mug itself.
  const related = page.getByRole("region", { name: "Mer fra oss" });
  await expect(related.getByRole("heading", { name: "Mer fra oss" })).toBeVisible();
  await expect(related.locator("a[href*='/p/demo-']")).toHaveCount(2);
  await expect(related.locator("a[href$='/p/demo-keramikkopp']")).toHaveCount(0);
  // What the layout leaves out is not there: no pictures, no wishlist heart, no buying.
  await expect(page.getByRole("button", { name: "Lagre Demo: Keramikkopp i ønskelisten" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Legg i handlekurven" })).toHaveCount(0);
  // The structured data is there whatever the layout holds.
  await expect
    .poll(async () => (await page.locator('script[type="application/ld+json"]').allTextContents()).join(" "))
    .toContain('"name":"Demo: Keramikkopp"');
});
