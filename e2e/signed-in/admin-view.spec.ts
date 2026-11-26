import { expect, test } from "@playwright/test";

import { testDb } from "../db";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * Basic and Advanced (D454): a store's admin starts in Basic, lists each section's everyday pages, says where the rest are and switches
 * with one press; the choice is kept with the account, and holds at the owner's level and on the platform too (D884). Each test sets the
 * person's view first and puts Basic back after, so the other specs find the default.
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

// No page of cards follows the view since round 3 (D597, D603): Settings and the Website list every page by name. The sidebars still do.
test("Basic lists the everyday pages, says where the rest are, and switches to Advanced for good", async ({ page }) => {
  await setView("basic");
  await page.goto(`/admin/${E2E_STORE}/pages`);
  const sidebar = page.getByRole("navigation", { name: "More" });
  await expect(sidebar.getByRole("link", { name: "Menus" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Redirects" })).toHaveCount(0);

  const note = sidebar.getByRole("note");
  await expect(note).toContainText("more in Advanced view");
  await expect(note).toContainText("Can't find what you're looking for? Switch to Advanced view");
  await note.getByRole("button", { name: /^Switch to Advanced/ }).click();

  // At once, without a reload: every link, no note, and the switch at the top says Advanced.
  await expect(sidebar.getByRole("link", { name: "Redirects" })).toBeVisible();
  await expect(sidebar.getByRole("note")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "How much the admin shows" }).getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");

  // Kept with the account, so it is there on the next visit.
  await expect.poll(storedView).toBe("advanced");
  await page.reload();
  await expect(sidebar.getByRole("link", { name: "Redirects" })).toBeVisible();
});

test("the switch at the top goes back to Basic", async ({ page }) => {
  await setView("advanced");
  await page.goto(`/admin/${E2E_STORE}/pages`);
  const sidebar = page.getByRole("navigation", { name: "More" });
  await expect(sidebar.getByRole("link", { name: "Redirects" })).toBeVisible();
  await page.getByRole("group", { name: "How much the admin shows" }).getByRole("button", { name: "Basic" }).click();
  await expect(sidebar.getByRole("link", { name: "Redirects" })).toHaveCount(0);
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

// D884: the owner's level and the platform have the same two views, and one choice is the person's at every level.
test("the choice made in a store holds at the owner's level, whose Account is in groups", async ({ page }) => {
  await setView("basic");
  await page.goto(`/admin/${E2E_STORE}/pages`);
  await page.getByRole("group", { name: "How much the admin shows" }).getByRole("button", { name: "Advanced" }).click();
  await expect.poll(storedView).toBe("advanced");

  await page.goto("/admin/account/billing");
  const sidebar = page.getByRole("navigation", { name: "More" });
  await expect(sidebar.getByRole("heading", { name: "Billing and usage" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("group", { name: "How much the admin shows" }).first().getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");

  // Your account's own switch is the layout's: the sidebar beside it follows at once.
  await page.goto("/admin/account");
  await page.locator("#admin-main").getByRole("group", { name: "How much the admin shows" }).getByRole("button", { name: "Basic" }).click();
  await expect(sidebar.getByRole("link", { name: "Appearance" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Billing" })).toBeVisible();
  await expect(sidebar.getByRole("note")).toContainText("more in Advanced view");
  await expect.poll(storedView).toBe("basic");
});

test.describe("Kaizena Flow's admin", () => {
  test.use({ storageState: ADMIN.state });

  async function setAdminView(view: "basic" | "advanced") {
    const sql = testDb();
    try {
      await sql`update commerce.accounts set admin_view = ${view} where lower(email) = ${ADMIN.email}`;
    } finally {
      await sql.end();
    }
  }

  test.afterEach(async () => setAdminView("basic"));

  test("the platform's Settings are in six groups, Basic lists their everyday pages and the switch shows the rest", async ({ page }) => {
    await setAdminView("basic");
    await page.goto("/admin/platform/team");
    const sidebar = page.getByRole("navigation", { name: "More" });
    for (const heading of ["Site", "Money and tax", "AI", "Apps and connections", "Privacy and law", "Running the platform"]) {
      await expect(sidebar.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    await expect(sidebar.getByRole("link", { name: "VAT rates" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Duty rates" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");

    const note = sidebar.getByRole("note");
    await expect(note).toContainText("19 more in Advanced view");
    await note.getByRole("button", { name: /^Switch to Advanced/ }).click();
    await expect(sidebar.getByRole("link", { name: "Duty rates" })).toBeVisible();
    await expect(sidebar.getByRole("note")).toHaveCount(0);
  });

  test("the platform's Settings hub shows every setting in its six groups, in either view", async ({ page }) => {
    await setAdminView("basic");
    await page.goto("/admin/platform/settings");
    const main = page.locator("#admin-main");
    for (const heading of ["Site", "Money and tax", "AI", "Apps and connections", "Privacy and law", "Running the platform"]) {
      await expect(main.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    await expect(main.getByRole("region", { name: "Money and tax" }).getByRole("link", { name: /Duty rates/ })).toBeVisible();
    // The switch is in the top bar, as in a store: the sidebar beside the cards follows it, the cards stay.
    const sidebar = page.getByRole("navigation", { name: "More" });
    await expect(sidebar.getByRole("link", { name: "Duty rates" })).toHaveCount(0);
    await page.getByRole("group", { name: "How much the admin shows" }).getByRole("button", { name: "Advanced" }).click();
    await expect(sidebar.getByRole("link", { name: "Duty rates" })).toBeVisible();
    await expect(main.getByRole("region", { name: "Money and tax" }).getByRole("link", { name: /Duty rates/ })).toBeVisible();
  });
});
