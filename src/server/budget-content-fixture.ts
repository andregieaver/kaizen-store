import { sql } from "drizzle-orm";

import { db } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * Rows for the stores of the budgets that count per store (bloat review step 1.10, `budget-seed-test-support.ts`), imported by tests only.
 * Pages and products copied from the demo store's own rows (its page 'om-oss' and its product 'demo-bordlampe', with that product's
 * manufacturer, responsible person and picture), so every column a page or an active product needs is filled as the demo's is.
 */
export async function seedContent(storeId: string, pages: number, products: number): Promise<void> {
  const demo = sql`(select id from commerce.stores where slug = 'demo')`;
  const lamp = sql`(select * from commerce.products where store_id = ${demo} and handle = 'demo-bordlampe')`;
  await db().execute(sql`
    insert into commerce.pages (store_id, slug, draft, published, published_at, first_published_at, type)
    select ${storeId}::uuid, 'page-' || g, p.draft, p.published, now(), now(), 'page'
    from generate_series(1, ${pages}) g, (select draft, published from commerce.pages where store_id = ${demo} and slug = 'om-oss') p
  `);
  // The lamp's manufacturer and responsible person, as the store's own (an active physical product needs both, D24, D452).
  const [operators] = await db().execute<Row>(sql`
    with lamp as (select manufacturer_id, responsible_person_id from ${lamp} l),
    made as (
      insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
      select ${storeId}::uuid, o.name, o.postal_address, o.electronic_address, o.country
      from commerce.economic_operators o, lamp where o.id in (lamp.manufacturer_id, lamp.responsible_person_id)
      order by o.id = lamp.manufacturer_id desc
      returning id
    )
    select (array_agg(id))[1] as manufacturer, (array_agg(id))[2] as responsible from made
  `);
  await db().execute(sql`
    insert into commerce.products (store_id, handle, status, tax_code, withdrawal_exclusion, delivery, subscription_only, audience, vat_category, kind)
    select ${storeId}::uuid, 'product-' || g, 'draft', p.tax_code, p.withdrawal_exclusion, p.delivery, p.subscription_only, p.audience, p.vat_category, p.kind
    from generate_series(1, ${products}) g, ${lamp} p
  `);
  await db().execute(sql`
    insert into commerce.product_translations (store_id, product_id, locale, title, description)
    select p.store_id, p.id, m.default_locale, 'Product ' || substr(p.handle, 9), 'A product to count with.'
    from commerce.products p join commerce.markets m on m.store_id = p.store_id
    where p.store_id = ${storeId}::uuid and p.handle like 'product-%'
    on conflict do nothing
  `);
  await db().execute(sql`
    insert into commerce.product_variants (store_id, product_id, sku, options, delivery, stock_policy, backorder_days)
    select p.store_id, p.id, upper(p.handle), '{}'::jsonb, p.delivery, 'continue', 7 from commerce.products p
    where p.store_id = ${storeId}::uuid and p.handle like 'product-%'
  `);
  await db().execute(sql`
    insert into commerce.product_media (store_id, product_id, url)
    select p.store_id, p.id, m.url from commerce.products p,
      (select url from commerce.product_media where product_id = (select id from ${lamp} l) order by position limit 1) m
    where p.store_id = ${storeId}::uuid and p.handle like 'product-%'
  `);
  await db().execute(sql`
    select commerce.set_price(v.id, m.code, 19900)
    from commerce.product_variants v
    join lateral (select code from commerce.markets where store_id = v.store_id order by created_at, code limit 1) m on true
    where v.store_id = ${storeId}::uuid and v.sku like 'PRODUCT-%'
  `);
  await db().execute(sql`
    update commerce.products set status = 'active', manufacturer_id = ${operators.manufacturer as string}::uuid,
      responsible_person_id = ${operators.responsible as string}::uuid
    where store_id = ${storeId}::uuid and handle like 'product-%'
  `);
}

