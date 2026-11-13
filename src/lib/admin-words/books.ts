/**
 * The books area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { booksEn, type BooksMessages } from "../admin-messages/books.en";
import { booksNb } from "../admin-messages/books.nb";

export const BOOKS_WORDS: Record<AdminLang, BooksMessages> = { en: booksEn, nb: booksNb };
