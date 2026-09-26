import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** Sites' icons (D62): Kaizen's by default, a store's own once it has one. */

test("Kaizen's pages and stores without an icon show Kaizen's", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute("href", "/kaizen/favicon.ico");
  const legacy = await request.get("/favicon.ico", { maxRedirects: 0 });
  expect(legacy.status()).toBe(302);
  expect(legacy.headers().location).toBe("/kaizen/favicon.ico");
  const icon = await request.get("/kaizen/favicon.ico");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image");
});

test("a store's own icon is in its pages and at its /favicon.ico", async ({ page, request }) => {
  const slug = `icon-${Date.now()}`;
  const favicon = { url: "https://cdn.example/icon.png", smallUrl: "https://cdn.example/icon-480.png" };
  const sql = testDb();
  try {
    const [row] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Ikon') returning id`;
    await sql`select commerce.approve_access_request(${row.id}, ${slug}, 'Karis Ikon', null)`;
    await sql`update commerce.stores set navigation = navigation || ${sql.json({ favicon })} where slug = ${slug}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${slug}/no`);
  const icons = page.locator('head link[rel="icon"]');
  await expect(icons.first()).toHaveAttribute("href", favicon.smallUrl);
  await expect(icons.nth(1)).toHaveAttribute("href", favicon.url);
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveAttribute("href", favicon.url);

  const legacy = await request.get(`/s/${slug}/favicon.ico`, { maxRedirects: 0 });
  expect(legacy.status()).toBe(302);
  expect(legacy.headers().location).toBe(favicon.smallUrl);
});
