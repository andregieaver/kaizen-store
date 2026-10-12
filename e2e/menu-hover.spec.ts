import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** Menu links' hover and active effect (D207): growing from each link, or one marker gliding between them, and the page shown marked. */

async function storeWithMenu(name: string, itemHover: Record<string, unknown>): Promise<string> {
  const slug = `${name}-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Ola', 'Olas Butikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Olas Butikk', null) as id`;
    const items = [
      { label: { "nb-NO": "Hjem" }, link: { kind: "home" }, depth: 0 },
      { label: { "nb-NO": "Meny" }, link: { kind: "page", slug: "meny" }, depth: 0 },
      { label: { "nb-NO": "Utvalg" }, link: { kind: "products" }, depth: 0 },
    ];
    const [menu] = await sql`
      update commerce.menus set items = ${sql.json(items)}
      where id = (select header_menu_id from commerce.stores where id = ${id}) returning id`;
    const content = {
      title: "Meny", slug: "meny", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [],
      rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "m", type: "menu", menuId: menu.id, itemHover }] }] }],
    };
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, 'meny', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
  } finally {
    await sql.end();
  }
  return `/s/${slug}/meny`;
}

test("a background grows from a link under the pointer, in its colours, and stays on the page shown", async ({ page }) => {
  const url = await storeWithMenu("meny-bak", { kind: "background", color: "#112233", textColor: "#ffffff" });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const menu = page.locator("main .kz-menu");
  const here = menu.getByRole("link", { name: "Meny" });
  const other = menu.getByRole("link", { name: "Utvalg" });
  await expect(here).toHaveAttribute("aria-current", "page");
  await expect(here).toHaveCSS("background-size", "100% 100%");
  await expect(here).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(other).toHaveCSS("background-size", "0px 100%");
  await other.hover();
  await expect(other).toHaveCSS("background-size", "100% 100%");
  await expect(other).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("a line glides from link to link and back to the page shown", async ({ page }) => {
  const url = await storeWithMenu("meny-linje", { kind: "line", travel: "slide", edge: "below", thickness: 3 });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const menu = page.locator("main .kz-menu");
  await expect(menu).toHaveAttribute("data-mh-ready", "");
  const marker = menu.locator(".kz-mi-ind");
  const here = menu.getByRole("link", { name: "Meny" });
  const other = menu.getByRole("link", { name: "Utvalg" });
  const left = async () => (await marker.boundingBox())!.x;
  await expect(marker).toHaveAttribute("data-shown", "");
  await expect.poll(async () => Math.abs((await left()) - (await here.boundingBox())!.x)).toBeLessThan(1);
  await other.hover();
  await expect.poll(async () => Math.abs((await left()) - (await other.boundingBox())!.x)).toBeLessThan(1);
  await expect.poll(async () => Math.abs((await marker.boundingBox())!.width - (await other.boundingBox())!.width)).toBeLessThan(1);
  await page.mouse.move(5, 700);
  await expect.poll(async () => Math.abs((await left()) - (await here.boundingBox())!.x)).toBeLessThan(1);
});
