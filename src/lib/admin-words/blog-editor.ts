/**
 * The blogEditor cut (bloat review step 2.27): the groups editor of BLOG_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as BLOG_EDITOR_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { BLOG_WORDS } from "./blog";

export const BLOG_EDITOR_WORDS = cut(BLOG_WORDS, ["editor"]);
