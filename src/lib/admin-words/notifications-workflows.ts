/**
 * The notificationsWorkflows cut (bloat review step 2.27): the groups workflows of NOTIFICATIONS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as NOTIFICATIONS_WORKFLOWS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { NOTIFICATIONS_WORDS } from "./notifications";

export const NOTIFICATIONS_WORKFLOWS_WORDS = cut(NOTIFICATIONS_WORDS, ["workflows"]);
