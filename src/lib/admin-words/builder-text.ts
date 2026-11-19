/**
 * The builderText cut (bloat review step 2.27): the groups richText, textStyles, responsive of BUILDER_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as BUILDER_TEXT_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { BUILDER_WORDS } from "./builder";

export const BUILDER_TEXT_WORDS = cut(BUILDER_WORDS, ["richText", "textStyles", "responsive"]);
