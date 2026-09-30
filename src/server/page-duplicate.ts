import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { copySlug, copyTitle } from "@/lib/page-duplicate";
import { type PageType } from "@/lib/page-content";

import { audit, type Account } from "./auth";
import { getPageForEdit, savePage, type PageOwner, type PageResult } from "./pages";

/**
 * Duplicates a page, article, product layout, header or footer of the owner's (decision D126). The copy is a new DRAFT
 * (never live, never the front page or a role's page) with "Copy of" before its title and a free address; it is made
 * by the same save as any page, so it is checked, its fonts and its categories and tags are looked after, and the
 * global parts (D98) it holds are counted as used. It copies the working draft, or, from the builder, what the editor
 * holds right now (`edited`, the JSON the editor would save), so changes not yet saved are not lost; that never carries
 * `globalEdits`, since a copy must not change a global part for the pages that use it. A page's or article's custom
 * field values (D118) are copied with it.
 */
export async function duplicatePage(
  account: Account,
  owner: PageOwner,
  id: string,
  type: PageType = "page",
  edited?: unknown,
): Promise<PageResult> {
  const source = await getPageForEdit(owner, id, type);
  if (!source) return { ok: false, problems: ["This page no longer exists. It may have been deleted."] };

  // From the editor: the content it holds now, without what only a save of the original may do.
  const held = isRecord(edited) ? withoutSaveOnly(edited) : null;
  const content = held ?? source.draft;

  const taken = await addressesInUse(owner, type);
  const title = copyTitle(String(content.title ?? source.draft.title));
  const slug = copySlug(String(content.slug ?? source.slug), taken);

  const result = await savePage(account, owner, null, { ...content, title, slug }, { publish: false, type });
  if (!result.ok) return result;

  if (type === "page" || type === "article") await copyFieldValues(owner, type, id, result.id);
  await audit(account.id, owner, `${owner === null ? "platform" : "store"}.${type}_duplicated`, {
    from: id,
    page: result.id,
    slug,
  });
  return result;
}

/** Every address the owner's pages of this type use, live or draft. */
async function addressesInUse(owner: PageOwner, type: PageType): Promise<Set<string>> {
  const rows = await db().execute<{ slug: string }>(sql`
    select slug from commerce.pages where store_id is not distinct from ${owner}::uuid and type = ${type}
  `);
  return new Set(rows.map((row) => String(row.slug)));
}

/** A store's page or article keeps what was entered in its custom fields, in every language, when it is copied. */
async function copyFieldValues(owner: PageOwner, entity: "page" | "article", from: string, to: string): Promise<void> {
  if (owner === null) return;
  await db().execute(sql`
    insert into commerce.field_values (store_id, entity, entity_id, locale, values)
    select store_id, entity, ${to}::uuid, locale, values from commerce.field_values
    where store_id = ${owner}::uuid and entity = ${entity} and entity_id = ${from}::uuid
    on conflict (store_id, entity, entity_id, locale) do nothing
  `);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What the editor sends beyond the page: the globals it changed and its field entries belong to a save of the original. */
function withoutSaveOnly(edited: Record<string, unknown>): Record<string, unknown> {
  const content = { ...edited };
  delete content.globalEdits;
  delete content.fields;
  return content;
}
