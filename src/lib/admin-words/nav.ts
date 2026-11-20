/**
 * The admin navigation's Norwegian (D312 A2), the `nav` area's module (bloat review step 2.50): the English is the navigation's own text
 * (`store-nav.ts`, `owner-nav.ts`, `platform-nav.ts`), so the area has one language. Code reads it here, never `admin-messages/nav.nb.ts`
 * itself. Never import this from a "use client" file.
 */
import type { AdminLang } from "../admin-lang";
import { NAV_NB } from "../admin-messages/nav.nb";

export const NAV_WORDS: Record<Exclude<AdminLang, "en">, typeof NAV_NB> = { nb: NAV_NB };
