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
 * A full category of `count` products in a store `testStore()` made (bloat review step 2.8): active copies of the demo tote bag (`full-1`, `full-2`, ...,
 * titled `Full 01`, ...) with its translations, variants, prices (through `commerce.set_price`) and pictures, as `manyProducts()` in
 * src/server/listing.int.test.ts makes them, all in a new category `full`. Returns the category's slug.
 */
export async function fullCategory(storeId: string, count = 48): Promise<{ slug: string }> {
  const sql = testDb();
  try {
    const cols = async (table: string) => {
      const [row] = await sql`
        select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as cols from information_schema.columns
        where table_schema = 'commerce' and table_name = ${table} and is_generated = 'NEVER' and identity_generation is null`;
      return String(row.cols);
    };
    const [products, translations, variants, media] = await Promise.all(["products", "product_translations", "product_variants", "product_media"].map(cols));
    await sql.begin(async (tx) => {
      await tx`create temp table full_src on commit drop as select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-handlenett'`;
      await tx`create temp table full_copies on commit drop as select gen_random_uuid() as id, n from generate_series(1, ${count}::int) n`;
      await tx.unsafe(`
        insert into commerce.products (${products}) select ${products} from (
          select (jsonb_populate_record(null::commerce.products, to_jsonb(p) || jsonb_build_object('id', c.id, 'handle', 'full-' || c.n, 'status', 'draft'))).*
          from commerce.products p, full_src s, full_copies c where p.id = s.id) x`);
      await tx.unsafe(`
        insert into commerce.product_translations (${translations}) select ${translations} from (
          select (jsonb_populate_record(null::commerce.product_translations, to_jsonb(t) || jsonb_build_object('product_id', c.id, 'title', 'Full ' || lpad(c.n::text, 2, '0')))).*
          from commerce.product_translations t, full_src s, full_copies c where t.product_id = s.id) x`);
      await tx`
        create temp table full_v on commit drop as
        select gen_random_uuid() as id, c.id as product_id, c.n, pv.id as old from commerce.product_variants pv, full_src s, full_copies c where pv.product_id = s.id`;
      await tx.unsafe(`
        insert into commerce.product_variants (${variants}) select ${variants} from (
          select (jsonb_populate_record(null::commerce.product_variants, to_jsonb(pv) || jsonb_build_object('id', v.id, 'product_id', v.product_id, 'sku', 'FULL-' || v.n || '-' || left(v.id::text, 6)))).*
          from commerce.product_variants pv join full_v v on v.old = pv.id) x`);
      await tx`select commerce.set_price(v.id, cp.market_code, cp.amount_minor) from full_v v join commerce.current_prices cp on cp.variant_id = v.old`;
      await tx.unsafe(`
        insert into commerce.product_media (${media}) select ${media} from (
          select (jsonb_populate_record(null::commerce.product_media, to_jsonb(i) || jsonb_build_object('id', gen_random_uuid(), 'product_id', c.id))).*
          from commerce.product_media i, full_src s, full_copies c where i.product_id = s.id) x`);
      await tx`update commerce.products set status = 'active' where store_id = ${storeId}::uuid and handle like 'full-%'`;
      const [term] = await tx`
        insert into commerce.terms (store_id, content_type, kind, name, slug)
        values (${storeId}, 'product', 'category', 'Full kategori', 'full') returning id`;
      await tx`
        insert into commerce.product_terms (store_id, product_id, term_id)
        select ${storeId}, c.id, ${term.id} from full_copies c`;
    });
    return { slug: "full" };
  } finally {
    await sql.end();
  }
}

/**
 * A theme's own content (D275): a published store template of a content pack (D257), as the platform keeps one, a copy of the template
 * (its catalogue and markets), marked as a store template and published under the pack's key. The theme store shows a theme only on its
 * own content, so a test links it to its theme with `linkTo()`. A template of that key the test did not make is set aside first, its
 * store's address too; give each spec file a key of its own, as they run side by side. `putAway()` unpublishes it, unlinks it and frees the
 * key after.
 */
export async function demoStoreOf(key: string): Promise<{ starter: string; store: string; linkTo: (presetId: string) => Promise<void>; putAway: () => Promise<void> }> {
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
    const once = async (write: (db: ReturnType<typeof testDb>) => Promise<unknown>) => {
      const db = testDb();
      try {
        await write(db);
      } finally {
        await db.end();
      }
    };
    const linkTo = (presetId: string) => once((db) => db`update commerce.store_starters set design_preset_id = ${presetId} where id = ${starter}`);
    const putAway = () =>
      once((db) => db`update commerce.store_starters set published = false, design_preset_id = null, pack_key = pack_key || '-x-' || ${run} where id = ${starter}`);
    return { starter: String(starter), store: String(store), linkTo, putAway };
  } finally {
    await sql.end();
  }
}
