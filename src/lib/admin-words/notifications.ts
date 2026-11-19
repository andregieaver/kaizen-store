/**
 * The notifications area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * NOTIFICATIONS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { notificationsEn, type NotificationsMessages } from "../admin-messages/notifications.en";
import { notificationsNb } from "../admin-messages/notifications.nb";

export const NOTIFICATIONS_WORDS: Record<AdminLang, NotificationsMessages> = { en: notificationsEn, nb: notificationsNb };
