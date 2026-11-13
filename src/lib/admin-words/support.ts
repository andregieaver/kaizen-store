/**
 * The support area's words in both languages, for code outside the admin (bloat review step 0.7; the chat widgets' actions, D582). Code
 * outside src/app/admin and src/components/admin reads an area here, never through the admin registry, which loads every area. Never
 * import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { supportEn, type SupportMessages } from "../admin-messages/support.en";
import { supportNb } from "../admin-messages/support.nb";

export const SUPPORT_WORDS: Record<AdminLang, SupportMessages> = { en: supportEn, nb: supportNb };
