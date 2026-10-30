import { expect, test } from "@playwright/test";

import { parseStoreTheme } from "../../src/lib/theme";
import { themeFontFamilies } from "../../src/lib/theme-elements";
import { testDb } from "../db";
import { OWNER } from "./accounts";

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

// A store of the owner's own: the theme specs switch the shared store's live look at the same time, which a save here must never meet.
const STORE = "e2e-checkout-look";

const design = `/admin/${STORE}/settings/design`;
const LIGHT = "#1d4ed8";
const DARK = "#93c5fd";
let themeBefore: unknown = null;
let marketSlug = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Checkout look') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Checkout look', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id, theme from commerce.stores where slug = ${STORE}`;
    themeBefore = store.theme;
    // Saving installs the theme's fonts: they are on the platform already, so nothing is fetched from Google in a test (CI run 784 timed
    // out here when Google Fonts did not answer).
    for (const family of themeFontFamilies(parseStoreTheme(store.theme).settings)) {
      await sql`insert into commerce.fonts (family, slug, category, css, bytes) values (${family}, ${family.toLowerCase().replace(/\s+/g, "-")}, 'sans-serif', '/* e2e: no files */', 0) on conflict (family) do nothing`;
    }
    // Each attempt starts with the theme's own checkout: a save from an attempt that timed out may still land after it, and a retry that
    // found its colours already saved would have nothing to save.
    await sql`update commerce.stores set theme = theme #- '{settings,checkout}' where id = ${store.id}`;
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
    await sql`update commerce.stores set theme = ${sql.json(themeBefore as never)} where slug = ${STORE}`;
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
  // A choice made before the editor's scripts hold the card is lost (the field shows it, the editor never heard): make them again until
  // the editor has a change to save.
  const save = page.getByRole("button", { name: "Save", exact: true }).first();
  await expect(async () => {
    await panel.click();
    await card.getByText("A colour of its own", { exact: true }).click();
    await card.getByLabel("Pay button in light colours").fill(LIGHT);
    await card.getByLabel("Pay button in dark colours").fill(DARK);
    await card.getByRole("group", { name: "Pay button corners" }).getByText("Square", { exact: true }).click();
    await card.getByText("A line under", { exact: true }).click();
    await expect(card.getByLabel("Pay button in light colours")).toHaveValue(LIGHT);
    await expect(save).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // The preview's checkout shows the new pay button colour at once.
  await expect(page.locator("[data-checkout-sample]").first()).toBeVisible();
  await save.click();
  await expect(page.getByText("Saved. The store shows this theme now.").first()).toBeVisible({ timeout: 30_000 });

  const sql = testDb();
  try {
    const [row] = await sql`select theme -> 'settings' -> 'checkout' as checkout from commerce.stores where slug = ${STORE}`;
    expect(row.checkout).toMatchObject({ background: "surface", fields: "underlined", corners: "square", button: { light: LIGHT, dark: DARK } });
  } finally {
    await sql.end();
  }
});

test("the store's pay routes carry the checkout's colour and corners, which the checkout's payment form reads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/s/${STORE}/${marketSlug}/cart`);
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
  const checkout = `/s/${STORE}/${marketSlug}/checkout`;
  const response = await request.get(checkout, { maxRedirects: 0 });
  // No new script origin: the policy names Stripe's and the address autocomplete's only (csp.test.ts holds the list).
  const policy = response.headers()["content-security-policy"] ?? response.headers()["content-security-policy-report-only"] ?? "";
  expect(policy).toContain("font-src 'self'");
  expect(policy).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  await page.goto(checkout);
  await expect(page).toHaveURL(/\/cart/);
});
