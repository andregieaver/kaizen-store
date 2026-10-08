import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Custom fields, phase 2 (D119): repeaters, links, relations and files on a
 * product page, a variant's own fields, a category's fields, a field as a
 * listing filter and in search, structured data, and a heading bound to a
 * field.
 */

const ids = {
  nutrients: "f_nutrients01",
  nutrientName: "f_nutrname001",
  nutrientAmount: "f_nutramount1",
  guide: "f_guide0000001",
  related: "f_related00001",
  sheet: "f_sheet0000001",
  material: "f_material0002",
  note: "f_varnote00001",
  intro: "f_termintro001",
  subtitle: "f_subtitle0002",
};
const rowA = "r_rowaaaaaaaa1";
const rowB = "r_rowbbbbbbbb2";

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

async function arrange() {
  const slug = `fields2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Feltbutikk') returning id`;
    const [{ id }] =
      await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Feltbutikk', null) as id`;
    // Sweden is a country of its own (D178: Several countries on), in Swedish.
    await sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'], features = features || array['countries'] where id = ${id}`;
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
    const group = (name: string, groupSlug: string, entities: string[], fields: unknown[], sort: number) =>
      sql`insert into commerce.field_groups (store_id, name, slug, entities, location, fields, sort)
        values (${id}, ${name}, ${groupSlug}, ${sql.json(entities as never)}, '[]'::jsonb, ${sql.json(fields as never)}, ${sort})`;
    const put = (entity: string, entityId: unknown, locale: string, values: Record<string, unknown>) =>
      sql`insert into commerce.field_values (store_id, entity, entity_id, locale, values) values (${id}, ${entity}, ${entityId as string}, ${locale}, ${sql.json(values as never)})`;

    const [product] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-handlenett'`;
    const [other] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-notatbok'`;
    const aboutContent = page("om-felt", []);
    const [about] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, 'om-felt', ${sql.json(aboutContent as never)}, ${sql.json(aboutContent as never)}, now()) returning id`;

    await group(
      "Detaljer",
      "details",
      ["product"],
      [
        field(ids.nutrients, "nutrients", "Næringsinnhold", "repeater", {
          subFields: [
            field(ids.nutrientName, "name", "Navn", "text"),
            field(ids.nutrientAmount, "amount", "Mengde", "number"),
          ],
        }),
        field(ids.guide, "guide", "Veiledning", "link"),
        field(ids.related, "related", "Passer med", "product"),
        field(ids.sheet, "sheet", "Datablad", "file"),
        field(ids.material, "material", "Materiale", "select", {
          choices: [
            { key: "ull", label: "Ull" },
            { key: "bomull", label: "Bomull" },
          ],
          filter: true,
          search: true,
        }),
      ],
      0,
    );
    await put("product", product.id, "", {
      [ids.nutrients]: [
        { id: rowA, [ids.nutrientAmount]: 10 },
        { id: rowB, [ids.nutrientAmount]: 3 },
      ],
      [ids.related]: other.id,
      [ids.sheet]: {
        url: "https://files.example/datablad.pdf",
        name: "datablad.pdf",
        size: 120000,
        contentType: "application/pdf",
      },
      [ids.material]: "ull",
    });
    // A link is per language (its words): here, in the main language's row.
    await put("product", product.id, "nb-NO", {
      [ids.guide]: { kind: "page", ref: about.id, label: "Les mer", newTab: false },
      [ids.nutrients]: { [rowA]: { [ids.nutrientName]: "Protein" }, [rowB]: { [ids.nutrientName]: "Salt" } },
    });
    await put("product", product.id, "sv-SE", { [ids.nutrients]: { [rowA]: { [ids.nutrientName]: "Protein (sv)" } } });
    await put("product", other.id, "", { [ids.material]: "bomull" });
    // What keyword search reads of the searchable field: its choice's words.
    await sql`insert into commerce.field_search (store_id, entity_id, locale, body) values (${id}, ${product.id}, 'nb-NO', 'Ull')`;

    // A variant's own fields.
    await group("Variantnotat", "variant-notes", ["variant"], [field(ids.note, "note", "Notat", "text")], 1);
    const variants =
      await sql`select id from commerce.product_variants where product_id = ${product.id} and active order by sku`;
    for (const [i, variant] of variants.entries())
      await put("variant", variant.id, "nb-NO", { [ids.note]: `Notat ${i}` });

    // A category's.
    await group("Kategoriinfo", "term-info", ["term"], [field(ids.intro, "intro", "Introduksjon", "text")], 2);
    const [term] = await sql`select id from commerce.terms where store_id = ${id} and slug = 'hjem'`;
    await put("term", term.id, "nb-NO", { [ids.intro]: "Alt til hjemmet" });

    // A page whose heading takes its words from a field.
    await group("Sidedetaljer", "page-details", ["page"], [field(ids.subtitle, "subtitle", "Undertittel", "text")], 3);
    const bound = page("bundet", [
      { id: "heading", type: "heading", level: 2, text: "Reservetittel", bind: { fieldId: ids.subtitle } },
    ]);
    const [boundPage] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, 'bundet', ${sql.json(bound as never)}, ${sql.json(bound as never)}, now()) returning id`;
    await put("page", boundPage.id, "nb-NO", { [ids.subtitle]: "Laget for hånd" });
    return { slug, variants: variants.length };
  } finally {
    await sql.end();
  }
}

test("a product page shows repeater rows, a link, a related product and a file, in the shopper's language", async ({
  page: browser,
}) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/p/demo-handlenett`);
  const details = browser.locator("dl, table, section").filter({ hasText: "Næringsinnhold" }).first();
  await expect(details).toContainText("Protein");
  await expect(details).toContainText("Salt");
  await expect(browser.getByRole("link", { name: "Les mer" })).toHaveAttribute(
    "href",
    /\/s\/.+\/no\/om-felt$|\/no\/om-felt$/,
  );
  await expect(browser.getByRole("link", { name: /Notatbok/ }).first()).toBeVisible();
  const file = browser.getByRole("link", { name: /datablad\.pdf/ });
  await expect(file).toHaveAttribute("href", "https://files.example/datablad.pdf");
  await expect(file).toHaveAttribute("download", "");

  // In Swedish a row that has a Swedish name shows it, and the other keeps the main language's.
  await browser.goto(`/s/${slug}/se/p/demo-handlenett`);
  await expect(browser.getByText("Protein (sv)")).toBeVisible();
  await expect(browser.getByText("Salt", { exact: true })).toBeVisible();

  // Structured data carries the plain fields.
  const jsonLd = await browser.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.join("\n")).toContain("additionalProperty");
});

test("a variant's own fields show for the chosen variant", async ({ page: browser }) => {
  const { slug, variants } = await arrange();
  test.skip(variants < 1, "the demo bag has no variants");
  await browser.goto(`/s/${slug}/no/p/demo-handlenett`);
  await expect(browser.getByText("Notat 0")).toBeVisible();
  if (variants > 1) await expect(browser.getByText("Notat 1")).toHaveCount(0);
});

test("a category page shows the category's own fields", async ({ page: browser }) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/category/hjem`);
  await expect(browser.getByText("Alt til hjemmet")).toBeVisible();
});

test("a choice field narrows a product list and is found by search", async ({ page: browser }) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/products?f.material=ull`);
  await expect(browser.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
  // (The store's menu links to it too: look in the list only.)
  await expect(browser.getByRole("main").getByRole("link", { name: /Notatbok/ })).toHaveCount(0);

  await browser.goto(`/s/${slug}/no/search?q=ull`);
  await expect(browser.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
});

test("a heading bound to a field says what is entered in it", async ({ page: browser }) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/bundet`);
  await expect(browser.getByRole("heading", { name: "Laget for hånd" })).toBeVisible();
  await expect(browser.getByText("Reservetittel")).toHaveCount(0);
});
