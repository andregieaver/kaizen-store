/**
 * The analyticsExport cut (bloat review step 2.27): the groups exportButton of ANALYTICS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as ANALYTICS_EXPORT_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { ANALYTICS_WORDS } from "./analytics";

export const ANALYTICS_EXPORT_WORDS = cut(ANALYTICS_WORDS, ["exportButton"]);
