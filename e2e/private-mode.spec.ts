import { randomBytes, scryptSync } from "node:crypto";

import { expect, test } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Private mode (wave 7 unit E, D339; row storefront.storefront-password-or-pre-launch-page), as a visitor meets it: every page of a private
 * store is its landing page at the address asked, marked for no search engine; the password lets them in and back to that page; a wrong one
 * says so; the order page's address stays open (here: the store's own not-found page, as for an order that does not exist); and its
 * robots.txt shuts everything.
 */

let store = { slug: "", id: "" };
let handle = "";
const PASSWORD = "apne opp";

/** The password as the store keeps it (`hashPrivatePassword()`): scrypt with N 16384, r 8, p 1. */
const hashOf = (password: string) => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1 });
  return ["scrypt", 16_384, 8, 1, salt.toString("base64url"), hash.toString("base64url")].join("$");
};

test.beforeAll(async () => {
  store = await testStore("privat");
  const sql = testDb();
  try {
    await sql`update commerce.stores set private_mode = true, private_password = ${hashOf(PASSWORD)} where id = ${store.id}`;
    const [product] = await sql<{ handle: string }[]>`
      select p.handle from commerce.products p where p.store_id = ${store.id} and p.status = 'active' and p.kind = 'goods' order by p.created_at, p.handle limit 1`;
    handle = product.handle;
  } finally {
    await sql.end();
  }
});

test("every page of a private store is its landing page, for no search engine", async ({ page }) => {
  for (const path of [`/s/${store.slug}`, `/s/${store.slug}/p/${handle}`, `/s/${store.slug}/products`]) {
    const response = await page.goto(path);
    expect(response?.headers()["x-robots-tag"], path).toContain("noindex");
    await expect(page.locator("[data-private-landing]"), path).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe(path);
  }
  const robots = await page.request.get(`/s/${store.slug}/robots.txt`);
  expect(await robots.text()).toMatch(new RegExp(`Disallow: /s/${store.slug}/`));
});

test("a wrong password says so; the right one lets the visitor in, back to the page they asked for", async ({ page }) => {
  await page.goto(`/s/${store.slug}/p/${handle}`);
  await page.getByLabel(/Passord|Password/).fill("feil ord");
  await page.getByRole("button", { name: /Gå inn|Enter/ }).click();
  await expect(page.locator("[data-private-landing]").getByRole("alert")).toBeVisible();
  await page.getByLabel(/Passord|Password/).fill(PASSWORD);
  await page.getByRole("button", { name: /Gå inn|Enter/ }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${store.slug}/p/${handle}$`));
  await expect(page.locator("[data-private-landing]")).toHaveCount(0);
  // The pass holds for the store's other pages too.
  await page.goto(`/s/${store.slug}/products`);
  await expect(page.locator("[data-private-landing]")).toHaveCount(0);
});

test("the address of an order stays open while the store is private", async ({ page }) => {
  // A miss inside a streamed page answers 200 with the not-found page (CLAUDE.md, D168), so the page is what is checked.
  const path = `/s/${store.slug}/order/00000000-0000-4000-8000-000000000000`;
  const response = await page.goto(path);
  expect(response?.headers()["x-robots-tag"] ?? "").not.toContain("nofollow");
  await expect(page.locator("[data-private-landing]")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(path);
});
