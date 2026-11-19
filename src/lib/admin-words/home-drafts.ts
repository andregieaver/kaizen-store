/**
 * The homeDrafts cut (bloat review step 2.27): the groups drafts of HOME_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as HOME_DRAFTS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { HOME_WORDS } from "./home";

export const HOME_DRAFTS_WORDS = cut(HOME_WORDS, ["drafts"]);
