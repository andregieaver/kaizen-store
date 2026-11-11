import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Combined listings (D566, `docs/combined-listings.md`): separate products shown as one, chosen between by a shared option. The only writer
 * of `product_groups` and of the products' group columns. The option's name and each product's value are kept in the store's main language
 * (`{ locale: words }`, so other languages can follow). A group of fewer than two products is dissolved. `products:write`; audited.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const SWATCH = /^#[0-9a-f]{6}$/;

export type GroupMember = { id: string; handle: string; title: string; value: string; swatch: string | null; status: string };
export type ProductGroup = { id: string; option: string; members: GroupMember[] };

const mainLocale = (member: Membership) => member.store.localization.locales[0] ?? "en";

const words = (value: unknown, locale: string): string => {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  const own = v[locale];
  if (typeof own === "string" && own) return own;
  const first = Object.values(v).find((x) => typeof x === "string" && x);
  return typeof first === "string" ? first : "";
};

/** Whether `productId` is one of the store's products (its listing page opens only for those). */
export async function isStoreProduct(storeId: string, productId: string): Promise<boolean> {
  if (!UUID.test(productId)) return false;
  const row = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.products where store_id = ${storeId}::uuid and id = ${productId}::uuid`);
  return Boolean(row);
}

/** The combined listing a product is in, with its members in their order, or null. */
export async function groupOfProduct(storeId: string, productId: string, locale: string): Promise<ProductGroup | null> {
  if (!UUID.test(productId)) return null;
  const group = await typedRow(
    z.object({ id: col.uuid, option: z.unknown() }),
    sql`select g.id, g.option from commerce.product_groups g join commerce.products p on p.store_id = g.store_id and p.group_id = g.id
        where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid`,
  );
  if (!group) return null;
  const members = await typedRows(
    z.object({ id: col.uuid, handle: col.text, title: col.textOrNull, group_value: z.unknown(), group_swatch: col.textOrNull, status: col.text }),
    sql`select p.id, p.handle, p.group_value, p.group_swatch, p.status,
          coalesce((select t.title from commerce.product_translations t where t.product_id = p.id and t.locale = ${locale}),
                   (select t.title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1)) as title
        from commerce.products p where p.store_id = ${storeId}::uuid and p.group_id = ${group.id}::uuid
        order by p.group_position, p.handle`,
  );
  return {
    id: group.id,
    option: words(group.option, locale),
    members: members.map((m) => ({ id: m.id, handle: m.handle, title: m.title ?? m.handle, value: words(m.group_value, locale), swatch: m.group_swatch, status: m.status })),
  };
}

/** The store's products that may join a listing: in none yet, not archived, not this one; by title, at most 300. */
export async function groupCandidates(storeId: string, productId: string, locale: string): Promise<{ id: string; title: string; handle: string }[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, handle: col.text, title: col.textOrNull }),
    sql`select p.id, p.handle,
          coalesce((select t.title from commerce.product_translations t where t.product_id = p.id and t.locale = ${locale}),
                   (select t.title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1)) as title
        from commerce.products p
        where p.store_id = ${storeId}::uuid and p.group_id is null and p.status <> 'archived' and p.id <> ${productId}::uuid
        order by 3 nulls last, p.handle limit 300`,
  );
  return rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title ?? r.handle }));
}

export type GroupResult = { ok: true } | { ok: false; problem: string };

const text = (max: number, empty: string) => z.string().trim().min(1, empty).max(max, `At most ${max} characters.`);
const swatch = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim().toLowerCase())
  .refine((v) => v === "" || SWATCH.test(v), "A colour is written as # and six hex digits, like #1d4ed8.")
  .transform((v) => v || null);

const memberInput = z.object({ value: text(60, "Write this product's value, for example Red."), swatch });
const startInput = memberInput.extend({ option: text(40, "Name what tells them apart, for example Colour.") });

const done = (member: Membership) => refreshTag(catalogTag(member.store.id));

/** Starts a listing from a product: the option's name and the product's own value. */
export async function startGroup(member: Membership, productId: string, raw: unknown): Promise<GroupResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = startInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the listing." };
  if (!UUID.test(productId)) return { ok: false, problem: "This product is not in this store." };
  const locale = mainLocale(member);
  const made = await db().transaction(async (tx) => {
    const product = await typedRow(
      z.object({ id: col.uuid, group_id: col.textOrNull }),
      sql`select id, group_id::text from commerce.products where store_id = ${member.store.id}::uuid and id = ${productId}::uuid for update`,
      tx,
    );
    if (!product) return "This product is not in this store.";
    if (product.group_id) return "This product is in a listing already.";
    const group = await typedRow(
      z.object({ id: col.uuid }),
      sql`insert into commerce.product_groups (store_id, option) values (${member.store.id}::uuid, ${JSON.stringify({ [locale]: parsed.data.option })}::jsonb) returning id`,
      tx,
    );
    await tx.execute(sql`
      update commerce.products set group_id = ${group!.id}::uuid, group_value = ${JSON.stringify({ [locale]: parsed.data.value })}::jsonb,
        group_swatch = ${parsed.data.swatch}, group_position = 0, updated_at = now()
      where store_id = ${member.store.id}::uuid and id = ${productId}::uuid
    `);
    return null;
  });
  if (made) return { ok: false, problem: made };
  done(member);
  await audit(member.account.id, member.store.id, "products.group_started", {}, { area: "products", target: { type: "product", id: productId } });
  return { ok: true };
}

/** Adds another product to the listing `productId` is in, with its own value. */
export async function addToGroup(member: Membership, productId: string, otherId: string, raw: unknown): Promise<GroupResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = memberInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the product's value." };
  if (!UUID.test(productId) || !UUID.test(otherId)) return { ok: false, problem: "Choose a product of this store." };
  const locale = mainLocale(member);
  const rows = await db().execute(sql`
    update commerce.products o set group_id = p.group_id, group_value = ${JSON.stringify({ [locale]: parsed.data.value })}::jsonb,
      group_swatch = ${parsed.data.swatch}, updated_at = now(),
      group_position = (select coalesce(max(q.group_position), 0) + 1 from commerce.products q where q.store_id = p.store_id and q.group_id = p.group_id)
    from commerce.products p
    where p.store_id = ${member.store.id}::uuid and p.id = ${productId}::uuid and p.group_id is not null
      and o.store_id = p.store_id and o.id = ${otherId}::uuid and o.group_id is null and o.status <> 'archived'
    returning o.id
  `);
  if (rows.length === 0) return { ok: false, problem: "That product cannot join: it is in another listing, archived, or not this store's." };
  done(member);
  await audit(member.account.id, member.store.id, "products.group_added", {}, { area: "products", target: { type: "product", id: otherId } });
  return { ok: true };
}

/** A member's own value and swatch changed. */
export async function updateGroupMember(member: Membership, productId: string, raw: unknown): Promise<GroupResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = memberInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the value." };
  if (!UUID.test(productId)) return { ok: false, problem: "This product is not in this store." };
  const locale = mainLocale(member);
  const rows = await db().execute(sql`
    update commerce.products set group_value = group_value || ${JSON.stringify({ [locale]: parsed.data.value })}::jsonb, group_swatch = ${parsed.data.swatch}, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${productId}::uuid and group_id is not null returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "This product is not in a listing." };
  done(member);
  return { ok: true };
}

/** The shared option's name changed. */
export async function renameGroupOption(member: Membership, productId: string, raw: unknown): Promise<GroupResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = z.object({ option: startInput.shape.option }).safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the name." };
  if (!UUID.test(productId)) return { ok: false, problem: "This product is not in this store." };
  const locale = mainLocale(member);
  const rows = await db().execute(sql`
    update commerce.product_groups g set option = g.option || ${JSON.stringify({ [locale]: parsed.data.option })}::jsonb, updated_at = now()
    from commerce.products p
    where p.store_id = ${member.store.id}::uuid and p.id = ${productId}::uuid and g.store_id = p.store_id and g.id = p.group_id
    returning g.id
  `);
  if (rows.length === 0) return { ok: false, problem: "This product is not in a listing." };
  done(member);
  return { ok: true };
}

/** A product leaves its listing; a listing left with fewer than two products is dissolved (the last one leaves too). */
export async function leaveGroup(member: Membership, productId: string): Promise<GroupResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  if (!UUID.test(productId)) return { ok: false, problem: "This product is not in this store." };
  const storeId = member.store.id;
  const left = await db().transaction(async (tx) => {
    const product = await typedRow(
      z.object({ group_id: col.textOrNull }),
      sql`select group_id::text from commerce.products where store_id = ${storeId}::uuid and id = ${productId}::uuid for update`,
      tx,
    );
    if (!product?.group_id) return false;
    const group = product.group_id;
    await tx.execute(sql`update commerce.products set group_id = null, group_value = '{}'::jsonb, group_swatch = null, group_position = 0, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${productId}::uuid`);
    const rest = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.products where store_id = ${storeId}::uuid and group_id = ${group}::uuid`, tx);
    if ((rest?.n ?? 0) < 2) {
      await tx.execute(sql`update commerce.products set group_id = null, group_value = '{}'::jsonb, group_swatch = null, group_position = 0, updated_at = now()
        where store_id = ${storeId}::uuid and group_id = ${group}::uuid`);
      await tx.execute(sql`delete from commerce.product_groups where store_id = ${storeId}::uuid and id = ${group}::uuid`);
    }
    return true;
  });
  if (!left) return { ok: false, problem: "This product is not in a listing." };
  done(member);
  await audit(member.account.id, storeId, "products.group_left", {}, { area: "products", target: { type: "product", id: productId } });
  return { ok: true };
}
