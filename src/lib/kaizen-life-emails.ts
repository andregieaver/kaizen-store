import { fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import { staffEmailsEn, type StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import type { EmailContent } from "./email-layout";

/**
 * The email that tells a person their Kaizena Flow account was linked to Kaizen Life (docs/life-work-summary.md 3.3), in their admin
 * language. Pure: the server decides when (once per link made). It says why they were linked, what Kaizen Life may do (read the
 * Work summary, nothing else) and how to unlink; it carries no link that signs anyone in.
 */
export type LinkedFacts = {
  /** The person's name or email, for the greeting. */
  person: string;
  /** When it was linked, as the reader reads it (`2026-11-09 10:05 UTC`). */
  when: string;
  /** Why: the same email on both, or a sign-in with the other app. */
  how: "email" | "identity" | "backfill";
  /** Your account → Connected apps and assistants. */
  connectedUrl: string;
};

export function kaizenLifeLinkedEmail(facts: LinkedFacts, words: StaffEmailsMessages = staffEmailsEn, lang: AdminLang = "en"): EmailContent {
  const w = words.kaizenLife;
  return {
    subject: w.subject,
    preview: w.subject,
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [words.footer],
    blocks: [
      { type: "heading", text: w.subject },
      { type: "paragraph", text: fillWords(w.hello, { person: facts.person }) },
      { type: "paragraph", text: fillWords(facts.how === "identity" ? w.linkedSignIn : w.linkedEmail, { when: facts.when }) },
      { type: "paragraph", text: w.shows },
      { type: "paragraph", text: w.notWanted },
      { type: "button", text: w.button, url: facts.connectedUrl },
    ],
  };
}
