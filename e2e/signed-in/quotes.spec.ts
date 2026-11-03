import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * Request a quote as the owner meets it (D431): who may ask, under Settings, Orders; a request in Orders, Drafts with its *Quote requested*
 * chip and filter, opened with the shopper's note, a line priced on request waiting for its price, and declined with a short reply; and a
 * product's *Price on request* in its editor. What a request makes, the emails and *Send quote* are held by `quote-requests.int.test.ts`; the
 * shopper's side by `e2e/quotes.spec.ts`.
 */

test.use({ storageState: OWNER.state });

/** A store of the owner's own, so its drafts and products are no other spec's. */
const STORE = "e2e-quotes";
const RUN = Date.now().toString(36).toUpperCase();
let storeId = "";
let draftId = "";
/** The product of the request's line: priced on request, as a line waiting for its price always is when `requestQuote()` makes it. */
let requestedProductId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Quotes') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Quotes', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    storeId = String(store.id);
    // Each run (and a retry) starts as a new store would: quotes off, and no request left by an earlier run.
    await sql`delete from commerce.order_settings where store_id = ${storeId}`;
    await sql`delete from commerce.draft_orders where store_id = ${storeId} and source = 'quote'`;
    await sql`update commerce.products set price_on_request = false where store_id = ${storeId} and price_on_request`;
    // A shopper's request, as `requestQuote()` makes one: a line of a product priced on request (no price yet) and the shopper's note.
    const [variant] = await sql`
      select v.id, v.sku, v.product_id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
       where v.store_id = ${storeId} and p.kind = 'goods' and v.delivery = 'physical' and not p.subscription_only order by v.sku limit 1`;
    requestedProductId = String(variant.product_id);
    await sql`update commerce.products set price_on_request = true where id = ${requestedProductId}`;
    const [draft] = await sql`
      insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, source, email, shipping_address, request_company, request_note)
      values (${storeId}, commerce.next_draft_number(${storeId}), 'NO', 'no', 'NOK', 'nb-NO', 'quote', ${`kari-${RUN.toLowerCase()}@example.com`},
        ${sql.json({ name: "Kari Nordmann" })}, 'Nordmann AS', ${`Ten for the office, please (${RUN}).`})
      returning id`;
    draftId = String(draft.id);
    await sql`
      insert into commerce.draft_order_lines (store_id, draft_id, position, variant_id, title, sku, quantity, unit_price_minor, list_price_minor, delivery, price_requested)
      values (${storeId}, ${draftId}, 0, ${variant.id}, 'Demo item', ${variant.sku}, 10, 0, 24900, 'physical', true)`;
  } finally {
    await sql.end();
  }
});

test("the owner chooses who may request a quote under Settings, Orders", async ({ page }) => {
  await page.goto(`/admin/${STORE}/settings/orders`);
  const section = page.getByRole("region", { name: "Request a quote" });
  await expect(section.getByRole("radio", { name: /^Off/ })).toBeChecked();
  await section.getByRole("radio", { name: /^For business customers only/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Request a quote" }).getByRole("radio", { name: /^For business customers only/ })).toBeChecked();
  const sql = testDb();
  try {
    const [row] = await sql`select quote_requests from commerce.order_settings where store_id = ${storeId}`;
    expect(row.quote_requests).toBe("business");
  } finally {
    await sql.end();
  }
});

test("a request waits in Orders, Drafts with its chip and filter, shows the note, and is declined with a reply", async ({ page }) => {
  await page.goto(`/admin/${STORE}/orders/drafts`);
  await expect(page.getByText(/request for a quote waits for a price/)).toBeVisible();
  await page.getByRole("link", { name: /^Quote requests/ }).click();
  await expect(page).toHaveURL(/quotes=1/);
  const row = page.getByRole("listitem").filter({ hasText: "Kari Nordmann" });
  await expect(row.getByText("Quote requested")).toBeVisible();
  await row.getByRole("link").first().click();

  await expect(page).toHaveURL(new RegExp(`/orders/drafts/${draftId}$`));
  const panel = page.locator("[data-quote-request]");
  await expect(panel.getByRole("heading", { name: "Quote requested" })).toBeVisible();
  await expect(panel.getByText(`Ten for the office, please (${RUN}).`)).toBeVisible();
  // The line priced on request waits for its price; the list price is only a guide, and the quote cannot be sent yet.
  await expect(page.getByText(/^Priced on request: type the price for this customer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send quote" })).toBeDisabled();
  // Its price box is empty, never the 0 it is kept at, so saving anything else leaves it waiting.
  await expect(page.getByRole("region", { name: "Lines" }).getByRole("textbox", { name: /^Price each/ })).toHaveValue("");

  await panel.getByText("Decline the request").click();
  await panel.getByLabel("Your reply to the customer").fill("We cannot deliver ten before March.");
  await panel.getByRole("button", { name: "Decline and send the reply" }).click();
  // The page then shows the request as declined, and still says whether the reply went (here only logged: no email is set up).
  await expect(panel.getByRole("status")).toHaveText(/^Declined\./);
  await expect(panel.getByText(/^Declined \d/)).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-quote-request]").getByText("We cannot deliver ten before March.")).toBeVisible();
  const sql = testDb();
  try {
    const [draft] = await sql`select quote_declined_at, quote_reply, status from commerce.draft_orders where id = ${draftId}`;
    expect(draft.quote_declined_at).not.toBeNull();
    expect(draft).toMatchObject({ quote_reply: "We cannot deliver ten before March.", status: "open" });
  } finally {
    await sql.end();
  }
});

test("a product is priced on request from its editor", async ({ page }) => {
  const sql = testDb();
  let productId = "";
  try {
    // Not a part of a bundle priced from its products' prices (the demo bundle's mug and tote), which is never priced on request (D433).
    const [product] = await sql`
      select p.id from commerce.products p where p.store_id = ${storeId} and p.kind = 'goods' and not p.subscription_only and p.id <> ${requestedProductId}
        and not exists (
          select 1 from commerce.product_variants v join commerce.bundle_components bc on bc.store_id = v.store_id and bc.component_variant_id = v.id
           where v.store_id = p.store_id and v.product_id = p.id)
      order by p.handle limit 1`;
    productId = String(product.id);
  } finally {
    await sql.end();
  }
  await page.goto(`/admin/${STORE}/products/${productId}`);
  const box = page.getByRole("checkbox", { name: /^Price on request/ });
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect
    .poll(async () => {
      const db = testDb();
      try {
        const [row] = await db`select price_on_request from commerce.products where id = ${productId}`;
        return row.price_on_request;
      } finally {
        await db.end();
      }
    })
    .toBe(true);
});
