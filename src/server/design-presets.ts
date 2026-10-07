import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { db, readDb } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";
import { canonicalJson, deleteBlocker, type ListFilter } from "@/lib/lifecycle";
import {
  DESIGN_LAYOUT_KINDS,
  LAYOUT_PAGE_TYPE,
  beforeThemeName,
  designPageSlug,
  designPageTitle,
  designPreviewPath,
  designRefusal,
  keepDesignCard,
  layoutForStore,
  mapSnapshotMedia,
  parseDesignSnapshot,
  readDesignDraft,
  sameDesignDetails,
  snapshotFonts,
  snapshotLayout,
  snapshotStorageUrls,
  DESIGN_SNAPSHOT_VERSION,
  type DesignCard,
  type DesignDetails,
  type DesignLayoutKind,
  type DesignOrigin,
  type DesignRow,
  type DesignSnapshot,
  type OfferedDesign,
  type SnapshotNotes,
} from "@/lib/design-presets";
import { pageInput, parsePageContent, type PageContent } from "@/lib/page-content";
import { copyRow } from "@/lib/page-rows";
import { storeOrigins } from "@/lib/paths";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { defaultFooter, defaultHeader } from "@/lib/site-layout";
import { movedOrder } from "@/lib/store-starters";
import { TEMPLATE_MEDIA_BYTES_MAX, TEMPLATE_MEDIA_MAX, isStorageUrl, leftoverStorageUrls } from "@/lib/template-content";
import { parseStoreTheme, templateSettings } from "@/lib/theme";

import { audit, type Account } from "./auth";
import { catalogTag } from "./catalog";
import { findFont, installFonts } from "./fonts";
import { copyStoredFile } from "./media";
import { copyToLibrary, libraryFilesByUrl, type LibraryFile } from "./media-library";
import { pageRulesProblem } from "./page-rules";
import { pagesTag } from "./pages";
import { STARTERS_TAG } from "./store-starters";
import { storeTag } from "./stores";

/**
 * Design profiles (D176, `docs/design-profiles.md`): a frozen snapshot of a store's look (theme, header, footer, standard product layout
 * and site CSS), made by the platform's admins from a store and applied to any store by `applyDesignPreset()`, the one writer of a profile's
 * look into a store. A profile never carries a store's brand or content (name, logos, business details, menus' links, pages, products), and
 * applying one keeps the store's look from before so it can be put back (`restoreDesignLook()`).
 */

type Row = Record<string, unknown>;

/** The cache tag of what owners, the sign-up form and the preview are offered: every change to a profile's details, order or publishing updates it. */
export const DESIGNS_TAG = "design-presets";

export type DesignResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; problems: string[] };

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const refuse = (message: string): { ok: false; problems: string[] } => ({ ok: false, problems: [message] });
const UNKNOWN = "Unknown design profile.";
const NOT_OFFERED = "That design profile is not offered any more. Choose another.";
const KEPT = "This store is kept by the platform (a store template's published copy or a design profile's workspace): its look is not changed here.";

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

/** Plain words for an error from the database, never its text. */
export function designProblem(error: unknown): string {
  return designRefusal(describe(error)) ?? "The design profile could not be saved. Nothing was changed; try again.";
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const toOffered = (row: Row): OfferedDesign => ({
  id: String(row.id),
  title: String(row.title),
  summary: String(row.summary ?? ""),
  description: String(row.description ?? ""),
  pictureUrl: row.picture_url ? String(row.picture_url) : null,
});

/** The published design profiles whose snapshot can be read, in the platform's order: what owners and the sign-up form are offered. */
export async function listOfferedDesigns(): Promise<OfferedDesign[]> {
  const rows = await readDb().execute<Row>(sql`
    select id, title, summary, description, picture_url, snapshot from commerce.design_presets
    where published and archived_at is null order by position, lower(title), id
  `);
  return rows.filter((row) => parseDesignSnapshot(row.snapshot) !== null).map(toOffered);
}

/**
 * What the create-store and sign-up forms offer (cached under `DESIGNS_TAG` and `STARTERS_TAG`): the card that keeps the template's own
 * look first, then each published profile with its preview; and each published store template's recommended profile (D175), when that
 * profile is published, which the form chooses when that template is chosen.
 */
export async function designChoices(): Promise<{ cards: DesignCard[]; recommended: Record<string, string> }> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  const [offered, rows] = await Promise.all([
    listOfferedDesigns(),
    readDb().execute<Row>(sql`
      select st.id, st.recommended_design from commerce.store_starters st
      join commerce.design_presets d on d.id = st.recommended_design and d.published and d.archived_at is null
      where st.published and st.archived_at is null
    `),
  ]);
  const ids = new Set(offered.map((d) => d.id));
  return {
    cards: [keepDesignCard(), ...offered.map((d) => ({ ...d, previewHref: designPreviewPath(d.id) }))],
    recommended: Object.fromEntries(rows.filter((r) => ids.has(String(r.recommended_design))).map((r) => [String(r.id), String(r.recommended_design)])),
  };
}

const ROW_SELECT = sql`
  select d.id, d.title, d.summary, d.description, d.picture_url, d.published, d.position, d.snapshot_at, d.snapshot,
         d.source_store_id, s.name as source_name, s.slug as source_slug, d.draft, d.workspace_store_id, w.slug as workspace_slug,
         d.workspace_key, d.published_at, d.archived_at,
         (select count(distinct u.store_id)::int from commerce.design_preset_uses u where u.preset_id = d.id) as stores_using,
         (select count(*)::int from commerce.access_requests r where r.design_preset_id = d.id) as requests,
         coalesce((select array_agg(st.title order by st.position) from commerce.store_starters st where st.recommended_design = d.id), '{}') as recommended_by
  from commerce.design_presets d
  left join commerce.stores s on s.id = d.source_store_id
  left join commerce.stores w on w.id = d.workspace_store_id
`;

function toRow(row: Row): DesignRow {
  const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
  return {
    ...toOffered(row),
    published: Boolean(row.published),
    position: Number(row.position ?? 0),
    sourceStoreId: row.source_store_id ? String(row.source_store_id) : null,
    sourceStoreName: row.source_name ? String(row.source_name) : null,
    sourceStoreSlug: row.source_slug ? String(row.source_slug) : null,
    storesUsing: Number(row.stores_using ?? 0),
    requests: Number(row.requests ?? 0),
    recommendedBy: ((row.recommended_by ?? []) as unknown[]).map(String),
    snapshotAt: new Date(String(row.snapshot_at)).toISOString(),
    readable: parseDesignSnapshot(row.snapshot) !== null,
    draft: readDesignDraft(row.draft),
    workspaceStoreId: row.workspace_store_id ? String(row.workspace_store_id) : null,
    workspaceSlug: row.workspace_slug ? String(row.workspace_slug) : null,
    workspaceKey: row.workspace_key ? String(row.workspace_key) : null,
    publishedAt: iso(row.published_at),
    archivedAt: iso(row.archived_at),
  };
}

/** The design profiles for the platform admin: the current ones (published or not), or the archived ones. */
export async function listDesigns(filter: ListFilter = "current"): Promise<DesignRow[]> {
  const rows = await db().execute<Row>(sql`
    ${ROW_SELECT} where ${filter === "archived" ? sql`d.archived_at is not null` : sql`d.archived_at is null`}
    order by d.position, lower(d.title), d.id
  `);
  return rows.map(toRow);
}

/** One design profile, for its own pages; null when there is none. */
export async function getDesign(id: string): Promise<DesignRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db().execute<Row>(sql`${ROW_SELECT} where d.id = ${id}::uuid`);
  return row ? toRow(row) : null;
}

/** The profile's details as the platform admin edits them: the draft when there is one, else what is published. */
export const shownDesignDetails = (design: DesignRow): DesignDetails =>
  design.draft ?? { title: design.title, summary: design.summary, description: design.description, pictureUrl: design.pictureUrl };

/**
 * Whether a profile has changes not yet published (D177): details saved as a draft, or a workspace whose look is no longer the one last
 * published (its key, `snapshotKey()`). A profile made before D177 without a workspace has only its details to compare.
 */
export async function designChanged(design: DesignRow): Promise<boolean> {
  if (design.draft) return true;
  if (!design.workspaceStoreId || !design.workspaceKey) return false;
  const taken = await takeSnapshot(design.workspaceStoreId, { drafts: true });
  return taken.ok ? snapshotKey(taken.snapshot) !== design.workspaceKey : false;
}

/** Facts for the state and the buttons (`src/lib/lifecycle.ts`). */
export async function designLifecycle(design: DesignRow) {
  return {
    published: design.published,
    archivedAt: design.archivedAt,
    publishedAt: design.publishedAt,
    changed: await designChanged(design),
    used: design.storesUsing > 0 || design.requests > 0,
  };
}

/** A store a design profile's look may be taken from is not one the platform keeps for itself (a frozen copy, a workspace, D177). */
const NOT_HIDDEN = sql`not (s.starter and not exists (select 1 from commerce.store_starters hs where hs.store_id = s.id))`;

/**
 * The stores a platform admin may take a snapshot from: those they work in (the default template and store templates among them, which
 * they reach as members), not closed, and never a store the platform keeps for itself (D177).
 */
export async function snapshotSources(admin: Account): Promise<{ id: string; name: string; slug: string; kind: "template" | "starter" | "store" }[]> {
  if (!admin.platformAdmin) return [];
  const rows = await db().execute<Row>(sql`
    select s.id, s.name, s.slug, s.is_template, s.starter from commerce.stores s
    join commerce.store_members m on m.store_id = s.id and m.account_id = ${admin.id}::uuid and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now())
    where s.status <> 'closed' and ${NOT_HIDDEN}
    order by s.is_template desc, s.starter desc, lower(s.name)
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    kind: row.is_template ? "template" : row.starter ? "starter" : "store",
  }));
}

// ---------------------------------------------------------------------------
// Taking a snapshot
// ---------------------------------------------------------------------------

/** What a snapshot left out, in plain words for the platform admin. */
function notesText(notes: SnapshotNotes[], cssDropped: boolean): string[] {
  const sum = (key: "fieldBlocks" | "otherMenus") => notes.reduce((n, note) => n + note[key], 0);
  const out: string[] = [];
  if (sum("fieldBlocks") > 0) out.push(`${sum("fieldBlocks")} custom field ${sum("fieldBlocks") === 1 ? "component was" : "components were"} left out: they show the store's own fields.`);
  if (sum("otherMenus") > 0) out.push(`${sum("otherMenus")} menu ${sum("otherMenus") === 1 ? "component shows" : "components show"} a menu that is neither the header's nor the footer's: ${sum("otherMenus") === 1 ? "it shows" : "they show"} no menu until the store chooses one.`);
  if (notes.some((n) => n.cssDropped) || cssDropped) out.push("CSS that reaches into the store's own files was left out.");
  if (notes.some((n) => n.overlayDropped)) out.push("The header lies over pages of the store's own categories or tags, which another store does not have: it is kept above the page.");
  return out;
}

/**
 * A snapshot of a store's look as it is now (D176): its theme, its chosen header, footer and standard product layout as last published
 * (none chosen or not published: the standard one), and its site CSS, each cleaned so that nothing in it points into the store
 * (`snapshotLayout()`). Reads only the store's look (`LOOK_FIELDS`) and its menus' ids, never its brand. A profile's workspace (D177) is read
 * with `drafts`: its layouts as last saved in the profile's builder, which saves drafts only.
 */
export async function takeSnapshot(storeId: string, options: { drafts?: boolean } = {}): Promise<DesignResult<{ snapshot: DesignSnapshot; notes: string[] }>> {
  const content = options.drafts ? sql.raw("p.draft") : sql.raw("p.published");
  const live = options.drafts ? sql`` : sql`and p.published_at is not null`;
  const [store] = await db().execute<Row>(sql`
    select s.id, s.slug, s.theme, s.custom_css, s.header_menu_id, s.footer_menu_id,
      (select ${content} from commerce.pages p where p.store_id = s.id and p.id = s.header_id and p.type = 'header' ${live}) as header,
      (select ${content} from commerce.pages p where p.store_id = s.id and p.id = s.footer_id and p.type = 'footer' ${live}) as footer,
      (select ${content} from commerce.pages p where p.store_id = s.id and p.id = s.product_layout_id and p.type = 'product_layout' ${live}) as product_layout
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  if (!store) return refuse("That store no longer exists.");
  const slug = String(store.slug);
  const from = { id: String(store.id), slug, hosts: storeOrigins(slug).map((origin) => new URL(origin).host) };
  const menus = { header: store.header_menu_id ? String(store.header_menu_id) : null, footer: store.footer_menu_id ? String(store.footer_menu_id) : null };
  const notes: SnapshotNotes[] = [];
  const layout = (value: unknown, kind: DesignLayoutKind) => {
    const content = parsePageContent(value);
    if (!content) return null;
    const taken = snapshotLayout(content, kind, menus, from);
    notes.push(taken.notes);
    return taken.layout;
  };
  const theme = parseStoreTheme(store.theme);
  const rawCss = String(store.custom_css ?? "").trim();
  const css = rawCss === "" || cssProblem(rawCss) !== null || rawCss.includes("/storage/v1/object/public/") ? "" : rawCss;
  const snapshot = parseDesignSnapshot({
    v: DESIGN_SNAPSHOT_VERSION,
    theme: { base: theme.base, settings: theme.settings },
    header: layout(store.header, "header"),
    footer: layout(store.footer, "footer"),
    productLayout: layout(store.product_layout, "productLayout"),
    css,
  });
  if (!snapshot) return refuse("The store's look could not be read as a design profile. Check its header, footer and product layout in the builder.");
  return { ok: true, snapshot, notes: notesText(notes, rawCss !== "" && css === "") };
}

/** A key of a snapshot (D177): equal snapshots give equal keys, so a workspace can tell whether its look changed since it was published. */
export const snapshotKey = (snapshot: DesignSnapshot): string => createHash("sha256").update(canonicalJson(snapshot)).digest("hex");

/** Whether the admin works in the store (a snapshot is only taken of a store they can see in its own admin), never one the platform keeps. */
async function works(accountId: string, storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 as ok from commerce.store_members m join commerce.stores s on s.id = m.store_id
    where m.store_id = ${storeId}::uuid and m.account_id = ${accountId}::uuid and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now()) and s.status <> 'closed' and ${NOT_HIDDEN}
  `);
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// A profile's workspace (D177)
// ---------------------------------------------------------------------------

/** A design profile's workspace: the hidden store its look is edited in, from the profile's own pages. */
export type DesignWorkspace = { presetId: string; title: string; store: { id: string; slug: string } };

/** Kaizen's standard look (D177, "from scratch"): the standard theme, header, footer and product layout, no CSS. */
const STANDARD_THEME = { base: "minimal", savedId: null, settings: templateSettings("minimal") };

/**
 * A new workspace: a hidden store copied from the default template (its demo products, pages and menus are what the builders and previews
 * draw on), marked `starter` and described by no store template, so it is not a real store and is never listed or worked in (D175, D177),
 * with Kaizen's standard look. The admin who made it is its owner on paper (`clone_store()` needs one); `loadMembership()` honours no
 * membership of it.
 */
async function makeWorkspace(admin: Account): Promise<{ id: string; slug: string }> {
  for (let attempt = 0; ; attempt += 1) {
    const slug = `design-${randomBytes(4).toString("hex")}`;
    try {
      return await db().transaction(async (tx) => {
        const [row] = await tx.execute<Row>(sql`
          select commerce.clone_store(commerce.starter_source(null), ${slug},
            (select t.name from commerce.stores t where t.id = commerce.starter_source(null)), ${admin.id}::uuid) as id
        `);
        const id = String(row.id);
        await tx.execute(sql`
          update commerce.stores set starter = true, theme = ${JSON.stringify(STANDARD_THEME)}::jsonb, custom_css = '',
            header_id = null, footer_id = null, product_layout_id = null
          where id = ${id}::uuid
        `);
        return { id, slug };
      });
    } catch (error) {
      if (attempt < 4 && describe(error).includes("stores_slug")) continue;
      throw error;
    }
  }
}

/** A workspace that is no longer wanted (its profile could not be made, or another admin made one first): closed and kept (D171). */
async function closeWorkspace(storeId: string, accountId: string, reason: string): Promise<void> {
  await db().execute(sql`
    update commerce.stores set status = 'closed', status_reason = ${reason}, status_changed_by = ${accountId}::uuid
     where id = ${storeId}::uuid and status <> 'closed'
  `);
}

async function readWorkspace(presetId: string): Promise<{ title: string; workspace: { id: string; slug: string } | null; snapshot: unknown; sourceId: string | null } | null> {
  const [row] = await db().execute<Row>(sql`
    select d.title, d.draft, d.snapshot, d.source_store_id, w.id as workspace_id, w.slug as workspace_slug
    from commerce.design_presets d left join commerce.stores w on w.id = d.workspace_store_id
    where d.id = ${presetId}::uuid
  `);
  if (!row) return null;
  return {
    title: readDesignDraft(row.draft)?.title ?? String(row.title),
    workspace: row.workspace_id ? { id: String(row.workspace_id), slug: String(row.workspace_slug) } : null,
    snapshot: row.snapshot,
    sourceId: row.source_store_id ? String(row.source_store_id) : null,
  };
}

/**
 * The profile's workspace for a platform admin, or null (D177): what every editor action checks before it writes, never making one.
 * Null for anyone who does not run the platform, an unknown profile, and a profile without a workspace yet.
 */
export async function workspaceOf(account: Pick<Account, "platformAdmin">, presetId: string): Promise<DesignWorkspace | null> {
  if (!account.platformAdmin || !isUuid(presetId)) return null;
  const found = await readWorkspace(presetId);
  return found?.workspace ? { presetId, title: found.title, store: found.workspace } : null;
}

/**
 * The profile's workspace, made the first time a profile from before D177 is edited (D177): a fresh workspace with the profile's published
 * snapshot written into it, as applying would place it, and its key kept so the profile does not count as changed. Two admins opening it at
 * once get the same one (the second's is closed). Null for anyone who does not run the platform and an unknown profile.
 */
export async function ensureWorkspace(admin: Account, presetId: string, deps: ApplyDeps = {}): Promise<DesignResult<{ workspace: DesignWorkspace }>> {
  if (!admin.platformAdmin || !isUuid(presetId)) return refuse(UNKNOWN);
  const found = await readWorkspace(presetId);
  if (!found) return refuse(UNKNOWN);
  if (found.workspace) return { ok: true, workspace: { presetId, title: found.title, store: found.workspace } };
  const snapshot = parseDesignSnapshot(found.snapshot);
  if (!snapshot) return refuse("This design profile can no longer be read, so it cannot be edited.");
  const made = await makeWorkspace(admin);
  const written = await writeWorkspaceLook(made.id, snapshot, { sourceId: found.sourceId, accountId: admin.id, title: found.title, deps });
  if (!written.ok) {
    await closeWorkspace(made.id, admin.id, "Its design profile's look could not be written into it.");
    return written;
  }
  const taken = await takeSnapshot(made.id, { drafts: true });
  const [linked] = await db().execute<Row>(sql`
    update commerce.design_presets set workspace_store_id = ${made.id}::uuid, workspace_key = ${taken.ok ? snapshotKey(taken.snapshot) : null}
     where id = ${presetId}::uuid and workspace_store_id is null
    returning id
  `);
  if (!linked) {
    await closeWorkspace(made.id, admin.id, "Another workspace was made for its design profile first.");
    const again = await workspaceOf(admin, presetId);
    return again ? { ok: true, workspace: again } : refuse(UNKNOWN);
  }
  await audit(admin.id, made.id, "platform.design_preset_workspace", { preset: presetId, notes: written.notes.length }, { target: { type: "design_preset", id: presetId } });
  return { ok: true, workspace: { presetId, title: found.title, store: made } };
}

/** The address of the page a profile's workspace keeps for a kind: `header-profile` and so on (`-2` … when taken). */
const workspaceSlug = (kind: DesignLayoutKind, taken: Iterable<string> = []): string => designPageSlug(kind, "profile", taken);

/** The page of a kind the workspace edits: the one chosen, else the one made for the profile before (`header-profile…`), else none. */
async function workspaceLayoutPage(tx: Pick<ReturnType<typeof db>, "execute">, storeId: string, kind: DesignLayoutKind): Promise<string | null> {
  const type = LAYOUT_PAGE_TYPE[kind];
  const column = sql.raw(kind === "header" ? "header_id" : kind === "footer" ? "footer_id" : "product_layout_id");
  const base = workspaceSlug(kind);
  const [row] = await tx.execute<Row>(sql`
    select coalesce(
      (select p.id from commerce.pages p join commerce.stores s on s.id = p.store_id and s.${column} = p.id where p.store_id = ${storeId}::uuid and p.type = ${type}),
      (select p.id from commerce.pages p where p.store_id = ${storeId}::uuid and p.type = ${type} and (p.slug = ${base} or p.slug like ${`${base}-%`})
        order by p.updated_at desc limit 1)
    ) as id
  `);
  return row?.id ? String(row.id) : null;
}

/**
 * Writes a look into a profile's workspace (D177), through the same placing as applying (`placeSnapshot()`: fonts, pictures copied into its
 * library, pages checked as the builder checks them): the theme and CSS, and each layout into the workspace's own page of its kind (the one
 * chosen, else the profile's, else a new one), chosen; a part the look has as null is unchosen (the standard one). No saved theme and no use
 * is kept: a workspace is no store's look to put back, and writing it never makes the profile "used".
 */
async function writeWorkspaceLook(
  storeId: string,
  snapshot: DesignSnapshot,
  options: { sourceId: string | null; accountId: string; title: string; deps?: ApplyDeps },
): Promise<DesignResult<{ notes: string[] }>> {
  const facts = await actorFacts(storeId, options.accountId);
  if (!facts) return refuse("That store no longer exists.");
  const placed = await placeSnapshot(storeId, snapshot, { sourceId: options.sourceId, accountId: options.accountId, title: "Profile", menus: facts, deps: options.deps });
  if (!placed.ok) return placed;
  try {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select 1 from commerce.stores where id = ${storeId}::uuid for update`);
      const chosen: Record<DesignLayoutKind, string | null> = { header: null, footer: null, productLayout: null };
      for (const kind of DESIGN_LAYOUT_KINDS) {
        const page = placed.pages[kind];
        if (!page) continue;
        const type = LAYOUT_PAGE_TYPE[kind];
        const existing = await workspaceLayoutPage(tx, storeId, kind);
        if (existing) {
          const [row] = await tx.execute<Row>(sql`select slug from commerce.pages where id = ${existing}::uuid`);
          const json = JSON.stringify({ ...page, slug: String(row.slug) });
          await tx.execute(sql`
            update commerce.pages set draft = ${json}::jsonb, published = ${json}::jsonb, published_at = coalesce(published_at, now()),
              first_published_at = coalesce(first_published_at, now()), updated_by = ${options.accountId}::uuid
            where id = ${existing}::uuid
          `);
          chosen[kind] = existing;
        } else {
          const taken = await tx.execute<Row>(sql`select slug from commerce.pages where store_id = ${storeId}::uuid and type = ${type}`);
          const slug = workspaceSlug(kind, taken.map((r) => String(r.slug)));
          const json = JSON.stringify({ ...page, slug });
          const [row] = await tx.execute<Row>(sql`
            insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
            values (${storeId}::uuid, ${type}, ${slug}, ${json}::jsonb, ${json}::jsonb, now(), now(), ${options.accountId}::uuid, ${options.accountId}::uuid)
            returning id
          `);
          chosen[kind] = String(row.id);
        }
      }
      const theme = { base: snapshot.theme.base, savedId: null, settings: snapshot.theme.settings };
      await tx.execute(sql`
        update commerce.stores set theme = ${JSON.stringify(theme)}::jsonb, custom_css = ${placed.siteCss},
          header_id = ${chosen.header}::uuid, footer_id = ${chosen.footer}::uuid, product_layout_id = ${chosen.productLayout}::uuid
        where id = ${storeId}::uuid
      `);
    });
  } catch (error) {
    console.error("[design-presets] writing a workspace failed", error);
    return refuse("The look could not be written into the design profile. Nothing was changed; try again.");
  }
  return { ok: true, notes: placed.notes };
}

/**
 * A new design profile (D177), unpublished and last: its workspace made with Kaizen's standard look, and from a store the admin works in
 * that store's look written into it (as applying writes one); its snapshot taken from the workspace, so what is published later is what the
 * admin built there.
 */
export async function createDesign(
  admin: Account,
  input: { origin: DesignOrigin; details: DesignDetails },
  deps: ApplyDeps = {},
): Promise<DesignResult<{ id: string; notes: string[] }>> {
  if (!admin.platformAdmin) return refuse("Only Kaizen's admins make design profiles.");
  const { origin } = input;
  const notes: string[] = [];
  let source: DesignSnapshot | null = null;
  if (origin.kind === "store") {
    if (!isUuid(origin.storeId) || !(await works(admin.id, origin.storeId))) return refuse("Choose a store you work in.");
    const taken = await takeSnapshot(origin.storeId);
    if (!taken.ok) return taken;
    source = taken.snapshot;
    notes.push(...taken.notes);
  }
  const workspace = await makeWorkspace(admin);
  if (source && origin.kind === "store") {
    const written = await writeWorkspaceLook(workspace.id, source, { sourceId: origin.storeId, accountId: admin.id, title: input.details.title, deps });
    if (!written.ok) {
      await closeWorkspace(workspace.id, admin.id, "Its design profile could not be made.");
      return written;
    }
    notes.push(...written.notes);
  }
  const fresh = await takeSnapshot(workspace.id, { drafts: true });
  if (!fresh.ok) {
    await closeWorkspace(workspace.id, admin.id, "Its design profile could not be made.");
    return fresh;
  }
  const { title, summary, description, pictureUrl } = input.details;
  let id: string;
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.design_presets (title, summary, description, picture_url, snapshot, source_store_id, workspace_store_id, workspace_key,
        position, published, created_by, updated_by)
      values (${title}, ${summary}, ${description}, ${pictureUrl}, ${JSON.stringify(fresh.snapshot)}::jsonb, ${workspace.id}::uuid, ${workspace.id}::uuid,
        ${snapshotKey(fresh.snapshot)}, (select coalesce(max(position), 0) + 1 from commerce.design_presets), false, ${admin.id}::uuid, ${admin.id}::uuid)
      returning id
    `);
    id = String(row.id);
  } catch (error) {
    await closeWorkspace(workspace.id, admin.id, "Its design profile could not be made.");
    return refuse(designProblem(error));
  }
  await audit(admin.id, origin.kind === "store" ? origin.storeId : workspace.id, "platform.design_preset_created", {
    preset: id,
    title,
    origin: origin.kind,
    workspace: workspace.id,
  }, { target: { type: "design_preset", id } });
  return { ok: true, id, notes };
}

/**
 * Replaces the look in a profile's workspace with a store's (D177, *Start again from a store*): the store's look now, written as creating
 * from a store writes it. Only the draft changes: stores keep the published profile until Publish.
 */
export async function copyStoreLookToDraft(admin: Account, presetId: string, storeId: string, deps: ApplyDeps = {}): Promise<DesignResult<{ notes: string[] }>> {
  if (!admin.platformAdmin || !isUuid(presetId)) return refuse(UNKNOWN);
  if (!isUuid(storeId) || !(await works(admin.id, storeId))) return refuse("Choose a store you work in.");
  const ready = await ensureWorkspace(admin, presetId, deps);
  if (!ready.ok) return ready;
  const taken = await takeSnapshot(storeId);
  if (!taken.ok) return taken;
  const written = await writeWorkspaceLook(ready.workspace.store.id, taken.snapshot, { sourceId: storeId, accountId: admin.id, title: ready.workspace.title, deps });
  if (!written.ok) return written;
  await audit(admin.id, storeId, "platform.design_preset_copied", { preset: presetId, workspace: ready.workspace.store.id }, { target: { type: "design_preset", id: presetId } });
  return { ok: true, notes: [...taken.notes, ...written.notes] };
}

/**
 * Chooses the standard header, footer or product layout in a profile's workspace (`standard`), or one of the profile's own to build (`build`:
 * the one made before, else a new page starting as the standard one, saved as a draft like everything in the workspace).
 */
export async function chooseWorkspaceLayout(admin: Account, presetId: string, kind: DesignLayoutKind, choice: "standard" | "build"): Promise<DesignResult<{ pageId: string | null }>> {
  const workspace = await workspaceOf(admin, presetId);
  if (!workspace) return refuse(UNKNOWN);
  const storeId = workspace.store.id;
  const column = sql.raw(kind === "header" ? "header_id" : kind === "footer" ? "footer_id" : "product_layout_id");
  const type = LAYOUT_PAGE_TYPE[kind];
  const pageId = await db().transaction(async (tx) => {
    const [store] = await tx.execute<Row>(sql`select header_menu_id, footer_menu_id from commerce.stores where id = ${storeId}::uuid for update`);
    if (choice === "standard") {
      await tx.execute(sql`update commerce.stores set ${column} = null where id = ${storeId}::uuid`);
      return null;
    }
    let id = await workspaceLayoutPage(tx, storeId, kind);
    if (!id) {
      const menus = { header: store.header_menu_id ? String(store.header_menu_id) : null, footer: store.footer_menu_id ? String(store.footer_menu_id) : null };
      const start = kind === "header" ? defaultHeader(storeId, menus) : kind === "footer" ? defaultFooter(storeId, menus) : DEFAULT_PRODUCT_LAYOUT;
      const taken = await tx.execute<Row>(sql`select slug from commerce.pages where store_id = ${storeId}::uuid and type = ${type}`);
      const slug = workspaceSlug(kind, taken.map((r) => String(r.slug)));
      const content = { ...start, title: designPageTitle(kind, "Profile"), slug, rows: start.rows.map((row) => copyRow(row, randomUUID)) };
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.pages (store_id, type, slug, draft, created_by, updated_by)
        values (${storeId}::uuid, ${type}, ${slug}, ${JSON.stringify(content)}::jsonb, ${admin.id}::uuid, ${admin.id}::uuid)
        returning id
      `);
      id = String(row.id);
    }
    await tx.execute(sql`update commerce.stores set ${column} = ${id}::uuid where id = ${storeId}::uuid`);
    return id;
  });
  return { ok: true, pageId };
}

/** The page a profile's builder edits for a kind (D177): the workspace's chosen one, or null for the standard one. */
export async function workspaceChosenPage(workspace: DesignWorkspace, kind: DesignLayoutKind): Promise<string | null> {
  const column = sql.raw(kind === "header" ? "header_id" : kind === "footer" ? "footer_id" : "product_layout_id");
  const [row] = await db().execute<Row>(sql`
    select p.id from commerce.stores s join commerce.pages p on p.store_id = s.id and p.id = s.${column} and p.type = ${LAYOUT_PAGE_TYPE[kind]}
    where s.id = ${workspace.store.id}::uuid
  `);
  return row ? String(row.id) : null;
}

// ---------------------------------------------------------------------------
// Details and the life of a profile (D177)
// ---------------------------------------------------------------------------

/** Saves a profile's details as a draft (D177): stores keep seeing what is published until Publish. A draft equal to what is published is none. */
export async function saveDesignDraft(admin: Account, id: string, details: DesignDetails): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const design = await getDesign(id);
  if (!design) return refuse(UNKNOWN);
  const draft = sameDesignDetails(details, shownDesignDetails({ ...design, draft: null })) ? null : details;
  try {
    await db().execute(sql`update commerce.design_presets set draft = ${draft ? JSON.stringify(draft) : null}::jsonb, updated_by = ${admin.id}::uuid where id = ${id}::uuid`);
  } catch (error) {
    return refuse(designProblem(error));
  }
  await audit(admin.id, design.workspaceStoreId, "platform.design_preset_updated", { preset: id, draft: draft !== null }, { target: { type: "design_preset", id } });
  return { ok: true };
}

/**
 * Publishes a profile (D177): its draft details become what stores read, and the look in its workspace, taken as a snapshot through the same
 * cleaning as ever (`takeSnapshot()`/`snapshotLayout()`), becomes what applying and the public preview use; its pictures are copied from the
 * workspace's library when applied. A profile without a workspace (made before D177 and not edited) keeps its snapshot. Refused while
 * archived. Stores that applied it keep what they got.
 */
export async function publishDesign(admin: Account, id: string): Promise<DesignResult<{ notes: string[] }>> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const design = await getDesign(id);
  if (!design) return refuse(UNKNOWN);
  if (design.archivedAt) return refuse("This design profile is archived. Restore it before publishing it.");
  let snapshot: DesignSnapshot | null = null;
  const notes: string[] = [];
  if (design.workspaceStoreId) {
    const taken = await takeSnapshot(design.workspaceStoreId, { drafts: true });
    if (!taken.ok) return taken;
    snapshot = taken.snapshot;
    notes.push(...taken.notes);
  } else if (!design.readable) {
    return refuse("Its snapshot can no longer be read: open its Theme to make it again.");
  }
  const details = shownDesignDetails(design);
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.design_presets
         set title = ${details.title}, summary = ${details.summary}, description = ${details.description}, picture_url = ${details.pictureUrl}, draft = null,
             ${snapshot
               ? sql`snapshot = ${JSON.stringify(snapshot)}::jsonb, snapshot_at = now(), source_store_id = ${design.workspaceStoreId}::uuid, workspace_key = ${snapshotKey(snapshot)},`
               : sql``}
             published = true, published_at = now(), updated_by = ${admin.id}::uuid
       where id = ${id}::uuid and archived_at is null
      returning id
    `);
    if (!row) return refuse("This design profile is archived. Restore it before publishing it.");
  } catch (error) {
    return refuse(designProblem(error));
  }
  await audit(admin.id, design.workspaceStoreId, "platform.design_preset_published", { preset: id, snapshot: snapshot !== null }, { target: { type: "design_preset", id } });
  return { ok: true, notes };
}

/** Stops offering a profile at once (D177): stores that applied it keep their look; pending sign-ups that chose it keep the template's own. */
export async function unpublishDesign(admin: Account, id: string): Promise<DesignResult<{ pendingRequests: number }>> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const [row] = await db().execute<Row>(sql`
    update commerce.design_presets set published = false, updated_by = ${admin.id}::uuid where id = ${id}::uuid and published
    returning workspace_store_id,
      (select count(*)::int from commerce.access_requests r where r.design_preset_id = ${id}::uuid and r.status = 'pending') as pending
  `);
  if (!row) return { ok: true, pendingRequests: 0 };
  await audit(admin.id, row.workspace_store_id ? String(row.workspace_store_id) : null, "platform.design_preset_unpublished", { preset: id }, {
    target: { type: "design_preset", id },
  });
  return { ok: true, pendingRequests: Number(row.pending ?? 0) };
}

/**
 * Archives a profile (D177): unpublished, hidden from every list but the platform's Archived filter, and no longer any store template's
 * recommended profile (published or drafted): the templates it was cleared from are named back.
 */
export async function archiveDesign(admin: Account, id: string): Promise<DesignResult<{ clearedFrom: string[] }>> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const done = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      update commerce.design_presets set archived_at = now(), archived_by = ${admin.id}::uuid, published = false, updated_by = ${admin.id}::uuid
       where id = ${id}::uuid and archived_at is null
      returning workspace_store_id
    `);
    if (!row) return null;
    const cleared = await tx.execute<Row>(sql`
      update commerce.store_starters set recommended_design = null where recommended_design = ${id}::uuid returning title
    `);
    const drafts = await tx.execute<Row>(sql`
      update commerce.store_starters set draft = jsonb_set(draft, '{recommendedDesign}', 'null'::jsonb)
       where draft ->> 'recommendedDesign' = ${id} returning coalesce(draft ->> 'title', title) as title
    `);
    return { workspace: row.workspace_store_id ? String(row.workspace_store_id) : null, cleared: [...new Set([...cleared, ...drafts].map((r) => String(r.title)))] };
  });
  if (!done) return { ok: true, clearedFrom: [] };
  await audit(admin.id, done.workspace, "platform.design_preset_archived", { preset: id, clearedFrom: done.cleared }, { target: { type: "design_preset", id } });
  return { ok: true, clearedFrom: done.cleared };
}

/** Restores an archived profile (D177): back in the list as an unpublished draft. */
export async function restoreDesign(admin: Account, id: string): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const [row] = await db().execute<Row>(sql`
    update commerce.design_presets set archived_at = null, archived_by = null, updated_by = ${admin.id}::uuid
     where id = ${id}::uuid and archived_at is not null
    returning workspace_store_id
  `);
  if (row) await audit(admin.id, row.workspace_store_id ? String(row.workspace_store_id) : null, "platform.design_preset_restored", { preset: id }, { target: { type: "design_preset", id } });
  return { ok: true };
}

/**
 * Deletes a profile nothing used (D177): no store applied it and no access request names it (the database refuses otherwise,
 * `design_presets.used` / `.requested`); a store template recommending it recommends none after (the database clears it). Its workspace is
 * closed and stays (D171), hidden.
 */
export async function deleteDesign(admin: Account, id: string): Promise<DesignResult<{ clearedFrom: string[] }>> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const design = await getDesign(id);
  if (!design) return refuse(UNKNOWN);
  const blocker = deleteBlocker("design profile", { stores: design.storesUsing, requests: design.requests });
  if (blocker) return refuse(blocker);
  try {
    await db().transaction(async (tx) => {
      await tx.execute(sql`delete from commerce.design_presets where id = ${id}::uuid`);
      if (design.workspaceStoreId) {
        await tx.execute(sql`
          update commerce.stores set status = 'closed', status_reason = 'Its design profile was deleted.', status_changed_by = ${admin.id}::uuid
           where id = ${design.workspaceStoreId}::uuid and status <> 'closed'
        `);
      }
    });
  } catch (error) {
    return refuse(designProblem(error));
  }
  await audit(admin.id, design.workspaceStoreId, "platform.design_preset_deleted", { preset: id, title: design.title, clearedFrom: design.recommendedBy }, {
    target: { type: "design_preset", id },
  });
  return { ok: true, clearedFrom: design.recommendedBy };
}

/** Moves a design profile one place up or down in the order stores see; the order is written again as 1, 2, 3 … */
export async function moveDesign(admin: Account, id: string, direction: "up" | "down"): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const moved = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commerce.design_presets.position'))`);
    const rows = await tx.execute<Row>(sql`select id from commerce.design_presets where archived_at is null order by position, lower(title), id`);
    const order = movedOrder(rows.map((r) => String(r.id)), id, direction);
    if (!order) return false;
    for (const [index, presetId] of order.entries()) {
      await tx.execute(sql`update commerce.design_presets set position = ${index + 1} where id = ${presetId}::uuid and position <> ${index + 1}`);
    }
    return true;
  });
  if (moved) await audit(admin.id, null, "platform.design_preset_moved", { preset: id, direction }, { target: { type: "design_preset", id } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** What applying reaches outside the database: Storage's copy and Google Fonts, replaceable in tests. */
export type ApplyDeps = {
  copyFile?: typeof copyStoredFile;
  installFonts?: (families: string[]) => Promise<{ ok: true } | { ok: false; problem: string }>;
};

export type ApplyResult = DesignResult<{ useId: string; savedTheme: string; notes: string[] }>;

/** The look a store has now, as a use keeps it to put back: the theme as stored, the chosen layouts and the site's CSS. */
type PreviousLook = { theme: unknown; headerId: string | null; footerId: string | null; productLayoutId: string | null; css: string };

/** Who may change a store's look here: a platform admin, or someone who works in the store (the caller checked their permission). */
async function actorFacts(storeId: string, accountId: string) {
  const [row] = await db().execute<Row>(sql`
    select s.slug, s.status, s.starter, s.header_menu_id, s.footer_menu_id, ${NOT_HIDDEN} as workable,
      (select a.platform_admin and a.disabled_at is null from commerce.accounts a where a.id = ${accountId}::uuid) as platform_admin,
      exists (
        select 1 from commerce.store_members m
        where m.store_id = s.id and m.account_id = ${accountId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      ) as member
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  return row;
}

/** The cache tags a change of a store's look touches: its store (theme, CSS), its pages (header, footer) and its catalogue (product layouts). */
export const designTags = (store: { id: string; slug: string }): string[] => [storeTag(store.slug), pagesTag(store.id), catalogTag(store.id)];

/** A snapshot made ready for a store, before anything of the store is written (`placeSnapshot()`). */
type Placed = { pages: Partial<Record<DesignLayoutKind, PageContent>>; siteCss: string; notes: string[]; copies: number; leftOut: number };

/**
 * Makes a snapshot ready for a store (D176, shared by applying and by writing a profile's workspace, D177): the fonts installed (D59), the
 * source store's pictures copied into the store's library as D125's `applyTemplate()` copies a template's (any other upload left out), each
 * layout placed with the store's own menus (`layoutForStore()`) and checked as the builder checks a save (`pageInput`,
 * `pageRulesProblem()`, no other store's file left), and the CSS checked. Writes nothing but the fonts and the pictures' copies.
 */
async function placeSnapshot(
  storeId: string,
  snapshot: DesignSnapshot,
  options: { sourceId: string | null; accountId: string; title: string; menus: Row; deps?: ApplyDeps },
): Promise<DesignResult<Placed>> {
  // Fonts first (D59): a page never shows a font Kaizen does not have.
  const fonts = snapshotFonts(snapshot);
  const unknown = fonts.filter((family) => !findFont(family));
  if (unknown.length > 0) return refuse(`${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not in Google Fonts.`);
  const installed = await (options.deps?.installFonts ?? installFonts)(fonts);
  if (!installed.ok) return refuse(installed.problem);

  // Pictures and videos: the source store's own files are copied into this store's library (D125's way); any other upload is left out.
  const wanted = snapshotStorageUrls(snapshot);
  const sourceId = options.sourceId;
  const files = sourceId && sourceId !== storeId ? await libraryFilesByUrl(sourceId, wanted) : new Map<string, LibraryFile>();
  const replaced = new Map<string, string>();
  if (sourceId === storeId) for (const url of wanted) replaced.set(url, url);
  const chosen = new Map<string, LibraryFile>();
  let bytes = 0;
  for (const url of wanted) {
    const file = files.get(url);
    if (!file || chosen.has(file.id)) continue;
    if (chosen.size >= TEMPLATE_MEDIA_MAX || bytes + file.sizeBytes > TEMPLATE_MEDIA_BYTES_MAX) continue;
    chosen.set(file.id, file);
    bytes += file.sizeBytes;
  }
  const copies = new Map<string, { url: string; thumbnailUrl: string | null }>();
  for (const file of chosen.values()) {
    const copy = await copyToLibrary({ storeId, accountId: options.accountId }, file, options.deps?.copyFile);
    if (copy) copies.set(file.id, copy);
  }
  for (const url of wanted) {
    const file = files.get(url);
    const copy = file && copies.get(file.id);
    const next = copy ? (url === file.thumbnailUrl && url !== file.url ? copy.thumbnailUrl : copy.url) : null;
    if (next) replaced.set(url, next);
  }
  const mapped = mapSnapshotMedia(snapshot, (url) => (isStorageUrl(url) ? (replaced.get(url) ?? null) : url));
  const notes: string[] = [];
  const leftOut = new Set(wanted.filter((url) => !replaced.has(url))).size;
  if (leftOut > 0) notes.push(`${leftOut} ${leftOut === 1 ? "picture" : "pictures"} could not be copied and ${leftOut === 1 ? "was" : "were"} left out.`);

  // The pages, checked as the builder checks a save; their addresses are chosen inside the transaction.
  const menus = { header: options.menus.header_menu_id ? String(options.menus.header_menu_id) : null, footer: options.menus.footer_menu_id ? String(options.menus.footer_menu_id) : null };
  const pages: Partial<Record<DesignLayoutKind, PageContent>> = {};
  for (const kind of DESIGN_LAYOUT_KINDS) {
    const layout = mapped[kind];
    if (!layout) continue;
    const content = layoutForStore(layout, menus, { title: designPageTitle(kind, options.title), slug: "design" });
    const parsed = pageInput.safeParse(content);
    const problem = parsed.success ? pageRulesProblem(storeId, LAYOUT_PAGE_TYPE[kind], parsed.data) : parsed.error.issues[0]?.message;
    if (problem || !parsed.success) return refuse(`The profile's ${designPageTitle(kind, "").trim()} does not fit this store: ${problem ?? "it cannot be read"}`);
    if (leftoverStorageUrls(parsed.data, new Set(replaced.values())).length > 0) return refuse("This design profile could not be made ready for your store.");
    pages[kind] = parsed.data;
  }
  const siteCss = cssProblem(mapped.css) === null ? mapped.css : "";

  return { ok: true, pages, siteCss, notes, copies: copies.size, leftOut };
}

/**
 * Applies a design profile to a store (D176): the one writer. Refused for a store that is not open (D171) or that the account neither works
 * in nor runs the platform for, and for a profile that is not published (a platform admin may try an unpublished one on a store template).
 * Before anything is written the profile's fonts are installed (D59) and its pictures copied into the store's media library as D125's
 * `applyTemplate()` copies a template's; then in one transaction: the store's look now is kept as a saved theme ("Before …", D60) and in
 * the use's `previous`, the theme's settings are written, new header, footer and product layout pages are made from the snapshot
 * (published, checked by `pageInput` and `pageRulesProblem()` as the builder's saves are; never over the store's own pages) and chosen, and
 * the site's CSS is set. Never the store's name, logos, business details, menus, pages or products. The caller refreshes `designTags()`.
 */
export async function applyDesignPreset(storeId: string, presetId: string, accountId: string, deps: ApplyDeps = {}): Promise<ApplyResult> {
  if (!isUuid(storeId) || !isUuid(presetId) || !isUuid(accountId)) return refuse(UNKNOWN);
  const facts = await actorFacts(storeId, accountId);
  if (!facts) return refuse("That store no longer exists.");
  const platformAdmin = Boolean(facts.platform_admin);
  if (!platformAdmin && !facts.member) return refuse("You do not work in this store.");
  if (facts.status !== "active") return refuse("The store is not open, so its look cannot be changed.");
  // A store the platform keeps for itself (a store template's frozen copy, a profile's workspace, D177) is never changed by applying.
  if (!facts.workable) return refuse(KEPT);

  const [preset] = await db().execute<Row>(sql`
    select id, title, snapshot, published, archived_at, source_store_id from commerce.design_presets where id = ${presetId}::uuid
  `);
  if (!preset) return refuse(UNKNOWN);
  if (preset.archived_at || (!preset.published && !(platformAdmin && facts.starter))) return refuse(NOT_OFFERED);
  const snapshot = parseDesignSnapshot(preset.snapshot);
  if (!snapshot) return refuse("This design profile can no longer be read.");
  const title = String(preset.title);

  const ready = await placeSnapshot(storeId, snapshot, { sourceId: preset.source_store_id ? String(preset.source_store_id) : null, accountId, title, menus: facts, deps });
  if (!ready.ok) return ready;
  const { pages, siteCss, notes } = ready;

  let applied: { useId: string; savedTheme: string; pageIds: Record<string, string | null> };
  try {
    applied = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`
        select status, theme, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${storeId}::uuid for update
      `);
      if (!store || store.status !== "active") throw new Refused("The store is not open, so its look cannot be changed.");
      const previous: PreviousLook = {
        theme: store.theme ?? {},
        headerId: store.header_id ? String(store.header_id) : null,
        footerId: store.footer_id ? String(store.footer_id) : null,
        productLayoutId: store.product_layout_id ? String(store.product_layout_id) : null,
        css: String(store.custom_css ?? ""),
      };
      // The look before, as a saved theme the owner can switch back to (D60).
      const before = parseStoreTheme(store.theme);
      const names = await tx.execute<Row>(sql`select name from commerce.store_themes where store_id = ${storeId}::uuid`);
      const savedTheme = beforeThemeName(title, new Date().toISOString().slice(0, 10), names.map((r) => String(r.name)));
      const [saved] = await tx.execute<Row>(sql`
        insert into commerce.store_themes (store_id, name, base, settings, created_by)
        values (${storeId}::uuid, ${savedTheme}, ${before.base}, ${JSON.stringify(before.settings)}::jsonb, ${accountId}::uuid)
        returning id
      `);
      // New pages, never over the store's own.
      const pageIds: Record<string, string | null> = { header: null, footer: null, productLayout: null };
      for (const kind of DESIGN_LAYOUT_KINDS) {
        const page = pages[kind];
        if (!page) continue;
        const type = LAYOUT_PAGE_TYPE[kind];
        const taken = await tx.execute<Row>(sql`select slug from commerce.pages where store_id = ${storeId}::uuid and type = ${type}`);
        const slug = designPageSlug(kind, title, taken.map((r) => String(r.slug)));
        const json = JSON.stringify({ ...page, slug });
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
          values (${storeId}::uuid, ${type}, ${slug}, ${json}::jsonb, ${json}::jsonb, now(), now(), ${accountId}::uuid, ${accountId}::uuid)
          returning id
        `);
        pageIds[kind] = String(row.id);
      }
      const theme = { base: snapshot.theme.base, savedId: null, settings: snapshot.theme.settings };
      await tx.execute(sql`
        update commerce.stores set theme = ${JSON.stringify(theme)}::jsonb, custom_css = ${siteCss},
          header_id = ${pageIds.header}::uuid, footer_id = ${pageIds.footer}::uuid, product_layout_id = ${pageIds.productLayout}::uuid
        where id = ${storeId}::uuid
      `);
      const [use] = await tx.execute<Row>(sql`
        insert into commerce.design_preset_uses (store_id, preset_id, previous, saved_theme_id, applied_by)
        values (${storeId}::uuid, ${presetId}::uuid, ${JSON.stringify(previous)}::jsonb, ${String(saved.id)}::uuid, ${accountId}::uuid)
        returning id
      `);
      return { useId: String(use.id), savedTheme, pageIds };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    console.error("[design-presets] applying failed", error);
    return refuse("The design profile could not be applied. Nothing was changed; try again.");
  }
  await audit(
    accountId,
    storeId,
    "store.design_preset_applied",
    {
      preset: presetId,
      title,
      savedTheme: applied.savedTheme,
      pages: applied.pageIds,
      media: ready.copies,
      ...(ready.leftOut > 0 && { mediaLeftOut: ready.leftOut }),
      ...(platformAdmin && !facts.member && { byPlatform: true }),
    },
    { area: "website", target: { type: "design_preset", id: presetId } },
  );
  return { ok: true, useId: applied.useId, savedTheme: applied.savedTheme, notes };
}

class Refused extends Error {}

/** The store's latest use of a design profile, for its design settings: what was applied, when, and whether the look before can be put back. */
export async function latestDesignUse(storeId: string): Promise<{
  id: string;
  presetTitle: string;
  appliedAt: string;
  savedTheme: string | null;
} | null> {
  const [row] = await db().execute<Row>(sql`
    select u.id, u.applied_at, u.restored_at, d.title, t.name as saved_theme
    from commerce.design_preset_uses u
    join commerce.design_presets d on d.id = u.preset_id
    left join commerce.store_themes t on t.id = u.saved_theme_id
    where u.store_id = ${storeId}::uuid and u.restored_at is null
    order by u.applied_at desc, u.id desc limit 1
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    presetTitle: String(row.title),
    appliedAt: new Date(String(row.applied_at)).toISOString(),
    savedTheme: row.saved_theme ? String(row.saved_theme) : null,
  };
}

/**
 * Puts back the look a store had before its latest design profile (D176): the theme as it was, the header, footer and product layout it had
 * chosen (each while it still exists and is published, else the standard one), and its CSS. The pages the profile made stay, unchosen; the
 * saved theme stays. Uses are put back newest first, so doing it again goes one profile further back.
 */
export async function restoreDesignLook(storeId: string, accountId: string): Promise<DesignResult<{ presetTitle: string }>> {
  if (!isUuid(storeId) || !isUuid(accountId)) return refuse("Unknown store.");
  const facts = await actorFacts(storeId, accountId);
  if (!facts) return refuse("That store no longer exists.");
  if (!facts.platform_admin && !facts.member) return refuse("You do not work in this store.");
  if (facts.status !== "active") return refuse("The store is not open, so its look cannot be changed.");
  if (!facts.workable) return refuse(KEPT);
  let done: { useId: string; presetId: string; presetTitle: string };
  try {
    done = await db().transaction(async (tx) => {
      await tx.execute(sql`select 1 from commerce.stores where id = ${storeId}::uuid for update`);
      const [use] = await tx.execute<Row>(sql`
        select u.id, u.preset_id, u.previous, d.title from commerce.design_preset_uses u join commerce.design_presets d on d.id = u.preset_id
        where u.store_id = ${storeId}::uuid and u.restored_at is null
        order by u.applied_at desc, u.id desc limit 1 for update of u
      `);
      if (!use) throw new Refused("There is no look from before to put back.");
      const previous = (use.previous ?? {}) as Partial<PreviousLook>;
      const live = async (id: unknown, type: string) => {
        if (typeof id !== "string" || !isUuid(id)) return null;
        const [page] = await tx.execute<Row>(sql`
          select id from commerce.pages where store_id = ${storeId}::uuid and id = ${id}::uuid and type = ${type} and published_at is not null
        `);
        return page ? id : null;
      };
      const css = typeof previous.css === "string" && cssProblem(previous.css) === null ? previous.css : "";
      await tx.execute(sql`
        update commerce.stores set theme = ${JSON.stringify(previous.theme ?? {})}::jsonb, custom_css = ${css},
          header_id = ${await live(previous.headerId, "header")}::uuid,
          footer_id = ${await live(previous.footerId, "footer")}::uuid,
          product_layout_id = ${await live(previous.productLayoutId, "product_layout")}::uuid
        where id = ${storeId}::uuid
      `);
      await tx.execute(sql`update commerce.design_preset_uses set restored_at = now(), restored_by = ${accountId}::uuid where id = ${String(use.id)}::uuid`);
      return { useId: String(use.id), presetId: String(use.preset_id), presetTitle: String(use.title) };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    return refuse(designProblem(error));
  }
  await audit(accountId, storeId, "store.design_preset_restored", { preset: done.presetId, use: done.useId }, {
    area: "website",
    target: { type: "design_preset", id: done.presetId },
  });
  return { ok: true, presetTitle: done.presetTitle };
}

/** Whether a profile may be chosen when a store is made: published and readable (the server's check of a form's choice). */
export async function isOfferedDesign(presetId: string): Promise<boolean> {
  if (!isUuid(presetId)) return false;
  const [row] = await db().execute<Row>(sql`select snapshot from commerce.design_presets where id = ${presetId}::uuid and published`);
  return row !== undefined && parseDesignSnapshot(row.snapshot) !== null;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** What the preview draws: the profile's title and snapshot, and the store whose front page and product it is drawn on. */
export type DesignPreview = {
  id: string;
  title: string;
  snapshot: DesignSnapshot;
  storeSlug: string;
  starterTitle: string | null;
  /** The profile's fonts that Kaizen has (D59): only these are linked, so a font not installed yet never holds the preview back. */
  fonts: string[];
  /** The look in the profile's workspace, not yet published (D177, admins only). */
  draft: boolean;
};

async function readPreview(presetId: string, starterId: string | null, admin: boolean, draft = false): Promise<DesignPreview | null> {
  if (!isUuid(presetId) || (starterId !== null && !isUuid(starterId))) return null;
  const [preset] = await readDb().execute<Row>(sql`
    select id, title, draft, snapshot, workspace_store_id from commerce.design_presets
    where id = ${presetId}::uuid and (${admin} or (published and archived_at is null))
  `);
  if (!preset) return null;
  // A draft (D177, admins only) is the look in the profile's workspace as last saved, with its draft title.
  const taken = draft && preset.workspace_store_id ? await takeSnapshot(String(preset.workspace_store_id), { drafts: true }) : null;
  const snapshot = taken ? (taken.ok ? taken.snapshot : null) : parseDesignSnapshot(preset.snapshot);
  if (!snapshot) return null;
  const title = draft ? (readDesignDraft(preset.draft)?.title ?? String(preset.title)) : String(preset.title);
  // Owners see a store template as published: its frozen copy (D177). An admin sees its working store, as it is now.
  const [store] = starterId
    ? await readDb().execute<Row>(sql`
        select s.slug, st.title from commerce.store_starters st
        join commerce.stores s on s.id = ${admin ? sql`st.store_id` : sql`coalesce(st.published_store_id, st.store_id)`} and s.starter
        where st.id = ${starterId}::uuid and s.status = 'active' and (${admin} or (st.published and st.archived_at is null))
      `)
    : await readDb().execute<Row>(sql`select slug, null as title from commerce.stores where is_template`);
  if (!store) return null;
  const wanted = snapshotFonts(snapshot);
  const installed = wanted.length === 0
    ? []
    : await readDb().execute<Row>(sql`select family from commerce.fonts where family in (${sql.join(wanted.map((f) => sql`${f}`), sql`, `)})`);
  const fonts = wanted.filter((family) => installed.some((row) => row.family === family));
  return { id: String(preset.id), title, snapshot, storeSlug: String(store.slug), starterTitle: store.title ? String(store.title) : null, fonts, draft: taken !== null };
}

/**
 * A published profile on a published store template (or the default template), for the public preview: cached per profile and template
 * under `DESIGNS_TAG` and `STARTERS_TAG`, null for anything unpublished or archived. Reads nothing of the visitor.
 */
export async function publicDesignPreview(presetId: string, starterId: string | null): Promise<DesignPreview | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  return readPreview(presetId, starterId, false);
}

/**
 * The same for a platform admin (the caller checked): unpublished and archived profiles and templates too, and with `draft` the look in the
 * profile's workspace as last saved (D177). Never cached.
 */
export async function adminDesignPreview(presetId: string, starterId: string | null, draft = false): Promise<DesignPreview | null> {
  return readPreview(presetId, starterId, true, draft);
}

/** Every published store template, for the preview's chooser and the platform's pages. */
export async function previewStarters(): Promise<{ id: string; title: string }[]> {
  const rows = await readDb().execute<Row>(sql`
    select st.id, st.title from commerce.store_starters st
    join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.status = 'active'
    where st.published and st.archived_at is null order by st.position, lower(st.title)
  `);
  return rows.map((r) => ({ id: String(r.id), title: String(r.title) }));
}
