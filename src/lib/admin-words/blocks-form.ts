/**
 * The blocksForm cut (bloat review step 2.27): the groups form, lists of BLOCKS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as BLOCKS_FORM_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { BLOCKS_WORDS } from "./blocks";

export const BLOCKS_FORM_WORDS = cut(BLOCKS_WORDS, ["form", "lists"]);
