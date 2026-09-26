import { expect, test, type Page } from "@playwright/test";

import { testDb } from "./db";

/**
 * Stores on their own hosts (P7) and their own code (D61). Needs a build
 * with the store domain set, as CI's `hosts` job makes:
 *
 *   node e2e/hosts-seed.mjs   # a store on a domain of its own, read when building
 *   NEXT_PUBLIC_STORE_DOMAIN=localhost:3000 pnpm build
 *   E2E_CUSTOM_HOSTS=1 NEXT_PUBLIC_STORE_DOMAIN=localhost:3000 pnpm exec playwright test e2e/store-hosts.spec.ts
 *
 * Chromium sends every `*.localhost` to this machine.
 */
const domain = process.env.NEXT_PUBLIC_STORE_DOMAIN;
test.skip(!domain, "needs a build with NEXT_PUBLIC_STORE_DOMAIN set");

/** The store `e2e/hosts-seed.mjs` puts on a domain of its own: kept in step with it. */
const CUSTOM_STORE = "kari-domene";
const CUSTOM_HOST = "butikk.kari.localhost";

const storeUrl = (slug: string, path = "") => `http://${slug}.${domain}${path}`;

test("a store is served on its own host, and its old address moves there", async ({ page }) => {
  await page.goto(storeUrl("demo", "/"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const market = page.getByRole("link", { name: /Norge|Norway/ }).first();
  await expect(market).toHaveAttribute("href", "/no");

  await page.goto(storeUrl("demo", "/no/p/demo-keramikkopp"));
  expect(await page.locator("link[rel=canonical]").getAttribute("href")).toBe(storeUrl("demo", "/no/p/demo-keramikkopp"));
  // Actions post to the store's host.
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." })).toBeVisible();
  await page.getByRole("link", { name: "Gå til handlekurven" }).click();
  await expect(page).toHaveURL(storeUrl("demo", "/no/cart"));

  // Kaizen's address for the store moves to the store's own.
  await page.goto("/s/demo/no/p/demo-keramikkopp");
  await expect(page).toHaveURL(storeUrl("demo", "/no/p/demo-keramikkopp"));

  // Nothing of Kaizen's but shared files answers on a store's host: not the admin.
  expect((await page.goto(storeUrl("demo", "/admin/sign-in")))?.status()).toBe(404);
  expect((await page.goto(storeUrl("demo", "/demo/logo.svg")))?.status()).toBe(200);
});

/** A new store with code in each place: necessary in the head, statistics at the body's start, marketing at its end. */
async function storeWithCode(): Promise<string> {
  const slug = `code-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Kode') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Kode', null)`;
    const code = {
      head: {
        code: '<meta name="kaizen-test" content="head"><script>window.ran = (window.ran || []).concat("head")</script>',
        category: "necessary",
      },
      bodyStart: {
        code: '<div id="stats-start"></div><script>window.ran = (window.ran || []).concat("statistics")</script>',
        category: "statistics",
      },
      bodyEnd: {
        code: '<script>window.ran = (window.ran || []).concat("marketing")</script>',
        category: "marketing",
      },
    };
    await sql`update commerce.stores set custom_code = ${sql.json(code)} where slug = ${slug}`;
  } finally {
    await sql.end();
  }
  return slug;
}

const ran = (page: Page) => page.evaluate(() => (window as unknown as { ran?: string[] }).ran ?? []);

test("the store's own code is added as far as the shopper allows", async ({ page }) => {
  const slug = await storeWithCode();
  await page.goto(storeUrl(slug, "/no"));

  // Necessary code runs at once, in the head; the rest waits for consent.
  await expect(page.locator('head meta[name="kaizen-test"]')).toHaveCount(1);
  await expect.poll(() => ran(page)).toEqual(["head"]);
  await expect(page.locator("#stats-start")).toHaveCount(0);

  // Declining keeps it that way; allowing statistics adds that code, in its place, once.
  await page.getByRole("button", { name: "Avslå alle" }).click();
  await page.goto(storeUrl(slug, "/no/cookies"));
  await expect.poll(() => ran(page)).toEqual(["head"]);
  await page.getByRole("button", { name: "Innstillinger for informasjonskapsler" }).click();
  const dialog = page.getByRole("dialog", { name: "Innstillinger for informasjonskapsler" });
  await dialog.getByRole("switch", { name: /Statistikk/ }).check();
  await dialog.getByRole("button", { name: "Lagre valgene" }).click();
  await expect.poll(() => ran(page)).toEqual(["head", "statistics"]);
  expect(await page.evaluate(() => document.body.firstElementChild?.id)).toBe("stats-start");

  // A later visit adds what was allowed straight away, still once each.
  await page.goto(storeUrl(slug, "/no"));
  await expect.poll(() => ran(page)).toEqual(["head", "statistics"]);
});

test("a store on a domain of its own is served there, and its other addresses lead there (P8)", async ({ page }) => {
  test.skip(!process.env.E2E_CUSTOM_HOSTS, "needs e2e/hosts-seed.mjs before the build");
  const own = `http://${CUSTOM_HOST}:${new URL(storeUrl("x")).port}`;
  const response = await page.goto(`${own}/no`);
  expect(response?.status()).toBe(200);
  expect(await page.locator("link[rel=canonical]").getAttribute("href")).toBe(`${own}/no`);
  await expect(page.getByRole("link", { name: /Handlekurv/ }).first()).toHaveAttribute("href", "/no/cart");

  await page.goto(storeUrl(CUSTOM_STORE, "/no/cart"));
  await expect(page).toHaveURL(`${own}/no/cart`);
  await page.goto(`/s/${CUSTOM_STORE}/no`);
  await expect(page).toHaveURL(`${own}/no`);
});

test("staff who came from the admin get their way back, and the page's editor, on the store's own host", async ({ page }) => {
  await page.goto(storeUrl("demo", "/no/cart"));
  await expect(page.getByRole("link", { name: "← Back to admin" })).toHaveCount(0);

  // The admin hands its page over in the link; the store keeps it and takes it out of the address.
  await page.goto(storeUrl("demo", `/no#kaizen-admin=${encodeURIComponent("/admin/demo/pages")}`));
  const back = page.getByRole("link", { name: "← Back to admin" });
  await expect(back).toHaveAttribute("href", "http://localhost:3000/admin/demo/pages");
  await expect(page).toHaveURL(storeUrl("demo", "/no"));
  await expect(page.getByRole("link", { name: "Edit page" })).toHaveAttribute(
    "href",
    /^http:\/\/localhost:3000\/admin\/demo\/pages\/[0-9a-f-]{36}$/,
  );
  await page.goto(storeUrl("demo", "/no/p/demo-keramikkopp"));
  await expect(back).toBeVisible();
});
