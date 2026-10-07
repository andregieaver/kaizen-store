import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A store template's storefront (D175, docs/store-templates.md section 3): reviewed at its own address, it says it is a preview, asks
 * search engines to leave it out, and its cart says it takes no orders instead of offering the checkout.
 */
async function starterStore(): Promise<string> {
  const slug = `starter-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    // Made as the platform makes one: a copy of the template (here through an approved request, which gives it an owner), marked as a
    // starter and described (published, so it is offered too).
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Platform', 'Spa-mal') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Spa-mal', null) as id`;
    await sql`update commerce.stores set starter = true where id = ${id}`;
    await sql`insert into commerce.store_starters (store_id, title, summary, category, published) values (${id}, 'Spa', 'Behandlinger', 'appointments', true)`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a store template's storefront is a preview: a notice, noindex and no checkout", async ({ page }) => {
  const slug = await starterStore();

  await page.goto(`/s/${slug}/no`);
  await expect(page.getByText("Forhåndsvisning av butikkmal: denne butikken tar ikke imot bestillinger.").first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.goto(`/s/${slug}/no/p/demo-notatbok`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.getByRole("button", { name: "Legg i handlekurven", disabled: false }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." }).first()).toBeVisible();

  await page.goto(`/s/${slug}/no/cart`);
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("Dette er en butikkmal som vises for gjennomgang. Den tar ikke imot bestillinger.");
  await expect(page.getByRole("button", { name: "Til kassen" })).toHaveCount(0);

  // The checkout needs an order waiting for payment, which a template never has: back to the cart.
  await page.goto(`/s/${slug}/no/checkout`);
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/no/cart$`));
});

test("a store template is in no sitemap", async ({ request }) => {
  const slug = await starterStore();
  const index = await (await request.get("/sitemap.xml")).text();
  expect(index).not.toContain(slug);
  expect((await request.get(`/s/${slug}/store-sitemap.xml`)).status()).toBe(404);
});
