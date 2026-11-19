/**
 * The websiteList cut (bloat review step 2.27): the groups list, pageJobs, demoHomes of WEBSITE_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as WEBSITE_LIST_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { WEBSITE_WORDS } from "./website";

export const WEBSITE_LIST_WORDS = cut(WEBSITE_WORDS, ["list", "pageJobs", "demoHomes"]);
