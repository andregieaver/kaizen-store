import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Selling to businesses (B2B): a store selling to both asks new visitors,
 * shows each kind its own prices and products, and keeps business-only
 * products from private shoppers; a store selling only to businesses shows
 * every price without VAT.
 */
async function storeFor(audience: "both" | "businesses"): Promise<string> {
  const slug = `b2b-${audience}-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Firma') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Firma', null)`;
    await sql`update commerce.stores set audience = ${audience}, business_popup = ${audience === "both"} where slug = ${slug}`;
    // The tote bag is for businesses only.
    await sql`
      update commerce.products p set audience = 'businesses'
      from commerce.stores s where s.id = p.store_id and s.slug = ${slug} and p.handle = 'demo-handlenett'`;
  } finally {
    await sql.end();
  }
  return slug;
}

const store = (slug: string, path = "") => `/s/${slug}/no${path}`;

test("a store selling to both asks, and shows each kind of shopper their prices and products", async ({ page }) => {
  const slug = await storeFor("both");
  await page.goto(store(slug));

  // The first visit asks; choosing Business shows prices without VAT and the business-only product.
  const question = page.getByRole("dialog", { name: "Handler du privat eller for en bedrift?" });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Bedrift" }).click();
  await expect(question).toBeHidden();
  const mug = page.locator(".product-card").filter({ hasText: "Demo: Keramikkopp" });
  await expect(mug).toContainText("199,20");
  await expect(mug).toContainText("eks. mva.");
  await expect(page.locator(".product-card").filter({ hasText: "Demo: Handlenett" })).toBeVisible();

  // The choice is kept: no question on the next page, and the switch shows it.
  await page.reload();
  await expect(question).toBeHidden();
  const choice = page.getByRole("group", { name: "Jeg handler som" });
  await expect(choice.getByRole("button", { name: "Bedrift" })).toHaveAttribute("aria-pressed", "true");

  // Private shoppers see prices with VAT, and not the business-only product.
  await choice.getByRole("button", { name: "Privat" }).click();
  await expect(mug).toContainText("249,00");
  await expect(mug).toContainText("inkl. mva.");
  await expect(page.locator(".product-card").filter({ hasText: "Demo: Handlenett" })).toBeHidden();

  // Its page says it is for businesses, and a private shopper cannot buy it.
  await page.goto(store(slug, "/p/demo-handlenett"));
  await expect(page.getByText("Denne varen selges bare til bedrifter.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Legg i handlekurven" })).toBeHidden();
  await page.getByRole("button", { name: "Handle som bedrift" }).click();
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." })).toBeVisible();

  // The cart shows a business the amounts without VAT, and the VAT on its own line.
  await page.goto(store(slug, "/cart"));
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("Mva.");
  await expect(summary).toContainText("159,20");
  await expect(summary).toContainText("Å betale");
});

test("a store selling only to businesses shows every price without VAT", async ({ page }) => {
  const slug = await storeFor("businesses");
  await page.goto(store(slug));
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("group", { name: "Jeg handler som" })).toHaveCount(0);
  const mug = page.locator(".product-card").filter({ hasText: "Demo: Keramikkopp" });
  await expect(mug).toContainText("199,20");
  await expect(mug).toContainText("eks. mva.");
  await expect(mug).not.toContainText("249,00");
});
