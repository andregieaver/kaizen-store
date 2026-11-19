/**
 * The productsEditor cut (bloat review step 2.27): the groups terms, termFields, termPage, termRules, termSeo of PRODUCTS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as PRODUCTS_EDITOR_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { PRODUCTS_WORDS } from "./products";

export const PRODUCTS_EDITOR_WORDS = cut(PRODUCTS_WORDS, ["terms", "termFields", "termPage", "termRules", "termSeo"]);
