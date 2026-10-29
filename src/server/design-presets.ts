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
  snapshotAsStored,
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
import { installedLook, presetLine, publishedVariations, variationSnapshot, variationsOf, type DraftVariation, type PresetLineWords } from "@/lib/design-variations";
import { pageInput, parsePageContent, type PageContent } from "@/lib/page-content";
import { copyRow } from "@/lib/page-rows";
import { storeOrigins } from "@/lib/paths";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { defaultFooter, defaultHeader } from "@/lib/site-layout";
import { movedOrder } from "@/lib/store-starters";
import { TEMPLATE_MEDIA_BYTES_MAX, TEMPLATE_MEDIA_MAX, isStorageUrl, leftoverStorageUrls } from "@/lib/template-content";
import { parseStoreTheme, templateSettings, themeSettingsSchema } from "@/lib/theme";
import { withCoreStyles } from "@/lib/launch-themes";
import { OWN_SLOTS, THEME_SLUG, isThemePicture, readListing, themeLooks, type OwnSlot, type ThemeListing } from "@/lib/theme-store";
import { blockingLines, themeCheck, type ThemeCheckResult } from "@/lib/theme-check";
import { coreStylesRemoved, cssFate, layoutFate, layoutFingerprintSource, mergeSettings, whatsNew, type Placed as PlacedLook, type WhatsNewWords } from "@/lib/theme-update";

import { audit, type Account } from "./auth";
import { catalogTag } from "./catalog";
import { findFont, installFonts } from "./fonts";
import { log } from "./log";
import { copyStoredFile } from "./media";
import { copyToLibrary, libraryFilesByUrl, type LibraryFile } from "./media-library";
import { pageRulesProblem } from "./page-rules";
import { pagesTag } from "./pages";
import { STARTERS_TAG, publishStarter, publishedContents, themeContentOf } from "./store-starters";
import { storeTag } from "./stores";
import { INSTALLS_FULL, INSTALLS_MAX, InstallRefused, installCount, makeLive, putAwayLive } from "./theme-installs";
import { CHARGE_CHANGED, isChargeRefusal, setThemeCharge, themePrices } from "./theme-prices";
import { askForThemeShots, lookOf, themeShotsFor } from "./theme-shots";
import { carryTextStyles } from "./text-styles";
import { parseSiteFonts } from "@/lib/fonts-schema";

import { platformTheme } from "./platform-navigation";
import { PLATFORM_INSTALLS_MAX, platformInstallCount, type PlatformLook } from "./platform-theme-installs";

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
const UNKNOWN = "Unknown theme.";
const NOT_OFFERED = "That theme is not offered any more. Choose another.";
const NO_PRESET = "This theme has no such preset any more. Choose another.";
const KEPT = "This store is kept by the platform (a demo store's published copy or a theme's workspace): its look is not changed here.";

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
  return designRefusal(describe(error)) ?? "The theme could not be saved. Nothing was changed; try again.";
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
  return rows.flatMap((row) => {
    const snapshot = parseDesignSnapshot(row.snapshot);
    if (!snapshot) return [];
    const presets = variationsOf(snapshot).map((v) => ({ key: v.key, name: v.name }));
    return [{ ...toOffered(row), ...(presets.length > 0 && { presets }) }];
  });
}

/**
 * What the create-store and sign-up forms offer (D273, cached under `DESIGNS_TAG` and `STARTERS_TAG`): the Standard card first, then each
 * published theme with its preview and its presets, each saying what a new store starts with: the theme's own content (D275,
 * `contentForLook()`).
 */
export async function designChoices(): Promise<{ cards: DesignCard[] }> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  const [offered, contents] = await Promise.all([listOfferedDesigns(), publishedContents()]);
  // A theme without a picture of its own shows the card made from its own look's photograph (`docs/theme-showcase-phase-2.md` step 1),
  // and a premium theme its price (D286).
  const [shots, prices] = await Promise.all([themeShotsFor(offered.map((d) => d.id)), themePrices(offered.map((d) => d.id))]);
  // Each look on the theme's own content, which a store started from it is copied from (D275).
  const card = (d: OfferedDesign): DesignCard => {
    const looks = themeLooks(d.title, d.presets ?? [], contents.get(d.id) ?? null);
    const own = looks.find((look) => look.key === null)?.showcase ?? null;
    const starterOf = (key: string | null) => looks.find((look) => look.key === key)?.showcase?.starterId ?? null;
    return {
      ...d,
      pictureUrl: d.pictureUrl ?? shots.get(lookOf(d.id, null))?.computer?.card?.url ?? null,
      previewHref: designPreviewPath(d.id, starterOf(null)),
      prices: prices.get(d.id) ?? [],
      starterId: own?.starterId ?? null,
      demo: own?.line ?? null,
      looks: looks.flatMap((look) =>
        look.key === null
          ? []
          : [
              {
                key: look.key,
                name: look.name,
                trade: look.showcase?.trade ?? null,
                starterId: look.showcase?.starterId ?? null,
                demo: look.showcase?.line ?? null,
                previewHref: designPreviewPath(d.id, starterOf(look.key), false, false, false, look.key),
              },
            ],
      ),
    };
  };
  return { cards: [keepDesignCard(), ...offered.map(card)] };
}

/**
 * What a theme's look starts a new store with (D275): the theme's own published content, the same for every preset; null (the Standard
 * store) for a theme that is not published or has no published content. Sign-up, creating a store and approving a request all ask it, so a
 * new store's content always follows the theme chosen; nobody chooses it apart.
 */
export async function contentForLook(look: { id: string; variation: string | null } | null): Promise<string | null> {
  if (!look || !isUuid(look.id)) return null;
  const [row] = await db().execute<Row>(sql`
    select st.id from commerce.design_presets p
      join commerce.store_starters st on st.design_preset_id = p.id and st.published and st.archived_at is null
      join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.starter and s.status = 'active'
     where p.id = ${look.id}::uuid and p.published and p.archived_at is null
  `);
  return row ? String(row.id) : null;
}

const ROW_SELECT = sql`
  select d.id, d.title, d.summary, d.description, d.picture_url, d.published, d.position, d.snapshot_at, d.snapshot,
         d.source_store_id, s.name as source_name, s.slug as source_slug, d.draft, d.workspace_store_id, w.slug as workspace_slug,
         d.workspace_key, d.published_at, d.archived_at, d.slug, d.listing,
         (select count(distinct x.store_id)::int from (
            select u.store_id from commerce.design_preset_uses u where u.preset_id = d.id
            union select i.store_id from commerce.store_theme_installs i where i.preset_id = d.id
          ) x) as stores_using,
         exists (select 1 from commerce.platform_theme_installs p where p.preset_id = d.id) as on_platform,
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
    onPlatform: Boolean(row.on_platform),
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
    slug: row.slug ? String(row.slug) : null,
    listing: readListing(row.listing),
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
  const taken = await draftedSnapshot(design);
  return taken.ok ? snapshotKey(taken.snapshot) !== design.workspaceKey : false;
}

/**
 * A theme's presets as drafted (`commerce.design_variations`, `docs/theme-showcase-phase-1.md`), in order: what its *Presets* tab edits and
 * what Publish writes into the version.
 */
export async function draftVariations(presetId: string): Promise<DraftVariation[]> {
  if (!isUuid(presetId)) return [];
  const rows = await db().execute<Row>(sql`
    select id, key, name, position, theme from commerce.design_variations where preset_id = ${presetId}::uuid order by position, key
  `);
  return rows.map((row) => {
    const theme = parseStoreTheme(row.theme);
    return { id: String(row.id), key: String(row.key), name: String(row.name), position: Number(row.position), theme: { base: theme.base, settings: theme.settings } };
  });
}

/**
 * What Publish would publish (D177 and the presets): the look in the theme's workspace as last saved, with its presets as drafted, in the form
 * it is stored (version 2 only when it has presets, so a theme without them keeps its key and versions as before).
 */
async function draftedSnapshot(design: Pick<DesignRow, "id" | "workspaceStoreId">): Promise<DesignResult<{ snapshot: DesignSnapshot; notes: string[] }>> {
  if (!design.workspaceStoreId) return refuse("This theme has no workspace yet.");
  const taken = await takeSnapshot(design.workspaceStoreId, { drafts: true });
  if (!taken.ok) return taken;
  const variations = publishedVariations(await draftVariations(design.id));
  return { ok: true, snapshot: snapshotAsStored({ ...taken.snapshot, variations }), notes: taken.notes };
}

/** Facts for the state and the buttons (`src/lib/lifecycle.ts`). */
export async function designLifecycle(design: DesignRow) {
  return {
    published: design.published,
    archivedAt: design.archivedAt,
    publishedAt: design.publishedAt,
    changed: await designChanged(design),
    used: design.storesUsing > 0 || design.requests > 0 || design.onPlatform,
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
  if (!snapshot) return refuse("The store's look could not be read as a theme. Check its header, footer and product layout in the builder.");
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
          update commerce.stores set starter = true, theme = ${JSON.stringify({ ...STANDARD_THEME, settings: withCoreStyles(STANDARD_THEME.settings) })}::jsonb, custom_css = '',
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
  if (!snapshot) return refuse("This theme can no longer be read, so it cannot be edited.");
  const made = await makeWorkspace(admin);
  const written = await writeWorkspaceLook(made.id, snapshot, { sourceId: found.sourceId, accountId: admin.id, title: found.title, deps });
  if (!written.ok) {
    await closeWorkspace(made.id, admin.id, "Its theme's look could not be written into it.");
    return written;
  }
  const taken = await takeSnapshot(made.id, { drafts: true });
  const [linked] = await db().execute<Row>(sql`
    update commerce.design_presets set workspace_store_id = ${made.id}::uuid, workspace_key = ${taken.ok ? snapshotKey(taken.snapshot) : null}
     where id = ${presetId}::uuid and workspace_store_id is null
    returning id
  `);
  if (!linked) {
    await closeWorkspace(made.id, admin.id, "Another workspace was made for its theme first.");
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
      // A theme from a store or from before D246 gets the core section styles it lacks (D246), so it can pass the checks.
      const theme = { base: snapshot.theme.base, savedId: null, settings: withCoreStyles(snapshot.theme.settings) };
      await tx.execute(sql`
        update commerce.stores set theme = ${JSON.stringify(theme)}::jsonb, custom_css = ${placed.siteCss},
          header_id = ${chosen.header}::uuid, footer_id = ${chosen.footer}::uuid, product_layout_id = ${chosen.productLayout}::uuid
        where id = ${storeId}::uuid
      `);
    });
  } catch (error) {
    log("error", "design_presets.workspace_write_failed", {}, error);
    return refuse("The look could not be written into the theme. Nothing was changed; try again.");
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
  if (!admin.platformAdmin) return refuse("Only Kaizena Flow's admins make themes.");
  const { origin } = input;
  const notes: string[] = [];
  let source: DesignSnapshot | null = null;
  if (origin.kind === "store") {
    if (!isUuid(origin.storeId) || !(await works(admin.id, origin.storeId))) return refuse("Choose a store you work in.");
    const taken = await takeSnapshot(origin.storeId);
    if (!taken.ok) return taken;
    source = taken.snapshot;
    notes.push(...taken.notes);
  } else if (origin.kind === "look") {
    source = origin.snapshot;
  }
  const workspace = await makeWorkspace(admin);
  if (source && origin.kind !== "scratch") {
    const written = await writeWorkspaceLook(workspace.id, source, { sourceId: origin.storeId, accountId: admin.id, title: input.details.title, deps });
    if (!written.ok) {
      await closeWorkspace(workspace.id, admin.id, "Its theme could not be made.");
      return written;
    }
    notes.push(...written.notes);
  }
  const fresh = await takeSnapshot(workspace.id, { drafts: true });
  if (!fresh.ok) {
    await closeWorkspace(workspace.id, admin.id, "Its theme could not be made.");
    return fresh;
  }
  const { title, summary, description, pictureUrl } = input.details;
  let id: string;
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.design_presets (title, summary, description, picture_url, snapshot, source_store_id, workspace_store_id, workspace_key,
        position, published, author_id, author_name, created_by, updated_by)
      values (${title}, ${summary}, ${description}, ${pictureUrl}, ${JSON.stringify(fresh.snapshot)}::jsonb, ${workspace.id}::uuid, ${workspace.id}::uuid,
        ${snapshotKey(fresh.snapshot)}, (select coalesce(max(position), 0) + 1 from commerce.design_presets), false,
        ${origin.kind === "look" ? origin.author.id : null}::uuid, ${origin.kind === "look" ? origin.author.name : null}, ${admin.id}::uuid, ${admin.id}::uuid)
      returning id
    `);
    id = String(row.id);
  } catch (error) {
    await closeWorkspace(workspace.id, admin.id, "Its theme could not be made.");
    return refuse(designProblem(error));
  }
  await audit(admin.id, origin.kind === "scratch" ? workspace.id : origin.storeId, "platform.design_preset_created", {
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
 * Writes a look into a profile's workspace as its draft (D246): what Kaizena Flow's launch themes are written with
 * (`syncLaunchThemes()`), as *Start again from a store* writes a store's. Only the draft changes until Publish.
 */
export async function writeDesignLook(admin: Account, presetId: string, snapshot: DesignSnapshot, deps: ApplyDeps = {}): Promise<DesignResult<{ notes: string[] }>> {
  if (!admin.platformAdmin || !isUuid(presetId)) return refuse(UNKNOWN);
  const parsed = parseDesignSnapshot(snapshot);
  if (!parsed) return refuse("That look cannot be read as a theme.");
  const ready = await ensureWorkspace(admin, presetId, deps);
  if (!ready.ok) return ready;
  return writeWorkspaceLook(ready.workspace.store.id, parsed, { sourceId: null, accountId: admin.id, title: ready.workspace.title, deps });
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
export async function publishDesign(admin: Account, id: string, whatsNewNote: string | null = null): Promise<DesignResult<{ notes: string[] }>> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const design = await getDesign(id);
  if (!design) return refuse(UNKNOWN);
  if (design.archivedAt) return refuse("This theme is archived. Restore it before publishing it.");
  let snapshot: DesignSnapshot | null = null;
  const notes: string[] = [];
  if (design.workspaceStoreId) {
    const taken = await draftedSnapshot(design);
    if (!taken.ok) return taken;
    snapshot = taken.snapshot;
    notes.push(...taken.notes);
  } else if (!design.readable) {
    return refuse("Its snapshot can no longer be read: open its Theme to make it again.");
  }
  const details = shownDesignDetails(design);
  const note = whatsNewNote?.trim() ? whatsNewNote.trim() : null;
  if (note && note.length > 2000) return refuse("What's new is at most 2,000 characters.");
  // An update may never take a core section style away (D245): stores' rows naming it would lose their look.
  if (snapshot) {
    const [latest] = await db().execute<Row>(sql`
      select snapshot from commerce.design_preset_versions where preset_id = ${id}::uuid order by number desc limit 1
    `);
    const before = latest ? parseDesignSnapshot(latest.snapshot) : null;
    const removed = coreStylesRemoved(before?.theme.settings ?? null, snapshot.theme.settings);
    if (removed.length > 0) {
      return refuse(`This version no longer has the core section ${removed.length === 1 ? "style" : "styles"} ${removed.join(", ")}, which every version keeps. Put ${removed.length === 1 ? "it" : "them"} back in the theme's Theme tab first.`);
    }
  }
  // Every version passes the theme checks (D246, `docs/theme-store.md` 7), each of its presets too: a blocking finding refuses it, warnings are said.
  const checked = await checkedDesign(snapshot ?? (await storedSnapshot(id)));
  if (checked.blocking > 0) {
    const lines = blockingLines(checked);
    return refuse(`It does not pass the theme checks yet (${lines.length} to fix): ${lines.slice(0, 5).join(" ")}${lines.length > 5 ? " …and more, listed on its Details tab." : ""}`);
  }
  const warnings = checked.findings.filter((finding) => !finding.blocking).length;
  if (warnings > 0) notes.push(`The theme checks found ${warnings} ${warnings === 1 ? "thing" : "things"} to look at (not blocking), listed on its Details tab.`);
  try {
    // A new version (D241) whenever the look published differs from the latest version's, in the same statement as the snapshot.
    const [row] = await db().execute<Row>(sql`
      with published as (
        update commerce.design_presets
           set title = ${details.title}, summary = ${details.summary}, description = ${details.description}, picture_url = ${details.pictureUrl}, draft = null,
               ${snapshot
                 ? sql`snapshot = ${JSON.stringify(snapshot)}::jsonb, snapshot_at = now(), source_store_id = ${design.workspaceStoreId}::uuid, workspace_key = ${snapshotKey(snapshot)},`
                 : sql``}
               published = true, published_at = now(), updated_by = ${admin.id}::uuid
         where id = ${id}::uuid and archived_at is null
        returning id, snapshot
      ), latest as (
        select v.number, v.snapshot from commerce.design_preset_versions v where v.preset_id = ${id}::uuid order by v.number desc limit 1
      ), versioned as (
        insert into commerce.design_preset_versions (preset_id, number, snapshot, published_by, notes)
        select p.id, coalesce((select number from latest), 0) + 1, p.snapshot, ${admin.id}::uuid, ${note} from published p
        where not exists (select 1 from latest l where l.snapshot = p.snapshot)
        returning number
      )
      select p.id, (select number from versioned) as version from published p
    `);
    if (!row) return refuse("This theme is archived. Restore it before publishing it.");
  } catch (error) {
    return refuse(designProblem(error));
  }
  await audit(admin.id, design.workspaceStoreId, "platform.design_preset_published", { preset: id, snapshot: snapshot !== null }, { target: { type: "design_preset", id } });
  // Its own content goes out with it (D275): frozen when it was never published or has changed since, so the preview, the photographs and
  // new stores read what was published. Content that cannot be published yet (a content pack's pictures still to make) is said, never fatal.
  const content = await themeContentOf(id);
  if (!content) notes.push("It has no content of its own yet, so the theme store shows no preview of it: give it content on its Content tab.");
  else if (!content.published || content.changed) {
    const shown = await publishStarter(admin, content.starterId);
    if (!shown.ok) notes.push(`Its content was not published: ${shown.problems.join(" ")}`);
  }
  // Its looks are photographed in the background (`docs/theme-showcase-phase-2.md` step 1); asking now shows them waiting at once.
  await askForThemeShots();
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
  const blocker = deleteBlocker("theme", { stores: design.storesUsing, requests: design.requests, platform: design.onPlatform });
  if (blocker) return refuse(blocker);
  try {
    await db().transaction(async (tx) => {
      // Its own copy of content (D275) goes with it, archived and its store closed; a content pack's template stays starting content.
      const [own] = await tx.execute<Row>(sql`
        update commerce.store_starters set design_preset_id = null, archived_at = coalesce(archived_at, now()), archived_by = coalesce(archived_by, ${admin.id}::uuid),
               published = false, updated_by = ${admin.id}::uuid
         where design_preset_id = ${id}::uuid and pack_key is null returning store_id
      `);
      if (own) {
        await tx.execute(sql`
          update commerce.stores set status = 'closed', status_reason = 'Its theme was deleted.', status_changed_by = ${admin.id}::uuid
           where id = ${String(own.store_id)}::uuid and status <> 'closed'
        `);
      }
      await tx.execute(sql`delete from commerce.design_presets where id = ${id}::uuid`);
      if (design.workspaceStoreId) {
        await tx.execute(sql`
          update commerce.stores set status = 'closed', status_reason = 'Its theme was deleted.', status_changed_by = ${admin.id}::uuid
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

/** What applying did: the use recorded, the install made live, and the title of the one put away (the look from before, D241). */
export type ApplyResult = DesignResult<{ useId: string; installId: string; previous: string; notes: string[] }>;

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
 * `pageRulesProblem()`, no other store's file left), and the CSS checked. Writes nothing but the fonts, the pictures' copies and the text
 * styles the layouts' words wear (`carryTextStyles()`, D393).
 */
async function placeSnapshot(
  storeId: string | null,
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
  if (sourceId !== null && sourceId === storeId) for (const url of wanted) replaced.set(url, url);
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
    // A theme's product page is a store's: Kaizena Flow's own site has none (`docs/theme-phase-4.md`).
    if (storeId === null && kind === "productLayout") {
      notes.push("Its product page is for stores, so Kaizena Flow's site leaves it out.");
      continue;
    }
    const content = layoutForStore(layout, menus, { title: designPageTitle(kind, options.title), slug: "design" });
    const parsed = pageInput.safeParse(content);
    const problem = parsed.success ? pageRulesProblem(storeId, LAYOUT_PAGE_TYPE[kind], parsed.data) : parsed.error.issues[0]?.message;
    if (problem || !parsed.success) return refuse(`The profile's ${designPageTitle(kind, "").trim()} does not fit this store: ${problem ?? "it cannot be read"}`);
    if (leftoverStorageUrls(parsed.data, new Set(replaced.values())).length > 0) return refuse("This theme could not be made ready for your store.");
    pages[kind] = parsed.data;
  }
  const siteCss = cssProblem(mapped.css) === null ? mapped.css : "";
  // The text styles its words wear come from the store it was taken from, as its pictures do (D393); one the site has by name keeps its own.
  await carryTextStyles({ id: options.accountId }, sourceId, storeId, pages);

  return { ok: true, pages, siteCss, notes, copies: copies.size, leftOut };
}

/**
 * Applies a design profile to a store (D176): the one writer. Refused for a store that is not open (D171) or that the account neither works
 * in nor runs the platform for, for a profile that is not published (a platform admin may try an unpublished one on a store template), and
 * for a store with `INSTALLS_MAX` themes installed. Before anything is written the profile's fonts are installed (D59) and its pictures copied
 * into the store's media library as D125's `applyTemplate()` copies a template's; then in one transaction it is installed and made live
 * (D241): the live install is put away with the store's look as it is now (`putAwayLive()`; the use's `previous` keeps it too, as history),
 * a new install of the profile's latest version becomes live, the theme's settings are written, new header, footer and product layout pages
 * are made from the snapshot (published, checked by `pageInput` and `pageRulesProblem()` as the builder's saves are; never over the store's
 * own pages) and chosen, and the site's CSS is set. Never the store's name, logos, business details, menus, pages or products. The caller
 * refreshes `designTags()`.
 */
export async function applyDesignPreset(
  storeId: string,
  presetId: string,
  accountId: string,
  deps: ApplyDeps = {},
  variation: string | null = null,
  /** A premium theme (D286): the price the person agreed to (`chargeToken()`), or `grant` where Kaizena Flow gives it. */
  charge: string | null = null,
): Promise<ApplyResult> {
  const done = await placeDesign(storeId, presetId, accountId, deps, true, variation, charge);
  if (!done.ok) return done;
  return { ok: true, useId: done.useId ?? "", installId: done.installId, previous: done.previous ?? "", notes: done.notes };
}

/**
 * Installs a theme in a store's theme library without making it live (`docs/theme-phase-3.md` step 2, *Add to my themes* and *Try it in
 * your store*): the same checks, fonts, pictures and new layout pages as applying, kept in the install's `look` (D241), never the store's
 * columns, so visitors see nothing until the store switches to it. The caller refreshes `designTags()` (its pages list changed).
 */
export async function installDesignPreset(
  storeId: string,
  presetId: string,
  accountId: string,
  deps: ApplyDeps = {},
  variation: string | null = null,
): Promise<DesignResult<{ installId: string; title: string; notes: string[] }>> {
  const done = await placeDesign(storeId, presetId, accountId, deps, false, variation);
  if (!done.ok) return done;
  return { ok: true, installId: done.installId, title: done.title, notes: done.notes };
}

/** Applying (`live`) or only installing: the one body behind both. */
async function placeDesign(
  storeId: string,
  presetId: string,
  accountId: string,
  deps: ApplyDeps,
  live: boolean,
  variation: string | null = null,
  charge: string | null = null,
): Promise<DesignResult<{ useId: string | null; installId: string; previous: string | null; title: string; notes: string[] }>> {
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
  const whole = parseDesignSnapshot(preset.snapshot);
  if (!whole) return refuse("This theme can no longer be read.");
  // One of its presets (`docs/theme-showcase-phase-1.md`): the theme with the preset's settings, the install named after both.
  const snapshot = variationSnapshot(whole, variation);
  if (!snapshot) return refuse(NO_PRESET);
  const title = installTitle(String(preset.title), whole, variation);
  if ((await installCount(storeId)) >= INSTALLS_MAX) return refuse(INSTALLS_FULL);

  const ready = await placeSnapshot(storeId, snapshot, { sourceId: preset.source_store_id ? String(preset.source_store_id) : null, accountId, title, menus: facts, deps });
  if (!ready.ok) return ready;
  const { pages, siteCss, notes } = ready;

  let applied: { useId: string | null; installId: string; previous: { id: string; title: string } | null; pageIds: Record<string, string | null> };
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
      // The look before stays installed in the store's theme library, with every change made to it (D241).
      const [{ n }] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.store_theme_installs where store_id = ${storeId}::uuid`);
      if (Number(n) >= INSTALLS_MAX) throw new Refused(INSTALLS_FULL);
      // Only applying puts the live theme away; an install that is not live leaves the store as it is.
      if (live) await setThemeCharge(tx, accountId, charge);
      const before = live ? await putAwayLive(tx, storeId) : null;
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
      // What was placed (D245): the settings, the CSS and each layout page with its fingerprint, so an update tells the owner's changes apart.
      const placed: PlacedLook = {
        settings: snapshot.theme.settings,
        css: siteCss,
        layouts: {
          header: pageIds.header && pages.header ? { id: pageIds.header, hash: fingerprint(pages.header) } : null,
          footer: pageIds.footer && pages.footer ? { id: pageIds.footer, hash: fingerprint(pages.footer) } : null,
          productLayout: pageIds.productLayout && pages.productLayout ? { id: pageIds.productLayout, hash: fingerprint(pages.productLayout) } : null,
        },
      };
      const theme = { base: snapshot.theme.base, savedId: null, settings: snapshot.theme.settings };
      if (!live) {
        // Kept in the library with its look (D241): its settings, CSS and the pages just made for it.
        const look = { theme, css: siteCss, headerId: pageIds.header, footerId: pageIds.footer, productLayoutId: pageIds.productLayout };
        const [kept] = await tx.execute<Row>(sql`
          insert into commerce.store_theme_installs (store_id, preset_id, version_id, title, look, live, installed_by, placed, variation)
          values (${storeId}::uuid, ${presetId}::uuid,
            (select v.id from commerce.design_preset_versions v where v.preset_id = ${presetId}::uuid order by v.number desc limit 1),
            ${title.slice(0, 80)}, ${JSON.stringify(look)}::jsonb, false, ${accountId}::uuid, ${JSON.stringify(placed)}::jsonb, ${variation})
          returning id
        `);
        return { useId: null, installId: String(kept.id), previous: null, pageIds };
      }
      const [install] = await tx.execute<Row>(sql`
        insert into commerce.store_theme_installs (store_id, preset_id, version_id, title, live, installed_by, switched_at, placed, variation)
        values (${storeId}::uuid, ${presetId}::uuid,
          (select v.id from commerce.design_preset_versions v where v.preset_id = ${presetId}::uuid order by v.number desc limit 1),
          ${title.slice(0, 80)}, true, ${accountId}::uuid, now(), ${JSON.stringify(placed)}::jsonb, ${variation})
        returning id
      `);
      await tx.execute(sql`
        update commerce.stores set theme = ${JSON.stringify(theme)}::jsonb, custom_css = ${siteCss},
          header_id = ${pageIds.header}::uuid, footer_id = ${pageIds.footer}::uuid, product_layout_id = ${pageIds.productLayout}::uuid
        where id = ${storeId}::uuid
      `);
      const [use] = await tx.execute<Row>(sql`
        insert into commerce.design_preset_uses (store_id, preset_id, previous, applied_by, install_id, previous_install_id)
        values (${storeId}::uuid, ${presetId}::uuid, ${JSON.stringify(previous)}::jsonb, ${accountId}::uuid, ${String(install.id)}::uuid, ${before?.id ?? null}::uuid)
        returning id
      `);
      return { useId: String(use.id), installId: String(install.id), previous: before, pageIds };
    });
  } catch (error) {
    if (error instanceof Refused || error instanceof InstallRefused) return refuse(error.message);
    if (isChargeRefusal(error)) return refuse(CHARGE_CHANGED);
    log("error", "design_presets.apply_failed", {}, error);
    return refuse(live ? "The theme could not be applied. Nothing was changed; try again." : "The theme could not be added. Nothing was changed; try again.");
  }
  if (!live) {
    await audit(
      accountId,
      storeId,
      "store.theme_installed",
      { preset: presetId, title, install: applied.installId, ...(variation && { variation }), pages: applied.pageIds, media: ready.copies, ...(platformAdmin && !facts.member && { byPlatform: true }) },
      { area: "website", target: { type: "design_preset", id: presetId } },
    );
    return { ok: true, useId: null, installId: applied.installId, previous: null, title, notes };
  }
  await audit(
    accountId,
    storeId,
    "store.design_preset_applied",
    {
      preset: presetId,
      ...(variation && { variation }),
      title,
      install: applied.installId,
      previousInstall: applied.previous?.id ?? null,
      pages: applied.pageIds,
      media: ready.copies,
      ...(ready.leftOut > 0 && { mediaLeftOut: ready.leftOut }),
      ...(platformAdmin && !facts.member && { byPlatform: true }),
    },
    { area: "website", target: { type: "design_preset", id: presetId } },
  );
  return { ok: true, useId: applied.useId, installId: applied.installId, previous: applied.previous?.title ?? null, title, notes };
}

/**
 * Adds a published theme to Kaizena Flow's own site's library without making it live (phase 4 step 1, `docs/theme-phase-4.md`): the same
 * `placeSnapshot()` as a store's (fonts installed, pictures copied into Kaizena Flow's media library, header and footer placed with Kaizena
 * Flow's own menus and checked as a save is; a product page is a store's and is left out), then in one transaction its header and footer
 * become new published pages of Kaizena Flow's and the install keeps its look (`PlatformLook`), so the site is unchanged until a platform
 * admin switches (`switchPlatformInstall()`). The caller refreshes `PAGES_TAG`.
 */
export async function installPresetOnPlatform(
  admin: Account,
  presetId: string,
  deps: ApplyDeps = {},
  variation: string | null = null,
): Promise<DesignResult<{ installId: string; title: string; notes: string[] }>> {
  if (!admin.platformAdmin) return refuse("Only Kaizena Flow's admins change its site's look.");
  if (!isUuid(presetId)) return refuse(UNKNOWN);
  const [preset] = await db().execute<Row>(sql`
    select id, title, snapshot, published, archived_at, source_store_id from commerce.design_presets where id = ${presetId}::uuid
  `);
  if (!preset) return refuse(UNKNOWN);
  if (preset.archived_at || !preset.published) return refuse(NOT_OFFERED);
  const whole = parseDesignSnapshot(preset.snapshot);
  if (!whole) return refuse("This theme can no longer be read.");
  const snapshot = variationSnapshot(whole, variation);
  if (!snapshot) return refuse(NO_PRESET);
  const title = installTitle(String(preset.title), whole, variation);
  if ((await platformInstallCount()) >= PLATFORM_INSTALLS_MAX) return refuse(`Kaizena Flow's site has ${PLATFORM_INSTALLS_MAX} themes installed. Remove one first.`);
  const [menus] = await db().execute<Row>(sql`select header_menu_id, footer_menu_id from commerce.platform_settings`);

  const ready = await placeSnapshot(null, snapshot, { sourceId: preset.source_store_id ? String(preset.source_store_id) : null, accountId: admin.id, title, menus: menus ?? {}, deps });
  if (!ready.ok) return ready;
  const { pages, siteCss, notes } = ready;

  let made: { installId: string; pageIds: Record<string, string | null> };
  try {
    made = await db().transaction(async (tx) => {
      if ((await platformInstallCount(tx)) >= PLATFORM_INSTALLS_MAX) throw new Refused(`Kaizena Flow's site has ${PLATFORM_INSTALLS_MAX} themes installed. Remove one first.`);
      const pageIds: Record<string, string | null> = { header: null, footer: null };
      for (const kind of ["header", "footer"] as const) {
        const page = pages[kind];
        if (!page) continue;
        const type = LAYOUT_PAGE_TYPE[kind];
        const taken = await tx.execute<Row>(sql`select slug from commerce.pages where store_id is null and type = ${type}`);
        const slug = designPageSlug(kind, title, taken.map((r) => String(r.slug)));
        const json = JSON.stringify({ ...page, slug });
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
          values (null, ${type}, ${slug}, ${json}::jsonb, ${json}::jsonb, now(), now(), ${admin.id}::uuid, ${admin.id}::uuid)
          returning id
        `);
        pageIds[kind] = String(row.id);
      }
      const placed: PlacedLook = {
        settings: snapshot.theme.settings,
        css: siteCss,
        layouts: {
          header: pageIds.header && pages.header ? { id: pageIds.header, hash: fingerprint(pages.header) } : null,
          footer: pageIds.footer && pages.footer ? { id: pageIds.footer, hash: fingerprint(pages.footer) } : null,
          productLayout: null,
        },
      };
      const look: PlatformLook = {
        theme: { base: snapshot.theme.base, savedId: null, settings: snapshot.theme.settings },
        // Kaizena Flow's fonts are a column of their own (D235), laid over its theme when read.
        fonts: snapshot.theme.settings.fonts ?? {},
        css: siteCss,
        headerId: pageIds.header,
        footerId: pageIds.footer,
      };
      const [kept] = await tx.execute<Row>(sql`
        insert into commerce.platform_theme_installs (preset_id, version_id, title, look, live, installed_by, placed, variation)
        values (${presetId}::uuid,
          (select v.id from commerce.design_preset_versions v where v.preset_id = ${presetId}::uuid order by v.number desc limit 1),
          ${title.slice(0, 80)}, ${JSON.stringify(look)}::jsonb, false, ${admin.id}::uuid, ${JSON.stringify(placed)}::jsonb, ${variation})
        returning id
      `);
      return { installId: String(kept.id), pageIds };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    log("error", "design_presets.platform_add_failed", {}, error);
    return refuse("The theme could not be added. Nothing was changed; try again.");
  }
  await audit(admin.id, null, "platform.theme_installed", { preset: presetId, ...(variation && { variation }), title, install: made.installId, pages: made.pageIds, media: ready.copies }, {
    target: { type: "design_preset", id: presetId },
  });
  return { ok: true, installId: made.installId, title, notes };
}

class Refused extends Error {}

/** An install's name: the theme's, and the preset's after it when it was added with one (`Calm · Coast`). */
function installTitle(themeTitle: string, snapshot: DesignSnapshot, variation: string | null): string {
  const name = variation ? variationsOf(snapshot).find((v) => v.key === variation)?.name : undefined;
  return (name ? `${themeTitle} · ${name}` : themeTitle).slice(0, 80);
}

/** The store's latest use of a design profile, for its design settings: what was applied, when, and where the look before it is kept. */
export async function latestDesignUse(storeId: string): Promise<{
  id: string;
  presetTitle: string;
  appliedAt: string;
  /** A use from before installs (D241): the saved theme made of the look it replaced. */
  savedTheme: string | null;
  /** The install that holds the look from before, while it is still installed and not live. */
  previousInstall: string | null;
} | null> {
  const [row] = await db().execute<Row>(sql`
    select u.id, u.applied_at, d.title, t.name as saved_theme, case when i.live then null else i.title end as previous_install
    from commerce.design_preset_uses u
    join commerce.design_presets d on d.id = u.preset_id
    left join commerce.store_themes t on t.id = u.saved_theme_id
    left join commerce.store_theme_installs i on i.id = u.previous_install_id
    where u.store_id = ${storeId}::uuid and u.restored_at is null
    order by u.applied_at desc, u.id desc limit 1
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    presetTitle: String(row.title),
    appliedAt: new Date(String(row.applied_at)).toISOString(),
    savedTheme: row.saved_theme ? String(row.saved_theme) : null,
    previousInstall: row.previous_install ? String(row.previous_install) : null,
  };
}

/**
 * Puts back the look a store had before its latest design profile (D176, D241): it switches to the install that was live before it, kept with
 * every change made to it, while that is still installed; for a use from before installs, the look it recorded (`previous`) becomes a new live
 * *Custom* install, each layout page only while it still exists and is published (else the standard one). Either way the look it replaces
 * stays installed, so nothing is lost, and the pages the profile made stay, unchosen. Uses are put back newest first, so doing it again goes
 * one profile further back.
 */
export async function restoreDesignLook(storeId: string, accountId: string): Promise<DesignResult<{ presetTitle: string }>> {
  if (!isUuid(storeId) || !isUuid(accountId)) return refuse("Unknown store.");
  const facts = await actorFacts(storeId, accountId);
  if (!facts) return refuse("That store no longer exists.");
  if (!facts.platform_admin && !facts.member) return refuse("You do not work in this store.");
  if (facts.status !== "active") return refuse("The store is not open, so its look cannot be changed.");
  if (!facts.workable) return refuse(KEPT);
  let done: { useId: string; presetId: string; presetTitle: string; install: string };
  try {
    done = await db().transaction(async (tx) => {
      await tx.execute(sql`select 1 from commerce.stores where id = ${storeId}::uuid for update`);
      // The look before was live on the store, so a premium theme there is the store's already (D286): nothing new is charged.
      await setThemeCharge(tx, accountId, null);
      const [use] = await tx.execute<Row>(sql`
        select u.id, u.preset_id, u.previous, u.previous_install_id, d.title, i.live as previous_live
        from commerce.design_preset_uses u
        join commerce.design_presets d on d.id = u.preset_id
        left join commerce.store_theme_installs i on i.id = u.previous_install_id
        where u.store_id = ${storeId}::uuid and u.restored_at is null
        order by u.applied_at desc, u.id desc limit 1 for update of u
      `);
      if (!use) throw new Refused("There is no look from before to put back.");
      let install: string;
      if (use.previous_install_id && use.previous_live === false) {
        await putAwayLive(tx, storeId);
        await makeLive(tx, storeId, String(use.previous_install_id));
        install = String(use.previous_install_id);
      } else if (use.previous_install_id && use.previous_live === true) {
        // Switched back by hand already: the use is put back as it stands, so the next one further back can be.
        install = String(use.previous_install_id);
      } else {
        // A use from before installs, or one whose install was removed: the look it recorded becomes a new live install.
        await putAwayLive(tx, storeId);
        const [made] = await tx.execute<Row>(sql`
          insert into commerce.store_theme_installs (store_id, title, look, installed_by)
          values (${storeId}::uuid, 'Custom', ${JSON.stringify(use.previous ?? {})}::jsonb, ${accountId}::uuid)
          returning id
        `);
        install = String(made.id);
        await makeLive(tx, storeId, install);
      }
      await tx.execute(sql`update commerce.design_preset_uses set restored_at = now(), restored_by = ${accountId}::uuid where id = ${String(use.id)}::uuid`);
      return { useId: String(use.id), presetId: String(use.preset_id), presetTitle: String(use.title), install };
    });
  } catch (error) {
    if (error instanceof Refused || error instanceof InstallRefused) return refuse(error.message);
    if (isChargeRefusal(error)) return refuse("The look from before is a premium theme your store does not have: make it live from your theme library to buy it.");
    return refuse(designProblem(error));
  }
  await audit(accountId, storeId, "store.design_preset_restored", { preset: done.presetId, use: done.useId, install: done.install }, {
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
  /** The preset drawn (`docs/theme-showcase-phase-1.md`), by its name; null: the theme's own look. */
  presetName: string | null;
};

async function readPreview(presetId: string, starterId: string | null, admin: boolean, draft = false, variation: string | null = null): Promise<DesignPreview | null> {
  if (!isUuid(presetId) || (starterId !== null && !isUuid(starterId))) return null;
  const [preset] = await readDb().execute<Row>(sql`
    select id, title, draft, snapshot, workspace_store_id from commerce.design_presets
    where id = ${presetId}::uuid and (${admin} or (published and archived_at is null))
  `);
  if (!preset) return null;
  // A draft (D177, admins only) is the look in the profile's workspace as last saved, with its drafted presets and draft title.
  const taken = draft && preset.workspace_store_id ? await draftedSnapshot({ id: String(preset.id), workspaceStoreId: String(preset.workspace_store_id) }) : null;
  const whole = taken ? (taken.ok ? taken.snapshot : null) : parseDesignSnapshot(preset.snapshot);
  if (!whole) return null;
  // One of its presets (`preset={key}`): the theme with the preset's settings; a key the version does not have is not found.
  const snapshot = variationSnapshot(whole, variation);
  if (!snapshot) return null;
  const presetName = variation ? (variationsOf(whole).find((v) => v.key === variation)?.name ?? null) : null;
  const title = draft ? (readDesignDraft(preset.draft)?.title ?? String(preset.title)) : String(preset.title);
  // Owners see a store template as published: its frozen copy (D177). An admin sees its working store, as it is now.
  // Without one named, the theme's own content (D275): as published, or for an admin's draft as it is now; the Standard store only for a
  // theme that has none yet (the theme store never links such a preview).
  const [store] = starterId
    ? await readDb().execute<Row>(sql`
        select s.slug, st.title from commerce.store_starters st
        join commerce.stores s on s.id = ${admin ? sql`st.store_id` : sql`coalesce(st.published_store_id, st.store_id)`} and s.starter
        where st.id = ${starterId}::uuid and st.kind = 'content' and s.status = 'active' and (${admin} or (st.published and st.archived_at is null))
      `)
    : await readDb().execute<Row>(sql`
        select slug, title from (
          select s.slug, null::text as title, 0 as rank from commerce.store_starters st
            join commerce.stores s on s.id = ${admin && draft ? sql`st.store_id` : sql`coalesce(st.published_store_id, st.store_id)`} and s.starter
           where st.design_preset_id = ${presetId}::uuid and s.status = 'active' and st.archived_at is null and (${admin} or st.published)
          union all
          select slug, null::text, 1 from commerce.stores where is_template
        ) found order by rank limit 1
      `);
  if (!store) return null;
  const wanted = snapshotFonts(snapshot);
  const installed = wanted.length === 0
    ? []
    : await readDb().execute<Row>(sql`select family from commerce.fonts where family in (${sql.join(wanted.map((f) => sql`${f}`), sql`, `)})`);
  const fonts = wanted.filter((family) => installed.some((row) => row.family === family));
  return { id: String(preset.id), title, snapshot, storeSlug: String(store.slug), starterTitle: store.title ? String(store.title) : null, fonts, draft: taken !== null, presetName };
}

/**
 * A published profile on a published store template (or the default template), for the public preview: cached per profile and template
 * under `DESIGNS_TAG` and `STARTERS_TAG`, null for anything unpublished or archived. Reads nothing of the visitor.
 */
export async function publicDesignPreview(presetId: string, starterId: string | null, variation: string | null = null): Promise<DesignPreview | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  return readPreview(presetId, starterId, false, false, variation);
}

/**
 * The same for a platform admin (the caller checked): unpublished and archived profiles and templates too, and with `draft` the look in the
 * profile's workspace as last saved (D177). Never cached.
 */
export async function adminDesignPreview(presetId: string, starterId: string | null, draft = false, variation: string | null = null): Promise<DesignPreview | null> {
  return readPreview(presetId, starterId, true, draft, variation);
}

/**
 * Every published store template that is no theme's own content (D275) and no demo store (D277, seen live, never in a preview), for the
 * preview's chooser and the platform's pages.
 */
export async function previewStarters(): Promise<{ id: string; title: string }[]> {
  const rows = await readDb().execute<Row>(sql`
    select st.id, st.title from commerce.store_starters st
    join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.status = 'active'
    where st.published and st.archived_at is null and st.kind = 'content' and st.design_preset_id is null order by st.position, lower(st.title)
  `);
  return rows.map((r) => ({ id: String(r.id), title: String(r.title) }));
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Updates of installed themes (D245, `docs/theme-phase-2.md` step 4, the plan's 4.6).
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

/** A layout page's fingerprint: its rows and CSS, as `Placed` keeps it to tell whether the owner has edited it since. */
const fingerprint = (content: { rows: unknown; css?: string }) => createHash("sha256").update(layoutFingerprintSource(content)).digest("hex");

type LookRecord = { theme: unknown; css: string; headerId: string | null; footerId: string | null; productLayoutId: string | null; versionId: string | null; placed: unknown };

const LOOK_ID: Record<DesignLayoutKind, "headerId" | "footerId" | "productLayoutId"> = { header: "headerId", footer: "footerId", productLayout: "productLayoutId" };

/** The look an install shows now: the store's columns for the live one, its kept look for another. */
function currentLook(install: Row, store: Row): Omit<LookRecord, "versionId" | "placed"> {
  if (install.live) {
    return {
      theme: store.theme ?? {},
      css: String(store.custom_css ?? ""),
      headerId: store.header_id ? String(store.header_id) : null,
      footerId: store.footer_id ? String(store.footer_id) : null,
      productLayoutId: store.product_layout_id ? String(store.product_layout_id) : null,
    };
  }
  const look = (install.look && typeof install.look === "object" ? install.look : {}) as Row;
  const id = (value: unknown) => (typeof value === "string" && isUuid(value) ? value : null);
  return { theme: look.theme ?? {}, css: typeof look.css === "string" ? look.css : "", headerId: id(look.headerId), footerId: id(look.footerId), productLayoutId: id(look.productLayoutId) };
}

/**
 * What a store changed of the look its live theme placed (D277, *Publish this look… → As a preset*): the theme it wears and its preset, and
 * which of the parts a preset shares with its theme (header, footer, product page, CSS) differ from what was placed, by the fingerprints an
 * update compares (`layoutFate()`). `changed` is null when the store wears no theme or its install kept nothing of what it placed (one from
 * before updates were kept), so nothing can be told.
 */
export async function liveLookChanges(
  storeId: string,
): Promise<{ presetId: string | null; variation: string | null; settings: unknown; changed: ("header" | "footer" | "productLayout" | "css")[] | null }> {
  const none = { presetId: null, variation: null, settings: null, changed: null };
  if (!isUuid(storeId)) return none;
  const [row] = await db().execute<Row>(sql`
    select s.theme, s.custom_css, s.header_id, s.footer_id, s.product_layout_id, i.preset_id, i.variation, i.placed, i.live
    from commerce.stores s join commerce.store_theme_installs i on i.store_id = s.id and i.live
    where s.id = ${storeId}::uuid
  `);
  if (!row?.preset_id) return none;
  const presetId = String(row.preset_id);
  const variation = row.variation ? String(row.variation) : null;
  const placed = (row.placed && typeof row.placed === "object" ? row.placed : null) as PlacedLook | null;
  if (!placed) return { presetId, variation, settings: row.theme ?? null, changed: null };
  const now = currentLook(row, row);
  const changed: ("header" | "footer" | "productLayout" | "css")[] = [];
  for (const kind of DESIGN_LAYOUT_KINDS) {
    const id = now[LOOK_ID[kind]];
    let current: { id: string; hash: string } | null = null;
    if (id) {
      const [page] = await db().execute<Row>(sql`select published from commerce.pages where id = ${id}::uuid and store_id = ${storeId}::uuid`);
      const content = page ? parsePageContent(page.published) : null;
      current = { id, hash: content ? fingerprint(content) : "" };
    }
    const was = placed.layouts?.[kind] ?? null;
    const same = (was === null && current === null) || (was !== null && current !== null && was.id === current.id && was.hash === current.hash);
    if (!same) changed.push(kind);
  }
  if (now.css !== (placed.css ?? "")) changed.push("css");
  return { presetId, variation, settings: row.theme ?? null, changed };
}

const sameLook = (a: Omit<LookRecord, "versionId" | "placed">, b: Omit<LookRecord, "versionId" | "placed">) =>
  canonicalJson([a.theme, a.css, a.headerId, a.footerId, a.productLayoutId]) === canonicalJson([b.theme, b.css, b.headerId, b.footerId, b.productLayoutId]);

/** Writes an install's look: into the store's columns while it is live (D241), into its kept look otherwise. */
async function writeInstallLook(tx: Pick<ReturnType<typeof db>, "execute">, storeId: string, install: Row, look: Omit<LookRecord, "versionId" | "placed">) {
  if (install.live) {
    await tx.execute(sql`
      update commerce.stores set theme = ${JSON.stringify(look.theme)}::jsonb, custom_css = ${look.css},
        header_id = ${look.headerId}::uuid, footer_id = ${look.footerId}::uuid, product_layout_id = ${look.productLayoutId}::uuid
      where id = ${storeId}::uuid
    `);
  } else {
    const kept = { theme: look.theme, css: look.css, headerId: look.headerId, footerId: look.footerId, productLayoutId: look.productLayoutId };
    await tx.execute(sql`update commerce.store_theme_installs set look = ${JSON.stringify(kept)}::jsonb where id = ${String(install.id)}::uuid`);
  }
}

export type UpdateResult = DesignResult<{ title: string; version: number; own: number; kept: string[]; notes: string[] }>;

/** Who an update is made for when nobody pressed (the job): the person who installed the theme, else an owner of the store. */
async function updateActor(storeId: string, install: Row): Promise<string | null> {
  if (install.installed_by) return String(install.installed_by);
  const [owner] = await db().execute<Row>(sql`
    select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' and disabled_at is null order by created_at limit 1
  `);
  return owner ? String(owner.account_id) : null;
}

/**
 * Updates an installed theme to its theme's latest published version (D245): the one writer of an update. The new version's fonts and
 * pictures are made ready as applying makes them (`placeSnapshot()`); then, in one transaction under the store's row lock, its settings are laid
 * under the owner's own changes again (`mergeSettings()` against what was placed), its CSS replaces the store's only where the owner left it
 * (`cssFate()`), and each layout the owner has not edited is replaced by the new version's page, while one they edited stays theirs and the new
 * version's is added beside it as a draft (`layoutFate()`). The look before and after are logged for `undoThemeUpdate()`. `accountId` null: the
 * job applying it by itself to an install that follows updates. Words, pictures, products, menus and the owner's pages are never touched.
 */
export async function updateThemeInstall(storeId: string, installId: string, accountId: string | null, deps: ApplyDeps = {}): Promise<UpdateResult> {
  if (!isUuid(storeId) || !isUuid(installId) || (accountId !== null && !isUuid(accountId))) return refuse(UNKNOWN);
  const [install] = await db().execute<Row>(sql`
    select i.id, i.title, i.preset_id, i.version_id, i.live, i.look, i.placed, i.installed_by, i.variation, cur.number as current_number, cur.snapshot as current_snapshot
    from commerce.store_theme_installs i
    left join commerce.design_preset_versions cur on cur.id = i.version_id
    where i.id = ${installId}::uuid and i.store_id = ${storeId}::uuid
  `);
  if (!install || !install.preset_id) return refuse("That theme has no versions to update to.");
  const facts = await actorFacts(storeId, accountId ?? "00000000-0000-4000-8000-000000000000");
  if (!facts) return refuse("That store no longer exists.");
  if (accountId !== null && !facts.platform_admin && !facts.member) return refuse("You do not work in this store.");
  if (facts.status !== "active") return refuse("The store is not open, so its look cannot be changed.");
  if (!facts.workable) return refuse(KEPT);
  const [latest] = await db().execute<Row>(sql`
    select v.id, v.number, v.snapshot, p.title, p.source_store_id
    from commerce.design_presets p
    join commerce.design_preset_versions v on v.preset_id = p.id
    where p.id = ${String(install.preset_id)}::uuid and p.published and p.archived_at is null
    order by v.number desc limit 1
  `);
  if (!latest || Number(latest.number) <= Number(install.current_number ?? 0)) return refuse("This theme is up to date.");
  const nextWhole = parseDesignSnapshot(latest.snapshot);
  if (!nextWhole) return refuse("The new version of this theme can no longer be read.");
  // An install made from a preset follows that preset (the theme's own look while a version has none of that key).
  const variation = install.variation ? String(install.variation) : null;
  const previousWhole = install.current_snapshot ? parseDesignSnapshot(install.current_snapshot) : null;
  const next = installedLook(nextWhole, variation).snapshot;
  const previous = previousWhole ? installedLook(previousWhole, variation).snapshot : null;
  const presetNote = presetLine(previousWhole, nextWhole, variation);
  const actor = accountId ?? (await updateActor(storeId, install));
  if (!actor) return refuse("The store has no owner to make the update for.");
  const title = String(install.title);

  const ready = await placeSnapshot(storeId, next, { sourceId: latest.source_store_id ? String(latest.source_store_id) : null, accountId: actor, title, menus: facts, deps });
  if (!ready.ok) return ready;

  let done: { own: number; kept: string[]; notes: string[]; updateId: string };
  try {
    done = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`
        select status, theme, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${storeId}::uuid for update
      `);
      if (!store || store.status !== "active") throw new Refused("The store is not open, so its look cannot be changed.");
      const [fresh] = await tx.execute<Row>(sql`
        select id, live, look, placed, version_id from commerce.store_theme_installs where id = ${installId}::uuid and store_id = ${storeId}::uuid for update
      `);
      if (!fresh || String(fresh.version_id ?? "") !== String(install.version_id ?? "")) throw new Refused("This theme changed while it was being updated. Try again.");
      const now = currentLook(fresh, store);
      const placed = (fresh.placed && typeof fresh.placed === "object" ? fresh.placed : null) as PlacedLook | null;
      // What was placed; for an install from before updates were kept, the version it came from (its layouts unknown: kept as the owner's).
      const base: PlacedLook = placed ?? {
        settings: previous?.theme.settings ?? null,
        css: previous?.css ?? "",
        layouts: { header: null, footer: null, productLayout: null },
      };

      const mine = parseStoreTheme(now.theme);
      const merged = mergeSettings(base.settings, mine.settings, next.theme.settings);
      const checked = themeSettingsSchema.safeParse(merged.settings);
      if (!checked.success) throw new Refused("Your changes to this theme do not fit its new version, so it was not updated. Nothing was changed.");
      const css = cssFate(base.css, now.css, ready.siteCss);

      const notes: string[] = [];
      const keptLayouts: string[] = [];
      const after = { theme: { base: next.theme.base, savedId: null, settings: checked.data }, css: css.css, headerId: now.headerId, footerId: now.footerId, productLayoutId: now.productLayoutId };
      const nextPlaced: PlacedLook = { settings: next.theme.settings, css: ready.siteCss, layouts: { header: null, footer: null, productLayout: null } };
      for (const kind of DESIGN_LAYOUT_KINDS) {
        const currentId = now[LOOK_ID[kind]];
        let current: { id: string; hash: string } | null = null;
        if (currentId) {
          const [page] = await tx.execute<Row>(sql`select published from commerce.pages where id = ${currentId}::uuid and store_id = ${storeId}::uuid`);
          const content = page ? parsePageContent(page.published) : null;
          current = { id: currentId, hash: content ? fingerprint(content) : "" };
        }
        const page = ready.pages[kind];
        const fate = layoutFate(base.layouts[kind], current, Boolean(page));
        const insert = async (published: boolean) => {
          const type = LAYOUT_PAGE_TYPE[kind];
          const taken = await tx.execute<Row>(sql`select slug from commerce.pages where store_id = ${storeId}::uuid and type = ${type}`);
          const slug = designPageSlug(kind, title, taken.map((r) => String(r.slug)));
          const json = JSON.stringify({ ...page, slug });
          const [row] = await tx.execute<Row>(sql`
            insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
            values (${storeId}::uuid, ${type}, ${slug}, ${json}::jsonb, ${published ? sql`${json}::jsonb` : sql`null`}, ${published ? sql`now()` : sql`null`},
              ${published ? sql`now()` : sql`null`}, ${actor}::uuid, ${actor}::uuid)
            returning id
          `);
          return String(row.id);
        };
        if (fate.kind === "replace" && page) {
          const id = await insert(true);
          after[LOOK_ID[kind]] = id;
          nextPlaced.layouts[kind] = { id, hash: fingerprint(page) };
        } else if (fate.kind === "standard") {
          after[LOOK_ID[kind]] = null;
        } else if (fate.kind === "keep") {
          keptLayouts.push(kind);
          // Still the owner's: what was placed stays, so a later update sees it as edited too.
          nextPlaced.layouts[kind] = base.layouts[kind];
          if (fate.offer && page) {
            await insert(false);
            notes.push(`Your ${designPageTitle(kind, "").trim().toLowerCase()} is your own and stays; the new version's is in your pages as a draft beside it.`);
          }
        }
      }

      await writeInstallLook(tx, storeId, fresh, after);
      await tx.execute(sql`
        update commerce.store_theme_installs set version_id = ${String(latest.id)}::uuid, placed = ${JSON.stringify(nextPlaced)}::jsonb where id = ${installId}::uuid
      `);
      const before: LookRecord = { ...now, versionId: install.version_id ? String(install.version_id) : null, placed: fresh.placed ?? null };
      const record: LookRecord = { ...after, versionId: String(latest.id), placed: nextPlaced };
      const kept = { settings: merged.kept, own: merged.own.length, css: css.own, layouts: keptLayouts };
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.theme_install_updates (store_id, install_id, from_version_id, to_version_id, before, after, kept, updated_by)
        values (${storeId}::uuid, ${installId}::uuid, ${install.version_id ? String(install.version_id) : null}::uuid, ${String(latest.id)}::uuid,
          ${JSON.stringify(before)}::jsonb, ${JSON.stringify(record)}::jsonb, ${JSON.stringify(kept)}::jsonb, ${accountId}::uuid)
        returning id
      `);
      if (css.kept) notes.push("Your own CSS stays; the new version's CSS is not used.");
      return { own: merged.own.length, kept: merged.kept, notes, updateId: String(row.id) };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    log("error", "design_presets.update_failed", {}, error);
    return refuse("The theme could not be updated. Nothing was changed; try again.");
  }
  await audit(
    accountId,
    storeId,
    "store.theme_updated",
    { install: installId, title, to: Number(latest.number), own: done.own, kept: done.kept.length, update: done.updateId, ...(accountId === null && { automatic: true }) },
    { area: "website", target: { type: "theme_install", id: installId } },
  );
  return { ok: true, title, version: Number(latest.number), own: done.own, kept: done.kept, notes: [...(presetNote ? [presetNote] : []), ...ready.notes, ...done.notes] };
}

/**
 * Undoes an update (D245): the look, version and what was placed go back to what they were before it, only while the install still shows
 * exactly what the update left (else nothing is changed, and the person is told). Pages the update made stay in the store's pages, unused.
 */
export async function undoThemeUpdate(storeId: string, updateId: string, accountId: string): Promise<DesignResult<{ title: string }>> {
  if (!isUuid(storeId) || !isUuid(updateId) || !isUuid(accountId)) return refuse("That update is not known.");
  const facts = await actorFacts(storeId, accountId);
  if (!facts) return refuse("That store no longer exists.");
  if (!facts.platform_admin && !facts.member) return refuse("You do not work in this store.");
  if (facts.status !== "active") return refuse("The store is not open, so its look cannot be changed.");
  try {
    const title = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`
        select theme, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${storeId}::uuid for update
      `);
      const [update] = await tx.execute<Row>(sql`
        select u.id, u.install_id, u.before, u.after, u.undone_at from commerce.theme_install_updates u
        where u.id = ${updateId}::uuid and u.store_id = ${storeId}::uuid for update
      `);
      if (!store || !update) throw new Refused("That update is not known.");
      if (update.undone_at) throw new Refused("That update was undone already.");
      const [install] = await tx.execute<Row>(sql`
        select id, title, live, look, version_id from commerce.store_theme_installs where id = ${String(update.install_id)}::uuid for update
      `);
      if (!install) throw new Refused("That theme is no longer installed.");
      const before = update.before as LookRecord;
      const after = update.after as LookRecord;
      if (String(install.version_id ?? "") !== String(after.versionId ?? "") || !sameLook(currentLook(install, store), after)) {
        throw new Refused("This theme has changed since it was updated, so the update cannot be undone. Nothing was changed.");
      }
      await writeInstallLook(tx, storeId, install, before);
      await tx.execute(sql`
        update commerce.store_theme_installs set version_id = ${before.versionId}::uuid, placed = ${before.placed === null ? null : JSON.stringify(before.placed)}::jsonb
        where id = ${String(install.id)}::uuid
      `);
      await tx.execute(sql`update commerce.theme_install_updates set undone_at = now() where id = ${updateId}::uuid`);
      return String(install.title);
    });
    await audit(accountId, storeId, "store.theme_update_undone", { update: updateId, title }, { area: "website", target: { type: "theme_update", id: updateId } });
    return { ok: true, title };
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    log("error", "design_presets.update_undo_failed", {}, error);
    return refuse("The update could not be undone. Nothing was changed; try again.");
  }
}

/** An install with a newer version of its theme waiting, and what is new in it. */
export type AvailableUpdate = { installId: string; title: string; live: boolean; from: number | null; to: number; followsUpdates: boolean; whatsNew: string[] };
/** An update made, for the owner to see and undo. */
export type MadeUpdate = { id: string; title: string; from: number | null; to: number | null; at: string; automatic: boolean; own: number; keptSettings: number; layoutsKept: string[]; undoneAt: string | null };

/** The store's installs that have a newer version waiting (D245), with *What's new* across every version between, and its latest updates. */
export type FollowingInstall = { installId: string; title: string; live: boolean; version: number | null; followsUpdates: boolean };

export async function themeUpdates(storeId: string, words?: UpdateWords): Promise<{ available: AvailableUpdate[]; made: MadeUpdate[]; installs: FollowingInstall[] }> {
  if (!isUuid(storeId)) return { available: [], made: [], installs: [] };
  const rows = await db().execute<Row>(sql`
    select i.id, i.title, i.live, i.follows_updates, i.variation, cur.number as current_number, cur.snapshot as current_snapshot,
      (select jsonb_agg(jsonb_build_object('number', v.number, 'snapshot', v.snapshot, 'notes', v.notes) order by v.number)
         from commerce.design_preset_versions v where v.preset_id = i.preset_id and v.number > coalesce(cur.number, 0)) as newer
    from commerce.store_theme_installs i
    join commerce.design_presets p on p.id = i.preset_id and p.published and p.archived_at is null
    left join commerce.design_preset_versions cur on cur.id = i.version_id
    where i.store_id = ${storeId}::uuid
    order by i.live desc, i.title
  `);
  const made = await db().execute<Row>(sql`
    select u.id, u.created_at, u.updated_by, u.kept, u.undone_at, i.title, f.number as from_number, t.number as to_number
    from commerce.theme_install_updates u
    join commerce.store_theme_installs i on i.id = u.install_id
    left join commerce.design_preset_versions f on f.id = u.from_version_id
    left join commerce.design_preset_versions t on t.id = u.to_version_id
    where u.store_id = ${storeId}::uuid
    order by u.created_at desc limit 10
  `);
  return updatesView(rows, made, words);
}

/** How long an update's log is kept for its undo. */
export const THEME_UPDATE_KEEP_DAYS = 90;

/**
 * The job (D245): installs that follow updates and are behind their theme's latest published version are updated by themselves, a few at a
 * time, in open stores that are not the platform's own. A refusal (the owner's changes no longer fit, a picture that cannot be copied) leaves
 * the install as it was, to be tried again next time or updated by hand. Never throws.
 */
export async function runThemeUpdates(limit = 20, deps: ApplyDeps = {}): Promise<{ updated: number; refused: number; stores: { id: string; slug: string }[] }> {
  const due = await db().execute<Row>(sql`
    select i.id, i.store_id, s.slug from commerce.store_theme_installs i
    join commerce.stores s on s.id = i.store_id and s.status = 'active' and not (s.is_template or s.starter)
    join commerce.design_presets p on p.id = i.preset_id and p.published and p.archived_at is null
    left join commerce.design_preset_versions cur on cur.id = i.version_id
    where i.follows_updates
      and exists (select 1 from commerce.design_preset_versions v where v.preset_id = i.preset_id and v.number > coalesce(cur.number, 0))
    order by i.installed_at
    limit ${limit}
  `);
  let updated = 0;
  let refused = 0;
  const stores = new Map<string, { id: string; slug: string }>();
  for (const row of due) {
    try {
      const result = await updateThemeInstall(String(row.store_id), String(row.id), null, deps);
      if (result.ok) {
        updated += 1;
        stores.set(String(row.store_id), { id: String(row.store_id), slug: String(row.slug) });
      } else refused += 1;
    } catch (error) {
      log("error", "design_presets.update_job_install_failed", {}, error);
      refused += 1;
    }
  }
  return { updated, refused, stores: [...stores.values()] };
}

/** The daily job: updates older than `THEME_UPDATE_KEEP_DAYS` can no longer be undone and are deleted, a store's and Kaizena Flow's (D253). */
export async function pruneThemeUpdates(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.theme_install_updates where created_at < now() - make_interval(days => ${THEME_UPDATE_KEEP_DAYS}) returning id
  `);
  const platform = await db().execute<Row>(sql`
    delete from commerce.platform_theme_install_updates where created_at < now() - make_interval(days => ${THEME_UPDATE_KEEP_DAYS}) returning id
  `);
  return rows.length + platform.length;
}

// ---------------------------------------------------------------------------
// Updates of Kaizena Flow's own installed themes (D253, docs/theme-phase-4.md step 3)
// ---------------------------------------------------------------------------

type PlatformLookRecord = PlatformLook & { versionId: string | null; placed: unknown };
type PlatformLookOnly = Omit<PlatformLookRecord, "versionId" | "placed">;
const PLATFORM_KINDS = ["header", "footer"] as const;
const PLATFORM_LOOK_ID = { header: "headerId", footer: "footerId" } as const;

/** The look one of Kaizena Flow's installs shows now: `platform_settings`' columns for the live one, its kept look for another. */
function platformLookNow(install: Row, settings: Row): PlatformLookOnly {
  const id = (value: unknown) => (typeof value === "string" && isUuid(value) ? value : null);
  if (install.live) {
    return {
      theme: settings.theme ?? null,
      fonts: settings.fonts ?? {},
      css: String(settings.custom_css ?? ""),
      headerId: id(settings.header_id ? String(settings.header_id) : null),
      footerId: id(settings.footer_id ? String(settings.footer_id) : null),
    };
  }
  const look = (install.look && typeof install.look === "object" ? install.look : {}) as Row;
  return {
    theme: look.theme ?? null,
    fonts: look.fonts && typeof look.fonts === "object" ? look.fonts : {},
    css: typeof look.css === "string" ? look.css : "",
    headerId: id(look.headerId),
    footerId: id(look.footerId),
  };
}

const samePlatformLook = (a: PlatformLookOnly, b: PlatformLookOnly) =>
  canonicalJson([a.theme, a.fonts, a.css, a.headerId, a.footerId]) === canonicalJson([b.theme, b.fonts, b.css, b.headerId, b.footerId]);

/** Writes an install's look: into `platform_settings`' columns while it is live (D251), into its kept look otherwise. */
async function writePlatformInstallLook(tx: Pick<ReturnType<typeof db>, "execute">, install: Row, look: PlatformLookOnly) {
  if (install.live) {
    await tx.execute(sql`
      update commerce.platform_settings set theme = ${look.theme === null ? null : JSON.stringify(look.theme)}::jsonb,
        fonts = ${JSON.stringify(look.fonts ?? {})}::jsonb, custom_css = ${look.css}, header_id = ${look.headerId}::uuid, footer_id = ${look.footerId}::uuid
    `);
  } else {
    const kept: PlatformLook = { theme: look.theme, fonts: look.fonts, css: look.css, headerId: look.headerId, footerId: look.footerId };
    await tx.execute(sql`update commerce.platform_theme_installs set look = ${JSON.stringify(kept)}::jsonb where id = ${String(install.id)}::uuid`);
  }
}

/** Who an update of Kaizena Flow's site is made for when nobody pressed (the job): who installed the theme, else a platform admin. */
async function platformUpdateActor(install: Row): Promise<string | null> {
  if (install.installed_by) return String(install.installed_by);
  const [admin] = await db().execute<Row>(sql`select id from commerce.accounts where platform_admin order by created_at limit 1`);
  return admin ? String(admin.id) : null;
}

/**
 * Updates one of Kaizena Flow's installed themes to its theme's latest published version (D253), as `updateThemeInstall()` does a store's
 * (D245): the new version's fonts and pictures made ready by `placeSnapshot()` with the platform as the owner, then in one transaction under
 * `platform_settings`' row lock its settings laid under the admins' own changes (`mergeSettings()`; Kaizena Flow's fonts, a column of their own,
 * count as its settings), its CSS used only where they left it (`cssFate()`), and its header and footer replaced only where they have not been
 * edited (`layoutFate()`; an edited one stays and the new one is a draft beside it). A product page is a store's and is left out. The look before
 * and after are logged for `undoPlatformThemeUpdate()`. `admin` null: the job, for an install that follows updates. Pages, articles, menus, words
 * and pictures of Kaizena Flow are never touched.
 */
export async function updatePlatformInstall(admin: Account | null, installId: string, deps: ApplyDeps = {}): Promise<UpdateResult> {
  if (admin !== null && !admin.platformAdmin) return refuse("Only Kaizena Flow's admins change its site's look.");
  if (!isUuid(installId)) return refuse(UNKNOWN);
  const [install] = await db().execute<Row>(sql`
    select i.id, i.title, i.preset_id, i.version_id, i.live, i.look, i.placed, i.installed_by, i.variation, cur.number as current_number, cur.snapshot as current_snapshot
    from commerce.platform_theme_installs i
    left join commerce.design_preset_versions cur on cur.id = i.version_id
    where i.id = ${installId}::uuid
  `);
  if (!install || !install.preset_id) return refuse("That theme has no versions to update to.");
  const [latest] = await db().execute<Row>(sql`
    select v.id, v.number, v.snapshot, p.source_store_id
    from commerce.design_presets p
    join commerce.design_preset_versions v on v.preset_id = p.id
    where p.id = ${String(install.preset_id)}::uuid and p.published and p.archived_at is null
    order by v.number desc limit 1
  `);
  if (!latest || Number(latest.number) <= Number(install.current_number ?? 0)) return refuse("This theme is up to date.");
  const nextWhole = parseDesignSnapshot(latest.snapshot);
  if (!nextWhole) return refuse("The new version of this theme can no longer be read.");
  // An install made from a preset follows that preset (the theme's own look while a version has none of that key).
  const variation = install.variation ? String(install.variation) : null;
  const previousWhole = install.current_snapshot ? parseDesignSnapshot(install.current_snapshot) : null;
  const next = installedLook(nextWhole, variation).snapshot;
  const previous = previousWhole ? installedLook(previousWhole, variation).snapshot : null;
  const presetNote = presetLine(previousWhole, nextWhole, variation);
  const actor = admin?.id ?? (await platformUpdateActor(install));
  if (!actor) return refuse("Kaizena Flow has no admin to make the update for.");
  const title = String(install.title);
  const [menus] = await db().execute<Row>(sql`select header_menu_id, footer_menu_id from commerce.platform_settings`);

  const ready = await placeSnapshot(null, next, { sourceId: latest.source_store_id ? String(latest.source_store_id) : null, accountId: actor, title, menus: menus ?? {}, deps });
  if (!ready.ok) return ready;

  let done: { own: number; kept: string[]; notes: string[]; updateId: string };
  try {
    done = await db().transaction(async (tx) => {
      const [settings] = await tx.execute<Row>(sql`select theme, fonts, custom_css, header_id, footer_id from commerce.platform_settings for update`);
      const [fresh] = await tx.execute<Row>(sql`select id, live, look, placed, version_id from commerce.platform_theme_installs where id = ${installId}::uuid for update`);
      if (!settings || !fresh || String(fresh.version_id ?? "") !== String(install.version_id ?? "")) throw new Refused("This theme changed while it was being updated. Try again.");
      const now = platformLookNow(fresh, settings);
      const placed = (fresh.placed && typeof fresh.placed === "object" ? fresh.placed : null) as PlacedLook | null;
      const base: PlacedLook = placed ?? { settings: previous?.theme.settings ?? null, css: previous?.css ?? "", layouts: { header: null, footer: null, productLayout: null } };

      const mine = platformTheme(now.theme, parseSiteFonts(now.fonts));
      const merged = mergeSettings(base.settings, mine.settings, next.theme.settings);
      const checked = themeSettingsSchema.safeParse(merged.settings);
      if (!checked.success) throw new Refused("The changes made to this theme do not fit its new version, so it was not updated. Nothing was changed.");
      const css = cssFate(base.css, now.css, ready.siteCss);

      const notes: string[] = [];
      const keptLayouts: string[] = [];
      const after: PlatformLookOnly = {
        theme: { base: next.theme.base, savedId: null, settings: checked.data },
        fonts: checked.data.fonts ?? {},
        css: css.css,
        headerId: now.headerId,
        footerId: now.footerId,
      };
      const nextPlaced: PlacedLook = { settings: next.theme.settings, css: ready.siteCss, layouts: { header: null, footer: null, productLayout: null } };
      for (const kind of PLATFORM_KINDS) {
        const currentId = now[PLATFORM_LOOK_ID[kind]];
        let current: { id: string; hash: string } | null = null;
        if (currentId) {
          const [page] = await tx.execute<Row>(sql`select published from commerce.pages where id = ${currentId}::uuid and store_id is null`);
          const content = page ? parsePageContent(page.published) : null;
          current = { id: currentId, hash: content ? fingerprint(content) : "" };
        }
        const page = ready.pages[kind];
        const fate = layoutFate(base.layouts[kind], current, Boolean(page));
        const insert = async (published: boolean) => {
          const type = LAYOUT_PAGE_TYPE[kind];
          const taken = await tx.execute<Row>(sql`select slug from commerce.pages where store_id is null and type = ${type}`);
          const slug = designPageSlug(kind, title, taken.map((r) => String(r.slug)));
          const json = JSON.stringify({ ...page, slug });
          const [row] = await tx.execute<Row>(sql`
            insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
            values (null, ${type}, ${slug}, ${json}::jsonb, ${published ? sql`${json}::jsonb` : sql`null`}, ${published ? sql`now()` : sql`null`},
              ${published ? sql`now()` : sql`null`}, ${actor}::uuid, ${actor}::uuid)
            returning id
          `);
          return String(row.id);
        };
        if (fate.kind === "replace" && page) {
          const id = await insert(true);
          after[PLATFORM_LOOK_ID[kind]] = id;
          nextPlaced.layouts[kind] = { id, hash: fingerprint(page) };
        } else if (fate.kind === "standard") {
          after[PLATFORM_LOOK_ID[kind]] = null;
        } else if (fate.kind === "keep") {
          keptLayouts.push(kind);
          nextPlaced.layouts[kind] = base.layouts[kind];
          if (fate.offer && page) {
            await insert(false);
            notes.push(`Its ${kind} was edited and stays; the new version's is in Kaizena Flow's ${kind}s as a draft beside it.`);
          }
        }
      }

      await writePlatformInstallLook(tx, fresh, after);
      await tx.execute(sql`
        update commerce.platform_theme_installs set version_id = ${String(latest.id)}::uuid, placed = ${JSON.stringify(nextPlaced)}::jsonb where id = ${installId}::uuid
      `);
      const before: PlatformLookRecord = { ...now, versionId: install.version_id ? String(install.version_id) : null, placed: fresh.placed ?? null };
      const record: PlatformLookRecord = { ...after, versionId: String(latest.id), placed: nextPlaced };
      const kept = { settings: merged.kept, own: merged.own.length, css: css.own, layouts: keptLayouts };
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.platform_theme_install_updates (install_id, from_version_id, to_version_id, before, after, kept, updated_by)
        values (${installId}::uuid, ${install.version_id ? String(install.version_id) : null}::uuid, ${String(latest.id)}::uuid,
          ${JSON.stringify(before)}::jsonb, ${JSON.stringify(record)}::jsonb, ${JSON.stringify(kept)}::jsonb, ${admin?.id ?? null}::uuid)
        returning id
      `);
      if (css.kept) notes.push("Its own CSS was edited and stays; the new version's CSS is not used.");
      return { own: merged.own.length, kept: merged.kept, notes, updateId: String(row.id) };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    log("error", "design_presets.platform_update_failed", {}, error);
    return refuse("The theme could not be updated. Nothing was changed; try again.");
  }
  await audit(
    admin?.id ?? null,
    null,
    "platform.theme_updated",
    { install: installId, title, to: Number(latest.number), own: done.own, kept: done.kept.length, update: done.updateId, ...(admin === null && { automatic: true }) },
    { target: { type: "theme_install", id: installId } },
  );
  return { ok: true, title, version: Number(latest.number), own: done.own, kept: done.kept, notes: [...(presetNote ? [presetNote] : []), ...ready.notes, ...done.notes] };
}

/**
 * Undoes an update of one of Kaizena Flow's installed themes (D253): the look, version and what was placed go back, only while the install still
 * shows exactly what the update left. Pages the update made stay among Kaizena Flow's pages, unused.
 */
export async function undoPlatformThemeUpdate(admin: Account, updateId: string): Promise<DesignResult<{ title: string }>> {
  if (!admin.platformAdmin) return refuse("Only Kaizena Flow's admins change its site's look.");
  if (!isUuid(updateId)) return refuse("That update is not known.");
  try {
    const title = await db().transaction(async (tx) => {
      const [settings] = await tx.execute<Row>(sql`select theme, fonts, custom_css, header_id, footer_id from commerce.platform_settings for update`);
      const [update] = await tx.execute<Row>(sql`
        select id, install_id, before, after, undone_at from commerce.platform_theme_install_updates where id = ${updateId}::uuid for update
      `);
      if (!settings || !update) throw new Refused("That update is not known.");
      if (update.undone_at) throw new Refused("That update was undone already.");
      const [install] = await tx.execute<Row>(sql`
        select id, title, live, look, version_id from commerce.platform_theme_installs where id = ${String(update.install_id)}::uuid for update
      `);
      if (!install) throw new Refused("That theme is no longer installed.");
      const before = update.before as PlatformLookRecord;
      const after = update.after as PlatformLookRecord;
      if (String(install.version_id ?? "") !== String(after.versionId ?? "") || !samePlatformLook(platformLookNow(install, settings), after)) {
        throw new Refused("This theme has changed since it was updated, so the update cannot be undone. Nothing was changed.");
      }
      await writePlatformInstallLook(tx, install, before);
      await tx.execute(sql`
        update commerce.platform_theme_installs set version_id = ${before.versionId}::uuid, placed = ${before.placed === null ? null : JSON.stringify(before.placed)}::jsonb
        where id = ${String(install.id)}::uuid
      `);
      await tx.execute(sql`update commerce.platform_theme_install_updates set undone_at = now() where id = ${updateId}::uuid`);
      return String(install.title);
    });
    await audit(admin.id, null, "platform.theme_update_undone", { update: updateId, title }, { target: { type: "theme_update", id: updateId } });
    return { ok: true, title };
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    log("error", "design_presets.platform_update_undo_failed", {}, error);
    return refuse("The update could not be undone. Nothing was changed; try again.");
  }
}

/** Kaizena Flow's installs with a newer version waiting (D253), with *What's new* across every version between, and its latest updates. */
export async function platformThemeUpdates(): Promise<{ available: AvailableUpdate[]; made: MadeUpdate[]; installs: FollowingInstall[] }> {
  const rows = await db().execute<Row>(sql`
    select i.id, i.title, i.live, i.follows_updates, i.variation, cur.number as current_number, cur.snapshot as current_snapshot,
      (select jsonb_agg(jsonb_build_object('number', v.number, 'snapshot', v.snapshot, 'notes', v.notes) order by v.number)
         from commerce.design_preset_versions v where v.preset_id = i.preset_id and v.number > coalesce(cur.number, 0)) as newer
    from commerce.platform_theme_installs i
    join commerce.design_presets p on p.id = i.preset_id and p.published and p.archived_at is null
    left join commerce.design_preset_versions cur on cur.id = i.version_id
    order by i.live desc, i.title
  `);
  const made = await db().execute<Row>(sql`
    select u.id, u.created_at, u.updated_by, u.kept, u.undone_at, i.title, f.number as from_number, t.number as to_number
    from commerce.platform_theme_install_updates u
    join commerce.platform_theme_installs i on i.id = u.install_id
    left join commerce.design_preset_versions f on f.id = u.from_version_id
    left join commerce.design_preset_versions t on t.id = u.to_version_id
    order by u.created_at desc limit 10
  `);
  return updatesView(rows, made);
}

/** The words *What's new* is written in (D312 A7): English unless an admin catalogue's are given. */
export type UpdateWords = { whatsNew: WhatsNewWords; preset: PresetLineWords };

/** What `themeUpdates()` and `platformThemeUpdates()` show, from their rows: the installs, what is waiting with *What's new*, and what was made. */
function updatesView(rows: Row[], made: Row[], words?: UpdateWords): { available: AvailableUpdate[]; made: MadeUpdate[]; installs: FollowingInstall[] } {
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const available = rows.flatMap((row): AvailableUpdate[] => {
    const newer = (Array.isArray(row.newer) ? row.newer : []) as { number: number; snapshot: unknown; notes: string | null }[];
    if (newer.length === 0) return [];
    // An install made from a preset reads each version as that preset (the theme's own look where a version has none of it).
    const variation = row.variation ? String(row.variation) : null;
    let previous = row.current_snapshot ? parseDesignSnapshot(row.current_snapshot) : null;
    const lines: string[] = [];
    for (const version of newer) {
      const snap = parseDesignSnapshot(version.snapshot);
      if (!snap) continue;
      const preset = presetLine(previous, snap, variation, words?.preset);
      if (preset && !lines.includes(preset)) lines.push(preset);
      const before = previous ? installedLook(previous, variation).snapshot : null;
      const after = installedLook(snap, variation).snapshot;
      for (const line of before ? whatsNew(before, after, version.notes, words?.whatsNew) : version.notes ? [version.notes] : []) if (!lines.includes(line)) lines.push(line);
      previous = snap;
    }
    return [{ installId: String(row.id), title: String(row.title), live: row.live === true, from: number(row.current_number), to: Number(newer.at(-1)!.number), followsUpdates: row.follows_updates === true, whatsNew: lines }];
  });
  return {
    available,
    installs: rows.map((row) => ({ installId: String(row.id), title: String(row.title), live: row.live === true, version: number(row.current_number), followsUpdates: row.follows_updates === true })),
    made: made.map((row) => {
      const kept = (row.kept ?? {}) as { own?: number; settings?: string[]; layouts?: string[] };
      return {
        id: String(row.id),
        title: String(row.title),
        from: number(row.from_number),
        to: number(row.to_number),
        at: new Date(String(row.created_at)).toISOString(),
        automatic: !row.updated_by,
        own: Number(kept.own ?? 0),
        keptSettings: Array.isArray(kept.settings) ? kept.settings.length : 0,
        layoutsKept: Array.isArray(kept.layouts) ? kept.layouts : [],
        undoneAt: row.undone_at ? new Date(String(row.undone_at)).toISOString() : null,
      };
    }),
  };
}

/**
 * The job (D253): Kaizena Flow's installs that follow updates and are behind their theme's latest published version are updated by themselves.
 * A refusal leaves the install as it was, to be tried again next time or updated by hand. Never throws; says whether the live look changed, so the
 * caller refreshes Kaizena Flow's site.
 */
export async function runPlatformThemeUpdates(limit = 5, deps: ApplyDeps = {}): Promise<{ updated: number; refused: number; live: boolean }> {
  const due = await db().execute<Row>(sql`
    select i.id, i.live from commerce.platform_theme_installs i
    join commerce.design_presets p on p.id = i.preset_id and p.published and p.archived_at is null
    left join commerce.design_preset_versions cur on cur.id = i.version_id
    where i.follows_updates
      and exists (select 1 from commerce.design_preset_versions v where v.preset_id = i.preset_id and v.number > coalesce(cur.number, 0))
    order by i.installed_at
    limit ${limit}
  `);
  let updated = 0;
  let refused = 0;
  let live = false;
  for (const row of due) {
    try {
      const result = await updatePlatformInstall(null, String(row.id), deps);
      if (result.ok) {
        updated += 1;
        if (row.live) live = true;
      } else refused += 1;
    } catch (error) {
      log("error", "design_presets.platform_update_job_failed", {}, error);
      refused += 1;
    }
  }
  return { updated, refused, live };
}

// ---------------------------------------------------------------------------
// The theme checks (D246)
// ---------------------------------------------------------------------------

/** A profile's published snapshot as stored, unread (the checks say what is wrong with it). */
async function storedSnapshot(id: string): Promise<unknown> {
  const [row] = await db().execute<Row>(sql`select snapshot from commerce.design_presets where id = ${id}::uuid`);
  return row?.snapshot ?? null;
}

/** `themeCheck()` with the page rules a save asks (`pageRulesProblem()`, as a store's page). */
export async function checkedSnapshot(snapshot: unknown): Promise<ThemeCheckResult> {
  return themeCheck(snapshot, { rulesProblem: (type, content) => pageRulesProblem("theme", type, content) });
}

/**
 * The checks on what Publish would publish (D246): the workspace's draft look when the profile has one, else the snapshot as published.
 * For the platform admin's Details tab.
 */
export async function designChecks(design: DesignRow): Promise<ThemeCheckResult | null> {
  if (design.workspaceStoreId) {
    const taken = await draftedSnapshot(design);
    if (!taken.ok) return { findings: taken.problems.map((message) => ({ check: "package", blocking: true, where: "Theme", message })), blocking: taken.problems.length };
    return checkedDesign(taken.snapshot);
  }
  return checkedDesign(await storedSnapshot(design.id));
}

/**
 * The theme checks of a version with its presets (`docs/theme-showcase-phase-1.md`): the theme's own look, then each preset laid over it,
 * whose findings are named by the preset; what a preset shares with the theme (its header, footer, product page and CSS) is said once.
 */
export async function checkedDesign(snapshot: unknown): Promise<ThemeCheckResult> {
  const own = await checkedSnapshot(snapshot);
  const parsed = parseDesignSnapshot(snapshot);
  if (!parsed) return own;
  const seen = new Set(own.findings.map((f) => `${f.check}|${f.where}|${f.message}`));
  const findings = [...own.findings];
  for (const variation of variationsOf(parsed)) {
    const laid = variationSnapshot(parsed, variation.key);
    if (!laid) continue;
    for (const finding of (await checkedSnapshot(laid)).findings) {
      if (seen.has(`${finding.check}|${finding.where}|${finding.message}`)) continue;
      findings.push({ ...finding, where: `${variation.name} preset · ${finding.where}` });
    }
  }
  return { findings, blocking: findings.filter((f) => f.blocking).length };
}

/**
 * Marks a theme as one of Kaizena Flow's launch themes (D246, `syncLaunchThemes()`): its key, claimed when it is made, and the version of
 * the code's definition once that is published.
 */
export async function markLaunchTheme(presetId: string, key: string, version: number | null, listing?: Omit<ThemeListing, "pictures">): Promise<void> {
  // A launch theme's address in the theme store is its key, and its kinds and styles the code's (`docs/theme-phase-3.md`); the pictures
  // beside its main one are the platform admin's and kept. Its highlights' words (`docs/theme-showcase-phase-2.md` step 2) are the code's
  // where it has them, else the admin's, kept. What its looks are shown on is its own content (D275, `linkLaunchContent()`), never the listing.
  // Its words in other languages (D312 P3) are the code's where it has them, else the admin's, kept, as its highlights' are.
  const given = listing
    ? JSON.stringify({
        kinds: listing.kinds,
        styles: listing.styles,
        ...(listing.highlights ? { highlights: listing.highlights } : {}),
        ...(listing.words ? { words: listing.words } : {}),
      })
    : null;
  await db().execute(sql`
    update commerce.design_presets set launch_key = ${key}, launch_version = coalesce(${version}::int, launch_version),
      slug = coalesce(slug, ${key}),
      listing = case when ${given}::jsonb is null then listing
        else ${given}::jsonb || jsonb_build_object('pictures', coalesce(listing -> 'pictures', '[]'::jsonb))
          || case when ${given}::jsonb ? 'highlights' or listing -> 'highlights' is null then '{}'::jsonb
               else jsonb_build_object('highlights', listing -> 'highlights') end
          || case when ${given}::jsonb ? 'words' or listing -> 'words' is null then '{}'::jsonb
               else jsonb_build_object('words', listing -> 'words') end
          -- The admin's own pictures in place of made ones (\`docs/theme-showcase-phase-2.md\` step 3) are theirs, kept.
          || case when listing -> 'own' is null then '{}'::jsonb else jsonb_build_object('own', listing -> 'own') end end
    where id = ${presetId}::uuid
  `);
}

/**
 * Puts a platform admin's own picture in place of a made one (`docs/theme-showcase-phase-2.md` step 3), or with null takes it away so the
 * made one shows again: the share image or a highlight (`OWN_SLOTS`), an address on this site or https (as a theme's other pictures).
 * Saved at once, as the listing is; audited `platform.theme_picture_replaced` and `platform.theme_picture_restored`.
 */
export async function saveThemeOwnPicture(admin: Account, id: string, slot: OwnSlot, url: string | null): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id) || !(OWN_SLOTS as readonly string[]).includes(slot)) return refuse(UNKNOWN);
  const address = url?.trim() || null;
  if (address && !isThemePicture(address)) return refuse("A picture's address is one on this site (/…) or an https:// address.");
  const rows = await db().execute<Row>(sql`
    update commerce.design_presets set
      listing = case
        when ${address}::text is null then
          case when coalesce(listing -> 'own', '{}'::jsonb) - ${slot} = '{}'::jsonb then coalesce(listing, '{}'::jsonb) - 'own'
               else jsonb_set(listing, '{own}', (listing -> 'own') - ${slot}) end
        else coalesce(listing, '{}'::jsonb) || jsonb_build_object('own', coalesce(listing -> 'own', '{}'::jsonb) || jsonb_build_object(${slot}::text, ${address}::text))
      end,
      updated_by = ${admin.id}::uuid
    where id = ${id}::uuid returning workspace_store_id
  `);
  if (rows.length === 0) return refuse(UNKNOWN);
  await audit(admin.id, rows[0].workspace_store_id ? String(rows[0].workspace_store_id) : null, address ? "platform.theme_picture_replaced" : "platform.theme_picture_restored", { preset: id, slot }, {
    target: { type: "design_preset", id },
  });
  return { ok: true };
}

/**
 * Saves a theme's listing in the theme store (`docs/theme-phase-3.md`): its address and the kinds of store and styles it is listed under.
 * Not a draft: the list and the theme's page show it at once while the theme is published. An address another theme has is refused.
 */
export async function saveThemeListing(admin: Account, id: string, slug: string, listing: ThemeListing): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  if (!THEME_SLUG.test(slug)) return refuse("The address is lowercase letters, digits and hyphens.");
  const [taken] = await db().execute<Row>(sql`select 1 from commerce.design_presets where slug = ${slug} and id <> ${id}::uuid`);
  if (taken) return refuse("Another theme has that address. Choose another.");
  try {
    const rows = await db().execute<Row>(sql`
      update commerce.design_presets set slug = ${slug},
        -- The admin's own pictures in place of made ones are set on their own (\`saveThemeOwnPicture()\`): a listing without them keeps them.
        listing = ${JSON.stringify(readListing(listing))}::jsonb
          || case when ${JSON.stringify(readListing(listing))}::jsonb ? 'own' or listing -> 'own' is null then '{}'::jsonb else jsonb_build_object('own', listing -> 'own') end,
        updated_by = ${admin.id}::uuid
      where id = ${id}::uuid returning workspace_store_id
    `);
    if (rows.length === 0) return refuse(UNKNOWN);
    await audit(admin.id, rows[0].workspace_store_id ? String(rows[0].workspace_store_id) : null, "platform.design_preset_listed", { preset: id, slug }, { target: { type: "design_preset", id } });
  } catch (error) {
    return refuse(designProblem(error));
  }
  // A theme newly given an address is photographed if it was not yet (`queueThemeShots()` asks for what is missing).
  await askForThemeShots();
  return { ok: true };
}

/**
 * Themes from outside (D344, `src/server/theme-submissions.ts`): a new theme's address in the theme store, given when its submission is
 * approved and only while it has none.
 */
export async function giveThemeAddress(presetId: string, slug: string): Promise<void> {
  await db().execute(sql`update commerce.design_presets set slug = ${slug} where id = ${presetId}::uuid and slug is null`);
}

/** A theme drafted for a submission its author withdrew (D344): archived by them, as an admin's Archive would, while never published. */
export async function archiveWithdrawnDraft(presetId: string, accountId: string): Promise<void> {
  await db().execute(sql`
    update commerce.design_presets set archived_at = now(), archived_by = ${accountId}::uuid
     where id = ${presetId}::uuid and not published and archived_at is null
  `);
}
