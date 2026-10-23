import { fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import {
  staffEmailsEn,
  type StaffEmailsMessages,
} from "./admin-messages/staff-emails.en";
import type { EmailContent } from "./email-layout";

/**
 * The emails about a person's own sign-in security (wave 1, 1f, docs/wave-1-trust.md 2.6): a recovery code was used, two-step was
 * removed, a platform admin reset it. Pure, like `experiment-emails.ts`: the server decides who gets one and when. Each is written
 * in the account's own admin language (D312 A10). Each says what happened and what to do if it was not them, and none carries a code, a link
 * that signs anyone in, or a secret.
 */

export type SecurityEvent =
  | "recovery_code_used"
  | "two_step_removed"
  | "two_step_reset";

export type SecurityFacts = {
  event: SecurityEvent;
  /** The person's name or email, for the greeting. */
  person: string;
  /** When it happened, as the reader reads it (`2026-10-03 14:05 UTC`). */
  when: string;
  /** For a recovery code: how many are still unused after this. Left out for the others. */
  codesLeft?: number;
  /** For a reset: who did it (a platform admin's email). */
  by?: string | null;
  /** The sign-in page. */
  signInUrl: string;
};

/** Written from the `staffEmails` catalogue in the account's admin language (D312 A10); English unless other words are given. */
export function securityEmail(
  facts: SecurityFacts,
  words: StaffEmailsMessages = staffEmailsEn,
  lang: AdminLang = "en",
): EmailContent {
  const w = words.security;
  const intro = fillWords(w.intros[facts.event], {
    when: facts.when,
    by: facts.by ? fillWords(w.by, { by: facts.by }) : "",
  });
  const subject = w.subjects[facts.event];
  return {
    subject,
    preview: subject,
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [words.footer],
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: fillWords(w.hello, { person: facts.person }) },
      { type: "paragraph", text: intro },
      { type: "paragraph", text: w.wasYou },
      { type: "paragraph", text: w.notYou },
      { type: "button", text: w.signIn, url: facts.signInUrl },
    ],
  };
}
