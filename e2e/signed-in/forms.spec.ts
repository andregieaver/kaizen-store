import { expect, test, type Page } from "@playwright/test";

import { newPageContent, pageInput } from "../../src/lib/page-content";
import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Forms as their own records (D705, docs/forms.md step F1): the owner makes a contact form from a starter under Website → Forms, changes a
 * question and saves; a page shows it with the Form component, a visitor sends it from the site, and the owner reads the response, which is
 * new until opened. `FORMS_SHOTS` (a folder) keeps a picture of each screen for the owner.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const base = `/admin/${E2E_STORE}/forms`;
const slug = "e2e-forms-contact";
const shots = process.env.FORMS_SHOTS;
let storeId = "";
let formId = "";

const shoot = async (p: Page, name: string) => {
  if (shots) await p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    await sql`delete from commerce.pages where store_id = ${storeId} and slug = ${slug}`;
    await sql`delete from commerce.forms where store_id = ${storeId} and name like 'E2E %'`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.pages where store_id = ${storeId} and slug = ${slug}`;
    await sql`delete from commerce.forms where store_id = ${storeId} and name like 'E2E %'`;
  } finally {
    await sql.end();
  }
});

test("makes a contact form from a starter, ready to place, and saves a change", async ({ page: p }) => {
  await p.goto(base);
  await expect(p.getByRole("heading", { level: 1, name: "Forms" })).toBeVisible();
  await shoot(p, "1-forms-list");
  await p.goto(`${base}/new`);
  await expect(p.locator('[data-starter="newsletter"]')).toBeVisible();
  await shoot(p, "2-new-form");
  await p.locator('[data-starter="contact"]').click();
  await expect(p).toHaveURL(new RegExp(`${base}/[0-9a-f-]{36}$`));
  formId = p.url().split("/").at(-1)!;
  // Ready to place: it sends to the owner's own address.
  await expect(p.locator("[data-form-recipients]")).not.toHaveValue("");
  await p.locator("[data-form-name]").fill("E2E Contact");
  await p.locator("[data-form-add]").click();
  const added = p.locator("[data-question]").last();
  await added.getByLabel("Question", { exact: true }).fill("Order number");
  await expect(p.locator("[data-form-preview]")).toContainText("Order number");
  await p.locator("[data-form-save]").click();
  await expect(p.getByRole("status")).toHaveText("Saved.");
  await shoot(p, "3-form-editor");
  await p.reload();
  await expect(p.locator("[data-form-name]")).toHaveValue("E2E Contact");
  await expect(p.locator("[data-question]")).toHaveCount(4);
});

test("a page shows the form, a visitor sends it, and the owner reads the response", async ({ page: p, browser }) => {
  const sql = testDb();
  let pageId = "";
  try {
    const content = pageInput.parse({
      ...newPageContent(),
      title: "E2E forms",
      slug,
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "f1", type: "form", formId }] }] }],
    });
    const [row] = await sql`insert into commerce.pages (store_id, type, slug, draft) values (${storeId}, 'page', ${slug}, ${sql.json(content as never)}) returning id`;
    pageId = String(row.id);
  } finally {
    await sql.end();
  }
  // The builder draws the form the component picked, and publishing puts it on the site.
  await p.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(p.locator(`[data-form-standin="${formId}"]`)).toBeVisible();
  await expect(p.locator(`[data-form-standin="${formId}"]`)).toContainText("Order number");
  await shoot(p, "6-builder");
  await p.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(p.locator("[data-editor-bar]").getByRole("status")).toContainText(/Published/);

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const site = await visitor.newPage();
  await site.goto(`/s/${E2E_STORE}/${slug}`);
  const form = site.locator("form").filter({ has: site.getByRole("textbox", { name: /order number/i }) });
  await expect(form).toBeVisible();
  await shoot(site, "7-site");
  await form.getByRole("textbox").nth(0).fill("Ada Visitor");
  await form.getByRole("textbox").nth(1).fill("ada.visitor@example.com");
  await form.getByRole("textbox").nth(2).fill("Where is my parcel?");
  await form.getByRole("textbox", { name: /order number/i }).fill("1042");
  // People take a few seconds: a form sent at once is taken for a robot's.
  await site.waitForTimeout(2200);
  await form.getByRole("button").click();
  await expect(site.locator("p[role=status]").first()).toBeVisible();
  await visitor.close();

  await p.goto(base);
  await expect(p.getByText("1 new")).toBeVisible();
  await shoot(p, "4-forms-list-with-response");
  await p.goto(`${base}/responses/${formId}`);
  const row = p.locator("[data-response]").first();
  await expect(row).toContainText("ada.visitor@example.com");
  await row.getByRole("button").first().click();
  await expect(row).toContainText("1042");
  await shoot(p, "5-form-responses");
});

test("asks a question only when an earlier answer holds (F3)", async ({ page: p, browser }) => {
  await p.goto(`${base}/${formId}`);
  // One choice, and a question asked only when it is Order.
  await p.locator("[data-form-add]").click();
  const topic = p.locator("[data-question]").last();
  await topic.locator("select").first().selectOption("radio");
  await topic.getByLabel("Question", { exact: true }).fill("E2E topic");
  await topic.locator("textarea").first().fill("Order\nOther");
  await p.locator("[data-form-add]").click();
  const ref = p.locator("[data-question]").last();
  await ref.getByLabel("Question", { exact: true }).fill("E2E reference");
  await ref.locator("[data-question-more] summary").click();
  await ref.locator("[data-add-condition]").click();
  await ref.locator("[data-condition] select").nth(1).selectOption("is");
  await expect(ref.locator("[data-condition]").getByLabel("Order")).toBeChecked();
  await shoot(p, "8-conditions");
  await p.locator("[data-form-save]").click();
  await expect(p.getByRole("status")).toHaveText("Saved.");

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const site = await visitor.newPage();
  await site.goto(`/s/${E2E_STORE}/${slug}`);
  const form = site.locator("form").filter({ has: site.getByRole("textbox", { name: /order number/i }) });
  await expect(form.getByRole("radio", { name: "Order" })).toBeVisible();
  await expect(form.getByRole("textbox", { name: /E2E reference/ })).toHaveCount(0);
  await form.getByRole("radio", { name: "Order" }).check();
  await expect(form.getByRole("textbox", { name: /E2E reference/ })).toBeVisible();
  await shoot(site, "9-site-conditions");
  await form.getByRole("radio", { name: "Other" }).check();
  await expect(form.getByRole("textbox", { name: /E2E reference/ })).toHaveCount(0);
  await visitor.close();
});
