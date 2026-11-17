import { createHash } from "node:crypto";

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
let orgBefore: string | null = null;
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
    // The starter template names the store's organisation number: the store has one while the spec runs.
    const [org] = await sql`select organisation_number from commerce.stores where slug = ${E2E_STORE}`;
    orgBefore = org.organisation_number ? String(org.organisation_number) : null;
    await sql`update commerce.stores set organisation_number = coalesce(organisation_number, '999 888 777') where slug = ${E2E_STORE}`;
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
    await sql`update commerce.stores set sales_pilot = false, organisation_number = ${orgBefore} where slug = ${E2E_STORE}`;
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

  // Every field is filled in: it can be sent.
  await expect(page.getByText("Every field is filled in.")).toBeVisible();

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

test("an owner sends a contract and signs for the store, and the customer signs it on the store's page with a code", async ({ page, browser }) => {
  await deals(page, true);
  dealId = dealId || (await makeDeal(page));
  await page.goto(`/admin/${E2E_STORE}/deals/${dealId}`);
  await page.getByRole("button", { name: "New contract" }).click();
  await expect(page.getByRole("button", { name: "Send for signing" })).toBeEnabled({ timeout: 30_000 });
  // The send draws the PDF and keeps it in the documents bucket, which this test server has no key for: it is played as the server plays
  // it (the snapshot, the file's SHA-256 and the time to sign, frozen together; contracts.int.test.ts sends for real), and everything
  // after it is the real app.
  {
    const sql = testDb();
    try {
      const [c] = await sql`select id, title from commerce.contracts where deal_id = ${dealId} and status = 'draft' order by created_at desc limit 1`;
      const snapshot = {
        version: 1,
        title: String(c.title),
        language: "nb",
        parties: { store: { name: "E2E Shop", orgNumber: "999 888 777", address: null }, customer: { name: NAME, orgNumber: null, address: null } },
        blocks: [{ type: "paragraph", text: `Avtale mellom E2E Shop og ${NAME}.` }, { type: "signatures" }],
        signers: [{ role: "store", name: "Eva Owner" }, { role: "customer", name: NAME }],
      };
      await sql`
        update commerce.contracts set status = 'sent', snapshot = ${sql.json(snapshot)}, pdf_path = ${`e2e/contracts/${String(c.id)}.pdf`},
          pdf_sha256 = ${"c".repeat(64)}, sent_at = now(), expires_at = now() + interval '30 days'
        where id = ${String(c.id)}`;
    } finally {
      await sql.end();
    }
    await page.reload();
  }

  // Sent: the owner, the deal's owner, signs for the store first, in the admin.
  await expect(page.getByRole("heading", { name: "Sign for the store" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/I have read the contract and agree/).check();
  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(page.getByText(new RegExp(`Waiting for ${NAME} to sign`))).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath("contract-sent.png"), fullPage: true });

  // The customer's link, as their email carries it; a code as the email would bring it (the email's log never keeps the code).
  const sql = testDb();
  let token = "";
  try {
    const [signer] = await sql`
      select g.id, g.store_id, g.token from commerce.contract_signers g join commerce.contracts c on c.id = g.contract_id
      where c.deal_id = ${dealId} and g.role = 'customer' and c.status = 'sent' order by c.created_at desc limit 1`;
    token = String(signer.token);
    const visitor = await browser.newPage();
    await visitor.goto(`/s/${E2E_STORE}/no/account/sign/${token}`);
    await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(visitor.locator("article.kc").getByText(NAME).first()).toBeVisible();
    await visitor.screenshot({ path: test.info().outputPath("sign-page.png"), fullPage: true });
    await visitor.getByRole("button", { name: /Send me a code|Send meg en kode/ }).click();
    await expect(visitor.getByLabel(/The code from the email|Koden fra e-posten/)).toBeVisible({ timeout: 30_000 });
    await sql`
      insert into commerce.contract_codes (store_id, signer_id, code_hash, expires_at)
      values (${String(signer.store_id)}, ${String(signer.id)}, ${createHash("sha256").update(`${String(signer.id)}:424242`).digest("hex")}, now() + interval '10 minutes')`;
    await visitor.getByLabel(/The code from the email|Koden fra e-posten/).fill("424242");
    await visitor.getByLabel(/I have read the contract and agree to it|Jeg har lest kontrakten og godtar den/).check();
    await visitor.getByRole("button", { name: /^(Sign|Signer)$/ }).click();
    await expect(visitor.getByRole("status").getByText(/You have signed|Du har signert/)).toBeVisible({ timeout: 30_000 });
    await visitor.screenshot({ path: test.info().outputPath("sign-page-signed.png"), fullPage: true });
    await visitor.close();
  } finally {
    await sql.end();
  }

  // Signed by both: the contract is signed and the deal won by it.
  await page.reload();
  await expect(page.getByText("Signed", { exact: true }).first()).toBeVisible();
  await page.goto(`/admin/${E2E_STORE}/deals/${dealId}`);
  await expect(page.getByText("Won when its contract was signed.")).toBeVisible();
});

test("an owner adds a contract template from the deals board, changes its words and days, and puts it away", async ({ page }) => {
  await deals(page, true);
  await page.goto(`/admin/${E2E_STORE}/deals`);
  await page.getByRole("link", { name: "Contract templates" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contract templates" })).toBeVisible();
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "New template" }).click();

  await expect(page.getByLabel("Name")).toHaveValue(/^Standard agreement/, { timeout: 30_000 });
  await page.getByLabel("Name").fill(`Service agreement ${run}`);
  await page.getByLabel("Days to sign").fill("14");
  await page.getByRole("region", { name: "What it says" }).getByLabel("Clause", { exact: true }).nth(1).fill(`Paid within 20 days ${run}.`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").getByText("Saved.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("article.kc").getByText(`Paid within 20 days ${run}.`)).toBeVisible();
  await expect(page.getByText("Version 2")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("contract-template.png"), fullPage: true });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Put the template away" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contract templates" })).toBeVisible({ timeout: 30_000 });
  // The list no longer offers it (the page left behind stays in the document, hidden, so only what a person sees is counted).
  await expect(page.getByRole("link", { name: new RegExp(`Service agreement ${run}`) })).toHaveCount(0);
});
