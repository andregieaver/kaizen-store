import { expect, test, type Page } from "@playwright/test";

import { encryptSecret, parseKey } from "../src/lib/secret-box";

import { testDb } from "./db";

/**
 * The pay routes (wave 1, 1e, docs/wave-1-trust.md 2.5, docs/pci.md): the cart, checkout and order of a store send a strict
 * Content-Security-Policy, load without a single violation, and draw nothing another site's code can come in through (the consent banner
 * and the tools and owner code it loads, the chat widget). Every other page of the store keeps them. A Stripe session cannot run here
 * (the test stores take no payments), so what a live payment needs from the policy is checked by hand on a preview (docs/pci.md).
 */

/** Records every violation the browser reports, from before any script runs. */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** A store with a tracking tool to ask about, a chat agent with an AI, and the demo catalogue's template copied in. */
async function storeWithExtras(): Promise<string> {
  const slug = `csp-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [access] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Siris Butikk', null) as id`;
    await sql`update commerce.stores set tracking = '{"metaPixel": "1234567"}'::jsonb where id = ${id}`;
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await sql`
      insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, text_model)
      values (${id}, 'openai', ${encryptSecret("sk-test", key)}, '…test', 'text-model')`;
    await sql`
      insert into commerce.chat_agents (store_id, enabled, name, occupation, greeting)
      values (${id}, true, 'Ingrid', 'Kundeservice', ${sql.json({ "nb-NO": "Hei, jeg er Ingrid!" })})`;
  } finally {
    await sql.end();
  }
  return slug;
}

const POLICY_PARTS = [
  "default-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "https://js.stripe.com",
];

test("the cart, checkout and order send the policy, and the rest of the store does not", async ({ request }) => {
  for (const path of [
    "/s/demo/no/cart",
    "/s/demo/no/checkout",
    "/s/demo/no/order/6f1c0b9e-1111-2222-3333-444444444444",
    "/s/demo/se/cart",
    "/s/demo/no-en-eur/cart",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const policy = response.headers()["content-security-policy"];
    expect(policy, path).toBeTruthy();
    for (const part of POLICY_PARTS) expect(policy, `${path}: ${part}`).toContain(part);
    expect(policy, path).not.toContain("unsafe-eval");
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(response.headers()["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
  }
  for (const path of ["/s/demo/no", "/s/demo/no/products", "/s/demo/no/account", "/s/demo/no/withdraw", "/", "/s/demo/store-sitemap.xml"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["content-security-policy"], path).toBeUndefined();
  }
});

test("the cart loads under the policy with no violation, with an item in it", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto("/s/demo/no/p/demo-notatbok");
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("link", { name: /Handlekurv \(1\)/ })).toBeVisible();
  // A full page load, so the policy applies to this document.
  await page.goto("/s/demo/no/cart");
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  await expect(page.getByText("Notatbok").first()).toBeVisible();
  expect(await violations()).toEqual([]);
});

test("the consent banner and the chat are on the store's pages and not on the cart, however the shopper gets there", async ({
  page,
  context,
}) => {
  const slug = await storeWithExtras();
  await page.route("https://connect.facebook.net/**", (route) => route.fulfill({ body: "", contentType: "text/javascript" }));
  const banner = page.getByRole("region", { name: "Vi bruker informasjonskapsler" });
  const chat = page.getByRole("button", { name: "Chat med oss: Ingrid, AI-assistent" });

  // The store's own pages ask and offer the chat.
  await page.goto(`/s/${slug}/no`);
  await expect(banner).toBeVisible();
  await expect(chat).toBeVisible();

  // A full load of the cart has neither, and no consent cookie is asked for.
  await page.goto(`/s/${slug}/no/cart`);
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(chat).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toBeVisible();

  // Going on from the store's page by a client navigation reloads the document, so what the page drew is not still in it.
  await page.goto(`/s/${slug}/no`);
  await expect(banner).toBeVisible();
  await page
    .getByRole("link", { name: /Handlekurv/ })
    .first()
    .click();
  await expect(page).toHaveURL(`/s/${slug}/no/cart`);
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(chat).toHaveCount(0);
  // And on the way back the store's pages have them again.
  await page.getByRole("link", { name: "Fortsett å handle" }).click();
  await expect(page).toHaveURL(`/s/${slug}/no`);
  await expect(banner).toBeVisible();
  expect((await context.cookies()).some((c) => c.name.startsWith("consent_"))).toBe(false);
});
