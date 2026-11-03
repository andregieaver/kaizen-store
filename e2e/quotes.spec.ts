import { expect, test, type Page } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Request a quote and the product question (D431), as a shopper meets them. Each test has a store of its own, arranged with SQL before its
 * first request (nothing of it is cached yet): a product priced on request shows no price and no Add to cart, only *Request a quote*; a store
 * that offers quotes to everyone shows the button beside Add to cart and in the cart; a product layout's question part asks about the product.
 * What becomes of a request (the draft, its emails, Send quote) is held by `quote-requests.int.test.ts`; the staff's side by
 * `e2e/signed-in/quotes.spec.ts`. The store sells in Norway alone, so its addresses carry no country (D181).
 */

const MUG = "demo-keramikkopp";

async function arrange(name: string, change: (sql: ReturnType<typeof testDb>, storeId: string) => Promise<unknown>) {
  const store = await testStore(name);
  const sql = testDb();
  try {
    await change(sql, store.id);
  } finally {
    await sql.end();
  }
  return store;
}

const productOnRequest = (sql: ReturnType<typeof testDb>, storeId: string, handle = MUG) =>
  sql`update commerce.products set price_on_request = true where store_id = ${storeId} and handle = ${handle}`;

const quotesFor = async (storeId: string) => {
  const sql = testDb();
  try {
    return await sql`
      select d.email, d.request_note, d.company_name, d.shipping_address, l.quantity, l.price_requested, l.unit_price_minor
      from commerce.draft_orders d join commerce.draft_order_lines l on l.draft_id = d.id
      where d.store_id = ${storeId} and d.source = 'quote' order by d.created_at, l.position`;
  } finally {
    await sql.end();
  }
};

/** Fills the request form in its dialog and sends it, after the few seconds a person takes (robots are told it worked and nothing is made). */
async function sendRequest(page: Page, dialog: ReturnType<Page["getByRole"]>, values: { name: string; email: string; company?: string; note?: string }) {
  await dialog.getByLabel("Navn").fill(values.name);
  await dialog.getByLabel("E-post", { exact: false }).first().fill(values.email);
  if (values.company) await dialog.getByLabel(/^Firma/).fill(values.company);
  if (values.note) await dialog.getByLabel(/^Melding/).fill(values.note);
  await page.waitForTimeout(2200);
  await dialog.getByRole("button", { name: "Send forespørselen" }).click();
  await expect(dialog.getByRole("status")).toContainText("Takk. Vi har mottatt forespørselen");
}

test("a product priced on request shows no price and no Add to cart, only Request a quote", async ({ page }) => {
  const store = await arrange("tilbud-pris", (sql, id) => productOnRequest(sql, id));
  await page.goto(`/s/${store.slug}/p/${MUG}`);
  await expect(page.getByText("Pris på forespørsel").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Legg i handlekurven" })).toHaveCount(0);
  // No price reaches the page: neither shown nor in its structured data.
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join("")).not.toMatch(/"price"\s*:/);

  await page.getByRole("button", { name: "Be om tilbud" }).click();
  const dialog = page.getByRole("dialog", { name: "Be om tilbud" });
  await expect(dialog).toBeVisible();
  // The email is always asked: the quote goes to it.
  await dialog.getByRole("button", { name: "Send forespørselen" }).click();
  await expect(dialog.getByText("Skriv en hel e-postadresse.").or(dialog.getByText("Fyll ut dette feltet.")).first()).toBeVisible();
  await dialog.getByLabel("Antall").fill("12");
  await sendRequest(page, dialog, { name: "Kari Nordmann", email: "kari@example.com", note: "Til kontoret." });

  const rows = await quotesFor(store.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ email: "kari@example.com", request_note: "Til kontoret.", quantity: 12, price_requested: true });
  expect(Number(rows[0].unit_price_minor)).toBe(0);
});

test("a product priced on request says so on the product list too", async ({ page }) => {
  const store = await arrange("tilbud-liste", (sql, id) => productOnRequest(sql, id));
  await page.goto(`/s/${store.slug}`);
  const card = page.locator("article, li").filter({ has: page.getByRole("link", { name: /Keramikkopp/ }) }).first();
  await expect(card.getByText("Pris på forespørsel")).toBeVisible();
});

test("where the store offers quotes to everyone, Request a quote is beside Add to cart and in the cart", async ({ page }) => {
  const store = await arrange("tilbud-alle", (sql, id) => sql`insert into commerce.order_settings (store_id, quote_requests) values (${id}, 'everyone')`);
  await page.goto(`/s/${store.slug}/p/${MUG}`);
  await expect(page.getByRole("button", { name: "Be om tilbud" })).toBeVisible();
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." }).first()).toBeVisible();
  await page.goto(`/s/${store.slug}/cart`);
  await page.getByRole("button", { name: "Be om tilbud på disse varene" }).click();
  const dialog = page.getByRole("dialog", { name: "Be om tilbud" });
  await expect(dialog.getByText("Du spør om")).toBeVisible();
  await sendRequest(page, dialog, { name: "Ola Nordmann", email: "ola@example.com", company: "Nordmann AS" });

  const rows = await quotesFor(store.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ email: "ola@example.com", company_name: "Nordmann AS", price_requested: false });
  expect(Number(rows[0].unit_price_minor)).toBeGreaterThan(0);
});

test("a store with quotes off offers none on a product that shows its price", async ({ page }) => {
  const store = await testStore("tilbud-av");
  await page.goto(`/s/${store.slug}/p/${MUG}`);
  await expect(page.getByRole("button", { name: "Legg i handlekurven" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Be om tilbud" })).toHaveCount(0);
});

test("a product layout's question part sends a question about the product", async ({ page }) => {
  const store = await arrange("sporsmal", async (sql, id) => {
    const content = {
      title: "Produkt",
      slug: "produkt",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [
        {
          id: "r1",
          type: "row",
          layout: "1",
          columns: [{ id: "c1", blocks: [{ id: "t1", type: "product", part: "title" }, { id: "q1", type: "product", part: "question", intro: "Vi svarer innen en dag." }] }],
        },
      ],
    };
    const [layout] = await sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${id}, 'product_layout', 'produkt', ${sql.json(content)}, ${sql.json(content)}, now()) returning id`;
    await sql`update commerce.stores set product_layout_id = ${layout.id}, contact_email = 'butikk@example.com' where id = ${id}`;
  });
  await page.goto(`/s/${store.slug}/p/${MUG}`);
  const part = page.getByRole("region", { name: "Spør om dette produktet" });
  await expect(part.getByText("Vi svarer innen en dag.")).toBeVisible();
  await part.getByLabel(/Navn/).fill("Kari Nordmann");
  await part.getByLabel(/E-post/).fill("kari@example.com");
  await part.getByLabel(/Spørsmålet ditt/).fill("Tåler den oppvaskmaskin?");
  await page.waitForTimeout(2200);
  await part.getByRole("button", { name: "Send spørsmålet" }).click();
  await expect(part.getByText("Takk. Vi har mottatt spørsmålet ditt")).toBeVisible();
});
