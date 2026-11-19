/**
 * The builder area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * BUILDER_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { builderEn, type BuilderMessages } from "../admin-messages/builder.en";
import { builderNb } from "../admin-messages/builder.nb";

export const BUILDER_WORDS: Record<AdminLang, BuilderMessages> = { en: builderEn, nb: builderNb };
