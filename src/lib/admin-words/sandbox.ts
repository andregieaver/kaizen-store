/**
 * The sandbox area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { sandboxEn, type SandboxMessages } from "../admin-messages/sandbox.en";
import { sandboxNb } from "../admin-messages/sandbox.nb";

export const SANDBOX_WORDS: Record<AdminLang, SandboxMessages> = { en: sandboxEn, nb: sandboxNb };
