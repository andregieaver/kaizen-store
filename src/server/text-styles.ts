import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { TEXT_STYLES_MAX, TEXT_STYLE_KINDS, slugFor, styleCssBody, styleCssProblem, stylesInMarkup, textStylesCss, type TextStyle, type TextStyleSettings } from "@/lib/text-styles";
import { textStyleInput } from "@/lib/text-styles-schema";

import { audit, type Account } from "./auth";
import { log } from "./log";
import { refreshTag } from "./refresh";
import { col, typedRows } from "./typed-rows";

/**
 * Text styles (D393, `docs/text-styles.md`): the only writer and reader of `commerce.text_styles`, a store's library or Kaizena Flow's own
 * (`owner` null). Each style becomes the class `ts-{slug}` drawn by `textStylesCss()`; the slug is made once from the name and never
 * changes, so renaming a style never breaks a word that wears it. Deleting one leaves the words, unstyled.
 */

export const textStylesTag = (owner: string | null) => `text-styles:${owner ?? "kaizen"}`;

const ownerIs = (owner: string | null) => (owner === null ? sql`store_id is null` : sql`store_id = ${owner}::uuid`);

const ROW = z.object({
  slug: col.text,
  name: col.text,
  kind: z.enum(TEXT_STYLE_KINDS),
  settings: z.record(z.string(), z.unknown()),
  css: col.textOrNull,
});

const asStyle = (row: z.infer<typeof ROW>): TextStyle => ({
  slug: row.slug,
  name: row.name,
  kind: row.kind,
  settings: row.settings as TextStyleSettings,
  css: row.css,
});

/** A site's styles in the library's order, uncached (the builder's own copy, and writers). */
export async function listTextStyles(owner: string | null): Promise<TextStyle[]> {
  const rows = await typedRows(ROW, sql`select slug, name, kind, settings, css from commerce.text_styles where ${ownerIs(owner)} order by position, created_at, slug`);
  return rows.map(asStyle);
}

/** A site's styles as its pages draw them, cached under `textStylesTag(owner)`. */
export async function textStylesFor(owner: string | null): Promise<TextStyle[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(textStylesTag(owner));
  try {
    const rows = await typedRows(ROW, sql`select slug, name, kind, settings, css from commerce.text_styles where ${ownerIs(owner)} order by position, created_at, slug`, readDb());
    return rows.map(asStyle);
  } catch (error) {
    // A page is never worth failing for its words' looks: drawn without them.
    log("warn", "text_styles.read_failed", { owner }, error);
    return [];
  }
}

/** The stylesheet a site's layouts draw, after the theme and before the owner's own CSS. */
export async function textStylesCssFor(owner: string | null): Promise<string> {
  return textStylesCss(await textStylesFor(owner));
}

export type TextStyleResult = { ok: true; style: TextStyle; styles: TextStyle[]; dropped: string[] } | { ok: false; problems: string[] };

/**
 * Saves a style: a new one (no `slug`) gets a slug from its name and the next place in the library; an existing one keeps its slug.
 * A `custom` style keeps its own CSS as its rule's body (`styleCssBody()`), refused only where the site's own CSS would be (`styleCssProblem()`).
 */
export async function saveTextStyle(account: Account, owner: string | null, raw: unknown): Promise<TextStyleResult> {
  const parsed = textStyleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const input = parsed.data;
  let css: string | null = null;
  const dropped: string[] = [];
  if (input.kind === "custom") {
    const problem = styleCssProblem(input.css ?? "");
    if (problem) return { ok: false, problems: [problem] };
    css = styleCssBody(input.css ?? "");
  }
  const existing = await listTextStyles(owner);
  let slug = input.slug;
  if (slug) {
    if (!existing.some((style) => style.slug === slug)) return { ok: false, problems: ["That style is gone. Reload the builder and try again."] };
    await db().execute(sql`
      update commerce.text_styles set name = ${input.name}, kind = ${input.kind}, settings = ${JSON.stringify(input.settings)}::jsonb, css = ${css},
             updated_by = ${account.id}::uuid, updated_at = now()
       where ${ownerIs(owner)} and slug = ${slug}
    `);
  } else {
    if (existing.length >= TEXT_STYLES_MAX) return { ok: false, problems: [`A site keeps at most ${TEXT_STYLES_MAX} text styles. Delete one first.`] };
    slug = slugFor(input.name, existing.map((style) => style.slug));
    await db().execute(sql`
      insert into commerce.text_styles (store_id, slug, name, kind, settings, css, position, created_by, updated_by)
      values (${owner}::uuid, ${slug}, ${input.name}, ${input.kind}, ${JSON.stringify(input.settings)}::jsonb, ${css},
        (select coalesce(max(position), 0) + 1 from commerce.text_styles where ${ownerIs(owner)}), ${account.id}::uuid, ${account.id}::uuid)
    `);
  }
  await audit(account.id, owner, input.slug ? "text_style.changed" : "text_style.made", { slug, kind: input.kind });
  refreshTag(textStylesTag(owner));
  const styles = await listTextStyles(owner);
  return { ok: true, style: styles.find((style) => style.slug === slug)!, styles, dropped };
}

/** The pages, articles, headers and footers whose words wear a style, by title, draft or published. */
export async function textStyleUses(owner: string | null, slug: string): Promise<string[]> {
  const rows = await typedRows(
    z.object({ title: col.text }),
    sql`
      select coalesce(nullif(coalesce(published, draft) ->> 'title', ''), slug) as title
        from commerce.pages
       where ${ownerIs(owner)} and type <> 'variant'
         and (coalesce(draft::text, '') ~ ${`ts-${slug}([^a-z0-9-]|$)`} or coalesce(published::text, '') ~ ${`ts-${slug}([^a-z0-9-]|$)`}
           or jsonb_path_exists(coalesce(draft, '{}'::jsonb), '$.** ? (@.type == "textClass" && @.attrs.name == $s)', jsonb_build_object('s', ${slug}::text))
           or jsonb_path_exists(coalesce(published, '{}'::jsonb), '$.** ? (@.type == "textClass" && @.attrs.name == $s)', jsonb_build_object('s', ${slug}::text)))
       order by updated_at desc
       limit 20
    `,
  );
  return rows.map((row) => row.title);
}

export type DeleteStyleResult = { ok: true; styles: TextStyle[] } | { ok: false; problems: string[]; uses?: string[] };

/** Deletes a style; one in use is deleted only when `confirmed` (its words stay, unstyled), and otherwise says where it is used. */
export async function deleteTextStyle(account: Account, owner: string | null, slug: string, confirmed: boolean): Promise<DeleteStyleResult> {
  const uses = await textStyleUses(owner, slug);
  if (uses.length > 0 && !confirmed) {
    return { ok: false, problems: [`This style is used on ${uses.length === 1 ? "1 page" : `${uses.length} pages`}. Delete it anyway? Its words stay, without the style.`], uses };
  }
  const rows = await db().execute(sql`delete from commerce.text_styles where ${ownerIs(owner)} and slug = ${slug} returning slug`);
  if (rows.length === 0) return { ok: false, problems: ["That style is gone already."] };
  await audit(account.id, owner, "text_style.deleted", { slug, uses: uses.length });
  refreshTag(textStylesTag(owner));
  return { ok: true, styles: await listTextStyles(owner) };
}

/**
 * The slugs of the styles a piece of content's words wear (D393 step 2): `<span class="ts-…">` in inline markup and the rich-text mark,
 * found in its JSON as it is kept.
 */
export function stylesWorn(content: unknown): string[] {
  const text = JSON.stringify(content ?? null);
  const found = new Set(stylesInMarkup(text.replace(/\\"/g, '"')));
  for (const match of text.matchAll(/"type":"textClass","attrs":\{"name":"([a-z0-9-]{1,40})"\}/g)) found.add(match[1]);
  return [...found];
}

/**
 * Carries the styles a piece of content wears from the site it comes from to the site it is placed in (a template used, a theme's section
 * placed, a demo store's home page taken, a theme applied): each style the receiving site lacks by slug is copied, up to its limit; one it
 * already has by that slug keeps its own look. Returns the receiving site's library when anything was copied, else null. Never throws:
 * words without their style are still the words. Called after the content's own transaction, never inside it.
 */
export async function carryTextStyles(
  account: { id: string },
  from: string | null,
  to: string | null,
  content: unknown,
): Promise<TextStyle[] | null> {
  try {
    if (from === to) return null;
    const worn = stylesWorn(content);
    if (worn.length === 0) return null;
    const rows = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.text_styles (store_id, slug, name, kind, settings, css, position, created_by, updated_by)
      select ${to}::uuid, s.slug, s.name, s.kind, s.settings, s.css,
             (select coalesce(max(position), 0) from commerce.text_styles where ${ownerIs(to)}) + row_number() over (order by s.position, s.slug),
             ${account.id}::uuid, ${account.id}::uuid
        from commerce.text_styles s
       where ${from === null ? sql`s.store_id is null` : sql`s.store_id = ${from}::uuid`}
         and s.slug = any(${`{${worn.join(",")}}`}::text[])
         and not exists (select 1 from commerce.text_styles t where ${to === null ? sql`t.store_id is null` : sql`t.store_id = ${to}::uuid`} and t.slug = s.slug)
       order by s.position, s.slug
       limit greatest(0, ${TEXT_STYLES_MAX} - (select count(*) from commerce.text_styles where ${ownerIs(to)}))::int
      on conflict on constraint text_styles_owner_slug do nothing
      returning slug
    `);
    if (rows.length === 0) return null;
    await audit(account.id, to, "text_style.carried", { from: from ?? "kaizen", slugs: rows.map((r) => String(r.slug)) });
    refreshTag(textStylesTag(to));
    return await listTextStyles(to);
  } catch (error) {
    log("warn", "text_styles.carry_failed", { from, to }, error);
    return null;
  }
}
