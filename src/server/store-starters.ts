import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { storeBase, storeHref } from "@/lib/paths";
import { slugProblem } from "@/lib/slug";
import {
  isStarterCategory,
  movedOrder,
  standardCard,
  starterRefusal,
  type OfferedStarter,
  type StarterCard,
  type StarterCategory,
  type StarterDetails,
  type StarterRow,
} from "@/lib/store-starters";

import { audit, type Account } from "./auth";
import { templateStoreSlug } from "./stores";

/**
 * Store templates (D175, `docs/store-templates.md`): the platform's starting points for new stores. Each is a real store marked
 * `starter`, made from the default template by `clone_store()`, and described by a row of `commerce.store_starters`. Platform admins make
 * and keep them here; owners and the sign-up form only read the published ones (`listOfferedStarters()`), and what a new store is copied
 * from is decided in SQL (`commerce.starter_source()`), never here.
 */

type Row = Record<string, unknown>;

/** The cache tag of what owners and the sign-up page are offered: every change to a template's details, order or publishing updates it. */
export const STARTERS_TAG = "store-starters";

export type StarterResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; problems: string[] };

const toOffered = (row: Row): OfferedStarter => ({
  id: String(row.id),
  title: String(row.title),
  summary: String(row.summary ?? ""),
  description: String(row.description ?? ""),
  category: (isStarterCategory(row.category) ? row.category : "other") as StarterCategory,
  pictureUrl: row.picture_url ? String(row.picture_url) : null,
  storeSlug: String(row.slug),
});

/** The published store templates, in the platform's order: what owners and the sign-up form are offered. */
export async function listOfferedStarters(): Promise<OfferedStarter[]> {
  const rows = await readDb().execute<Row>(sql`
    select st.id, st.title, st.summary, st.description, st.category, st.picture_url, s.slug
    from commerce.store_starters st
    join commerce.stores s on s.id = st.store_id and s.starter and s.status = 'active'
    where st.published
    order by st.position, lower(st.title), st.id
  `);
  return rows.map(toOffered);
}

/** A template's storefront, to open in a new window: its own host once stores have them (P7), else `/s/{slug}`. */
export const starterPreviewHref = (slug: string): string => storeHref(slug, storeBase(slug));

/**
 * The cards a person creating a store chooses from: the Standard store first, then the published templates. Cached (the sign-up page is
 * prerendered) under `STARTERS_TAG`.
 */
export async function starterCards(): Promise<StarterCard[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(STARTERS_TAG);
  const [template, offered] = await Promise.all([templateStoreSlug(), listOfferedStarters()]);
  return [
    standardCard(template ? starterPreviewHref(template) : null),
    ...offered.map((starter) => ({ ...starter, previewHref: starterPreviewHref(starter.storeSlug) })),
  ];
}

/** Every store template, published or not, for the platform admin. */
export async function listStarters(): Promise<StarterRow[]> {
  const rows = await db().execute<Row>(sql`
    select st.id, st.title, st.summary, st.description, st.category, st.picture_url, st.published, st.position, st.updated_at,
           s.id as store_id, s.slug, s.name as store_name,
           (select count(*)::int from commerce.stores m where m.made_from_starter = st.id) as stores_made
    from commerce.store_starters st
    join commerce.stores s on s.id = st.store_id
    order by st.position, lower(st.title), st.id
  `);
  return rows.map(toRow);
}

/** One store template, for its edit page; null when there is none. */
export async function getStarter(id: string): Promise<StarterRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db().execute<Row>(sql`
    select st.id, st.title, st.summary, st.description, st.category, st.picture_url, st.published, st.position, st.updated_at,
           s.id as store_id, s.slug, s.name as store_name,
           (select count(*)::int from commerce.stores m where m.made_from_starter = st.id) as stores_made
    from commerce.store_starters st
    join commerce.stores s on s.id = st.store_id
    where st.id = ${id}::uuid
  `);
  return row ? toRow(row) : null;
}

function toRow(row: Row): StarterRow {
  return {
    ...toOffered(row),
    published: Boolean(row.published),
    position: Number(row.position ?? 0),
    storeId: String(row.store_id),
    storeName: String(row.store_name),
    storesMade: Number(row.stores_made ?? 0),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Plain words for an error from the database, never its text. */
export function starterProblem(error: unknown, slug?: string): string {
  const text = describe(error);
  const known = starterRefusal(text);
  if (known) return known;
  if (slug && text.includes("stores_slug_unique")) return `The address ${slug} is taken. Choose another.`;
  if (text.includes("store_starters_")) return "Those details do not fit. Check the lengths and the picture's address.";
  return "The store template could not be saved. Nothing was changed; try again.";
}

function describe(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
    if (typeof record.constraint === "string") parts.push(record.constraint);
  }
  return parts.join(" ");
}

/**
 * A new store template: its store copied from the default template with the admin as owner, marked `starter`, and described, unpublished
 * and last in the order, all in one transaction.
 */
export async function createStarter(
  admin: Account,
  input: { slug: string; details: StarterDetails },
): Promise<StarterResult<{ id: string; slug: string }>> {
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizen's admins make store templates."] };
  const problem = slugProblem(input.slug);
  if (problem) return { ok: false, problems: [`Store address: ${problem}`] };
  const [taken] = await db().execute<Row>(sql`select 1 as taken from commerce.stores where slug = ${input.slug}`);
  if (taken) return { ok: false, problems: [`The address ${input.slug} is taken. Choose another.`] };
  const { title, summary, description, category, pictureUrl } = input.details;
  let created: { id: string; storeId: string };
  try {
    created = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`
        select commerce.clone_store(commerce.starter_source(null), ${input.slug}, ${title}, ${admin.id}::uuid) as id
      `);
      const storeId = String(store.id);
      await tx.execute(sql`update commerce.stores set starter = true where id = ${storeId}::uuid`);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.store_starters (store_id, title, summary, description, category, picture_url, position, published, created_by, updated_by)
        values (${storeId}::uuid, ${title}, ${summary}, ${description}, ${category}, ${pictureUrl},
          (select coalesce(max(position), 0) + 1 from commerce.store_starters), false, ${admin.id}::uuid, ${admin.id}::uuid)
        returning id
      `);
      return { id: String(row.id), storeId };
    });
  } catch (error) {
    return { ok: false, problems: [starterProblem(error, input.slug)] };
  }
  await audit(admin.id, created.storeId, "platform.starter_created", { starter: created.id, slug: input.slug, category }, {
    target: { type: "store_starter", id: created.id },
  });
  return { ok: true, id: created.id, slug: input.slug };
}

/** A store template's title, summary, description, category and picture. */
export async function updateStarter(admin: Account, id: string, details: StarterDetails): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  let row: Row | undefined;
  try {
    [row] = await db().execute<Row>(sql`
      update commerce.store_starters
         set title = ${details.title}, summary = ${details.summary}, description = ${details.description},
             category = ${details.category}, picture_url = ${details.pictureUrl}, updated_by = ${admin.id}::uuid
       where id = ${id}::uuid
      returning store_id
    `);
  } catch (error) {
    return { ok: false, problems: [starterProblem(error)] };
  }
  if (!row) return { ok: false, problems: ["Unknown store template."] };
  await audit(admin.id, String(row.store_id), "platform.starter_updated", { starter: id, category: details.category }, {
    target: { type: "store_starter", id },
  });
  return { ok: true };
}

/** Offers a store template to owners and the sign-up form, or stops offering it (stores already made from it are not touched). */
export async function setStarterPublished(admin: Account, id: string, published: boolean): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const [row] = await db().execute<Row>(sql`
    update commerce.store_starters set published = ${published}, updated_by = ${admin.id}::uuid
     where id = ${id}::uuid and published is distinct from ${published}
    returning store_id
  `);
  if (!row) return { ok: true };
  await audit(admin.id, String(row.store_id), published ? "platform.starter_published" : "platform.starter_unpublished", { starter: id }, {
    target: { type: "store_starter", id },
  });
  return { ok: true };
}

/** Moves a store template one place up or down in the order owners see; the order is written again as 1, 2, 3 … */
export async function moveStarter(admin: Account, id: string, direction: "up" | "down"): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const moved = await db().transaction(async (tx) => {
    // One mover at a time, so two admins reordering never interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commerce.store_starters.position'))`);
    const rows = await tx.execute<Row>(sql`select id, store_id from commerce.store_starters order by position, lower(title), id`);
    const order = movedOrder(rows.map((r) => String(r.id)), id, direction);
    if (!order) return null;
    for (const [index, starterId] of order.entries()) {
      await tx.execute(sql`update commerce.store_starters set position = ${index + 1} where id = ${starterId}::uuid and position <> ${index + 1}`);
    }
    return String(rows.find((r) => String(r.id) === id)?.store_id);
  });
  if (!moved) return { ok: true };
  await audit(admin.id, moved, "platform.starter_moved", { starter: id, direction }, { target: { type: "store_starter", id } });
  return { ok: true };
}

/**
 * The store template's admin for any platform admin: one who is not a member yet is made an owner (audited), so every platform admin
 * can edit every template. Returns the store's slug.
 */
export async function joinStarter(admin: Account, id: string): Promise<StarterResult<{ slug: string }>> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const [starter] = await db().execute<Row>(sql`
    select s.id, s.slug from commerce.store_starters st join commerce.stores s on s.id = st.store_id where st.id = ${id}::uuid
  `);
  if (!starter) return { ok: false, problems: ["Unknown store template."] };
  const storeId = String(starter.id);
  const [joined] = await db().execute<Row>(sql`
    insert into commerce.store_members (store_id, account_id, role)
    select ${storeId}::uuid, ${admin.id}::uuid, 'owner'
    where not exists (
      select 1 from commerce.store_members m where m.store_id = ${storeId}::uuid and m.account_id = ${admin.id}::uuid
    )
    returning account_id
  `);
  // A membership that was disabled is given back: a platform admin may always edit the platform's templates.
  const [enabled] = joined
    ? [undefined]
    : await db().execute<Row>(sql`
        update commerce.store_members set disabled_at = null, role = 'owner', role_id = null, kind = 'staff', expires_at = null
         where store_id = ${storeId}::uuid and account_id = ${admin.id}::uuid
           and (disabled_at is not null or role <> 'owner' or expires_at is not null or role_id is not null or kind <> 'staff')
        returning account_id
      `);
  if (joined || enabled) {
    await audit(admin.id, storeId, "platform.starter_joined", { starter: id }, { target: { type: "store_starter", id } });
  }
  return { ok: true, slug: String(starter.slug) };
}
