import { fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import {
  staffEmailsEn,
  type StaffEmailsMessages,
} from "./admin-messages/staff-emails.en";
import type { EmailContent } from "./email-layout";
import { REOPEN_DAYS } from "./store-closure";

/**
 * The email the store's owners get when their store is closed, suspended or reopened (D171). Pure. Kaizen writes to owners in English, as the admin
 * is. It says what happened, who did it, and what the owner can do next, in the same words the admin uses.
 */

export type StatusEmailFacts = {
  storeName: string;
  change: "closed" | "suspended" | "reopened";
  /** Who did it: the owner's own closing, or Kaizen. */
  by: "owner" | "platform";
  /** The reason Kaizen gave, for a suspension or a closing by Kaizen. */
  reason: string | null;
  /** The store's page in the admin, where it can be reopened. */
  url: string;
  /** The last day the owner may reopen, for a closing. */
  reopenUntil: Date | null;
};

/** Written from the `staffEmails` catalogue in the owner's admin language (D312 A10); English unless other words are given. */
export function statusEmail(
  facts: StatusEmailFacts,
  words: StaffEmailsMessages = staffEmailsEn,
  lang: AdminLang = "en",
): EmailContent {
  const { storeName: name, by } = facts;
  const w = words.closure;
  const tag = ADMIN_LANG_FACTS[lang].tag;
  const footer = [name, words.footer];
  const reason = facts.reason
    ? fillWords(w.reason, { reason: facts.reason })
    : "";
  const button = { type: "button" as const, text: w.button, url: facts.url };
  if (facts.change === "closed") {
    const day = (date: Date) =>
      date.toLocaleDateString(ADMIN_LANG_FACTS[lang].locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    return {
      subject: fillWords(w.closedSubject, { name }),
      preview: fillWords(w.closedPreview, { name }),
      lang: tag,
      footer,
      blocks: [
        { type: "heading", text: fillWords(w.closedSubject, { name }) },
        {
          type: "paragraph",
          text: fillWords(w.closedText, {
            name,
            who: by === "owner" ? w.byOwner : w.byPlatform,
            reason,
          }),
        },
        { type: "paragraph", text: w.nothingDeleted },
        {
          type: "paragraph",
          text: facts.reopenUntil
            ? fillWords(w.reopenUntil, {
                day: day(facts.reopenUntil),
                days: REOPEN_DAYS,
              })
            : w.askToReopen,
        },
        button,
      ],
    };
  }
  if (facts.change === "suspended") {
    return {
      subject: fillWords(w.suspendedSubject, { name }),
      preview: fillWords(w.suspendedPreview, { name }),
      lang: tag,
      footer,
      blocks: [
        { type: "heading", text: fillWords(w.suspendedSubject, { name }) },
        {
          type: "paragraph",
          text: fillWords(w.suspendedText, { name, reason }),
        },
        { type: "paragraph", text: w.suspendedStill },
        button,
      ],
    };
  }
  return {
    subject: fillWords(w.reopenedSubject, { name }),
    preview: fillWords(w.reopenedPreview, { name }),
    lang: tag,
    footer,
    blocks: [
      { type: "heading", text: fillWords(w.reopenedSubject, { name }) },
      {
        type: "paragraph",
        text: fillWords(w.reopenedText, {
          name,
          by: by === "owner" ? w.reopenedByOwner : w.reopenedByPlatform,
        }),
      },
      button,
    ],
  };
}
