/**
 * The websiteMenus cut (bloat review step 2.27): the groups menus of WEBSITE_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as WEBSITE_MENUS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { WEBSITE_WORDS } from "./website";

export const WEBSITE_MENUS_WORDS = cut(WEBSITE_WORDS, ["menus"]);
