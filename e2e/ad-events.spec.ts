import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Ad tags and shop events (wave 5 unit I1, D303): nothing loads or is sent before consent; after marketing consent a product view and an add
 * to the cart reach every tag switched on, in its own words; a pay route loads none.
 */

type Queued = { queue?: unknown[][] };

test("ad tags hear shop events only after marketing consent, and never on a pay route", async ({ page, context }) => {
  const slug = `ads-${Date.now()}`;
  const sql = testDb();
  let handle = "";
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Ola', 'Olas Annonser') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Olas Annonser', null)`;
    const [store] = await sql`
      update commerce.stores set tracking = '{"metaPixel": "1234567", "tiktokPixel": "C4ABCDEFGHIJ1234567"}'::jsonb where slug = ${slug} returning id`;
    // A physical product with stock, so it can be added.
    const [product] = await sql`
      select p.handle from commerce.products p join commerce.product_variants v on v.product_id = p.id
      join commerce.variant_availability a on a.variant_id = v.id
      where p.store_id = ${store.id} and p.status = 'active' and p.kind = 'goods' and a.in_stock > 0
      order by p.created_at, p.handle limit 1`;
    handle = product.handle;
  } finally {
    await sql.end();
  }
  // The tags' scripts are not fetched for real; each load is counted, and their stubs keep the calls in their queues.
  const loads: string[] = [];
  for (const host of ["https://connect.facebook.net/**", "https://analytics.tiktok.com/**"]) {
    await context.route(host, (route) => {
      loads.push(route.request().url());
      return route.fulfill({ body: "", contentType: "text/javascript" });
    });
  }

  const productPage = `/s/${slug}/no/p/${handle}`;
  await page.goto(productPage);
  const banner = page.getByRole("region", { name: "Vi bruker informasjonskapsler" });
  await expect(banner).toBeVisible();
  expect(loads).toHaveLength(0);
  expect(await page.evaluate(() => "fbq" in window || "ttq" in window)).toBe(false);

  await banner.getByRole("button", { name: "Godta alle" }).click();
  await expect.poll(() => loads.length).toBe(2);

  // A reload: the stored choice loads the tags first, then the page's view is heard.
  await page.reload();
  const calls = () =>
    page.evaluate(() => {
      const w = window as unknown as { fbq?: Queued; ttq?: Queued };
      return { meta: JSON.stringify(w.fbq?.queue ?? []), tiktok: JSON.stringify(w.ttq?.queue ?? []) };
    });
  await expect.poll(async () => (await calls()).meta).toContain("ViewContent");
  await expect.poll(async () => (await calls()).tiktok).toContain("ViewContent");

  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect.poll(async () => (await calls()).meta).toContain("AddToCart");
  await expect.poll(async () => (await calls()).tiktok).toContain("AddToCart");
  // Nothing personal goes in an event: only ids, names, prices and the currency.
  expect((await calls()).meta).not.toContain("@");

  // A pay route loads no tag (D158).
  const before = loads.length;
  await page.goto(`/s/${slug}/no/cart`);
  await page.waitForLoadState("networkidle");
  expect(loads.length).toBe(before);
  expect(await page.evaluate(() => "fbq" in window || "ttq" in window)).toBe(false);
});
