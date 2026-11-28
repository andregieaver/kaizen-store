/**
 * The builderText cut (bloat review step 2.27): the groups richText, textStyles, responsive of BUILDER_WORDS, in both languages (bloat
 * review step 2.25). Their catalogues are their own (D916), so a page reading these reaches neither builder catalogue. Server code reads
 * it as BUILDER_TEXT_WORDS[lang]. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { builderTextEn } from "../admin-messages/builder-text.en";
import { builderTextNb } from "../admin-messages/builder-text.nb";

export const BUILDER_TEXT_WORDS: Record<AdminLang, typeof builderTextEn> = { en: builderTextEn, nb: builderTextNb };
