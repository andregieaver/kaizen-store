import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Custom fields on the store itself, customers and orders (D120): a store
 * field shows in a page's custom fields component set to the store's, in the
 * footer, and through a bound heading on another page; a customer's private
 * field is on no page of the storefront.
 */

const ids = {
  hours: "f_storehours01",
  story: "f_storestory01",
  hidden: "f_storehidden1",
  vip: "f_customervip01",
};

const page = (slug: string, title: string, blocks: unknown[]) => ({
  title,
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
  const slug = `storefields-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Feltbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Feltbutikk', null) as id`;
    await sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where id = ${id}`;

    const field = (fieldId: string, name: string, label: string, type: string, access: string) => ({
      id: fieldId,
      name,
      label,
      type,
      access,
    });
    const group = (name: string, groupSlug: string, entities: string[], fields: unknown[], sort: number) =>
      sql`insert into commerce.field_groups (store_id, name, slug, entities, location, fields, sort)
        values (${id}, ${name}, ${groupSlug}, ${sql.json(entities as never)}, '[]'::jsonb, ${sql.json(fields as never)}, ${sort})`;
    const put = (entity: string, entityId: unknown, locale: string, values: Record<string, unknown>) =>
      sql`insert into commerce.field_values (store_id, entity, entity_id, locale, values) values (${id}, ${entity}, ${entityId as string}, ${locale}, ${sql.json(values as never)})`;

    // The store's own: two public fields and a private one.
    await group(
      "Om butikken",
      "about-store",
      ["store"],
      [
        field(ids.hours, "hours", "Åpningstider", "text", "public"),
        field(ids.story, "story", "Vår historie", "textarea", "public"),
        field(ids.hidden, "internal", "Internt notat", "text", "private"),
      ],
      0,
    );
    await put("store", id, "nb-NO", {
      [ids.hours]: "Man–fre 9–17",
      [ids.story]: "Vi brenner kaffe i Bergen.",
      [ids.hidden]: "Hemmelig lagerkode 4711",
    });
    await put("store", id, "sv-SE", { [ids.hours]: "Mån–fre 9–17" });

    // A customer's private field with a value: never on the storefront.
    await group("Kundenotater", "customer-notes", ["customer"], [field(ids.vip, "note", "Kundenotat", "text", "private")], 1);
    const [customer] =
      await sql`insert into commerce.customers (store_id, email, name) values (${id}, 'kunde@example.com', 'Kari Kunde') returning id`;
    await put("customer", customer.id, "nb-NO", { [ids.vip]: "Kundens hemmelige notat 9999" });

    // A page showing the store's fields, and one whose heading is bound to a store field.
    const about = page("om-butikken", "Om butikken", [
      { id: "cf", type: "customField", source: "store", showHeading: false },
    ]);
    const bound = page("bundet", "Bundet", [
      { id: "h", type: "heading", level: 2, text: "Reservetittel", bind: { fieldId: ids.hours, source: "store" } },
    ]);
    for (const content of [about, bound]) {
      await sql`insert into commerce.pages (store_id, slug, draft, published, published_at)
        values (${id}, ${content.slug}, ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
    }

    // A footer with the store's story and its opening hours through a bound heading.
    const row = (blocks: unknown[]) => ({ id: "f", type: "row", layout: "1", columns: [{ id: "f-c", blocks }] });
    const footer = {
      ...page("bunn", "Bunn", []),
      rows: [
        row([
          { id: "b", type: "site", part: "business" },
          { id: "k", type: "site", part: "cookies" },
          { id: "cf", type: "customField", source: "store", fieldId: ids.story, showLabel: false },
          { id: "h", type: "heading", level: 3, text: "Tider", bind: { fieldId: ids.hours, source: "store" } },
        ]),
      ],
    };
    const [{ id: footerId }] = await sql`insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${id}, 'footer', 'bunn', ${sql.json(footer as never)}, ${sql.json(footer as never)}, now()) returning id`;
    await sql`update commerce.stores set footer_id = ${footerId} where id = ${id}`;
    return { slug };
  } finally {
    await sql.end();
  }
}

test("a page's custom fields component shows the store's public fields, in the shopper's language", async ({ page: browser }) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/om-butikken`);
  const main = browser.getByRole("main");
  await expect(main).toContainText("Åpningstider");
  await expect(main).toContainText("Man–fre 9–17");
  await expect(main).toContainText("Vi brenner kaffe i Bergen.");
  // A private field of the store is never drawn.
  await expect(browser.getByText("Hemmelig lagerkode")).toHaveCount(0);

  // In Swedish the hours are written in Swedish; the story has no Swedish words and keeps the main language's.
  await browser.goto(`/s/${slug}/se/om-butikken`);
  await expect(browser.getByRole("main")).toContainText("Mån–fre 9–17");
  await expect(browser.getByRole("main")).toContainText("Vi brenner kaffe i Bergen.");
});

test("the footer shows the store's fields, and a heading bound to one shows what is entered in it", async ({ page: browser }) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/om-butikken`);
  const footer = browser.locator(".site-footer");
  await expect(footer).toContainText("Vi brenner kaffe i Bergen.");
  await expect(footer.getByRole("heading", { name: "Man–fre 9–17" })).toBeVisible();
  await expect(footer.getByText("Tider")).toHaveCount(0);

  // A page's own heading takes its words from the store's field too, and the fallback words stay out of the page.
  await browser.goto(`/s/${slug}/no/bundet`);
  await expect(browser.getByRole("main").getByRole("heading", { name: "Man–fre 9–17" })).toBeVisible();
  await expect(browser.getByText("Reservetittel")).toHaveCount(0);
});

test("a customer's private field is on no page of the storefront", async ({ page: browser }) => {
  const { slug } = await arrange();
  for (const path of ["", "/om-butikken", "/bundet", "/products", "/cart", "/account", "/search?q=hemmelige"]) {
    await browser.goto(`/s/${slug}/no${path}`);
    await expect(browser.getByText("Kundens hemmelige notat")).toHaveCount(0);
    await expect(browser.getByText("Kundenotat")).toHaveCount(0);
    expect(await browser.content()).not.toContain("hemmelige notat");
  }
});
