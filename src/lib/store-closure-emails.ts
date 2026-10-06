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

const FOOTER = ["Kaizen · kaizenstore.cloud"];

const day = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function statusEmail(facts: StatusEmailFacts): EmailContent {
  const { storeName: name, by } = facts;
  const who = by === "owner" ? "was closed from its settings" : "was closed by Kaizen";
  if (facts.change === "closed") {
    return {
      subject: `${name} is closed`,
      preview: `${name} no longer takes orders. Its orders, invoices and customer data stay available to you.`,
      lang: "en",
      footer: [name, ...FOOTER],
      blocks: [
        { type: "heading", text: `${name} is closed` },
        { type: "paragraph", text: `${name} ${who}. The shop no longer takes orders, its Kaizen plan ends when the period you have paid for is over, and its own domains are released.${facts.reason ? ` Reason given: ${facts.reason}` : ""}` },
        { type: "paragraph", text: "Nothing was deleted. You can still open the store's orders, invoices, returns and customer data in the admin, and download them: invoices and orders are kept for the bookkeeping period of the seller's country, and then made anonymous." },
        {
          type: "paragraph",
          text: facts.reopenUntil
            ? `You can reopen the store yourself until ${day(facts.reopenUntil)} (${REOPEN_DAYS} days). After that, ask Kaizen.`
            : "To reopen the store, ask Kaizen.",
        },
        { type: "button", text: "Open the store in the admin", url: facts.url },
      ],
    };
  }
  if (facts.change === "suspended") {
    return {
      subject: `${name} is suspended`,
      preview: `${name} is paused by Kaizen and takes no orders until it is reopened.`,
      lang: "en",
      footer: [name, ...FOOTER],
      blocks: [
        { type: "heading", text: `${name} is suspended` },
        { type: "paragraph", text: `Kaizen has suspended ${name}. The shop takes no orders and cannot be changed until Kaizen reopens it.${facts.reason ? ` Reason given: ${facts.reason}` : ""}` },
        { type: "paragraph", text: "You can still see orders, invoices, returns and customer data in the admin and handle what has already been sold. Reply to this email or write to Kaizen to have the store reopened." },
        { type: "button", text: "Open the store in the admin", url: facts.url },
      ],
    };
  }
  return {
    subject: `${name} is open again`,
    preview: `${name} is reopened and takes orders again.`,
    lang: "en",
    footer: [name, ...FOOTER],
    blocks: [
      { type: "heading", text: `${name} is open again` },
      { type: "paragraph", text: `${name} was reopened${by === "owner" ? " from its settings" : " by Kaizen"}. The shop takes orders again. If you had closed it, add its own domains again under Settings, Domains, and check that its Kaizen plan is still on.` },
      { type: "button", text: "Open the store in the admin", url: facts.url },
    ],
  };
}
