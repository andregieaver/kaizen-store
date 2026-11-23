/**
 * The send allowance's words in both languages (D876, in bloat review step 0.7's shape). Server code reads them as SEND_ALLOWANCE_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { sendAllowanceEn, type SendAllowanceMessages } from "../admin-messages/send-allowance.en";
import { sendAllowanceNb } from "../admin-messages/send-allowance.nb";

export const SEND_ALLOWANCE_WORDS: Record<AdminLang, SendAllowanceMessages> = { en: sendAllowanceEn, nb: sendAllowanceNb };
