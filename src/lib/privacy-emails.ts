import type { EmailContent } from "./email-layout";

/**
 * The emails to a store's owners about privacy requests (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 7 and 2.6). Pure. Kaizen writes to
 * owners in English, as the admin is. They hold who did what and when, never a customer's name, email or any other personal data: the
 * request id and a link to the request in the admin are enough. The permission check, the typed confirmation and these notices are the
 * controls that take the place of Shopify's 10-day cancel window.
 */

const FOOTER = ["Kaizen · kaizenstore.cloud"];

export type OwnersNoticeFacts = {
  storeName: string;
  /** What was done: a staff download of a customer's data, or a staff erasure. */
  action: "export" | "erasure";
  /** The staff member who did it (their name or, failing it, their sign-in address: a staff member is not the data subject). */
  actor: string;
  /** `2026-10-04 14:32 UTC`. */
  when: string;
  /** The request it answers, when there was one. */
  requestId: string | null;
  /** The request (or the privacy list) in the admin. */
  url: string;
};

export function ownersNoticeEmail(f: OwnersNoticeFacts): EmailContent {
  const what = f.action === "export" ? "downloaded a customer's data" : "erased a customer's personal data";
  return {
    subject: f.action === "export" ? `A customer's data was downloaded in ${f.storeName}` : `A customer was erased in ${f.storeName}`,
    preview: `${f.actor} ${what}.`,
    lang: "en",
    footer: [f.storeName, ...FOOTER],
    blocks: [
      { type: "heading", text: f.action === "export" ? "A customer's data was downloaded" : "A customer was erased" },
      { type: "paragraph", text: `${f.actor} ${what} in ${f.storeName} on ${f.when}.${f.requestId ? ` It answers privacy request ${f.requestId}.` : ""}` },
      {
        type: "paragraph",
        text:
          f.action === "export"
            ? "The file holds everything the store keeps about the customer. It was downloaded, not emailed."
            : "Orders the bookkeeping rules require are kept without a link to the person and anonymised when their period ends. Subscriptions were cancelled without a refund.",
      },
      { type: "paragraph", text: "This email holds no personal data about the customer. Open the request in the admin to see what was done." },
      { type: "button", text: "Open in the admin", url: f.url },
    ],
  };
}

export type DueReminderFacts = {
  storeName: string;
  kind: "due_soon" | "overdue";
  /** The request's id and the day it is due (the extended day when there is one), `2026-10-11`. */
  requestId: string;
  dueDay: string;
  /** `export` or `erasure`. */
  requestKind: "export" | "erasure";
  url: string;
};

export function dueReminderEmail(f: DueReminderFacts): EmailContent {
  const what = f.requestKind === "export" ? "data request" : "erasure request";
  const overdue = f.kind === "overdue";
  return {
    subject: overdue ? `A privacy ${what} in ${f.storeName} is overdue` : `A privacy ${what} in ${f.storeName} is due ${f.dueDay}`,
    preview: overdue ? `The answer was due ${f.dueDay}.` : `The answer is due ${f.dueDay}.`,
    lang: "en",
    footer: [f.storeName, ...FOOTER],
    blocks: [
      { type: "heading", text: overdue ? "A privacy request is overdue" : "A privacy request is due soon" },
      {
        type: "paragraph",
        text: overdue
          ? `The ${what} ${f.requestId} in ${f.storeName} was due ${f.dueDay} and has not been answered. The law gives one month, without undue delay.`
          : `The ${what} ${f.requestId} in ${f.storeName} is due ${f.dueDay}. The law gives one month, without undue delay; a request may be extended once, with a reason, before it is due.`,
      },
      { type: "button", text: "Open the request", url: f.url },
    ],
  };
}
