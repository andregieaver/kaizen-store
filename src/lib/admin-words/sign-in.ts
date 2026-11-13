/**
 * The signIn area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { signInEn, type SignInMessages } from "../admin-messages/sign-in.en";
import { signInNb } from "../admin-messages/sign-in.nb";

export const SIGN_IN_WORDS: Record<AdminLang, SignInMessages> = { en: signInEn, nb: signInNb };
