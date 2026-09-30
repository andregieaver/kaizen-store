import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { PageLayout } from "@/lib/page-layout";
import type { PageRow, PageType } from "@/lib/page-content";
import { parseSavedPart, savedPartInput, type SavedPart, type SavedPartKind } from "@/lib/saved-parts";
import {
  TEMPLATE_MEDIA_BYTES_MAX,
  TEMPLATE_MEDIA_MAX,
  isStorageUrl,
  leftoverStorageUrls,
  mapTemplateMedia,
  sanitizeTemplate,
  templateMediaUrls,
  templateSummary,
  type ForeignStore,
  type PartContent,
} from "@/lib/template-content";
import {
  PART_SHARING,
  type PartSharing,
  type TemplateItem,
  type TemplatePreview,
  type TemplateResult,
  type TemplateSource,
} from "@/lib/templates";
import { storeOrigins } from "@/lib/paths";

import { audit, type Account } from "./auth";
import { copyStoredFile } from "./media";
import { copyToLibrary, libraryFilesByUrl, type LibraryFile } from "./media-library";

/**
 * Templates (D125): a store's saved rows, columns and components (D46) shared with its owner's other stores or with
 * every store owner, and Kaizen's own saved parts as the marketplace's first listing. A store lists what it may see,
 * activates what it wants in the builder's Templates tab and uses a template as a copy (`applyTemplate`): the copy is
 * the store's own, with nothing of the other owner's in it, so no later edit or removal of the template reaches a
 * page. A platform admin can hide a template from every list; copies already made stay.
 *
 * Who sees a template is decided here and only here (`visibleTo`): never the store itself, never a hidden one, the
 * marketplace's to every member of the viewing store, and a `stores` template to an account that owns both the
 * store it came from and the viewing store, read when asked so a lost ownership takes it away at once.
 */

type Row = Record<string, unknown>;

const isId = (id: string) => z.uuid().safeParse(id).success;
const problem = (message: string): { ok: false; problems: string[] } => ({ ok: false, problems: [message] });
const unavailable = problem("This template is not available to your store.");
export const NOT_OWNER = "Only the store's owners can change who a saved part is shared with.";

/** The most templates one list returns (the newest); the marketplace can grow past what one list can show. */
export const TEMPLATES_LIST_MAX = 500;

/** Whether the account is an owner of the store (staff are not), and still works there. */
export async function isStoreOwner(accountId: string, storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 as ok from commerce.store_members m
    where m.store_id = ${storeId}::uuid and m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
  `);
  return row !== undefined;
}

const owns = (store: ReturnType<typeof sql>, accountId: string) => sql`exists (
  select 1 from commerce.store_members o
  where o.store_id = ${store} and o.account_id = ${accountId}::uuid and o.role = 'owner' and o.disabled_at is null
)`;

/** The condition a saved part `sp` must meet to be a template the account may see in store `storeId`. */
function visibleTo(storeId: string, accountId: string, source: TemplateSource | "any") {
  const viewer = sql`${storeId}::uuid`;
  const marketplace = sql`sp.sharing = 'marketplace'`;
  const ofMyStores = sql`(sp.sharing = 'stores' and sp.store_id is not null and ${owns(viewer, accountId)} and ${owns(sql`sp.store_id`, accountId)})`;
  const shared =
    source === "marketplace" ? marketplace : source === "stores" ? ofMyStores : sql`(${marketplace} or ${ofMyStores})`;
  return sql`sp.store_id is distinct from ${viewer} and sp.hidden_at is null
    and exists (
      select 1 from commerce.store_members v
      where v.store_id = ${viewer} and v.account_id = ${accountId}::uuid and v.disabled_at is null
    )
    and ${shared}`;
}

// ---------------------------------------------------------------------------
// Listing and switching on
// ---------------------------------------------------------------------------

/**
 * The templates the store may see from a source, newest first (at most `TEMPLATES_LIST_MAX`): its owner's other
 * stores' (`stores`) or the marketplace's (`marketplace`, Kaizen's included). Its own saved parts, hidden templates
 * and ones whose content cannot be read are left out. One query. `active` says whether the store has them switched
 * on: Kaizen's are on until switched off, every other is off until switched on.
 */
export async function listTemplates(
  storeId: string,
  account: Account,
  source: TemplateSource,
): Promise<TemplateItem[]> {
  const rows = await db().execute<Row>(sql`
    select sp.id, sp.kind, sp.name, sp.content, sp.sharing, sp.updated_at, sp.store_id is null as from_kaizen,
      coalesce(s.name, 'Kaizen') as publisher, coalesce(a.active, sp.store_id is null) as active
    from commerce.saved_parts sp
    left join commerce.stores s on s.id = sp.store_id
    left join commerce.template_activations a on a.part_id = sp.id and a.store_id = ${storeId}::uuid
    where ${visibleTo(storeId, account.id, source)}
    order by sp.updated_at desc, sp.id
    limit ${TEMPLATES_LIST_MAX}
  `);
  return rows.flatMap((row): TemplateItem[] => {
    const updatedAt = new Date(String(row.updated_at)).toISOString();
    const part = parseSavedPart({
      id: String(row.id),
      kind: String(row.kind),
      name: String(row.name),
      content: row.content,
      updatedAt,
    });
    if (!part) return [];
    return [
      {
        id: part.id,
        kind: part.kind,
        pageType: part.kind === "page" ? part.content.pageType : null,
        name: part.name,
        summary: templateSummary(part.kind, part.content),
        publisher: String(row.publisher),
        fromKaizen: Boolean(row.from_kaizen),
        sharing: row.sharing === "stores" ? "stores" : "marketplace",
        active: Boolean(row.active),
        updatedAt,
      },
    ];
  });
}

/** Switches a template on or off for the store; only one the store may see. */
export async function setTemplateActive(
  storeId: string,
  account: Account,
  id: string,
  active: boolean,
): Promise<TemplateResult> {
  if (!isId(id)) return unavailable;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.template_activations (store_id, part_id, active, changed_by)
    select ${storeId}::uuid, sp.id, ${active}, ${account.id}::uuid
    from commerce.saved_parts sp
    where sp.id = ${id}::uuid and ${visibleTo(storeId, account.id, "any")}
    on conflict (store_id, part_id) do update
      set active = excluded.active, changed_at = now(), changed_by = excluded.changed_by
    returning part_id, (select name from commerce.saved_parts where id = part_id) as name
  `);
  if (!row) return unavailable;
  await audit(account.id, storeId, active ? "store.template_activated" : "store.template_deactivated", {
    part: id,
    name: String(row.name),
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Using
// ---------------------------------------------------------------------------

/** A template the store may see, read and made ready for another store: what `applyTemplate` and `previewTemplate` share. */
async function readTemplate(
  storeId: string,
  account: Account,
  id: string,
): Promise<
  | { ok: true; template: SavedPart; sourceId: string | null; publisher: string; clean: PartContent }
  | { ok: false; problems: string[] }
> {
  if (!isId(id)) return unavailable;
  const [row] = await db().execute<Row>(sql`
    select sp.id, sp.kind, sp.name, sp.content, sp.updated_at, sp.store_id as source_id, s.slug as source_slug,
      coalesce(s.name, 'Kaizen') as publisher
    from commerce.saved_parts sp
    left join commerce.stores s on s.id = sp.store_id
    where sp.id = ${id}::uuid and ${visibleTo(storeId, account.id, "any")}
  `);
  if (!row) return unavailable;
  const template = parseSavedPart({
    id,
    kind: String(row.kind),
    name: String(row.name),
    content: row.content,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
  if (!template) return problem("This template can no longer be read.");

  const sourceId = row.source_id === null ? null : String(row.source_id);
  const sourceSlug = row.source_slug === null ? null : String(row.source_slug);
  const from: ForeignStore = {
    id: sourceId,
    slug: sourceSlug,
    hosts: sourceSlug ? storeOrigins(sourceSlug).map((origin) => new URL(origin).host) : [],
  };
  const clean = sanitizeTemplate(template.kind, template.content, from, sourceId === null);
  return { ok: true, template, sourceId, publisher: String(row.publisher), clean };
}

/** What a use reaches outside the database: Storage's copy, replaceable in tests. */
export type TemplateDeps = { copyFile?: typeof copyStoredFile };

/**
 * A template as a copy to put on the store's page (not saved): the saved part with global marks, form recipients,
 * links and ids into the other store, its owner's contact details and its HTML gone (Kaizen's HTML stays), and its
 * pictures and videos copied into this store's media library, so a page never depends on another owner's files.
 * A file that cannot be copied is left out; one use copies at most `TEMPLATE_MEDIA_MAX` files and
 * `TEMPLATE_MEDIA_BYTES_MAX` bytes, the rest are left out too. The copy has the template's id, is not global and
 * is shared with nobody; the builder gives everything in it new ids as it places it.
 */
export async function applyTemplate(
  storeId: string,
  account: Account,
  id: string,
  deps: TemplateDeps = {},
): Promise<TemplateResult<{ part: SavedPart }>> {
  const read = await readTemplate(storeId, account, id);
  if (!read.ok) return read;
  const { template, sourceId, clean } = read;

  // Pictures and videos: the site's own files are copied into this store's library, others stay as they are.
  const wanted = templateMediaUrls(template.kind, clean).filter(isStorageUrl);
  const files = await libraryFilesByUrl(sourceId, wanted);
  const chosen = new Map<string, LibraryFile>();
  let bytes = 0;
  for (const url of wanted) {
    const file = files.get(url);
    if (!file) continue;
    if (!chosen.has(file.id)) {
      if (chosen.size >= TEMPLATE_MEDIA_MAX || bytes + file.sizeBytes > TEMPLATE_MEDIA_BYTES_MAX) continue;
      chosen.set(file.id, file);
      bytes += file.sizeBytes;
    }
  }
  const copies = new Map<string, { url: string; thumbnailUrl: string | null }>();
  for (const file of chosen.values()) {
    const copy = await copyToLibrary({ storeId, accountId: account.id }, file, deps.copyFile);
    if (copy) copies.set(file.id, copy);
  }
  const replaced = new Map<string, string>();
  for (const url of wanted) {
    const file = files.get(url);
    const copy = file && copies.get(file.id);
    const next = copy ? (url === file.thumbnailUrl && url !== file.url ? copy.thumbnailUrl : copy.url) : null;
    if (next) replaced.set(url, next);
  }
  const placed = mapTemplateMedia(template.kind, clean, (url) =>
    isStorageUrl(url) ? (replaced.get(url) ?? null) : url,
  );
  const checked = savedPartInput.safeParse({
    kind: template.kind,
    name: template.name,
    content: placed,
    sharing: "private",
  });
  // Nothing may still point into Storage but the copies just made.
  if (!checked.success || leftoverStorageUrls(checked.data.content, new Set(replaced.values())).length > 0) {
    return problem("This template could not be made ready for your store.");
  }
  await audit(account.id, storeId, "store.template_used", {
    part: id,
    name: template.name,
    kind: template.kind,
    from: sourceId ?? "kaizen",
    media: copies.size,
    ...(wanted.length > replaced.size && { mediaLeftOut: new Set(wanted.filter((url) => !replaced.has(url))).size }),
  });
  const part = {
    id,
    updatedAt: template.updatedAt,
    kind: checked.data.kind,
    name: checked.data.name,
    content: checked.data.content,
    global: false,
    translations: {},
    uses: 0,
    sharing: "private",
  } as SavedPart;
  return { ok: true, part };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const PREVIEW_ROW = "preview-row";
const PREVIEW_COLUMN = "preview-column";

/** What a template draws as: always rows (a column a row of one column, a block a single-column row holding it). */
function previewRows(part: SavedPart): PageRow[] {
  if (part.kind === "page") return part.content.rows;
  if (part.kind === "row") return [part.content];
  const column = part.kind === "column" ? part.content : { id: PREVIEW_COLUMN, blocks: [part.content] };
  return [{ id: PREVIEW_ROW, type: "row", layout: "1", columns: [column] }];
}

/**
 * A template as it is shown before it is activated or used (D127), for the store's members who may see it (the same
 * `visibleTo` rule as a use: a hidden one, the store's own and another owner's private one are unavailable): the
 * content a use would copy, cleaned the same way, drawn as `rows` and the layout's own `css`. View-only: nothing is
 * copied, written or audited, so its pictures still point at the publisher's public files.
 */
export async function previewTemplate(
  storeId: string,
  account: Account,
  id: string,
): Promise<TemplateResult<{ preview: TemplatePreview }>> {
  const read = await readTemplate(storeId, account, id);
  if (!read.ok) return read;
  const { template, publisher, sourceId, clean } = read;
  const checked = savedPartInput.safeParse({
    kind: template.kind,
    name: template.name,
    content: clean,
    sharing: "private",
  });
  if (!checked.success) return problem("This template could not be made ready for your store.");
  const part = { ...template, kind: checked.data.kind, content: checked.data.content } as SavedPart;
  return {
    ok: true,
    preview: {
      id,
      kind: part.kind,
      name: template.name,
      publisher,
      fromKaizen: sourceId === null,
      pageType: part.kind === "page" ? part.content.pageType : null,
      summary: templateSummary(part.kind, part.content),
      rows: previewRows(part),
      css: part.kind === "page" ? (part.content as PageLayout).css : "",
    },
  };
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/** Changes who can use one of the store's own saved parts as a template; only the store's owners do. */
export async function setPartSharing(
  storeId: string,
  account: Account,
  id: string,
  sharing: PartSharing,
): Promise<TemplateResult> {
  if (!isId(id) || !PART_SHARING.includes(sharing)) return problem("This saved part no longer exists.");
  if (!(await isStoreOwner(account.id, storeId))) return problem(NOT_OWNER);
  const [row] = await db().execute<Row>(sql`
    with old as (
      select id, sharing from commerce.saved_parts where id = ${id}::uuid and store_id = ${storeId}::uuid for update
    )
    update commerce.saved_parts sp
       set sharing = ${sharing}, updated_at = now(), updated_by = ${account.id}::uuid
      from old where sp.id = old.id
    returning sp.name, old.sharing as before
  `);
  if (!row) return problem("This saved part no longer exists.");
  if (row.before !== sharing) {
    await audit(account.id, storeId, "store.part_sharing", {
      part: id,
      name: String(row.name),
      from: String(row.before),
      to: sharing,
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Moderation (platform admins)
// ---------------------------------------------------------------------------

export type ModerationItem = {
  id: string;
  kind: SavedPartKind;
  /** For a page layout (D127): the kind of page it is for. */
  pageType: PageType | null;
  name: string;
  summary: string;
  /** The store's name, or "Kaizen". */
  publisher: string;
  storeSlug: string | null;
  fromKaizen: boolean;
  sharing: PartSharing;
  hidden: boolean;
  hiddenAt: string | null;
  updatedAt: string;
};

/**
 * Every marketplace template, and any that is hidden whatever its sharing is now (so it can be shown again), newest
 * first: for the platform's moderation page. The caller has checked the account runs the platform.
 */
export async function listMarketplaceTemplates(): Promise<ModerationItem[]> {
  const rows = await db().execute<Row>(sql`
    select sp.id, sp.kind, sp.name, sp.content, sp.sharing, sp.updated_at, sp.hidden_at, sp.store_id is null as from_kaizen,
      coalesce(s.name, 'Kaizen') as publisher, s.slug as store_slug
    from commerce.saved_parts sp
    left join commerce.stores s on s.id = sp.store_id
    where sp.sharing = 'marketplace' or sp.hidden_at is not null
    order by sp.updated_at desc, sp.id
    limit ${TEMPLATES_LIST_MAX}
  `);
  return rows.flatMap((row): ModerationItem[] => {
    const updatedAt = new Date(String(row.updated_at)).toISOString();
    const part = parseSavedPart({
      id: String(row.id),
      kind: String(row.kind),
      name: String(row.name),
      content: row.content,
      updatedAt,
    });
    return [
      {
        id: String(row.id),
        kind: row.kind as ModerationItem["kind"],
        pageType: part?.kind === "page" ? part.content.pageType : null,
        name: String(row.name),
        summary: part ? templateSummary(part.kind, part.content) : "Cannot be read",
        publisher: String(row.publisher),
        storeSlug: row.store_slug === null ? null : String(row.store_slug),
        fromKaizen: Boolean(row.from_kaizen),
        sharing: row.sharing as PartSharing,
        hidden: row.hidden_at !== null,
        hiddenAt: row.hidden_at === null ? null : new Date(String(row.hidden_at)).toISOString(),
        updatedAt,
      },
    ];
  });
}

/**
 * Hides a template from every list, or shows it again. Only a platform admin; copies already made stay, and the
 * hiding stays through the publisher changing how it is shared.
 */
export async function setTemplateHidden(account: Account, id: string, hidden: boolean): Promise<TemplateResult> {
  if (!account.platformAdmin) return problem("Only the platform's admins can hide templates.");
  if (!isId(id)) return problem("This template no longer exists.");
  const [row] = await db().execute<Row>(sql`
    update commerce.saved_parts
       set hidden_at = ${hidden ? sql`coalesce(hidden_at, now())` : sql`null`},
           hidden_by = ${hidden ? sql`coalesce(hidden_by, ${account.id}::uuid)` : sql`null`}
     where id = ${id}::uuid
    returning name, store_id
  `);
  if (!row) return problem("This template no longer exists.");
  await audit(
    account.id,
    row.store_id === null ? null : String(row.store_id),
    hidden ? "platform.template_hidden" : "platform.template_unhidden",
    {
      part: id,
      name: String(row.name),
    },
  );
  return { ok: true };
}
