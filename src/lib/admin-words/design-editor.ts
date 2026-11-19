/**
 * The designEditor cut (bloat review step 2.27): the groups fonts, changes of DESIGN_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as DESIGN_EDITOR_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { DESIGN_WORDS } from "./design";

export const DESIGN_EDITOR_WORDS = cut(DESIGN_WORDS, ["fonts", "changes"]);
