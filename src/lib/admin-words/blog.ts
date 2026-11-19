/**
 * The blog area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * BLOG_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { blogEn, type BlogMessages } from "../admin-messages/blog.en";
import { blogNb } from "../admin-messages/blog.nb";

export const BLOG_WORDS: Record<AdminLang, BlogMessages> = { en: blogEn, nb: blogNb };
