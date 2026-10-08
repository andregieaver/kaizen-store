import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Custom fields, phase 3 (D120): a money field and flexible content on a
 * product page, shown in two markets with different currencies and languages.
 * The amount is entered in kroner and shown in kronor in Sweden at the store's
 * rates, with no VAT label; the flexible rows are drawn in order as blocks, in
 * the shopper's language, and a row of a layout the field no longer has is not
 * drawn.
 */

const ids = {
  deposit: "f_deposit00001",
  content: "f_content00001",
  title: "f_title0000001",
  text: "f_bodytext0001",
  quote: "f_quotetext001",
  author: "f_authorname01",
  stars: "f_stars0000001",
};
const rowA = "r_rowaaaaaaaa1";
const rowB = "r_rowbbbbbbbb2";
const rowC = "r_rowcccccccc3";

async function arrange() {
  const slug = `fields3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Feltbutikk') returning id`;
    const [{ id }] =
      await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Feltbutikk', null) as id`;
    // Sweden is a country of its own (D178: Several countries on), in Swedish.
    await sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'], features = features || array['countries'] where id = ${id}`;
    // The store converts kroner and kronor at rates it set (D109): 1 EUR is 11.5 NOK and 11.2 SEK.
    await sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
      values (${id}, 'NOK', 11.5, 1, 0), (${id}, 'SEK', 11.2, 1, 1)`;
    const field = (
      fieldId: string,
      name: string,
      label: string,
      type: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id: fieldId,
      name,
      label,
      type,
      access: "public",
      ...extra,
    });
    const fields = [
      field(ids.deposit, "deposit", "Depositum", "money"),
      field(ids.content, "content", "Innhold", "flexible", {
        layouts: [
          {
            key: "text",
            label: "Tekstblokk",
            labels: { "sv-SE": "Textblock" },
            subFields: [field(ids.title, "title", "Tittel", "text"), field(ids.text, "body", "Brødtekst", "textarea")],
          },
          {
            key: "quote",
            label: "Sitat",
            subFields: [
              field(ids.quote, "quote", "Sitattekst", "textarea"),
              field(ids.author, "author", "Forfatter", "text"),
              field(ids.stars, "stars", "Stjerner", "number"),
            ],
          },
        ],
      }),
    ];
    await sql`insert into commerce.field_groups (store_id, name, slug, entities, location, fields, sort)
      values (${id}, 'Detaljer', 'details', ${sql.json(["product"])}, '[]'::jsonb, ${sql.json(fields as never)}, 0)`;
    const [product] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-handlenett'`;
    const put = (locale: string, values: Record<string, unknown>) =>
      sql`insert into commerce.field_values (store_id, entity, entity_id, locale, values) values (${id}, 'product', ${product.id}, ${locale}, ${sql.json(values as never)})`;
    // 1 234,56 NOK, the same in every language; rows by id, with a row of a layout that has been taken away.
    await put("", {
      [ids.deposit]: { amountMinor: 123456, currency: "NOK" },
      [ids.content]: [
        { id: rowA, layout: "text" },
        { id: rowB, layout: "quote", [ids.stars]: 5 },
        { id: rowC, layout: "removed" },
      ],
    });
    await put("nb-NO", {
      [ids.content]: {
        [rowA]: { [ids.title]: "Laget for hånd", [ids.text]: "Vevd på Voss" },
        [rowB]: { [ids.quote]: "Mindre er mer", [ids.author]: "Ola" },
        [rowC]: { [ids.title]: "Skal ikke vises" },
      },
    });
    await put("sv-SE", {
      [ids.content]: { [rowA]: { [ids.title]: "Gjord för hand" }, [rowB]: { [ids.quote]: "Mindre är mer" } },
    });
    return { slug };
  } finally {
    await sql.end();
  }
}

test("a money field shows in the market's currency, without a VAT label", async ({ page }) => {
  const { slug } = await arrange();

  // Norway: as entered, in kroner.
  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  const inNorway = page.locator("dl > div").filter({ has: page.getByText("Depositum", { exact: true }) });
  await expect(inNorway).toContainText(/1\s234,56/);
  await expect(inNorway).toContainText(/kr|NOK/);
  await expect(inNorway).not.toContainText(/mva|moms|vat/i);

  // Sweden: kronor at the store's rates, 123456 × 11.2 / 11.5 = 120235 öre.
  await page.goto(`/s/${slug}/se/p/demo-handlenett`);
  const inSweden = page.locator("dl > div").filter({ has: page.getByText("Depositum", { exact: true }) });
  await expect(inSweden).toContainText(/1\s202,35/);
  await expect(inSweden).toContainText(/kr|SEK/);
  await expect(inSweden).not.toContainText(/1\s234,56/);
  await expect(inSweden).not.toContainText(/mva|moms|vat/i);
});

test("flexible content shows its rows in order as blocks, in the shopper's language", async ({ page }) => {
  const { slug } = await arrange();

  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  const blocks = page.locator("[data-layout]");
  // The row of the layout that is gone is not drawn.
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(0)).toHaveAttribute("data-layout", "text");
  await expect(blocks.nth(1)).toHaveAttribute("data-layout", "quote");
  await expect(blocks.nth(0)).toContainText("Laget for hånd");
  await expect(blocks.nth(0)).toContainText("Vevd på Voss");
  await expect(blocks.nth(1)).toContainText("Mindre er mer");
  await expect(blocks.nth(1)).toContainText("Ola");
  // A number keeps its label in a block; a paragraph has none.
  await expect(blocks.nth(1)).toContainText("Stjerner");
  await expect(blocks.nth(0)).not.toContainText("Brødtekst");
  await expect(page.getByText("Skal ikke vises")).toHaveCount(0);
  // The layout's label is only an aria label: nothing headed by it.
  await expect(page.locator('li[aria-label="Tekstblokk"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Tekstblokk" })).toHaveCount(0);

  // In Swedish a row that has Swedish words shows them and the rest keeps the main language's; the layout is named in Swedish.
  await page.goto(`/s/${slug}/se/p/demo-handlenett`);
  const swedish = page.locator("[data-layout]");
  await expect(swedish).toHaveCount(2);
  await expect(swedish.nth(0)).toContainText("Gjord för hand");
  await expect(swedish.nth(0)).toContainText("Vevd på Voss");
  await expect(swedish.nth(1)).toContainText("Mindre är mer");
  await expect(swedish.nth(1)).toContainText("Ola");
  await expect(page.locator('li[aria-label="Textblock"]')).toHaveCount(1);
});
