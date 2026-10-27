import { expect, test } from "@playwright/test";

import { newPageContent, type ContentGridBlock } from "../../src/lib/page-content";
import { newBlock } from "../../src/lib/page-rows";
import { testDb } from "../db";
import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * Content types as the owner works them (wave 6 unit H1, D326; row catalogue.metaobjects): a type made from a starting point on Website →
 * Content, an entry written in its fields' own form and published only once its required fields are filled, and the type's list saying
 * so. The server side is held by content-types.int.test.ts; this holds the screens that drive it.
 */

test.use({ storageState: OWNER.state });

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    // A run that stopped half-way leaves its types: they are made again from nothing.
    await sql`delete from commerce.content_types where store_id = (select id from commerce.stores where slug = ${E2E_STORE})`;
    await sql`delete from commerce.pages where store_id = (select id from commerce.stores where slug = ${E2E_STORE}) and slug = 'our-team'`;
  } finally {
    await sql.end();
  }
});

test("makes a type from a starting point, and publishes an entry once its required fields are filled", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/content`);
  await expect(page.getByRole("heading", { level: 1, name: "Content" })).toBeVisible();
  await page.getByRole("link", { name: /Questions and answers/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New content type" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Questions and answers");
  await page.getByRole("button", { name: "Save the type" }).click();

  // Saved, the type's entries open: none yet.
  await expect(page.getByRole("heading", { level: 1, name: "Questions and answers" })).toBeVisible();
  await expect(page.getByText("No entries yet.")).toBeVisible();
  await page.getByRole("link", { name: "New entry" }).click();

  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Do you ship abroad?");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  // The answer is required: the draft is kept, publishing waits.
  await expect(page.getByRole("alert").filter({ hasText: "Answer is required." })).toBeVisible();

  await page.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type("Yes, to every country in the EU.");
  await page.getByRole("button", { name: /Publish/ }).first().click();
  // Published, the new entry's own page opens, saying so.
  await expect(page.getByRole("heading", { level: 1, name: "Do you ship abroad?" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Published", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Back to Questions and answers" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Do you ship abroad?" });
  await expect(row.getByText("Published", { exact: true })).toBeVisible();
});

test("lists a type's published entries in a content grid, each opening its own page", async ({ page }) => {
  // Locations start with a page for each entry.
  await page.goto(`/admin/${E2E_STORE}/content/new?preset=locations`);
  await page.getByRole("button", { name: "Save the type" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Locations" })).toBeVisible();
  await page.getByRole("link", { name: "New entry" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Oslo shop");
  await page.getByRole("textbox", { name: "Address", exact: true }).fill("Storgata 1");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Oslo shop" })).toBeVisible();

  // A page of the store with a grid of the type's entries, as the page builder saves one.
  const sql = testDb();
  try {
    const [type] = await sql`
      select t.key, t.store_id from commerce.content_types t join commerce.stores s on s.id = t.store_id where s.slug = ${E2E_STORE} and t.slug = 'locations'`;
    let n = 0;
    const id = () => `e2e${++n}`;
    const grid = { ...(newBlock("contentGrid", id) as ContentGridBlock), source: { type: "entries" as const, contentType: String(type.key) }, sort: "manual" as const };
    const content = { ...newPageContent(), title: "Our team", slug: "our-team", rows: [{ id: id(), type: "row" as const, layout: "1" as const, columns: [{ id: id(), blocks: [grid] }] }] };
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${type.store_id}, 'our-team', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${E2E_STORE}/no/our-team`);
  await page.getByRole("link", { name: "Oslo shop" }).first().click();
  await expect(page).toHaveURL(/\/locations\/oslo-shop$/);
  // The standard entry page: its title and its public fields.
  await expect(page.getByRole("heading", { level: 1, name: "Oslo shop" })).toBeVisible();
  await expect(page.getByText("Storgata 1")).toBeVisible();
});

test("gives Kaizena Flow's own site the same screens, its entries on its own addresses (H4)", async ({ browser }) => {
  const sql = testDb();
  try {
    await sql`delete from commerce.content_types where store_id is null and slug = 'locations'`;
  } finally {
    await sql.end();
  }
  const admin = await browser.newContext({ storageState: ADMIN.state });
  const page = await admin.newPage();
  try {
    await page.goto("/admin/platform/content/new?preset=locations");
    await page.getByRole("button", { name: "Save the type" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Locations" })).toBeVisible();
    await page.getByRole("link", { name: "New entry" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Kaizena Flow office");
    await page.getByRole("textbox", { name: "Address", exact: true }).fill("Kongens gate 2");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Kaizena Flow office" })).toBeVisible();

    // The entry's own page on Kaizena Flow's site, where no page has its address.
    await page.goto("/locations/kaizena-flow-office");
    await expect(page.getByRole("heading", { level: 1, name: "Kaizena Flow office" })).toBeVisible();
    await expect(page.getByText("Kongens gate 2")).toBeVisible();
  } finally {
    await admin.close();
  }
});
