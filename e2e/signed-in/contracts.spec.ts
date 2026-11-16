import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Contracts on a deal (D695, `docs/contracts.md` step 2) as an owner uses them: a deal's page offers a new contract; it opens as a draft made
 * from the store's first template, with its words, its signers and beside them how it will look, filled in from the deal; what stops it from
 * going out is named; a changed word is kept and drawn again; the draft is deleted and the deal is as it was. The store is left as it was
 * found: Deals switched off again and the pilot closed.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PERSON = `contract-buyer-${run}@example.com`;
const NAME = `Kari Kontrakt ${run}`;
const TITLE = `Shop build ${run}`;
let salesWasOn = false;
let dealId = "";

async function deals(page: Page, on: boolean) {
  await page.goto(`/admin/${E2E_STORE}/settings/features`);
  const toggle = page.getByRole("switch", { name: "Deals", exact: true });
  if ((await toggle.getAttribute("aria-checked")) === String(on)) return;
  await toggle.click();
  if (!on) {
    const confirm = page.getByRole("region", { name: "Switch off Deals" }).getByRole("button", { name: "Switch off", exact: true });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(on), { timeout: 30_000 });
}

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id, 'sales' = any(features) as sales from commerce.stores where slug = ${E2E_STORE}`;
    salesWasOn = Boolean(store.sales);
    await sql`update commerce.stores set sales_pilot = true where slug = ${E2E_STORE}`;
    await sql`insert into commerce.customers (store_id, email, name) values (${String(store.id)}, ${PERSON}, ${NAME})`;
  } finally {
    await sql.end();
  }
});

/** The deal the contract is made on: in the store's first pipeline, which the board makes on its first visit (never one of the spec's own). */
async function makeDeal(page: Page): Promise<string> {
  await page.goto(`/admin/${E2E_STORE}/deals`);
  await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const [customer] = await sql`select id from commerce.customers where store_id = ${String(store.id)} and email = ${PERSON}`;
    const [owner] = await sql`select id from commerce.accounts where lower(email) = ${OWNER.email}`;
    const [stage] = await sql`
      select s.id, s.pipeline_id from commerce.deal_stages s join commerce.deal_pipelines p on p.id = s.pipeline_id
      where p.store_id = ${String(store.id)} order by p.sort, p.created_at, s.position limit 1`;
    const [deal] = await sql`
      insert into commerce.deals (store_id, title, customer_id, owner_id, pipeline_id, stage_id, currency)
      values (${String(store.id)}, ${TITLE}, ${String(customer.id)}, ${String(owner.id)}, ${String(stage.pipeline_id)}, ${String(stage.id)}, 'NOK') returning id`;
    return String(deal.id);
  } finally {
    await sql.end();
  }
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: OWNER.state });
  if (!salesWasOn) await deals(page, false);
  await page.close();
  const sql = testDb();
  try {
    if (dealId) await sql`delete from commerce.deals where id = ${dealId}`;
    await sql`update commerce.stores set sales_pilot = false where slug = ${E2E_STORE}`;
  } finally {
    await sql.end();
  }
});

test("an owner makes a contract on a deal from the template, sees it filled in, changes a word and deletes the draft", async ({ page }) => {
  await deals(page, true);
  dealId = await makeDeal(page);
  await page.goto(`/admin/${E2E_STORE}/deals/${dealId}`);
  const card = page.getByRole("heading", { name: "Contracts" });
  await expect(card).toBeVisible();
  await expect(page.getByText("No contract yet.")).toBeVisible();
  await page.getByRole("button", { name: "New contract" }).click();

  // The draft: its words and signers, and beside them the preview filled in from the deal.
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Title")).toHaveValue(TITLE);
  const signers = page.getByRole("region", { name: "Who signs" });
  await expect(signers.getByLabel("Email")).toHaveValue(PERSON);
  const preview = page.locator("article.kc");
  await expect(preview.getByText(NAME).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("contract-draft.png"), fullPage: true });

  // The store has no organisation number here: the preview says what stops it, by the field's name.
  await expect(page.getByText(/Nothing to fill in for \{store\.org_number\}/)).toBeVisible();

  // A changed word is kept, and the preview is drawn again with it.
  const words = page.getByRole("region", { name: "What it says" });
  await words.getByLabel("Clause", { exact: true }).nth(1).fill(`Paid within 10 days ${run}.`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").getByText("Saved.")).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByText(`Paid within 10 days ${run}.`)).toBeVisible();

  // The deal lists it as a draft.
  await page.getByRole("link", { name: "Back to the deal" }).click();
  await expect(page.getByRole("link", { name: new RegExp(TITLE) }).filter({ hasText: "Draft" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("deal-contracts.png"), fullPage: true });

  // Deleted, the deal is as it was.
  await page.getByRole("link", { name: new RegExp(TITLE) }).filter({ hasText: "Draft" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete the draft" }).click();
  await expect(page.getByText("No contract yet.")).toBeVisible({ timeout: 30_000 });
});
