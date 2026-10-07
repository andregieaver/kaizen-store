import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";
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
  snapshotFonts,
  snapshotLayout,
  snapshotStorageUrls,
  DESIGN_SNAPSHOT_VERSION,
  type DesignCard,
  type DesignDetails,
  type DesignLayoutKind,
  type DesignRow,
  type DesignSnapshot,
  type OfferedDesign,
  type SnapshotNotes,
} from "@/lib/design-presets";
import { pageInput, parsePageContent, type PageContent } from "@/lib/page-content";
import { storeOrigins } from "@/lib/paths";
import { movedOrder } from "@/lib/store-starters";
import { TEMPLATE_MEDIA_BYTES_MAX, TEMPLATE_MEDIA_MAX, isStorageUrl, leftoverStorageUrls } from "@/lib/template-content";
import { parseStoreTheme } from "@/lib/theme";

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
    where published order by position, lower(title), id
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
      join commerce.design_presets d on d.id = st.recommended_design and d.published
      where st.published
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
         d.source_store_id, s.name as source_name, s.slug as source_slug,
         (select count(distinct u.store_id)::int from commerce.design_preset_uses u where u.preset_id = d.id) as stores_using,
         coalesce((select array_agg(st.title order by st.position) from commerce.store_starters st where st.recommended_design = d.id), '{}') as recommended_by
  from commerce.design_presets d
  left join commerce.stores s on s.id = d.source_store_id
`;

function toRow(row: Row): DesignRow {
  return {
    ...toOffered(row),
    published: Boolean(row.published),
    position: Number(row.position ?? 0),
    sourceStoreId: row.source_store_id ? String(row.source_store_id) : null,
    sourceStoreName: row.source_name ? String(row.source_name) : null,
    sourceStoreSlug: row.source_slug ? String(row.source_slug) : null,
    storesUsing: Number(row.stores_using ?? 0),
    recommendedBy: ((row.recommended_by ?? []) as unknown[]).map(String),
    snapshotAt: new Date(String(row.snapshot_at)).toISOString(),
    readable: parseDesignSnapshot(row.snapshot) !== null,
  };
}

/** Every design profile, published or not, for the platform admin. */
export async function listDesigns(): Promise<DesignRow[]> {
  const rows = await db().execute<Row>(sql`${ROW_SELECT} order by d.position, lower(d.title), d.id`);
  return rows.map(toRow);
}

/** One design profile, for its edit page; null when there is none. */
export async function getDesign(id: string): Promise<DesignRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db().execute<Row>(sql`${ROW_SELECT} where d.id = ${id}::uuid`);
  return row ? toRow(row) : null;
}

/**
 * The stores a platform admin may take a snapshot from: those they work in (the default template and store templates among them, which
 * they reach as members), not closed.
 */
export async function snapshotSources(admin: Account): Promise<{ id: string; name: string; slug: string; kind: "template" | "starter" | "store" }[]> {
  if (!admin.platformAdmin) return [];
  const rows = await db().execute<Row>(sql`
    select s.id, s.name, s.slug, s.is_template, s.starter from commerce.stores s
    join commerce.store_members m on m.store_id = s.id and m.account_id = ${admin.id}::uuid and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now())
    where s.status <> 'closed'
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
 * (`snapshotLayout()`). Reads only the store's look (`LOOK_FIELDS`) and its menus' ids, never its brand.
 */
export async function takeSnapshot(storeId: string): Promise<DesignResult<{ snapshot: DesignSnapshot; notes: string[] }>> {
  const [store] = await db().execute<Row>(sql`
    select s.id, s.slug, s.theme, s.custom_css, s.header_menu_id, s.footer_menu_id,
      (select p.published from commerce.pages p where p.store_id = s.id and p.id = s.header_id and p.type = 'header' and p.published_at is not null) as header,
      (select p.published from commerce.pages p where p.store_id = s.id and p.id = s.footer_id and p.type = 'footer' and p.published_at is not null) as footer,
      (select p.published from commerce.pages p where p.store_id = s.id and p.id = s.product_layout_id and p.type = 'product_layout' and p.published_at is not null) as product_layout
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

/** Whether the admin works in the store (a snapshot is only taken of a store they can see in its own admin). */
async function works(accountId: string, storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 as ok from commerce.store_members m join commerce.stores s on s.id = m.store_id
    where m.store_id = ${storeId}::uuid and m.account_id = ${accountId}::uuid and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now()) and s.status <> 'closed'
  `);
  return row !== undefined;
}

/** A new design profile from a store the platform admin works in: its snapshot now, unpublished and last in the order. */
export async function createDesign(
  admin: Account,
  input: { storeId: string; details: DesignDetails },
): Promise<DesignResult<{ id: string; notes: string[] }>> {
  if (!admin.platformAdmin) return refuse("Only Kaizen's admins make design profiles.");
  if (!isUuid(input.storeId) || !(await works(admin.id, input.storeId))) return refuse("Choose a store you work in.");
  const taken = await takeSnapshot(input.storeId);
  if (!taken.ok) return taken;
  const { title, summary, description, pictureUrl } = input.details;
  let id: string;
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.design_presets (title, summary, description, picture_url, snapshot, source_store_id, position, published, created_by, updated_by)
      values (${title}, ${summary}, ${description}, ${pictureUrl}, ${JSON.stringify(taken.snapshot)}::jsonb, ${input.storeId}::uuid,
        (select coalesce(max(position), 0) + 1 from commerce.design_presets), false, ${admin.id}::uuid, ${admin.id}::uuid)
      returning id
    `);
    id = String(row.id);
  } catch (error) {
    return refuse(designProblem(error));
  }
  await audit(admin.id, input.storeId, "platform.design_preset_created", { preset: id, title }, { target: { type: "design_preset", id } });
  return { ok: true, id, notes: taken.notes };
}

/** Takes the snapshot again from the profile's store, as it looks now (*Update from its store*). Stores that applied it keep what they got. */
export async function retakeDesign(admin: Account, id: string): Promise<DesignResult<{ notes: string[] }>> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const [preset] = await db().execute<Row>(sql`select source_store_id from commerce.design_presets where id = ${id}::uuid`);
  if (!preset) return refuse(UNKNOWN);
  const source = preset.source_store_id ? String(preset.source_store_id) : null;
  if (!source || !(await works(admin.id, source))) return refuse("Its store is gone or you do not work in it: open the store's admin first, or make a new profile.");
  const taken = await takeSnapshot(source);
  if (!taken.ok) return taken;
  try {
    await db().execute(sql`
      update commerce.design_presets set snapshot = ${JSON.stringify(taken.snapshot)}::jsonb, snapshot_at = now(), updated_by = ${admin.id}::uuid
      where id = ${id}::uuid
    `);
  } catch (error) {
    return refuse(designProblem(error));
  }
  await audit(admin.id, source, "platform.design_preset_retaken", { preset: id }, { target: { type: "design_preset", id } });
  return { ok: true, notes: taken.notes };
}

/** A design profile's title, summary, description and picture. */
export async function updateDesign(admin: Account, id: string, details: DesignDetails): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  let row: Row | undefined;
  try {
    [row] = await db().execute<Row>(sql`
      update commerce.design_presets
         set title = ${details.title}, summary = ${details.summary}, description = ${details.description},
             picture_url = ${details.pictureUrl}, updated_by = ${admin.id}::uuid
       where id = ${id}::uuid
      returning source_store_id
    `);
  } catch (error) {
    return refuse(designProblem(error));
  }
  if (!row) return refuse(UNKNOWN);
  await audit(admin.id, row.source_store_id ? String(row.source_store_id) : null, "platform.design_preset_updated", { preset: id }, {
    target: { type: "design_preset", id },
  });
  return { ok: true };
}

/** Offers a design profile to every store, or stops offering it (stores that applied it keep their look). */
export async function setDesignPublished(admin: Account, id: string, published: boolean): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const [row] = await db().execute<Row>(sql`select snapshot from commerce.design_presets where id = ${id}::uuid`);
  if (!row) return refuse(UNKNOWN);
  if (published && !parseDesignSnapshot(row.snapshot)) return refuse("Its snapshot can no longer be read: update it from its store first.");
  const [changed] = await db().execute<Row>(sql`
    update commerce.design_presets set published = ${published}, updated_by = ${admin.id}::uuid
     where id = ${id}::uuid and published is distinct from ${published}
    returning source_store_id
  `);
  if (!changed) return { ok: true };
  await audit(admin.id, changed.source_store_id ? String(changed.source_store_id) : null, published ? "platform.design_preset_published" : "platform.design_preset_unpublished", { preset: id }, {
    target: { type: "design_preset", id },
  });
  return { ok: true };
}

/** Moves a design profile one place up or down in the order stores see; the order is written again as 1, 2, 3 … */
export async function moveDesign(admin: Account, id: string, direction: "up" | "down"): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const moved = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commerce.design_presets.position'))`);
    const rows = await tx.execute<Row>(sql`select id from commerce.design_presets order by position, lower(title), id`);
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

/**
 * The design profile a store template (D175) offers first when a store is made from it, or none. A convenience only: the person creating
 * the store may choose any other, and the profile is offered only while published.
 */
export async function setRecommendedDesign(admin: Account, starterId: string, presetId: string | null): Promise<DesignResult> {
  if (!admin.platformAdmin || !isUuid(starterId) || (presetId !== null && !isUuid(presetId))) return refuse("Unknown store template.");
  if (presetId) {
    const [preset] = await db().execute<Row>(sql`select 1 as ok from commerce.design_presets where id = ${presetId}::uuid`);
    if (!preset) return refuse(UNKNOWN);
  }
  const [row] = await db().execute<Row>(sql`
    update commerce.store_starters set recommended_design = ${presetId}::uuid, updated_by = ${admin.id}::uuid
     where id = ${starterId}::uuid
    returning store_id
  `);
  if (!row) return refuse("Unknown store template.");
  await audit(admin.id, String(row.store_id), "platform.design_preset_recommended", { starter: starterId, preset: presetId }, {
    target: { type: "store_starter", id: starterId },
  });
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
    select s.slug, s.status, s.starter, s.header_menu_id, s.footer_menu_id,
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

  const [preset] = await db().execute<Row>(sql`
    select id, title, snapshot, published, source_store_id from commerce.design_presets where id = ${presetId}::uuid
  `);
  if (!preset) return refuse(UNKNOWN);
  if (!preset.published && !(platformAdmin && facts.starter)) return refuse(NOT_OFFERED);
  const snapshot = parseDesignSnapshot(preset.snapshot);
  if (!snapshot) return refuse("This design profile can no longer be read.");
  const title = String(preset.title);

  // Fonts first (D59): a page never shows a font Kaizen does not have.
  const fonts = snapshotFonts(snapshot);
  const unknown = fonts.filter((family) => !findFont(family));
  if (unknown.length > 0) return refuse(`${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not in Google Fonts.`);
  const installed = await (deps.installFonts ?? installFonts)(fonts);
  if (!installed.ok) return refuse(installed.problem);

  // Pictures and videos: the source store's own files are copied into this store's library (D125's way); any other upload is left out.
  const wanted = snapshotStorageUrls(snapshot);
  const sourceId = preset.source_store_id ? String(preset.source_store_id) : null;
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
    const copy = await copyToLibrary({ storeId, accountId }, file, deps.copyFile);
    if (copy) copies.set(file.id, copy);
  }
  for (const url of wanted) {
    const file = files.get(url);
    const copy = file && copies.get(file.id);
    const next = copy ? (url === file.thumbnailUrl && url !== file.url ? copy.thumbnailUrl : copy.url) : null;
    if (next) replaced.set(url, next);
  }
  const placed = mapSnapshotMedia(snapshot, (url) => (isStorageUrl(url) ? (replaced.get(url) ?? null) : url));
  const notes: string[] = [];
  const leftOut = new Set(wanted.filter((url) => !replaced.has(url))).size;
  if (leftOut > 0) notes.push(`${leftOut} ${leftOut === 1 ? "picture" : "pictures"} could not be copied and ${leftOut === 1 ? "was" : "were"} left out.`);

  // The pages, checked as the builder checks a save; their addresses are chosen inside the transaction.
  const menus = { header: facts.header_menu_id ? String(facts.header_menu_id) : null, footer: facts.footer_menu_id ? String(facts.footer_menu_id) : null };
  const pages: Partial<Record<DesignLayoutKind, PageContent>> = {};
  for (const kind of DESIGN_LAYOUT_KINDS) {
    const layout = placed[kind];
    if (!layout) continue;
    const content = layoutForStore(layout, menus, { title: designPageTitle(kind, title), slug: "design" });
    const parsed = pageInput.safeParse(content);
    const problem = parsed.success ? pageRulesProblem(storeId, LAYOUT_PAGE_TYPE[kind], parsed.data) : parsed.error.issues[0]?.message;
    if (problem || !parsed.success) return refuse(`The profile's ${designPageTitle(kind, "").trim()} does not fit this store: ${problem ?? "it cannot be read"}`);
    if (leftoverStorageUrls(parsed.data, new Set(replaced.values())).length > 0) return refuse("This design profile could not be made ready for your store.");
    pages[kind] = parsed.data;
  }
  const siteCss = cssProblem(placed.css) === null ? placed.css : "";

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
      media: copies.size,
      ...(leftOut > 0 && { mediaLeftOut: leftOut }),
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
};

async function readPreview(presetId: string, starterId: string | null, admin: boolean): Promise<DesignPreview | null> {
  if (!isUuid(presetId) || (starterId !== null && !isUuid(starterId))) return null;
  const [preset] = await readDb().execute<Row>(sql`
    select id, title, snapshot from commerce.design_presets where id = ${presetId}::uuid and (published or ${admin})
  `);
  const snapshot = preset ? parseDesignSnapshot(preset.snapshot) : null;
  if (!preset || !snapshot) return null;
  const [store] = starterId
    ? await readDb().execute<Row>(sql`
        select s.slug, st.title from commerce.store_starters st join commerce.stores s on s.id = st.store_id and s.starter
        where st.id = ${starterId}::uuid and s.status = 'active' and (st.published or ${admin})
      `)
    : await readDb().execute<Row>(sql`select slug, null as title from commerce.stores where is_template`);
  if (!store) return null;
  const wanted = snapshotFonts(snapshot);
  const installed = wanted.length === 0
    ? []
    : await readDb().execute<Row>(sql`select family from commerce.fonts where family in (${sql.join(wanted.map((f) => sql`${f}`), sql`, `)})`);
  const fonts = wanted.filter((family) => installed.some((row) => row.family === family));
  return { id: String(preset.id), title: String(preset.title), snapshot, storeSlug: String(store.slug), starterTitle: store.title ? String(store.title) : null, fonts };
}

/**
 * A published profile on a published store template (or the default template), for the public preview: cached per profile and template
 * under `DESIGNS_TAG` and `STARTERS_TAG`, null for anything unpublished. Reads nothing of the visitor.
 */
export async function publicDesignPreview(presetId: string, starterId: string | null): Promise<DesignPreview | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  return readPreview(presetId, starterId, false);
}

/** The same for a platform admin (the caller checked): unpublished profiles and templates too. Never cached. */
export async function adminDesignPreview(presetId: string, starterId: string | null): Promise<DesignPreview | null> {
  return readPreview(presetId, starterId, true);
}

/** Every published store template, for the preview's chooser and the platform's pages. */
export async function previewStarters(): Promise<{ id: string; title: string }[]> {
  const rows = await readDb().execute<Row>(sql`
    select st.id, st.title from commerce.store_starters st join commerce.stores s on s.id = st.store_id and s.status = 'active'
    where st.published order by st.position, lower(st.title)
  `);
  return rows.map((r) => ({ id: String(r.id), title: String(r.title) }));
}
