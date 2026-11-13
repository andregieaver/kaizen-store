/** The languages whose interface text is written by hand, in code (D111): they are never in the database. */
export const BUILT_IN_LANGUAGES = ["nb", "sv", "da", "en"] as const;
export const isBuiltIn = (lang: string) => (BUILT_IN_LANGUAGES as readonly string[]).includes(lang);
