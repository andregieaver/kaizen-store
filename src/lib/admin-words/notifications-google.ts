/**
 * The notificationsGoogle cut (bloat review step 2.27): the groups google of NOTIFICATIONS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as NOTIFICATIONS_GOOGLE_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { NOTIFICATIONS_WORDS } from "./notifications";

export const NOTIFICATIONS_GOOGLE_WORDS = cut(NOTIFICATIONS_WORDS, ["google"]);
