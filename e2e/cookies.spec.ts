import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Cookie consent (D58): a site with only necessary cookies shows no banner
 * but a cookie page; one with an optional tool asks first, equally easy to
 * refuse, loads the tool only when allowed, and keeps each choice as proof.
 */

test("a store with only necessary cookies shows no banner, and lists them on its cookie page", async ({ page }) => {
  await page.goto("/s/demo/no");
  await expect(page.getByRole("heading", { name: "Vi bruker informasjonskapsler" })).toHaveCount(0);
  await page.getByRole("contentinfo").getByRole("link", { name: "Informasjonskapsler" }).click();
  await expect(page).toHaveURL("/s/demo/no/cookies");
  await expect(page.getByRole("heading", { level: 1, name: "Informasjonskapsler" })).toBeVisible();
  await expect(page.getByText("Nettstedet bruker bare informasjonskapsler som er nødvendige")).toBeVisible();
  await expect(page.getByRole("cell", { name: "cart_…" })).toBeVisible();

  await page.goto("/cookies");
  await expect(page.getByRole("heading", { level: 1, name: "Cookies" })).toBeVisible();
});

test("a store with a Meta Pixel asks first, loads it only when allowed, and records each choice", async ({ page, context }) => {
  const slug = `cookies-${Date.now()}`;
  const sql = testDb();
  let storeId = "";
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Ola', 'Olas Kaker') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Olas Kaker', null)`;
    const [store] = await sql`update commerce.stores set tracking = '{"metaPixel": "1234567"}'::jsonb where slug = ${slug} returning id`;
    storeId = store.id;
  } finally {
    await sql.end();
  }
  // Meta's script is not fetched for real; each load is counted.
  let pixelLoads = 0;
  await context.route("https://connect.facebook.net/**", (route) => {
    pixelLoads += 1;
    return route.fulfill({ body: "", contentType: "text/javascript" });
  });

  await page.goto(`/s/${slug}/no`);
  const banner = page.getByRole("region", { name: "Vi bruker informasjonskapsler" });
  await expect(banner).toContainText("informasjonskapsler til markedsføring");
  // Refusing is one press, like accepting.
  await banner.getByRole("button", { name: "Avslå alle" }).click();
  await expect(banner).toBeHidden();
  const cookie = (await context.cookies()).find((c) => c.name === `consent_${storeId}`);
  expect(cookie?.value).toMatch(/^1\.[0-9a-f-]{36}\.marketing\.000$/);
  expect(pixelLoads).toBe(0);

  // The choice stands on the next visit, and opens again from the cookie page.
  await page.goto(`/s/${slug}/no/cookies`);
  await expect(banner).toHaveCount(0);
  await page.getByRole("button", { name: "Innstillinger for informasjonskapsler" }).click();
  const dialog = page.getByRole("dialog", { name: "Innstillinger for informasjonskapsler" });
  await dialog.getByRole("switch", { name: /Markedsføring/ }).check();
  await dialog.getByRole("button", { name: "Lagre valgene" }).click();
  await expect.poll(() => pixelLoads).toBe(1);
  expect((await context.cookies()).find((c) => c.name === `consent_${storeId}`)?.value).toMatch(/\.marketing\.001$/);

  const check = testDb();
  try {
    const records = await check`select version, choices from commerce.consents where store_id = ${storeId} order by created_at`;
    expect(records).toEqual([
      { version: "marketing", choices: { preferences: false, statistics: false, marketing: false } },
      { version: "marketing", choices: { preferences: false, statistics: false, marketing: true } },
    ]);
  } finally {
    await check.end();
  }
});
