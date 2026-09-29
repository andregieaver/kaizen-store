import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { defaultLocale, directionOf, isLanguageCode, worldLanguage } from "@/lib/languages";

import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * The languages the platform offers stores (D111): Kaizen's admins choose them
 * from the world's languages, and a store picks its own among the enabled ones
 * (`/admin/{store}/settings/localization`). A language stores use cannot be
 * turned off; English stays on.
 */

export const LANGUAGES_TAG = "languages";

export type PlatformLanguage = { lang: string; locales: string[]; name: string; enabled: boolean; direction: "ltr" | "rtl" };

const toLanguage = (row: Row): PlatformLanguage => ({
  lang: String(row.lang),
  locales: (row.locales as string[]).map(String),
  name: String(row.name),
  enabled: Boolean(row.enabled),
  direction: row.direction === "rtl" ? "rtl" : "ltr",
});

/** Every language, enabled or not, read fresh for the platform admin. */
export async function listLanguages(): Promise<PlatformLanguage[]> {
  const rows = await db().execute<Row>(sql`select lang, locales, name, enabled, direction from commerce.platform_languages order by name`);
  return rows.map(toLanguage);
}

/** The languages a store can choose from, cached until the platform changes them. */
export async function enabledLanguages(): Promise<PlatformLanguage[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(LANGUAGES_TAG);
  const rows = await readDb().execute<Row>(sql`select lang, locales, name, enabled, direction from commerce.platform_languages where enabled order by name`);
  return rows.map(toLanguage);
}

export type LanguageResult = { ok: true } | { ok: false; problem: string };

/** Adds a language from the world's, switched on, with its main locale. */
export async function addLanguage(accountId: string, lang: string): Promise<LanguageResult> {
  const code = lang.trim().toLowerCase();
  if (!isLanguageCode(code)) return { ok: false, problem: "That is not a language code." };
  const language = worldLanguage(code);
  const rows = await db().execute<Row>(sql`
    insert into commerce.platform_languages (lang, locales, name, direction)
    values (${code}, array[${defaultLocale(code)}]::text[], ${language.name}, ${directionOf(code)})
    on conflict (lang) do update set enabled = true, updated_at = now()
    returning lang
  `);
  await audit(accountId, null, "language.added", { lang: code, created: rows.length > 0 });
  return { ok: true };
}

/** How many stores write in a language: in their languages, or as a country's own. */
export async function storesUsing(lang: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(distinct s.id)::int as n from commerce.stores s
    left join commerce.markets m on m.store_id = s.id
    where exists (select 1 from unnest(s.locales) l where split_part(l, '-', 1) = ${lang})
       or split_part(m.default_locale, '-', 1) = ${lang}
  `);
  return Number(row?.n ?? 0);
}

/** Switches a language on or off for stores to choose; one that stores use stays on. */
export async function setLanguageEnabled(accountId: string, lang: string, enabled: boolean): Promise<LanguageResult> {
  if (!enabled) {
    if (lang === "en") return { ok: false, problem: "English stays on: it is what every other language falls back to." };
    const using = await storesUsing(lang);
    if (using > 0) return { ok: false, problem: `${using} ${using === 1 ? "store uses" : "stores use"} this language, so it stays on.` };
  }
  const rows = await db().execute<Row>(sql`update commerce.platform_languages set enabled = ${enabled}, updated_at = now() where lang = ${lang} returning lang`);
  if (rows.length === 0) return { ok: false, problem: "Unknown language." };
  await audit(accountId, null, enabled ? "language.enabled" : "language.disabled", { lang });
  return { ok: true };
}

/** A language's locales: its main one first, then the variants stores can pick (`de-AT`). */
export async function setLanguageLocales(accountId: string, lang: string, locales: string[]): Promise<LanguageResult> {
  const clean = [...new Set(locales.map((l) => l.trim()).filter((l) => new RegExp(`^${lang}-[A-Z]{2}$`).test(l)))];
  if (clean.length === 0) return { ok: false, problem: `Give at least one locale of the form ${lang}-XX, such as ${defaultLocale(lang)}.` };
  const rows = await db().execute<Row>(sql`
    update commerce.platform_languages set locales = ${sql`array[${sql.join(clean.map((l) => sql`${l}`), sql`, `)}]::text[]`}, updated_at = now()
    where lang = ${lang} returning lang
  `);
  if (rows.length === 0) return { ok: false, problem: "Unknown language." };
  await audit(accountId, null, "language.locales", { lang, locales: clean });
  return { ok: true };
}
