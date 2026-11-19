/**
 * The fieldsEditor cut (bloat review step 2.27): the groups form, pickers, linkKinds of FIELDS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as FIELDS_EDITOR_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { FIELDS_WORDS } from "./fields";

export const FIELDS_EDITOR_WORDS = cut(FIELDS_WORDS, ["form", "pickers", "linkKinds"]);
