import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { testDb } from "./db";

/**
 * A store's legal pages and what an order keeps of them (wave 1, 1e, docs/wave-1-trust.md 2.1, 2.4): the page chosen for a legal role is
 * served at its own address and listed in the footer once published; a draft is neither. An order that kept
 * the terms it was placed under shows them, as the shopper was shown them, behind the order page's own key.
 */

const page = (title: string, slug: string, text: string) => ({
  title,
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: [
    {
      id: "row-0",
      type: "row",
      layout: "1",
      columns: [{ id: "col-0", blocks: [{ id: "h", type: "heading", text, level: 1 }] }],
    },
  ],
});

type Seeded = { slug: string; storeId: string };

async function storeWithLegalPages(): Promise<Seeded> {
  const slug = `legal-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [access] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Siris Butikk', null) as id`;
    // Open for search engines, as a store is once its owner has finished setting it up: a store still in setup is not in the sitemap.
    await sql`update commerce.stores set setup_completed_at = now() where id = ${id}`;
    const publish = async (content: ReturnType<typeof page>, role: string | null) => {
      const [row] = await sql`
        insert into commerce.pages (store_id, slug, draft, published, published_at)
        values (${id}, ${content.slug}, ${sql.json(content as never)}, ${sql.json(content as never)}, now()) returning id`;
      if (role) await sql`insert into commerce.page_roles (store_id, role, page_id) values (${id}, ${role}, ${row.id})`;
      return row.id as string;
    };
    await publish(page("Kjøpsvilkår", "kjopsvilkar", "Slik handler du hos oss"), "terms");
    await publish(page("Personvernerklæring", "personvern", "Slik bruker vi opplysningene dine"), "privacy");
    // A starter that has not been published: a draft, with no published text.
    const draft = page("Frakt og levering", "frakt", "Utkast til fraktvilkår");
    await sql`insert into commerce.pages (store_id, slug, draft) values (${id}, ${draft.slug}, ${sql.json(draft as never)})`;
    return { slug, storeId: id as string };
  } finally {
    await sql.end();
  }
}

test("a legal page is at its own address and in the footer once published, and a draft is neither", async ({
  page: browser,
  request,
}) => {
  const { slug } = await storeWithLegalPages();

  await browser.goto(`/s/${slug}/no/kjopsvilkar`);
  await expect(browser.getByRole("heading", { level: 1, name: "Slik handler du hos oss" })).toBeVisible();
  // Never redirected away to a role's place: the address is the page's own.
  await expect(browser).toHaveURL(`/s/${slug}/no/kjopsvilkar`);

  // The page and the footer's list of legal pages pass the accessibility scan.
  expect(describeFindings(await violationsOn(browser))).toEqual([]);
  const footer = browser.getByRole("contentinfo").getByRole("navigation", { name: "Juridisk informasjon" });
  await expect(footer.getByRole("link", { name: "Kjøpsvilkår" })).toHaveAttribute("href", `/s/${slug}/no/kjopsvilkar`);
  await expect(footer.getByRole("link", { name: "Personvernerklæring" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Frakt og levering" })).toHaveCount(0);

  // The sitemap is not checked here: the server caches the list of public stores for hours, so a store made a moment ago is not in it yet.
  // `src/server/legal-starters.int.test.ts` holds that a published legal page stays in the sitemap's pages and a draft is not one.

  // The draft has no page on the site.
  expect((await request.get(`/s/${slug}/no/frakt`)).status()).toBe(404);
});

test("an order that kept its terms shows them, as shown, behind the order page's own key", async ({ page: browser, request }) => {
  const { slug, storeId } = await storeWithLegalPages();
  const sql = testDb();
  let orderId = "";
  const key = `cs_${slug}`;
  const text = page("Kjøpsvilkår", "kjopsvilkar", "Slik handler du hos oss");
  const hash = createHash("sha256")
    .update(JSON.stringify({ title: text.title, rows: text.rows }))
    .digest("hex");
  try {
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
      values (${storeId}, ${`T-${slug}`}, 'NO', 'NOK', 'nb-NO', ${`${slug}-kunde@example.com`}, 'paid', 20000, 0, 4000, 20000, '{}', '{"line1":"Gata 1"}') returning id`;
    orderId = order.id as string;
    await sql`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
      values (${storeId}, ${orderId}, ${`T-${slug}`}, 'Lampe', 1, 20000, 20000, 4000, 0.25, 'txcd_99999999')`;
    await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}, ${orderId}, 'stripe', ${key}, 20000, 'NOK', 'captured')`;
    const [snapshot] = await sql`
      insert into commerce.legal_snapshots (store_id, role, locale, title, content, content_hash)
      values (${storeId}, 'terms', 'nb-NO', ${text.title}, ${sql.json(text as never)}, ${hash}) returning id`;
    await sql`
      insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots)
      values (${orderId}, ${storeId}, 'checkbox', 'nb-NO', ${sql.json([{ role: "terms", snapshotId: snapshot.id, hash, title: text.title }] as never)})`;
  } finally {
    await sql.end();
  }

  await browser.goto(`/s/${slug}/no/order/${orderId}?session_id=${key}`);
  const block = browser.getByRole("region", { name: "Vilkår du godtok" });
  await expect(block).toBeVisible();
  await expect(block).toContainText("Du krysset av for disse tekstene da du bestilte");
  expect(describeFindings(await violationsOn(browser))).toEqual([]);
  await block.getByRole("link", { name: "Kjøpsvilkår" }).click();

  // The text as it was, read only, with a way back to the order.
  await expect(browser).toHaveURL(`/s/${slug}/no/order/${orderId}/terms/terms?session_id=${key}`);
  await expect(browser.getByRole("heading", { level: 1, name: "Kjøpsvilkår" })).toBeVisible();
  await expect(browser.getByText("Slik handler du hos oss")).toBeVisible();
  await expect(browser.getByText("Teksten slik den var da du bestilte")).toBeVisible();
  expect(describeFindings(await violationsOn(browser))).toEqual([]);
  await browser.getByRole("link", { name: "Tilbake til bestillingen" }).click();
  await expect(browser).toHaveURL(`/s/${slug}/no/order/${orderId}?session_id=${key}`);

  // The order's own key only: the page streams, so a refusal is the store's not-found page in a 200 response, and what matters is that
  // none of the text is in it. With the right key the text is there.
  const base = `/s/${slug}/no/order/${orderId}/terms`;
  const body = async (path: string) => (await request.get(path)).text();
  expect(await body(`${base}/terms?session_id=${key}`)).toContain("Slik handler du hos oss");
  for (const path of [
    `${base}/terms?session_id=wrong`,
    `${base}/terms`,
    `${base}/privacy?session_id=${key}`,
    `${base}/nonsense?session_id=${key}`,
    `/s/demo/no/order/${orderId}/terms/terms?session_id=${key}`,
  ]) {
    expect(await body(path), path).not.toContain("Slik handler du hos oss");
  }
  // And it carries the pay routes' policy, since it is under the order.
  expect((await request.get(`${base}/terms?session_id=${key}`)).headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});
