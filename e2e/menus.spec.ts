import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Menus (D85): a store's menus, with links under links, in the standard
 * header (opening below a link on hover or focus), in the phone's menu, and
 * with a menu component on any page; and a row that blurs what is behind
 * it (D86).
 */
async function storeWithMenus(): Promise<string> {
  const slug = `menus-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Ola', 'Olas Butikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Olas Butikk', null) as id`;
    const items = [
      { label: {}, link: { kind: "home" }, depth: 0 },
      { label: { "nb-NO": "Utvalg" }, link: { kind: "products" }, depth: 0 },
      { label: { "nb-NO": "Skrivesaker" }, link: { kind: "product", handle: "demo-notatbok" }, depth: 1 },
      { label: { "nb-NO": "Koppen" }, link: { kind: "product", handle: "demo-keramikkopp" }, depth: 2 },
      { label: { "nb-NO": "Kaizen" }, link: { kind: "url", url: "https://kaizenstore.cloud" }, depth: 0, newTab: true },
    ];
    const [menu] = await sql`
      update commerce.menus set items = ${sql.json(items)}
      where id = (select header_menu_id from commerce.stores where id = ${id}) returning id`;
    const content = {
      title: "Meny",
      slug: "meny",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [
        {
          id: "r",
          type: "row",
          layout: "1",
          background: { type: "color", color: "#ffffff", opacity: 60 },
          backdropBlur: 8,
          columns: [{ id: "c", blocks: [{ id: "m", type: "menu", menuId: menu.id, direction: "column" }] }],
        },
      ],
    };
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, 'meny', ${sql.json(content)}, ${sql.json(content)}, now())`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a menu's links under a link open below it in the header, and show nested in a menu component", async ({ page }) => {
  const slug = await storeWithMenus();
  await page.goto(`/s/${slug}/no`);
  const main = page.getByRole("navigation", { name: "Hovedmeny" });
  await expect(main.getByRole("link", { name: "Utvalg" })).toBeVisible();
  const under = main.getByRole("link", { name: "Skrivesaker" });
  await expect(under).toBeHidden();
  await main.getByRole("link", { name: "Utvalg" }).hover();
  await expect(under).toBeVisible();
  await expect(main.getByRole("link", { name: "Koppen" })).toBeVisible();
  await expect(under).toHaveAttribute("href", `/s/${slug}/no/p/demo-notatbok`);
  // A link set to open in a new tab says so.
  await expect(main.getByRole("link", { name: "Kaizen (åpnes i ny fane)" })).toHaveAttribute("target", "_blank");

  // On its own page, a menu component shows the same menu, one level under another.
  await page.goto(`/s/${slug}/no/meny`);
  const component = page.getByRole("navigation", { name: "Main menu" });
  await expect(component.locator("> ul > li")).toHaveCount(3);
  await expect(component.locator("> ul > li").nth(1).locator("ul ul a")).toHaveText("Koppen");
  // Its row is frosted glass: a see-through colour, and what is behind blurred.
  const row = page.locator("main .store-page > div, main [class*='isolate']").filter({ has: component }).first();
  await expect(row).toHaveCSS("backdrop-filter", "blur(8px)");
  await expect(row).toHaveCSS("background-color", /rgba\(255, 255, 255, 0\.6\)|color\(srgb 1 1 1 \/ 0\.6\)/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the slide-out menu shows the links under a link beneath it", async ({ page }) => {
    const slug = await storeWithMenus();
    await page.goto(`/s/${slug}/no`);
    const drawer = page.getByRole("dialog", { name: "Meny" });
    // A tap before the page has come alive does nothing, so tap again as a shopper would.
    await expect(async () => {
      await page.getByRole("banner").getByRole("button", { name: "Åpne menyen" }).click();
      await expect(drawer.getByRole("link", { name: "Skrivesaker" })).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(drawer.getByRole("link", { name: "Koppen" })).toBeVisible();
  });
});

test("a mega menu opens its links side by side across the header, in columns with their pictures (D87)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const slug = `mega-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Butikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Butikk', null) as id`;
    const picture = { url: "/demo/mug.svg", width: 400, height: 300 };
    const items = [
      { label: { "nb-NO": "Kjøkken" }, link: { kind: "products" }, depth: 0, mega: { columns: 3, center: true } },
      { label: { "nb-NO": "Kopper" }, link: { kind: "product", handle: "demo-keramikkopp" }, depth: 1, image: picture },
      { label: { "nb-NO": "Hvit kopp" }, link: { kind: "product", handle: "demo-keramikkopp" }, depth: 2 },
      { label: { "nb-NO": "Lamper" }, link: { kind: "product", handle: "demo-bordlampe" }, depth: 1 },
    ];
    await sql`
      update commerce.menus set items = ${sql.json(items)}
      where id = (select header_menu_id from commerce.stores where id = ${id})`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${slug}/no`);
  const main = page.getByRole("navigation", { name: "Hovedmeny" });
  const kopper = main.getByRole("link", { name: "Kopper" });
  await expect(kopper).toBeHidden();
  await main.getByRole("link", { name: "Kjøkken" }).hover();
  await expect(kopper).toBeVisible();
  await expect(kopper.locator("img")).toHaveAttribute("src", "/demo/mug.svg");
  await expect(main.getByRole("link", { name: "Hvit kopp" })).toBeVisible();

  // The panel spans the header's width; its columns share the content's width, centred.
  const panel = page.locator("[data-mega-menu] > div").first();
  expect((await panel.boundingBox())?.width).toBe(1280);
  const columns = panel.locator("ul").first();
  await expect(columns).toHaveCSS("justify-content", "center");
  const [first, second] = await Promise.all([kopper.boundingBox(), main.getByRole("link", { name: "Lamper" }).boundingBox()]);
  // Side by side, each a third of the content's width.
  expect(Math.abs((first?.y ?? 0) - (second?.y ?? 1))).toBeLessThan(200);
  expect(second!.x).toBeGreaterThan(first!.x + 200);
});
