import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { testDb } from "./db";
import { describeFindings, violationsOn } from "./a11y";

/**
 * An automated WCAG check over the storefront and the admin's signed-out pages (wave 1, 1e, docs/wave-1-trust.md 6.1; rows
 * `international.accessibility-wcag-eaa-and-statement` and `storefront.accessibility-and-theme-quality-guarantees`): axe-core with the WCAG
 * 2.0 to 2.2 A and AA tags, light and dark, failing on serious and critical findings. What it cannot reach is checked by hand and recorded:
 * Stripe's payment form (no Stripe session in a test) and the signed-in admin (no Supabase user in CI). It finds only part of the problems,
 * and passing it is not conformance (the statement says so).
 */

let seq = 0;

/** A paid order of the demo store, opened by its own key, as the order page is after paying. */
async function paidOrder(): Promise<string> {
  const n = `${Date.now().toString(36)}${++seq}`.toUpperCase();
  const number = `AX-${n}`;
  const key = `cs_${number}`;
  const db = testDb();
  try {
    const [store] = await db`select id from commerce.stores where slug = 'demo'`;
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
        subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', ${`ax-${n.toLowerCase()}@example.com`}, 'paid', 20000, 0, 4000, 20000, '{}', '{"line1":"Gata 1","postalCode":"0150","city":"Oslo","name":"Kari Nordmann"}')
      returning id`;
    await db`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
      values (${store.id}, ${order.id}, ${`AX-${n}`}, 'Lampe', 1, 20000, 20000, 4000, 0.25, 'txcd_99999999')`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${key}, 20000, 'NOK', 'captured')`;
    return `/s/demo/no/order/${order.id}?session_id=${key}`;
  } finally {
    await db.end();
  }
}

async function addToCart(page: Page) {
  await page.goto("/s/demo/no/p/demo-notatbok");
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("link", { name: /Handlekurv \(1\)/ })).toBeVisible();
}

const STOREFRONT = [
  ["the front page", "/s/demo/no"],
  ["the front page in Swedish", "/s/demo/se"],
  ["a product page", "/s/demo/no/p/demo-keramikkopp"],
  ["the product list", "/s/demo/no/products"],
  ["My account, signed out", "/s/demo/no/account"],
  ["the withdrawal function", "/s/demo/no/withdraw"],
  ["the cookie page", "/s/demo/no/cookies"],
  ["the search page", "/s/demo/no/search?q=lampe"],
] as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    for (const [name, path] of STOREFRONT) {
      test(`${name} has no serious or critical violation`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("main")).toBeVisible();
        expect(describeFindings(await violationsOn(page))).toEqual([]);
      });
    }

    test("the cart, with an item in it, has none", async ({ page }) => {
      await addToCart(page);
      await page.goto("/s/demo/no/cart");
      await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
      await expect(page.getByText("Notatbok").first()).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });

    test("the checkout, as far as it can be reached without a payment session, has none", async ({ page }) => {
      // The demo store takes no payments, so the checkout sends the shopper back to the cart: that is the state a scan can reach.
      await addToCart(page);
      await page.goto("/s/demo/no/checkout");
      await expect(page).toHaveURL("/s/demo/no/cart");
      await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });

    test("an order, opened by its own key, has none", async ({ page }) => {
      await page.goto(await paidOrder());
      await expect(page.getByRole("main")).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });
  });
}

test.describe("the admin's signed-out pages", () => {
  for (const [name, path] of [
    ["the sign-in page", "/admin/sign-in"],
    ["the forgot-password page", "/admin/forgot-password"],
    ["the sign-up page", "/sign-up"],
  ] as const) {
    test(`${name} has none`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main").first()).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });
  }
});

test("the scan fails on a page that breaks the rules, so a pass means something", async ({ page }) => {
  await page.setContent(readFileSync(join(process.cwd(), "e2e/fixtures/a11y-bad.html"), "utf8"));
  const findings = await violationsOn(page);
  const rules = findings.map((finding) => finding.rule);
  // The four things the fixture does wrong: a picture with no text, a button with no name, a field with no label, text too faint to read.
  for (const rule of ["image-alt", "button-name", "label", "color-contrast"]) expect(rules, rule).toContain(rule);
  expect(findings.every((finding) => ["serious", "critical"].includes(finding.impact))).toBe(true);
});

test("dark mode is really dark, so the dark scans mean something", async ({ browser }) => {
  const backgrounds: Record<string, string> = {};
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await page.goto("/s/demo/no");
    backgrounds[scheme] = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await context.close();
  }
  expect(backgrounds.dark).not.toBe(backgrounds.light);
});
