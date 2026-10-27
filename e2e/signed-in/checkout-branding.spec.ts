import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Checkout branding as the owner sets it and the storefront draws it (wave 7 unit C, D337; row checkout.checkout-branding): in Design
 * settings' *Checkout look* card the owner gives the pay button a colour of its own and its corners and puts the payment form on a panel,
 * saves, and the theme keeps it; the store's pay routes (the cart here) then carry the checkout's colours, and an element marked as the
 * checkout's (`.checkout-look`, as the checkout section draws it around the payment form) reads them as its accent. Stripe's Appearance itself
 * is held by checkout-appearance.test.ts, and the checkout section passing it by checkout-section.test.ts: the end-to-end server has no
 * Stripe keys, so no open checkout draws Stripe's form here.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const design = `/admin/${E2E_STORE}/settings/design`;
const LIGHT = "#1d4ed8";
const DARK = "#93c5fd";
let themeBefore: unknown = null;
let marketSlug = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    const [store] = await sql`select id, theme from commerce.stores where slug = ${E2E_STORE}`;
    themeBefore = store.theme;
    const [market] = await sql`select code from commerce.markets where store_id = ${store.id} and active order by created_at, code limit 1`;
    marketSlug = String(market.code).toLowerCase();
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  // The store's look as it was, so the other theme specs meet the look they expect.
  const sql = testDb();
  try {
    await sql`update commerce.stores set theme = ${sql.json(themeBefore as never)} where slug = ${E2E_STORE}`;
  } finally {
    await sql.end();
  }
});

test("the owner sets the checkout's look in Design settings, and the theme keeps it", async ({ page }) => {
  await page.goto(design);
  const card = page.getByRole("region", { name: "Checkout look", exact: true });
  await expect(card.getByText("The checkout follows this theme", { exact: false })).toBeVisible();
  // Homer's view: one sentence and the logo; the rest one step away.
  // The card is drawn before the editor's scripts take it over, which closes a section opened before then: press until it stays open.
  const panel = card.getByText("A panel in the surface colour", { exact: true });
  await expect(async () => {
    if (!(await panel.isVisible())) await card.getByText("Customise the checkout", { exact: true }).click();
    await expect(panel).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await panel.click();
  await card.getByText("A colour of its own", { exact: true }).click();
  await card.getByLabel("Pay button in light colours").fill(LIGHT);
  await card.getByLabel("Pay button in dark colours").fill(DARK);
  await card.getByRole("group", { name: "Pay button corners" }).getByText("Square", { exact: true }).click();
  await card.getByText("A line under", { exact: true }).click();
  await expect(card.getByLabel("Pay button in light colours")).toHaveValue(LIGHT);
  // The preview's checkout shows the new pay button colour at once.
  await expect(page.locator("[data-checkout-sample]").first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Saved. The store shows this theme now.").first()).toBeVisible({ timeout: 30_000 });

  const sql = testDb();
  try {
    const [row] = await sql`select theme -> 'settings' -> 'checkout' as checkout from commerce.stores where slug = ${E2E_STORE}`;
    expect(row.checkout).toMatchObject({ background: "surface", fields: "underlined", corners: "square", button: { light: LIGHT, dark: DARK } });
  } finally {
    await sql.end();
  }
});

test("the store's pay routes carry the checkout's colour and corners, which the checkout's payment form reads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/s/${E2E_STORE}/${marketSlug}/cart`);
  const read = () =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      // An element as the checkout section draws around the payment form, with a pay button in it.
      const box = document.createElement("div");
      box.className = "checkout-look";
      const button = document.createElement("button");
      button.className = "button-primary";
      box.append(button);
      document.body.append(box);
      const styles = getComputedStyle(button);
      const result = {
        accent: root.getPropertyValue("--checkout-accent").trim(),
        radius: root.getPropertyValue("--checkout-button-radius").trim(),
        background: styles.backgroundColor,
        corners: styles.borderTopLeftRadius,
      };
      box.remove();
      return result;
    });
  const seen = await read();
  expect(seen.accent).toBe(LIGHT);
  expect(seen.radius).toBe("0");
  // #1d4ed8 as the browser writes it, unless the theme's buttons are outlined.
  expect(["rgb(29, 78, 216)", "rgba(0, 0, 0, 0)"]).toContain(seen.background);
  expect(seen.corners).toBe("0px");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const dark = await read();
  // A store that follows the device shows its dark colours, and the checkout's own dark pay button with them; one always light keeps the light.
  expect([DARK, LIGHT]).toContain(dark.accent);
});

test("the checkout without an order waiting goes back to the cart, under the same policy as before", async ({ page, request }) => {
  const checkout = `/s/${E2E_STORE}/${marketSlug}/checkout`;
  const response = await request.get(checkout, { maxRedirects: 0 });
  // No new script origin: the policy names Stripe's and the address autocomplete's only (csp.test.ts holds the list).
  const policy = response.headers()["content-security-policy"] ?? response.headers()["content-security-policy-report-only"] ?? "";
  expect(policy).toContain("font-src 'self'");
  expect(policy).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  await page.goto(checkout);
  await expect(page).toHaveURL(/\/cart/);
});
