import postgres from "postgres";

/** Direct database access for arranging test data (e.g. approving a request). */
export function testDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for the end-to-end tests");
  return postgres(url, { max: 1, onnotice: () => {} });
}

/**
 * A new store (approved as the platform does) with one published page at
 * `/s/{slug}/{page}` made of the given components, one row each, for
 * testing components as the site shows them. Returns the page's address: a
 * new store sells in its own country alone, so it has no country in its
 * addresses (D181; `/s/{slug}/no/{page}` moves there).
 */
export async function storePageWith(name: string, blocks: postgres.JSONValue[], page = "side"): Promise<string> {
  return storePageRows(
    name,
    blocks.map((block, index) => ({ id: `row-${index}`, type: "row", layout: "1", columns: [{ id: `column-${index}`, blocks: [block] }] })),
    page,
  );
}

/** As `storePageWith()`, with the page's rows as given (a row's own settings, such as its background). */
export async function storePageRows(name: string, rows: postgres.JSONValue[], page = "side"): Promise<string> {
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
      rows,
    };
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, ${page}, ${sql.json(content)}, ${sql.json(content)}, now())`;
  } finally {
    await sql.end();
  }
  return `/s/${slug}/${page}`;
}

/**
 * A new store (approved as the platform does) with the template's demo catalogue, its categories and its markets, and no page of its own: nothing about it is
 * cached before the test's first request, so a test can change its rows with SQL first. Returns its slug and id. `features` are switched on besides the
 * shop (D178), such as `countries` for a test in another country than Norway.
 */
export async function testStore(name: string, features: string[] = []): Promise<{ slug: string; id: string }> {
  const slug = `${name}-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Testbutikk', null) as id`;
    // A new store starts with the shop alone (D178); a test that needs more switches it on here, before anything of the store is cached.
    if (features.length > 0) await sql`update commerce.stores set features = features || ${features}::text[] where id = ${id}`;
    return { slug, id };
  } finally {
    await sql.end();
  }
}

/**
 * A published demo store of a content pack (D257), as the platform keeps one: a copy of the template (its catalogue and markets), marked as
 * a store template and published under the pack's key. The theme store shows only looks on one (D274), so a test's theme names `key` in its
 * listing. A demo store of that key the test did not make is set aside first, its store's address too; give each spec file a key of its
 * own, as they run side by side. `putAway()` unpublishes it and frees the key after.
 */
export async function demoStoreOf(key: string): Promise<{ starter: string; store: string; putAway: () => Promise<void> }> {
  const run = Date.now().toString(36);
  const sql = testDb();
  try {
    await sql`
      update commerce.stores s set slug = left(s.slug, 20) || '-' || ${run}
        from commerce.store_starters ss where ss.store_id = s.id and ss.pack_key = ${key}`;
    await sql`update commerce.store_starters set published = false, pack_key = pack_key || '-' || ${run} where pack_key = ${key}`;
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`demo-${key}-${run}@example.com`}, 'Platform', 'Demo') returning id`;
    const [{ id: store }] = await sql`select commerce.approve_access_request(${request.id}, ${`demo-${key}-${run}`}, 'Demo', null) as id`;
    await sql`update commerce.stores set starter = true where id = ${store}`;
    const [{ id: starter }] = await sql`
      insert into commerce.store_starters (store_id, title, category, pack_key, pack_version, published)
      values (${store}, ${`Demo ${key}`}, 'retail', ${key}, 1, true) returning id`;
    const putAway = async () => {
      const db = testDb();
      try {
        await db`update commerce.store_starters set published = false, pack_key = pack_key || '-x-' || ${run} where id = ${starter}`;
      } finally {
        await db.end();
      }
    };
    return { starter: String(starter), store: String(store), putAway };
  } finally {
    await sql.end();
  }
}
