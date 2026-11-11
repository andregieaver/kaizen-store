import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { passportInput, publishProblem, readPassport, type Passport } from "@/lib/product-passport";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { log } from "./log";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { col, typedRow } from "./typed-rows";

/**
 * Digital Product Passports (D554, `src/lib/product-passport.ts`): a product's passport saved and published by staff who may change products,
 * and read by anyone at its stable address once published. The only writer of `commerce.product_passports`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PassportForEdit = { id: string | null; data: Passport; publishedAt: string | null; title: string; status: string };

/** A product's passport for its editor (an empty one when it has none yet), or null for a product not in the store. */
export async function passportForEdit(storeId: string, productId: string): Promise<PassportForEdit | null> {
  if (!UUID.test(productId)) return null;
  const row = await typedRow(
    z.object({ status: col.text, title: col.textOrNull, id: col.textOrNull, data: z.unknown(), published_at: col.timestampOrNull }),
    sql`select p.status, (select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id order by t.locale limit 1) as title,
               pp.id::text as id, pp.data, pp.published_at
        from commerce.products p left join commerce.product_passports pp on pp.store_id = p.store_id and pp.product_id = p.id
        where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid`,
  );
  if (!row) return null;
  return { id: row.id, data: readPassport(row.data), publishedAt: row.published_at, title: row.title ?? "", status: row.status };
}

export type PassportSave = { ok: true; id: string; published: boolean } | { ok: false; problem: string };

/** The tag of one passport's public read (D562): refreshed when it is saved, so a draft read before publishing is not kept as missing. */
const passportTag = (id: string) => `passport:${id}`;

/**
 * Saves a product's passport, and publishes it (`publish: true`) or keeps it a draft (`false`). Publishing needs something to show
 * (`publishProblem()`); the address stays the same for the passport's life. `products:write`; audited.
 */
export async function savePassport(member: Membership, productId: string, raw: unknown, publish: boolean): Promise<PassportSave> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  if (!UUID.test(productId)) return { ok: false, problem: "This product is not in this store." };
  const parsed = passportInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the passport." };
  if (publish) {
    const problem = publishProblem(parsed.data);
    if (problem) return { ok: false, problem };
  }
  const storeId = member.store.id;
  const row = await typedRow(
    z.object({ id: col.uuid, published: col.bool }),
    sql`insert into commerce.product_passports (store_id, product_id, data, published_at, updated_by)
        select ${storeId}::uuid, p.id, ${JSON.stringify(parsed.data)}::jsonb, case when ${publish} then now() end, ${member.account.id}::uuid
        from commerce.products p where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid
        on conflict (store_id, product_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now(),
          published_at = case when ${publish} then coalesce(commerce.product_passports.published_at, now()) else null end
        returning id, published_at is not null as published`,
  );
  if (!row) return { ok: false, problem: "This product is not in this store." };
  // The product page links a published passport (its detail is cached under the catalogue's tag).
  refreshTag(catalogTag(storeId));
  refreshTag(passportTag(row.id));
  await audit(member.account.id, storeId, publish ? "products.passport_published" : "products.passport_saved", { materials: parsed.data.materials.length }, { area: "products", target: { type: "product", id: productId } }).catch(
    (error) => log("error", "passports.save_audit_failed", {}, error),
  );
  return { ok: true, id: row.id, published: row.published };
}

export type PublicPassport = {
  id: string;
  updatedAt: string;
  storeName: string;
  storeAddress: string;
  lang: string;
  title: string;
  identifiers: { sku: string | null; gtin: string | null }[];
  manufacturer: { name: string; address: string; contact: string } | null;
  responsible: { name: string; address: string; contact: string } | null;
  passport: Passport;
};

const operator = z.object({ name: col.text, postal_address: col.textOrNull, electronic_address: col.textOrNull }).nullable();

/**
 * A published passport, as anyone reads it at its address; null for one that is not published (or not there). Cached (D562), so its page can answer a
 * real 404 before it streams: under the passport's own tag and its store's catalogue tag (a product's title, variants and economic operators change
 * with it), for hours at most. Only a well-formed id reaches the cache.
 */
export async function publicPassport(id: string): Promise<PublicPassport | null> {
  if (!UUID.test(id)) return null;
  return cachedPassport(id.toLowerCase());
}

async function cachedPassport(id: string): Promise<PublicPassport | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(passportTag(id));
  const found = await readPublicPassport(id);
  if (found) cacheTag(catalogTag(found.storeId));
  return found ? found.passport : null;
}

async function readPublicPassport(id: string): Promise<{ storeId: string; passport: PublicPassport } | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      store_id: col.uuid,
      updated_at: col.timestamp,
      data: z.unknown(),
      store_name: col.text,
      store_address: col.textOrNull,
      locale: col.textOrNull,
      title: col.textOrNull,
      identifiers: z.array(z.object({ sku: z.string().nullable(), gtin: z.string().nullable() })).nullable(),
      manufacturer: operator,
      responsible: operator,
    }),
    sql`select pp.id, pp.store_id, pp.updated_at, pp.data, coalesce(nullif(st.legal_name, ''), st.name) as store_name, st.postal_address as store_address,
               m.default_locale as locale,
               coalesce((select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id and t.locale = m.default_locale),
                        (select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id order by t.locale limit 1)) as title,
               (select jsonb_agg(jsonb_build_object('sku', v.sku, 'gtin', v.gtin) order by v.sku) from commerce.product_variants v
                 where v.store_id = p.store_id and v.product_id = p.id and v.active) as identifiers,
               (select to_jsonb(e) - 'id' - 'store_id' - 'created_at' - 'country' from commerce.economic_operators e where e.store_id = p.store_id and e.id = p.manufacturer_id) as manufacturer,
               (select to_jsonb(e) - 'id' - 'store_id' - 'created_at' - 'country' from commerce.economic_operators e where e.store_id = p.store_id and e.id = p.responsible_person_id) as responsible
        from commerce.product_passports pp
        join commerce.products p on p.store_id = pp.store_id and p.id = pp.product_id
        join commerce.stores st on st.id = pp.store_id and st.status = 'active' and not st.sandbox
        left join lateral (select mk.default_locale from commerce.markets mk where mk.store_id = st.id and mk.active order by mk.created_at, mk.code limit 1) m on true
        where pp.id = ${id}::uuid and pp.published_at is not null`,
  );
  if (!row) return null;
  const who = (o: z.output<typeof operator>) => (o ? { name: o.name, address: o.postal_address ?? "", contact: o.electronic_address ?? "" } : null);
  const passport: PublicPassport = {
    id: row.id,
    updatedAt: row.updated_at,
    storeName: row.store_name,
    storeAddress: row.store_address ?? "",
    lang: (row.locale ?? "en").split("-")[0],
    title: row.title ?? "",
    identifiers: row.identifiers ?? [],
    manufacturer: who(row.manufacturer),
    responsible: who(row.responsible),
    passport: readPassport(row.data),
  };
  return { storeId: row.store_id, passport };
}

/** A published passport's address for a product, for the product page's link; null when it has none. */
export async function publishedPassportId(storeId: string, productId: string): Promise<string | null> {
  if (!UUID.test(productId)) return null;
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.product_passports where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and published_at is not null`,
  );
  return row?.id ?? null;
}
