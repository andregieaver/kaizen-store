import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { storeBase, storeHref } from "@/lib/paths";
import { slugProblem } from "@/lib/slug";
import { deleteBlocker, type ListFilter } from "@/lib/lifecycle";
import { featureSummary } from "@/lib/onboarding";
import {
  isStarterCategory,
  movedOrder,
  readStarterDraft,
  sameStarterDetails,
  standardCard,
  starterRefusal,
  type OfferedStarter,
  type StarterCard,
  type StarterCategory,
  type StarterDetails,
  type StarterRow,
} from "@/lib/store-starters";

import { normaliseFeatures, type FeatureId } from "@/lib/store-features";

import { audit, type Account } from "./auth";
import { setFeatures } from "./store-features";
import { getStore, templateStoreSlug } from "./stores";

/**
 * Store templates (D175, `docs/store-templates.md`): the platform's starting points for new stores. Each is a real store marked
 * `starter`, made from the default template by `clone_store()`, and described by a row of `commerce.store_starters`. Platform admins make
 * and keep them here; owners and the sign-up form only read the published ones (`listOfferedStarters()`), and what a new store is copied
 * from is decided in SQL (`commerce.starter_source()`), never here. D177: details are saved as a draft and published with the store frozen
 * into a hidden copy (`publishStarter()`); a template is unpublished, archived and restored, and deleted only while nothing used it.
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
  features: ((row.features ?? []) as unknown[]).map(String),
});

/**
 * The published store templates, in the platform's order: what owners and the sign-up form are offered. Each is shown by its frozen copy
 * (D177), the store new stores are made from; a template published before D177 and not since, by its working store as before.
 */
export async function listOfferedStarters(): Promise<OfferedStarter[]> {
  const rows = await readDb().execute<Row>(sql`
    select st.id, st.title, st.summary, st.description, st.category, st.picture_url, s.slug, s.features
    from commerce.store_starters st
    join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.starter and s.status = 'active'
    where st.published and st.archived_at is null
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
    ...offered.map((starter) => ({ ...starter, previewHref: starterPreviewHref(starter.storeSlug), featureWords: featureSummary(starter.features) })),
  ];
}

const ROW_SELECT = sql`
  select st.id, st.title, st.summary, st.description, st.category, st.picture_url, st.published, st.position, st.updated_at,
         st.recommended_design, st.draft, st.published_at, st.archived_at, s.id as store_id, s.slug, s.name as store_name, s.features,
         p.slug as published_slug, p.features as published_features,
         (select count(*)::int from commerce.stores m where m.made_from_starter = st.id and m.starter_copy_of is null) as stores_made,
         (select count(*)::int from commerce.access_requests r where r.starter_id = st.id) as requests,
         (st.published_at is not null and exists (
           select 1 from commerce.audit_log a
           where a.store_id = st.store_id and a.created_at > st.published_at and not starts_with(a.action, 'platform.')
         )) as changed_in_store
  from commerce.store_starters st
  join commerce.stores s on s.id = st.store_id
  left join commerce.stores p on p.id = st.published_store_id
`;

/** The store templates for the platform admin: the current ones (published or not), or the archived ones. */
export async function listStarters(filter: ListFilter = "current"): Promise<StarterRow[]> {
  const rows = await db().execute<Row>(sql`
    ${ROW_SELECT}
    where ${filter === "archived" ? sql`st.archived_at is not null` : sql`st.archived_at is null`}
    order by st.position, lower(st.title), st.id
  `);
  return rows.map(toRow);
}

/** One store template, for its edit page; null when there is none. */
export async function getStarter(id: string): Promise<StarterRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db().execute<Row>(sql`${ROW_SELECT} where st.id = ${id}::uuid`);
  return row ? toRow(row) : null;
}

function toRow(row: Row): StarterRow {
  const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
  return {
    ...toOffered(row),
    published: Boolean(row.published),
    position: Number(row.position ?? 0),
    storeId: String(row.store_id),
    storeName: String(row.store_name),
    storesMade: Number(row.stores_made ?? 0),
    requests: Number(row.requests ?? 0),
    recommendedDesign: row.recommended_design ? String(row.recommended_design) : null,
    draft: readStarterDraft(row.draft),
    publishedSlug: row.published_slug ? String(row.published_slug) : null,
    publishedFeatures: row.published_features ? (row.published_features as unknown[]).map(String) : null,
    publishedAt: iso(row.published_at),
    archivedAt: iso(row.archived_at),
    changedInStore: Boolean(row.changed_in_store),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/** The template's details as the platform admin edits them: the draft when there is one, else what is published. */
export const shownDetails = (starter: StarterRow): StarterDetails =>
  starter.draft ?? {
    title: starter.title,
    summary: starter.summary,
    description: starter.description,
    category: starter.category,
    pictureUrl: starter.pictureUrl,
    recommendedDesign: starter.recommendedDesign,
  };

/** Facts for the state and the buttons (`src/lib/lifecycle.ts`). */
export const starterLifecycle = (starter: StarterRow) => ({
  published: starter.published,
  archivedAt: starter.archivedAt,
  publishedAt: starter.publishedAt,
  // A template published before D177 has no frozen copy yet: publishing again freezes it.
  changed: starter.draft !== null || starter.changedInStore || (starter.published && starter.publishedSlug === null),
  used: starter.storesMade > 0 || starter.requests > 0,
});

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

/** The design profile a template may recommend (D176): one that exists and is not archived; null clears it. */
async function recommendable(presetId: string | null | undefined): Promise<boolean> {
  if (!presetId) return true;
  const [row] = await db().execute<Row>(sql`select 1 as ok from commerce.design_presets where id = ${presetId}::uuid and archived_at is null`);
  return row !== undefined;
}

/**
 * Saves a store template's details as a draft (D177): owners keep seeing what is published until Publish. A draft equal to what is
 * published is no draft. The recommended design profile (D176) is one of the details.
 */
export async function saveStarterDraft(admin: Account, id: string, details: StarterDetails): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const starter = await getStarter(id);
  if (!starter) return { ok: false, problems: ["Unknown store template."] };
  const next: StarterDetails = { ...details, recommendedDesign: details.recommendedDesign === undefined ? shownDetails(starter).recommendedDesign ?? null : details.recommendedDesign };
  if (!(await recommendable(next.recommendedDesign))) return { ok: false, problems: ["That design profile is gone or archived. Choose another."] };
  const published = { ...shownDetails({ ...starter, draft: null }) };
  const draft = sameStarterDetails(next, published) ? null : next;
  try {
    await db().execute(sql`
      update commerce.store_starters set draft = ${draft ? JSON.stringify(draft) : null}::jsonb, updated_by = ${admin.id}::uuid where id = ${id}::uuid
    `);
  } catch (error) {
    return { ok: false, problems: [starterProblem(error)] };
  }
  await audit(admin.id, starter.storeId, "platform.starter_updated", { starter: id, category: next.category, draft: draft !== null }, {
    target: { type: "store_starter", id },
  });
  return { ok: true };
}

/**
 * Publishes a store template (D177): its draft details become what owners read, and its working store is frozen into a hidden copy
 * (`commerce.freeze_starter()`, `clone_store()` underneath) that new stores are made from and owners preview; the copy it replaces is closed.
 * One transaction: a failure publishes nothing. Refused while archived.
 */
export async function publishStarter(admin: Account, id: string): Promise<StarterResult<{ copySlug: string; notes: string[] }>> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const notes: string[] = [];
  let done: { storeId: string; copyId: string; copySlug: string };
  try {
    done = await db().transaction(async (tx) => {
      const [row] = await tx.execute<Row>(sql`select store_id, draft, archived_at from commerce.store_starters where id = ${id}::uuid for update`);
      if (!row) throw new Refused("Unknown store template.");
      if (row.archived_at) throw new Refused("This store template is archived. Restore it before publishing it.");
      const draft = readStarterDraft(row.draft);
      if (draft) {
        let recommended = draft.recommendedDesign ?? null;
        if (recommended) {
          const [preset] = await tx.execute<Row>(sql`select 1 as ok from commerce.design_presets where id = ${recommended}::uuid and archived_at is null`);
          if (!preset) {
            recommended = null;
            notes.push("Its recommended design profile is gone or archived, so it recommends none now.");
          }
        }
        await tx.execute(sql`
          update commerce.store_starters
             set title = ${draft.title}, summary = ${draft.summary}, description = ${draft.description}, category = ${draft.category},
                 picture_url = ${draft.pictureUrl}, recommended_design = ${recommended}::uuid
           where id = ${id}::uuid
        `);
      }
      const [frozen] = await tx.execute<Row>(sql`select commerce.freeze_starter(${id}::uuid, ${admin.id}::uuid) as id`);
      const [copy] = await tx.execute<Row>(sql`select id, slug from commerce.stores where id = ${String(frozen.id)}::uuid`);
      await tx.execute(sql`
        update commerce.store_starters set published = true, published_at = now(), draft = null, updated_by = ${admin.id}::uuid where id = ${id}::uuid
      `);
      return { storeId: String(row.store_id), copyId: String(copy.id), copySlug: String(copy.slug) };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problems: [error.message] };
    console.error("[store-starters] publishing failed", error);
    return { ok: false, problems: [starterRefusal(describe(error)) ?? "The store template could not be published. Nothing was changed; try again."] };
  }
  await audit(admin.id, done.storeId, "platform.starter_published", { starter: id, copy: done.copyId, copySlug: done.copySlug }, {
    target: { type: "store_starter", id },
  });
  return { ok: true, copySlug: done.copySlug, notes };
}

class Refused extends Error {}

/** Stops offering a store template at once (D177): stores made from it keep what they got; pending sign-ups that chose it get the Standard store. */
export async function unpublishStarter(admin: Account, id: string): Promise<StarterResult<{ pendingRequests: number }>> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const [row] = await db().execute<Row>(sql`
    update commerce.store_starters set published = false, updated_by = ${admin.id}::uuid where id = ${id}::uuid and published
    returning store_id, (select count(*)::int from commerce.access_requests r where r.starter_id = ${id}::uuid and r.status = 'pending') as pending
  `);
  if (!row) return { ok: true, pendingRequests: 0 };
  await audit(admin.id, String(row.store_id), "platform.starter_unpublished", { starter: id }, { target: { type: "store_starter", id } });
  return { ok: true, pendingRequests: Number(row.pending ?? 0) };
}

/** Archives a store template (D177): unpublished, and hidden from every list but the platform's Archived filter, until Restore. */
export async function archiveStarter(admin: Account, id: string): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const [row] = await db().execute<Row>(sql`
    update commerce.store_starters set archived_at = now(), archived_by = ${admin.id}::uuid, published = false, updated_by = ${admin.id}::uuid
     where id = ${id}::uuid and archived_at is null
    returning store_id
  `);
  if (row) await audit(admin.id, String(row.store_id), "platform.starter_archived", { starter: id }, { target: { type: "store_starter", id } });
  return { ok: true };
}

/** Restores an archived store template (D177): back in the list as an unpublished draft. */
export async function restoreStarter(admin: Account, id: string): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const [row] = await db().execute<Row>(sql`
    update commerce.store_starters set archived_at = null, archived_by = null, updated_by = ${admin.id}::uuid
     where id = ${id}::uuid and archived_at is not null
    returning store_id
  `);
  if (row) await audit(admin.id, String(row.store_id), "platform.starter_restored", { starter: id }, { target: { type: "store_starter", id } });
  return { ok: true };
}

/**
 * Deletes a store template that nothing used (D177): no store was made from it and no access request names it (the database refuses
 * otherwise, `store_starters.used` / `.requested`). Stores are never deleted (D171): its working store and its frozen copies are closed and
 * stay, hidden; only the template's row goes.
 */
export async function deleteStarter(admin: Account, id: string): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const starter = await getStarter(id);
  if (!starter) return { ok: false, problems: ["Unknown store template."] };
  const blocker = deleteBlocker("store template", { stores: starter.storesMade, requests: starter.requests });
  if (blocker) return { ok: false, problems: [blocker] };
  try {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select 1 from commerce.store_starters where id = ${id}::uuid for update`);
      await tx.execute(sql`
        update commerce.stores set status = 'closed', status_reason = 'Its store template was deleted.', status_changed_by = ${admin.id}::uuid
         where (id = ${starter.storeId}::uuid or starter_copy_of = ${id}::uuid) and status <> 'closed'
      `);
      await tx.execute(sql`delete from commerce.store_starters where id = ${id}::uuid`);
    });
  } catch (error) {
    return { ok: false, problems: [starterProblem(error)] };
  }
  await audit(admin.id, starter.storeId, "platform.starter_deleted", { starter: id, title: starter.title }, { target: { type: "store_starter", id } });
  return { ok: true };
}

/** Moves a store template one place up or down in the order owners see; the order is written again as 1, 2, 3 … */
export async function moveStarter(admin: Account, id: string, direction: "up" | "down"): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const moved = await db().transaction(async (tx) => {
    // One mover at a time, so two admins reordering never interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commerce.store_starters.position'))`);
    const rows = await tx.execute<Row>(sql`
      select id, store_id from commerce.store_starters where archived_at is null order by position, lower(title), id
    `);
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

/**
 * Sets the features a store template switches on (D178 step 6): its working store's `stores.features`, through `setFeatures()` with the
 * platform admin as its owner (every platform admin may edit every template, as `joinStarter()` lets them), so needs, blockers, warnings and
 * the `store.feature` audit hold as on any store's Features page. They reach new stores on the next Publish (`clone_starter_setup()` copies them
 * into the frozen copy), and the change shows as "changed since published".
 */
export async function setStarterFeatures(
  admin: Account,
  id: string,
  target: readonly string[],
  options: { confirmed?: boolean } = {},
): Promise<StarterResult<{ features: FeatureId[] }> | { ok: false; problems: string[]; warnings: string[]; needsConfirmation: true }> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown store template."] };
  const starter = await getStarter(id);
  const store = starter ? await getStore(starter.storeSlug) : null;
  if (!starter || !store) return { ok: false, problems: ["Unknown store template."] };
  const result = await setFeatures({ account: admin, store, role: "owner" }, normaliseFeatures(target), { confirmed: options.confirmed, via: "store_template" });
  if (!result.ok) {
    return result.needsConfirmation ? { ok: false, problems: result.problems, warnings: result.warnings ?? [], needsConfirmation: true } : { ok: false, problems: result.problems };
  }
  return { ok: true, features: result.features };
}
