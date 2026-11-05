import { expect, test } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Basic and Advanced (D454): a store's admin starts in Basic, lists each section's everyday pages, says where the rest are and switches
 * with one press; the choice is kept with the account. Each test sets the owner's view first and puts Basic back after, so the other
 * specs find the default.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

async function setView(view: "basic" | "advanced") {
  const sql = testDb();
  try {
    await sql`update commerce.accounts set admin_view = ${view} where lower(email) = ${OWNER.email}`;
  } finally {
    await sql.end();
  }
}

async function storedView(): Promise<string> {
  const sql = testDb();
  try {
    const [row] = await sql`select admin_view from commerce.accounts where lower(email) = ${OWNER.email}`;
    return String(row.admin_view);
  } finally {
    await sql.end();
  }
}

test.afterEach(async () => setView("basic"));

test("Basic lists the everyday settings, says where the rest are, and switches to Advanced for good", async ({ page }) => {
  await setView("basic");
  await page.goto(`/admin/${E2E_STORE}/settings`);
  const main = page.locator("#admin-main");
  const selling = main.getByRole("region", { name: "Selling" });
  await expect(selling.getByRole("link", { name: /^Payments/ })).toBeVisible();
  await expect(selling.getByRole("link", { name: /^Checkout rules/ })).toHaveCount(0);

  const note = main.getByRole("note");
  await expect(note).toContainText("more in Advanced view");
  await expect(note).toContainText("Can't find what you're looking for? Switch to Advanced view");
  await note.getByRole("button", { name: "Switch to Advanced view" }).click();

  // At once, without a reload: every card, no note, and the switch at the top says Advanced.
  await expect(selling.getByRole("link", { name: /^Checkout rules/ })).toBeVisible();
  await expect(main.getByRole("note")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "How much the admin shows" }).getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");

  // Kept with the account, so it is there on the next visit.
  await expect.poll(storedView).toBe("advanced");
  await page.reload();
  await expect(selling.getByRole("link", { name: /^Checkout rules/ })).toBeVisible();
});

test("the switch at the top goes back to Basic", async ({ page }) => {
  await setView("advanced");
  await page.goto(`/admin/${E2E_STORE}/settings`);
  const selling = page.locator("#admin-main").getByRole("region", { name: "Selling" });
  await expect(selling.getByRole("link", { name: /^Checkout rules/ })).toBeVisible();
  await page.getByRole("group", { name: "How much the admin shows" }).getByRole("button", { name: "Basic" }).click();
  await expect(selling.getByRole("link", { name: /^Checkout rules/ })).toHaveCount(0);
  await expect.poll(storedView).toBe("basic");
});

test("an advanced page opened from a link stays in its sidebar in Basic", async ({ page }) => {
  await setView("basic");
  await page.goto(`/admin/${E2E_STORE}/settings/checkout`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const sidebar = page.getByRole("navigation", { name: "More" });
  await expect(sidebar.getByRole("link", { name: "Checkout rules" })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: "Prices and quantity" })).toHaveCount(0);
  await expect(sidebar.getByRole("note")).toContainText("more in Advanced view");
});

test("Home says where the rest of the admin is while Basic is on", async ({ page }) => {
  await setView("basic");
  await page.goto(`/admin/${E2E_STORE}`);
  await expect(page.locator("#admin-main").getByRole("note").filter({ hasText: "You are in Basic view" })).toBeVisible();
});
