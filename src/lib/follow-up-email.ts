import { fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import { staffEmailsEn, type StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import type { EmailContent } from "./email-layout";

/**
 * The email that tells a person the AI manager followed up as they asked (PSI AGT-04), in their admin language. It names their own task
 * and where to read the answer, never the answer itself: that stays in the admin, behind their sign-in.
 */

export type FollowUpFacts = {
  task: string;
  /** The store's name, or null on the platform. */
  store: string | null;
  /** The conversation in the admin. */
  url: string;
  outcome: "done" | "failed";
  /** A change the turn kept for their yes. */
  waiting: boolean;
  /** When a repeating one runs next, in words; null when it does not. */
  next: string | null;
};

const SHORT = 60;
const short = (task: string) => {
  const flat = task.replace(/\s+/g, " ").trim();
  return flat.length > SHORT ? `${flat.slice(0, SHORT - 1)}…` : flat;
};

export function followUpEmail(facts: FollowUpFacts, words: StaffEmailsMessages = staffEmailsEn, lang: AdminLang = "en"): EmailContent {
  const w = words.followUp;
  const where = facts.store ? fillWords(w.where, { store: facts.store }) : "";
  const task = facts.task.replace(/\s+/g, " ").trim();
  const base = { lang: ADMIN_LANG_FACTS[lang].tag, footer: [words.footer] };
  if (facts.outcome === "failed") {
    return {
      ...base,
      subject: fillWords(w.failedSubject, { task: short(facts.task) }),
      preview: w.failedPreview,
      blocks: [
        { type: "heading", text: w.failedHeading },
        { type: "paragraph", text: fillWords(w.failed, { task, where }) },
        { type: "button", text: w.failedButton, url: facts.url },
      ],
    };
  }
  return {
    ...base,
    subject: fillWords(w.subject, { task: short(facts.task) }),
    preview: w.preview,
    blocks: [
      { type: "heading", text: w.heading },
      { type: "paragraph", text: fillWords(w.done, { task, where }) },
      ...(facts.waiting ? [{ type: "paragraph" as const, text: w.waiting }] : []),
      ...(facts.next ? [{ type: "paragraph" as const, text: fillWords(w.next, { when: facts.next }) }] : []),
      { type: "button", text: w.button, url: facts.url },
    ],
  };
}
