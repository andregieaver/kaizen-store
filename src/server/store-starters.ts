import "server-only";

import { randomBytes } from "node:crypto";

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
  type ContentSourceKind,
  type OfferedStarter,
  type StarterCard,
  type StarterCategory,
  type StarterDetails,
  type StarterRow,
} from "@/lib/store-starters";

import { contentPack, packSlots, picturesMissing } from "@/lib/content-packs";
import { isPack, type ThemeContent } from "@/lib/theme-store";
import { normaliseFeatures, type FeatureId } from "@/lib/store-features";

import { audit, type Account } from "./auth";
import { log } from "./log";
import { setFeatures } from "./store-features";
import { getStore, refreshStoreById, templateStoreSlug } from "./stores";
import { askForThemeShots } from "./theme-shots";

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
    where st.published and st.archived_at is null and st.kind = 'content' and (st.design_preset_id is null or st.pack_key is not null)
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
  select st.id, st.kind, st.title, st.summary, st.description, st.category, st.picture_url, st.published, st.position, st.updated_at,
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

/**
 * The store templates for the platform admin: the current ones (published or not), or the archived ones. A theme's own copy of content
 * (D275) is the theme's, seen on its Content tab, and a demo store (D277) is listed with the demo stores (`listDemoStores()`), never here;
 * a theme submission's pages (D388) are seen from the submission.
 */
export async function listStarters(filter: ListFilter = "current"): Promise<StarterRow[]> {
  const rows = await db().execute<Row>(sql`
    ${ROW_SELECT}
    where ${filter === "archived" ? sql`st.archived_at is not null` : sql`st.archived_at is null`}
      and st.kind = 'content' and (st.design_preset_id is null or st.pack_key is not null)
      and not exists (select 1 from commerce.theme_submissions ts where ts.content_starter_id = st.id)
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
    kind: row.kind === "demo" ? "demo" : "content",
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
  return "The demo store could not be saved. Nothing was changed; try again.";
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
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizena Flow's admins make demo stores."] };
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
  await refreshStoreById(created.storeId);
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
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
  const starter = await getStarter(id);
  if (!starter) return { ok: false, problems: ["Unknown demo store."] };
  const next: StarterDetails = { ...details, recommendedDesign: details.recommendedDesign === undefined ? shownDetails(starter).recommendedDesign ?? null : details.recommendedDesign };
  if (!(await recommendable(next.recommendedDesign))) return { ok: false, problems: ["That theme is gone or archived. Choose another."] };
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
 * One transaction: a failure publishes nothing. Refused while archived, and for a content pack whose pictures are not all made.
 */
export async function publishStarter(admin: Account, id: string): Promise<StarterResult<{ copySlug: string; notes: string[] }>> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
  const notes: string[] = [];
  let done: { storeId: string; copyId: string; copySlug: string };
  try {
    done = await db().transaction(async (tx) => {
      const [row] = await tx.execute<Row>(sql`
        select store_id, draft, archived_at, pack_key, pack_pictures from commerce.store_starters where id = ${id}::uuid for update
      `);
      if (!row) throw new Refused("Unknown demo store.");
      if (row.archived_at) throw new Refused("This demo store is archived. Restore it before publishing it.");
      // A content pack (`docs/theme-showcase-phase-1.md` step 2) is published only once all its pictures are made.
      const pack = row.pack_key ? contentPack(String(row.pack_key)) : null;
      const missing = pack ? picturesMissing(pack, row.pack_pictures) : 0;
      if (missing > 0) throw new Refused(`Make its pictures first: ${missing} still to make, under Starting content on the Themes page or on its theme's Content tab.`);
      const draft = readStarterDraft(row.draft);
      if (draft) {
        let recommended = draft.recommendedDesign ?? null;
        if (recommended) {
          const [preset] = await tx.execute<Row>(sql`select 1 as ok from commerce.design_presets where id = ${recommended}::uuid and archived_at is null`);
          if (!preset) {
            recommended = null;
            notes.push("Its recommended theme is gone or archived, so it recommends none now.");
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
    log("error", "store_starters.publish_failed", {}, error);
    return { ok: false, problems: [starterRefusal(describe(error)) ?? "The demo store could not be published. Nothing was changed; try again."] };
  }
  await audit(admin.id, done.storeId, "platform.starter_published", { starter: id, copy: done.copyId, copySlug: done.copySlug }, {
    target: { type: "store_starter", id },
  });
  // A content pack published again is a new store to show themes on: their pictures there are asked for (`docs/theme-showcase-phase-2.md`).
  await askForThemeShots();
  return { ok: true, copySlug: done.copySlug, notes };
}

class Refused extends Error {}

/**
 * Every published theme's own content (D275, `docs/themes-content-and-demo-stores.md`), theme id to it: its store template, published, not
 * archived, its store open. What the theme store, the photographs and new stores read; a cached read that calls this carries `STARTERS_TAG`
 * (publishing a template or a theme refreshes it).
 */
export async function publishedContents(): Promise<Map<string, ThemeContent>> {
  const rows = await readDb().execute<Row>(sql`
    select st.id, st.design_preset_id, st.pack_key, s.name from commerce.store_starters st
      join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.starter and s.status = 'active'
     where st.design_preset_id is not null and st.published and st.archived_at is null
  `);
  return new Map(rows.map((row) => [String(row.design_preset_id), toContent(row)]));
}

const toContent = (row: Row): ThemeContent => ({ starterId: String(row.id), pack: isPack(row.pack_key) ? row.pack_key : null, storeName: String(row.name) });

/** Which theme each store template is the own content of (D275), by template id: for the Themes page's starting content. */
export async function contentOwners(): Promise<Map<string, string>> {
  const rows = await db().execute<Row>(sql`
    select st.id, p.title from commerce.store_starters st join commerce.design_presets p on p.id = st.design_preset_id
  `);
  return new Map(rows.map((row) => [String(row.id), String(row.title)]));
}

/**
 * The store templates a theme's content may be copied from (D275): Kaizena Flow's starting content (the content packs), other themes'
 * content and older starting content, each published, and the demo stores (D277) as they stand, each by its title and what it is.
 */
export async function contentSources(): Promise<{ id: string; title: string; kind: ContentSourceKind }[]> {
  const rows = await db().execute<Row>(sql`
    select st.id, st.kind, s.name, st.pack_key, p.title as theme_title from commerce.store_starters st
      join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.starter and s.status = 'active'
      left join commerce.design_presets p on p.id = st.design_preset_id
     where st.archived_at is null and (st.published or st.kind = 'demo')
     order by st.pack_key is null, st.design_preset_id is null, st.kind = 'demo', st.position, lower(s.name)
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: row.theme_title ? `${String(row.name)}, ${String(row.theme_title)}'s content` : String(row.name),
    kind: row.kind === "demo" ? "demo" : row.pack_key ? "pack" : row.theme_title ? "theme" : "template",
  }));
}

/**
 * Gives a theme its own content (D275): a copy of a published store template (`clone_store(starter_source(source))`, the admin its owner),
 * marked a starter and described as the theme's, unpublished until the theme or its Content tab publishes it. The content it had is let go
 * in the same transaction: a content pack's template stays starting content, a copy of its own is archived.
 */
export async function giveThemeContent(admin: Account, presetId: string, sourceId: string): Promise<StarterResult<{ id: string }>> {
  if (!admin.platformAdmin || !isUuid(presetId)) return { ok: false, problems: ["Unknown theme."] };
  if (!isUuid(sourceId)) return { ok: false, problems: ["Choose the content to start from."] };
  const slug = `content-${randomBytes(4).toString("hex")}`;
  let made: { id: string; storeId: string };
  try {
    made = await db().transaction(async (tx) => {
      const [theme] = await tx.execute<Row>(sql`select id from commerce.design_presets where id = ${presetId}::uuid and archived_at is null for update`);
      if (!theme) throw new Refused("Unknown theme, or it is archived. Restore it first.");
      const [source] = await tx.execute<Row>(sql`
        select st.category, s.name from commerce.store_starters st
          join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.starter and s.status = 'active'
         where st.id = ${sourceId}::uuid and st.archived_at is null and (st.published or st.kind = 'demo')
      `);
      // Starting content is copied as published; a demo store (D277) as it stands, published or not.
      if (!source) throw new Refused("That content is not published. Choose published content to start from.");
      const [store] = await tx.execute<Row>(sql`
        select commerce.clone_store(commerce.starter_source(${sourceId}::uuid), ${slug}, ${String(source.name)}, ${admin.id}::uuid) as id
      `);
      const storeId = String(store.id);
      await tx.execute(sql`update commerce.stores set starter = true where id = ${storeId}::uuid`);
      await tx.execute(sql`
        update commerce.store_starters
           set design_preset_id = null,
               archived_at = case when pack_key is null then coalesce(archived_at, now()) else archived_at end,
               archived_by = case when pack_key is null then coalesce(archived_by, ${admin.id}::uuid) else archived_by end,
               published = case when pack_key is null then false else published end, updated_by = ${admin.id}::uuid
         where design_preset_id = ${presetId}::uuid
      `);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.store_starters (store_id, title, category, position, published, design_preset_id, created_by, updated_by)
        values (${storeId}::uuid, ${String(source.name)}, ${String(source.category)},
          (select coalesce(max(position), 0) + 1 from commerce.store_starters), false, ${presetId}::uuid, ${admin.id}::uuid, ${admin.id}::uuid)
        returning id
      `);
      return { id: String(row.id), storeId };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problems: [error.message] };
    log("error", "store_starters.theme_content_failed", {}, error);
    return { ok: false, problems: [starterRefusal(describe(error)) ?? "The content could not be copied. Nothing was changed; try again."] };
  }
  await audit(admin.id, made.storeId, "platform.design_preset_content", { preset: presetId, starter: made.id, from: sourceId }, {
    target: { type: "design_preset", id: presetId },
  });
  await refreshStoreById(made.storeId);
  return { ok: true, id: made.id };
}

/** A theme's own content for the platform admin (D275), published or not: its template, its working store and what it holds; null: none. */
export type ThemeContentRow = ThemeContent & {
  storeId: string;
  storeSlug: string;
  published: boolean;
  publishedAt: string | null;
  products: number;
  pages: number;
  /** A content pack's pictures, made and wanted; null for content of its own (its pictures are its library's). */
  pictures: { made: number; slots: number } | null;
  /** Products or pages changed in its working store since it was last published. */
  changed: boolean;
};

export async function themeContentOf(presetId: string): Promise<ThemeContentRow | null> {
  if (!isUuid(presetId)) return null;
  const [row] = await db().execute<Row>(sql`
    select st.id, st.pack_key, st.pack_pictures, st.published, st.published_at, s.id as store_id, s.slug, s.name,
           (select count(*)::int from commerce.products p where p.store_id = s.id and p.status <> 'archived') as products,
           (select count(*)::int from commerce.pages g where g.store_id = s.id and g.type in ('page', 'article')) as pages,
           (st.published_at is null or exists (select 1 from commerce.products p where p.store_id = s.id and p.updated_at > st.published_at)
              or exists (select 1 from commerce.pages g where g.store_id = s.id and g.updated_at > st.published_at)) as changed
      from commerce.store_starters st join commerce.stores s on s.id = st.store_id
     where st.design_preset_id = ${presetId}::uuid and st.archived_at is null
  `);
  if (!row) return null;
  const pack = isPack(row.pack_key) ? contentPack(row.pack_key) : null;
  const made = row.pack_pictures && typeof row.pack_pictures === "object" ? Object.keys(row.pack_pictures as object).length : 0;
  return {
    ...toContent(row),
    storeId: String(row.store_id),
    storeSlug: String(row.slug),
    published: Boolean(row.published),
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
    products: Number(row.products ?? 0),
    pages: Number(row.pages ?? 0),
    pictures: pack ? { made: Math.min(made, packSlots(pack).length), slots: packSlots(pack).length } : null,
    changed: Boolean(row.changed),
  };
}

/** Stops offering a store template at once (D177): stores made from it keep what they got; pending sign-ups that chose it get the Standard store. */
export async function unpublishStarter(admin: Account, id: string): Promise<StarterResult<{ pendingRequests: number }>> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
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
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
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
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
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
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
  const starter = await getStarter(id);
  if (!starter) return { ok: false, problems: ["Unknown demo store."] };
  const blocker = deleteBlocker("demo store", { stores: starter.storesMade, requests: starter.requests });
  if (blocker) return { ok: false, problems: [blocker] };
  try {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select 1 from commerce.store_starters where id = ${id}::uuid for update`);
      await tx.execute(sql`
        update commerce.stores set status = 'closed', status_reason = 'The demo store was deleted.', status_changed_by = ${admin.id}::uuid
         where (id = ${starter.storeId}::uuid or starter_copy_of = ${id}::uuid) and status <> 'closed'
      `);
      await tx.execute(sql`delete from commerce.store_starters where id = ${id}::uuid`);
    });
  } catch (error) {
    return { ok: false, problems: [starterProblem(error)] };
  }
  await audit(admin.id, starter.storeId, "platform.starter_deleted", { starter: id, title: starter.title }, { target: { type: "store_starter", id } });
  await refreshStoreById(starter.storeId);
  return { ok: true };
}

/** Moves a store template one place up or down in the order owners see; the order is written again as 1, 2, 3 … */
export async function moveStarter(admin: Account, id: string, direction: "up" | "down"): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
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
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
  const [starter] = await db().execute<Row>(sql`
    select s.id, s.slug from commerce.store_starters st join commerce.stores s on s.id = st.store_id where st.id = ${id}::uuid
  `);
  if (!starter) return { ok: false, problems: ["Unknown demo store."] };
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
  if (!admin.platformAdmin || !isUuid(id)) return { ok: false, problems: ["Unknown demo store."] };
  const starter = await getStarter(id);
  const store = starter ? await getStore(starter.storeSlug) : null;
  if (!starter || !store) return { ok: false, problems: ["Unknown demo store."] };
  const result = await setFeatures({ account: admin, store, role: "owner" }, normaliseFeatures(target), { confirmed: options.confirmed, via: "store_template" });
  if (!result.ok) {
    return result.needsConfirmation ? { ok: false, problems: result.problems, warnings: result.warnings ?? [], needsConfirmation: true } : { ok: false, problems: result.problems };
  }
  return { ok: true, features: result.features };
}

/** The store template a starter store is the working store of (its id and kind), for the banner in its admin; null for any other store. */
export async function starterOfStore(storeId: string): Promise<{ id: string; kind: "content" | "demo"; published: boolean } | null> {
  if (!isUuid(storeId)) return null;
  const [row] = await db().execute<Row>(sql`select id, kind, published from commerce.store_starters where store_id = ${storeId}::uuid`);
  return row ? { id: String(row.id), kind: row.kind === "demo" ? "demo" : "content", published: Boolean(row.published) } : null;
}
