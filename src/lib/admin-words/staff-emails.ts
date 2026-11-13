/**
 * The staffEmails area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { staffEmailsEn, type StaffEmailsMessages } from "../admin-messages/staff-emails.en";
import { staffEmailsNb } from "../admin-messages/staff-emails.nb";

export const STAFF_EMAILS_WORDS: Record<AdminLang, StaffEmailsMessages> = { en: staffEmailsEn, nb: staffEmailsNb };
