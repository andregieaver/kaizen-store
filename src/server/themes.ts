import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { siteFontFamilies } from "@/lib/fonts";
import { storeThemeInput, THEME_TEMPLATE_KEYS, themeSettingsSchema, type StoreTheme, type ThemeSettings, type ThemeTemplate } from "@/lib/theme";

import { audit, type Account } from "./auth";
import { findFont, installFonts } from "./fonts";

/**
 * A store's design (D60): the theme its storefront shows (`stores.theme`)
 * and the themes it has saved under a name (`commerce.store_themes`).
 */

type Row = Record<string, unknown>;

export type SavedTheme = { id: string; name: string; base: ThemeTemplate; settings: ThemeSettings; updatedAt: string };

export const THEME_NAME_MAX = 60;

const problemsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

/** A theme's fonts must be in Google Fonts, and are installed before any page uses them. */
async function readyFonts(settings: ThemeSettings): Promise<string[]> {
  const families = siteFontFamilies(settings.fonts);
  const unknown = families.filter((family) => !findFont(family));
  if (unknown.length > 0) return unknown.map((family) => `${family} is not in Google Fonts.`);
  const installed = await installFonts(families);
  return installed.ok ? [] : [installed.problem];
}

/** A store's saved themes, by name. */
export async function listSavedThemes(storeId: string): Promise<SavedTheme[]> {
  const rows = await db().execute<Row>(sql`
    select id, name, base, settings, updated_at from commerce.store_themes
    where store_id = ${storeId}::uuid order by lower(name)
  `);
  return rows.flatMap((row) => {
    const settings = themeSettingsSchema.safeParse(row.settings);
    const base = THEME_TEMPLATE_KEYS.find((key) => key === row.base);
    return settings.success && base
      ? [{ id: String(row.id), name: String(row.name), base, settings: settings.data, updatedAt: new Date(String(row.updated_at)).toISOString() }]
      : [];
  });
}

/** Puts a theme on the storefront: a template's, a saved one's or the owner's own settings. */
export async function saveStoreTheme(
  account: Account,
  storeId: string,
  input: unknown,
): Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }> {
  const parsed = storeThemeInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const fontProblems = await readyFonts(parsed.data.settings);
  if (fontProblems.length > 0) return { ok: false, problems: fontProblems };
  // A saved theme from another store is none of this one's.
  const theme = { ...parsed.data };
  if (theme.savedId) {
    const [own] = await db().execute<Row>(sql`
      select 1 from commerce.store_themes where id = ${theme.savedId}::uuid and store_id = ${storeId}::uuid
    `);
    if (!own) theme.savedId = null;
  }
  await db().execute(sql`update commerce.stores set theme = ${JSON.stringify(theme)}::jsonb where id = ${storeId}::uuid`);
  await audit(account.id, storeId, "store.theme_updated", { base: theme.base, savedId: theme.savedId });
  return { ok: true, theme };
}

const savedThemeInput = z.object({
  /** Null saves a new theme; an id updates that one. */
  id: z.uuid().nullable(),
  name: z
    .string()
    .trim()
    .min(1, "Give the theme a name.")
    .max(THEME_NAME_MAX, `Keep the theme's name under ${THEME_NAME_MAX} characters.`),
  base: z.enum(THEME_TEMPLATE_KEYS),
  settings: themeSettingsSchema,
});

/** Saves the settings under a name, as a new theme or over one of the store's own. */
export async function saveSavedTheme(
  account: Account,
  storeId: string,
  input: unknown,
): Promise<{ ok: true; theme: SavedTheme } | { ok: false; problems: string[] }> {
  const parsed = savedThemeInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const { id, name, base, settings } = parsed.data;
  const fontProblems = await readyFonts(settings);
  if (fontProblems.length > 0) return { ok: false, problems: fontProblems };
  const json = JSON.stringify(settings);
  try {
    const [row] = id
      ? await db().execute<Row>(sql`
          update commerce.store_themes
          set name = ${name}, base = ${base}, settings = ${json}::jsonb, updated_at = now()
          where id = ${id}::uuid and store_id = ${storeId}::uuid
          returning id, updated_at
        `)
      : await db().execute<Row>(sql`
          insert into commerce.store_themes (store_id, name, base, settings, created_by)
          values (${storeId}::uuid, ${name}, ${base}, ${json}::jsonb, ${account.id}::uuid)
          returning id, updated_at
        `);
    if (!row) return { ok: false, problems: ["That theme is gone. Save it as a new one."] };
    await audit(account.id, storeId, id ? "store.saved_theme_updated" : "store.saved_theme_created", { id: row.id, name });
    return {
      ok: true,
      theme: { id: String(row.id), name, base, settings, updatedAt: new Date(String(row.updated_at)).toISOString() },
    };
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (code === "23505") {
      return { ok: false, problems: [`The store already has a theme called “${name}”. Choose another name.`] };
    }
    throw error;
  }
}

/** Deletes one of the store's saved themes; the storefront keeps its look, no longer tied to it. */
export async function deleteSavedTheme(account: Account, storeId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const [row] = await db().execute<Row>(sql`
    delete from commerce.store_themes where id = ${id}::uuid and store_id = ${storeId}::uuid returning name
  `);
  if (!row) return false;
  await db().execute(sql`
    update commerce.stores set theme = jsonb_set(theme, '{savedId}', 'null'::jsonb)
    where id = ${storeId}::uuid and theme ->> 'savedId' = ${id}
  `);
  await audit(account.id, storeId, "store.saved_theme_deleted", { id, name: row.name });
  return true;
}
