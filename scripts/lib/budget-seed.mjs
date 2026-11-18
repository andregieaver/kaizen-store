// A large store for scripts/server-budget.mjs (bloat review step 1.11): one open store with 500 active products, made the way an approval
// makes one. Prices go through commerce.set_price only (CLAUDE.md). It does nothing when the store already exists.
import postgres from "postgres";

/**
 * Returns { slug, handle, breaksHandle, schemesHandle }: the store's slug, one product's handle, and the handles of a product with a price break
 * and of one under a producer scheme (step 2.13; made on every run, whether or not the store existed). The store's first market has no path segment: its pages are /s/<slug> and /s/<slug>/p/<handle>. */
export async function seedLargeStore(url, { slug = "budget-500", products = 500 } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const handle = "budget-p-0250";
    let [existing] = await sql`select id from commerce.stores where slug = ${slug}`;
    if (!existing) {
      const email = `${slug}@example.com`;
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${email}, ${slug}, ${slug}) returning id`;
      [existing] = await sql`select commerce.approve_access_request(${request.id}::uuid, ${slug}, ${slug}, null) as id`;
      await sql`update commerce.stores set setup_completed_at = now(), status = 'active', private_mode = false where id = ${existing.id}::uuid`;
    }
    const storeId = existing.id;
    const [done] = await sql`select 1 as x from commerce.products where store_id = ${storeId}::uuid and handle = ${handle}`;
    if (done) return { slug, handle, ...(await extras(sql, storeId)) };
    // The people a product names (maker, responsible person) are the store's own rows, made with its copy of the demo catalogue.
    const [model] = await sql`
      select manufacturer_id, responsible_person_id, tax_code from commerce.products
      where store_id = ${storeId}::uuid and handle not like 'budget-p-%' and manufacturer_id is not null and responsible_person_id is not null order by created_at limit 1`;
    const [place] = await sql`select id from commerce.inventory_locations where store_id = ${storeId}::uuid order by created_at limit 1`;
    await sql.begin(async (tx) => {
      await tx`
        insert into commerce.products (store_id, handle, manufacturer_id, responsible_person_id, tax_code)
        select ${storeId}::uuid, 'budget-p-' || lpad(n::text, 4, '0'), ${model.manufacturer_id}, ${model.responsible_person_id}, ${model.tax_code}
        from generate_series(1, ${products}) n`;
      await tx`
        insert into commerce.product_translations (store_id, product_id, locale, title, description)
        select p.store_id, p.id, 'nb-NO', 'Budsjett ' || p.handle, 'En vare i den store butikken.'
        from commerce.products p where p.store_id = ${storeId}::uuid and p.handle like 'budget-p-%'`;
      await tx`
        insert into commerce.product_media (store_id, product_id, url, position, alt)
        select p.store_id, p.id, '/demo/mug.svg', 0, '{}'::jsonb
        from commerce.products p where p.store_id = ${storeId}::uuid and p.handle like 'budget-p-%'`;
      await tx`
        insert into commerce.product_variants (store_id, product_id, sku, options)
        select p.store_id, p.id, upper(p.handle), '{}'::jsonb
        from commerce.products p where p.store_id = ${storeId}::uuid and p.handle like 'budget-p-%'`;
      // A price in every market of the store, so the product shows whichever market a visitor lands in.
      await tx`
        select commerce.set_price(v.id, m.code, 19900)
        from commerce.product_variants v join commerce.markets m on m.store_id = v.store_id
        where v.store_id = ${storeId}::uuid and v.sku like 'BUDGET-P-%'
          and not exists (select 1 from commerce.prices pr where pr.variant_id = v.id and pr.market_code = m.code and pr.valid_to is null)`;
      await tx`
        insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
        select v.store_id, v.id, ${place.id}::uuid, 5
        from commerce.product_variants v where v.store_id = ${storeId}::uuid and v.sku like 'BUDGET-P-%'`;
      await tx`update commerce.products set status = 'active' where store_id = ${storeId}::uuid and handle like 'budget-p-%'`;
    });
    return { slug, handle, ...(await extras(sql, storeId)) };
  } finally {
    await sql.end();
  }
}

/** One price break on the store's first product and one producer scheme on its second (no registration is needed: the page still runs the schemes read, which is what is counted). */
async function extras(sql, storeId) {
  const [first, second] = await sql`select id, handle from commerce.products where store_id = ${storeId}::uuid and handle like 'budget-p-%' order by handle limit 2`;
  await sql`
    insert into commerce.price_breaks (store_id, product_id, from_quantity, percent)
    select p.store_id, p.id, 10, 5 from commerce.products p where p.store_id = ${storeId}::uuid and p.id = ${first.id}::uuid
    on conflict do nothing`;
  await sql`insert into commerce.product_schemes (store_id, product_id, scheme) values (${storeId}::uuid, ${second.id}::uuid, 'packaging') on conflict do nothing`;
  return { breaksHandle: first.handle, schemesHandle: second.handle };
}
