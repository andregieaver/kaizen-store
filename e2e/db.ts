import postgres from "postgres";

/** Direct database access for arranging test data (e.g. approving a request). */
export function testDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for the end-to-end tests");
  return postgres(url, { max: 1, onnotice: () => {} });
}

/**
 * A new store (approved as the platform does) with one published page at
 * `/s/{slug}/no/{page}` made of the given components, one row each, for
 * testing components as the site shows them. Returns the page's address.
 */
export async function storePageWith(name: string, blocks: postgres.JSONValue[], page = "side"): Promise<string> {
  const slug = `${name}-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Testbutikk', null) as id`;
    const content: postgres.JSONValue = {
      title: "Side",
      slug: page,
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: blocks.map((block, index) => ({
        id: `row-${index}`,
        type: "row",
        layout: "1",
        columns: [{ id: `column-${index}`, blocks: [block] }],
      })),
    };
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, ${page}, ${sql.json(content)}, ${sql.json(content)}, now())`;
  } finally {
    await sql.end();
  }
  return `/s/${slug}/no/${page}`;
}

/**
 * A new store (approved as the platform does) with the template's demo catalogue, its categories and its markets, and no page of its own: nothing about it is
 * cached before the test's first request, so a test can change its rows with SQL first. Returns its slug and id.
 */
export async function testStore(name: string): Promise<{ slug: string; id: string }> {
  const slug = `${name}-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Testbutikk', null) as id`;
    return { slug, id };
  } finally {
    await sql.end();
  }
}
