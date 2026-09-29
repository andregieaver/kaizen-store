import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A store's custom fields (D118): what the owner enters for a product or a
 * page shows on the site in the shopper's language, only what the owner made
 * public, and only what its logic and its group's rules allow.
 */

const ids = {
  material: "f_material0001",
  weight: "f_weight000001",
  vegan: "f_vegan0000001",
  cost: "f_cost00000001",
  shy: "f_shy000000001",
  subtitle: "f_subtitle0001",
  months: "f_months000001",
};

const page = (slug: string, blocks: unknown[]) => ({
  title: "Om oss",
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: blocks.map((block, i) => ({
    id: `row-${i}`,
    type: "row",
    layout: "1",
    columns: [{ id: `col-${i}`, blocks: [block] }],
  })),
});

async function storeWithFields(): Promise<{ slug: string; pageSlug: string }> {
  const slug = `fields-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const pageSlug = "felt-side";
  const sql = testDb();
  try {
    const [request] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Feltbutikk') returning id`;
    const [{ id }] =
      await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Feltbutikk', null) as id`;
    // Norwegian is the store's main language, Swedish its other.
    await sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where id = ${id}`;
    const group = async (name: string, groupSlug: string, entities: string[], fields: unknown[], sort: number) => {
      const [row] = await sql`
        insert into commerce.field_groups (store_id, name, slug, entities, location, fields, sort)
        values (${id}, ${name}, ${groupSlug}, ${sql.json(entities as never)}, '[]'::jsonb, ${sql.json(fields as never)}, ${sort}) returning id`;
      return String(row.id);
    };
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
    await group(
      "Spesifikasjoner",
      "specs",
      ["product"],
      [
        field(ids.material, "material", "Materiale", "text", { labels: { "sv-SE": "Material" } }),
        field(ids.weight, "weight", "Vekt", "measurement", { units: ["g", "kg"] }),
        field(ids.vegan, "vegan", "Vegansk", "boolean"),
        field(ids.cost, "cost", "Innkjøpspris", "text", { access: "private" }),
        field(ids.shy, "shy", "Garantivilkår", "text", { when: [[{ field: ids.vegan, operator: "==", value: "0" }]] }),
      ],
      0,
    );
    const pageGroup = await group(
      "Sidedetaljer",
      "page-details",
      ["page"],
      [
        field(ids.subtitle, "subtitle", "Undertittel", "text"),
        field(ids.months, "months", "Måneder", "number", { unit: "mnd" }),
      ],
      1,
    );

    const [product] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-handlenett'`;
    const put = (entity: string, entityId: unknown, locale: string, values: Record<string, unknown>) =>
      sql`insert into commerce.field_values (store_id, entity, entity_id, locale, values) values (${id}, ${entity}, ${entityId as string}, ${locale}, ${sql.json(values as never)})`;
    await put("product", product.id, "", { [ids.weight]: { value: 250, unit: "g" }, [ids.vegan]: true });
    await put("product", product.id, "nb-NO", {
      [ids.material]: "Ull",
      [ids.cost]: "Hemmelig",
      [ids.shy]: "Tolv måneder",
    });

    const content = page(pageSlug, [{ id: "field", type: "customField", groupId: pageGroup, display: "list" }]);
    const [row] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, ${pageSlug}, ${sql.json(content as never)}, ${sql.json(content as never)}, now()) returning id`;
    await put("page", row.id, "", { [ids.months]: 12 });
    await put("page", row.id, "nb-NO", { [ids.subtitle]: "Vi lager sekker" });
  } finally {
    await sql.end();
  }
  return { slug, pageSlug };
}

test("a product page shows the public fields with a value, in the shopper's language", async ({ page: browser }) => {
  const { slug } = await storeWithFields();
  await browser.goto(`/s/${slug}/no/p/demo-handlenett`);
  await expect(browser.getByRole("heading", { name: "Spesifikasjoner" })).toBeVisible();
  const specs = browser.locator("dl").filter({ hasText: "Materiale" });
  await expect(specs).toContainText("Ull");
  await expect(specs).toContainText("Vekt");
  await expect(specs).toContainText("250 g");
  await expect(specs).toContainText("Vegansk");
  await expect(specs).toContainText("Ja");
  // Private until the owner makes it public; and a field its logic hides (it shows only when not vegan).
  await expect(browser.getByText("Innkjøpspris")).toHaveCount(0);
  await expect(browser.getByText("Hemmelig")).toHaveCount(0);
  await expect(browser.getByText("Garantivilkår")).toHaveCount(0);
  await expect(browser.getByText("Tolv måneder")).toHaveCount(0);

  // In Swedish: the group's own label, and the Norwegian text, as there is none in Swedish.
  await browser.goto(`/s/${slug}/se/p/demo-handlenett`);
  const swedish = browser.locator("dl").filter({ hasText: "Ull" });
  await expect(swedish).toContainText("Material");
  await expect(swedish).toContainText("Ja");
});

test("a field taken away, or a group switched off, leaves the page", async ({ page: browser }) => {
  const { slug } = await storeWithFields();
  const sql = testDb();
  try {
    await sql`update commerce.field_groups set active = false where store_id = (select id from commerce.stores where slug = ${slug}) and slug = 'specs'`;
  } finally {
    await sql.end();
  }
  await browser.goto(`/s/${slug}/no/p/demo-handlenett`);
  await expect(browser.getByRole("heading", { name: "Handlenett" }).first()).toBeVisible();
  await expect(browser.getByText("Spesifikasjoner")).toHaveCount(0);
  await expect(browser.getByText("Ull", { exact: true })).toHaveCount(0);
});

test("a page with a custom field component shows its own fields", async ({ page: browser }) => {
  const { slug, pageSlug } = await storeWithFields();
  await browser.goto(`/s/${slug}/no/${pageSlug}`);
  await expect(browser.getByText("Undertittel")).toBeVisible();
  await expect(browser.getByText("Vi lager sekker")).toBeVisible();
  await expect(browser.getByText("12 mnd")).toBeVisible();
  // The product's fields are not the page's.
  await expect(browser.getByText("Materiale")).toHaveCount(0);
});
