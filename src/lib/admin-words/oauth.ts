/**
 * The oauth area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { oauthEn, type OauthMessages } from "../admin-messages/oauth.en";
import { oauthNb } from "../admin-messages/oauth.nb";

export const OAUTH_WORDS: Record<AdminLang, OauthMessages> = { en: oauthEn, nb: oauthNb };
