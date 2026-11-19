import type { AdminLang } from "./admin-lang";

/**
 * Several admin areas' words in one language, from their modules in src/lib/admin-words (bloat review step 2.25): areaTexts(lang, {
 * builder: BUILDER_WORDS, blocks: BLOCKS_WORDS }). One area is read as its module indexed by the language: BUILDER_WORDS[lang].
 */
export function areaTexts<T extends Record<string, Record<AdminLang, unknown>>>(lang: AdminLang, modules: T): { [K in keyof T]: T[K][AdminLang] } {
  return Object.fromEntries(Object.entries(modules).map(([area, words]) => [area, words[lang]])) as { [K in keyof T]: T[K][AdminLang] };
}

/**
 * A cut of an area (bloat review step 2.27, `docs/platform-admin-i18n.md` 3.3): some of its top-level groups, the same objects in each
 * language, so no string moves and no catalogue file is added. Each cut is a module of its own in src/lib/admin-words
 * (`BUILDER_TEXT_WORDS = cut(BUILDER_WORDS, [...])`, bloat review step 2.25); a part that reads a group outside its cut does not compile.
 */
export function cut<T extends object, K extends keyof T>(source: Record<AdminLang, T>, keys: readonly K[]): Record<AdminLang, Pick<T, K>> {
  return Object.fromEntries(
    Object.entries(source).map(([lang, words]) => [lang, Object.fromEntries(keys.map((key) => [key, (words as T)[key]])) as Pick<T, K>]),
  ) as Record<AdminLang, Pick<T, K>>;
}
