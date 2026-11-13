/**
 * The invoices area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { invoicesEn, type InvoicesMessages } from "../admin-messages/invoices.en";
import { invoicesNb } from "../admin-messages/invoices.nb";

export const INVOICES_WORDS: Record<AdminLang, InvoicesMessages> = { en: invoicesEn, nb: invoicesNb };
