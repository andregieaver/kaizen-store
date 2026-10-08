import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Custom fields, phase 3 (D120): a repeater's rows drawn by a field loop block
 * on a page as cards (one link per card, the title or the whole card), and a
 * content grid of products showing custom fields under each tile's title.
 */

const ids = {
  benefits: "f_benefits0001",
  title: "f_benefitname1",
  text: "f_benefittext1",
  picture: "f_benefitpict1",
  more: "f_benefitlink1",
  material: "f_tilematerial1",
  weight: "f_tileweight001",
  secret: "f_tilesecret001",
};
const rowA = "r_benefitaaa1";
const rowB = "r_benefitbbb2";

const page = (slug: string, blocks: unknown[]) => ({
  title: "Fordeler",
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

const loop = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "fieldLoop",
  fieldId: ids.benefits,
  layout: "cards",
  columns: 2,
  slots: { image: ids.picture, title: ids.title, text: ids.text, link: ids.more },
  ...extra,
});

const grid = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "contentGrid",
  source: { type: "products" },
  categories: [],
  tags: [],
  sort: "newest",
  limit: 48,
  columns: { mobile: 1, tablet: 2, desktop: 3 },
  show: { image: true, heading: true, excerpt: false, price: false, button: false },
  buttonLabel: "",
  emptyText: "",
  headingLevel: 3,
  excerptLines: 3,
  gap: 24,
  ...extra,
});

async function arrange() {
  const slug = `loop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Sløyfebutikk') returning id`;
    const [{ id }] =
      await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Sløyfebutikk', null) as id`;
    // Sweden is a country of its own (D178: Several countries on), in Swedish.
    await sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'], features = features || array['countries'] where id = ${id}`;
    const field = (
      fieldId: string,
      name: string,
      label: string,
      type: string,
      extra: Record<string, unknown> = {},
    ) => ({ id: fieldId, name, label, type, access: "public", ...extra });
    const group = (name: string, groupSlug: string, entities: string[], fields: unknown[], sort: number) =>
      sql`insert into commerce.field_groups (store_id, name, slug, entities, location, fields, sort)
        values (${id}, ${name}, ${groupSlug}, ${sql.json(entities as never)}, '[]'::jsonb, ${sql.json(fields as never)}, ${sort})`;
    const put = (entity: string, entityId: unknown, locale: string, values: Record<string, unknown>) =>
      sql`insert into commerce.field_values (store_id, entity, entity_id, locale, values) values (${id}, ${entity}, ${entityId as string}, ${locale}, ${sql.json(values as never)})`;
    const publish = async (pageSlug: string, blocks: unknown[]) => {
      const content = page(pageSlug, blocks);
      const [row] = await sql`
        insert into commerce.pages (store_id, slug, draft, published, published_at)
        values (${id}, ${pageSlug}, ${sql.json(content as never)}, ${sql.json(content as never)}, now()) returning id`;
      return row.id as string;
    };

    // A page's repeater of benefits: a picture (the same in every language), a title, a text and a link (per language).
    await group(
      "Fordeler",
      "benefits",
      ["page"],
      [
        field(ids.benefits, "benefits", "Fordeler", "repeater", {
          subFields: [
            field(ids.title, "title", "Tittel", "text"),
            field(ids.text, "text", "Tekst", "textarea"),
            field(ids.picture, "picture", "Bilde", "image"),
            field(ids.more, "more", "Lenke", "link"),
          ],
        }),
      ],
      0,
    );
    const cards = await publish("fordeler", [loop("loop-title", { heading: "Våre fordeler" })]);
    const whole = await publish("hele-kortet", [loop("loop-whole", { linkWholeCard: true })]);
    const empty = await publish("ingen-rader", [loop("loop-empty")]);
    for (const pageId of [cards, whole]) {
      await put("page", pageId, "", {
        [ids.benefits]: [
          { id: rowA, [ids.picture]: { url: "https://images.example/rask.webp", thumbnailUrl: null, alt: "Pakke" } },
          { id: rowB },
        ],
      });
      await put("page", pageId, "nb-NO", {
        [ids.benefits]: {
          [rowA]: {
            [ids.title]: "Rask levering",
            [ids.text]: "Hjemme hos deg på to dager.",
            [ids.more]: { kind: "url", ref: "https://example.com/levering", label: "Om levering", newTab: false },
          },
          [rowB]: { [ids.title]: "Trygg betaling", [ids.text]: "Betal med kort." },
        },
      });
      await put("page", pageId, "sv-SE", { [ids.benefits]: { [rowA]: { [ids.title]: "Snabb leverans" } } });
    }

    // Fields on the tiles of a grid of products: two shown, one private, on two of the demo products.
    await group(
      "Egenskaper",
      "traits",
      ["product"],
      [
        field(ids.material, "material", "Materiale", "text"),
        field(ids.weight, "weight", "Vekt", "number", { unit: "g" }),
        field(ids.secret, "secret", "Internt", "text", { access: "private" }),
      ],
      1,
    );
    const [bag] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-handlenett'`;
    const [book] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-notatbok'`;
    await put("product", bag.id, "", { [ids.weight]: 250 });
    await put("product", bag.id, "nb-NO", { [ids.material]: "Bomull", [ids.secret]: "hemmelig" });
    await put("product", book.id, "nb-NO", { [ids.material]: "Papir" });
    await publish("med-felt", [grid("tiles", { tileFields: [ids.material, ids.weight, ids.secret] })]);
    await publish("uten-felt", [grid("plain")]);
    return { slug, empty };
  } finally {
    await sql.end();
  }
}

test("a field loop draws each row as a card, the title being the link, in the shopper's language", async ({
  page: browser,
}) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/fordeler`);
  await expect(browser.getByRole("heading", { name: "Våre fordeler" })).toBeVisible();
  const cards = browser.locator("[data-field-loop=cards] > ul > li");
  await expect(cards).toHaveCount(2);
  const first = cards.filter({ hasText: "Rask levering" });
  await expect(first).toContainText("Hjemme hos deg på to dager.");
  await expect(first.getByRole("link", { name: "Rask levering" })).toHaveAttribute(
    "href",
    "https://example.com/levering",
  );
  await expect(first.locator("img")).toHaveAttribute("src", "https://images.example/rask.webp");
  await expect(first.locator("img")).toHaveAttribute("alt", "Pakke");
  // A row without a link or a picture is a card of words alone.
  const second = cards.filter({ hasText: "Trygg betaling" });
  await expect(second).toContainText("Betal med kort.");
  await expect(second.getByRole("link")).toHaveCount(0);
  await expect(second.locator("img")).toHaveCount(0);

  // In Swedish a row with a Swedish title shows it; the other row has nothing in Swedish but its main language.
  await browser.goto(`/s/${slug}/se/fordeler`);
  await expect(browser.getByText("Snabb leverans")).toBeVisible();
  await expect(browser.getByText("Trygg betaling")).toBeVisible();
});

test("a loop with the whole card as the link has one link in each card, over the whole card", async ({
  page: browser,
}) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/hele-kortet`);
  const card = browser.locator("[data-field-loop=cards] > ul > li").filter({ hasText: "Rask levering" });
  await expect(card.getByRole("link")).toHaveCount(1);
  await expect(card.getByRole("link")).toHaveAttribute("href", "https://example.com/levering");
  // The link is stretched over the card (one anchor, no link in a link): its ::after covers the card.
  const covers = await card.getByRole("link").evaluate((el) => getComputedStyle(el, "::after").position);
  expect(covers).toBe("absolute");
});

test("a loop over a page with no rows draws nothing", async ({ page: browser }) => {
  const { slug, empty } = await arrange();
  expect(empty).toBeTruthy();
  await browser.goto(`/s/${slug}/no/ingen-rader`);
  await expect(browser.locator("[data-field-loop]")).toHaveCount(0);
});

test("a grid of products shows the chosen fields under each title, and not the private ones", async ({
  page: browser,
}) => {
  const { slug } = await arrange();
  await browser.goto(`/s/${slug}/no/med-felt`);
  const bag = browser.getByRole("main").getByRole("listitem").filter({ hasText: "Handlenett" }).first();
  await expect(bag).toContainText("Materiale: Bomull");
  await expect(bag).toContainText(/Vekt: 250 g/);
  await expect(bag).not.toContainText("hemmelig");
  const book = browser.getByRole("main").getByRole("listitem").filter({ hasText: "Notatbok" }).first();
  await expect(book).toContainText("Materiale: Papir");
  await expect(book).not.toContainText("Vekt:");
  await expect(browser.getByText("hemmelig")).toHaveCount(0);

  // The same grid without fields chosen is as it was.
  await browser.goto(`/s/${slug}/no/uten-felt`);
  await expect(browser.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
  await expect(browser.getByText("Materiale:")).toHaveCount(0);
});
